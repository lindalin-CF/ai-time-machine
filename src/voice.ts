// Voice agent for the AI Surface Library.
//
// Wraps the base `Agent` with the @cloudflare/voice pipeline: Workers AI does
// speech-to-text (Flux) and text-to-speech (Aura-1). `onTurn()` now answers with
// an LLM (GPT-OSS) that is *grounded* in the library's D1 data, so it can handle
// free-form questions ("compare ChatGPT and Claude", "which has the cleanest
// design?") while still only using real captured data.
//
// Model choice follows the internal Voice Agents benchmark: Flux STT +
// GPT-OSS + Aura-1 TTS was the lowest-latency, most-reliable pipeline. The
// library dataset is small, so we stuff it into the prompt (one streaming call,
// no tool round-trips) for the fastest possible time-to-first-audio.

import { Agent, getAgentByName } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
  type VoiceTurnContext,
} from "@cloudflare/voice";
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "./types";
import { listWeeks, latestWeek, capturesForWeek } from "./db";
import { isPublishedAnalysis } from "./analysis";
import { VOICE_RETENTION_MS } from "./voice-room";

const VoiceAgent = withVoice(Agent);

// Fastest reliable text model per the internal benchmark.
const LLM_MODEL = "@cf/openai/gpt-oss-120b";

export class PortalVoiceAgent extends VoiceAgent<Env> {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string, context: VoiceTurnContext) {
    await this.scheduleExpiry();
    const workersai = createWorkersAI({ binding: this.env.AI });
    const grounding = await this.buildLibraryContext();

    const system = [
      'You are the voice guide for the "AI Interface Library" — a gallery that',
      "captures the landing pages of major AI / LLM portals every week and records a short",
      "design note and colour palette for each one.",
      "",
      "Answer the user's spoken questions about these portals: layout, visual hierarchy,",
      "brand colour, palette, and design choices. You may compare portals to each other.",
      "",
      "Rules:",
      "- Use ONLY the library data below. Never invent portals, colours, or design details.",
      "  If something isn't in the data, say you don't have that captured yet.",
      "- Keep answers short and conversational — they are read aloud. One to three sentences",
      "  unless the user asks for more detail.",
      "- Describe colours naturally (e.g. \"a warm orange\"); only spell out a hex code if asked.",
      "- Do not mention databases, JSON, context, or that you were given any data.",
      "",
      grounding,
    ].join("\n");

    const history = context.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = streamText({
      model: workersai(LLM_MODEL),
      system,
      messages: [...history, { role: "user" as const, content: transcript }],
      maxRetries: 1,
      abortSignal: context.signal,
      onError: (e) => console.error("[PortalVoiceAgent] LLM stream error:", e),
    });

    // Return the AI SDK `fullStream` (not `textStream`): @cloudflare/voice reads
    // the typed parts and speaks ONLY `text-delta` chunks, so GPT-OSS's reasoning
    // tokens are never sent to TTS. It also avoids the textStream chunk-joining bug.
    return result.fullStream;
  }

  /**
   * Retention: a room's messages are deleted 24 hours after its last message. One pending
   * expireMessages schedule per room; when it fires early (newer messages arrived) it re-arms.
   */
  private async scheduleExpiry(): Promise<void> {
    const pending = await this.listSchedules();
    if (pending.some((s) => s.callback === "expireMessages")) return;
    await this.schedule(new Date(Date.now() + VOICE_RETENTION_MS), "expireMessages");
  }

  async expireMessages(): Promise<void> {
    const table = this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'cf_voice_messages'`;
    if (!table[0]?.n) return;
    const newest = this.sql<{ t: number | null }>`SELECT MAX(timestamp) AS t FROM cf_voice_messages`[0]?.t;
    if (newest == null) return;
    const due = newest + VOICE_RETENTION_MS;
    // A minute of slack: the answer is saved a few seconds after the question that armed the schedule.
    if (Date.now() >= due - 60_000) {
      this.sql`DELETE FROM cf_voice_messages`;
      return;
    }
    await this.schedule(new Date(due), "expireMessages");
  }

  /** Compact, grounded snapshot of the latest capture week for the prompt. */
  private async buildLibraryContext(): Promise<string> {
    const week = await latestWeek(this.env);
    if (!week) return "LIBRARY DATA: no captures have been recorded yet.";

    const [weeks, caps] = await Promise.all([
      listWeeks(this.env),
      capturesForWeek(this.env, week),
    ]);
    const label = weeks.find((w) => w.week === week)?.label ?? week;
    const ok = caps.filter((c) => c.status === "ok");

    const lines = ok.map((c) => {
      const palette = this.palette(c.palette);
      // Only guideline analyses are grounding material; legacy/pending text is skipped.
      const analysis = isPublishedAnalysis(c) ? this.trim(c.analysis, 600) : "";
      return `- ${c.portal} (${c.company}) — brand colour ${c.brand}${
        palette ? `; palette ${palette}` : ""
      }.${analysis ? ` Design note: ${analysis}` : ""}`;
    });

    return [
      `LIBRARY DATA — latest capture week: ${label} (${ok.length} portals tracked).`,
      `Total archived weeks available: ${weeks.length}.`,
      "Portals captured this week:",
      ...lines,
    ].join("\n");
  }

  private palette(raw: string): string {
    try {
      const v = JSON.parse(raw || "[]");
      return Array.isArray(v) ? v.slice(0, 5).join(", ") : "";
    } catch {
      return "";
    }
  }

  private trim(text: string, max: number): string {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
  }
}

const LEGACY_ROOM_FLAG = "voice:legacy-room-expired";

/**
 * Before per-tab rooms, every visitor shared the room "default". The Worker no longer routes to it,
 * so apply the same 24-hour retention to it once: its messages are deleted now, or 24 hours after
 * its last message if that is sooner than a day ago.
 */
export async function expireLegacyRoom(env: Env): Promise<void> {
  if (await env.CACHE.get(LEGACY_ROOM_FLAG)) return;
  const stub = await getAgentByName(env.PortalVoiceAgent, "default");
  await stub.expireMessages();
  await env.CACHE.put(LEGACY_ROOM_FLAG, "1");
}

// Voice agent for the AI Surface Library.
//
// Wraps the base `Agent` with the @cloudflare/voice pipeline: Workers AI does
// speech-to-text (Flux) and text-to-speech (Aura-1). `onTurn()` answers with an
// LLM (GPT-OSS) grounded in published analyses only (src/voice-context.ts), so it
// can handle free-form questions ("compare ChatGPT and Claude", "what changed
// this week?") while still only using real captured data.
//
// Model choice follows the internal Voice Agents benchmark: Flux STT +
// GPT-OSS + Aura-1 TTS was the lowest-latency, most-reliable pipeline. The
// library dataset is small, so we stuff it into the prompt (one streaming call,
// no tool round-trips) for the fastest possible time-to-first-audio.

import { Agent, getAgentByName, type Connection, type ConnectionContext } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
  type VoiceTurnContext,
} from "@cloudflare/voice";
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "./types";
import { listPortals, publishedCaptures } from "./db";
import { cached } from "./api";
import { buildVoiceContext, capPageLinks, fluxWithKeyterms, voiceSystemPrompt } from "./voice-context";
import { VOICE_RETENTION_MS } from "./voice-room";
import { QUESTION_LOG_HEADER, logQuestion } from "./question-log";

const VoiceAgent = withVoice(Agent);

// Fastest reliable text model per the internal benchmark.
const LLM_MODEL = "@cf/openai/gpt-oss-120b";

export class PortalVoiceAgent extends VoiceAgent<Env> {
  // Flux with every portal name and site term boosted (see fluxWithKeyterms for why not the keyterms option).
  transcriber = new WorkersAIFluxSTT(fluxWithKeyterms(this.env));
  tts = new WorkersAITTS(this.env.AI);

  /** Spoken questions waiting for their onTurn(), by connection; anything else reaching onTurn() was typed. */
  private spokenTurns = new Map<string, string>();

  /**
   * The Worker sets x-question-log: 1 on the WebSocket request only when analytics are allowed for
   * this visitor (src/question-log.ts). Kept on the connection, so it survives hibernation.
   */
  onConnect(connection: Connection, ctx: ConnectionContext) {
    connection.setState({ logQuestions: ctx.request.headers.get(QUESTION_LOG_HEADER) === "1" });
  }

  afterTranscribe(transcript: string, connection: Connection): string | null {
    this.spokenTurns.set(connection.id, transcript);
    return transcript;
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    await this.scheduleExpiry();
    const spoken = this.spokenTurns.get(context.connection.id) === transcript;
    this.spokenTurns.delete(context.connection.id);
    // The question only (never the answer or audio), scrubbed; see src/question-log.ts.
    const allowed = (context.connection.state as { logQuestions?: boolean } | null)?.logQuestions === true;
    this.ctx.waitUntil(
      logQuestion(this.env, allowed, transcript, spoken ? "voice" : "typed")
        .catch((err) => console.error("[PortalVoiceAgent] question log failed:", err)),
    );
    const workersai = createWorkersAI({ binding: this.env.AI });
    // Spoken answers are read aloud, so their context has no page paths to read out.
    const system = voiceSystemPrompt(await this.buildLibraryContext(spoken), spoken);

    const history = context.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = streamText({
      model: workersai(LLM_MODEL),
      system,
      messages: [...history, { role: "user" as const, content: transcript }],
      // GPT-OSS spends part of its output budget on hidden reasoning. With the default budget, answers
      // over the full library data stopped mid-sentence, so set the budget and keep reasoning low:
      // the answers are short lookups in the data.
      maxOutputTokens: 1500,
      providerOptions: { "workers-ai": { reasoning_effort: "low" } },
      maxRetries: 1,
      abortSignal: context.signal,
      onError: (e) => console.error("[PortalVoiceAgent] LLM stream error:", e),
    });

    // Return the AI SDK `fullStream` (not `textStream`): @cloudflare/voice reads
    // the typed parts and speaks ONLY `text-delta` chunks, so GPT-OSS's reasoning
    // tokens are never sent to TTS. It also avoids the textStream chunk-joining bug.
    // Typed answers keep at most three links on their "Pages:" line; spoken answers have none.
    return spoken ? result.fullStream : capPageLinks(result.fullStream);
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

  /**
   * The library data for the prompt (src/voice-context.ts), cached in KV like the other cached
   * responses and cleared with them when an analysis is published (invalidate() in src/capture.ts).
   */
  private async buildLibraryContext(spoken: boolean): Promise<string> {
    return await cached(this.env, `cache:voice-context:${spoken ? "spoken" : "typed"}`, 300, async () => {
      const [portals, published] = await Promise.all([listPortals(this.env), publishedCaptures(this.env)]);
      return buildVoiceContext(portals, published, { links: !spoken, log: (msg) => console.warn(msg) });
    });
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

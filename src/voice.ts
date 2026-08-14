// Voice agent for the AI Portal Screenshot Library.
//
// Wraps the base `Agent` with the @cloudflare/voice pipeline: Workers AI does
// speech-to-text (Flux) and text-to-speech (Aura). `onTurn()` receives the
// user's transcribed question, queries the existing D1 tables (portals / weeks
// / captures) and returns a short spoken answer.
//
// The client connects over WebSocket to /agents/portal-voice-agent/<name>.
// (routeAgentRequest maps the kebab-case of the DO binding name -> URL segment,
//  and the client sends the kebab-case of this class name.)

import { Agent } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
  type VoiceTurnContext,
} from "@cloudflare/voice";
import type { Env, PortalRow, CaptureRow } from "./types";
import { listPortals, listWeeks, latestWeek } from "./db";

const VoiceAgent = withVoice(Agent);

export class PortalVoiceAgent extends VoiceAgent<Env> {
  // Workers AI providers — no extra API keys needed, both use the AI binding.
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string, _context: VoiceTurnContext): Promise<string> {
    const q = (transcript || "").toLowerCase().trim();
    if (!q) {
      return "I didn't catch that. You can ask me which portals we track, what's in the latest week, or about a specific site's brand colour.";
    }

    // Load the catalogue once per turn.
    const [portals, weeks] = await Promise.all([listPortals(this.env), listWeeks(this.env)]);

    // Intent checks run BEFORE a specific-portal match, so a phrase like
    // "which portals do you track?" isn't mistaken for the "you" (You.com) slug.

    // 1) greeting / help
    if (/^(hi|hey|hello|yo|help|what can you|who are you|what are you)\b/.test(q)) {
      return `Hi! I'm the AI Portal Library voice guide. I track weekly screenshots of ${portals.length} AI portals. You can ask me to list the portals, what's in the latest week, or about a specific site like ${portals[0]?.name ?? "OpenAI"}.`;
    }

    // 2) "how many portals"
    if (/how many (portals|sites|companies)/.test(q)) {
      return `I'm tracking ${portals.length} portal${portals.length === 1 ? "" : "s"} right now: ${this.joinNames(portals.map((p) => p.name))}.`;
    }

    // 3) how many weeks / history
    if (/how many weeks|history|how far back|archive/.test(q)) {
      return `There are ${weeks.length} capture week${weeks.length === 1 ? "" : "s"} on record, the newest being ${weeks[0]?.label ?? "unknown"}.`;
    }

    // 4) list portals
    if (/(list|which|what|show|name).*(portals?|sites?|companies|track)/.test(q) || /portals? (do|are|you|that)/.test(q)) {
      return `I track ${portals.length} AI portals: ${this.joinNames(portals.map((p) => p.name))}. Ask me about any one of them.`;
    }

    // 5) latest / this week
    if (/(latest|recent|this|current|newest).*(week|capture|update|shot)/.test(q) || /what'?s new/.test(q)) {
      const lw = await latestWeek(this.env);
      if (!lw) return "There aren't any captures recorded yet.";
      const wk = weeks.find((w) => w.week === lw);
      const label = wk?.label ?? lw;
      const count = wk?.portal_count ?? 0;
      return `The most recent capture week is ${label}, with ${count} portal${count === 1 ? "" : "s"} captured. Ask me about any of them, like ${portals[0]?.name ?? "one of the sites"}.`;
    }

    // 6) a specific portal mentioned? (match on name, company, or slug)
    const hit = this.matchPortal(q, portals);
    if (hit) return await this.describePortal(hit);

    // 7) fallback
    return `I can help you explore the AI Portal Library. Try asking which portals I track, what's in the latest week, or about a specific site such as ${this.joinNames(portals.slice(0, 3).map((p) => p.name))}.`;
  }

  // ---- helpers -----------------------------------------------------------

  private matchPortal(q: string, portals: PortalRow[]): PortalRow | null {
    // Common English words that also happen to be slugs — only match these when
    // the full name/company is said (e.g. "you.com"), never the bare word.
    const AMBIGUOUS = new Set(["you", "pi", "poe", "chat"]);
    // Prefer the longest whole-word match so "openai" beats "ai".
    let best: PortalRow | null = null;
    let bestLen = 0;
    for (const p of portals) {
      for (const cand of [p.name, p.company, p.slug]) {
        const c = (cand || "").toLowerCase().trim();
        if (c.length < 3) continue;
        if (AMBIGUOUS.has(c)) continue; // skip bare ambiguous slugs
        // Whole-word / phrase match, e.g. \bchatgpt\b or \byou\.com\b
        const re = new RegExp(`(^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
        if (re.test(q) && c.length > bestLen) {
          best = p;
          bestLen = c.length;
        }
      }
    }
    return best;
  }

  private async describePortal(p: PortalRow): Promise<string> {
    // Newest capture for this portal.
    const cap = await this.env.DB.prepare(
      `SELECT * FROM captures WHERE slug = ? AND status = 'ok' ORDER BY week DESC LIMIT 1`
    )
      .bind(p.slug)
      .first<CaptureRow>();

    if (!cap) {
      return `${p.name} is on the tracking list (${this.spellUrl(p.url)}), but I don't have a successful capture for it yet. Its brand colour is ${this.spellHex(p.brand)}.`;
    }

    const palette = this.parsePalette(cap.palette);
    const colourBit = palette.length
      ? ` The dominant palette is ${this.joinNames(palette.slice(0, 3).map((h) => this.spellHex(h)))}.`
      : p.brand
        ? ` Its brand colour is ${this.spellHex(p.brand)}.`
        : "";
    const analysisBit = cap.analysis ? ` ${this.trimSpoken(cap.analysis)}` : "";

    return `Here's ${p.name} from ${cap.week}.${colourBit}${analysisBit}`;
  }

  private parsePalette(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  private joinNames(names: string[]): string {
    const list = names.filter(Boolean);
    if (list.length <= 1) return list[0] ?? "";
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  }

  // Spell a hex colour so TTS reads it naturally, e.g. "#F97316" -> "hex F 9 7 3 1 6".
  private spellHex(hex: string): string {
    const h = (hex || "").replace(/^#/, "");
    return h ? `hex ${h.toUpperCase().split("").join(" ")}` : "an unknown colour";
  }

  private spellUrl(url: string): string {
    return (url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  // Keep spoken analysis short — first ~2 sentences, capped length.
  private trimSpoken(text: string): string {
    const clean = text.replace(/\s+/g, " ").trim();
    const sentences = clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    return sentences.length > 240 ? sentences.slice(0, 237) + "..." : sentences;
  }
}

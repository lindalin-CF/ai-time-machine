// The input area's model/mode selector, normalized for display. The name it shows ("Opus 5.5 High",
// "Gemini Auto", "Fast") is the model picked in that session, not a menu item, so every place that lists
// or compares N1 items sees it as one item, "model picker". captureMetrics() applies this, so the API
// (and the Analytics canvas), the portal timeline, /changes, the llms files and the voice guide all agree.
// Display-time only: published analysis data is never edited.

export const MODEL_PICKER_LABEL = "model picker";

/** Model families, matched at the start of a word ("GPT-6", "Qwen3.7-Plus", "Claude"). */
const MODEL_FAMILIES = ["gpt", "claude", "opus", "sonnet", "haiku", "gemini", "grok", "deepseek", "qwen", "kimi", "llama", "mistral"];
/** Model tiers and mode words, matched as whole words only ("Pro" but not "Projects", "Thinking" but not "Think"). */
const MODE_WORDS = ["flash", "pro", "ultra", "auto", "thinking", "extended", "instant", "fast", "model"];

const FAMILY_RE = new RegExp(`\\b(?:${MODEL_FAMILIES.join("|")})`, "i");
const MODE_RE = new RegExp(`\\b(?:${MODE_WORDS.join("|")})\\b`, "i");
/** OpenAI o-series: "o3", "o4-mini". */
const O_SERIES_RE = /\bo[1-9](?:-mini|-pro)?\b/i;
/** A version number: "5.5", "K3.1", "2.0", or a short letter+digit name such as "K2" or "R1". */
const VERSION_RE = /(?:\b[a-z]{0,2}\d+(?:\.\d+)+\b|\b[a-z]\d{1,2}\b)/i;

/**
 * Whether an input-area label reads as a model or mode name (for analyses without role "model_picker"):
 * a known model family or mode word and/or a version number, optionally followed by Low/Medium/High.
 */
export function looksLikeModelName(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  return FAMILY_RE.test(t) || MODE_RE.test(t) || O_SERIES_RE.test(t) || VERSION_RE.test(t);
}

/** An N1 item recorded as (or reading as) the input area's model picker. */
export function isModelPickerItem(it: { region?: unknown; label?: unknown; role?: unknown }): boolean {
  if (it.role === "model_picker") return true;
  return it.region === "input area" && typeof it.label === "string" && looksLikeModelName(it.label);
}

// The model/mode selector, normalized for display. The name it shows ("Opus 5.5 High", "Gemini Auto",
// "Fast") is the model picked in that session, not a menu item, so every place that lists or compares N1
// items sees it as one item, "model picker", in its region (usually the input area, sometimes the top bar). captureMetrics() applies this, so the API
// (and the Analytics canvas), the portal timeline, /changes, the llms files and the voice guide all agree.
// Display-time only: published analysis data is never edited.

export const MODEL_PICKER_LABEL = "model picker";

/** Model families, matched at the start of a word ("GPT-6", "Qwen3.7-Plus", "Claude"). */
const MODEL_FAMILIES = ["gpt", "claude", "opus", "sonnet", "haiku", "gemini", "grok", "deepseek", "qwen", "kimi", "llama", "mistral"];
/** Model tiers and mode words, matched as whole words only ("Pro" but not "Projects", "Thinking" but not "Think"). */
const MODE_WORDS = ["flash", "pro", "ultra", "auto", "thinking", "extended", "instant", "fast", "model"];

const FAMILY_RE = new RegExp(`\\b(?:${MODEL_FAMILIES.join("|")})`, "i");
const MODE_RE = new RegExp(`\\b(?:${MODE_WORDS.join("|")})\\b`, "i");
/** Plan tiers: on their own ("Pro", "Plus") they read as a plan badge, not a model picker. */
const PLAN_WORDS = ["pro", "plus", "max", "ultra"];
/** Words that only qualify a model name: "Low", "Mini", "Lite". */
const TIER_WORDS = ["low", "medium", "high", "mini", "lite", "large", "plus", "max"];
/** Mode words in labels kept in the original language ("自動" is Copilot's "Auto"). */
const CJK_MODE_WORDS = ["自動", "自动"];
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

/** Upgrade and promo wording: "Upgrade to Pro", "Try GPT-6", "Get the app". */
const PROMO_RE = /\b(?:upgrade|try|get|buy|subscribe|unlock|plan|free|trial|join|download|app)\b/i;
const NON_PLAN_MODE_RE = new RegExp(`\\b(?:${MODE_WORDS.filter((w) => !PLAN_WORDS.includes(w)).join("|")})\\b`, "i");

/**
 * Whether a label outside the input area reads as a model name ("Manus 2.0 Lite"), so Compare may pair it with a
 * model picker the other week shows in the same region: a model family, a mode word other than a plan tier, an
 * o-series name or a version number, and no upgrade or promo wording ("Upgrade to Pro", "Try Pro" never are).
 */
export function readsAsModelName(label: string): boolean {
  const t = label.trim();
  if (!t || PROMO_RE.test(t)) return false;
  return FAMILY_RE.test(t) || NON_PLAN_MODE_RE.test(t) || O_SERIES_RE.test(t) || VERSION_RE.test(t);
}

const NAME_WORD_RE = new RegExp(
  `^(?:(?:${MODEL_FAMILIES.join("|")})[\\w.-]*|${MODE_WORDS.filter((w) => !PLAN_WORDS.includes(w)).join("|")}|${CJK_MODE_WORDS.join("|")}|o[1-9](?:-mini|-pro)?|[a-z]{0,2}\\d+(?:\\.\\d+)+|[a-z]\\d{1,2})$`,
  "i",
);
/** Product names: on their own ("Gemini", "Grok") they are the product's title, not a model picker. */
const BRAND_ONLY_RE = new RegExp(`^(?:${MODEL_FAMILIES.filter((f) => !["opus", "sonnet", "haiku"].includes(f)).join("|")})$`, "i");
/** Tiers, and a bare number after a model name ("Claude Haiku 4 Low"). */
const QUALIFIER_RE = new RegExp(`^(?:${[...new Set([...PLAN_WORDS, ...TIER_WORDS])].join("|")}|\\d{1,2})$`, "i");

/**
 * Whether a whole label is just a model or mode name ("Auto", "自動", "GPT-6", "Fast", "Qwen3.7-Plus",
 * "Opus 5.5 High"): every word is a model family, mode word, version or tier, and at least one is not a plan
 * tier or a bare product name. Stricter than looksLikeModelName, for regions where other items are named too:
 * "Upgrade to Pro", "Try Pro", a lone "Pro" badge and a "Gemini" title are not model names.
 */
export function isModelNameOnly(label: string): boolean {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words.some((w) => NAME_WORD_RE.test(w) && !BRAND_ONLY_RE.test(w)) && words.every((w) => NAME_WORD_RE.test(w) || QUALIFIER_RE.test(w));
}

/**
 * An N1 item recorded as (or reading as) a model picker: role "model_picker" in any region, an input-area
 * label that reads as a model name, or a top-bar label that is only a model or mode name.
 */
export function isModelPickerItem(it: { region?: unknown; label?: unknown; role?: unknown }): boolean {
  if (it.role === "model_picker") return true;
  if (typeof it.label !== "string") return false;
  if (it.region === "input area") return looksLikeModelName(it.label);
  return it.region === "top bar" && isModelNameOnly(it.label);
}

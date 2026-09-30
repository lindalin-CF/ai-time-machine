// Guideline analysis (.claude/skills/portal-design-analysis/SKILL.md) validation and display rules.
// scripts/local-capture/analysis/validate.mjs duplicates validateAnalysis(); keep the two in sync.

export const MAX_ANALYSIS_BYTES = 64 * 1024;

// Terms that must never reach the public summary (guideline section 10.2).
const FORBIDDEN_SUMMARY: [RegExp, string][] = [
  [/\b[LHCD][1-7]\b/, "metric ID"],
  [/\bE[12]\b/, "evidence level (E1/E2)"],
  [/approx_/, "field value (approx_*)"],
  [/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/, "hex color"],
  [/WCAG/i, "WCAG reference"],
];

/** Early system-test weeks (migration 0007): kept on the site, but noindex and left out of the sitemap. */
export const SYSTEM_TEST_WEEKS: readonly string[] = ["2026-07-20", "2026-08-03", "2026-08-10"];

export const ANALYSIS_SOON = "Design analysis coming soon.";

type AnalysisFields = { analysis?: string | null; analysis_by?: string | null };

/**
 * Guideline analyses: shown on the page and also used in the meta description, search and voice.
 * Every analysis_by other than guideline-v* and system-test means "coming soon".
 */
export function isPublishedAnalysis(row: AnalysisFields): boolean {
  return !!row.analysis_by && row.analysis_by.startsWith("guideline-v") && !!row.analysis?.trim();
}

/** Text for the Design analysis section: guideline analyses plus the system-test note (page only). */
export function displayedAnalysis(row: AnalysisFields): string {
  const text = row.analysis?.trim() ?? "";
  if (isPublishedAnalysis(row) || (row.analysis_by === "system-test" && text)) return text;
  return ANALYSIS_SOON;
}

export const SUMMARY_DESCRIPTION_MAX = 160;

/** The fixed opening every summary starts with (guideline section 10), which says nothing page-specific. */
export const FIXED_SUMMARY_OPENING = /^This shows the (?:desktop|mobile) version of .+ for the week of \d{4}-\d{2}-\d{2}, before scrolling\.$/;

/** Sentences of a published analysis's summary, without the fixed opening. Empty when unpublished. */
function summarySentences(row: AnalysisFields & { analysis_json?: string | null }): string[] {
  if (!isPublishedAnalysis(row)) return [];
  let sentences: string[] = [];
  try {
    const parsed = JSON.parse(row.analysis_json || "null") as { summary_sentences?: { text?: unknown }[] } | null;
    sentences = (parsed?.summary_sentences ?? []).map((s) => (typeof s?.text === "string" ? s.text.trim() : "")).filter(Boolean);
  } catch { /* fall back to the summary text */ }
  if (!sentences.length) sentences = row.analysis!.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences[0] && FIXED_SUMMARY_OPENING.test(sentences[0]) ? sentences.slice(1) : sentences;
}

/**
 * Search description from a published guideline analysis: the summary sentences after the fixed
 * opening, as many as fit, always shorter than SUMMARY_DESCRIPTION_MAX and ending at a sentence end.
 * Null when there is no published analysis or the first of those sentences alone is too long.
 */
export function summaryDescription(row: AnalysisFields & { analysis_json?: string | null }): string | null {
  let out = "";
  for (const s of summarySentences(row)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length >= SUMMARY_DESCRIPTION_MAX) break;
    out = next;
  }
  return out || null;
}

/** RSS description: the whole summary without the fixed opening (the item title names the portal and week). */
export function feedSummary(row: AnalysisFields & { analysis_json?: string | null }): string {
  return summarySentences(row).join(" ") || (row.analysis ?? "").trim();
}

/** Returns the first reason the analysis is invalid, or null when it passes. */
export function validateAnalysis(a: unknown, slug: string, week: string): string | null {
  if (!a || typeof a !== "object" || Array.isArray(a)) return "analysis must be a JSON object";
  const o = a as Record<string, unknown>;

  const bytes = new TextEncoder().encode(JSON.stringify(o)).length;
  if (bytes > MAX_ANALYSIS_BYTES) return `analysis JSON is ${bytes} bytes (max ${MAX_ANALYSIS_BYTES})`;

  if (typeof o.guideline_version !== "string" || !o.guideline_version.trim()) return "guideline_version is required";
  if (o.portal !== slug) return `analysis.portal (${JSON.stringify(o.portal)}) does not match slug "${slug}"`;
  if (o.week !== week) return `analysis.week (${JSON.stringify(o.week)}) does not match week "${week}"`;
  if (o.variant !== "desktop") return `analysis.variant must be "desktop"`;

  if (o.status === "not_analyzable") return null;
  if (o.status !== "ok") return `status must be "ok" or "not_analyzable"`;

  const summary = o.summary;
  if (typeof summary !== "string" || !summary.trim()) return "summary is required when status is ok";
  const sentences = o.summary_sentences;
  if (!Array.isArray(sentences) || !sentences.length) return "summary_sentences is required when status is ok";
  const texts: string[] = [];
  for (const [i, s] of sentences.entries()) {
    const text = (s as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || !text.trim()) return `summary_sentences[${i}].text is empty`;
    texts.push(text);
  }
  if (summary !== texts.join(" ")) return "summary must equal summary_sentences texts joined by single spaces";

  if (!/^[\x20-\x7E]*$/.test(summary)) return "summary must be plain English (printable ASCII only)";
  if (texts.length < 5 || texts.length > 9) return `summary has ${texts.length} sentences (must be 5 to 9)`;
  for (const [i, t] of texts.entries()) {
    const words = t.trim().split(/\s+/).length;
    if (words > 20) return `summary sentence ${i + 1} has ${words} words (max 20)`;
  }
  for (const [re, label] of FORBIDDEN_SUMMARY) {
    const m = summary.match(re);
    if (m) return `summary contains a ${label}: "${m[0]}"`;
  }
  return null;
}

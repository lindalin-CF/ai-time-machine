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

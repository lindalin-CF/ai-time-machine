// Duplicate of validateAnalysis() in src/analysis.ts (the Worker version used by POST /api/analysis).
// Keep the two in sync: publish.mjs runs this first so bad JSON never reaches the Worker.

export const MAX_ANALYSIS_BYTES = 64 * 1024;

const FORBIDDEN_SUMMARY = [
  [/\b[LHCD][1-7]\b/, "metric ID"],
  [/\bE[12]\b/, "evidence level (E1/E2)"],
  [/approx_/, "field value (approx_*)"],
  [/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/, "hex color"],
  [/WCAG/i, "WCAG reference"],
];

/** Returns the first reason the analysis is invalid, or null when it passes. */
export function validateAnalysis(a, slug, week) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return "analysis must be a JSON object";

  const bytes = Buffer.byteLength(JSON.stringify(a), "utf8");
  if (bytes > MAX_ANALYSIS_BYTES) return `analysis JSON is ${bytes} bytes (max ${MAX_ANALYSIS_BYTES})`;

  if (typeof a.guideline_version !== "string" || !a.guideline_version.trim()) return "guideline_version is required";
  if (a.portal !== slug) return `analysis.portal (${JSON.stringify(a.portal)}) does not match slug "${slug}"`;
  if (a.week !== week) return `analysis.week (${JSON.stringify(a.week)}) does not match week "${week}"`;
  if (a.variant !== "desktop") return `analysis.variant must be "desktop"`;

  if (a.status === "not_analyzable") return null;
  if (a.status !== "ok") return `status must be "ok" or "not_analyzable"`;

  const summary = a.summary;
  if (typeof summary !== "string" || !summary.trim()) return "summary is required when status is ok";
  const sentences = a.summary_sentences;
  if (!Array.isArray(sentences) || !sentences.length) return "summary_sentences is required when status is ok";
  const texts = [];
  for (const [i, s] of sentences.entries()) {
    const text = s?.text;
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

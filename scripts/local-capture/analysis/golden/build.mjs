#!/usr/bin/env node
/**
 * Build the golden set: 15 published analyses, split into sentences for hand labelling (review.html).
 * Local only: no network, nothing uploaded. Screenshot paths come from the redaction ledger and are always
 * the redacted file, never an original.
 *
 * USAGE (from scripts/local-capture/):
 *   node analysis/golden/build.mjs --published <dir>
 *     <dir> holds <week>.json files saved from GET /api/captures?week=<week> (the live site's public text).
 *     Each item's summary must equal the published text, or it is skipped.
 *
 * Writes analysis/golden/<slug>-<week>.json. An existing file is never overwritten (it may hold labels).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../../..");
const WORK = resolve(__dirname, "../work");
const LEDGER = join(homedir(), "AI-Surface-Archive", "redaction-ledger.json");

// Which analyses, and why. `file` is the local JSON whose summary matched the published text on 2026-10-25.
export const SELECTION = [
  { slug: "chatgpt", week: "2026-10-19", file: "analysis.json", why: "menu items removed (N1); promotional card ranks first" },
  { slug: "chatgpt", week: "2026-09-28", file: "analysis-v1.4.json", why: "confounded week: promotional card disappeared (4 possibly_confounded changes)" },
  { slug: "claude", week: "2026-10-19", file: "analysis.json", why: "guideline 1.6.0 model picker; placeholder contrast change" },
  { slug: "claude", week: "2026-08-24", file: "analysis.json", why: "early guideline 1.4 analysis, no comparison" },
  { slug: "gemini", week: "2026-10-19", file: "analysis.json", why: "confounded week: rotating heading and button (4 possibly_confounded)" },
  { slug: "gemini", week: "2026-09-07", file: "analysis.json", why: "icon-only sidebar rail" },
  { slug: "grok", week: "2026-10-12", file: "analysis.json", why: "confounded week: promo card and cookie banner (3 possibly_confounded)" },
  { slug: "grok", week: "2026-08-17", file: "analysis.json", why: "first guideline week" },
  { slug: "meta-ai", week: "2026-10-19", file: "analysis.json", why: "topic chip text change" },
  { slug: "meta-ai", week: "2026-09-21", file: "analysis.json", why: "guideline 1.3 analysis with suggested prompts" },
  { slug: "mistral", week: "2026-09-28", file: "analysis.json", why: "confounded week: onboarding pop-up (5 possibly_confounded)" },
  { slug: "perplexity", week: "2026-10-12", file: "analysis.json", why: "confounded week: onboarding card (4 possibly_confounded); section renamed" },
  { slug: "qwen", week: "2026-08-24", file: "analysis.json", why: "Chinese interface, translated text" },
  { slug: "pi", week: "2026-09-28", file: "analysis.json", why: "confounded week: activity card (4 possibly_confounded)" },
  { slug: "muse", week: "2026-10-12", file: "analysis.json", why: "open conversation portal (section 1.1); 2 possibly_confounded" },
];

const sha1 = (file) => createHash("sha1").update(readFileSync(file)).digest("hex");

/** The ledger's redacted desktop file for slug/week, checked against the ledger hashes; null if none. */
export function redactedShot(ledger, slug, week) {
  const row = ledger.images.find((r) => r.slug === slug && r.week === week && r.variant === "desktop");
  if (!row || row.result !== "redacted" || !row.redacted_file) return { path: null, reason: row ? `ledger result "${row.result}" (no redacted file)` : "not in the redaction ledger" };
  const rel = row.redacted_file;
  if (/(^|\/)(original[^/]*|current|previous)(\.[^/]*)?\.png$/.test(rel)) return { path: null, reason: "ledger path looks like an original" };
  const abs = join(REPO, rel);
  if (!existsSync(abs)) return { path: null, reason: "redacted file missing on disk" };
  const h = sha1(abs);
  if (h === row.original_sha1) return { path: null, reason: "file matches the original's SHA-1" };
  if (h !== row.redacted_sha1 && !(row.previous_redacted_sha1 ?? []).includes(h)) return { path: null, reason: "file doesn't match the ledger's redacted SHA-1" };
  return { path: rel, sha1: h };
}

function main() {
  const at = process.argv.indexOf("--published");
  const pubDir = at > 0 ? process.argv[at + 1] : null;
  if (!pubDir) { console.error("usage: node analysis/golden/build.mjs --published <dir with <week>.json captures>"); process.exit(1); }
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));

  for (const s of SELECTION) {
    const out = join(__dirname, `${s.slug}-${s.week}.json`);
    if (existsSync(out)) { console.log(`· ${relative(REPO, out)} exists; kept (may hold labels)`); continue; }
    const a = JSON.parse(readFileSync(join(WORK, s.slug, s.week, s.file), "utf8"));
    const captures = JSON.parse(readFileSync(join(pubDir, `${s.week}.json`), "utf8")).captures;
    const published = captures.find((c) => c.slug === s.slug)?.analysis;
    if (published !== a.summary) { console.log(`✗ ${s.slug} ${s.week}: local summary doesn't match the published text; skipped`); continue; }
    const shot = redactedShot(ledger, s.slug, s.week);
    if (!shot.path) { console.log(`✗ ${s.slug} ${s.week}: ${shot.reason}; skipped`); continue; }
    let previousWeek = a.previous_week;
    if (previousWeek === undefined) {
      try { previousWeek = JSON.parse(readFileSync(join(WORK, s.slug, s.week, "input.json"), "utf8")).previous_week; } catch { previousWeek = null; }
    }
    const prevShot = previousWeek ? redactedShot(ledger, s.slug, previousWeek) : { path: null, reason: "no previous week" };
    const changes = (a.changes_vs_previous ?? []).map((c) => ({ id: c.id, change: c.change ?? null, status: c.status }));

    const item = {
      id: `${s.slug}-${s.week}`,
      slug: s.slug,
      portal: captures.find((c) => c.slug === s.slug)?.portal ?? s.slug,
      week: s.week,
      previous_week: previousWeek ?? null,
      guideline_version: a.guideline_version,
      why_selected: s.why,
      analysis_file: relative(REPO, join(WORK, s.slug, s.week, s.file)),
      published_check: "summary equals the live site's published text (GET /api/captures, 2026-10-25)",
      screenshot: { redacted: shot.path, sha1: shot.sha1 },
      previous_screenshot: prevShot.path ? { redacted: prevShot.path, sha1: prevShot.sha1 } : { redacted: null, reason: prevShot.reason },
      changes_vs_previous: changes,
      sentences: a.summary_sentences.map((x, i) => ({ index: i + 1, text: x.text, sources: x.sources ?? [], label: "", note: "" })),
    };
    writeFileSync(out, JSON.stringify(item, null, 2) + "\n", { flag: "wx" });
    console.log(`✓ ${relative(REPO, out)}  ${item.sentences.length} sentences`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

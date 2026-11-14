#!/usr/bin/env node
/**
 * Validate and upload a guideline analysis to the Worker (POST /api/analysis).
 *
 * USAGE:
 *   export UPLOAD_TOKEN=...
 *   node analysis/publish.mjs <slug> <week>                 # the analysis only
 *   node analysis/publish.mjs <slug> <week> --visual        # the analysis, then its approved before/after visual
 *   node analysis/publish.mjs <slug> <week> --visual-only   # only the visual (the analysis is already published)
 *
 * A visual (analysis/visual.mjs, visual.png + visual.json) is uploaded ONLY with --visual or --visual-only, which the
 * main agent passes only for slugs the user approved with "visual <slug>" AND then "publish …" in the current
 * conversation. A visual.json lying in the work folder never approves anything on its own.
 *
 * Sends UPLOAD_TOKEN with every request (never printed). Afterwards it checks, with the token, whether the capture
 * is still held: its analysis stays off the site until /release-week releases the week.
 *
 * Reads analysis/work/<slug>/<week>/analysis.json. Refuses to upload when:
 *   - the JSON fails the same validation the Worker runs (validate.mjs), or
 *   - any term from analysis/private-terms.txt (one per line, case-insensitive) appears anywhere in it.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WORKER_URL, UPLOAD_TOKEN } from "../config.mjs";
import { validateAnalysis } from "./validate.mjs";
import { uploadVisual } from "./visual.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TERMS_FILE = join(__dirname, "private-terms.txt");

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const USAGE = "usage: node analysis/publish.mjs <slug> <week> [--visual | --visual-only]";

/**
 * Parse the arguments. `analysis` and `visual` say what to upload; the visual is never uploaded unless a visual flag
 * is given explicitly. Returns { error } for anything else.
 */
export function parsePublishArgs(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const [slug, week, ...extra] = argv.filter((a) => !a.startsWith("--"));
  if (!slug || !week || extra.length) return { error: USAGE };
  const unknown = flags.filter((f) => f !== "--visual" && f !== "--visual-only");
  if (unknown.length) return { error: `unknown option ${unknown[0]}\n${USAGE}` };
  if (flags.includes("--visual") && flags.includes("--visual-only")) return { error: "use --visual or --visual-only, not both" };
  const visualOnly = flags.includes("--visual-only");
  return { slug, week, analysis: !visualOnly, visual: visualOnly || flags.includes("--visual") };
}

async function publishVisual(slug, week) {
  try {
    const r = await uploadVisual({ slug, week, token: UPLOAD_TOKEN, site: WORKER_URL });
    console.log(`✓ visual ${slug} ${week} → ${WORKER_URL}/weeks/${week}#${slug}${r.archived ? ` (earlier visual archived to ${r.archived})` : ""}`);
  } catch (e) {
    fail(`visual not uploaded: ${e.message}`);
  }
}

async function main() {
  const args = parsePublishArgs(process.argv.slice(2));
  if (args.error) fail(args.error);
  const { slug, week } = args;
  if (!UPLOAD_TOKEN) fail("Set UPLOAD_TOKEN first:  export UPLOAD_TOKEN=<the value you gave `wrangler secret put UPLOAD_TOKEN`>");
  if (!args.analysis) return await publishVisual(slug, week);

  const file = join(__dirname, "work", slug, week, "analysis.json");
  if (!existsSync(file)) fail(`missing ${file}`);
  let analysis;
  try { analysis = JSON.parse(await readFile(file, "utf8")); } catch (e) { fail(`${file} is not valid JSON: ${e.message}`); }

  const reason = validateAnalysis(analysis, slug, week);
  if (reason) fail(`validation failed: ${reason}`);

  // Privacy check (guideline section 2): no account-specific term may appear anywhere in the JSON.
  if (!existsSync(TERMS_FILE)) {
    fail(`missing ${TERMS_FILE}\n  Create it (copy private-terms.example.txt) with one private term per line:\n  your name, email, organisation, workspace, custom agent names, etc.`);
  }
  const terms = (await readFile(TERMS_FILE, "utf8"))
    .split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  if (!terms.length) fail(`${TERMS_FILE} has no terms; add at least one line`);
  const haystack = JSON.stringify(analysis).toLowerCase();
  const hits = terms.filter((t) => haystack.includes(t.toLowerCase()));
  if (hits.length) fail(`privacy check failed: ${hits.length} private term(s) found in analysis.json (line(s) ${hits.map((t) => terms.indexOf(t) + 1).join(", ")} of private-terms.txt)`);

  const auth = { authorization: `Bearer ${UPLOAD_TOKEN}` };
  const res = await fetch(`${WORKER_URL}/api/analysis`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ slug, week, analysis }),
  });
  const text = await res.text();
  if (!res.ok) fail(`POST /api/analysis -> ${res.status} ${text}`);
  console.log(`✓ published ${slug} ${week} (${analysis.status}) → ${WORKER_URL}/portals/${slug}/${week}`);

  // A held capture's analysis is stored but not shown until the week is released.
  const caps = await fetch(`${WORKER_URL}/api/captures?week=${encodeURIComponent(week)}`, { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (caps?.captures?.find((c) => c.slug === slug)?.held) console.log(`⚠ ${slug} ${week} is still held: it appears on the site after /release-week ${week}`);

  if (args.visual) await publishVisual(slug, week);
  else if (existsSync(join(__dirname, "work", slug, week, "visual.json"))) console.log(`· visual.json exists but was not uploaded (only --visual uploads an approved visual)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

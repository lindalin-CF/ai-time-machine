#!/usr/bin/env node
/**
 * Validate and upload a guideline analysis to the Worker (POST /api/analysis).
 *
 * USAGE:
 *   export UPLOAD_TOKEN=...
 *   node analysis/publish.mjs <slug> <week>
 *
 * Reads analysis/work/<slug>/<week>/analysis.json. Refuses to upload when:
 *   - the JSON fails the same validation the Worker runs (validate.mjs), or
 *   - any term from analysis/private-terms.txt (one per line, case-insensitive) appears anywhere in it.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_URL, UPLOAD_TOKEN } from "../config.mjs";
import { validateAnalysis } from "./validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TERMS_FILE = join(__dirname, "private-terms.txt");

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

async function main() {
  const [slug, week] = process.argv.slice(2);
  if (!slug || !week) fail("usage: node analysis/publish.mjs <slug> <week>");
  if (!UPLOAD_TOKEN) fail("Set UPLOAD_TOKEN first:  export UPLOAD_TOKEN=<the value you gave `wrangler secret put UPLOAD_TOKEN`>");

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

  const res = await fetch(`${WORKER_URL}/api/analysis`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${UPLOAD_TOKEN}` },
    body: JSON.stringify({ slug, week, analysis }),
  });
  const text = await res.text();
  if (!res.ok) fail(`POST /api/analysis -> ${res.status} ${text}`);
  console.log(`✓ published ${slug} ${week} (${analysis.status}) → ${WORKER_URL}/portals/${slug}/${week}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

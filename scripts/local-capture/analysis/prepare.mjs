#!/usr/bin/env node
/**
 * Gather the inputs for a guideline design analysis (.claude/skills/portal-design-analysis/SKILL.md).
 *
 * USAGE:
 *   export UPLOAD_TOKEN=...                  # needed to fetch the previous week's analysis JSON
 *   node analysis/prepare.mjs <slug> [week]  # week defaults to the latest week with a desktop capture
 *
 * Writes analysis/work/<slug>/<week>/:
 *   current.png    desktop screenshot for <week>
 *   previous.png   desktop screenshot for the nearest older week (if any)
 *   previous.json  that week's stored analysis JSON (if any)
 *   input.json     { portal, company, slug, week, previous_week }
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_URL, UPLOAD_TOKEN } from "../config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getJson(path, auth = false) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: auth ? { authorization: `Bearer ${UPLOAD_TOKEN}` } : {},
  });
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}

/** Desktop capture (real screenshot, not a sample asset) for slug in week, or null. */
async function desktopCapture(slug, week) {
  const r = await getJson(`/api/captures?week=${encodeURIComponent(week)}`);
  if (r.status !== 200) throw new Error(`GET /api/captures?week=${week} -> ${r.status}`);
  const c = r.body.captures.find((x) => x.slug === slug);
  return c && c.status === "ok" && !c.sample ? c : null;
}

async function download(path, file) {
  const res = await fetch(`${WORKER_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const [slug, weekArg] = process.argv.slice(2);
  if (!slug) { console.error("usage: node analysis/prepare.mjs <slug> [week]"); process.exit(1); }
  if (weekArg && !/^\d{4}-\d{2}-\d{2}$/.test(weekArg)) { console.error(`✗ week must be YYYY-MM-DD (got "${weekArg}")`); process.exit(1); }

  const w = await getJson("/api/weeks");
  if (w.status !== 200) throw new Error(`GET /api/weeks -> ${w.status}`);
  const weeks = w.body.weeks.map((x) => x.week).sort().reverse(); // newest first

  // Current week: the requested one, or the newest week that has a desktop capture for this slug.
  let week = weekArg || null;
  let current = null;
  if (week) {
    current = await desktopCapture(slug, week);
  } else {
    for (const wk of weeks) {
      current = await desktopCapture(slug, wk);
      if (current) { week = wk; break; }
    }
  }
  if (!current) { console.error(`✗ no desktop capture for ${slug}${week ? ` in week ${week}` : ""}`); process.exit(1); }

  // Previous week: the nearest older week with a desktop capture.
  let previousWeek = null;
  let previous = null;
  for (const wk of weeks.filter((x) => x < week)) {
    previous = await desktopCapture(slug, wk);
    if (previous) { previousWeek = wk; break; }
  }

  const dir = join(__dirname, "work", slug, week);
  await mkdir(dir, { recursive: true });
  // Clear inputs from an earlier run so stale previous-week files are never reused.
  await Promise.all(["previous.png", "previous.json"].map((f) => rm(join(dir, f), { force: true })));

  await download(current.image, join(dir, "current.png"));
  console.log(`✓ current.png   ${slug} ${week}`);

  if (previous) {
    await download(previous.image, join(dir, "previous.png"));
    console.log(`✓ previous.png  ${slug} ${previousWeek}`);
    if (!UPLOAD_TOKEN) {
      console.log("⚠ UPLOAD_TOKEN not set; skipping previous.json");
    } else {
      const a = await getJson(`/api/analysis?slug=${encodeURIComponent(slug)}&week=${encodeURIComponent(previousWeek)}`, true);
      if (a.status === 200 && a.body.analysis) {
        await writeFile(join(dir, "previous.json"), JSON.stringify(a.body.analysis, null, 2) + "\n");
        console.log(`✓ previous.json (guideline v${a.body.analysis_version})`);
      } else if (a.status === 200) {
        console.log("· no stored analysis for the previous week");
      } else {
        console.log(`⚠ GET /api/analysis -> ${a.status} ${typeof a.body === "string" ? a.body : ""}`);
      }
    }
  } else {
    console.log("· no previous week with a desktop capture");
  }

  const input = { portal: current.portal, company: current.company, slug, week, previous_week: previousWeek };
  await writeFile(join(dir, "input.json"), JSON.stringify(input, null, 2) + "\n");
  console.log(`✓ input.json\n→ ${dir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

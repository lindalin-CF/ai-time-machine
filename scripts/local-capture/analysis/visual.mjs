#!/usr/bin/env node
/**
 * Before/after comparison images ("visuals") for the weekly digest (src/visuals.ts).
 *
 * A visual is one PNG: the same region cropped from the previous week's and this week's redacted desktop screenshots,
 * stacked (before on top) with a "Before · Nov 2" / "After · Nov 9" chip on each half and a thin neutral gap between
 * them. It is rendered from an HTML template with Playwright, so the chips use the site's font (Afacad).
 *
 * Approval (CLAUDE.md "Weekly order", .claude/commands/analyze-week.md):
 *   preview  /analyze-week suggests a visual: a local preview only, in the gitignored work folder. Never uploads.
 *   build    Only after the user replies "visual <slug>" in the current conversation (--approved says so explicitly).
 *            Re-downloads both screenshots from the public site WITHOUT the upload token (so a held capture is a 404),
 *            and checks each against the redaction ledger (the redacted upload, or an original reviewed as "no change").
 *   upload   Only from publish.mjs --visual / --visual-only, after the user replies "publish …" for that slug.
 * No subagent, file or earlier session can approve a visual: these steps are run by the main agent only.
 *
 * USAGE (from scripts/local-capture/):
 *   node analysis/visual.mjs preview <slug> <week> --before x,y,w,h [--after x,y,w,h] --sentence "<change sentence>"
 *   node analysis/visual.mjs build <slug> <week> --approved
 *
 * Files in analysis/work/<slug>/<week>/ (never overwritten: an earlier image is renamed with a UTC timestamp first):
 *   visual-preview.png, visual-suggestion.json   (preview)
 *   visual.png, visual.json                      (build)
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keepExisting, writeKeepingOld, utcStamp } from "./keep-existing.mjs";
import { writeNew } from "./upload-redacted.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const WORK = join(__dirname, "work");
const BUCKET = "ai-portal-shots";
const DEFAULT_SITE = "https://ai-portal-library.monthtest970509.workers.dev";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Site style: page background, line colour, ink and soft ink (src/portal-page.ts). */
export const STYLE = { gap: 6, gapColor: "#f4efe8", chipBg: "#f4efe8", chipBorder: "#d8cfc2", ink: "#231f1a", soft: "#6b6257" };

/** "2026-11-02" -> "Nov 2". */
export function chipDate(week) {
  const m = WEEK_RE.exec(week) && week.split("-").map(Number);
  if (!m) throw new Error(`week must be YYYY-MM-DD (got "${week}")`);
  return `${MONTHS[m[1] - 1]} ${m[2]}`;
}

/** "x,y,w,h" -> [x, y, w, h] (non-negative integers, w and h at least 40). */
export function parseBox(s) {
  const parts = String(s ?? "").split(",").map((p) => p.trim());
  const n = parts.map(Number);
  if (parts.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0)) throw new Error(`crop box must be x,y,w,h in pixels (got "${s}")`);
  if (n[2] < 40 || n[3] < 40) throw new Error(`crop box is too small (got "${s}")`);
  return n;
}

/** PNG width and height from the IHDR chunk. */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Throws unless the box lies inside the image. */
export function checkBoxInside(box, size, label) {
  const [x, y, w, h] = box;
  if (x + w > size.width || y + h > size.height) throw new Error(`${label} crop box ${box.join(",")} is outside the ${size.width} x ${size.height} screenshot`);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * The HTML template: two halves stacked, previous on top, each a window onto its screenshot at 1:1, with a chip in the
 * top-left corner. Both boxes must have the same width; heights may differ.
 */
export function visualHtml({ before, after, fontDataUrl }) {
  if (before.box[2] !== after.box[2]) throw new Error(`the two crop boxes must have the same width (${before.box[2]} vs ${after.box[2]})`);
  const width = before.box[2];
  const half = (h, cls) => {
    const [x, y, w, hh] = h.box;
    return `<div class="half ${cls}" style="width:${w}px;height:${hh}px;background-image:url(${h.dataUrl});background-position:-${x}px -${y}px;background-size:${h.size.width}px ${h.size.height}px">`
      + `<span class="chip"><b>${esc(h.word)}</b> · <span class="when">${esc(h.date)}</span></span></div>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontDataUrl ? `@font-face{font-family:'Afacad';font-style:normal;font-weight:400 700;src:url(${fontDataUrl}) format('woff2')}` : ""}
html,body{margin:0;padding:0;background:${STYLE.gapColor}}
.visual{display:flex;flex-direction:column;gap:${STYLE.gap}px;width:${width}px;background:${STYLE.gapColor}}
.half{position:relative;overflow:hidden;background-repeat:no-repeat;image-rendering:pixelated}
.chip{position:absolute;left:12px;top:8px;display:inline-flex;align-items:center;gap:5px;padding:4px 11px 5px;border-radius:999px;
  background:${STYLE.chipBg};border:1px solid ${STYLE.chipBorder};color:${STYLE.ink};box-shadow:0 1px 3px rgba(0,0,0,.22);
  font:600 13px/16px 'Afacad',system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap}
.chip b{font-weight:700}
.chip .when{color:${STYLE.soft}}
</style></head><body><div class="visual">${half(before, "before")}${half(after, "after")}</div></body></html>`;
}

/** Render the visual with Playwright (headless Chromium). Returns the PNG bytes. */
export async function renderVisual({ beforePng, afterPng, beforeBox, afterBox, previousWeek, week }) {
  const beforeSize = pngSize(beforePng), afterSize = pngSize(afterPng);
  checkBoxInside(beforeBox, beforeSize, "before");
  checkBoxInside(afterBox, afterSize, "after");
  const font = readFileSync(join(REPO_ROOT, "public/fonts/afacad-latin.woff2"));
  const html = visualHtml({
    fontDataUrl: `data:font/woff2;base64,${font.toString("base64")}`,
    before: { box: beforeBox, size: beforeSize, dataUrl: `data:image/png;base64,${beforePng.toString("base64")}`, word: "Before", date: chipDate(previousWeek) },
    after: { box: afterBox, size: afterSize, dataUrl: `data:image/png;base64,${afterPng.toString("base64")}`, word: "After", date: chipDate(week) },
  });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const height = beforeBox[3] + afterBox[3] + STYLE.gap;
    const page = await browser.newPage({ viewport: { width: beforeBox[2], height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; });
    const loaded = await page.evaluate(() => document.fonts.check("600 13px Afacad"));
    if (!loaded) throw new Error("the Afacad font did not load");
    return await page.locator(".visual").screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

/**
 * Whether a portal-week may get a visual at all: a published-style analysis ("ok") with at least one change recorded
 * as "changed" against a previous week, and the same account plan in both weeks. Returns a reason, or null.
 * (Rotating content and other judgement calls are for the reviewer; this only enforces what the files can show.)
 */
export function candidateProblem(analysis, input) {
  if (!analysis) return "analysis.json is missing";
  if (analysis.status !== "ok") return `the analysis status is "${analysis.status}"`;
  if (!analysis.previous_week) return "the analysis has no previous week";
  const changes = Array.isArray(analysis.changes_vs_previous) ? analysis.changes_vs_previous : [];
  if (!changes.some((c) => c?.status === "changed")) return "no change is recorded as \"changed\" (only possibly confounded or none)";
  if (input?.plan && input?.previous_plan && input.plan !== input.previous_plan) return `the account plan changed (${input.previous_plan} -> ${input.plan}), so differences are not product changes`;
  return null;
}

/** The change sentence (the visual's alt text): one line, 10-400 characters. */
export function checkSentence(s) {
  const t = String(s ?? "").trim();
  if (t.length < 10 || t.length > 400 || /[\r\n]/.test(t)) throw new Error("--sentence must be the change sentence: one line, 10-400 characters");
  return t;
}

/** Private terms (analysis/private-terms.txt) found in `text`, as 1-based line numbers. Never returns the terms. */
export function privateTermLines(text, termsFile = join(__dirname, "private-terms.txt")) {
  if (!existsSync(termsFile)) throw new Error("analysis/private-terms.txt is missing");
  const terms = readFileSync(termsFile, "utf8").split(/\r?\n/).map((t) => t.trim());
  const hay = text.toLowerCase();
  return terms.map((t, i) => [t, i + 1]).filter(([t]) => t && hay.includes(t.toLowerCase())).map(([, n]) => n);
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/** Step 1 (/analyze-week): a local preview from the work folder's current.png / previous.png. Uploads nothing. */
export async function preview({ slug, week, before, after, sentence, work = WORK, render = renderVisual, termsFile }) {
  const dir = join(work, slug, week);
  const analysis = readJson(join(dir, "analysis.json"));
  const input = readJson(join(dir, "input.json"));
  const problem = candidateProblem(analysis, input);
  if (problem) throw new Error(`no visual for ${slug} ${week}: ${problem}`);
  const alt = checkSentence(sentence);
  const hits = privateTermLines(alt, termsFile);
  if (hits.length) throw new Error(`the sentence contains private term(s), private-terms.txt line(s) ${hits.join(", ")}`);
  const beforeBox = parseBox(before), afterBox = parseBox(after ?? before);
  const beforePng = await readFile(join(dir, "previous.png"));
  const afterPng = await readFile(join(dir, "current.png"));
  const png = await render({ beforePng, afterPng, beforeBox, afterBox, previousWeek: analysis.previous_week, week });
  const file = join(dir, "visual-preview.png");
  await writeKeepingOld(file, png);
  const suggestion = {
    slug, week, previous_week: analysis.previous_week, alt, before_box: beforeBox, after_box: afterBox,
    labels: [`Before · ${chipDate(analysis.previous_week)}`, `After · ${chipDate(week)}`],
    preview: file, preview_sha1: sha1(png), before_sha1: sha1(beforePng), after_sha1: sha1(afterPng), created_at: new Date().toISOString(),
  };
  await keepExisting(join(dir, "visual-suggestion.json"));
  await writeFile(join(dir, "visual-suggestion.json"), JSON.stringify(suggestion, null, 2) + "\n");
  return { file, suggestion, size: pngSize(png) };
}

/**
 * The ledger check for "only from redacted images": the public bytes must equal a desktop row's redacted upload
 * (result "redacted", upload_status "uploaded"), or the original of a row reviewed as "no change". Returns a reason or null.
 */
export function ledgerProblem(ledger, slug, week, bytes) {
  const rows = (ledger?.images ?? []).filter((r) => r.slug === slug && r.week === week && r.variant === "desktop");
  if (!rows.length) return `no redaction ledger row for ${slug} ${week} desktop: run /redact-week ${week} first`;
  const sum = sha1(bytes);
  const ok = rows.some((r) => (r.result === "redacted" && r.upload_status === "uploaded" && r.redacted_sha1 === sum)
    || (r.result === "no change" && r.original_sha1 === sum));
  return ok ? null : `the public ${slug} ${week} desktop screenshot (sha1 ${sum.slice(0, 12)}…) is not the redacted image in the ledger`;
}

/** The public desktop screenshot for slug/week, fetched WITHOUT the upload token: a held capture is not listed (or a 404). */
async function publicDesktop(site, slug, week, fetchFn) {
  const res = await fetchFn(`${site}/api/captures?week=${encodeURIComponent(week)}`);
  if (!res.ok) throw new Error(`GET /api/captures?week=${week} -> ${res.status}`);
  const c = (await res.json()).captures?.find((x) => x.slug === slug);
  if (!c || c.status !== "ok" || c.sample) throw new Error(`${slug} ${week} has no public desktop capture (held or missing): release it first`);
  const img = await fetchFn(`${site}${c.image}`);
  if (!img.ok) throw new Error(`GET ${c.image} -> ${img.status}: the capture is not public`);
  return Buffer.from(await img.arrayBuffer());
}

/**
 * Step 2: the final image, only after the user replied "visual <slug>" in the current conversation. Uses the crop and
 * sentence from visual-suggestion.json and the public, redacted screenshots.
 */
export async function build({ slug, week, approved, work = WORK, site = process.env.WORKER_URL || DEFAULT_SITE, fetchFn = fetch, render = renderVisual,
  ledgerFile = join(process.env.ARCHIVE_DIR || join(homedir(), "AI-Surface-Archive"), "redaction-ledger.json") }) {
  if (approved !== true) throw new Error("build needs --approved: run it only after the user replied \"visual <slug>\" in the current conversation");
  const dir = join(work, slug, week);
  const s = readJson(join(dir, "visual-suggestion.json"));
  if (!s) throw new Error(`no visual-suggestion.json for ${slug} ${week}: run preview first`);
  const analysis = readJson(join(dir, "analysis.json"));
  const problem = candidateProblem(analysis, readJson(join(dir, "input.json")));
  if (problem) throw new Error(`no visual for ${slug} ${week}: ${problem}`);
  if (s.previous_week !== analysis.previous_week) throw new Error("visual-suggestion.json and analysis.json name different previous weeks");
  const ledger = readJson(ledgerFile);
  const beforePng = await publicDesktop(site.replace(/\/$/, ""), slug, s.previous_week, fetchFn);
  const afterPng = await publicDesktop(site.replace(/\/$/, ""), slug, week, fetchFn);
  for (const [w, bytes] of [[s.previous_week, beforePng], [week, afterPng]]) {
    const why = ledgerProblem(ledger, slug, w, bytes);
    if (why) throw new Error(why);
  }
  const png = await render({ beforePng, afterPng, beforeBox: s.before_box, afterBox: s.after_box, previousWeek: s.previous_week, week });
  const file = join(dir, "visual.png");
  await writeKeepingOld(file, png);
  const size = pngSize(png);
  const meta = {
    slug, week, previous_week: s.previous_week, alt: s.alt, before_box: s.before_box, after_box: s.after_box,
    sha1: sha1(png), width: size.width, height: size.height, before_sha1: sha1(beforePng), after_sha1: sha1(afterPng), built_at: new Date().toISOString(),
  };
  await keepExisting(join(dir, "visual.json"));
  await writeFile(join(dir, "visual.json"), JSON.stringify(meta, null, 2) + "\n");
  return { file, meta };
}

/** Default command runner (wrangler), binary-safe. */
function defaultExec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? r.error ?? "") };
}

/**
 * Step 3, from publish.mjs --visual / --visual-only only: upload visual.png (POST /api/visual). If R2 already has a
 * different visual at the key, it is first saved to ~/AI-Surface-Archive/visuals/<week>/<slug>.png.<UTC ts>.png (new
 * name only) and checked byte for byte against a second read. The Worker also archives it in R2 (putKeepingOld).
 */
export async function uploadVisual({ slug, week, token, work = WORK, site = process.env.WORKER_URL || DEFAULT_SITE, fetchFn = fetch, exec = defaultExec,
  archiveDir = process.env.ARCHIVE_DIR || join(homedir(), "AI-Surface-Archive"), termsFile, now = new Date() }) {
  if (!token) throw new Error("UPLOAD_TOKEN is not set");
  const dir = join(work, slug, week);
  const meta = readJson(join(dir, "visual.json"));
  if (!meta) throw new Error(`no visual.json for ${slug} ${week}: build it first (only after "visual ${slug}")`);
  if (meta.slug !== slug || meta.week !== week) throw new Error("visual.json is for a different portal or week");
  const png = await readFile(join(dir, "visual.png"));
  if (sha1(png) !== meta.sha1) throw new Error("visual.png does not match visual.json (rebuild it)");
  const hits = privateTermLines(meta.alt, termsFile);
  if (hits.length) throw new Error(`the alt text contains private term(s), private-terms.txt line(s) ${hits.join(", ")}`);

  const key = `visuals/${week}/${slug}.png`;
  const get = () => exec("npx", ["wrangler", "r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--pipe"], { cwd: REPO_ROOT });
  const live = get();
  let archived = null;
  if (live.status === 0 && live.stdout.length) {
    if (sha1(live.stdout) !== meta.sha1) {
      const target = join(archiveDir, `${key}.${utcStamp(now)}.png`);
      mkdirSync(dirname(target), { recursive: true });
      archived = writeNew(target, live.stdout);
      const again = get();
      const saved = readFileSync(archived);
      if (!saved.length || again.status !== 0 || !saved.equals(live.stdout) || !again.stdout.equals(live.stdout)) {
        throw new Error(`archiving the live ${key} to ${archived} failed verification; nothing uploaded`);
      }
    }
  } else if (!(live.status !== 0 && /does not exist|NoSuchKey|not found|404/i.test(live.stderr))) {
    throw new Error(`could not read the live ${key} (wrangler exit ${live.status}); nothing uploaded`);
  }

  const res = await fetchFn(`${site.replace(/\/$/, "")}/api/visual`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ slug, week, previous_week: meta.previous_week, alt: meta.alt, imageBase64: png.toString("base64") }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/visual -> ${res.status} ${text}`);
  return { key, archived, response: JSON.parse(text) };
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, slug, week, ...rest] = process.argv.slice(2);
  if (!["preview", "build"].includes(cmd) || !slug || !WEEK_RE.test(week ?? "")) {
    console.error("usage:\n  node analysis/visual.mjs preview <slug> <week> --before x,y,w,h [--after x,y,w,h] --sentence \"…\"\n  node analysis/visual.mjs build <slug> <week> --approved");
    process.exit(1);
  }
  if (cmd === "preview") {
    const r = await preview({ slug, week, before: arg(rest, "--before"), after: arg(rest, "--after"), sentence: arg(rest, "--sentence") });
    console.log(`✓ preview ${r.size.width} x ${r.size.height} → ${r.file}\n  (local only; nothing uploaded. Build it only after the user replies "visual ${slug}".)`);
  } else {
    const r = await build({ slug, week, approved: rest.includes("--approved") });
    console.log(`✓ visual ${r.meta.width} x ${r.meta.height} → ${r.file}\n  (not uploaded; publish.mjs ${slug} ${week} --visual uploads it after the user replies "publish …")`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}

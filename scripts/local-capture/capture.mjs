#!/usr/bin/env node
/**
 * Local screenshot agent for the AI Portal Screenshot Library.
 *
 * WHY THIS EXISTS: the big AI portals (ChatGPT, Gemini, Claude…) block datacenter IPs and
 * headless browsers, so Cloudflare Browser Rendering can only ever see their logged-out pages.
 * This script runs on YOUR machine, with YOUR residential IP and a real browser you log into
 * once, so it can screenshot the actual signed-in UI you use every day — then upload each shot
 * to your Worker, which stores it in R2, analyses it with Workers AI, and shows it in the gallery.
 *
 * FIRST RUN:  a Chrome window opens. Log into each portal when it stops on that site, then press
 *             Enter in this terminal to capture. Your logins are saved in ./.capture-profile and
 *             reused on every future run (so later runs can be fully automatic with --auto).
 *
 * USAGE:
 *   export UPLOAD_TOKEN=...            # must match the Worker secret you set with `wrangler secret put UPLOAD_TOKEN`
 *   node capture.mjs                   # all portals, pause on each so you can log in / pick the screen
 *   node capture.mjs claude chatgpt    # only these slugs
 *   node capture.mjs --auto            # no pausing (use once you're already logged in)
 *   WORKER_URL=https://... node capture.mjs   # override the Worker URL
 */
import puppeteer from "puppeteer";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_URL = (process.env.WORKER_URL || "https://ai-portal-library.monthtest970509.workers.dev").replace(/\/$/, "");
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN;
const PROFILE_DIR = join(__dirname, ".capture-profile");
const VIEWPORT = { width: 1280, height: 800 };

// The logged-in "app" URL you actually interact with (overrides the landing-page URL from the API).
const APP_URL = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/",
  copilot: "https://copilot.microsoft.com/",
  grok: "https://grok.com/",
  deepseek: "https://chat.deepseek.com/",
  mistral: "https://chat.mistral.ai/chat",
  "meta-ai": "https://www.meta.ai/",
  poe: "https://poe.com/",
  "character-ai": "https://character.ai/",
  huggingchat: "https://huggingface.co/chat/",
  qwen: "https://chat.qwen.ai/",
  kimi: "https://www.kimi.com/",
  you: "https://you.com/",
  pi: "https://pi.ai/talk",
  manus: "https://manus.im/",
};

function isoMonday(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  t.setUTCDate(t.getUTCDate() + diff);
  return t.toISOString().slice(0, 10);
}

async function main() {
  if (!UPLOAD_TOKEN) {
    console.error("✗ Set UPLOAD_TOKEN first:  export UPLOAD_TOKEN=<the value you gave `wrangler secret put UPLOAD_TOKEN`>");
    process.exit(1);
  }
  const auto = process.argv.includes("--auto");
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  console.log(`→ Worker: ${WORKER_URL}`);
  const res = await fetch(`${WORKER_URL}/api/portals`);
  if (!res.ok) { console.error("✗ Could not fetch portal list:", res.status); process.exit(1); }
  const { portals } = await res.json();
  const list = only.length ? portals.filter((p) => only.includes(p.slug)) : portals;
  if (!list.length) { console.error("✗ No matching portals. Slugs:", portals.map((p) => p.slug).join(", ")); process.exit(1); }

  const week = isoMonday();
  console.log(`→ Week: ${week}  |  ${list.length} portal(s)  |  profile: ${PROFILE_DIR}`);

  const launchOpts = {
    headless: false,
    userDataDir: PROFILE_DIR,
    defaultViewport: VIEWPORT,
    args: ["--disable-blink-features=AutomationControlled", `--window-size=${VIEWPORT.width},${VIEWPORT.height + 140}`],
  };
  // Prefer your installed Google Chrome (correct architecture, no bundled-binary download problems);
  // fall back to Puppeteer's bundled Chromium only if Chrome can't be found.
  let browser;
  try {
    browser = await puppeteer.launch({ ...launchOpts, channel: "chrome" });
    console.log("→ Using your installed Google Chrome");
  } catch (err) {
    console.log("→ System Chrome not usable (" + err.message + "); trying bundled Chromium…");
    browser = await puppeteer.launch(launchOpts);
  }
  const rl = auto ? null : readline.createInterface({ input, output });
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());
  await page.setViewport(VIEWPORT);

  let ok = 0, fail = 0;
  for (const p of list) {
    const url = APP_URL[p.slug] || p.url;
    console.log(`\n=== ${p.name} (${p.slug})\n    ${url}`);
    try { await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }); } catch { /* keep going; user can fix */ }

    if (rl) await rl.question(`    ↳ log in / open the screen you want, then press Enter to capture… `);
    else await new Promise((r) => setTimeout(r, 6000));

    try {
      const buf = await page.screenshot({ type: "png" });
      const up = await fetch(`${WORKER_URL}/api/upload`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${UPLOAD_TOKEN}` },
        body: JSON.stringify({ slug: p.slug, week, imageBase64: Buffer.from(buf).toString("base64") }),
      });
      if (up.ok) { console.log(`    ✓ uploaded (${(buf.length / 1024).toFixed(0)} KB)`); ok++; }
      else { console.log(`    ✗ upload failed: ${up.status} ${await up.text()}`); fail++; }
    } catch (e) { console.log(`    ✗ capture failed: ${e.message}`); fail++; }
  }

  if (rl) rl.close();
  await browser.close();
  console.log(`\nDone. ${ok} uploaded, ${fail} failed. View: ${WORKER_URL}  (week ${week})`);
}
main().catch((e) => { console.error(e); process.exit(1); });

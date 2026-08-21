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
 * LOGGED-OUT GUARD: before uploading, the script checks whether the page still looks logged out
 *             (login URL or a visible password box). If so it will NOT upload a logged-out shot —
 *             in interactive mode it lets you log in and retry; in --auto it skips that portal so
 *             it never overwrites a good signed-in capture with a login screen.
 *
 * USAGE:
 *   export UPLOAD_TOKEN=...            # must match the Worker secret (`wrangler secret put UPLOAD_TOKEN`)
 *   node capture.mjs                   # all portals, pause on each so you can log in / pick the screen
 *   node capture.mjs claude chatgpt    # only these slugs
 *   node capture.mjs --auto            # no pausing (use once you're already logged in)
 *   node capture.mjs --auto --wait=10  # in --auto, wait 10s per page before capturing (default 6)
 *   node capture.mjs --week=2026-08-10 # store under a specific week instead of the current one
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
const MOBILE_VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function uploadShot(slug, week, buf, variant) {
  const res = await fetch(`${WORKER_URL}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${UPLOAD_TOKEN}` },
    body: JSON.stringify({ slug, week, variant, imageBase64: Buffer.from(buf).toString("base64") }),
  });
  return res;
}

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

/**
 * Best-effort "is this page logged out?" check. High-precision signals only, so we don't
 * wrongly skip a good signed-in shot:
 *   - the final URL looks like a login / OAuth page, or
 *   - a password box is actually visible on screen.
 * Returns { loggedOut, finalUrl, reason }.
 */
async function loginState(page) {
  const finalUrl = page.url() || "";
  const u = finalUrl.toLowerCase();
  const urlHit =
    /\/(login|signin|sign-in|sign_in|auth|authenticate)(\/|\?|$)/.test(u) ||
    u.includes("accounts.google.com") ||
    u.includes("login.microsoftonline.com") ||
    u.includes("login.live.com") ||
    u.includes("auth0.com") ||
    u.includes("auth.openai.com") ||
    u.includes("/oauth");
  let pwField = false;
  try {
    pwField = await page.evaluate(() => {
      const visible = (el) => !!(el && el.offsetParent !== null && el.getClientRects().length);
      return [...document.querySelectorAll('input[type="password"]')].some(visible);
    });
  } catch { /* evaluate can fail on cross-origin/redirecting pages; ignore */ }
  const reason = urlHit ? `login URL (${finalUrl})` : pwField ? "a visible password field" : "";
  return { loggedOut: urlHit || pwField, finalUrl, reason };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const auto = argv.includes("--auto");
  const weekArg = (argv.find((a) => a.startsWith("--week=")) || "").split("=")[1];
  const waitArg = (argv.find((a) => a.startsWith("--wait=")) || "").split("=")[1];
  const only = argv.filter((a) => !a.startsWith("--"));
  if (weekArg && !/^\d{4}-\d{2}-\d{2}$/.test(weekArg)) {
    console.error(`✗ --week must be YYYY-MM-DD (got "${weekArg}")`);
    process.exit(1);
  }
  const waitMs = waitArg ? Math.max(1, parseInt(waitArg, 10)) * 1000 : 6000;
  return { auto, week: weekArg || isoMonday(), waitMs, only };
}

async function main() {
  if (!UPLOAD_TOKEN) {
    console.error("✗ Set UPLOAD_TOKEN first:  export UPLOAD_TOKEN=<the value you gave `wrangler secret put UPLOAD_TOKEN`>");
    process.exit(1);
  }
  const { auto, week, waitMs, only } = parseArgs();

  console.log(`→ Worker: ${WORKER_URL}`);
  const res = await fetch(`${WORKER_URL}/api/portals`);
  if (!res.ok) { console.error("✗ Could not fetch portal list:", res.status); process.exit(1); }
  const { portals } = await res.json();
  const list = only.length ? portals.filter((p) => only.includes(p.slug)) : portals;
  if (!list.length) { console.error("✗ No matching portals. Slugs:", portals.map((p) => p.slug).join(", ")); process.exit(1); }

  console.log(`→ Week: ${week}  |  ${list.length} portal(s)  |  ${auto ? `--auto (wait ${waitMs / 1000}s/page)` : "interactive"}`);
  console.log(`→ Profile: ${PROFILE_DIR}`);

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
  const skipped = []; // slugs skipped because they still looked logged out

  for (const p of list) {
    const url = APP_URL[p.slug] || p.url;
    console.log(`\n=== ${p.name} (${p.slug})\n    ${url}`);
    try { await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 }); } catch { /* keep going; user can fix */ }

    let done = false;
    while (!done) {
      if (rl) {
        const ans = (await rl.question(`    ↳ log in / open the screen, then Enter to capture  (s = skip): `)).trim().toLowerCase();
        if (ans === "s") { console.log("    ↳ skipped."); skipped.push(p.slug); break; }
      } else {
        await new Promise((r) => setTimeout(r, waitMs));
      }

      // Guard: don't upload a logged-out page.
      const state = await loginState(page);
      if (state.loggedOut) {
        console.log(`    ⚠ still looks LOGGED OUT — ${state.reason}`);
        if (rl) { console.log("      → log in in the Chrome window, then press Enter to retry (or 's' to skip)."); continue; }
        console.log("      → --auto: skipping so a login screen never overwrites a good shot.");
        skipped.push(p.slug);
        break;
      }

      // Looks signed in → capture desktop + mobile and upload both.
      try {
        // 1) desktop (current viewport)
        const deskBuf = await page.screenshot({ type: "png" });
        const deskRes = await uploadShot(p.slug, week, deskBuf, "desktop");
        if (deskRes.ok) { console.log(`    ✓ desktop uploaded (${(deskBuf.length / 1024).toFixed(0)} KB)`); ok++; }
        else { console.log(`    ✗ desktop upload failed: ${deskRes.status} ${await deskRes.text()}`); fail++; }

        // 2) mobile: switch to a phone viewport, reload so responsive layout kicks in, capture
        try {
          await page.setViewport(MOBILE_VIEWPORT);
          try { await page.reload({ waitUntil: "networkidle2", timeout: 60000 }); } catch { /* keep going */ }
          await new Promise((r) => setTimeout(r, 2500));
          const mobBuf = await page.screenshot({ type: "png" });
          const mobRes = await uploadShot(p.slug, week, mobBuf, "mobile");
          if (mobRes.ok) console.log(`    ✓ mobile uploaded (${(mobBuf.length / 1024).toFixed(0)} KB)`);
          else console.log(`    ✗ mobile upload failed: ${mobRes.status} ${await mobRes.text()}`);
        } catch (e) {
          console.log(`    ⚠ mobile capture skipped: ${e.message}`);
        } finally {
          await page.setViewport(VIEWPORT); // restore for the next portal
        }
      } catch (e) {
        console.log(`    ✗ capture failed: ${e.message}`); fail++;
      }
      done = true;
    }
  }

  if (rl) rl.close();
  await browser.close();
  console.log(`\nDone. ${ok} uploaded, ${fail} failed${skipped.length ? `, ${skipped.length} skipped (logged out): ${skipped.join(", ")}` : ""}.`);
  console.log(`View: ${WORKER_URL}  (week ${week})`);
  if (skipped.length) {
    console.log(`\nTo redo the skipped ones after logging in:\n  node capture.mjs ${skipped.join(" ")}${week === isoMonday() ? "" : ` --week=${week}`}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

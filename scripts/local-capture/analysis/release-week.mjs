#!/usr/bin/env node
/**
 * Release a week's held captures once they are redacted (the /release-week step). Local uploads are held: the site
 * never shows them, and the week doesn't become the latest one, until they are released.
 *
 * USAGE (from scripts/local-capture):
 *   export UPLOAD_TOKEN=...
 *   node analysis/release-week.mjs <week>                                  # list held captures and their redaction
 *   node analysis/release-week.mjs <week> --release [--slug a,b] [--force a,b]
 *
 * A held capture is redacted when each of its images (desktop and, if any, mobile) is served with the SHA-1 its
 * ~/AI-Surface-Archive/redaction-ledger.json row says: redacted_sha1 for "uploaded", original_sha1 for "no change".
 * So a ledger entry for an earlier upload doesn't count once the image has been replaced.
 *
 * --release releases every redacted held capture (all of the week, or only --slug), and refuses the others unless
 * they are named in --force. Then it checks the public API, the homepage and the images without the token.
 * The token is sent only in the Authorization header and never printed. Nothing is ever deleted.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_URL, UPLOAD_TOKEN } from "../config.mjs";

const DONE = ["uploaded", "no change"];
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
/** "/img/shots/2026-10-26/grok.local.png?v=1" -> "shots/2026-10-26/grok.local.png" */
export const keyOf = (url) => (url ? decodeURIComponent(url.replace(/^\/img\//, "").split("?")[0]) : null);

/**
 * Each held capture with its images' redaction state. `liveSha1(key)` gives the SHA-1 the site serves now.
 * An image is ok when a ledger row for its key is uploaded / no change and its SHA-1 is the one the site serves.
 */
export async function heldStatus(captures, ledger, liveSha1) {
  const out = [];
  for (const c of captures.filter((x) => x.held)) {
    const images = [];
    for (const [variant, url] of [["desktop", c.sample ? null : c.image], ["mobile", c.imageMobile]]) {
      const key = keyOf(url);
      if (!key) continue;
      const rows = (ledger?.images ?? []).filter((r) => r.r2_key === key);
      const live = await liveSha1(key);
      const match = rows.find((r) => DONE.includes(r.upload_status) && live === (r.upload_status === "uploaded" ? r.redacted_sha1 : r.original_sha1));
      const reason = match ? match.upload_status
        : !rows.length ? "no ledger entry"
        : rows.some((r) => DONE.includes(r.upload_status)) ? "live image differs from the ledger (replaced after redaction?)"
        : `ledger: ${rows.map((r) => r.upload_status).join(", ")}`;
      images.push({ variant, key, ok: !!match, reason });
    }
    out.push({ slug: c.slug, portal: c.portal, images, redacted: images.length > 0 && images.every((i) => i.ok) });
  }
  return out;
}

/** Which held captures to release: the redacted ones (or only `slugs`), plus `force`d ones. */
export function plan(status, { slugs = [], force = [] } = {}) {
  const wanted = status.filter((s) => !slugs.length || slugs.includes(s.slug));
  return {
    release: wanted.filter((s) => s.redacted || force.includes(s.slug)).map((s) => s.slug),
    refused: wanted.filter((s) => !s.redacted && !force.includes(s.slug)).map((s) => s.slug),
    unknown: [...slugs, ...force].filter((x) => !status.some((s) => s.slug === x)),
  };
}

function parseList(v) { return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean); }

async function main() {
  const args = process.argv.slice(2);
  const flags = { release: false, slugs: [], force: [] };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--release") flags.release = true;
    else if (args[i] === "--slug") flags.slugs = parseList(args[++i]);
    else if (args[i] === "--force") flags.force = parseList(args[++i]);
    else pos.push(args[i]);
  }
  const [week] = pos;
  if (pos.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    console.error("usage: release-week.mjs <week> [--release [--slug a,b] [--force a,b]]");
    process.exit(1);
  }
  if (!UPLOAD_TOKEN) { console.error("✗ Set UPLOAD_TOKEN first (held captures are only visible with it)"); process.exit(1); }
  const auth = { authorization: `Bearer ${UPLOAD_TOKEN}` };
  const get = (path, headers = {}) => fetch(`${WORKER_URL}${path}`, { headers });

  const res = await get(`/api/captures?week=${week}`, auth);
  if (!res.ok) throw new Error(`GET /api/captures?week=${week} -> ${res.status}`);
  const { captures } = await res.json();
  const ledgerPath = join(process.env.ARCHIVE_DIR || join(homedir(), "AI-Surface-Archive"), "redaction-ledger.json");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { images: [] };
  const liveSha1 = async (key) => {
    const r = await get(`/img/${key}?cb=${Date.now()}`, auth);
    return r.ok ? sha1(Buffer.from(await r.arrayBuffer())) : `HTTP ${r.status}`;
  };
  const status = await heldStatus(captures, ledger, liveSha1);

  if (!status.length) console.log(`No held captures in ${week}.`);
  for (const s of status) {
    console.log(`${s.redacted ? "✓" : "✗"} ${s.slug.padEnd(12)} ${s.redacted ? "redacted" : "NOT REDACTED"}  ${s.images.map((i) => `${i.variant}: ${i.reason}`).join("; ")}`);
  }
  console.log(`${status.length} held: ${status.filter((s) => s.redacted).length} redacted, ${status.filter((s) => !s.redacted).length} not redacted`);
  if (!flags.release) return;

  const p = plan(status, flags);
  if (p.unknown.length) { console.error(`✗ not held in ${week}: ${p.unknown.join(", ")}`); process.exit(1); }
  if (p.refused.length) console.log(`Refusing (not redacted; use --force <slug> to release anyway): ${p.refused.join(", ")}`);
  if (!p.release.length) { console.log("Nothing to release."); process.exit(p.refused.length ? 1 : 0); }

  // One request for the whole week when everything held is being released; else one per portal.
  const whole = p.release.length === status.length && !flags.slugs.length;
  const targets = whole ? [null] : p.release;
  let after = null;
  for (const slug of targets) {
    const r = await fetch(`${WORKER_URL}/api/weeks/${week}/release${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`, { method: "POST", headers: auth });
    const text = await r.text();
    if (!r.ok) { console.error(`✗ release ${slug ?? week} -> ${r.status} ${text}`); process.exit(1); }
    after = JSON.parse(text);
    console.log(`✓ released ${after.released.join(", ") || "(nothing)"}`);
  }
  console.log(after.stillHeld.length ? `Still held in ${week}: ${after.stillHeld.join(", ")}` : `${week} has no held captures left.`);

  // Verify without the token, cache-busted.
  const cb = `cb=${Date.now()}`;
  const pub = await (await get(`/api/captures?week=${week}&${cb}`)).json();
  const latest = await (await get(`/api/captures?${cb}`)).json();
  const home = await (await get(`/?${cb}`)).text();
  const released = pub.captures.filter((c) => p.release.includes(c.slug));
  console.log(`${released.length === p.release.length ? "✓" : "✗"} public API week ${week}: ${released.length}/${p.release.length} released captures listed`);
  for (const c of released) {
    for (const url of [c.sample ? null : c.image, c.imageMobile].filter(Boolean)) {
      const r = await get(`${url}${url.includes("?") ? "&" : "?"}${cb}`);
      console.log(`${r.ok ? "✓" : "✗"} ${keyOf(url)} public -> ${r.status}`);
    }
  }
  if (!after.stillHeld.length) {
    console.log(`${latest.week === week ? "✓" : "✗"} public API latest week: ${latest.week}`);
    console.log(`${home.includes(`href="/weeks/${week}"`) ? "✓" : "✗"} homepage shows ${week}`);
  } else {
    console.log(`· latest week stays ${latest.week} until ${week} has no held captures`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}

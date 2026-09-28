#!/usr/bin/env node
/**
 * Upload the approved redacted screenshots for one week (the /redact-week upload step).
 * Follows the CLAUDE.md screenshot safety rules: every live object is archived (byte-identical,
 * never overwriting) before it is replaced, and no image, R2 object or archive file is ever deleted
 * (the KV cache keys are the only thing it deletes).
 *
 * USAGE (from anywhere; wrangler runs from the repo root):
 *   node analysis/upload-redacted.mjs <week> [--except slug/variant,slug,...] [--only slug/variant,...] [--dry-run]
 *
 * Uploads every ~/AI-Surface-Archive/redaction-ledger.json row for <week> whose upload_status is
 * "pending review", minus --except (a bare slug excludes both variants). For each image, one at a
 * time (a failed check stops that image only and marks its row "failed: <reason>"):
 *   1. Archive the live R2 object to ~/AI-Surface-Archive/<r2_key>.<UTC ts>.png (new name only), check it
 *      is non-empty and equal to a second fresh read, and that the live SHA-1 equals the row's
 *      expected_live_sha1 (if set, e.g. when replacing an earlier redaction) or else original_sha1.
 *   2. wrangler r2 object put the redacted file.
 *   3. Verify a cache-busted site download and a fresh R2 read both equal redacted_sha1.
 *   4. Ledger: upload_status "uploaded", uploaded_at, archive path appended (ledger snapshotted first).
 *   5. Bump captures.captured_at by 1 ms (guarded UPDATE, changes must be 1).
 *   6. Delete the KV keys invalidate() in src/capture.ts deletes.
 *
 * Env: WORKER_URL (site), ARCHIVE_DIR (default ~/AI-Surface-Archive).
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
const BUCKET = "ai-portal-shots";
const D1_NAME = "ai-portal-library";
const DEFAULT_SITE = "https://ai-portal-library.monthtest970509.workers.dev";

export const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const tilde = (p) => (p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p);

/** CACHE_VERSION from src/db.ts and the CACHE KV namespace id from wrangler.jsonc, so they can't drift. */
export function readProjectConfig(root = REPO_ROOT) {
  const db = readFileSync(join(root, "src/db.ts"), "utf8");
  const cacheVersion = /export const CACHE_VERSION = "([^"]+)"/.exec(db)?.[1];
  const wr = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const kvId = /"binding":\s*"CACHE",\s*"id":\s*"([0-9a-f]+)"/.exec(wr)?.[1];
  if (!cacheVersion || !kvId) throw new Error("could not read CACHE_VERSION or the CACHE KV id");
  return { cacheVersion, kvId };
}

/** Default command runner: binary-safe stdout, stderr as text. */
function defaultExec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? r.error ?? "") };
}

/** Write bytes to `path`, or to path with -2, -3 … inserted before ".png" if taken. Never overwrites. */
export function writeNew(path, bytes) {
  for (let n = 1; n < 1000; n++) {
    const p = n === 1 ? path : path.replace(/\.png$/, `-${n}.png`);
    try {
      writeFileSync(p, bytes, { flag: "wx" });
      return p;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw new Error(`no free archive name for ${path}`);
}

function parseList(v) {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function selectRows(ledger, week, { except = [], only = [] } = {}) {
  const hit = (list, r) => list.some((e) => e === r.slug || e === `${r.slug}/${r.variant}`);
  return ledger.images.filter((r) =>
    r.week === week && r.upload_status === "pending review" && !hit(except, r) && (!only.length || hit(only, r)));
}

/**
 * Upload one week. Dependencies are injectable for tests:
 *   exec(cmd, args, {cwd}) -> {status, stdout: Buffer, stderr}, now() -> Date, log(line).
 */
export function uploadWeek(week, opts = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error(`week must be YYYY-MM-DD (got "${week}")`);
  const {
    root = REPO_ROOT,
    archiveDir = process.env.ARCHIVE_DIR || join(homedir(), "AI-Surface-Archive"),
    site = process.env.WORKER_URL || DEFAULT_SITE,
    exec = defaultExec,
    now = () => new Date(),
    log = (s) => console.log(s),
    except = [],
    only = [],
    dryRun = false,
  } = opts;
  const { cacheVersion, kvId } = opts.config ?? readProjectConfig(root);
  const ledgerPath = join(archiveDir, "redaction-ledger.json");

  const run = (cmd, args, what) => {
    const r = exec(cmd, args, { cwd: root });
    if (r.status !== 0) throw new Error(`${what} failed: ${String(r.stderr).slice(-300)}`);
    return r.stdout;
  };
  const liveBytes = (key) => run("npx", ["wrangler", "r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--pipe"], "r2 get");
  const d1 = (sql) => JSON.parse(String(run("npx", ["wrangler", "d1", "execute", D1_NAME, "--remote", "--json", "--command", sql], "d1")))[0];

  const readLedger = () => JSON.parse(readFileSync(ledgerPath, "utf8"));
  // The ledger is the one archive file that is rewritten; snapshot it under a new name first.
  const saveLedger = (L) => {
    const snap = join(archiveDir, `redaction-ledger.json.${utcStamp(now())}.${randomInt(1e4, 1e5)}.json`);
    copyFileSync(ledgerPath, snap, constants.COPYFILE_EXCL);
    const tmp = `${ledgerPath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(L, null, 2) + "\n", { flag: "wx" });
    renameSync(tmp, ledgerPath);
  };
  const updateRow = (key, fn) => {
    const L = readLedger();
    for (const r of L.images) if (r.r2_key === key) fn(r);
    saveLedger(L);
  };

  const rows = selectRows(readLedger(), week, { except, only });
  log(`${rows.length} image(s) to upload for ${week}${dryRun ? " (dry run)" : ""}`);
  const results = [];

  for (const row of rows) {
    const { r2_key: key, slug, variant } = row;
    const label = `${slug}/${variant}`;
    let uploaded = false;
    try {
      if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`bad slug ${slug}`);
      const redPath = isAbsolute(row.redacted_file) ? row.redacted_file : join(root, row.redacted_file);
      const red = readFileSync(redPath);
      if (sha1(red) !== row.redacted_sha1) throw new Error("local redacted file no longer matches redacted_sha1");
      const expected = row.expected_live_sha1 || row.original_sha1;
      if (dryRun) { results.push({ label, ok: true, detail: `would replace ${expected.slice(0, 12)} with ${row.redacted_sha1.slice(0, 12)}` }); log(`${label} dry-run`); continue; }

      // 1. Archive the live object before anything else.
      const archivePath = join(archiveDir, `${key}.${utcStamp(now())}.png`);
      mkdirSync(dirname(archivePath), { recursive: true });
      const written = writeNew(archivePath, liveBytes(key));
      const archived = readFileSync(written);
      if (!archived.length) throw new Error(`archive ${tilde(written)} is empty`);
      const fresh = sha1(liveBytes(key));
      if (sha1(archived) !== fresh) throw new Error("archive is not identical to the live object");
      if (fresh !== expected) throw new Error(`live sha1 ${fresh} != expected ${expected}; someone changed it`);

      // 2. Upload.
      run("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", redPath, "--content-type", "image/png", "--remote"], "r2 put");
      uploaded = true;

      // 3. Verify through the site (cache-busted) and straight from R2.
      const cb = `${now().getTime()}${randomInt(1e5)}`;
      const viaSite = sha1(run("curl", ["-sf", `${site}/img/${key}?cb=${cb}`], "site download"));
      if (viaSite !== row.redacted_sha1) throw new Error(`site serves ${viaSite}, not the redacted file`);
      if (sha1(liveBytes(key)) !== row.redacted_sha1) throw new Error("R2 object is not the redacted file");

      // 4. Ledger.
      updateRow(key, (r) => {
        r.upload_status = "uploaded";
        r.uploaded_at = now().toISOString();
        r.archived_before_upload = [...(r.archived_before_upload ?? []), tilde(written)];
      });

      // 5. captured_at + 1 ms, guarded on the value just read.
      const id = `${slug}-${week}`;
      const old = d1(`SELECT captured_at FROM captures WHERE id='${id}'`)?.results?.[0]?.captured_at;
      if (!old || Number.isNaN(Date.parse(old))) throw new Error(`no valid captured_at for ${id}`);
      const bumped = new Date(Date.parse(old) + 1).toISOString();
      const changes = d1(`UPDATE captures SET captured_at='${bumped}' WHERE id='${id}' AND captured_at='${old}'`)?.meta?.changes;
      if (changes !== 1) throw new Error(`captured_at update changed ${changes} rows`);

      // 6. KV keys invalidate() clears.
      for (const k of [`captures:${week}`, "weeks", "stats", "sitemap"]) {
        run("npx", ["wrangler", "kv", "key", "delete", "--namespace-id", kvId, "--remote", `${cacheVersion}:cache:${k}`], `KV delete ${k}`);
      }
      results.push({ label, ok: true, archive: tilde(written), sha1: row.redacted_sha1, captured_at: [old, bumped] });
      log(`✓ ${label}  archive ${tilde(written)}  sha1 ${row.redacted_sha1.slice(0, 12)}  captured_at ${old} -> ${bumped}`);
    } catch (e) {
      const reason = uploaded ? `UPLOADED, then ${e.message}` : e.message;
      results.push({ label, ok: false, reason });
      log(`✗ ${label}  ${reason}`);
      try {
        updateRow(key, (r) => { if (r.upload_status !== "uploaded") r.upload_status = `failed: ${reason}`; });
      } catch (e2) {
        log(`  (ledger update failed too: ${e2.message})`);
      }
    }
  }
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const flags = { except: [], only: [], dryRun: false };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--except") flags.except = parseList(args[++i]);
    else if (args[i] === "--only") flags.only = parseList(args[++i]);
    else if (args[i] === "--dry-run") flags.dryRun = true;
    else pos.push(args[i]);
  }
  if (pos.length !== 1) {
    console.error("usage: upload-redacted.mjs <week> [--except slug/variant,...] [--only slug/variant,...] [--dry-run]");
    process.exit(1);
  }
  const results = uploadWeek(pos[0], flags);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}

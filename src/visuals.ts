// Before/after comparison images ("visuals") for the weekly digest (/weeks/<week>) and the portal's weekly page
// (/portals/<slug>/<week>). A visual is one PNG: the same region cropped from the previous week's and this week's
// redacted desktop screenshots, stacked with "Before · <date>" / "After · <date>" chips. It is made locally by
// scripts/local-capture/analysis/visual.mjs and uploaded only for changes the site owner approved
// (publish.mjs --visual, POST /api/visual).
//
// Storage: R2 visuals/<week>/<slug>.png (replacements are archived first, putKeepingOld) and one D1 row in `visuals`
// (migration 0012). Without that table nothing is shown and uploads are refused, so the Worker can be deployed first.
// A visual is never served or shown while either of its two captures is held (src/db.ts), or when one is missing.
import type { Env } from "./types";
import { hasHeldColumn } from "./db";
import { putKeepingOld, invalidate } from "./capture";
import { parseImageSize } from "./image-size";

export const VISUAL_PREFIX = "visuals/";
export const VISUALS_MIGRATE_COMMAND = "npm run db:migrate:visuals:remote";

/** Largest accepted visual: a crop of a 1280 x 800 screenshot, twice, plus the gap. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 1700;
const ALT_MIN = 10;
const ALT_MAX = 400;
const WEEK = /^\d{4}-\d{2}-\d{2}$/;

export type Visual = {
  id: string; slug: string; week: string; previous_week: string; r2_key: string; alt: string;
  width: number; height: number; created_at: string;
};

export const visualKey = (slug: string, week: string) => `${VISUAL_PREFIX}${week}/${slug}.png`;

/** The public image URL, versioned by upload time so a replaced visual busts the 24h browser cache. */
export const visualUrl = (v: Pick<Visual, "r2_key" | "created_at">) => `/img/${v.r2_key}?v=${Date.parse(v.created_at) || 0}`;

const tableSeen = new WeakSet<object>();

/** Whether the visuals table exists (migration 0012). Only a found table is remembered, so migrating later needs no redeploy. */
export async function hasVisualsTable(env: Env): Promise<boolean> {
  if (tableSeen.has(env.DB)) return true;
  const row = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'visuals'`).first<{ name: string }>();
  if (row) tableSeen.add(env.DB);
  return !!row;
}

/**
 * SQL for visuals whose two captures (this week and the "before" week) both exist, succeeded and are not held.
 * Every public read goes through it, so a visual disappears as soon as either capture is held again.
 */
async function publicVisuals(env: Env, where: string): Promise<string> {
  const held = await hasHeldColumn(env);
  return `SELECT v.* FROM visuals v
    JOIN captures c ON c.id = v.slug || '-' || v.week
    JOIN captures pc ON pc.id = v.slug || '-' || v.previous_week
    WHERE c.status = 'ok' AND pc.status = 'ok' AND c.r2_key IS NOT NULL AND pc.r2_key IS NOT NULL${held ? " AND c.held = 0 AND pc.held = 0" : ""} AND ${where}`;
}

/** The week's public visuals by slug (/weeks/<week>); empty without the table. */
export async function visualsForWeek(env: Env, week: string): Promise<Map<string, Visual>> {
  if (!(await hasVisualsTable(env))) return new Map();
  const { results } = await env.DB.prepare(await publicVisuals(env, "v.week = ?")).bind(week).all<Visual>();
  return new Map((results ?? []).map((v) => [v.slug, v]));
}

/** One portal's public visual for a week (/portals/<slug>/<week>), or null. */
export async function visualFor(env: Env, slug: string, week: string): Promise<Visual | null> {
  if (!(await hasVisualsTable(env))) return null;
  return await env.DB.prepare(await publicVisuals(env, "v.slug = ? AND v.week = ?")).bind(slug, week).first<Visual>();
}

/** Whether GET /img/<key> may serve a visuals/ key: only a recorded visual whose captures are both public. Never for held ones, token or not. */
export async function isServableVisual(env: Env, key: string): Promise<boolean> {
  if (!(await hasVisualsTable(env))) return false;
  return !!(await env.DB.prepare(await publicVisuals(env, "v.r2_key = ?")).bind(key).first<Visual>());
}

type CaptureState = { status: string; r2_key: string | null; held?: number | null };

export type VisualUpload = { slug?: unknown; week?: unknown; previous_week?: unknown; alt?: unknown; imageBase64?: unknown };
export type VisualResult = { status: number; body: Record<string, unknown> };

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/^data:image\/png;base64,/, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/**
 * Store an approved visual (POST /api/visual, token-gated by the caller). Refuses unless both captures exist, succeeded,
 * have a desktop screenshot and are released (not held). Replacing a visual archives the old object first (putKeepingOld).
 */
export async function storeVisual(env: Env, body: VisualUpload, now = new Date()): Promise<VisualResult> {
  const err = (status: number, error: string): VisualResult => ({ status, body: { error } });
  if (!(await hasVisualsTable(env))) return err(503, `the visuals table is missing: run ${VISUALS_MIGRATE_COMMAND}`);

  const { slug, week, previous_week: prev, alt, imageBase64 } = body;
  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) return err(400, "slug required");
  if (typeof week !== "string" || !WEEK.test(week)) return err(400, "week must be YYYY-MM-DD");
  if (typeof prev !== "string" || !WEEK.test(prev) || prev >= week) return err(400, "previous_week must be YYYY-MM-DD, before week");
  if (typeof alt !== "string" || alt.trim().length < ALT_MIN || alt.trim().length > ALT_MAX || /[\r\n]/.test(alt)) {
    return err(400, `alt must be the change sentence: one line, ${ALT_MIN}-${ALT_MAX} characters`);
  }
  if (typeof imageBase64 !== "string") return err(400, "imageBase64 required");

  // Only from released captures: a held capture is not redacted (or not approved) yet.
  const held = await hasHeldColumn(env);
  for (const w of [week, prev]) {
    const c = await env.DB.prepare(`SELECT status, r2_key${held ? ", held" : ""} FROM captures WHERE id = ?`).bind(`${slug}-${w}`).first<CaptureState>();
    if (!c || c.status !== "ok" || !c.r2_key) return err(404, `no desktop capture for ${slug} week ${w}`);
    if (c.held) return err(409, `${slug} week ${w} is held: release it (/release-week) before uploading a visual`);
  }

  const png = decodeBase64(imageBase64);
  if (!png || !isPng(png)) return err(400, "imageBase64 must be a PNG");
  if (png.length > MAX_BYTES) return err(413, "visual too large");
  const size = parseImageSize(png);
  if (!size || size.width > MAX_WIDTH || size.height > MAX_HEIGHT) return err(400, `visual must be at most ${MAX_WIDTH} x ${MAX_HEIGHT}`);

  const key = visualKey(slug, week);
  const archived = await putKeepingOld(env, key, png, now);
  await env.DB.prepare(
    `INSERT INTO visuals (id, slug, week, previous_week, r2_key, alt, width, height, created_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET previous_week=excluded.previous_week, r2_key=excluded.r2_key, alt=excluded.alt,
       width=excluded.width, height=excluded.height, created_at=excluded.created_at`
  ).bind(`${slug}-${week}`, slug, week, prev, key, alt.trim(), size.width, size.height, now.toISOString()).run();
  await invalidate(env, week);
  return { status: 200, body: { ok: true, slug, week, previous_week: prev, key, archived, width: size.width, height: size.height } };
}

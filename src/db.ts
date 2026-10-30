import type { Env, PortalRow, CaptureRow } from "./types";

/** Prefix for every KV-cached API payload (bump to orphan all cached responses). */
export const CACHE_VERSION = "v5-week-digests";

/**
 * The plan of the same portal's previous successful capture, for a query over `captures c` (src/plan.ts): a capture
 * whose plan differs from it is possibly confounded.
 */
export const PREVIOUS_PLAN = `(SELECT pp.plan FROM captures pp WHERE pp.slug = c.slug AND pp.week < c.week AND pp.status = 'ok' ORDER BY pp.week DESC LIMIT 1) AS previous_plan`;

const planColumnSeen = new WeakSet<object>();

/**
 * Whether captures.plan exists (migration 0010). A Worker deployed before the migration treats every plan as
 * unknown instead of failing. Only a found column is remembered, so running the migration later needs no redeploy.
 */
export async function hasPlanColumn(env: Env): Promise<boolean> {
  if (planColumnSeen.has(env.DB)) return true;
  const { results } = await env.DB.prepare(`PRAGMA table_info(captures)`).all<{ name: string }>();
  const found = (results ?? []).some((r) => r.name === "plan");
  if (found) planColumnSeen.add(env.DB);
  return found;
}

const heldColumnSeen = new WeakSet<object>();

/**
 * Whether captures.held exists (migration 0011). Held captures (local uploads waiting for redaction) are never
 * public; a Worker deployed before the migration has none, so every capture is public. Like hasPlanColumn(), only a
 * found column is remembered.
 */
export async function hasHeldColumn(env: Env): Promise<boolean> {
  if (heldColumnSeen.has(env.DB)) return true;
  const { results } = await env.DB.prepare(`PRAGMA table_info(captures)`).all<{ name: string }>();
  const found = (results ?? []).some((r) => r.name === "held");
  if (found) heldColumnSeen.add(env.DB);
  return found;
}

/** SQL condition: the capture `alias` is not held (always true without the held column). */
export async function notHeld(env: Env, alias = "c"): Promise<string> {
  return (await hasHeldColumn(env)) ? `${alias}.held = 0` : "1 = 1";
}

/** SQL condition: the week `weekExpr` has no held capture, so it is public (always true without the held column). */
export async function weekReleased(env: Env, weekExpr: string): Promise<string> {
  return (await hasHeldColumn(env)) ? `NOT EXISTS (SELECT 1 FROM captures h WHERE h.week = ${weekExpr} AND h.held = 1)` : "1 = 1";
}

/** PREVIOUS_PLAN, or a NULL previous_plan when the plan column doesn't exist yet. */
async function previousPlan(env: Env): Promise<string> {
  return (await hasPlanColumn(env)) ? PREVIOUS_PLAN : "NULL AS previous_plan";
}

/** All active portals, capture order. */
export async function listPortals(env: Env): Promise<PortalRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM portals WHERE active = 1 ORDER BY sort_order ASC, name ASC`
  ).all<PortalRow>();
  return results ?? [];
}

export async function getPortal(env: Env, slug: string): Promise<PortalRow | null> {
  return await env.DB.prepare(`SELECT * FROM portals WHERE slug = ?`).bind(slug).first<PortalRow>();
}

/**
 * Archived weeks, newest first. A week with a held capture is not released yet, so it is left out unless
 * `includeHeld` (token requests: /api/weeks for the local scripts).
 */
export async function listWeeks(env: Env, includeHeld = false): Promise<{ week: string; label: string; portal_count: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT w.week AS week, w.label AS label, w.portal_count AS portal_count FROM weeks w
     ${includeHeld ? "" : `WHERE ${await weekReleased(env, "w.week")}`} ORDER BY w.week DESC`
  ).all<{ week: string; label: string; portal_count: number }>();
  return results ?? [];
}

/** The newest week; publicly, the newest week without held captures, so the site keeps the previous week until a release. */
export async function latestWeek(env: Env, includeHeld = false): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT w.week AS week FROM weeks w ${includeHeld ? "" : `WHERE ${await weekReleased(env, "w.week")}`} ORDER BY w.week DESC LIMIT 1`
  ).first<{ week: string }>();
  return row?.week ?? null;
}

/** Captures for a given week; held captures only with `includeHeld` (token requests). */
export async function capturesForWeek(env: Env, week: string, includeHeld = false): Promise<CaptureRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.*, ${await previousPlan(env)} FROM captures c
     JOIN portals p ON p.slug = c.slug
     WHERE c.week = ? AND p.active = 1${includeHeld ? "" : ` AND ${await notHeld(env)}`}
     ORDER BY p.sort_order ASC, c.portal ASC`
  ).bind(week).all<CaptureRow>();
  return results ?? [];
}

/** Whether an R2 key is a held capture's desktop or mobile screenshot (GET /img/<key> answers 404 for it). */
export async function isHeldImage(env: Env, key: string): Promise<boolean> {
  if (!(await hasHeldColumn(env))) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS held FROM captures WHERE held = 1 AND (r2_key = ? OR r2_key_mobile = ?) LIMIT 1`
  ).bind(key, key).first<{ held: number }>();
  return !!row;
}

/**
 * Release a week's held captures (all, or one portal's): POST /api/weeks/<week>/release. Returns the slugs released
 * and the ones still held in the week. Without the held column there is nothing to release.
 */
export async function releaseWeek(env: Env, week: string, slug: string | null = null): Promise<{ released: string[]; stillHeld: string[] }> {
  if (!(await hasHeldColumn(env))) return { released: [], stillHeld: [] };
  const held = async () => {
    const { results } = await env.DB.prepare(`SELECT slug FROM captures WHERE week = ? AND held = 1 ORDER BY slug`).bind(week).all<{ slug: string }>();
    return (results ?? []).map((r) => r.slug);
  };
  const before = await held();
  await env.DB.prepare(`UPDATE captures SET held = 0 WHERE week = ? AND held = 1${slug ? " AND slug = ?" : ""}`)
    .bind(...(slug ? [week, slug] : [week])).run();
  const stillHeld = await held();
  return { released: before.filter((s) => !stillHeld.includes(s)), stillHeld };
}

export async function upsertWeek(env: Env, week: string, label: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO weeks (week, label, created_at, portal_count)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(week) DO NOTHING`
  ).bind(week, label, new Date().toISOString()).run();
}

export async function refreshWeekCount(env: Env, week: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE weeks SET portal_count = (SELECT COUNT(*) FROM captures c JOIN portals p ON p.slug = c.slug WHERE c.week = ? AND c.status = 'ok' AND p.active = 1) WHERE week = ?`
  ).bind(week, week).run();
}

export async function upsertCapture(env: Env, row: CaptureRow): Promise<void> {
  // Without the plan column (before migration 0010) the capture is stored without its plan,
  // and without the held column (before migration 0011) it is public.
  const plan = await hasPlanColumn(env);
  const held = await hasHeldColumn(env);
  await env.DB.prepare(
    `INSERT INTO captures
      (id, week, slug, portal, company, url, brand, r2_key, width, height, palette, analysis, analysis_by, analysis_json, analysis_version, status, captured_at${plan ? ", plan" : ""}${held ? ", held" : ""})
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${plan ? ",?" : ""}${held ? ",?" : ""})
     ON CONFLICT(id) DO UPDATE SET
      r2_key=excluded.r2_key, width=excluded.width, height=excluded.height,
      palette=excluded.palette, analysis=excluded.analysis, analysis_by=excluded.analysis_by,
      analysis_json=excluded.analysis_json, analysis_version=excluded.analysis_version,
      status=excluded.status, captured_at=excluded.captured_at${plan ? `,
      plan=COALESCE(excluded.plan, captures.plan)` : ""}${held ? `,
      held=MAX(captures.held, excluded.held)` : ""}`
  ).bind(
    row.id, row.week, row.slug, row.portal, row.company, row.url, row.brand,
    row.r2_key, row.width, row.height, row.palette, row.analysis, row.analysis_by,
    row.analysis_json, row.analysis_version, row.status, row.captured_at, ...(plan ? [row.plan ?? null] : []),
    ...(held ? [row.held ? 1 : 0] : [])
  ).run();
}

/** Store a guideline analysis on an existing capture row (desktop fields untouched). */
export async function updateCaptureAnalysis(
  env: Env,
  id: string,
  a: { analysis: string; analysis_by: string; analysis_json: string; analysis_version: string }
): Promise<void> {
  await env.DB.prepare(
    `UPDATE captures SET analysis=?, analysis_by=?, analysis_json=?, analysis_version=?, analysis_published_at=? WHERE id=?`
  ).bind(a.analysis, a.analysis_by, a.analysis_json, a.analysis_version, new Date().toISOString(), id).run();
}

/**
 * Record a mobile screenshot for a (week, slug) without touching the desktop
 * capture's analysis/palette/r2_key. If the desktop row already exists, only the
 * mobile key + capture time are updated; otherwise a minimal row is created so a
 * mobile-only capture still shows up.
 */
export async function upsertMobileCapture(
  env: Env,
  week: string,
  portal: PortalRow,
  r2KeyMobile: string,
  plan: string | null = null,
  /** Hold the capture until a release (local uploads); an already held capture stays held either way. */
  held = false
): Promise<void> {
  const id = `${portal.slug}-${week}`;
  const now = new Date().toISOString();
  const withPlan = await hasPlanColumn(env);
  const withHeld = await hasHeldColumn(env);
  await env.DB.prepare(
    `INSERT INTO captures
      (id, week, slug, portal, company, url, brand, r2_key, r2_key_mobile, width, height, palette, analysis, analysis_by, status, captured_at${withPlan ? ", plan" : ""}${withHeld ? ", held" : ""})
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${withPlan ? ",?" : ""}${withHeld ? ",?" : ""})
     ON CONFLICT(id) DO UPDATE SET
      r2_key_mobile=excluded.r2_key_mobile, captured_at=excluded.captured_at${withPlan ? ", plan=COALESCE(captures.plan, excluded.plan)" : ""}${withHeld ? ", held=MAX(captures.held, excluded.held)" : ""}`
  ).bind(
    id, week, portal.slug, portal.name, portal.company, portal.url, portal.brand,
    null, r2KeyMobile, 390, 844, JSON.stringify(paletteFromBrand(portal.brand)),
    "", "sample", "ok", now, ...(withPlan ? [plan] : []), ...(withHeld ? [held ? 1 : 0] : [])
  ).run();
}

// ---------- colour helpers (deterministic palette from a brand hex) ----------
function clamp(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("");
}
function mix(hex: string, target: string, amt: number) {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(target);
  return rgbToHex(r1 + (r2 - r1) * amt, g1 + (g2 - g1) * amt, b1 + (b2 - b1) * amt);
}

/** 5-swatch palette derived from a brand colour: paper, tint, brand, ink, muted. */
export function paletteFromBrand(brand: string): string[] {
  return [
    mix(brand, "#ffffff", 0.93),
    mix(brand, "#ffffff", 0.72),
    brand,
    mix(brand, "#111111", 0.55),
    mix(brand, "#ffffff", 0.4),
  ];
}

/** Newest successful public capture for one portal (read-only). Every read-only query below leaves out held captures. */
export async function latestCaptureForPortal(env: Env, slug: string): Promise<CaptureRow | null> {
  return await env.DB.prepare(
    `SELECT c.*, ${await previousPlan(env)} FROM captures c WHERE c.slug = ? AND c.status = 'ok' AND ${await notHeld(env)} ORDER BY c.week DESC LIMIT 1`
  ).bind(slug).first<CaptureRow>();
}

/** Successful capture for one portal in one week (read-only). */
export async function captureForPortalWeek(env: Env, slug: string, week: string): Promise<CaptureRow | null> {
  return await env.DB.prepare(
    `SELECT c.*, ${await previousPlan(env)} FROM captures c WHERE c.slug = ? AND c.week = ? AND c.status = 'ok' AND ${await notHeld(env)} LIMIT 1`
  ).bind(slug, week).first<CaptureRow>();
}

/** Every week with a successful capture for one portal, newest first (read-only). */
export async function captureWeeksForPortal(env: Env, slug: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.week AS week FROM captures c WHERE c.slug = ? AND c.status = 'ok' AND ${await notHeld(env)} ORDER BY c.week DESC`
  ).bind(slug).all<{ week: string }>();
  return (results ?? []).map((r) => r.week);
}

/** Successful desktop captures (with a screenshot) on active portals, portal order, newest week first; all portals, or only `slugs` (/compare pages; read-only). */
export async function compareCaptures(env: Env, slugs?: string[]): Promise<CaptureRow[]> {
  const only = slugs ? ` AND c.slug IN (${slugs.map(() => "?").join(", ")})` : "";
  const { results } = await env.DB.prepare(
    `SELECT c.*, ${await previousPlan(env)} FROM captures c JOIN portals p ON p.slug = c.slug
     WHERE c.status = 'ok' AND p.active = 1 AND c.r2_key IS NOT NULL AND ${await notHeld(env)}${only}
     ORDER BY p.sort_order ASC, p.name ASC, c.week DESC`
  ).bind(...(slugs ?? [])).all<CaptureRow>();
  return results ?? [];
}

export type FeedCapture = { slug: string; week: string; name: string; analysis: string; analysis_by: string; analysis_json: string | null; captured_at: string; analysis_published_at: string | null };

/** Published guideline analyses on active portals, newest first (RSS feed; read-only). */
export async function feedCaptures(env: Env, limit = 200): Promise<FeedCapture[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.slug AS slug, c.week AS week, p.name AS name, c.analysis AS analysis, c.analysis_by AS analysis_by, c.analysis_json AS analysis_json,
            c.captured_at AS captured_at, c.analysis_published_at AS analysis_published_at
     FROM captures c JOIN portals p ON p.slug = c.slug
     WHERE c.status = 'ok' AND p.active = 1 AND ${await notHeld(env)} AND c.analysis_by LIKE 'guideline-v%' AND TRIM(COALESCE(c.analysis, '')) != ''
     ORDER BY COALESCE(c.analysis_published_at, c.captured_at) DESC, p.sort_order ASC LIMIT ?`
  ).bind(limit).all<FeedCapture>();
  return results ?? [];
}

export type SitemapCapture = { slug: string; week: string; r2_key: string | null; r2_key_mobile: string | null; captured_at: string; analysis_published_at: string | null };

/** Every successful capture on an active portal, with its screenshot keys (sitemap; read-only). */
export async function sitemapCaptures(env: Env): Promise<SitemapCapture[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.slug AS slug, c.week AS week, c.r2_key AS r2_key, c.r2_key_mobile AS r2_key_mobile, c.captured_at AS captured_at,
            c.analysis_published_at AS analysis_published_at
     FROM captures c JOIN portals p ON p.slug = c.slug
     WHERE c.status = 'ok' AND p.active = 1 AND ${await notHeld(env)} ORDER BY p.sort_order ASC, c.week DESC`
  ).all<SitemapCapture>();
  return results ?? [];
}

export type PublishedCapture = {
  slug: string; week: string; name: string; company: string; status: string; analysis: string; analysis_by: string;
  analysis_json: string | null; captured_at: string; analysis_published_at: string | null;
  plan: string | null; previous_plan: string | null;
};

/** Published guideline analyses on active portals, in portal order, newest week first (/changes, /llms-full.txt; read-only). */
export async function publishedCaptures(env: Env): Promise<PublishedCapture[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.slug AS slug, c.week AS week, p.name AS name, p.company AS company, c.status AS status, c.analysis AS analysis,
            c.analysis_by AS analysis_by, c.analysis_json AS analysis_json, c.captured_at AS captured_at,
            c.analysis_published_at AS analysis_published_at, ${(await hasPlanColumn(env)) ? "c.plan" : "NULL"} AS plan, ${await previousPlan(env)}
     FROM captures c JOIN portals p ON p.slug = c.slug
     WHERE c.status = 'ok' AND p.active = 1 AND ${await notHeld(env)} AND c.analysis_by LIKE 'guideline-v%' AND TRIM(COALESCE(c.analysis, '')) != ''
     ORDER BY p.sort_order ASC, p.name ASC, c.week DESC`
  ).all<PublishedCapture>();
  return results ?? [];
}

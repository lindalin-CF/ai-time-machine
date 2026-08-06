import type { Env, PortalRow, CaptureRow } from "./types";

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

/** Archived weeks, newest first. */
export async function listWeeks(env: Env): Promise<{ week: string; label: string; portal_count: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT week, label, portal_count FROM weeks ORDER BY week DESC`
  ).all<{ week: string; label: string; portal_count: number }>();
  return results ?? [];
}

export async function latestWeek(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT week FROM weeks ORDER BY week DESC LIMIT 1`).first<{ week: string }>();
  return row?.week ?? null;
}

/** Captures for a given week (or the latest week when omitted). */
export async function capturesForWeek(env: Env, week: string): Promise<CaptureRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.* FROM captures c
     JOIN portals p ON p.slug = c.slug
     WHERE c.week = ?
     ORDER BY p.sort_order ASC, c.portal ASC`
  ).bind(week).all<CaptureRow>();
  return results ?? [];
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
    `UPDATE weeks SET portal_count = (SELECT COUNT(*) FROM captures WHERE week = ? AND status = 'ok') WHERE week = ?`
  ).bind(week, week).run();
}

export async function upsertCapture(env: Env, row: CaptureRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO captures
      (id, week, slug, portal, company, url, brand, r2_key, width, height, palette, analysis, analysis_by, status, captured_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
      r2_key=excluded.r2_key, width=excluded.width, height=excluded.height,
      palette=excluded.palette, analysis=excluded.analysis, analysis_by=excluded.analysis_by,
      status=excluded.status, captured_at=excluded.captured_at`
  ).bind(
    row.id, row.week, row.slug, row.portal, row.company, row.url, row.brand,
    row.r2_key, row.width, row.height, row.palette, row.analysis, row.analysis_by,
    row.status, row.captured_at
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

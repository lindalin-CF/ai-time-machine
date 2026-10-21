// Shareable Compare links: the whole Compare setup lives in the hash after #compare, e.g.
//   #compare?view=canvas&mode=time&portal=chatgpt&weeks=2026-10-12,2026-10-05&device=desktop&zoom=1.28&pan=12,-40&layout=<base64url>
// mode=time is Single portal (one portal, several weeks; "weeks" in app.js), mode=portals is Across portals
// (one week, several portals). Compare was called Analytics: #analytics links, already shared, still open it
// (compareHash() rewrites them). Nothing is sent to the server. Everything read back is validated against
// the portals and weeks the site actually has.

import { ZOOM_MIN, ZOOM_MAX } from "./analytics-canvas.js";

const ROUTE = "#compare";
/** Compare's old route, kept working forever for links already shared. */
const OLD_ROUTE = "#analytics";
/** Longest layout string accepted from a URL; a full board of four cards and six lines is a few hundred characters. */
const LAYOUT_MAX_CHARS = 4000;
/** Card positions, box offsets and pan are kept within this many pixels of the origin. */
const COORD_MAX = 100000;

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const clampCoord = (n) => Math.max(-COORD_MAX, Math.min(COORD_MAX, Math.round(n)));

const pairKey = (a, b) => [a, b].sort().join("\u0000");

/**
 * Cards and lines on the board as a short URL-safe string: base64url of {"p":[[id,x,y],…],"e":[[i,j],…]},
 * where each line is a pair of indexes into p (from, to). A line whose box was moved off the line's midpoint
 * has the offset after them, [i,j,dx,dy] (links from before box offsets have none). Positions and offsets are
 * whole pixels. Only cards in `ids` and lines between two of them are kept. `offsets` is keyed like the
 * canvas's lines (the two ids, sorted, joined by U+0000).
 */
export function encodeLayout({ pos, edges, offsets }, ids) {
  const keep = ids.filter((id) => pos[id] && Number.isFinite(pos[id].x) && Number.isFinite(pos[id].y));
  const index = new Map(keep.map((id, i) => [id, i]));
  const p = keep.map((id) => [id, clampCoord(pos[id].x), clampCoord(pos[id].y)]);
  const e = (edges || []).filter(([a, b]) => index.has(a) && index.has(b) && a !== b).map(([a, b]) => {
    const o = offsets && Object.hasOwn(offsets, pairKey(a, b)) ? offsets[pairKey(a, b)] : null;
    const dx = o && Number.isFinite(o.dx) ? clampCoord(o.dx) : 0, dy = o && Number.isFinite(o.dy) ? clampCoord(o.dy) : 0;
    return dx || dy ? [index.get(a), index.get(b), dx, dy] : [index.get(a), index.get(b)];
  });
  return toBase64Url(JSON.stringify({ p, e }));
}

/**
 * The layout back from encodeLayout: { pos, edges }, plus `offsets` (by line key) when any box was moved,
 * keeping only ids that pass `isId`. Returns null when the string is not a layout or holds no usable card.
 */
export function decodeLayout(s, isId = () => true) {
  if (typeof s !== "string" || !s || s.length > LAYOUT_MAX_CHARS || /[^A-Za-z0-9_-]/.test(s)) return null;
  let data;
  try { data = JSON.parse(fromBase64Url(s)); } catch { return null; }
  if (!data || typeof data !== "object" || !Array.isArray(data.p)) return null;
  const pos = {};
  const byIndex = [];
  for (const item of data.p) {
    const ok = Array.isArray(item) && typeof item[0] === "string" && Number.isFinite(item[1]) && Number.isFinite(item[2]);
    const id = ok && isId(item[0]) && !Object.hasOwn(pos, item[0]) ? item[0] : null;
    byIndex.push(id);
    if (id) pos[id] = { x: clampCoord(item[1]), y: clampCoord(item[2]) };
  }
  const edges = [];
  const offsets = {};
  const seen = new Set();
  for (const item of Array.isArray(data.e) ? data.e : []) {
    if (!Array.isArray(item) || !Number.isInteger(item[0]) || !Number.isInteger(item[1])) continue;
    const a = byIndex[item[0]], b = byIndex[item[1]];
    const key = [a, b].sort().join("\u0000");
    if (!a || !b || a === b || seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
    if (Number.isFinite(item[2]) && Number.isFinite(item[3])) {
      const dx = clampCoord(item[2]), dy = clampCoord(item[3]);
      if (dx || dy) offsets[key] = { dx, dy };
    }
  }
  if (!Object.keys(pos).length) return null;
  return Object.keys(offsets).length ? { pos, edges, offsets } : { pos, edges };
}

const list = (v) => v.map(encodeURIComponent).join(",");

/**
 * The hash for a Compare setup. s: { view, mode ("portals" | "weeks"), portal, weeks[], week, portals[],
 * device, canvas: { pos, edges, offsets, cam: {x, y, k}, ids } | null }. Canvas fields are written only for the Canvas view.
 */
export function buildAnalyticsHash(s) {
  const parts = [`view=${s.view === "canvas" ? "canvas" : "table"}`];
  if (s.mode === "weeks") {
    parts.push("mode=time");
    if (s.portal) parts.push(`portal=${encodeURIComponent(s.portal)}`);
    parts.push(`weeks=${list(s.weeks || [])}`);
  } else {
    parts.push("mode=portals");
    if (s.week) parts.push(`week=${encodeURIComponent(s.week)}`);
    parts.push(`portals=${list(s.portals || [])}`);
  }
  parts.push(`device=${s.device === "mobile" ? "mobile" : "desktop"}`);
  const c = s.view === "canvas" ? s.canvas : null;
  if (c) {
    const cam = c.cam || {};
    if (Number.isFinite(cam.k)) parts.push(`zoom=${Math.round(cam.k * 100) / 100}`);
    if (Number.isFinite(cam.x) && Number.isFinite(cam.y)) parts.push(`pan=${clampCoord(cam.x)},${clampCoord(cam.y)}`);
    if (c.pos) parts.push(`layout=${encodeLayout(c, c.ids || Object.keys(c.pos))}`);
  }
  return `${ROUTE}?${parts.join("&")}`;
}

/** The route part of a hash: "#compare?view=…" → "#compare". */
export function hashRoute(hash) {
  const i = String(hash || "").indexOf("?");
  return i < 0 ? String(hash || "") : hash.slice(0, i);
}

/** An old #analytics hash as #compare, keeping its setup: "#analytics?view=…" → "#compare?view=…". Other hashes are returned unchanged. */
export function compareHash(hash) {
  hash = String(hash || "");
  return hashRoute(hash) === OLD_ROUTE ? ROUTE + hash.slice(OLD_ROUTE.length) : hash;
}

/**
 * Read a Compare setup back from a hash. known: { portals: slugs[], weeks: weeks[] (newest first), max }.
 * Returns null when the hash has no parameters (plain #compare links: defaults and localStorage apply).
 * Otherwise returns only the fields that passed validation; a field left out keeps its default.
 * `canvas` is set for the Canvas view: { layout: {pos, edges, offsets?} | null, zoom: number | null, pan: [x, y] | null }.
 */
export function parseAnalyticsHash(hash, known) {
  hash = compareHash(hash);
  if (hashRoute(hash) !== ROUTE) return null;
  const query = hash.slice(ROUTE.length + 1);
  if (!query) return null;
  const q = new URLSearchParams(query);
  const portalSet = new Set(known.portals);
  const weekSet = new Set(known.weeks);
  const max = known.max;
  const pick = (raw, allowed) => {
    const out = [];
    for (const v of String(raw || "").split(",")) {
      if (allowed.has(v) && !out.includes(v) && out.length < max) out.push(v);
    }
    return out;
  };
  const out = {};
  const view = q.get("view");
  if (view === "table" || view === "canvas") out.view = view;
  const mode = q.get("mode");
  if (mode === "time") out.mode = "weeks";
  else if (mode === "portals") out.mode = "portals";
  const device = q.get("device");
  if (device === "desktop" || device === "mobile") out.device = device;
  if (portalSet.has(q.get("portal"))) out.portal = q.get("portal");
  if (weekSet.has(q.get("week"))) out.week = q.get("week");
  if (q.has("weeks")) {
    const weeks = pick(q.get("weeks"), weekSet);
    // Keep the site's order (newest first), like the week picker does.
    if (weeks.length) out.weeks = known.weeks.filter((w) => weeks.includes(w));
  }
  if (q.has("portals")) {
    const portals = pick(q.get("portals"), portalSet);
    if (portals.length) out.portals = known.portals.filter((p) => portals.includes(p));
  }
  if (out.view === "canvas") {
    const zoom = Number(q.get("zoom"));
    const pan = String(q.get("pan") || "").split(",").map(Number);
    const ids = out.mode === "weeks" ? weekSet : portalSet;
    out.canvas = {
      zoom: q.has("zoom") && Number.isFinite(zoom) && zoom > 0 ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) : null,
      pan: q.has("pan") && pan.length === 2 && pan.every(Number.isFinite) ? pan.map(clampCoord) : null,
      layout: q.has("layout") ? decodeLayout(q.get("layout"), (id) => ids.has(id)) : null,
    };
  }
  return out;
}

/**
 * The Compare link for the landing page's Browse | Compare switch, in the format Copy link writes.
 * s: { selection[] (selected slugs in site order; empty for All portals), week (the week on screen), weeks[] (newest first),
 * portals[] (site order), device }. All portals: one week, Compare's default portals. One portal: that portal over this
 * week and the nearest older one, or, when there is no older week, that portal next to Compare's usual second default.
 * Several portals: those portals side by side for this week (at most 4, Compare's limit). It always opens the Table.
 */
export function libraryCompareHash(s) {
  const view = "table";
  const device = s.device === "mobile" ? "mobile" : "desktop";
  const week = s.week || null;
  const selection = s.selection || [];
  if (selection.length > 1) return buildAnalyticsHash({ view, mode: "portals", week, portals: selection.slice(0, 4), device });
  s = { ...s, portal: selection[0] || null };
  if (!s.portal) return `${ROUTE}?view=${view}&mode=portals${week ? `&week=${encodeURIComponent(week)}` : ""}&device=${device}`;
  const weeks = s.weeks || [];
  const older = week ? weeks[weeks.indexOf(week) + 1] : undefined;
  if (week && weeks.includes(week) && older) {
    return buildAnalyticsHash({ view, mode: "weeks", portal: s.portal, weeks: [week, older], device });
  }
  const second = (s.portals || []).slice(0, 2).find((p) => p !== s.portal) || (s.portals || []).find((p) => p !== s.portal);
  return buildAnalyticsHash({ view, mode: "portals", week, portals: second ? [s.portal, second] : [s.portal], device });
}

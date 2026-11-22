// The homepage hero's timeline (public/timeline-hero.js, prototype docs/prototypes/timeline-hero.html): one simplified
// wireframe per week of one product, drawn from the published analysis's region boxes. Only region roles and boxes leave
// this module: never a region's label or note, text from the screenshot, colours, metric IDs or account-specific areas.
// Like the message box and greeting tops in src/capture-metrics.ts, boxes are CSS px on the 1280 x 800 desktop screen,
// snapped to the analyses' own 10px grid.
// L1 is stored in two shapes: a list of { region, location | bbox }, or one sentence with inline [x, y, w, h] boxes.
// The message box comes from L3's location when it has one (a measured box), the greeting from D7's, and a sidebar the
// boxes don't give from L2's width. A region whose role can't be told from its label is left out.
// No imports, so the prototype's data script can load it with plain Node (type stripping).

export type Box = [x: number, y: number, w: number, h: number];
export type Wireframe = { sidebar: Box | null; topbar: Box | null; heading: Box | null; input: Box | null; cards: Box[] };

const W = 1280, H = 800, MAX_CARDS = 4;
type Region = { label: string; box: Box };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** A [x, y, w, h] on the screen, clipped to it and snapped to 10px; null when it isn't one or is (nearly) empty. */
function toBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x, y, w, h] = v as number[];
  const snap = (n: number) => Math.round(n / 10) * 10;
  const x0 = snap(Math.max(0, x)), y0 = snap(Math.max(0, y)), x1 = snap(Math.min(W, x + w)), y1 = snap(Math.min(H, y + h));
  return x1 - x0 >= 10 && y1 - y0 >= 10 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** L1's regions with their labels (labels stay in this module). */
function regions(value: unknown): Region[] {
  const out: Region[] = [];
  if (Array.isArray(value)) {
    for (const r of value) {
      if (!isObj(r) || typeof r.region !== "string") continue;
      const box = toBox(r.location ?? r.bbox);
      if (box) out.push({ label: r.region.toLowerCase(), box });
    }
  } else if (typeof value === "string") {
    // Each box takes the words since the previous box (or the start) as its label: "…; prompt input [380, 270, 770, 130]".
    const re = /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g;
    let last = 0;
    for (const m of value.matchAll(re)) {
      const label = value.slice(last, m.index).split(";").at(-1)!.toLowerCase(); // only this clause
      last = m.index! + m[0].length;
      const box = toBox(m.slice(1, 5).map(Number));
      if (box) out.push({ label, box });
    }
  }
  return out.filter((r) => !/account-specific|excluded/.test(r.label));
}

const metricOf = (metrics: unknown[], id: string): Obj | undefined => {
  const hits = metrics.filter((m) => isObj(m) && m.id === id);
  return hits.length === 1 ? (hits[0] as Obj) : undefined;
};

/** Sidebar width in px from L2 ("23%", 23, "about 23%"); 0 means no sidebar. */
function sidebarWidth(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat((/(\d+(?:\.\d+)?)\s*%/.exec(v) ?? [])[1] ?? "") : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round((n / 100) * W / 10) * 10 : null;
}

const overlap = (a: Box, b: Box) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) : 0;
};

/**
 * The wireframe of a published desktop analysis (analysis_json, parsed), or null when it isn't an ok 1280 x 800
 * desktop analysis or no message box can be placed (a frame without one says nothing).
 */
export function wireframe(a: unknown): Wireframe | null {
  if (!isObj(a) || a.status !== "ok" || a.variant !== "desktop") return null;
  if (a.viewport !== undefined && a.viewport !== "1280x800") return null;
  const metrics = Array.isArray(a.metrics) ? a.metrics : [];
  const rs = regions(metricOf(metrics, "L1")?.value);

  const sidebarR = rs
    .filter((r) => /sidebar|icon rail|side rail|navigation rail/.test(r.label) && r.box[0] <= 10 && r.box[2] <= 420 && r.box[3] >= 500)
    .sort((p, q) => q.box[3] - p.box[3] || q.box[2] - p.box[2])[0];
  let sidebar = sidebarR?.box ?? null;
  if (!sidebar) {
    const w = sidebarWidth(metricOf(metrics, "L2")?.value);
    if (w && w >= 30) sidebar = [0, 0, w, H];
  }
  const left = sidebar ? sidebar[0] + sidebar[2] : 0;

  const topbar = rs.find((r) => /top bar|topbar|header bar|banner/.test(r.label) && r.box[1] <= 10 && r.box[3] <= 90 && r.box[2] >= 400)?.box ?? null;

  // The message box: L3's measured box, else the L1 region labelled as one (not a row "below the prompt input").
  let input = toBox(metricOf(metrics, "L3")?.location);
  if (!input) {
    const named = rs.filter((r) => /prompt input|message box|input box|chat input|composer/.test(r.label) && !/(below|above|under|beside|next to) (the |a )?(prompt )?input/.test(r.label));
    input = (named.find((r) => /prompt input/.test(r.label)) ?? named[0])?.box ?? null;
  }
  if (!input) return null;

  // The heading: the one nearest above the message box (a section heading is a card list's, not the page's).
  const headings = rs.filter((r) => /heading|greeting|wordmark|title/.test(r.label) && !/section/.test(r.label) && r.box[0] >= left - 10 && r.box[2] >= 60 && r.box[3] <= 140);
  let heading = headings.filter((r) => r.box[1] < input![1]).sort((p, q) => q.box[1] - p.box[1])[0]?.box ?? null;
  if (!heading) {
    const d7 = metricOf(metrics, "D7");
    const box = typeof d7?.value === "string" && d7.value.trim() ? toBox(d7.location) : null;
    if (box && box[2] >= 60 && box[3] <= 140) heading = box;
  }

  const cards = rs
    .filter((r) => /card|chip|suggest|prompts|prompt list|task|topic|section|tile|bots/.test(r.label) && !/heading|input|sidebar/.test(r.label.replace(/\(.*?\)/g, "")))
    .map((r) => r.box)
    .filter((b) => b[0] >= left - 10 && b[2] >= 60 && b[3] >= 20 && overlap(b, input!) < 0.5 && (!heading || overlap(b, heading) < 0.5))
    .filter((b, i, all) => all.findIndex((o) => overlap(o, b) > 0.8) === i)
    .sort((p, q) => p[1] - q[1] || p[0] - q[0])
    .slice(0, MAX_CARDS);

  return { sidebar, topbar, heading, input, cards };
}

export type TimelineFrame = { week: string; n: number; label: string; boxes: Wireframe };
export type HeroTimeline = { slug: string; name: string; frames: TimelineFrame[] };

/** "Week of Nov 16, 2026" -> "Nov 16" */
export const shortWeek = (label: string) => (/^Week of (.+), \d{4}$/.exec(label)?.[1] ?? label);

// ---- Markup (src/homepage.ts and the prototype's data script) ----

/** One drawn rect: x, y, w, h on the 1280 x 800 viewBox, and its opacity (0: the region is absent that week). */
export type Shape = [x: number, y: number, w: number, h: number, o: number];
/** Fixed slots, so two weeks' shapes pair up for the morph: sidebar, top bar, heading, message box, then MAX_CARDS cards. */
export const SLOTS = ["sb", "tb", "hd", "in", ...Array.from({ length: MAX_CARDS }, () => "cd")] as const;
const NONE: Shape = [0, 0, 0, 0, 0];

/** The rects a frame draws. A heading is a bar at most 36 units tall, centred in its box (its box may hold a logo too). */
export function shapes(w: Wireframe): Shape[] {
  const s = (b: Box | null): Shape => (b ? [b[0], b[1], b[2], b[3], 1] : NONE);
  const hd: Shape = w.heading ? (() => { const [x, y, bw, h] = w.heading!; const bh = Math.min(h, 36); return [x, y + (h - bh) / 2, bw, bh, 1]; })() : NONE;
  return [s(w.sidebar), s(w.topbar), hd, s(w.input), ...Array.from({ length: MAX_CARDS }, (_, i) => s(w.cards[i] ?? null))];
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const RX: Record<string, number> = { sb: 0, tb: 0, hd: 14, in: 36, cd: 22 };

/** The frame's SVG: one rect per slot, absent regions at opacity 0 so the script can fade them in. */
function svg(sh: Shape[]): string {
  const rects = sh.map(([x, y, w, h, o], i) => {
    const k = SLOTS[i];
    return `<rect class="w-${k}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX[k]}"${o ? "" : ' opacity="0"'}/>`;
  });
  return `<svg viewBox="0 0 1280 800" preserveAspectRatio="none" focusable="false" aria-hidden="true">${rects.join("")}</svg>`;
}

/** The hero's timeline strip, oldest week first, the latest highlighted; the script (public/timeline-hero.js) moves it. */
export function timelineHtml(t: HeroTimeline): string {
  const last = t.frames.length - 1;
  const frames = t.frames.map((f, i) => {
    const sh = shapes(f.boxes);
    const tip = `${t.name} · ${f.label}`;
    const latest = i === last;
    return `<a class="tl-frame${latest ? " is-latest" : ""}" href="/weeks/${escHtml(f.week)}" aria-label="${escHtml(tip)}" data-tip="${escHtml(tip)}" data-shapes="${escHtml(JSON.stringify(sh))}">`
      + `<span class="tl-label" aria-hidden="true">W${f.n} · ${escHtml(shortWeek(f.label))}</span>`
      + `<span class="tl-screen">${svg(sh)}${latest ? '<span class="tl-lock" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ""}</span></a>`;
  });
  return `<div class="hero-timeline" role="group" aria-label="${escHtml(`${t.name}, week by week`)}" data-slug="${escHtml(t.slug)}">`
    + `<div class="tl-view"><div class="tl-track">${frames.join("")}</div></div><span class="tl-tip" aria-hidden="true"></span></div>`;
}

/** The static page's empty slot for the strip (public/index.html), which the Worker fills. */
export const TIMELINE_SLOT = '<div class="hero-timeline" hidden></div>';

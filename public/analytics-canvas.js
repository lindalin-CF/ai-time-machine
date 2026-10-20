// Analytics "Canvas" view: screenshot cards on a pannable, zoomable board, joined by curved lines.
// Each line carries a box of short findings built only from the whitelisted `metrics` that
// /api/captures already returns (src/capture-metrics.ts), including the N1 navigation item names
// (navItems, navChanges). Nothing here writes to the server;
// card positions and lines are kept per viewer in localStorage, or come from a shared link
// (public/analytics-share.js).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- findings -------------------------------------------------------------
// Each finding states only what its metric measures, with both values. Thresholds for calling two
// values different follow the guideline's week-over-week reporting thresholds (section 9.3).

const fmtPct = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---- menu items (N1) --------------------------------------------------------
// Only visible changes are described (guideline section 8): never "launched", "redesigned" or
// "new feature". Menu lines come before every other finding.

const MENU = "menu items";
const NAV_CHANGE_LINES = 2;
const NAV_NAMES = 3;

/** One line per recorded change, e.g. "The sidebar item Scheduled is now labeled Tasks." */
function navChangeText(c) {
  if (c.change === "icon_changed") {
    return `The icon of ${/^[aeiou]/.test(c.region) ? "an" : "a"} ${c.region} button changed (${c.previous} \u2192 ${c.current}).`;
  }
  if (c.icon) {
    return c.change === "added"
      ? `An icon button (${c.current}) now appears in the ${c.region}.`
      : `An icon button (${c.previous}) no longer appears in the ${c.region}.`;
  }
  if (c.change === "renamed") return `The ${c.region} item ${c.previous} is now labeled ${c.current}.`;
  if (c.change === "added") return `A new ${c.current} item appears in the ${c.region}.`;
  return `The ${c.previous} item no longer appears in the ${c.region}.`;
}

/** An item without text is shown by its icon label: "an icon button (clock icon)". */
const navName = (it) => (it.icon ? `an icon button (${it.label})` : it.label);
const navKey = (it) => `${it.region}\u0000${it.icon ? "icon" : "text"}\u0000${it.label}`;
const navList = (items) => {
  const names = items.slice(0, NAV_NAMES).map((it) => `${navName(it)} (${it.region})`).join(", ");
  return items.length > NAV_NAMES ? `${names} and ${items.length - NAV_NAMES} more` : names;
};

/**
 * Menu findings for two cards ({ label, slug, week, metrics }): { diff, same, missing }.
 * Same portal and the newer card's navChanges compare against the other card's week: one line per
 * recorded change, up to `changeLines` (more become the first lines and "and N more menu changes").
 * Otherwise both cards' navItems are compared, leaving out the sidebar when either card's sidebar is
 * collapsed, and leaving out items without text unless both cards record some
 * (analyses before guideline v1.5.1 have no icon_label, so their icon buttons are not listed).
 * `brief`: the Table's wording, under a "<A> vs <B>" heading (see briefText below).
 */
function navFindings(a, b, A, B, ma, mb, changeLines, brief = false) {
  const samePortal = !!a.slug && a.slug === b.slug;
  if (samePortal && a.week && b.week && a.week !== b.week) {
    const [newer, olderWeek] = a.week > b.week ? [ma, b.week] : [mb, a.week];
    const nc = newer.navChanges;
    if (nc && nc.previousWeek === olderWeek && Array.isArray(nc.items) && nc.items.length) {
      const shown = changeLines - 1;
      const diff = nc.items.length > changeLines
        ? [...nc.items.slice(0, shown).map(navChangeText), `and ${nc.items.length - shown} more menu changes.`]
        : nc.items.map(navChangeText);
      return { diff, same: [], missing: [] };
    }
  }
  const missing = [[A, ma], [B, mb]].filter(([, m]) => !Array.isArray(m.navItems)).map(([label]) => label);
  if (missing.length) return { diff: [], same: [], missing };

  const noSidebar = ma.navSidebarVisible === false || mb.navSidebarVisible === false;
  const icons = ma.navItems.some((it) => it.icon) && mb.navItems.some((it) => it.icon);
  const keep = (items) => items.filter((it) => !(noSidebar && it.region === "sidebar") && (icons || !it.icon));
  const ia = keep(ma.navItems), ib = keep(mb.navItems);
  const where = noSidebar ? " outside the sidebar" : "";
  const kb = new Set(ib.map(navKey)), ka = new Set(ia.map(navKey));
  const onlyA = ia.filter((it) => !kb.has(navKey(it))), onlyB = ib.filter((it) => !ka.has(navKey(it)));
  if (!onlyA.length && !onlyB.length) return { diff: [], same: [`Both show the same ${MENU}${where}.`], missing: [] };
  if (!samePortal) {
    if (ia.length === ib.length) {
      return { diff: [], same: [brief ? `Both show ${word(ia.length, "menu item", MENU)}${where}.` : `${A} and ${B} each show ${word(ia.length, "menu item", MENU)}${where}.`], missing: [] };
    }
    return { diff: [`${A} shows ${word(ia.length, "menu item", MENU)}${where}${brief ? ";" : ","} ${B} shows ${ib.length}.`], same: [], missing: [] };
  }
  const diff = [];
  if (onlyB.length) diff.push(`${B} shows ${MENU} that ${A} does not: ${navList(onlyB)}.`);
  if (onlyA.length) diff.push(`${A} shows ${MENU} that ${B} does not: ${navList(onlyA)}.`);
  return { diff, same: [], missing: [] };
}

const RULES = [
  {
    key: "inputAreaPct",
    name: "message box size",
    differs: (a, b) => Math.abs(a - b) >= 1,
    text: (A, B, a, b) => a === b || Math.abs(a - b) < 1
      ? `${A}'s and ${B}'s message boxes cover a similar share of the screen (${fmtPct(a)} vs ${fmtPct(b)}).`
      : `${a > b ? A : B}'s message box covers more of the screen than ${a > b ? B : A}'s (${fmtPct(Math.max(a, b))} vs ${fmtPct(Math.min(a, b))}).`,
  },
  {
    key: "clickableApprox",
    name: "clickable items",
    differs: (a, b) => Math.abs(a - b) >= 3,
    // Counts are approximate (about ±2), so they are always shown with "~".
    text: (A, B, a, b) => Math.abs(a - b) < 3
      ? `${A} and ${B} show about the same number of clickable items (~${a} vs ~${b}).`
      : `${a > b ? A : B} shows more clickable items than ${a > b ? B : A} (~${Math.max(a, b)} vs ~${Math.min(a, b)}).`,
  },
  {
    key: "suggestedPrompts",
    name: "suggested prompts",
    differs: (a, b) => a !== b,
    text: (A, B, a, b) => a === b
      ? (a === 0 ? `Neither ${A} nor ${B} shows suggested prompts.` : `${A} and ${B} each show ${word(a, "suggested prompt", "suggested prompts")}.`)
      : `${A} shows ${a === 0 ? "no suggested prompts" : word(a, "suggested prompt", "suggested prompts")}, ${B} shows ${b === 0 ? "none" : b}.`,
  },
  {
    key: "sidebarPct",
    name: "sidebar width",
    differs: (a, b) => Math.abs(a - b) >= 5 || (a === 0) !== (b === 0),
    text: (A, B, a, b) => {
      if (a === 0 && b === 0) return `Neither ${A} nor ${B} shows a sidebar.`;
      if (a === 0 || b === 0) {
        const [has, n, none] = a === 0 ? [B, b, A] : [A, a, B];
        return `${has}'s sidebar takes ${fmtPct(n)} of the screen width, ${none} shows no sidebar.`;
      }
      return Math.abs(a - b) < 5
        ? `${A}'s and ${B}'s sidebars take a similar share of the screen width (${fmtPct(a)} vs ${fmtPct(b)}).`
        : `${a > b ? A : B}'s sidebar is wider than ${a > b ? B : A}'s (${fmtPct(Math.max(a, b))} vs ${fmtPct(Math.min(a, b))} of the screen width).`;
    },
  },
  {
    key: "textSizes",
    name: "text sizes",
    differs: (a, b) => a !== b,
    text: (A, B, a, b) => a === b
      ? `${A} and ${B} each use ${word(a, "text size", "text sizes")}.`
      : `${A} uses ${word(a, "text size", "text sizes")}, ${B} uses ${b}.`,
  },
  {
    key: "aiNote",
    name: "note about AI limits",
    differs: (a, b) => a !== b,
    text: (A, B, a, b) => a === b
      ? (a ? `${A} and ${B} both show a note about the AI's limits.` : `Neither ${A} nor ${B} shows a note about the AI's limits.`)
      : `${a ? A : B} shows a note about the AI's limits, ${a ? B : A} does not.`,
  },
  {
    key: "colorScheme",
    name: "color scheme",
    differs: (a, b) => a !== b,
    text: (A, B, a, b) => a === b
      ? `${A} and ${B} were both captured in ${a} mode.`
      : `${A} was captured in ${a} mode, ${B} in ${b} mode.`,
  },
  {
    key: "inputPosition",
    name: "message box position",
    differs: (a, b) => a !== b,
    text: (A, B, a, b) => a === b
      ? `Both message boxes sit in the ${a} third of the screen.`
      : `${A}'s message box sits in the ${a} third of the screen, ${B}'s in the ${b} third.`,
  },
];

/**
 * The Table's wording for each rule, used under a "<A> vs <B>" heading, so a line need not repeat both full names
 * or dates: similarities start with "Both" / "Neither", differences name each side once ("The newer week shows no
 * suggested prompts; the older shows 3."). A2 and B2 are the short second mention ("the older" for "the older week").
 */
const BRIEF = {
  inputAreaPct: (A, B, a, b) => Math.abs(a - b) < 1
    ? `Both message boxes cover about ${fmtPct(Math.round((a + b) / 2) || Math.round((a + b) * 5) / 10)} of the screen.`
    : null,
  clickableApprox: (A, B, a, b) => Math.abs(a - b) < 3 ? `Both show about the same number of clickable items (~${a} vs ~${b}).` : null,
  suggestedPrompts: (A, B, a, b, A2, B2) => a === b
    ? (a === 0 ? "Neither shows suggested prompts." : `Both show ${word(a, "suggested prompt", "suggested prompts")}.`)
    : `${A} shows ${a === 0 ? "no suggested prompts" : word(a, "suggested prompt", "suggested prompts")}; ${B2} shows ${b === 0 ? "none" : b}.`,
  sidebarPct: (A, B, a, b) => {
    if (a === 0 && b === 0) return "Neither shows a sidebar.";
    if (a === 0 || b === 0) return null;
    return Math.abs(a - b) < 5 ? `Both sidebars take a similar share of the screen width (${fmtPct(a)} vs ${fmtPct(b)}).` : null;
  },
  textSizes: (A, B, a, b, A2, B2) => a === b
    ? `Both use ${word(a, "text size", "text sizes")}.`
    : `${A} uses ${word(a, "text size", "text sizes")}; ${B2} uses ${b}.`,
  aiNote: (A, B, a, b, A2, B2) => a === b
    ? (a ? "Both show a note about the AI's limits." : "Neither shows a note about the AI's limits.")
    : `${a ? A : B} shows a note about the AI's limits; ${a ? B2 : A2} does not.`,
  colorScheme: (A, B, a, b, A2, B2) => a === b ? `Both were captured in ${a} mode.` : `${A} was captured in ${a} mode; ${B2} in ${b} mode.`,
};
/** A rule's line in the Table's wording, or in the Canvas wording where the brief one has nothing shorter to say. */
const briefText = (r, A, B, a, b, A2, B2) => (BRIEF[r.key] && BRIEF[r.key](A, B, a, b, A2, B2)) || r.text(A, B, a, b);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const cardLabel = (c) => (c && c.label) || "this capture";

/**
 * Every finding for two cards ({ label, slug, week, metrics }), sorted: { differences, similarities, missing }.
 * A field is compared only when both cards have it. Differences: menu findings first, then rules in rule
 * order; similarities: the same order. `missing` has one "No data for <card>: <fields>" phrase per card
 * that lacks fields. Only the whitelisted metrics and the thresholds above are used. `navChangeLines` caps
 * the recorded menu changes listed one by one (the Canvas box shows 2). `brief` gives the Table's wording (BRIEF above).
 */
export function findingLists(a, b, { navChangeLines = NAV_CHANGE_LINES, brief = false } = {}) {
  let A = cardLabel(a), B = cardLabel(b), A2 = A, B2 = B;
  // Brief, two weeks of one product: "the newer week" / "the older week" instead of their dates.
  if (brief && a && b && a.slug && a.slug === b.slug && a.week && b.week && a.week !== b.week) {
    [A, B] = a.week > b.week ? ["the newer week", "the older week"] : ["the older week", "the newer week"];
    [A2, B2] = [A.replace(/ week$/, ""), B.replace(/ week$/, "")];
  }
  const ma = (a && a.metrics) || {}, mb = (b && b.metrics) || {};
  const has = (m, k) => m[k] !== undefined && m[k] !== null;
  const nav = navFindings(a || {}, b || {}, A, B, ma, mb, navChangeLines, brief);
  const differences = [...nav.diff];
  const similarities = [...nav.same];
  for (const r of RULES) {
    if (!has(ma, r.key) || !has(mb, r.key)) continue;
    const x = ma[r.key], y = mb[r.key];
    (r.differs(x, y) ? differences : similarities).push(brief ? briefText(r, A, B, x, y, A2, B2) : r.text(A, B, x, y));
  }
  if (brief) {
    for (const list of [differences, similarities]) list.forEach((l, i) => { list[i] = capFirst(l); });
  }
  const missing = [[A, ma], [B, mb]]
    .map(([label, m]) => [label, [...(nav.missing.includes(label) ? [MENU] : []), ...RULES.filter((r) => !has(m, r.key)).map((r) => r.name)]])
    .filter(([, names]) => names.length)
    .map(([label, names]) => `No data for ${label}: ${names.join(", ")}`);
  return { differences, similarities, missing };
}

/**
 * The Canvas comparison box: up to 4 one-line findings. Differences first; similarities fill up to two
 * lines. With room left, one line names the fields missing for either card ("No data").
 */
export function compareFindings(a, b) {
  const { differences, similarities, missing } = findingLists(a, b);
  if (!differences.length && !similarities.length) return [`No comparable data for ${cardLabel(a)} and ${cardLabel(b)}.`];
  const lines = [...differences];
  for (const s of similarities) { if (lines.length >= 2) break; lines.push(s); }
  const out = lines.slice(0, 4);
  if (out.length < 4 && missing.length) out.push(`${missing.join("; ")}.`);
  return out;
}

// ---- Table rows: Differences and Similarities (public/app.js) ---------------

const TABLE_DIFFERENCES = 6;
const TABLE_SIMILARITIES = 5;

/**
 * The Table's lists for two cards, in the brief wording (each list sits under a "<A> vs <B>" heading): every menu
 * change, then the other differences, at most 6 lines (the last says "and N more differences" when there are more);
 * at most 5 similarities. Null when the two cards have no field in common.
 */
export function tableFindings(a, b) {
  const { differences, similarities } = findingLists(a, b, { navChangeLines: Infinity, brief: true });
  if (!differences.length && !similarities.length) return null;
  const shown = TABLE_DIFFERENCES - 1;
  return {
    differences: differences.length > TABLE_DIFFERENCES
      ? [...differences.slice(0, shown), `and ${differences.length - shown} more differences`]
      : differences,
    similarities: similarities.slice(0, TABLE_SIMILARITIES),
  };
}

/**
 * One Table cell's content for one list ("differences" | "similarities"): a muted heading ("vs Oct 5"),
 * an optional muted note, then the bullet list, or a muted line when there is nothing to list.
 * `findings` is tableFindings() output (null: not enough data). All text is escaped.
 */
export function findingsCellHTML(findings, kind, { heading = "", note = "" } = {}) {
  const head = heading ? `<div class="an-cmp-head">${esc(heading)}</div>` : "";
  const sub = note && findings ? `<div class="an-cmp-note">${esc(note)}</div>` : "";
  if (!findings) return `${head}<div class="an-cmp-empty">Not enough data to compare</div>`;
  const list = findings[kind];
  if (!list.length) return `${head}${sub}<div class="an-cmp-empty">${kind === "differences" ? "No differences found" : "No similarities found"}</div>`;
  return `${head}${sub}<ul class="an-cmp-list">${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

// ---- layout geometry -------------------------------------------------------

const CARD_W = 280;
const GAP = 260;
export const ZOOM_MIN = 0.25, ZOOM_MAX = 2;
/** Zoom a board opens at when nothing saved or linked sets one: the cards centred across, their top TOP_PAD below the
 * board's top edge. Narrower boards fit instead. */
const ZOOM_DEFAULT = 1.36, ZOOM_DEFAULT_MIN_WIDTH = 760, TOP_PAD = 32;
/** Pixels a press must travel before it drags; anything shorter is a click. */
const DRAG_THRESHOLD = 3;

/** Default positions: cards in one row. */
export function defaultLayout(ids) {
  const pos = {};
  ids.forEach((id, i) => { pos[id] = { x: i * (CARD_W + GAP), y: 0 }; });
  return pos;
}

/** Default lines: the first card to each of the others. */
export function defaultEdges(ids) {
  return ids.slice(1).map((id) => [ids[0], id]);
}

/** Bezier from an output handle (x0, y0) to an input handle (x3, y3). Long, level spans arc below the row. */
export function edgeCurve(x0, y0, x3, y3, cardH = 0) {
  const L = x3 - x0;
  const dx = Math.max(80, Math.abs(L) / 2);
  const bow = L > GAP * 2.2 && Math.abs(y3 - y0) < cardH ? Math.min(900, (L - GAP) * 0.5) : 0;
  const p1 = [x0 + dx, y0 + bow], p2 = [x3 - dx, y3 + bow];
  const mid = [(x0 + 3 * p1[0] + 3 * p2[0] + x3) / 8, (y0 + 3 * p1[1] + 3 * p2[1] + y3) / 8];
  return { d: `M${x0},${y0} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${x3},${y3}`, mid };
}

const pairKey = (a, b) => [a, b].sort().join("\u0000");

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function forget(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// ---- view ----------------------------------------------------------------------

let current = null; // { destroy() } of the mounted view

/**
 * Render the canvas (or, on narrow screens, the stacked fallback) into `root`.
 * cards: [{ id, label, sub, src, alt, size: {width, height}, file, metrics }]
 * opts:  { storageKey, thumbUrl(src, width), tools, note, shared, onChange } — tools holds the zoom group
 *        and reset button, note the drag instructions; both are shown only while the board is mounted.
 *        shared: the setup from a link ({ layout: {pos, edges} | null, zoom, pan: [x, y] }); when set, it is
 *        used instead of localStorage, and localStorage is left alone until the viewer changes something.
 *        onChange() runs after every change the viewer makes (drag, pan, zoom, lines, reset).
 */
export function mountAnCanvas(root, cards, opts) {
  if (current) current.destroy();
  const narrow = window.matchMedia("(max-width: 720px)");
  let view = null;
  const draw = () => {
    if (view) view.destroy();
    view = narrow.matches ? mountStack(root, cards, opts) : mountBoard(root, cards, opts);
  };
  narrow.addEventListener("change", draw);
  draw();
  current = {
    destroy() { narrow.removeEventListener("change", draw); if (view) view.destroy(); },
    state() { return view && view.state ? view.state() : null; },
  };
}

/** The mounted board's { ids, pos, edges, cam }, or null (no board, or the stacked narrow view). */
export function anCanvasState() {
  return current ? current.state() : null;
}

export function unmountAnCanvas() {
  if (current) current.destroy();
  current = null;
}

function cardHTML(c, opts, width) {
  const ratio = c.size && c.size.width > 0 ? c.size.height / c.size.width : 0.625;
  const shot = c.src
    ? `<div class="anc-thumb" data-full="${esc(c.src)}" data-title="${esc(c.label)}" data-file="${esc(c.file)}"><img draggable="false" loading="lazy" src="${esc(opts.thumbUrl(c.src, width * 2))}" alt="${esc(c.alt)}" width="${width}" height="${Math.round(width * ratio)}" /></div>`
    : `<div class="anc-noshot">No capture</div>`;
  return `<div class="anc-card-head"><span class="anc-card-title">${esc(c.label)}</span><span class="anc-card-sub">${esc(c.sub)}</span></div>${shot}`;
}

function boxHTML(a, b, removable) {
  const lines = compareFindings(a, b);
  const x = removable
    ? `<button class="anc-box-x" type="button" data-remove aria-label="Remove comparison of ${esc(a.label)} and ${esc(b.label)}" title="Remove">×</button>`
    : "";
  return `<div class="anc-box-head"><span>${esc(a.label)} → ${esc(b.label)}</span>${x}</div><ul class="anc-box-list">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

/** Narrow screens: cards one after another, with a comparison box between neighbours. */
function mountStack(root, cards, opts) {
  const parts = [];
  cards.forEach((c, i) => {
    if (i > 0) parts.push(`<div class="anc-box anc-box--stack">${boxHTML(cards[i - 1], c, false)}</div>`);
    parts.push(`<div class="anc-card anc-card--stack">${cardHTML(c, opts, 640)}</div>`);
  });
  root.innerHTML = `<p class="anc-note">Desktop screenshots. Findings come from each capture's published design analysis.</p><div class="anc-stack">${parts.join("")}</div>`;
  return { destroy() { root.innerHTML = ""; } };
}

function mountBoard(root, cards, opts) {
  const ids = cards.map((c) => c.id);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const shared = opts.shared || null;
  const stored = shared ? null : load(opts.storageKey);
  const pos = defaultLayout(ids);
  let edges = defaultEdges(ids);
  let cam = null;
  let sharedZoom = null; // a link's zoom without a pan: applied around the centre after fitting
  if (shared) {
    const l = shared.layout;
    if (l) {
      for (const id of ids) if (l.pos[id]) pos[id] = { x: l.pos[id].x, y: l.pos[id].y };
      edges = l.edges.filter((e) => byId.has(e[0]) && byId.has(e[1]) && e[0] !== e[1]);
    }
    if (shared.pan) cam = { x: shared.pan[0], y: shared.pan[1], k: clampZoom(shared.zoom || 1) };
    else if (shared.zoom) sharedZoom = shared.zoom;
  } else if (stored && typeof stored === "object") {
    for (const id of ids) {
      const p = stored.pos && stored.pos[id];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pos[id] = { x: p.x, y: p.y };
    }
    if (Array.isArray(stored.edges)) {
      edges = stored.edges.filter((e) => Array.isArray(e) && byId.has(e[0]) && byId.has(e[1]) && e[0] !== e[1]);
    }
    const v = stored.cam;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.k)) cam = { x: v.x, y: v.y, k: clampZoom(v.k) };
  }

  root.innerHTML = `
    <div class="anc-board" tabindex="0" role="region" aria-label="Comparison canvas. Select a line and press Delete to remove it.">
      <div class="anc-world">
        <svg class="anc-edges" width="1" height="1" aria-hidden="true"><path class="anc-ghost" d="" /></svg>
      </div>
    </div>`;

  const board = root.querySelector(".anc-board");
  const world = root.querySelector(".anc-world");
  const svg = root.querySelector(".anc-edges");
  const ghost = root.querySelector(".anc-ghost");
  // Zoom group, reset button and the instruction note live above the results (public/index.html);
  // they show while a board is mounted.
  const { tools, note } = opts;
  const pct = tools.querySelector(".anc-zoom-pct");

  const cardEls = new Map();
  for (const c of cards) {
    const el = document.createElement("div");
    el.className = "anc-card";
    el.dataset.id = c.id;
    el.innerHTML = `${cardHTML(c, opts, CARD_W)}<span class="anc-handle anc-handle--in" data-handle="in" aria-hidden="true"></span><span class="anc-handle anc-handle--out" data-handle="out" aria-hidden="true"></span>`;
    world.appendChild(el);
    cardEls.set(c.id, el);
  }

  let selected = null; // pair key of the selected line
  const edgeEls = new Map(); // pair key -> { path, hit, box }

  // A link's setup becomes this viewer's own (saved) on their first change; until then localStorage is untouched.
  let adopt = !!shared;
  const notify = () => {
    if (adopt) { adopt = false; save(opts.storageKey, { pos, edges, cam }); }
    if (opts.onChange) opts.onChange();
  };
  const persist = () => { save(opts.storageKey, { pos, edges, cam }); adopt = false; notify(); };

  function placeCards() {
    for (const [id, el] of cardEls) el.style.transform = `translate(${pos[id].x}px, ${pos[id].y}px)`;
  }
  function handlePoint(id, side) {
    const el = cardEls.get(id);
    const w = el.offsetWidth, h = el.offsetHeight;
    return { x: pos[id].x + (side === "out" ? w : 0), y: pos[id].y + h / 2, h };
  }
  function buildEdges() {
    for (const { path, hit, box } of edgeEls.values()) { path.remove(); hit.remove(); box.remove(); }
    edgeEls.clear();
    for (const [from, to] of edges) {
      const k = pairKey(from, to);
      const ns = "http://www.w3.org/2000/svg";
      const hit = document.createElementNS(ns, "path");
      hit.setAttribute("class", "anc-edge-hit");
      hit.dataset.edge = k;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("class", "anc-edge");
      svg.insertBefore(path, ghost);
      svg.insertBefore(hit, ghost);
      const box = document.createElement("div");
      box.className = "anc-box";
      box.dataset.edge = k;
      box.innerHTML = boxHTML(byId.get(from), byId.get(to), true);
      world.appendChild(box);
      edgeEls.set(k, { path, hit, box, from, to });
    }
    markSelected();
    routeEdges();
  }
  function routeEdges() {
    for (const e of edgeEls.values()) {
      const a = handlePoint(e.from, "out"), b = handlePoint(e.to, "in");
      const { d, mid } = edgeCurve(a.x, a.y, b.x, b.y, Math.max(a.h, b.h));
      e.path.setAttribute("d", d);
      e.hit.setAttribute("d", d);
      e.box.style.transform = `translate(${mid[0]}px, ${mid[1]}px) translate(-50%, -50%)`;
    }
  }
  function markSelected() {
    for (const [k, e] of edgeEls) {
      const on = k === selected;
      e.path.classList.toggle("is-selected", on);
      e.box.classList.toggle("is-selected", on);
    }
  }
  function removeEdge(k) {
    edges = edges.filter(([a, b]) => pairKey(a, b) !== k);
    if (selected === k) selected = null;
    buildEdges();
    persist();
  }
  function addEdge(from, to) {
    if (from === to || edges.some(([a, b]) => pairKey(a, b) === pairKey(from, to))) return;
    edges.push([from, to]);
    selected = pairKey(from, to);
    buildEdges();
    persist();
  }

  // ---- camera ----
  function clampZoom(k) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k)); }
  function applyCam() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    pct.textContent = `${Math.round(cam.k * 100)}%`;
  }
  function zoomAt(k, sx, sy) {
    const nk = clampZoom(k);
    cam.x = sx - ((sx - cam.x) * nk) / cam.k;
    cam.y = sy - ((sy - cam.y) * nk) / cam.k;
    cam.k = nk;
    applyCam();
  }
  /** Centre the cards and lines on the board, scaled to fit (at most 100%), or at zoom `k` when given.
   * `top`: put their top TOP_PAD below the board's top edge instead of centring them down the board. */
  function fit(k, top = false) {
    const rects = [...cardEls.values(), ...[...edgeEls.values()].map((e) => e.box)].map((el) => {
      if (el.classList.contains("anc-box")) {
        const e = edgeEls.get(el.dataset.edge);
        const a = handlePoint(e.from, "out"), b = handlePoint(e.to, "in");
        const { mid } = edgeCurve(a.x, a.y, b.x, b.y, Math.max(a.h, b.h));
        return { x: mid[0] - el.offsetWidth / 2, y: mid[1] - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight };
      }
      const p = pos[el.dataset.id];
      return { x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight };
    });
    if (!rects.length) { cam = { x: 0, y: 0, k: 1 }; applyCam(); return; }
    const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
    const pad = 40, bw = board.clientWidth, bh = board.clientHeight;
    if (k === undefined) k = Math.min(1, (bw - pad * 2) / (x1 - x0), (bh - pad * 2) / (y1 - y0));
    k = clampZoom(k);
    cam = { k, x: (bw - (x1 - x0) * k) / 2 - x0 * k, y: (top ? TOP_PAD : (bh - (y1 - y0) * k) / 2) - y0 * k };
    applyCam();
  }
  const boardPoint = (e) => {
    const r = board.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const worldPoint = (e) => {
    const p = boardPoint(e);
    return { x: (p.x - cam.x) / cam.k, y: (p.y - cam.y) / cam.k };
  };

  // ---- pointer interactions: drag card, pan, connect ----
  let drag = null;
  let moved = false; // true once a press has travelled far enough to count as a drag
  let start = null;

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    moved = false;
    start = { x: e.clientX, y: e.clientY };
    const handle = e.target.closest(".anc-handle");
    const cardEl = e.target.closest(".anc-card");
    const hit = e.target.closest("[data-edge]");
    if (handle && cardEl) {
      drag = { type: "connect", id: cardEl.dataset.id, side: handle.dataset.handle };
      board.classList.add("is-connecting");
    } else if (cardEl) {
      const p = worldPoint(e);
      drag = { type: "card", id: cardEl.dataset.id, dx: p.x - pos[cardEl.dataset.id].x, dy: p.y - pos[cardEl.dataset.id].y };
      cardEl.classList.add("is-dragging");
    } else if (hit) {
      selected = hit.dataset.edge;
      markSelected();
      board.focus({ preventScroll: true });
      return;
    } else {
      drag = { type: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
      board.classList.add("is-panning");
      if (selected) { selected = null; markSelected(); }
    }
    // Pointer capture waits until the press becomes a drag: capturing now would retarget the click
    // to the board, and a plain click on a thumbnail must reach the lightbox.
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!drag) return;
    // Released outside the board before the press became a drag (so nothing captured the pointer).
    if (!moved && e.buttons === 0) { endDrag(); return; }
    if (!moved) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      board.setPointerCapture(e.pointerId);
    }
    if (drag.type === "pan") {
      cam.x = drag.cx + e.clientX - drag.sx;
      cam.y = drag.cy + e.clientY - drag.sy;
      applyCam();
      notify();
    } else if (drag.type === "card") {
      const p = worldPoint(e);
      pos[drag.id] = { x: p.x - drag.dx, y: p.y - drag.dy };
      cardEls.get(drag.id).style.transform = `translate(${pos[drag.id].x}px, ${pos[drag.id].y}px)`;
      routeEdges();
      notify();
    } else if (drag.type === "connect") {
      const a = handlePoint(drag.id, drag.side);
      const p = worldPoint(e);
      const { d } = drag.side === "out" ? edgeCurve(a.x, a.y, p.x, p.y) : edgeCurve(p.x, p.y, a.x, a.y);
      ghost.setAttribute("d", d);
    }
  }
  function endDrag() {
    if (drag && drag.type === "card") cardEls.get(drag.id).classList.remove("is-dragging");
    drag = null;
    board.classList.remove("is-panning", "is-connecting");
    ghost.setAttribute("d", "");
  }
  function onPointerUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    board.classList.remove("is-panning", "is-connecting");
    if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    if (d.type === "card") cardEls.get(d.id).classList.remove("is-dragging");
    if (d.type === "connect") {
      ghost.setAttribute("d", "");
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const other = target && target.closest(".anc-card");
      if (other && root.contains(other) && other.dataset.id !== d.id) {
        if (d.side === "out") addEdge(d.id, other.dataset.id); else addEdge(other.dataset.id, d.id);
      }
    }
    if (moved) persist();
  }
  // A drag that ends on a thumbnail must not open the lightbox.
  function onClick(e) {
    if (moved) { e.stopPropagation(); moved = false; return; }
    const x = e.target.closest("[data-remove]");
    if (x) {
      const box = x.closest(".anc-box");
      if (box) removeEdge(box.dataset.edge);
      e.stopPropagation();
      return;
    }
    const box = e.target.closest(".anc-box");
    if (box) { selected = box.dataset.edge; markSelected(); board.focus({ preventScroll: true }); }
  }
  function onKeyDown(e) {
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      removeEdge(selected);
    } else if (e.key === "Escape" && selected) {
      selected = null;
      markSelected();
    }
  }
  // Cmd/Ctrl + scroll and trackpad pinch (sent as ctrl + wheel) zoom; plain scrolling still scrolls the page.
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const p = boardPoint(e);
    // Pinch sends small deltas, a mouse wheel notch about 100; clamp so one notch is a modest step.
    const dy = Math.max(-50, Math.min(50, e.deltaY));
    zoomAt(cam.k * Math.exp(-dy * 0.006), p.x, p.y);
    notify();
  }
  // Safari reports trackpad pinch as gesture events.
  let gestureStart = 1;
  function onGestureStart(e) { e.preventDefault(); gestureStart = cam.k; }
  function onGestureChange(e) {
    e.preventDefault();
    const p = boardPoint(e);
    zoomAt(gestureStart * e.scale, p.x, p.y);
    notify();
  }
  function onToolClick(e) {
    const z = e.target.closest("[data-zoom]");
    if (z) {
      const cx = board.clientWidth / 2, cy = board.clientHeight / 2;
      if (z.dataset.zoom === "in") zoomAt(cam.k * 1.2, cx, cy);
      else if (z.dataset.zoom === "out") zoomAt(cam.k / 1.2, cx, cy);
      else fit();
      persist();
      return;
    }
    if (e.target.closest("[data-reset]")) {
      forget(opts.storageKey);
      Object.assign(pos, defaultLayout(ids));
      edges = defaultEdges(ids);
      selected = null;
      placeCards();
      buildEdges();
      fit();
      adopt = false; // a reset clears the saved layout, as it does without a link
      notify();
    }
  }

  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("pointermove", onPointerMove);
  board.addEventListener("pointerup", onPointerUp);
  board.addEventListener("pointercancel", onPointerUp);
  board.addEventListener("click", onClick);
  board.addEventListener("keydown", onKeyDown);
  board.addEventListener("wheel", onWheel, { passive: false });
  board.addEventListener("gesturestart", onGestureStart);
  board.addEventListener("gesturechange", onGestureChange);
  tools.addEventListener("click", onToolClick);
  tools.hidden = false;
  note.hidden = false;

  placeCards();
  buildEdges();
  if (cam) applyCam();
  else if (sharedZoom) fit(sharedZoom);
  else if (board.clientWidth >= ZOOM_DEFAULT_MIN_WIDTH) fit(ZOOM_DEFAULT, true);
  else fit();
  // Card heights settle once thumbnails load; reroute lines then.
  const onImg = () => routeEdges();
  world.querySelectorAll("img").forEach((img) => img.addEventListener("load", onImg));

  return {
    state() { return { ids, pos: { ...pos }, edges: edges.map((e) => [...e]), cam: { ...cam } }; },
    destroy() {
      board.removeEventListener("wheel", onWheel);
      board.removeEventListener("gesturestart", onGestureStart);
      board.removeEventListener("gesturechange", onGestureChange);
      tools.removeEventListener("click", onToolClick);
      tools.hidden = true;
      note.hidden = true;
      root.innerHTML = "";
    },
  };
}

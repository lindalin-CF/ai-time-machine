// AI Surface Library — front-end controller
import { anCanvasState, findingsCellHTML, mountAnCanvas, tableFindings, unmountAnCanvas } from "./analytics-canvas.js";
import { buildAnalyticsHash, compareHash, hashRoute, libraryCompareHash, parseAnalyticsHash } from "./analytics-share.js";
import { closeWeekPicks, weekPick } from "./analytics-weekpick.js";

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  portals: [],
  weeks: [],
  week: null,        // selected week (null => latest)
  selected: new Set(), // selected portal slugs; empty => all portals
  captures: [],
  device: "desktop", // "desktop" | "mobile" — which screenshot variant to show
  search: "",        // free-text query; filters cards by portal, company & analysis
  label: null,       // current week's display label (for the section heading)
  manualShots: null, // all manual observations, lazily loaded on first search (null => not loaded)
  manualLoading: false,
};

// Pick the screenshot to show for the current device.
// Returns { src, missing } — missing=true when a mobile shot doesn't exist yet.
function shotFor(c) {
  if (state.device === "mobile") {
    return c.hasMobile ? { src: c.imageMobile, missing: false } : { src: null, missing: true };
  }
  return { src: c.image, missing: false };
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Same wording as src/format.ts (weekInWords, shotAlt); tests/unit/image-seo.test.ts checks they agree.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function weekInWords(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week || "");
  if (!m) return week || "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : week;
}
function shotAlt(portal, device, week) {
  return `${portal} UI screenshot, ${device}, week of ${weekInWords(week)}`;
}
// Small display copy of a screenshot via Cloudflare Image Transformations (enabled only on the production zone).
// onerror=redirect falls back to the original if a transformation fails or the monthly quota runs out.
function thumbUrl(src, width = 800) {
  if (typeof src === "string" && src.startsWith("/img/") && location.hostname === "ai-portal-library.dev") {
    return `/cdn-cgi/image/width=${width},fit=scale-down,format=auto,onerror=redirect` + src;
  }
  return src;
}
/** width/height attributes, or nothing when the size is unknown. */
function sizeAttrs(size) {
  return size && size.width > 0 && size.height > 0 ? ` width="${size.width}" height="${size.height}"` : "";
}
// A mobile screenshot the Worker couldn't measure has the capture viewport's size (src/image-size.ts MOBILE_CAPTURE_SIZE).
const MOBILE_CAPTURE_SIZE = { width: 780, height: 1688 };
/** Real size of a capture's desktop or mobile screenshot, from /api/captures. */
function shotSize(c, mobile) {
  return mobile
    ? (c.mobileWidth && c.mobileHeight ? { width: c.mobileWidth, height: c.mobileHeight } : MOBILE_CAPTURE_SIZE)
    : { width: c.width || 1280, height: c.height || 800 };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function skeletons(n = 6) {
  $("#grid").innerHTML = Array.from({ length: n }, () => `<div class="card skeleton"></div>`).join("");
}

async function boot() {
  skeletons();
  try {
    const [stats, portals, weeks] = await Promise.all([
      getJSON("/api/stats"),
      getJSON("/api/portals"),
      getJSON("/api/weeks"),
    ]);
    renderStats(stats);
    state.portals = portals.portals || [];
    state.weeks = weeks.weeks || [];
    renderFilters();
    renderWeekSelect();
    await loadWeek(null);
  } catch (err) {
    $("#grid").innerHTML = "";
    $("#weekHeading").textContent = "Could not load the library";
    const e = $("#empty");
    e.hidden = false;
    e.textContent = "The API did not respond. Is the Worker running?";
    console.error(err);
  }
}

function renderStats(s) {
  for (const key of ["screenshots", "portals", "weeks"]) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    const target = Number(s[key] || 0);
    // The Worker already rendered the numbers into the page; only animate when they changed.
    if (el && el.textContent !== String(target)) countUp(el, target);
  }
}

function countUp(el, target) {
  const dur = 650, t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Portal chips in the sticky filter bar: "All portals" and the first FILTER_CHIPS portals in one scrolling row, then a
// "+N more" menu with the rest. Multi-select: each portal chip toggles, "All portals" clears the selection; portals
// picked from the menu show as active chips at the end of the row.
const FILTER_CHIPS = 4;
const filterChip = (slug, label, brand) =>
  `<button class="chip" type="button" data-portal="${esc(slug)}" aria-pressed="false">` +
  (brand ? `<span class="swatch" style="background:${esc(brand)}"></span>` : "") + `${esc(label)}</button>`;

function renderFilters() {
  const wrap = $("#filters");
  if (!wrap) return;
  const shown = state.portals.slice(0, FILTER_CHIPS);
  const picked = state.portals.filter((p) => state.selected.has(p.slug) && !shown.includes(p));
  wrap.innerHTML = [filterChip("all", "All portals"), ...[...shown, ...picked].map((p) => filterChip(p.slug, p.name, p.brand))].join("");
  wrap.querySelectorAll(".chip").forEach((btn) => btn.addEventListener("click", () => togglePortal(btn.dataset.portal)));
  renderMoreMenu();
  syncFilterChips();
  fadeFilterEdges();
}

/** Fade the end(s) of a chip row (the Library's #filters, Compare's #anPortals) that hide more chips. */
function fadeFilterEdges() { fadeChipEdges($("#filters")); }
function fadeChipEdges(wrap) {
  if (!wrap) return;
  const max = wrap.scrollWidth - wrap.clientWidth;
  wrap.classList.toggle("fade-start", max > 1 && wrap.scrollLeft > 1);
  wrap.classList.toggle("fade-end", max > 1 && wrap.scrollLeft < max - 1);
}

/** Toggle one portal ("all" clears the selection), keeping the grid, the search results and the chips in step.
 * A portal from the menu joins the row when picked and leaves it when unpicked; focus goes to its chip, or to
 * "+N more" when the chip is gone. */
function togglePortal(slug) {
  if (slug === "all") state.selected.clear();
  else if (state.selected.has(slug)) state.selected.delete(slug);
  else state.selected.add(slug);
  const inMenu = state.portals.findIndex((p) => p.slug === slug) >= FILTER_CHIPS;
  if (inMenu) {
    const hadFocus = document.activeElement?.closest?.("#filters, #moreMenu");
    renderFilters();
    if (hadFocus) focusPortalChip($("#filters"), $("#moreMenu"), slug);
  } else {
    syncFilterChips();
  }
  renderGrid();
  updateManualResults();
}

// Reflect state.selected on the chips. Empty selection => "All portals" is active.
function syncFilterChips() {
  const wrap = $("#filters");
  if (!wrap) return;
  const none = state.selected.size === 0;
  wrap.querySelectorAll(".chip").forEach((c) => {
    const slug = c.dataset.portal;
    const on = slug === "all" ? none : state.selected.has(slug);
    c.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("#moreMenu .more-option").forEach((o) => o.setAttribute("aria-selected", String(state.selected.has(o.dataset.portal))));
}

// "+N more": built like the week dropdown (a button, then a listbox of option buttons). Arrow keys, Home and End
// move between options, Enter or a click picks one, Esc closes and returns focus to the button, as does a click outside.
// Used by the Library filter bar (#moreMenu).
// opts: { listId, items: portals[], multi, selected(slug), disabled(slug), onPick(slug) }.
function mountMoreMenu(menu, opts) {
  if (!menu) return;
  const rest = opts.items;
  menu.hidden = rest.length === 0;
  if (!rest.length) { menu.innerHTML = ""; return; }
  const disabled = opts.disabled || (() => false);
  menu.innerHTML =
    `<button class="chip chip-more" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="${opts.listId}">+${rest.length} more</button>` +
    `<div class="week-menu-list more-menu-list" id="${opts.listId}" role="listbox"${opts.multi ? ' aria-multiselectable="true"' : ""} aria-label="More portals">` +
    rest.map((p) => `<button class="week-option more-option" type="button" role="option" data-portal="${esc(p.slug)}" aria-selected="${opts.selected(p.slug)}"` +
      `${disabled(p.slug) ? ' aria-disabled="true"' : ""} tabindex="-1"><span class="swatch" style="background:${esc(p.brand)}"></span>${esc(p.name)}</button>`).join("") +
    `</div>`;
  const btn = menu.querySelector(".chip-more");
  const options = () => [...menu.querySelectorAll(".more-option")];
  const focusOption = (i) => { const o = options(); o[(i + o.length) % o.length]?.focus(); };
  const openAt = (i) => {
    closeWeekMenus();
    closeWeekPicks();
    closeMoreMenu();
    menu.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    if (i !== null) focusOption(i);
  };
  const selectedIndex = () => Math.max(0, options().findIndex((o) => o.getAttribute("aria-selected") === "true"));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("open")) closeMoreMenu();
    else openAt(e.detail === 0 ? selectedIndex() : null); // keyboard (Enter/Space) moves focus into the list
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openAt(e.key === "ArrowUp" ? options().length - 1 : selectedIndex());
    }
  });
  menu.querySelector(".more-menu-list").addEventListener("keydown", (e) => {
    const i = options().indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusOption(0); }
    else if (e.key === "End") { e.preventDefault(); focusOption(-1); }
    else if (e.key === "Tab") closeMoreMenu();
  });
  options().forEach((o) => o.addEventListener("click", (e) => {
    e.stopPropagation();
    if (o.getAttribute("aria-disabled") === "true") return; // e.g. Compare already has four portals
    closeMoreMenu();
    opts.onPick(o.dataset.portal);
  }));
}

/** After a pick from a "+N more" menu re-renders the row: focus the portal's chip, or "+N more" when it left the row. */
function focusPortalChip(row, menu, slug) {
  const chip = row?.querySelector(`.chip[data-portal="${CSS.escape(slug)}"]`) || menu?.querySelector(".chip-more");
  chip?.focus();
  chip?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderMoreMenu() {
  mountMoreMenu($("#moreMenu"), {
    listId: "moreMenuList", items: state.portals.slice(FILTER_CHIPS), multi: true,
    selected: (slug) => state.selected.has(slug), onPick: togglePortal,
  });
}

function closeMoreMenu(refocus = false) {
  document.querySelectorAll(".more-menu.open").forEach((menu) => {
    menu.classList.remove("open");
    const btn = menu.querySelector(".chip-more");
    btn.setAttribute("aria-expanded", "false");
    if (refocus && menu.contains(document.activeElement)) btn.focus();
  });
}

// ---- Compare →: opens the Compare view with the filter bar's portals, week and device ----
function initCompareButton() {
  const btn = $("#compareBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // Selected portals in chip (site) order: none = All portals, one = that portal week by week, more = side by side.
    const selection = state.portals.map((p) => p.slug).filter((slug) => state.selected.has(slug));
    const hash = libraryCompareHash({
      selection, week: state.week, device: state.device,
      weeks: state.weeks.map((w) => w.week), portals: state.portals.map((p) => p.slug),
    });
    // Push and route in this same task, so the next frame is already Compare (no hashchange round trip).
    history.pushState(history.state, "", hash);
    route();
  });
}

// The filter bar sticks right under the sticky top bar, whose height changes with the viewport (and its wrapping).
/** Scroll a chip row sideways (never the page) so `chip` is in full view, clear of the 24px edge fades. The row snaps
 * each chip's start to 24px in (scroll-padding), so it stops on such a snap point, or the end, instead of being pulled off. */
function revealChip(row, chip, pad = 24) {
  if (!row || !chip) return;
  const r = row.getBoundingClientRect(), c = chip.getBoundingClientRect();
  const max = row.scrollWidth - row.clientWidth;
  const snapTo = (el) => Math.min(max, Math.max(0, row.scrollLeft + el.getBoundingClientRect().left - (r.left + pad)));
  let left = row.scrollLeft;
  if (c.left < r.left + pad) left = snapTo(chip);
  else if (c.right > r.right - pad) {
    // The first snap point that brings the chip's end in; past the last one, the end of the row.
    const shift = (x) => x - row.scrollLeft;
    left = max;
    for (const el of row.querySelectorAll(".chip")) {
      const x = snapTo(el);
      if (x > row.scrollLeft && c.right - shift(x) <= r.right - pad) { left = x; break; }
    }
  }
  if (left !== row.scrollLeft) row.scrollTo({ left, behavior: "instant" });
  fadeChipEdges(row);
}

// Compare's portal row: a focused chip scrolls into view, and a vertical mouse wheel scrolls the row sideways
// (until it reaches an end, then the page scrolls as usual).
function initAnPortalRow() {
  const row = $("#anPortals");
  if (!row) return;
  row.addEventListener("focusin", (e) => { if (e.target.matches(".chip")) revealChip(row, e.target); });
  row.addEventListener("wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // pinch-zoom, or already sideways
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 0 || (e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max - 1)) return;
    e.preventDefault();
    row.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  }, { passive: false });
}

function initFilterEdges() {
  for (const wrap of [$("#filters"), $("#anPortals")]) {
    if (!wrap) continue;
    const fade = () => fadeChipEdges(wrap);
    wrap.addEventListener("scroll", fade, { passive: true });
    if (typeof ResizeObserver === "function") new ResizeObserver(fade).observe(wrap);
  }
}

function trackTopbarHeight() {
  const bar = $(".topbar");
  const controls = $(".controls");
  if (!bar || !controls) return;
  const set = () => controls.style.setProperty("--topbar-h", `${bar.getBoundingClientRect().height}px`);
  set();
  if (typeof ResizeObserver === "function") new ResizeObserver(set).observe(bar);
}

function shortWeekLabel(week) {
  if (!week) return "Latest week";
  try {
    return new Date(week + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    });
  } catch {
    return week;
  }
}

function closeWeekMenus(except = null) {
  document.querySelectorAll(".week-menu.open").forEach((m) => {
    if (m === except) return;
    m.classList.remove("open");
    const b = m.querySelector(".week-menu-btn");
    if (b) b.setAttribute("aria-expanded", "false");
  });
}

// The Library filter bar's week: Compare's week dropdown, showing the same week as #weekSelect.
function renderLibraryWeekPick() {
  const box = $("#weekPick");
  if (!box) return;
  const current = state.week || state.weeks[0]?.week;
  weekPick(box, {
    options: state.weeks.map((w) => ({ value: w.week, label: shortWeekLabel(w.week) })),
    selected: current ? [current] : [], multi: false, labelledBy: "weekPickLabel",
    onChange: (week) => { closeWeekMenus(); closeMoreMenu(); loadWeek(week); },
  });
}

function syncWeekMenus() {
  renderLibraryWeekPick();
  document.querySelectorAll(".week-menu").forEach((menu) => {
    const btn = menu.querySelector(".week-menu-btn");
    const list = menu.querySelector(".week-menu-list");
    const label = shortWeekLabel(state.week || state.weeks[0]?.week);
    if (btn) btn.querySelector("span").textContent = label;
    if (!list) return;
    list.querySelectorAll(".week-option").forEach((opt) => {
      opt.setAttribute("aria-selected", String(opt.dataset.week === state.week));
    });
  });
}

function ensureWeekMenu(sel) {
  sel.classList.add("week-native");
  let menu = sel.parentElement.querySelector(".week-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "week-menu";
    menu.innerHTML = '<button class="week-menu-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span>Week</span></button><div class="week-menu-list" role="listbox"></div>';
    sel.insertAdjacentElement("afterend", menu);
    const btn = menu.querySelector(".week-menu-btn");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains("open");
      closeWeekMenus(menu);
      closeMoreMenu();
      menu.classList.toggle("open", willOpen);
      btn.setAttribute("aria-expanded", String(willOpen));
    });
  }
  const list = menu.querySelector(".week-menu-list");
  list.innerHTML = state.weeks.length
    ? state.weeks.map((w) => '<button class="week-option" type="button" role="option" data-week="' + esc(w.week) + '" aria-selected="' + String(w.week === state.week) + '">' + esc(shortWeekLabel(w.week)) + '</button>').join("")
    : '<button class="week-option" type="button" disabled>No weeks yet</button>';
  list.querySelectorAll(".week-option[data-week]").forEach((opt) => {
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWeekMenus();
      loadWeek(opt.dataset.week);
    });
  });
  syncWeekMenus();
}

function renderWeekSelect() {
  const opts = state.weeks.length
    ? state.weeks
        .map((w) => `<option value="${esc(w.week)}">${esc(shortWeekLabel(w.week))}</option>`)
        .join("")
    : `<option>No weeks yet</option>`;
  // Library and Collection each have their own week dropdown; keep both in sync. The Library's visible control is
  // the week dropdown in #weekPick; the Collection's is the .week-menu built over its select.
  for (const id of ["#weekSelect", "#collectionWeekSelect"]) {
    const sel = $(id);
    if (!sel) continue;
    sel.innerHTML = opts;
    if (state.weeks.length) sel.addEventListener("change", () => loadWeek(sel.value));
    if (id === "#weekSelect") { sel.classList.add("week-native"); renderLibraryWeekPick(); }
    else ensureWeekMenu(sel);
  }
}

async function loadWeek(week) {
  skeletons();
  const q = week ? `?week=${encodeURIComponent(week)}` : "";
  const data = await getJSON(`/api/captures${q}`);
  state.week = data.week;
  state.captures = data.captures || [];
  state.label = data.label || null;
  if (data.week) {
    for (const id of ["#weekSelect", "#collectionWeekSelect"]) {
      const s = $(id);
      if (s) s.value = data.week;
    }
    syncWeekMenus();
  }
  renderGrid();
  if (location.hash === "#collection") renderCollection();
}

// Display rule, mirroring src/analysis.ts:
//  - guideline-v*: shown, and searchable (publishedAnalysis)
//  - system-test: its note is shown on the card and compare table only (displayedAnalysis)
//  - anything else (legacy, pending, not_analyzable): "coming soon"
const ANALYSIS_SOON = "Design analysis coming soon.";
function publishedAnalysis(c) {
  const by = c && typeof c.analysisBy === "string" ? c.analysisBy : "";
  const text = c && typeof c.analysis === "string" ? c.analysis.trim() : "";
  return by.startsWith("guideline-v") && text ? text : "";
}
function displayedAnalysis(c) {
  const text = c && typeof c.analysis === "string" ? c.analysis.trim() : "";
  if (c && c.analysisBy === "system-test" && text) return text;
  return publishedAnalysis(c) || ANALYSIS_SOON;
}

// Case-insensitive match across portal name, company and published analysis text.
function matchesSearch(c, q) {
  if (!q) return true;
  return `${c.portal ?? ""} ${c.company ?? ""} ${publishedAnalysis(c)}`
    .toLowerCase()
    .includes(q);
}

// Keep the section heading's "N portals" count in sync with what's on screen.
function updateWeekHeading(list) {
  const heading = $("#weekHeading");
  if (!heading) return;
  if (!state.label) {
    heading.textContent = "No captures yet";
    return;
  }
  const count = list.filter((c) => c.status === "ok").length;
  heading.textContent = `${state.label} · ${count} portals`;
}

function renderGrid() {
  const q = state.search.trim().toLowerCase();
  // Portal chips + week (via state.captures) + search all compose here.
  const list = state.captures.filter(
    (c) =>
      (state.selected.size === 0 || state.selected.has(c.slug)) &&
      matchesSearch(c, q)
  );
  updateWeekHeading(list);
  const grid = $("#grid");
  const empty = $("#empty");
  if (!list.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.textContent = q
      ? "No captures match your search."
      : "No captures for this filter yet.";
    return;
  }
  empty.hidden = true;
  grid.innerHTML = list.map(card).join("");
  wireAnalysisToggles();
  wireBrandLogos();
}

// Load each portal's icon (self-hosted, saved by scripts/fetch-icons.mjs) as its logo; fall back
// to the brand colour swatch if it fails to load.
function wireBrandLogos() {
  $("#grid").querySelectorAll(".brand-logo").forEach((box) => {
    const icon = box.dataset.icon;
    const img = box.querySelector("img");
    if (!icon || !img) { box.classList.add("is-fallback"); return; }
    img.addEventListener("error", () => box.classList.add("is-fallback"), { once: true });
    img.src = icon;
  });
}

/** Self-hosted portal icon (public/icons/<slug>.png). */
function iconUrl(slug) {
  return `/icons/${encodeURIComponent(slug)}.png`;
}
// Pixel size of public/icons/<slug>.png: 64x64 unless listed (tests check this against the files).
const ICON_SIZES = { poe: 48, you: 16 };
function iconSize(slug) {
  const n = ICON_SIZES[slug] || 64;
  return { width: n, height: n };
}

// Collapse long design-analysis text to 5 lines; only show the toggle when it
// actually overflows. The method link is the last line of the text and stays
// hidden (so not focusable) while the text is collapsed.
function wireAnalysisToggles() {
  $("#grid").querySelectorAll(".card").forEach((cardEl) => {
    const p = cardEl.querySelector(".analysis");
    const toggle = cardEl.querySelector(".analysis-toggle");
    const method = cardEl.querySelector(".analysis-method");
    if (!p || !toggle || !method) return;
    // If the clamped text isn't taller than its visible box, nothing is
    // collapsed: drop the clamp so the link fits, and skip the toggle.
    const overflows = p.scrollHeight - p.clientHeight > 2;
    if (!overflows) {
      toggle.hidden = true;
      p.classList.remove("clamped");
      method.hidden = false;
      return;
    }
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      const expanded = p.classList.toggle("expanded");
      p.classList.toggle("clamped", !expanded);
      method.hidden = !expanded;
      toggle.classList.toggle("open", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", expanded ? "Show less" : "Show more");
    });
  });
}

// Portal page for a card: the latest week links to /portals/<slug>, older weeks to /portals/<slug>/<week>.
function portalHref(c) {
  const latest = state.weeks[0]?.week;
  const week = c.week || state.week;
  return !week || !latest || week === latest
    ? `/portals/${c.slug}`
    : `/portals/${c.slug}/${week}`;
}

function card(c) {
  const palette = (c.palette || [])
    .map((hex) => `<i style="background:${esc(hex)}" title="${esc(hex)}"></i>`)
    .join("");
  // Status chip only for meaningful states — no date (design cleanup).
  const badge =
    c.status === "error"
      ? `<span class="badge err">Capture failed</span>`
      : c.sample
      ? `<span class="badge">Sample</span>`
      : "";
  const mobile = state.device === "mobile";
  const shot = shotFor(c);
  const inner = shot.missing
    ? `<div class="shot-missing">No mobile capture yet</div>`
    : `<img loading="lazy" src="${esc(thumbUrl(shot.src))}" alt="${esc(shotAlt(c.portal, mobile ? "mobile" : "desktop", c.week || state.week))}"${sizeAttrs(shotSize(c, mobile))} />`;
  return `
  <article class="card">
    <div class="shot${mobile ? " mobile" : ""}" style="--brand:${esc(c.brand)}">
      ${badge}
      ${inner}
    </div>
    <div class="card-body">
      <div class="card-head">
        <div class="portal-id">
          <span class="brand-logo" style="--brand:${esc(c.brand)}" data-icon="${esc(iconUrl(c.slug))}" title="${esc(c.company)}">
            <img alt="${esc(c.portal)} logo"${sizeAttrs(iconSize(c.slug))} loading="lazy" />
          </span>
          <div>
            <div class="portal-name"><a class="card-link" href="${esc(portalHref(c))}">${esc(c.portal)}</a></div>
            <div class="portal-co">${esc(c.company)}</div>
          </div>
        </div>
        <a class="visit" href="${esc(c.url)}" target="_blank" rel="noopener">Visit &#8599;</a>
      </div>
      <div class="analysis-label">Design analysis</div>
      <p class="analysis clamped">${esc(displayedAnalysis(c))}<a class="analysis-method" href="/how-we-analyze" hidden>How this analysis is made</a></p>
      <button type="button" class="analysis-toggle" aria-expanded="false" aria-label="Show more">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="card-foot">
        <div class="palette">${palette}</div>
        <div class="card-actions">
          <button class="manual-open" type="button" data-slug="${esc(c.slug)}" data-portal="${esc(c.portal)}" aria-label="More snapshots for ${esc(c.portal)}" title="More snapshots for ${esc(c.portal)}" aria-haspopup="dialog">
            <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="3.5" cy="9" r="1.25" fill="currentColor"/><circle cx="9" cy="9" r="1.25" fill="currentColor"/><circle cx="14.5" cy="9" r="1.25" fill="currentColor"/></svg>
          </button>
          <a class="details-link" href="${esc(portalHref(c))}" aria-label="Details for ${esc(c.portal)}, week of ${esc(shortWeekLabel(c.week || state.week))}">Details <span class="arrow" aria-hidden="true">&rarr;</span></a>
        </div>
      </div>
    </div>
  </article>`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "Captured";
  }
}

// ---- lightbox: click a screenshot to enlarge + download --------------------
function initLightbox() {
  const el = document.createElement("div");
  el.className = "lb";
  el.hidden = true;
  el.innerHTML = `
    <div class="lb-backdrop" data-close></div>
    <div class="lb-controls">
      <a class="lb-icon lb-download" href="#" download aria-label="Download PNG" title="Download PNG">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Z"/><path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/></svg>
      </a>
      <button class="lb-icon lb-close" type="button" aria-label="Close" title="Close" data-close>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.4 5A1 1 0 0 0 5 6.4L10.6 12 5 17.6A1 1 0 1 0 6.4 19L12 13.4 17.6 19a1 1 0 0 0 1.4-1.4L13.4 12 19 6.4A1 1 0 1 0 17.6 5L12 10.6Z"/></svg>
      </button>
    </div>
    <figure class="lb-figure">
      <img class="lb-img" alt="" />
    </figure>`;
  document.body.appendChild(el);
  const img = el.querySelector(".lb-img");
  const dl = el.querySelector(".lb-download");

  const close = () => {
    el.hidden = true;
    img.removeAttribute("src");
    document.body.style.overflow = "";
  };
  const open = (full, t, file, thumb) => {
    // The enlarged image is the same file as the thumbnail, so it takes the thumbnail's size and alt.
    for (const a of ["width", "height"]) {
      if (thumb?.getAttribute(a)) img.setAttribute(a, thumb.getAttribute(a)); else img.removeAttribute(a);
    }
    img.src = full;
    img.alt = thumb?.alt || t + " screenshot";
    dl.href = full;
    dl.setAttribute("download", (file || "screenshot") + ".png");
    el.hidden = false;
    document.body.style.overflow = "hidden";
  };

  el.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) close(); });

  // Force a real download (same-origin) instead of navigating to the image.
  dl.addEventListener("click", async (e) => {
    e.preventDefault();
    const name = dl.getAttribute("download") || "screenshot.png";
    try {
      const res = await fetch(dl.href);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      window.open(dl.href, "_blank", "noopener");
    }
  });

  // Delegate clicks from any thumbnail carrying data-full (gallery + collection).
  document.body.addEventListener("click", (e) => {
    const shot = e.target.closest("[data-full]");
    if (!shot) return;
    open(shot.dataset.full, shot.dataset.title || "Screenshot", shot.dataset.file, shot.querySelector("img"));
  });
}

// ---- collection: one-pager of the whole week + download-all ----------------
function fmtFull(iso) {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    });
  } catch {
    return iso || "";
  }
}

function renderCollection() {
  const meta = $("#collectionMeta");
  const grid = $("#collectionGrid");
  const btn = $("#dlAll");
  if (!meta || !grid) return;

  const caps = state.captures.filter((c) => c.status === "ok" && !c.sample && c.image);
  if (!caps.length) {
    meta.textContent = "No screenshots captured for this week yet.";
    grid.innerHTML = "";
    if (btn) btn.disabled = true;
    return;
  }

  const label = state.weeks.find((w) => w.week === state.week)?.label || state.week || "Latest week";
  const dates = [...new Set(caps.map((c) => (c.capturedAt || "").slice(0, 10)).filter(Boolean))].sort();
  const dateStr = dates.length <= 1 ? fmtFull(dates[0]) : `${fmtFull(dates[0])} – ${fmtFull(dates[dates.length - 1])}`;
  const signed = caps.filter((c) => c.signedIn).length;
  meta.innerHTML =
    `<b>${esc(label)}</b> · ${caps.length} snapshot${caps.length === 1 ? "" : "s"}` +
    (dateStr ? ` · captured ${esc(dateStr)}` : "") +
    (signed ? ` · ${signed} signed-in` : "");

  const mobile = state.device === "mobile";
  grid.innerHTML = caps
    .map((c) => {
      const shot = shotFor(c);
      const inner = shot.missing
        ? `<div class="shot-missing">No mobile capture yet</div>`
        : `<img loading="lazy" src="${esc(thumbUrl(shot.src))}" alt="${esc(shotAlt(c.portal, mobile ? "mobile" : "desktop", c.week || state.week))}"${sizeAttrs(shotSize(c, mobile))} />`;
      return `
    <figure class="col-item">
      <div class="shot${mobile ? " mobile" : ""}" style="--brand:${esc(c.brand)}">
        ${inner}
      </div>
      <figcaption class="col-cap">
        <span class="col-name"><span class="brand-dot" style="background:${esc(c.brand)}"></span><a class="card-link" href="${esc(portalHref(c))}">${esc(c.portal)}</a></span>
      </figcaption>
    </figure>`;
    })
    .join("");
  if (btn) btn.disabled = false;
}

function initDownloadAll() {
  const btn = $("#dlAll");
  if (!btn) return;
  const label = btn.querySelector(".dl-all-label");
  btn.addEventListener("click", async () => {
    const week = state.week;
    if (!week) return;
    const orig = label ? label.textContent : "";
    if (label) label.textContent = "Preparing ZIP…";
    btn.disabled = true;
    const href = `/api/collection.zip?week=${encodeURIComponent(week)}${state.device === "mobile" ? "&device=mobile" : ""}`;
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error("zip " + res.status);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-portals-${week}${state.device === "mobile" ? "-mobile" : ""}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 6000);
    } catch {
      window.location.href = href; // fallback: let the browser fetch + download it
    } finally {
      if (label) label.textContent = orig;
      btn.disabled = false;
    }
  });
}

// ---- device toggle: Desktop / Mobile (both Library + Collection) ----------
function syncToggles() {
  document.querySelectorAll(".vt-btn[data-device]").forEach((b) => {
    const on = b.dataset.device === state.device;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function initDeviceToggle() {
  syncToggles();
  document.body.addEventListener("click", (e) => {
    const b = e.target.closest(".vt-btn");
    if (!b) return;
    const dev = b.dataset.device;
    if (!dev || dev === state.device) return;
    state.device = dev;
    syncToggles();
    renderGrid();
    if (location.hash === "#collection") renderCollection();
  });
}

// ---- search: filter visible cards as the user types ------------------------
function initSearch() {
  const input = $("#searchInput");
  if (!input) return;
  input.addEventListener("input", () => {
    state.search = input.value;
    renderGrid();
    updateManualResults();
  });
}

// Date for manual result captions, incl. year, e.g. "Sep 24, 2026".
function fmtDateYear(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

/** Alt text for a manual snapshot: "Claude desktop interface, manual snapshot from September 12, 2026". */
function manualAlt(s, portal = s.portal) {
  const day = weekInWords(String(s.createdAt || "").slice(0, 10));
  return `${portal} ${s.device === "mobile" ? "mobile" : "desktop"} interface, manual snapshot${day ? ` from ${day}` : ""}`;
}

// One result card, reusing the "Manual observations" modal card style.
function manualResultCard(s) {
  const src = s.image || (s.images && s.images[0]) || "";
  const zoom = src
    ? ` data-full="${esc(src)}" data-title="${esc(s.portal)} manual snapshot" data-file="${esc(s.slug)}-manual-${esc(s.device)}"`
    : "";
  const inner = src
    ? `<img src="${esc(thumbUrl(src))}" alt="${esc(manualAlt(s))}"${sizeAttrs((s.sizes || [])[0])} loading="lazy" />`
    : "";
  return `
    <figure class="manual-cell filled">
      <div class="manual-img"${zoom}>
        ${inner}
        <span class="manual-chip">${esc(s.device)}</span>
      </div>
      <figcaption>
        <div class="manual-cap-text">
          <b>${esc(s.portal)} · ${esc(fmtDateYear(s.createdAt))}</b>
          <span>${esc(s.description || "No description")}</span>
        </div>
      </figcaption>
    </figure>`;
}

// Render matching manual observations below the weekly grid. The section only
// appears while a query is active AND at least one shot matches; it respects the
// portal chip filter and searches note/caption, portal name and company.
function renderManualResults() {
  const section = $("#manualResults");
  const grid = $("#manualResultsGrid");
  if (!section || !grid) return;
  const q = state.search.trim().toLowerCase();
  if (!q || state.manualShots === null) {
    section.hidden = true;
    grid.innerHTML = "";
    return;
  }
  const shots = state.manualShots.filter((s) => {
    const portalOk = state.selected.size === 0 || state.selected.has(s.slug);
    if (!portalOk) return false;
    return `${s.portal ?? ""} ${s.company ?? ""} ${s.description ?? ""}`
      .toLowerCase()
      .includes(q);
  });
  if (!shots.length) {
    section.hidden = true;
    grid.innerHTML = "";
    return;
  }
  grid.innerHTML = shots.map(manualResultCard).join("");
  section.hidden = false;
}

// Lazily fetch every manual shot the first time the user searches, then render.
function updateManualResults() {
  const q = state.search.trim().toLowerCase();
  if (!q) {
    const section = $("#manualResults");
    if (section) { section.hidden = true; }
    return;
  }
  if (state.manualShots === null) {
    if (!state.manualLoading) {
      state.manualLoading = true;
      getJSON("/api/manual/all")
        .then((data) => { state.manualShots = data.shots || []; })
        .catch(() => { state.manualShots = []; })
        .finally(() => { state.manualLoading = false; renderManualResults(); });
    }
    return; // renders once the fetch resolves (using the latest query)
  }
  renderManualResults();
}

// ---- desktop-only hero interaction: orb follows cursor ---------------------
function initHeroOrbFollow() {
  const panel = document.querySelector(".hero-panel");
  const orb = document.querySelector(".hero-orb");
  if (!panel || !orb) return;

  const reduced = window.matchMedia("(prefers-reduced-motion:reduce)");
  let raf = 0;
  let target = null;
  let current = null;
  let rest = null; // orb's CSS resting position (left/top), relative to the panel
  let activeTouch = false;

  const stop = () => {
    target = null;
    activeTouch = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const reset = () => {
    stop();
    current = null;
    rest = null;
    orb.style.transform = "";
  };

  const tick = () => {
    if (!target) { raf = 0; return; }
    if (!current) current = { ...target };
    current.x += (target.x - current.x) * 0.18;
    current.y += (target.y - current.y) * 0.18;
    // Translate from the resting position instead of setting left/top, so
    // moving the orb stays on the compositor and doesn't trigger layout.
    const dx = current.x - rest.x;
    const dy = current.y - rest.y;
    orb.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
    raf = requestAnimationFrame(tick);
  };

  const follow = (e) => {
    if (reduced.matches) { reset(); return; }
    if (!rest) {
      const cs = getComputedStyle(orb);
      rest = { x: parseFloat(cs.left) || 0, y: parseFloat(cs.top) || 0 };
    }
    const rect = panel.getBoundingClientRect();
    target = {
      x: e.clientX - rect.left - orb.offsetWidth / 2,
      y: e.clientY - rect.top - orb.offsetHeight / 2,
    };
    if (!raf) raf = requestAnimationFrame(tick);
  };

  panel.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") activeTouch = true;
    follow(e); // mobile tap moves the orb immediately
  });
  panel.addEventListener("pointermove", (e) => {
    // Desktop follows hover; touch follows only while the finger is down.
    if (e.pointerType !== "mouse" && !activeTouch) return;
    follow(e);
  });
  panel.addEventListener("pointerup", stop);
  panel.addEventListener("pointercancel", stop);
  // Keep the orb at its last position when leaving the hero; don't snap back.
  panel.addEventListener("pointerleave", stop);
  reduced.addEventListener("change", reset);
  window.addEventListener("resize", reset);
}

// ---- hero sub copy: design annotations on the keywords ---------------------
// Started once, when the homepage is first shown: a link to another view keeps the hero hidden (and its
// CSS animations unstarted) until the viewer goes to the homepage.
let heroAnnotationsStarted = false;
function startHeroAnnotations() {
  if (heroAnnotationsStarted) return;
  heroAnnotationsStarted = true;
  initHeroAnnotations();
}
function initHeroAnnotations() {
  const sub = document.querySelector(".hero-sub");
  if (!sub) return;

  const reduced = window.matchMedia("(prefers-reduced-motion:reduce)");
  const PLAY_MS = 4800; // last annotation starts at 3s and runs 1.7s
  let playingUntil = 0;

  const play = () => {
    if (reduced.matches || Date.now() < playingUntil) return;
    playingUntil = Date.now() + PLAY_MS;
    // Removing the class and forcing a reflow restarts the keyframes.
    sub.classList.remove("annot");
    void sub.offsetWidth;
    sub.classList.add("annot");
  };

  // Start as the last word settles: its long ease-out already looks done about
  // 55% of the way in. Timed from the word's own animation rather than from when
  // this script ran, so slow connections don't add a pause. If the words already
  // finished (the animation is gone), play() runs at once.
  const words = [...sub.querySelectorAll(".w")];
  const wordIn = words.at(-1)?.getAnimations().find((a) => a.animationName === "word-in");
  if (wordIn) {
    const t = wordIn.effect.getComputedTiming();
    setTimeout(play, Math.max(0, t.delay + t.duration * 0.55 - (wordIn.currentTime ?? 0)));
  } else play();
  sub.addEventListener("mouseenter", play);

  // ::first-line doesn't reach into the inline-block word spans, so mark the
  // first line's words ourselves to keep it in the darker text colour.
  // Also mark words that start a line: a keyword there anchors its tag to its
  // left edge, so a right-aligned tag (layout) can't run off the panel.
  const markFirstLine = () => {
    if (!words.length) return;
    const top = words[0].offsetTop;
    const left = words[0].offsetLeft;
    words.forEach((w) => {
      w.classList.toggle("l1", Math.abs(w.offsetTop - top) < 2);
      w.classList.toggle("ls", Math.abs(w.offsetLeft - left) < 2);
    });
  };
  markFirstLine();
  // fonts.ready can resolve before the web font is even requested; loadingdone
  // fires after the swap, when line breaks may have changed.
  document.fonts?.addEventListener("loadingdone", markFirstLine);
  window.addEventListener("resize", markFirstLine);
}

// ---- manual snapshots: per-portal mini library + upload --------------------
function initManualSnapshots() {
  const modal = document.createElement("div");
  modal.className = "manual-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="manual-backdrop" data-manual-close></div>
    <section class="manual-panel" role="dialog" aria-modal="true" aria-label="Manual snapshots">
      <header class="manual-head">
        <div>
          <span class="manual-kicker">Manual observations</span>
          <h2 id="manualTitle">View more</h2>
        </div>
        <button class="manual-close" type="button" data-manual-close aria-label="Close">&times;</button>
      </header>
      <div class="manual-grid" id="manualGrid"></div>
    </section>`;
  document.body.appendChild(modal);

  const grid = modal.querySelector("#manualGrid");
  const title = modal.querySelector("#manualTitle");
  let current = { slug: "", portal: "" };
  let currentShots = [];
  let uploadOpen = false;
  let editingId = null;

  const close = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
  };

  async function load() {
    grid.innerHTML = `<div class="manual-loading">Loading…</div>`;
    try {
      const data = await getJSON(`/api/manual?slug=${encodeURIComponent(current.slug)}`);
      currentShots = data.shots || [];
      uploadOpen = false;
      editingId = null;
      render(currentShots);
    } catch {
      render([], "Manual library is not ready yet. Run the manual migration first.");
    }
  }

  function render(shots, error = "") {
    const cells = [addCell()];
    if (uploadOpen || error) cells.push(uploadCell(error));
    for (const s of shots) {
      cells.push(filledCell(s));
    }
    grid.innerHTML = cells.join("");
    wireAddCell();
    wireUploadForm();
    wireEditCells();
    wireShareCells();
    wireCarousels();
  }

  function toast(text) {
    const panel = modal.querySelector(".manual-panel");
    if (!panel) return;
    let t = panel.querySelector(".manual-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "manual-toast";
      panel.appendChild(t);
    }
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function wireShareCells() {
    modal.querySelectorAll(".manual-share-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        // Share the image currently shown in this card's carousel (fall back to cover).
        const cell = btn.closest(".manual-cell");
        const car = cell && cell.querySelector(".manual-carousel");
        const slides = car ? car.querySelectorAll(".manual-img") : [];
        const idx = car ? Number(car.dataset.index) || 0 : 0;
        const rel = (slides[idx] && slides[idx].dataset.full) || btn.dataset.cover;
        if (!rel) return;
        const absolute = new URL(rel, location.origin).href;
        // Generate a shareable link to the image and copy it to the clipboard.
        try {
          await navigator.clipboard.writeText(absolute);
          toast("Link copied");
        } catch {
          const ta = document.createElement("textarea");
          ta.value = absolute;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); toast("Link copied"); }
          catch { toast("Copy failed"); }
          ta.remove();
        }
      });
    });
  }

  function wireCarousels() {
    modal.querySelectorAll(".manual-carousel").forEach((car) => {
      const track = car.querySelector(".manual-track");
      const dots = [...car.querySelectorAll(".manual-dot")];
      const count = track.children.length;
      if (count <= 1) return;
      const go = (i) => {
        const idx = (i + count) % count;
        car.dataset.index = String(idx);
        track.style.transform = `translateX(${-idx * 100}%)`;
        dots.forEach((d, di) => d.classList.toggle("active", di === idx));
      };
      car.querySelector(".manual-nav.prev")?.addEventListener("click", (e) => { e.stopPropagation(); go(+car.dataset.index - 1); });
      car.querySelector(".manual-nav.next")?.addEventListener("click", (e) => { e.stopPropagation(); go(+car.dataset.index + 1); });
      dots.forEach((d) => d.addEventListener("click", (e) => { e.stopPropagation(); go(+d.dataset.i); }));
    });
  }

  function filledCell(s) {
    if (editingId === s.id) {
      const savedToken = sessionStorage.getItem("manualUploadToken") || "";
      const keys = s.imageKeys && s.imageKeys.length ? s.imageKeys : [];
      const imgsE = (s.images && s.images.length ? s.images : [s.image]).filter(Boolean);
      const thumbs = imgsE.map((src, i) => `
              <div class="manual-edit-thumb" data-key="${esc(keys[i] || "")}">
                <img src="${esc(thumbUrl(src))}" alt="image ${i + 1}"${sizeAttrs((s.sizes || [])[i])} />
                <button type="button" class="manual-thumb-del" aria-label="Delete image" title="Delete image">&times;</button>
              </div>`).join("");
      return `
        <figure class="manual-cell filled editing">
          <form class="manual-edit" data-id="${esc(s.id)}">
            <div class="manual-edit-thumbs">${thumbs}</div>
            <label class="manual-file compact">
              <input name="image" type="file" accept="image/*" multiple />
              <span class="manual-plus" aria-hidden="true">+</span>
              <span>Add images</span>
              <small>Max 5 total</small>
            </label>
            <textarea name="description" rows="3" maxlength="220" placeholder="Description">${esc(s.description || "")}</textarea>
            <input name="token" type="password" autocomplete="off" value="${esc(savedToken)}" placeholder="Upload token" required />
            <div class="manual-edit-actions">
              <button type="button" class="manual-edit-cancel">Cancel</button>
              <button type="submit" class="manual-edit-save">Save</button>
            </div>
            <p class="manual-msg"></p>
          </form>
        </figure>`;
    }
    const imgs = (s.images && s.images.length ? s.images : [s.image]).filter(Boolean);
    const slides = imgs.map((src, i) => `
          <div class="manual-img" data-full="${esc(src)}" data-title="${esc(current.portal)} manual snapshot" data-file="${esc(current.slug)}-manual-${esc(s.device)}">
            <img src="${esc(thumbUrl(src))}" alt="${esc(manualAlt(s, current.portal))}"${sizeAttrs((s.sizes || [])[i])} loading="lazy" />
          </div>`).join("");
    const multi = imgs.length > 1;
    const nav = multi ? `
        <button type="button" class="manual-nav prev" aria-label="Previous image">&#8249;</button>
        <button type="button" class="manual-nav next" aria-label="Next image">&#8250;</button>
        <div class="manual-dots">${imgs.map((_, i) => `<button type="button" class="manual-dot${i === 0 ? " active" : ""}" data-i="${i}" aria-label="Image ${i + 1}"></button>`).join("")}</div>` : "";
    return `
      <figure class="manual-cell filled">
        <div class="manual-carousel" data-index="0">
          <div class="manual-track" style="transform:translateX(0)">${slides}</div>
          <span class="manual-chip">${esc(s.device)}</span>
          ${nav}
        </div>
        <figcaption>
          <div class="manual-cap-text">
            <b>${esc(fmtDate(s.createdAt))}</b>
            <span>${esc(s.description || "No description")}</span>
          </div>
          <span class="manual-actions">
            <button type="button" class="manual-edit-btn" data-id="${esc(s.id)}" aria-label="Edit description" title="Edit description">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M14.06 4.94l3.75 3.75L7.5 19H3.75v-3.75L14.06 4.94Zm1.06-1.06l1.82-1.82a1.5 1.5 0 0 1 2.12 0l1.63 1.63a1.5 1.5 0 0 1 0 2.12l-1.82 1.82-3.75-3.75Z"/></svg>
            </button>
            <button type="button" class="manual-share-btn" data-cover="${esc(s.image)}" aria-label="Copy share link" title="Copy share link">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18 8a3 3 0 1 0-2.82-4H15a3 3 0 0 0 .18 1.06L8.9 8.6a3 3 0 1 0 0 6.8l6.28 3.54A3 3 0 1 0 18 16a3 3 0 0 0-1.82.62L9.9 13.08a3.02 3.02 0 0 0 0-2.16l6.28-3.54A2.99 2.99 0 0 0 18 8Z"/></svg>
            </button>
          </span>
        </figcaption>
      </figure>`;
  }

  function addCell() {
    return `
      <button class="manual-cell manual-add" type="button" aria-label="Add another manual snapshot">
        <span class="manual-add-plus" aria-hidden="true">+</span>
        <span>Add image</span>
      </button>`;
  }

  function uploadCell(error = "") {
    const savedToken = sessionStorage.getItem("manualUploadToken") || "";
    return `
      <form class="manual-cell upload" id="manualUploadForm">
        <label class="manual-file">
          <input name="image" type="file" accept="image/*" multiple required />
          <span>Upload screenshots</span>
          <small>Up to 5 images</small>
          <div class="manual-progress" hidden>
            <div class="manual-progress-track"><div class="manual-progress-bar"></div></div>
            <span class="manual-progress-pct">0%</span>
          </div>
        </label>
        <div class="manual-row">
          <label>Device
            <select name="device">
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </label>
          <label>Token
            <input name="token" type="password" autocomplete="off" value="${esc(savedToken)}" placeholder="Upload token" required />
          </label>
        </div>
        <label>Description
          <textarea name="description" rows="3" maxlength="220" placeholder="What changed? e.g. New hero layout, updated onboarding UI…"></textarea>
        </label>
        <button class="manual-submit" type="submit">Add to library</button>
        <p class="manual-msg ${error ? "show" : ""}">${esc(error)}</p>
      </form>`;
  }

  function wireAddCell() {
    const add = modal.querySelector(".manual-add");
    if (!add) return;
    add.addEventListener("click", () => {
      uploadOpen = true;
      render(currentShots);
    });
  }

  // POST form-data with real upload progress (fetch can't report it).
  function uploadWithProgress(url, fd, token, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("load", () => {
        let out = {};
        try { out = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(out);
        else reject(new Error(out.error || `Upload failed (${xhr.status})`));
      });
      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.send(fd);
    });
  }

  function wireUploadForm() {
    const form = modal.querySelector("#manualUploadForm");
    if (!form) return;
    const msg = form.querySelector(".manual-msg");
    const prog = form.querySelector(".manual-progress");
    const bar = form.querySelector(".manual-progress-bar");
    const pct = form.querySelector(".manual-progress-pct");
    const submitBtn = form.querySelector(".manual-submit");
    const setProgress = (p) => { if (bar) bar.style.width = p + "%"; if (pct) pct.textContent = p + "%"; };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = form.querySelector('input[name="image"]');
      if (!fileInput || !fileInput.files.length) {
        msg.textContent = "Please choose at least one image.";
        msg.classList.add("show");
        return;
      }
      if (fileInput.files.length > 5) {
        msg.textContent = "Please choose at most 5 images.";
        msg.classList.add("show");
        return;
      }
      const fd = new FormData(form);
      const token = String(fd.get("token") || "").trim();
      fd.set("slug", current.slug);
      sessionStorage.setItem("manualUploadToken", token);
      msg.classList.remove("show");
      msg.textContent = "";
      if (prog) prog.hidden = false;
      setProgress(0);
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Uploading…"; }
      try {
        await uploadWithProgress("/api/manual/upload", fd, token, setProgress);
        setProgress(100);
        uploadOpen = false;
        await load();
      } catch (err) {
        if (prog) prog.hidden = true;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add to library"; }
        msg.textContent = err.message || "Upload failed";
        msg.classList.add("show");
      }
    });
  }

  function wireEditCells() {
    modal.querySelectorAll(".manual-edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingId = btn.dataset.id;
        render(currentShots);
      });
    });
    const editForm = modal.querySelector(".manual-edit");
    if (!editForm) return;
    editForm.querySelector(".manual-edit-cancel").addEventListener("click", () => {
      editingId = null;
      render(currentShots);
    });
    // Delete an existing image: remove its thumb from the form (applied on Save).
    editForm.querySelectorAll(".manual-thumb-del").forEach((del) => {
      del.addEventListener("click", () => {
        const thumbs = editForm.querySelectorAll(".manual-edit-thumb");
        const fileInput = editForm.querySelector('input[name="image"]');
        if (thumbs.length <= 1 && (!fileInput || !fileInput.files.length)) {
          const m = editForm.querySelector(".manual-msg");
          m.textContent = "A card needs at least one image.";
          m.classList.add("show");
          return;
        }
        del.closest(".manual-edit-thumb").remove();
      });
    });
    const msg = editForm.querySelector(".manual-msg");
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = editForm.dataset.id;
      const description = String(editForm.querySelector("textarea").value || "").trim();
      const token = String(editForm.querySelector('input[name="token"]').value || "").trim();
      const keep = [...editForm.querySelectorAll(".manual-edit-thumb")].map((t) => t.dataset.key).filter(Boolean);
      const fileInput = editForm.querySelector('input[name="image"]');
      const added = fileInput ? fileInput.files.length : 0;
      if (keep.length + added < 1) {
        msg.textContent = "A card needs at least one image.";
        msg.classList.add("show");
        return;
      }
      if (keep.length + added > 5) {
        msg.textContent = "Up to 5 images per card.";
        msg.classList.add("show");
        return;
      }
      sessionStorage.setItem("manualUploadToken", token);
      msg.textContent = "Saving…";
      msg.classList.add("show");
      const fd = new FormData();
      fd.set("id", id);
      fd.set("description", description);
      fd.set("keep", JSON.stringify(keep));
      if (fileInput) for (const f of fileInput.files) fd.append("image", f);
      try {
        const res = await fetch("/api/manual/edit", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: fd,
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Save failed (${res.status})`);
        editingId = null;
        await load();
      } catch (err) {
        msg.textContent = err.message || "Save failed";
      }
    });
  }

  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".manual-open");
    if (!btn) return;
    current = { slug: btn.dataset.slug, portal: btn.dataset.portal };
    title.textContent = current.portal;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    load();
  });
  modal.addEventListener("click", (e) => { if (e.target.closest("[data-manual-close]")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });
}

// ---- hash routing: #collection <-> gallery --------------------------------
// ---- compare (#compare; called Analytics before): AI surface UIs side by side ----
const an = {
  mode: "portals",      // "portals" (one week, many portals) | "weeks" (one portal, many weeks)
  week: null,           // context week for portals mode
  portal: null,         // context portal for weeks mode
  device: "desktop",
  portals: new Set(),   // selected slugs to compare (portals mode)
  weeks: new Set(),     // selected weeks to compare (weeks mode)
  view: "canvas",       // "table" | "canvas"
  shared: null,         // canvas setup from a shared link, used by the next canvas of that selection
  inited: false,
};
const AN_MAX = 4;       // cap columns for readability
const anWeekCache = new Map();

async function anCapturesFor(week) {
  if (anWeekCache.has(week)) return anWeekCache.get(week);
  const d = await getJSON(`/api/captures?week=${encodeURIComponent(week)}`);
  const list = d.captures || [];
  anWeekCache.set(week, list);
  return list;
}

// --- grounded colour signals derived from real palette/brand hex ---
function anHexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "");
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function anRelLum({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function anHue({ r, g, b }) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return null;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return h;
}
function anTone(colors) {
  const rgbs = colors.map(anHexToRgb).filter(Boolean);
  if (!rgbs.length) return null;
  const L = rgbs.reduce((s, c) => s + anRelLum(c), 0) / rgbs.length;
  return L > 0.62 ? "Light" : L < 0.3 ? "Dark" : "Balanced";
}
function anTemp(colors) {
  const hues = colors.map(anHexToRgb).filter(Boolean).map(anHue).filter((h) => h != null);
  if (!hues.length) return null;
  let warm = 0, cool = 0;
  for (const h of hues) { if (h < 90 || h >= 300) warm++; else cool++; }
  if (warm > cool * 1.4) return "Warm";
  if (cool > warm * 1.4) return "Cool";
  return "Neutral";
}

function anShot(c) {
  if (!c) return null;
  if (an.device === "mobile") return c.hasMobile ? c.imageMobile : null;
  return c.image;
}

function enterAnalytics() {
  if (!an.inited) {
    an.week = state.weeks[0]?.week || null;
    an.portal = state.portals[0]?.slug || null;
    an.portals = new Set(state.portals.slice(0, 2).map((p) => p.slug));
    an.weeks = new Set(state.weeks.slice(0, Math.min(2, AN_MAX)).map((w) => w.week));
    an.inited = true;
    // Static mode/device toggles bind once.
    const view = $("#analyticsView");
    view.querySelectorAll(".an-mode .vt-btn").forEach((b) =>
      b.addEventListener("click", () => {
        an.mode = b.dataset.mode;
        anSyncToggles();
        renderAnalytics();
        anChanged();
      })
    );
    view.querySelectorAll(".an-device .vt-btn").forEach((b) =>
      b.addEventListener("click", () => {
        an.device = b.dataset.andevice;
        anSyncToggles();
        renderAnalytics();
        anChanged();
      })
    );
    $("#anClear").addEventListener("click", () => {
      (an.mode === "portals" ? an.portals : an.weeks).clear();
      renderAnalytics();
      anChanged();
    });
    view.querySelectorAll(".an-view .vt-btn").forEach((b) =>
      b.addEventListener("click", () => {
        an.view = b.dataset.anview;
        anSyncToggles();
        renderAnalytics();
        anChanged();
      })
    );
    $("#anShare").addEventListener("click", anCopyLink);
  }
  // A link with a setup (#compare?…) replaces the current one, unless it is the URL this page wrote itself
  // (coming back to it from another view): then the setup on screen already matches it.
  if (location.hash !== anWrittenHash) {
    const shared = parseAnalyticsHash(location.hash, {
      portals: state.portals.map((p) => p.slug), weeks: state.weeks.map((w) => w.week), max: AN_MAX,
    });
    if (shared) anApplyShared(shared);
  }
  anSyncToggles();
  renderAnalytics();
  const row = $("#anPortals");
  revealChip(row, row.querySelector('.chip[aria-selected="true"]'));
}

// ---- shareable links: the setup lives in the hash after #compare (public/analytics-share.js) ----
function anApplyShared(s) {
  for (const k of ["view", "mode", "portal", "week", "device"]) if (s[k]) an[k] = s[k];
  if (s.weeks) an.weeks = new Set(s.weeks);
  if (s.portals) an.portals = new Set(s.portals);
  // The canvas from a link is used only for the selection in that link.
  an.shared = s.canvas ? { ...s.canvas, key: anCanvasKey() } : null;
}

/** Mode, device and view buttons follow `an`. */
function anSyncToggles() {
  const view = $("#analyticsView");
  const sync = (sel, attr, value) => view.querySelectorAll(`${sel} .vt-btn`).forEach((x) => {
    const on = x.dataset[attr] === value; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on));
  });
  sync(".an-mode", "mode", an.mode);
  sync(".an-view", "anview", an.view);
  anSyncDevice();
}

let anWrittenHash = null;
let anHashTimer = 0;
/** Write the current setup to the URL. replaceState fires no hashchange, so nothing re-renders or scrolls. */
function anWriteHash() {
  clearTimeout(anHashTimer);
  if (hashRoute(location.hash) !== "#compare") return; // left Compare before the timer ran
  const board = an.view === "canvas" ? anCanvasState() : null;
  // No board (still loading, or the stacked narrow view): keep a link's canvas setup in the URL.
  const pending = an.shared && an.shared.key === anCanvasKey() ? an.shared : null;
  const canvas = board || (pending && {
    pos: pending.layout ? pending.layout.pos : null,
    edges: pending.layout ? pending.layout.edges : [],
    offsets: pending.layout ? pending.layout.offsets : null,
    cam: { k: pending.zoom, x: pending.pan && pending.pan[0], y: pending.pan && pending.pan[1] },
  });
  const hash = buildAnalyticsHash({
    view: an.view, mode: an.mode, portal: an.portal, week: an.week, device: an.device,
    weeks: state.weeks.map((w) => w.week).filter((w) => an.weeks.has(w)),
    portals: state.portals.map((p) => p.slug).filter((p) => an.portals.has(p)),
    canvas,
  });
  anWrittenHash = hash;
  if (location.hash !== hash) history.replaceState(history.state, "", hash);
}
/** The viewer changed the setup: update the URL, at most every 300ms while dragging. A link's canvas
 * setup stays in use (for example across Table and back) until the viewer changes the selection or the board. */
function anChanged() {
  if (an.shared && an.shared.key !== anCanvasKey()) an.shared = null;
  clearTimeout(anHashTimer);
  anHashTimer = setTimeout(anWriteHash, 300);
}

async function anCopyLink() {
  anWriteHash();
  const label = $("#anShare .anc-share-label");
  const show = (text) => {
    label.textContent = text;
    clearTimeout(label._t);
    label._t = setTimeout(() => { label.textContent = "Copy link"; }, 2000);
  };
  try {
    await navigator.clipboard.writeText(location.href);
    show("Link copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = location.href;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { show(document.execCommand("copy") ? "Link copied" : "Copy failed"); } catch { show("Copy failed"); }
    ta.remove();
  }
}

// Canvas compares desktop screenshots only (findings come from the desktop analysis): there, Mobile is
// disabled and a Mobile selection falls back to Desktop. Back in Table, Mobile is enabled again and the
// device stays Desktop until the user picks Mobile.
const AN_CANVAS_DEVICE_NOTE = "Canvas compares desktop screenshots only.";
function anSyncDevice() {
  const canvas = an.view === "canvas";
  if (canvas && an.device === "mobile") an.device = "desktop";
  $("#analyticsView").querySelectorAll(".an-device .vt-btn").forEach((x) => {
    const on = x.dataset.andevice === an.device;
    x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on));
    if (x.dataset.andevice !== "mobile") return;
    x.disabled = canvas;
    if (canvas) { x.setAttribute("aria-disabled", "true"); x.title = AN_CANVAS_DEVICE_NOTE; }
    else { x.removeAttribute("aria-disabled"); x.removeAttribute("title"); }
  });
}

// Compare's portal row: the site's first four portals, then these (when the site has them), then the rest in site order.
const AN_ROW_NEXT = ["grok", "meta-ai", "muse", "manus"];
function anRowPortals() {
  const first = state.portals.slice(0, 4);
  const next = AN_ROW_NEXT.map((slug) => state.portals.find((p) => p.slug === slug)).filter((p) => p && !first.includes(p));
  return [...first, ...next, ...state.portals.filter((p) => !first.includes(p) && !next.includes(p))];
}

function anChip(v, label, on, brand) {
  const sw = brand ? `<span class="swatch" style="background:${esc(brand)}"></span>` : "";
  return `<button class="chip" type="button" data-v="${esc(v)}" aria-selected="${on ? "true" : "false"}">${sw}${esc(label)}</button>`;
}

function renderAnalytics() {
  const portalsMode = an.mode === "portals";
  const weekOptions = state.weeks.map((w) => ({ value: w.week, label: shortWeekLabel(w.week) }));
  // Across portals: one week, several portals. Single portal: one portal, several weeks.
  $("#anWeekLabel").textContent = portalsMode ? "Week" : "Weeks";
  weekPick($("#anWeek"), portalsMode
    ? {
      options: weekOptions, selected: an.week ? [an.week] : [], multi: false, labelledBy: "anWeekLabel",
      onChange: (week) => { an.week = week; renderAnalytics(); anChanged(); },
    }
    : {
      // Multi select keeps its menu open, so only the count and the comparison re-render on each pick.
      options: weekOptions, selected: state.weeks.map((w) => w.week).filter((w) => an.weeks.has(w)), multi: true, max: AN_MAX,
      labelledBy: "anWeekLabel",
      onChange: (weeks) => { an.weeks = new Set(weeks); anSyncSelection(); renderAnContent(); anChanged(); },
    });
  // Every portal in one row that scrolls sideways (snapping to chips, edges fading where there is more).
  // Re-rendering keeps the row where the viewer scrolled it.
  const chips = $("#anPortals");
  const isOn = (slug) => (portalsMode ? an.portals.has(slug) : slug === an.portal);
  const scrollLeft = chips.scrollLeft;
  chips.setAttribute("aria-label", portalsMode ? "Portals" : "Portal");
  chips.innerHTML = anRowPortals().map((p) => anChip(p.slug, p.name, isOn(p.slug), p.brand)).join("");
  chips.scrollLeft = scrollLeft;
  chips.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const v = c.dataset.v;
      if (!portalsMode) an.portal = v;
      else if (an.portals.has(v)) an.portals.delete(v);
      else if (an.portals.size < AN_MAX) an.portals.add(v);
      renderAnalytics();
      anChanged();
      $(`#anPortals .chip[data-v="${CSS.escape(v)}"]`)?.focus({ preventScroll: true }); // the re-render replaced the button
    })
  );
  fadeChipEdges(chips);
  anSyncSelection();
  renderAnContent();
}

// "N of 4 selected" for what is being compared (portals, or weeks over time); Clear needs something to clear.
function anSyncSelection() {
  const n = an.mode === "portals" ? an.portals.size : an.weeks.size;
  $("#anCount").textContent = `${n} of ${AN_MAX} selected`;
  $("#anClear").disabled = n === 0;
}

// The comparison below the controls: table or canvas.
function renderAnContent() {
  const canvas = an.view === "canvas";
  $("#anTableWrap").parentElement.hidden = canvas;
  $("#anCanvasWrap").hidden = !canvas;
  if (canvas) renderAnCanvas();
  else { unmountAnCanvas(); renderAnTable(); }
}

function anEmpty(msg) { return `<div class="an-empty">${esc(msg)}</div>`; }

// Columns for the current selection, shared by the table and the canvas: { columns } or { empty: message }.
async function anColumns() {
  try {
    if (an.mode === "portals") {
      if (!an.week || an.portals.size === 0) return { empty: "Pick a week and at least one portal to compare." };
      const caps = await anCapturesFor(an.week);
      return { columns: state.portals
        .filter((p) => an.portals.has(p.slug))
        .map((p) => ({ key: p.slug, label: p.name, portalName: p.name, icon: p.slug, cap: caps.find((c) => c.slug === p.slug) })) };
    }
    if (!an.portal || an.weeks.size === 0) return { empty: "Pick a portal and at least one week to compare." };
    const weeks = state.weeks.map((w) => w.week).filter((w) => an.weeks.has(w));
    const capsByWeek = await Promise.all(weeks.map((w) => anCapturesFor(w)));
    const p = state.portals.find((pp) => pp.slug === an.portal);
    return { columns: weeks.map((w, i) => ({ key: w, label: shortWeekLabel(w), portalName: p ? p.name : an.portal, icon: i === 0 && p ? p.slug : "", cap: capsByWeek[i].find((c) => c.slug === an.portal) })) };
  } catch {
    return { empty: "Could not load comparison data." };
  }
}

async function renderAnTable() {
  const wrap = $("#anTableWrap");
  wrap.innerHTML = `<div class="an-loading">Loading…</div>`;
  const { columns, empty } = await anColumns();
  if (empty) { wrap.innerHTML = anEmpty(empty); return; }
  const slugs = [...new Set(columns.filter((c) => c.cap).map((c) => c.cap.slug))];
  const latest = new Map(await Promise.all(slugs.map(async (slug) => [slug, await anLatestWeek(slug)])));
  // Phones show one card per column instead of the table (anStackHTML).
  wrap.innerHTML = AN_PHONE.matches ? anStackHTML(columns, latest) : anTableHTML(columns, latest);
}
/** Phone widths, where the Table view shows stacked cards; crossing the width redraws the Table. */
const AN_PHONE = window.matchMedia("(max-width: 640px)");
AN_PHONE.addEventListener("change", () => {
  if (an.inited && an.view === "table" && !$("#analyticsView").hidden) renderAnTable();
});

/**
 * A portal's newest week with a successful capture, the week its page /portals/<slug> shows (src/db.ts,
 * latestCaptureForPortal). Walks the archived weeks newest first through the cached week captures, so it is decided
 * when the table renders and follows a newly added week. Null when the portal has no successful capture.
 */
async function anLatestWeek(slug) {
  for (const { week } of state.weeks) {
    try {
      if ((await anCapturesFor(week)).some((c) => c.slug === slug && c.status === "ok")) return week;
    } catch { return null; }
  }
  return null;
}

/**
 * The PAGE row's link for a column: /portals/<slug> for the portal's latest captured week, /portals/<slug>/<week>
 * for older ones. Only successful captures have a page.
 */
function anPageLink(c, latest) {
  if (!c.cap || c.cap.status !== "ok") return "—";
  const { slug, week } = c.cap;
  const href = latest.get(slug) === week ? `/portals/${encodeURIComponent(slug)}` : `/portals/${encodeURIComponent(slug)}/${encodeURIComponent(week)}`;
  const date = shortWeekLabel(week);
  return `<a class="an-page-link" href="${esc(href)}" aria-label="${esc(`Open the ${c.portalName} page for the week of ${date}`)}">${esc(`${c.portalName} · ${date}`)} <span aria-hidden="true">→</span></a>`;
}

// Canvas view: the same selection as the table, always desktop screenshots (findings describe the desktop capture only).
let anCanvasSeq = 0;
async function renderAnCanvas() {
  const wrap = $("#anCanvasWrap");
  const seq = ++anCanvasSeq;
  unmountAnCanvas();
  wrap.innerHTML = `<div class="an-loading">Loading…</div>`;
  const { columns, empty } = await anColumns();
  if (seq !== anCanvasSeq || an.view !== "canvas") return;
  if (empty) { wrap.innerHTML = anEmpty(empty); return; }
  const weekSub = (c) => (c.cap && c.cap.week ? shortWeekLabel(c.cap.week) : an.mode === "portals" ? shortWeekLabel(an.week) : c.label);
  const cards = columns.map((c) => ({
    id: c.key,
    label: c.label,
    slug: c.cap ? c.cap.slug : null,
    week: c.cap ? c.cap.week : null,
    sub: an.mode === "portals" ? weekSub(c) : c.portalName,
    src: c.cap ? c.cap.image : null,
    alt: c.cap ? shotAlt(c.portalName, "desktop", c.cap.week) : "",
    size: c.cap ? shotSize(c.cap, false) : null,
    file: c.cap ? `${c.cap.slug || "shot"}-${c.cap.week || ""}` : "",
    metrics: c.cap && c.cap.metrics ? c.cap.metrics : null,
  }));
  const storageKey = anCanvasKey();
  const shared = an.shared && an.shared.key === storageKey ? an.shared : null;
  wrap.innerHTML = "";
  mountAnCanvas(wrap, cards, { storageKey, thumbUrl, tools: $("#anCanvasTools"), note: $("#anCanvasNote"), shared,
    onChange: () => { an.shared = null; anChanged(); } });
}

/** localStorage key of the canvas for the current selection (the ids are the cards anColumns returns). */
function anCanvasKey() {
  const ids = an.mode === "portals"
    ? state.portals.map((p) => p.slug).filter((p) => an.portals.has(p))
    : state.weeks.map((w) => w.week).filter((w) => an.weeks.has(w));
  return `anCanvas:v1:${an.mode}:${an.mode === "portals" ? an.week : an.portal}:${ids.sort().join(",")}`;
}

function anTableHTML(cols, latest = new Map()) {
  const head = `<tr><th class="an-rowhead"></th>${cols.map((c) =>
    `<th class="an-colhead">${c.icon ? `<span class="an-logo"><img alt="${esc(c.portalName)} logo"${sizeAttrs(iconSize(c.icon))} loading="lazy" src="${esc(iconUrl(c.icon))}" onerror="this.parentNode.remove()" /></span>` : ""}<span>${esc(c.label)}</span></th>`
  ).join("")}</tr>`;

  const rows = [];
  const fields = anFields(cols, latest);
  rows.push(anRow(fields[0][0], fields[0][1].map((html) => `<td>${html}</td>`)));
  rows.push(...anFindingRows(cols));
  for (const [label, cells, cls] of fields.slice(1)) rows.push(anRow(label, cells.map((html) => `<td${cls ? ` class="${cls}"` : ""}>${html}</td>`)));

  return `<table class="an-table"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}
function anRow(label, tds) { return `<tr><th class="an-rowhead">${esc(label)}</th>${tds.join("")}</tr>`; }

/** Each column's fields, shared by the table and the phone cards: [label, cell HTML per column, cell class]. Snapshot first. */
function anFields(cols, latest) {
  const mobile = an.device === "mobile";
  const tag = (t) => (t ? `<span class="an-tag">${t}</span>` : "—");
  const colours = (c) => [c.cap.brand, ...((c.cap.palette) || [])];
  return [
    ["Snapshot", cols.map((c) => {
      const src = anShot(c.cap);
      if (!src) return `<div class="an-noshot">${c.cap ? (mobile ? "No mobile shot" : "—") : "No capture"}</div>`;
      return `<div class="an-shot an-shot--${mobile ? "mobile" : "desktop"}" data-full="${esc(src)}" data-title="${esc(c.label)}" data-file="${esc((c.cap.slug || "shot") + "-" + (c.cap.week || "") + (mobile ? "-mobile" : ""))}"><img loading="lazy" src="${esc(thumbUrl(src, 1280))}" alt="${esc(shotAlt(c.portalName, mobile ? "mobile" : "desktop", c.cap.week))}"${sizeAttrs(shotSize(c.cap, mobile))} /></div>`;
    })],
    ["Brand colour", cols.map((c) => (c.cap && c.cap.brand ? `<span class="an-swatch" style="background:${esc(c.cap.brand)}"></span><code>${esc(String(c.cap.brand).toUpperCase())}</code>` : "—"))],
    ["Palette", cols.map((c) => {
      const pal = (c.cap && c.cap.palette) || [];
      return pal.length ? `<span class="an-palette">${pal.slice(0, 6).map((h) => `<i style="background:${esc(h)}" title="${esc(h)}"></i>`).join("")}</span>` : "—";
    })],
    ["Tone", cols.map((c) => tag(c.cap ? anTone(colours(c)) : null))],
    ["Colour temp.", cols.map((c) => tag(c.cap ? anTemp(colours(c)) : null))],
    ["Captured", cols.map((c) => (c.cap ? esc(fmtDate(c.cap.capturedAt)) : "—"))],
    ["Page", cols.map((c) => anPageLink(c, latest))],
    ["Design notes", cols.map((c) => (c.cap ? esc(displayedAnalysis(c.cap)) : "—")), "an-notes"],
  ];
}

/**
 * Phones: one card per column, with the Differences and Similarities between neighbouring cards. The pairs are the
 * table's (anFindingRows): two columns share one pair; with more, Single portal compares each week with the next older one,
 * so its lists sit between those two cards, and Across portals compares each product with the first, so its lists
 * sit just before that product's card.
 */
function anStackHTML(cols, latest) {
  const fields = anFields(cols, latest);
  const note = an.device === "mobile" ? "From the desktop analysis" : "";
  const findings = (a, b) => {
    const f = tableFindings(anFindingCard(a), anFindingCard(b));
    return `<section class="an-mcmp" aria-label="${esc(`${a.label} vs ${b.label}`)}"><div class="an-mcmp-head">${esc(`${a.label} vs ${b.label}`)}</div>`
      + ["differences", "similarities"].map((kind) => `<div class="an-mcmp-kind">${kind === "differences" ? "Differences" : "Similarities"}</div>${findingsCellHTML(f, kind, { note })}`).join("")
      + `</section>`;
  };
  const card = (c, i) => `<article class="an-mcard"><h3 class="an-mcard-head">${c.icon ? `<span class="an-logo"><img alt=""${sizeAttrs(iconSize(c.icon))} loading="lazy" src="${esc(iconUrl(c.icon))}" onerror="this.parentNode.remove()" /></span>` : ""}<span>${esc(c.label)}</span></h3>`
    + `<div class="an-mcard-shot">${fields[0][1][i]}</div><dl class="an-mcard-fields">`
    + fields.slice(1).map(([label, cells, cls]) => `<div class="an-mfield${cls ? ` ${cls}` : ""}"><dt>${esc(label)}</dt><dd>${cells[i]}</dd></div>`).join("")
    + `</dl></article>`;
  const parts = [];
  cols.forEach((c, i) => {
    if (i > 0) parts.push(cols.length === 2 || an.mode === "weeks" ? findings(cols[i - 1], c) : findings(c, cols[0]));
    parts.push(card(c, i));
  });
  return `<div class="an-mstack">${parts.join("")}</div>`;
}

/** A Table column as a findings card (public/analytics-canvas.js): the same fields the Canvas cards use. */
const anFindingCard = (c) => ({ label: c.label, slug: c.cap ? c.cap.slug : null, week: c.cap ? c.cap.week : null, metrics: c.cap && c.cap.metrics ? c.cap.metrics : null });

/**
 * Differences and Similarities rows, from the same findings as the Canvas box. Two columns: one cell spanning both.
 * More columns: Single portal compares each week with the next older one (the last column is the oldest shown);
 * Across portals compares each product with the first column. Metrics come from the desktop analysis only, so
 * with Mobile selected each cell says so.
 */
function anFindingRows(cols) {
  const note = an.device === "mobile" ? "From the desktop analysis" : "";
  const muted = (text) => `<div class="an-cmp-empty">${esc(text)}</div>`;
  const row = (kind, label, cells) => `<tr class="an-cmp-row"><th class="an-rowhead">${esc(label)}</th>${cells(kind).join("")}</tr>`;
  let cells;
  if (cols.length === 2) {
    const [a, b] = cols;
    const f = tableFindings(anFindingCard(a), anFindingCard(b));
    cells = (kind) => [`<td class="an-cmp an-cmp--span" colspan="2"><div class="an-cmp-inner">${findingsCellHTML(f, kind, { heading: `${a.label} vs ${b.label}`, note })}</div></td>`];
  } else {
    const weeks = an.mode === "weeks";
    // Each column's pair: [this column, the column it is compared with], or a muted line instead.
    const pairs = cols.map((c, i) => {
      if (weeks) return i === cols.length - 1 ? "Oldest week shown" : [c, cols[i + 1]];
      return i === 0 ? "Compared against this" : [c, cols[0]];
    });
    const found = pairs.map((p) => (typeof p === "string" ? null : tableFindings(anFindingCard(p[0]), anFindingCard(p[1]))));
    cells = (kind) => pairs.map((p, i) => `<td class="an-cmp">${typeof p === "string"
      ? muted(p)
      : findingsCellHTML(found[i], kind, { heading: `vs ${p[1].label}`, note })}</td>`);
  }
  return [row("differences", "Differences", cells), row("similarities", "Similarities", cells)];
}

// ---- hash routing: gallery / collection / compare ---------------------------
// #analytics (Compare's old name) is rewritten to #compare, keeping its setup. #notes and #insights (the Notes
// view, retired on 2026-10-18) go to /changelog. The inline script in index.html does both before first paint.
function route() {
  if (/^#(notes|insights)$/.test(hashRoute(location.hash))) { location.replace("/changelog"); return; }
  const fixed = compareHash(location.hash);
  if (fixed !== location.hash) history.replaceState(history.state, "", fixed);
  // #compare may carry a shared setup after "?" (public/analytics-share.js).
  const hash = hashRoute(location.hash);
  const view = hash === "#collection" ? "collection" : hash === "#compare" ? "compare" : "gallery";
  const views = { gallery: "#galleryView", collection: "#collectionView", compare: "#analyticsView" };
  document.documentElement.dataset.view = view;
  if (view === "gallery") startHeroAnnotations();
  for (const [v, sel] of Object.entries(views)) {
    const el = $(sel);
    if (el) el.hidden = v !== view;
  }
  // Exactly one link is current: the one for this view.
  document.querySelectorAll(".topnav-link[data-nav]").forEach((a) => {
    const on = a.dataset.nav === view;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (view === "collection") renderCollection();
  if (view === "compare") enterAnalytics();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

document.addEventListener("click", () => { closeWeekMenus(); closeMoreMenu(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeWeekMenus();
  closeMoreMenu(true);
});

initLightbox();
initManualSnapshots();
initDownloadAll();
initDeviceToggle();
initSearch();
initCompareButton();
initFilterEdges();
initAnPortalRow();
trackTopbarHeight();
initHeroOrbFollow();
if (document.documentElement.dataset.view === "gallery") startHeroAnnotations();
// The phone menu can open before route() runs: name the current item for screen readers now (CSS already colours it).
document.querySelector(`.topnav-link[data-nav="${document.documentElement.dataset.view}"]`)?.setAttribute("aria-current", "page");
boot().then(route);

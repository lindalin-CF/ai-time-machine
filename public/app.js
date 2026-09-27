// AI Surface Library — front-end controller
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

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
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

function renderFilters() {
  const wrap = $("#filters");
  const chips = [
    `<button class="chip" role="tab" data-portal="all" aria-selected="true">All portals</button>`,
    ...state.portals.map(
      (p) =>
        `<button class="chip" role="tab" data-portal="${esc(p.slug)}" aria-selected="false">` +
        `<span class="swatch" style="background:${esc(p.brand)}"></span>${esc(p.name)}</button>`
    ),
  ];
  wrap.innerHTML = chips.join("");
  wrap.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      const slug = btn.dataset.portal;
      if (slug === "all") {
        state.selected.clear(); // "All portals" resets to showing everything
      } else if (state.selected.has(slug)) {
        state.selected.delete(slug); // toggle off
      } else {
        state.selected.add(slug); // toggle on (multi-select)
      }
      syncFilterChips();
      renderGrid();
      updateManualResults();
    })
  );
  syncFilterChips();
}

// Reflect state.selected on the chips. Empty selection => "All portals" is active.
function syncFilterChips() {
  const wrap = $("#filters");
  if (!wrap) return;
  const none = state.selected.size === 0;
  wrap.querySelectorAll(".chip").forEach((c) => {
    const slug = c.dataset.portal;
    const on = slug === "all" ? none : state.selected.has(slug);
    c.setAttribute("aria-selected", String(on));
  });
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

function syncWeekMenus() {
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
  // Library and Collection each have their own week dropdown; keep both in sync.
  for (const id of ["#weekSelect", "#collectionWeekSelect"]) {
    const sel = $(id);
    if (!sel) continue;
    sel.innerHTML = opts;
    if (state.weeks.length) sel.addEventListener("change", () => loadWeek(sel.value));
    ensureWeekMenu(sel);
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

// Load each portal's favicon as its logo; fall back to the brand colour swatch
// if it fails to load (or there's no usable domain).
function wireBrandLogos() {
  $("#grid").querySelectorAll(".brand-logo").forEach((box) => {
    const domain = box.dataset.domain;
    const img = box.querySelector("img");
    if (!domain || !img) { box.classList.add("is-fallback"); return; }
    img.addEventListener("error", () => box.classList.add("is-fallback"), { once: true });
    img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  });
}

// Collapse long design-analysis text to 5 lines; only show the toggle when it
// actually overflows.
function wireAnalysisToggles() {
  $("#grid").querySelectorAll(".card").forEach((cardEl) => {
    const p = cardEl.querySelector(".analysis");
    const toggle = cardEl.querySelector(".analysis-toggle");
    if (!p || !toggle) return;
    // If the clamped text isn't taller than its visible box, no toggle needed.
    const overflows = p.scrollHeight - p.clientHeight > 2;
    if (!overflows) { toggle.hidden = true; return; }
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      const expanded = p.classList.toggle("expanded");
      p.classList.toggle("clamped", !expanded);
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
    : `<img loading="lazy" src="${esc(shot.src)}" alt="${esc(c.portal)} ${mobile ? "mobile" : "landing"} page" />`;
  return `
  <article class="card">
    <div class="shot${mobile ? " mobile" : ""}" style="--brand:${esc(c.brand)}">
      ${badge}
      ${inner}
    </div>
    <div class="card-body">
      <div class="card-head">
        <div class="portal-id">
          <span class="brand-logo" style="--brand:${esc(c.brand)}" data-domain="${esc(domainOf(c.url))}" title="${esc(c.company)}">
            <img alt="" loading="lazy" />
          </span>
          <div>
            <div class="portal-name"><a class="card-link" href="${esc(portalHref(c))}">${esc(c.portal)}</a></div>
            <div class="portal-co">${esc(c.company)}</div>
          </div>
        </div>
        <a class="visit" href="${esc(c.url)}" target="_blank" rel="noopener">Visit &#8599;</a>
      </div>
      <div class="analysis-label">Design analysis</div>
      <p class="analysis clamped">${esc(displayedAnalysis(c))}</p>
      <button type="button" class="analysis-toggle" aria-expanded="false" aria-label="Show more">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
      </button>
      <a class="analysis-method" href="/how-we-analyze">How this analysis is made</a>
      <div class="card-foot">
        <div class="palette">${palette}</div>
        <button class="manual-open" type="button" data-slug="${esc(c.slug)}" data-portal="${esc(c.portal)}" aria-label="View more snapshots for ${esc(c.portal)}">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5v-14Zm2.5-.5A.5.5 0 0 0 6 5.5v10.09c.17-.04.34-.07.5-.08H18V5H6.5ZM6.5 17A.5.5 0 0 0 6 17.5v1a.5.5 0 0 0 .5.5H20v-2H6.5Z"/></svg>
          <span>View more</span>
        </button>
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
  const open = (full, t, file) => {
    img.src = full;
    img.alt = t + " screenshot";
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
    open(shot.dataset.full, shot.dataset.title || "Screenshot", shot.dataset.file);
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
        : `<img loading="lazy" src="${esc(shot.src)}" alt="${esc(c.portal)} ${mobile ? "mobile" : "landing"} page" />`;
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
  document.querySelectorAll(".vt-btn").forEach((b) => {
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

// One result card, reusing the "Manual observations" modal card style.
function manualResultCard(s) {
  const src = s.image || (s.images && s.images[0]) || "";
  const zoom = src
    ? ` data-full="${esc(src)}" data-title="${esc(s.portal)} manual snapshot" data-file="${esc(s.slug)}-manual-${esc(s.device)}"`
    : "";
  const inner = src
    ? `<img src="${esc(src)}" alt="${esc(s.portal)} manual snapshot" loading="lazy" />`
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
    orb.style.left = "";
    orb.style.top = "";
  };

  const tick = () => {
    if (!target) { raf = 0; return; }
    if (!current) current = { ...target };
    current.x += (target.x - current.x) * 0.18;
    current.y += (target.y - current.y) * 0.18;
    orb.style.left = current.x.toFixed(2) + "px";
    orb.style.top = current.y.toFixed(2) + "px";
    raf = requestAnimationFrame(tick);
  };

  const follow = (e) => {
    if (reduced.matches) { reset(); return; }
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

// ---- playful hero screenshot effect ----------------------------------------
function initHeroScreenshotEffect() {
  const frame = document.querySelector(".hero-frame");
  const panel = document.querySelector(".hero-panel");
  if (!frame || !panel) return;

  const reduced = window.matchMedia("(prefers-reduced-motion:reduce)");
  const clickFx = window.matchMedia("(pointer:fine) and (min-width:761px)");
  let busy = false;

  panel.addEventListener("click", (e) => {
    if (!clickFx.matches || reduced.matches || busy) return;
    if (e.target.closest("a,button,input,select,textarea")) return;
    busy = true;

    const frameRect = frame.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const scale = panelRect.width < 520 ? 0.26 : 0.18;
    const pad = panelRect.width < 520 ? 12 : 18;
    const startX = panelRect.left - frameRect.left;
    const startY = panelRect.top - frameRect.top;
    const endX = frameRect.width - startX - panelRect.width * scale - pad;
    const endY = frameRect.height - startY - panelRect.height * scale - pad;

    const shot = panel.cloneNode(true);
    // Keep hero-panel styling so the fake screenshot visually matches the header.
    shot.className = "hero-panel hero-snapshot-card";
    shot.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    Object.assign(shot.style, {
      left: startX + "px",
      top: startY + "px",
      width: panelRect.width + "px",
      height: panelRect.height + "px",
    });
    // CSS custom properties must be set with setProperty(); Object.assign()
    // creates plain JS fields and the keyframe vars stay unset.
    shot.style.setProperty("--snap-x", endX + "px");
    shot.style.setProperty("--snap-y", endY + "px");
    shot.style.setProperty("--snap-scale", String(scale));

    panel.classList.add("is-snapping");
    frame.appendChild(shot);
    shot.addEventListener("animationend", () => {
      shot.remove();
      panel.classList.remove("is-snapping");
      busy = false;
    }, { once: true });
  });
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
                <img src="${esc(src)}" alt="image ${i + 1}" />
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
    const slides = imgs.map((src) => `
          <div class="manual-img" data-full="${esc(src)}" data-title="${esc(current.portal)} manual snapshot" data-file="${esc(current.slug)}-manual-${esc(s.device)}">
            <img src="${esc(src)}" alt="${esc(current.portal)} manual snapshot" loading="lazy" />
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
// ---- analytics: compare AI surface UIs side by side ------------------------
const an = {
  mode: "portals",      // "portals" (one week, many portals) | "weeks" (one portal, many weeks)
  week: null,           // context week for portals mode
  portal: null,         // context portal for weeks mode
  device: "desktop",
  portals: new Set(),   // selected slugs to compare (portals mode)
  weeks: new Set(),     // selected weeks to compare (weeks mode)
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
    an.weeks = new Set(state.weeks.slice(0, Math.min(3, AN_MAX)).map((w) => w.week));
    an.inited = true;
    // Static mode/device toggles bind once.
    const view = $("#analyticsView");
    view.querySelectorAll(".an-mode .vt-btn").forEach((b) =>
      b.addEventListener("click", () => {
        an.mode = b.dataset.mode;
        view.querySelectorAll(".an-mode .vt-btn").forEach((x) => {
          const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on));
        });
        renderAnalytics();
      })
    );
    view.querySelectorAll(".an-device .vt-btn").forEach((b) =>
      b.addEventListener("click", () => {
        an.device = b.dataset.andevice;
        view.querySelectorAll(".an-device .vt-btn").forEach((x) => {
          const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on));
        });
        renderAnalytics();
      })
    );
  }
  renderAnalytics();
}

function anChip(v, label, on, brand) {
  const sw = brand ? `<span class="swatch" style="background:${esc(brand)}"></span>` : "";
  return `<button class="chip" type="button" data-v="${esc(v)}" aria-selected="${on ? "true" : "false"}">${sw}${esc(label)}</button>`;
}

function renderAnalytics() {
  const ctxLabel = $("#anContextLabel"), ctx = $("#anContext");
  const pickLabel = $("#anPickLabel"), pick = $("#anPicker");
  if (an.mode === "portals") {
    ctxLabel.textContent = "Week";
    ctx.innerHTML = state.weeks.map((w) => anChip(w.week, shortWeekLabel(w.week), w.week === an.week)).join("");
    pickLabel.textContent = "Portals";
    pick.innerHTML = state.portals.map((p) => anChip(p.slug, p.name, an.portals.has(p.slug), p.brand)).join("");
  } else {
    ctxLabel.textContent = "Portal";
    ctx.innerHTML = state.portals.map((p) => anChip(p.slug, p.name, p.slug === an.portal, p.brand)).join("");
    pickLabel.textContent = "Weeks";
    pick.innerHTML = state.weeks.map((w) => anChip(w.week, shortWeekLabel(w.week), an.weeks.has(w.week))).join("");
  }
  ctx.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      if (an.mode === "portals") an.week = c.dataset.v; else an.portal = c.dataset.v;
      renderAnalytics();
    })
  );
  pick.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const set = an.mode === "portals" ? an.portals : an.weeks;
      const v = c.dataset.v;
      if (set.has(v)) set.delete(v);
      else if (set.size < AN_MAX) set.add(v);
      renderAnalytics();
    })
  );
  renderAnTable();
}

function anEmpty(msg) { return `<div class="an-empty">${esc(msg)}</div>`; }

async function renderAnTable() {
  const wrap = $("#anTableWrap");
  wrap.innerHTML = `<div class="an-loading">Loading…</div>`;
  let columns = [];
  try {
    if (an.mode === "portals") {
      if (!an.week || an.portals.size === 0) { wrap.innerHTML = anEmpty("Pick a week and at least one portal to compare."); return; }
      const caps = await anCapturesFor(an.week);
      columns = state.portals
        .filter((p) => an.portals.has(p.slug))
        .map((p) => ({ label: p.name, domain: domainOf(p.url), cap: caps.find((c) => c.slug === p.slug) }));
    } else {
      if (!an.portal || an.weeks.size === 0) { wrap.innerHTML = anEmpty("Pick a portal and at least one week to compare."); return; }
      const weeks = state.weeks.map((w) => w.week).filter((w) => an.weeks.has(w));
      const capsByWeek = await Promise.all(weeks.map((w) => anCapturesFor(w)));
      const p = state.portals.find((pp) => pp.slug === an.portal);
      columns = weeks.map((w, i) => ({ label: shortWeekLabel(w), domain: i === 0 ? domainOf(p?.url || "") : "", cap: capsByWeek[i].find((c) => c.slug === an.portal) }));
    }
  } catch {
    wrap.innerHTML = anEmpty("Could not load comparison data.");
    return;
  }
  wrap.innerHTML = anTableHTML(columns);
}

function anTableHTML(cols) {
  const head = `<tr><th class="an-rowhead"></th>${cols.map((c) =>
    `<th class="an-colhead">${c.domain ? `<span class="an-logo"><img alt="" loading="lazy" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.domain)}&sz=64" /></span>` : ""}<span>${esc(c.label)}</span></th>`
  ).join("")}</tr>`;

  const rows = [];
  rows.push(anRow("Snapshot", cols.map((c) => {
    const src = anShot(c.cap);
    if (!src) return `<td><div class="an-noshot">${c.cap ? (an.device === "mobile" ? "No mobile shot" : "—") : "No capture"}</div></td>`;
    return `<td><div class="an-shot" data-full="${esc(src)}" data-title="${esc(c.label)}" data-file="${esc((c.cap.slug || "shot") + "-" + (c.cap.week || "") + (an.device === "mobile" ? "-mobile" : ""))}"><img loading="lazy" src="${esc(src)}" alt="${esc(c.label)}" /></div></td>`;
  })));
  rows.push(anRow("Brand colour", cols.map((c) =>
    c.cap && c.cap.brand ? `<td><span class="an-swatch" style="background:${esc(c.cap.brand)}"></span><code>${esc(String(c.cap.brand).toUpperCase())}</code></td>` : `<td>—</td>`
  )));
  rows.push(anRow("Palette", cols.map((c) => {
    const pal = (c.cap && c.cap.palette) || [];
    if (!pal.length) return `<td>—</td>`;
    return `<td><span class="an-palette">${pal.slice(0, 6).map((h) => `<i style="background:${esc(h)}" title="${esc(h)}"></i>`).join("")}</span></td>`;
  })));
  rows.push(anRow("Tone", cols.map((c) => {
    const t = c.cap ? anTone([c.cap.brand, ...((c.cap.palette) || [])]) : null;
    return `<td>${t ? `<span class="an-tag">${t}</span>` : "—"}</td>`;
  })));
  rows.push(anRow("Colour temp.", cols.map((c) => {
    const t = c.cap ? anTemp([c.cap.brand, ...((c.cap.palette) || [])]) : null;
    return `<td>${t ? `<span class="an-tag">${t}</span>` : "—"}</td>`;
  })));
  rows.push(anRow("Captured", cols.map((c) => `<td>${c.cap ? esc(fmtDate(c.cap.capturedAt)) : "—"}</td>`)));
  rows.push(anRow("Design notes", cols.map((c) => `<td class="an-notes">${c.cap ? esc(displayedAnalysis(c.cap)) : "—"}</td>`)));

  return `<table class="an-table"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}
function anRow(label, tds) { return `<tr><th class="an-rowhead">${esc(label)}</th>${tds.join("")}</tr>`; }

// ---- insights: manual memo feed -------------------------------------------
function renderInsightsList(items) {
  const list = $("#insightsList");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="insight-empty">No notes yet.</div>`;
    return;
  }
  list.innerHTML = items.map((it) => {
    const imgs = it.images || [];
    const media = imgs.length ? `
      <div class="insight-media">
        ${imgs.map((src, i) => `
          <button class="insight-thumb" type="button" data-full="${esc(src)}" data-title="${esc(it.title)}" data-file="insight-${esc(it.id)}-${i}">
            <img src="${esc(src)}" alt="${esc(it.title)} image ${i + 1}" loading="lazy" />
          </button>`).join("")}
      </div>` : "";
    return `
      <article class="insight-card">
        <div class="insight-meta">${esc(fmtDate(it.createdAt))}</div>
        <h2>${esc(it.title)}</h2>
        <p>${esc(it.description || "No description")}</p>
        ${media}
      </article>`;
  }).join("");
}

async function loadInsights() {
  const list = $("#insightsList");
  if (!list) return;
  list.innerHTML = `<div class="insight-empty">Loading notes…</div>`;
  try {
    const data = await getJSON('/api/insights');
    renderInsightsList(data.insights || []);
  } catch {
    list.innerHTML = `<div class="insight-empty">Notes are not ready yet.</div>`;
  }
}

// ---- hash routing: gallery / collection / analytics / notes -----------------
// The notes view is shown at #notes; #insights (its old name) still opens it so old links keep working.
function route() {
  const hash = location.hash;
  const view = hash === "#collection" ? "collection" : hash === "#analytics" ? "analytics" : hash === "#notes" || hash === "#insights" ? "insights" : "gallery";
  const views = { gallery: "#galleryView", collection: "#collectionView", analytics: "#analyticsView", insights: "#insightsView" };
  for (const [v, sel] of Object.entries(views)) {
    const el = $(sel);
    if (el) el.hidden = v !== view;
  }
  document.querySelectorAll(".topnav-link[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === view)
  );
  if (view === "collection") renderCollection();
  if (view === "analytics") enterAnalytics();
  if (view === "insights") loadInsights();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

document.addEventListener("click", () => closeWeekMenus());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWeekMenus(); });

initLightbox();
initManualSnapshots();
initDownloadAll();
initDeviceToggle();
initSearch();
initHeroOrbFollow();
initHeroScreenshotEffect();
boot().then(route);

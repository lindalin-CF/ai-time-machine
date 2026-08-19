// AI Portal Screenshot Library — front-end controller
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  portals: [],
  weeks: [],
  week: null,        // selected week (null => latest)
  selected: new Set(), // selected portal slugs; empty => all portals
  captures: [],
  device: "desktop", // "desktop" | "mobile" — which screenshot variant to show
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
    if (el) countUp(el, Number(s[key] || 0));
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

function renderWeekSelect() {
  const sel = $("#weekSelect");
  if (!state.weeks.length) {
    sel.innerHTML = `<option>No weeks yet</option>`;
    return;
  }
  sel.innerHTML = state.weeks
    .map((w) => `<option value="${esc(w.week)}">${esc(w.label)} · ${w.portal_count}</option>`)
    .join("");
  sel.addEventListener("change", () => loadWeek(sel.value));
}

async function loadWeek(week) {
  skeletons();
  const q = week ? `?week=${encodeURIComponent(week)}` : "";
  const data = await getJSON(`/api/captures${q}`);
  state.week = data.week;
  state.captures = data.captures || [];
  const count = state.captures.filter((c) => c.status === "ok").length;
  $("#weekHeading").textContent = data.label
    ? `${data.label} · ${count} portals`
    : "No captures yet";
  const sel = $("#weekSelect");
  if (sel && data.week) sel.value = data.week;
  renderGrid();
  if (location.hash === "#collection") renderCollection();
}

function renderGrid() {
  const list =
    state.selected.size === 0
      ? state.captures
      : state.captures.filter((c) => state.selected.has(c.slug));
  const grid = $("#grid");
  const empty = $("#empty");
  if (!list.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "No captures for this filter yet.";
    return;
  }
  empty.hidden = true;
  grid.innerHTML = list.map(card).join("");
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
  const zoom = !c.sample && c.status !== "error" && !!shot.src;
  const inner = shot.missing
    ? `<div class="shot-missing">No mobile capture yet</div>`
    : `<img loading="lazy" src="${esc(shot.src)}" alt="${esc(c.portal)} ${mobile ? "mobile" : "landing"} page" />`;
  return `
  <article class="card">
    <div class="shot${mobile ? " mobile" : ""}${zoom ? " zoomable" : ""}" style="--brand:${esc(c.brand)}"${zoom ? ` data-full="${esc(shot.src)}" data-title="${esc(c.portal)}" data-file="${esc(c.slug)}-${esc(c.week)}${mobile ? "-mobile" : ""}"` : ""}>
      ${badge}
      ${inner}
    </div>
    <div class="card-body">
      <div class="card-head">
        <div class="portal-id">
          <span class="brand-dot" style="background:${esc(c.brand)}"></span>
          <div>
            <div class="portal-name">${esc(c.portal)}</div>
            <div class="portal-co">${esc(c.company)}</div>
          </div>
        </div>
        <a class="visit" href="${esc(c.url)}" target="_blank" rel="noopener">Visit &#8599;</a>
      </div>
      <div class="analysis-label">Design analysis</div>
      <p class="analysis">${esc(c.analysis)}</p>
      <div class="card-foot">
        <div class="palette">${palette}</div>
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
      const zoomAttrs = shot.src
        ? ` zoomable" data-full="${esc(shot.src)}" data-title="${esc(c.portal)}" data-file="${esc(c.slug)}-${esc(c.week)}${mobile ? "-mobile" : ""}`
        : `"`;
      return `
    <figure class="col-item">
      <div class="shot${mobile ? " mobile" : ""}${zoomAttrs} style="--brand:${esc(c.brand)}">
        ${inner}
      </div>
      <figcaption class="col-cap">
        <span class="col-name"><span class="brand-dot" style="background:${esc(c.brand)}"></span>${esc(c.portal)}</span>
        <span class="col-date">${esc(fmtDate(c.capturedAt))}</span>
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

// ---- hash routing: #collection <-> gallery --------------------------------
function route() {
  const onCollection = location.hash === "#collection";
  const gv = $("#galleryView");
  const cv = $("#collectionView");
  if (gv) gv.hidden = onCollection;
  if (cv) cv.hidden = !onCollection;
  document.querySelectorAll(".topnav-link[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === (onCollection ? "collection" : "gallery"))
  );
  if (onCollection) renderCollection();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

initLightbox();
initDownloadAll();
initDeviceToggle();
boot().then(route);

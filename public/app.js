// AI Surface Library — front-end controller
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
  const count = state.captures.filter((c) => c.status === "ok").length;
  $("#weekHeading").textContent = data.label
    ? `${data.label} · ${count} portals`
    : "No captures yet";
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
  wireAnalysisToggles();
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
      <p class="analysis clamped">${esc(c.analysis)}</p>
      <button type="button" class="analysis-toggle" aria-expanded="false" aria-label="Show more">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
      </button>
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

document.addEventListener("click", () => closeWeekMenus());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWeekMenus(); });

initLightbox();
initManualSnapshots();
initDownloadAll();
initDeviceToggle();
initHeroOrbFollow();
initHeroScreenshotEffect();
boot().then(route);

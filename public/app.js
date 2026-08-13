// AI Portal Screenshot Library — front-end controller
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  portals: [],
  weeks: [],
  week: null,        // selected week (null => latest)
  portalFilter: "all",
  captures: [],
};

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
      state.portalFilter = btn.dataset.portal;
      wrap.querySelectorAll(".chip").forEach((c) =>
        c.setAttribute("aria-selected", String(c === btn)));
      renderGrid();
    })
  );
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
}

function renderGrid() {
  const list =
    state.portalFilter === "all"
      ? state.captures
      : state.captures.filter((c) => c.slug === state.portalFilter);
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
  const badge =
    c.status === "error"
      ? `<span class="badge err">Capture failed</span>`
      : c.sample
      ? `<span class="badge">Sample</span>`
      : c.signedIn
      ? `<span class="badge signedin">Signed in · ${esc(fmtDate(c.capturedAt))}</span>`
      : `<span class="badge">${esc(fmtDate(c.capturedAt))}</span>`;
  const by = c.analysisBy === "workers-ai" ? "Workers AI" : "sample";
  return `
  <article class="card">
    <div class="shot" style="--brand:${esc(c.brand)}">
      ${badge}
      <img loading="lazy" src="${esc(c.image)}" alt="${esc(c.portal)} landing page" />
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
        <div class="by">By <b>${esc(by)}</b></div>
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

boot();

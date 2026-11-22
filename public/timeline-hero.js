// Homepage hero: a strip of one product's weekly wireframes (rendered by the Worker, src/wireframe.ts timelineHtml;
// prototype docs/prototypes/timeline-hero.html). The strip drifts left one frame every PERIOD ms. Each frame, while it
// enters from the right, eases its regions from the previous week's places to its own, so a moved message box or a
// wider sidebar can be seen moving. The latest week rests at the right end, where the corner brackets lock onto it.
// The loop is seamless: copies of the strip sit before and after it, and its position is a pure function of time.
// It stops while off screen, while the tab is hidden, and while a pointer or keyboard focus is on the strip; with
// reduced motion it is the still strip the Worker rendered (the latest week at the right end). The panel's
// data-timeline says which: "running", "paused" or "still".
(() => {
  const panel = document.querySelector(".hero-panel");
  const root = panel?.querySelector(".hero-timeline:not([hidden])");
  const view = root?.querySelector(".tl-view"), track = root?.querySelector(".tl-track");
  if (!view || !track) return;
  const real = [...track.children];
  if (!real.length) return;
  const tip = root.querySelector(".tl-tip");
  const reducedMq = matchMedia("(prefers-reduced-motion: reduce)");
  const PERIOD = 3000; // ms per frame of drift
  const HOLD = 1500; // ms the latest week stays locked at rest before the first drift
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // Each frame morphs from the week before it (the oldest from itself: the strip's seam has no line, styles.css).
  const shapes = real.map((a) => JSON.parse(a.dataset.shapes));
  const from = shapes.map((s, i) => shapes[Math.max(0, i - 1)]);

  let reduce = reducedMq.matches, visible = true, held = 0, running = false, raf = 0, last = 0, t = -HOLD;
  let items = [], vw = 0, pitch = 0, setW = 0, restX = 0, enterX = 0, x = 0, base = 0, built = false;

  /** Copies around the real strip (inert: keyboard and screen readers get the real one only), and the measurements. */
  function build() {
    for (const el of [...track.children]) if (!real.includes(el)) el.remove();
    track.classList.add("is-moving");
    track.style.transform = "";
    vw = view.clientWidth;
    const first = real[0], fw = first.offsetWidth;
    pitch = real.length > 1 ? real[1].offsetLeft - first.offsetLeft : fw + 24;
    setW = pitch * real.length;
    if (!vw || !fw) { built = false; return; }
    const k = Math.ceil(vw / setW) + 1;
    const copy = () => real.map((a) => { const c = a.cloneNode(true); c.setAttribute("aria-hidden", "true"); c.tabIndex = -1; c.inert = true; return c; });
    for (let i = 0; i < k; i++) { track.prepend(...copy()); track.append(...copy()); }
    items = [...track.children].map((el, j) => ({ el, i: j % real.length, rects: el.querySelectorAll("rect"), p: -1 }));
    const pad = parseFloat(getComputedStyle(root).getPropertyValue("--tl-pad")) || 0;
    // The track stays anchored at the right (styles.css), so moving it never changes its box: offsets are from where
    // it sits with the copies in it (base), and the transform puts the latest week back at the right end.
    base = track.offsetLeft;
    const latest = real[real.length - 1];
    restX = vw - pad - (base + latest.offsetLeft + fw);
    enterX = vw - pad - fw; // a frame's left edge when it has finished entering
    built = true;
  }

  /** Draw item `it` at morph progress p (0: the previous week's regions, 1: its own). */
  function morph(it, p) {
    if (Math.abs(p - it.p) < 0.002) return;
    it.p = p;
    const a = from[it.i], b = shapes[it.i], e = ease(p);
    it.rects.forEach((r, s) => {
      const A = a[s], B = b[s];
      const g = !A[4] ? B : !B[4] ? A : null; // a region that comes or goes fades in place
      const v = (n) => (g ? g[n] : A[n] + (B[n] - A[n]) * e);
      r.setAttribute("x", v(0).toFixed(1)); r.setAttribute("y", v(1).toFixed(1));
      r.setAttribute("width", v(2).toFixed(1)); r.setAttribute("height", v(3).toFixed(1));
      r.setAttribute("opacity", (A[4] + (B[4] - A[4]) * e).toFixed(3));
    });
    if (it.el.classList.contains("is-latest")) it.el.classList.toggle("is-locked", p >= 0.999);
  }

  /** The strip at offset `pos` px (x of the track): frames entering from the right morph over most of a pitch. */
  function place(pos) {
    x = pos;
    track.style.transform = `translate3d(${pos.toFixed(2)}px,0,0)`;
    for (const it of items) {
      const left = base + pos + it.el.offsetLeft;
      if (left > vw + pitch || left < -pitch) continue;
      morph(it, clamp01((enterX + pitch * 0.85 - left) / (pitch * 0.7)));
    }
  }
  /** Offset at loop time `ms`, wrapped into one strip's length so the copies take over seamlessly. */
  const at = (ms) => restX - ((((Math.max(0, ms) / PERIOD) * pitch) % setW) + setW) % setW;

  function loop(ts) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (last) t += Math.min(50, ts - last);
    last = ts;
    place(at(t));
  }
  const setMode = (m) => { panel.dataset.timeline = m; };
  function start() {
    if (running || reduce || !built) return;
    if (!visible || document.hidden || held) { setMode("paused"); return; }
    running = true; last = 0; setMode("running");
    raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; cancelAnimationFrame(raf); if (!reduce && built) setMode("paused"); }

  function init() {
    stop();
    if (reduce) {
      for (const el of [...track.children]) if (!real.includes(el)) el.remove();
      track.classList.remove("is-moving"); track.style.transform = "";
      real.forEach((el, i) => { el.querySelectorAll("rect").forEach((r, s) => { const [rx, ry, w, h, o] = shapes[i][s]; r.setAttribute("x", rx); r.setAttribute("y", ry); r.setAttribute("width", w); r.setAttribute("height", h); r.setAttribute("opacity", o); }); });
      real.at(-1).classList.add("is-locked");
      built = false; setMode("still");
      return;
    }
    build();
    if (!built) return;
    // Resume at the same place in the loop after a resize; the first start shows the latest week locked at rest.
    place(at(t));
    start();
  }

  // Pointer or keyboard on the strip: hold it still and name the frame ("ChatGPT · Week of Nov 16, 2026").
  const showTip = (a) => {
    if (!tip) return;
    tip.textContent = a.dataset.tip;
    const r = a.querySelector(".tl-screen").getBoundingClientRect(), rr = root.getBoundingClientRect();
    const tw = tip.offsetWidth, left = Math.max(0, Math.min(rr.width - tw, r.left - rr.left + r.width / 2 - tw / 2));
    tip.style.transform = `translate3d(${left.toFixed(1)}px,${(r.bottom - rr.top + 8).toFixed(1)}px,0)`;
    tip.classList.add("is-on");
  };
  const hideTip = () => tip?.classList.remove("is-on");
  const hold = () => { held++; stop(); };
  const release = () => { held = Math.max(0, held - 1); if (!held) start(); };
  root.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hold(); });
  root.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hideTip(); release(); } });
  root.addEventListener("pointerover", (e) => { const a = e.target.closest?.(".tl-frame"); if (a && e.pointerType === "mouse") showTip(a); });
  root.addEventListener("focusin", (e) => {
    const a = e.target.closest?.(".tl-frame");
    if (!a) return;
    hold();
    // Bring a frame that has drifted out of view back into it; the loop picks up from there.
    if (built) {
      const pad = parseFloat(getComputedStyle(root).getPropertyValue("--tl-pad")) || 0, left = base + x + a.offsetLeft, w = a.offsetWidth;
      let pos = x;
      if (left < pad) pos = pad - base - a.offsetLeft; else if (left + w > vw - pad) pos = vw - pad - w - base - a.offsetLeft;
      if (pos !== x) { place(pos); t = ((restX - pos) / pitch) * PERIOD; }
    }
    showTip(a);
  });
  root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget)) { hideTip(); release(); } });

  init();
  let rt = 0, size = `${view.clientWidth}`;
  new ResizeObserver(() => {
    const s = `${view.clientWidth}`;
    if (s === size) return;
    clearTimeout(rt);
    rt = setTimeout(() => { size = s; init(); }, 120);
  }).observe(view);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; visible ? start() : stop(); }).observe(root);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reducedMq.addEventListener("change", () => { reduce = reducedMq.matches; init(); });
})();

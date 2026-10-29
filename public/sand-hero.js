// Homepage hero: a tilted ring of white sand flowing on a canvas, and the camera-focus hover for mouse pointers.
// Ported from the approved prototype, docs/prototypes/sand-hero.html. Every motion repeats exactly every 10s, so the
// loop never jumps. The ring is drawn where styles.css says (--ring-x/y/a/b on .hero-panel), so it stays clear of the type.
// The panel's data-sand says what the canvas is doing: "running", "paused" (off screen or tab hidden) or "still" (reduced motion).
(() => {
  const panel = document.querySelector(".hero-panel");
  const canvas = panel?.querySelector(".hero-sand");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reducedMq = matchMedia("(prefers-reduced-motion: reduce)");
  let reduce = reducedMq.matches;
  const TAU = Math.PI * 2, T = 10000; // loop length (ms)
  const LEVELS = 10; // alpha buckets for batched drawing
  const MIN_GRAINS = 6000, MAX_GRAINS = 9000; // 18000 ran at 35fps in Chrome at 4x CPU throttle (1280px, DPR 2); 9000 holds 60fps
  // At most ~60 draws a second (MIN_GAP ms apart): 120Hz screens would otherwise draw twice as often, with trails half
  // as long (each draw fades the last one). Where the canvas is slow (no GPU canvas, e.g.
  // software rendering), frames over FRAME_BUDGET ms draw fewer grains, down to FLOOR_GRAINS, and the loop leaves the
  // main thread at least as much idle time as each frame took.
  const MIN_GAP = 14.5, FRAME_BUDGET = 12, FLOOR_GRAINS = 3000, WARM_BUDGET = 30;
  let W = 0, H = 0, DPR = 1, N = 0, P = null, running = false, visible = true, raf = 0, elapsed = 0, lastTs = 0;
  let active = 0, cost = 0, nextAt = 0; // grains drawn per frame (a prefix of P: the grains are in random order), average frame ms
  let ring = { x: 0.715, y: 0.53, a: 0.19, b: 0.29 };
  const buckets = Array.from({ length: LEVELS }, () => []);

  // seeded random so the ring looks the same on every load
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };

  function build() {
    const r = panel.getBoundingClientRect();
    W = r.width; H = r.height; DPR = Math.min(1.75, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    if (!W || !H) { N = active = 0; return; } // the homepage is hidden (another view is showing)
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const cs = getComputedStyle(panel), num = (name, fallback) => parseFloat(cs.getPropertyValue(name)) || fallback;
    ring = { x: num("--ring-x", 0.715), y: num("--ring-y", 0.53), a: num("--ring-a", 0.19), b: num("--ring-b", 0.29) };
    seed = 7;
    N = active = Math.round(Math.min(MAX_GRAINS, Math.max(MIN_GRAINS, W * H / 26)));
    cost = 0;
    // per grain: start angle, travel, cycles per loop (integer), phase, spread, side jitter, turbulence phases, size
    P = new Float32Array(N * 9);
    for (let i = 0; i < N; i++) {
      const o = i * 9;
      P[o] = rnd() * TAU;
      P[o + 1] = 0.35 + rnd() * 0.55; // radians travelled per life
      P[o + 2] = rnd() < 0.6 ? 1 : 2; // lives per 10s loop: 1 or 2 (keeps the loop exact)
      P[o + 3] = rnd();
      P[o + 4] = Math.min(2.6, Math.abs(gauss())) * (rnd() < 0.12 ? -0.25 : 1); // mostly outward: crisp inner edge
      P[o + 5] = gauss();
      P[o + 6] = rnd() * TAU;
      P[o + 7] = rnd() * TAU;
      P[o + 8] = 0.55 + rnd() * 0.6;
    }
    ctx.fillStyle = "#0b0b0c"; ctx.fillRect(0, 0, W, H);
  }

  const BRIGHT = 1.12; // angle (before tilt) of the crisp lower-right edge
  const angDist = (a, b) => { const d = Math.abs(a - b) % TAU; return d > Math.PI ? TAU - d : d; };

  function draw(ms, trail) {
    const u = (((ms % T) + T) % T) / T, w = TAU * u; // loop phase
    const cx = W * ring.x, cy = H * ring.y;
    const breathe = Math.sin(w), breathe2 = Math.sin(w + 1.1);
    const a = W * ring.a * (1 + 0.012 * breathe);
    const b = H * ring.b * (1 + 0.018 * breathe2);
    const tilt = -0.46 + 0.012 * Math.sin(w + 0.4);
    const ct = Math.cos(tilt), st = Math.sin(tilt);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = trail ? "rgba(11,11,12,0.24)" : "#0b0b0c";
    ctx.fillRect(0, 0, W, H);

    for (let k = 0; k < LEVELS; k++) buckets[k].length = 0;

    for (let i = 0; i < active; i++) {
      const o = i * 9;
      const f = (u * P[o + 2] + P[o + 3]) % 1; // life progress 0..1
      const th = P[o] + P[o + 1] * f; // drifts clockwise along the ring
      const d = angDist(th, BRIGHT); // 0 at the crisp edge, PI at the dusty side
      const loose = Math.pow(d / Math.PI, 1.7); // 0 crisp .. 1 dusty
      const spread = 0.004 + 0.30 * loose;
      // gentle turbulence, integer frequencies so it loops
      const turb = Math.sin(w + P[o + 6] + th * 3) * 0.5 + Math.sin(2 * w + P[o + 7] - th * 2) * 0.5;
      const rr = 1 + P[o + 4] * spread + turb * (0.003 + 0.035 * loose);
      const side = P[o + 5] * spread * 0.16 + turb * 0.02 * loose;
      const cth = Math.cos(th), sth = Math.sin(th);
      const ex = cth * a * rr - sth * a * side;
      const ey = sth * b * rr + cth * b * side;
      const x = cx + ex * ct - ey * st, y = cy + ex * st + ey * ct;
      const env = Math.pow(Math.sin(Math.PI * f), 1.15); // gather in, dissolve out
      const lum = 0.17 + 0.83 * Math.exp(-(d * d) / 0.6); // bright at the crisp edge
      const al = env * lum * (1 - 0.35 * loose);
      if (al < 0.02) continue;
      const lvl = Math.min(LEVELS - 1, (al * LEVELS) | 0);
      buckets[lvl].push(x, y, P[o + 8] * (1 - 0.25 * loose));
    }

    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < LEVELS; k++) {
      const arr = buckets[k];
      if (!arr.length) continue;
      ctx.fillStyle = `rgba(244,242,238,${((k + 0.5) / LEVELS * 0.78).toFixed(3)})`;
      for (let j = 0; j < arr.length; j += 3) { const s = arr[j + 2]; ctx.fillRect(arr[j], arr[j + 1], s, s); }
    }
  }

  function loop(ts) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (ts < nextAt) return; // too soon after the last draw, or a slow frame last time: give the main thread back first
    if (lastTs) elapsed += Math.min(50, ts - lastTs);
    lastTs = ts;
    const t0 = performance.now();
    draw(elapsed, true);
    const took = performance.now() - t0;
    nextAt = ts + Math.max(MIN_GAP, took);
    cost = cost ? cost * 0.8 + took * 0.2 : took;
    if (cost > FRAME_BUDGET && active > FLOOR_GRAINS) { active = Math.max(FLOOR_GRAINS, Math.floor(active * 0.8)); cost = 0; }
  }
  // settle the trails so the first visible frame already has them (as many frames as fit in WARM_BUDGET ms)
  const warm = () => {
    const t0 = performance.now();
    for (let k = 12; k > 0 && performance.now() - t0 < WARM_BUDGET; k--) draw(elapsed - k * 16, true);
  };
  function start() {
    if (running || reduce || !N) return;
    if (!visible || document.hidden) { panel.dataset.sand = "paused"; return; }
    running = true; lastTs = 0; nextAt = 0; panel.dataset.sand = "running";
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false; cancelAnimationFrame(raf);
    if (!reduce) panel.dataset.sand = "paused";
  }

  function init() {
    build();
    if (!N) return;
    // Reduced motion: one still frame of the 2.5s moment, with the trails that lead up to it, so it looks like the moving ring.
    if (reduce) { draw(2500 - 13 * 16, false); for (let k = 12; k >= 0; k--) draw(2500 - k * 16, true); panel.dataset.sand = "still"; }
    else { warm(); start(); }
  }
  init();

  // Rebuild when the panel changes size (including when the homepage is shown after another view), not on every
  // ResizeObserver callback: it also fires once when observing starts.
  let rt = 0, builtFor = `${W}x${H}`;
  new ResizeObserver(([e]) => {
    const size = `${e.contentRect.width}x${e.contentRect.height}`;
    if (size === builtFor) return;
    clearTimeout(rt);
    rt = setTimeout(() => { builtFor = size; stop(); init(); }, 120);
  }).observe(panel);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; visible ? start() : stop(); }).observe(panel);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reducedMq.addEventListener("change", () => { reduce = reducedMq.matches; stop(); init(); });

  // Camera focus that follows a mouse pointer: the blur layer is masked around the cursor, the reticle lags behind it
  // and locks ("AF-L") after 260ms at rest. Touch screens skip it (styles.css hides both layers there too).
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const label = panel.querySelector(".hero-reticle-label");
  let tx = 0, ty = 0, x = 0, y = 0, on = false, fr = 0, lockT = 0;
  const set = () => {
    panel.style.setProperty("--rx", x + "px"); panel.style.setProperty("--ry", y + "px");
    panel.style.setProperty("--fx", x + "px"); panel.style.setProperty("--fy", y + "px");
  };
  const follow = () => {
    const k = reduce ? 1 : 0.16;
    x += (tx - x) * k; y += (ty - y) * k; set();
    if (on && (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3)) fr = requestAnimationFrame(follow); else fr = 0;
  };
  const lock = () => { panel.classList.add("is-locked"); label.textContent = "AF-L · f/1.8"; };
  panel.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = panel.getBoundingClientRect();
    tx = e.clientX - r.left; ty = e.clientY - r.top;
    if (!on) { on = true; x = tx; y = ty; set(); panel.classList.add("is-focusing"); }
    panel.classList.remove("is-locked"); label.textContent = "AF · f/1.8";
    clearTimeout(lockT); lockT = setTimeout(lock, 260);
    if (!fr) fr = requestAnimationFrame(follow);
  });
  panel.addEventListener("pointerleave", () => {
    on = false; clearTimeout(lockT); cancelAnimationFrame(fr); fr = 0;
    panel.classList.remove("is-focusing", "is-locked");
  });
})();

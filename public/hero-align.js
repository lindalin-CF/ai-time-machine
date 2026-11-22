// Homepage hero, desktop and tablet (> 760px), measured from where things really are, not fixed nudges:
// 1. the title and the sub are one group, centred on the panel's vertical middle by their ink: from the cap top of
//    "AI Interface" to the bottom of the sub's last line of text (its glyphs, descenders included). The title masks'
//    padding, line boxes and the sub's annotation tags don't count;
// 2. the timeline moves with it, so the baseline of "Library" sits on the bottom edge of the frames.
// Baselines come from zero-size marks (.title-base at the end of each title line, .sub-base at the end of the sub);
// how far the glyphs reach above or below a baseline is measured in that text's own font (canvas measureText). It
// measures again when the panel or the copy changes size (a resize, the web font arriving). Both moves are
// transforms, so nothing is laid out again and nothing shifts. The stats stay at the top; phones keep their stacked
// layout. The copy never leaves the panel's padding and the timeline's week labels never go above the stats.
(() => {
  const panel = document.querySelector(".hero-panel");
  const copy = panel?.querySelector(".hero-copy");
  const marks = copy ? [...copy.querySelectorAll(".title-base")] : [];
  const subMark = copy?.querySelector(".hero-sub .sub-base");
  const timeline = panel?.querySelector(".hero-timeline:not([hidden])");
  const stats = panel?.querySelector(".stats");
  // A real frame, looked up each time: public/timeline-hero.js adds and removes the strip's copies.
  const frame = () => timeline?.querySelector(".tl-track > .tl-frame:not([aria-hidden])");
  if (marks.length < 2 || !subMark || !stats || !frame()) return;
  const words = [...copy.querySelectorAll(".hero-sub .w")];
  const phone = matchMedia("(max-width:760px)");
  /** The vertical translation an element's computed transform applies (0 for none). */
  const ty = (el) => { const t = el && getComputedStyle(el).transform; return t && t !== "none" ? new DOMMatrix(t).m42 : 0; };
  const move = (el, y) => { el.style.transform = y ? `translate3d(0,${y.toFixed(2)}px,0)` : ""; };
  /** A mark's baseline without transforms: the title's lines and the sub's words rise into place (styles.css). */
  const baseline = (m, holder, tc) => m.getBoundingClientRect().bottom - ty(m.closest(holder)) - tc;
  const ctx = document.createElement("canvas").getContext("2d");
  /** The ink of `text` in `el`'s font: how far its glyphs reach above and below the baseline. */
  function ink(el, text) {
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (!ctx) return { up: size * 0.7, down: size * 0.2 };
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(text);
    return { up: m.actualBoundingBoxAscent, down: m.actualBoundingBoxDescent };
  }
  /** The words of the sub's last line (they share an offsetTop, as app.js finds lines), without the annotation tags. */
  function lastLine() {
    const top = words.at(-1).offsetTop;
    return words.filter((w) => Math.abs(w.offsetTop - top) < 2).map((w) => {
      const c = w.cloneNode(true); c.querySelectorAll(".ann").forEach((a) => a.remove()); return c.textContent.trim();
    }).join(" ");
  }

  function align() {
    if (phone.matches) { move(copy, 0); move(timeline, 0); delete panel.dataset.copyDrop; return; }
    const tc = ty(copy), tt = ty(timeline), f = frame();
    const first = baseline(marks[0], ".title-line", tc), last = baseline(marks[marks.length - 1], ".title-line", tc);
    const capTop = first - ink(marks[0].closest(".title-line"), "AI Interface").up;
    const sub = subMark.closest(".hero-sub");
    const subBottom = baseline(subMark, ".w", tc) + ink(sub, lastLine()).down;
    const p = panel.getBoundingClientRect();
    // The group's middle on the panel's middle.
    let shift = p.top + p.height / 2 - (capTop + subBottom) / 2;
    // Never past the layer's bottom padding.
    const layer = copy.parentElement, lr = layer.getBoundingClientRect();
    shift = Math.min(shift, lr.bottom - (parseFloat(getComputedStyle(layer).paddingBottom) || 0) - (copy.getBoundingClientRect().bottom - tc));
    // The frames' bottom edge on the baseline of "Library", the week labels below the stats.
    const frames = f.querySelector(".tl-screen").getBoundingClientRect().bottom - tt;
    const labels = f.querySelector(".tl-label").getBoundingClientRect().top - tt;
    let tShift = last + shift - frames;
    const over = stats.getBoundingClientRect().bottom + 8 - (labels + tShift);
    if (over > 0) { shift += over; tShift += over; }
    move(copy, shift);
    move(timeline, tShift);
    panel.dataset.copyDrop = shift.toFixed(1);
  }

  align();
  new ResizeObserver(align).observe(panel);
  new ResizeObserver(align).observe(copy);
  phone.addEventListener("change", align);
  document.fonts?.ready.then(align);
  document.fonts?.addEventListener?.("loadingdone", align);
})();

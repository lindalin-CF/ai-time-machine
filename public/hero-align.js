// Homepage hero, desktop and tablet (> 760px), measured from where things really are, not fixed nudges:
// 1. the title ("AI Interface / Library", its two lines only) is centred on the panel's vertical middle: halfway
//    between the top of "AI Interface" (its tallest glyphs) and the baseline of "Library" sits at 50% of the panel's
//    height. The sub follows the title with its gap and isn't part of the centring;
// 2. the timeline moves with it, so the baseline of "Library" sits on the bottom edge of the frames.
// The baselines come from zero-size .title-base marks at the end of each title line; the glyphs' height above the
// first baseline is measured in the title's own font (canvas measureText). It measures again when the panel or the
// copy changes size (a resize, the web font arriving). Both moves are transforms, so nothing is laid out again and
// nothing shifts. The stats stay at the top; phones keep their stacked layout. The copy never leaves the panel's
// padding and the timeline's week labels never go above the stats.
(() => {
  const panel = document.querySelector(".hero-panel");
  const copy = panel?.querySelector(".hero-copy");
  const title = copy?.querySelector(".hero-title");
  const marks = copy ? [...copy.querySelectorAll(".title-base")] : [];
  const timeline = panel?.querySelector(".hero-timeline:not([hidden])");
  const stats = panel?.querySelector(".stats");
  // A real frame, looked up each time: public/timeline-hero.js adds and removes the strip's copies.
  const frame = () => timeline?.querySelector(".tl-track > .tl-frame:not([aria-hidden])");
  if (!title || marks.length < 2 || !stats || !frame()) return;
  const phone = matchMedia("(max-width:760px)");
  /** The vertical translation an element's computed transform applies (0 for none). */
  const ty = (el) => { const t = el && getComputedStyle(el).transform; return t && t !== "none" ? new DOMMatrix(t).m42 : 0; };
  const move = (el, y) => { el.style.transform = y ? `translate3d(0,${y.toFixed(2)}px,0)` : ""; };
  /** A mark's baseline without transforms: the title's lines rise into place (styles.css title-rise). */
  const baseline = (m, tc) => m.getBoundingClientRect().bottom - ty(m.closest(".title-line")) - tc;
  const ctx = document.createElement("canvas").getContext("2d");
  /** How far the first line's glyphs reach above its baseline, in the title's font. */
  function ascent() {
    const line = marks[0].closest(".title-line"), cs = getComputedStyle(line);
    if (!ctx) return parseFloat(cs.fontSize) * 0.7;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(line.textContent.trim()).actualBoundingBoxAscent;
  }

  function align() {
    if (phone.matches) { move(copy, 0); move(timeline, 0); delete panel.dataset.copyDrop; return; }
    const tc = ty(copy), tt = ty(timeline), f = frame();
    const first = baseline(marks[0], tc), last = baseline(marks[marks.length - 1], tc);
    const p = panel.getBoundingClientRect();
    // The title's middle on the panel's middle.
    let shift = p.top + p.height / 2 - (first - ascent() + last) / 2;
    // Never past the layer's bottom padding.
    const layer = copy.parentElement, lr = layer.getBoundingClientRect();
    const bottom = copy.getBoundingClientRect().bottom - tc;
    shift = Math.min(shift, lr.bottom - (parseFloat(getComputedStyle(layer).paddingBottom) || 0) - bottom);
    // The frames' bottom edge on the baseline of "Library", the week labels below the stats.
    const frames = f.querySelector(".tl-screen").getBoundingClientRect().bottom - tt;
    const labels = f.querySelector(".tl-label").getBoundingClientRect().top - tt;
    let tShift = last + shift - frames;
    const s = stats.getBoundingClientRect(), over = s.bottom + 8 - (labels + tShift);
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

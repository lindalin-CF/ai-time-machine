// Homepage hero, desktop and tablet (> 760px), measured from where things really are, not fixed nudges:
// 1. the copy moves so the baseline of the title's last line ("Library", a zero-size .title-base mark) sits on the
//    bottom edge of the timeline's frames; the sub keeps its gap below the title;
// 2. then the copy and the timeline move together so what is visible of them (title to sub, week labels to frames)
//    is centred between the stats and the panel's bottom edge.
// It measures again when the panel or the copy changes size (a resize, the web font arriving). Both moves are
// transforms, so nothing is laid out again and nothing shifts; styles.css already centres both in that space, so
// without this script the layout is close. Phones keep their stacked layout. The copy never leaves the panel's padding.
(() => {
  const panel = document.querySelector(".hero-panel");
  const copy = panel?.querySelector(".hero-copy");
  const base = copy?.querySelector(".title-base");
  const timeline = panel?.querySelector(".hero-timeline:not([hidden])");
  const stats = panel?.querySelector(".stats");
  // A real frame, looked up each time: public/timeline-hero.js adds and removes the strip's copies.
  const frame = () => timeline?.querySelector(".tl-track > .tl-frame:not([aria-hidden])");
  if (!copy || !base || !stats || !frame()) return;
  const phone = matchMedia("(max-width:760px)");
  /** The vertical translation an element's computed transform applies (0 for none). */
  const ty = (el) => { const t = getComputedStyle(el).transform; return t && t !== "none" ? new DOMMatrix(t).m42 : 0; };
  const move = (el, y) => { el.style.transform = y ? `translate3d(0,${y.toFixed(2)}px,0)` : ""; };

  function align() {
    if (phone.matches) { move(copy, 0); move(timeline, 0); delete panel.dataset.copyDrop; return; }
    // Everything as laid out, without the transforms: the title's lines rise into place (styles.css title-rise), and
    // the copy and the timeline carry the last moves. The strip only moves sideways.
    const tc = ty(copy), tt = ty(timeline), f = frame();
    const line = base.closest(".title-line");
    const baseline = base.getBoundingClientRect().bottom - (line ? ty(line) : 0) - tc;
    const frames = f.querySelector(".tl-screen").getBoundingClientRect().bottom - tt;
    const labels = f.querySelector(".tl-label").getBoundingClientRect().top - tt;
    const c = copy.getBoundingClientRect(), top = c.top - tc, bottom = c.bottom - tc;
    const drop = frames - baseline;
    // The visible group with the copy lined up, centred between the stats and the panel's bottom edge.
    const gTop = Math.min(top + drop, labels), gBottom = Math.max(bottom + drop, frames);
    const p = panel.getBoundingClientRect(), s = stats.getBoundingClientRect();
    let shift = (s.bottom + p.bottom - gTop - gBottom) / 2;
    // Keep the copy inside the layer's padding.
    const layer = copy.parentElement, cs = getComputedStyle(layer), lr = layer.getBoundingClientRect();
    shift = Math.min(shift, lr.bottom - (parseFloat(cs.paddingBottom) || 0) - (bottom + drop));
    shift = Math.max(shift, s.bottom - gTop);
    move(copy, drop + shift);
    move(timeline, shift);
    panel.dataset.copyDrop = drop.toFixed(1);
  }

  align();
  new ResizeObserver(align).observe(panel);
  new ResizeObserver(align).observe(copy);
  phone.addEventListener("change", align);
  document.fonts?.ready.then(align);
  document.fonts?.addEventListener?.("loadingdone", align);
})();

// Homepage hero, desktop and tablet (> 760px): the copy block moves down so the baseline of the title's last line
// ("Library") sits on the bottom edge of the timeline's frames; the sub keeps its gap below the title. The offset is
// measured from where both really are, not a fixed nudge, so it holds at every width and on short screens, and it is
// measured again when the panel or the copy changes size (a resize, the web font arriving). It is a transform, so
// nothing is laid out again and nothing shifts. Phones keep their stacked layout; without a timeline the copy stays
// centred. The copy never moves past the panel's bottom padding.
(() => {
  const panel = document.querySelector(".hero-panel");
  const copy = panel?.querySelector(".hero-copy");
  const base = copy?.querySelector(".title-base");
  // A real frame, looked up each time: public/timeline-hero.js adds and removes the strip's copies.
  const screen = () => panel.querySelector(".hero-timeline:not([hidden]) .tl-track > .tl-frame:not([aria-hidden]) .tl-screen");
  if (!copy || !base || !screen()) return;
  const phone = matchMedia("(max-width:760px)");
  /** The vertical translation an element's computed transform applies (0 for none). */
  const ty = (el) => { const t = getComputedStyle(el).transform; return t && t !== "none" ? new DOMMatrix(t).m42 : 0; };

  function align() {
    if (phone.matches) { copy.style.transform = ""; delete panel.dataset.copyDrop; return; }
    // Where the baseline would be with no transforms: the title's lines rise into place (styles.css title-rise), and
    // the copy carries the last drop. The strip only moves sideways, so its frames' bottom is always the same.
    const line = base.closest(".title-line");
    const baseline = base.getBoundingClientRect().bottom - (line ? ty(line) : 0) - ty(copy);
    const frames = screen().getBoundingClientRect().bottom;
    const c = copy.getBoundingClientRect(), copyBottom = c.bottom - ty(copy);
    const layer = copy.parentElement, pb = parseFloat(getComputedStyle(layer).paddingBottom) || 0;
    const room = layer.getBoundingClientRect().bottom - pb - copyBottom;
    const drop = Math.min(frames - baseline, room);
    copy.style.transform = `translate3d(0,${drop.toFixed(2)}px,0)`;
    panel.dataset.copyDrop = drop.toFixed(1);
  }

  align();
  new ResizeObserver(align).observe(panel);
  new ResizeObserver(align).observe(copy);
  phone.addEventListener("change", align);
  document.fonts?.ready.then(align);
  document.fonts?.addEventListener?.("loadingdone", align);
})();

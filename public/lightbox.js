// Screenshot lightbox: click a screenshot to enlarge + download. Shared by the homepage (public/app.js) and the
// server-rendered portal and /compare pages (src/portal-page.ts page({ lightbox: true })); styles in lightbox.css.
//
// A click on anything carrying data-full opens that image. Its other attributes: data-title, data-file (the download's
// name without .png) and data-ga-image / -source / -portal / -week / -device (the file_download event's params).
// Optional: data-caption (shown above the image) and data-lb-group: the triggers sharing a group are one set, walked
// with ←/→ and the prev/next buttons, with a "1 / 2" counter. A trigger that is a link (server pages) points at the
// same image, so it still opens without JS, and with a modifier key in a new tab.
//
// The image is fitted to the viewport; Actual size (the button, or a click on the image) shows it 1:1 in a scrolling
// frame that a mouse can also drag. On phones the dialog is full-screen and Actual size can be pinch-zoomed.
import { track } from "./track.js";

const DURATION = 200; // the open/close transition in lightbox.css
const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex="0"]';

const ICONS = {
  download: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Z"/><path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.4 5A1 1 0 0 0 5 6.4L10.6 12 5 17.6A1 1 0 1 0 6.4 19L12 13.4 17.6 19a1 1 0 0 0 1.4-1.4L13.4 12 19 6.4A1 1 0 1 0 17.6 5L12 10.6Z"/></svg>',
  // Four corners pointing out (fit → actual size); lb--actual swaps in the corners pointing in.
  actual: '<svg class="lb-i-expand" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><svg class="lb-i-shrink" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>',
};

export function initLightbox() {
  const el = document.createElement("div");
  el.className = "lb";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Screenshot");
  el.innerHTML = `
    <div class="lb-backdrop" data-close></div>
    <div class="lb-controls">
      <p class="lb-caption" hidden><span class="lb-count"></span><span class="lb-text"></span></p>
      <button class="lb-icon lb-actual" type="button" aria-pressed="false" aria-label="Actual size" title="Actual size">${ICONS.actual}</button>
      <a class="lb-icon lb-download" href="#" download aria-label="Download PNG" title="Download PNG">${ICONS.download}</a>
      <button class="lb-icon lb-close" type="button" aria-label="Close" title="Close" data-close>${ICONS.close}</button>
    </div>
    <figure class="lb-figure">
      <img class="lb-img" alt="" draggable="false" />
    </figure>
    <button class="lb-icon lb-nav lb-prev" type="button" aria-label="Previous screenshot" title="Previous (←)" hidden>${ICONS.prev}</button>
    <button class="lb-icon lb-nav lb-next" type="button" aria-label="Next screenshot" title="Next (→)" hidden>${ICONS.next}</button>`;
  document.body.appendChild(el);
  const $ = (sel) => el.querySelector(sel);
  const img = $(".lb-img");
  const fig = $(".lb-figure");
  const dl = $(".lb-download");
  const actualBtn = $(".lb-actual");
  const caption = $(".lb-caption");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  let group = []; // the triggers of the open set
  let index = 0;
  let returnTo = null; // gets focus back on close
  let hideTimer = 0;
  let meta = {}; // the shot on screen, for the file_download event

  const setActual = (on, at) => {
    el.classList.toggle("lb--actual", on);
    actualBtn.setAttribute("aria-pressed", String(on));
    actualBtn.title = on ? "Fit to screen" : "Actual size";
    // The 1:1 frame scrolls, so the keyboard can reach it too.
    if (on) { fig.tabIndex = 0; fig.setAttribute("aria-label", "Screenshot at actual size, scrollable"); }
    else { fig.removeAttribute("tabindex"); fig.removeAttribute("aria-label"); }
    if (!on) { fig.scrollTo(0, 0); return; }
    const f = fig.getBoundingClientRect();
    if (at) {
      // Keep the clicked point of the image under the pointer.
      fig.scrollLeft = at.fx * img.offsetWidth - (at.x - f.left);
      fig.scrollTop = at.fy * img.offsetHeight - (at.y - f.top);
    } else {
      fig.scrollLeft = (img.offsetWidth - fig.clientWidth) / 2;
      fig.scrollTop = 0;
    }
  };

  const show = (i) => {
    index = (i + group.length) % group.length;
    const shot = group[index];
    const data = shot.dataset;
    const thumb = shot.querySelector("img");
    const full = data.full;
    const title = data.title || "Screenshot";
    meta = { image_id: data.gaImage, image_source: data.gaSource, portal: data.gaPortal, week: data.gaWeek, device: data.gaDevice };
    setActual(false);
    // The enlarged image is the same file as the thumbnail, so it takes the thumbnail's size and alt.
    for (const a of ["width", "height"]) {
      if (thumb?.getAttribute(a)) img.setAttribute(a, thumb.getAttribute(a)); else img.removeAttribute(a);
    }
    img.src = full;
    img.alt = thumb?.alt || title + " screenshot";
    dl.href = full;
    dl.setAttribute("download", (data.file || "screenshot") + ".png");
    const many = group.length > 1;
    $(".lb-count").textContent = many ? `${index + 1} / ${group.length}` : "";
    $(".lb-text").textContent = data.caption || "";
    caption.hidden = !many && !data.caption;
    el.querySelectorAll(".lb-nav").forEach((b) => { b.hidden = !many; });
    el.setAttribute("aria-label", data.caption || img.alt);
  };

  const open = (shot) => {
    const g = shot.dataset.lbGroup;
    group = g ? [...document.querySelectorAll("[data-full][data-lb-group]")].filter((s) => s.dataset.lbGroup === g) : [shot];
    if (!group.includes(shot)) group = [shot];
    const active = document.activeElement;
    returnTo = shot.matches(FOCUSABLE) ? shot : active && active !== document.body ? active : null;
    show(group.indexOf(shot));
    clearTimeout(hideTimer);
    const wasHidden = el.hidden;
    el.hidden = false;
    document.body.style.overflow = "hidden";
    if (wasHidden) el.getBoundingClientRect(); // start the transition from the closed state
    el.classList.add("lb--open");
    $(".lb-close").focus();
  };

  const close = () => {
    if (el.hidden || !el.classList.contains("lb--open")) return;
    el.classList.remove("lb--open");
    document.body.style.overflow = "";
    const done = () => {
      el.hidden = true;
      setActual(false);
      img.removeAttribute("src");
    };
    if (reduced.matches) done(); else hideTimer = setTimeout(done, DURATION);
    if (returnTo?.isConnected) returnTo.focus();
    returnTo = null;
  };

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
    else if (e.target.closest(".lb-prev")) show(index - 1);
    else if (e.target.closest(".lb-next")) show(index + 1);
    else if (e.target.closest(".lb-actual")) setActual(!el.classList.contains("lb--actual"));
  });

  // Click the image to toggle Actual size; in Actual size a mouse drags the frame to pan (a drag is not a click).
  let drag = null;
  let dragged = false;
  fig.addEventListener("pointerdown", (e) => {
    dragged = false;
    if (!el.classList.contains("lb--actual") || e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, left: fig.scrollLeft, top: fig.scrollTop };
    fig.setPointerCapture(e.pointerId);
  });
  fig.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
    dragged = true;
    fig.classList.add("lb-dragging");
    fig.scrollLeft = drag.left - dx;
    fig.scrollTop = drag.top - dy;
  });
  const endDrag = () => { drag = null; fig.classList.remove("lb-dragging"); };
  fig.addEventListener("pointerup", endDrag);
  fig.addEventListener("pointercancel", endDrag);
  fig.addEventListener("click", (e) => {
    if (dragged) { dragged = false; return; }
    const actual = el.classList.contains("lb--actual");
    if (!actual && e.target !== img) return;
    if (actual) { setActual(false); return; }
    const r = img.getBoundingClientRect();
    setActual(true, { x: e.clientX, y: e.clientY, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
  });

  document.addEventListener("keydown", (e) => {
    if (el.hidden || !el.classList.contains("lb--open")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && group.length > 1) {
      e.preventDefault();
      show(index + (e.key === "ArrowRight" ? 1 : -1));
      return;
    }
    if (e.key !== "Tab") return;
    // Keep focus inside the dialog.
    const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const i = items.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (i === -1 || i === items.length - 1)) { e.preventDefault(); first.focus(); }
  });

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
      track("file_download", { download_type: "screenshot_png", file_name: name, file_extension: "png", ...meta });
    } catch {
      window.open(dl.href, "_blank", "noopener");
    }
  });

  // Delegate clicks from any thumbnail carrying data-full (gallery, collection, Compare, portal and /compare pages).
  document.body.addEventListener("click", (e) => {
    const shot = e.target.closest("[data-full]");
    if (!shot || el.contains(shot)) return;
    // A link opened with a modifier key or a middle click goes where it points (a new tab, a download).
    if (shot.matches("a[href]")) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
    }
    open(shot);
  });
}

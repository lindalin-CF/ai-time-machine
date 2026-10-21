// Desktop | Mobile toggle, used by the Library filter bar, the Collection and Compare. A segmented toggle
// (.viewtoggle / .vt-btn) with a monitor and a phone icon; the selected option has .active and aria-pressed="true".
// An option can be disabled with a reason: it is then disabled, aria-disabled and titled with the reason (the CSS
// gives it a dotted underline). Size and width come from the host's own layout rules, never from here.
// The first call renders the buttons; later calls update them in place, so listeners on them survive.

const ICONS = {
  desktop: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4l1 2h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h2l1-2H6a2 2 0 0 1-2-2V5Zm2 0v9h12V5H6Z"/></svg>`,
  mobile: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M7 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H7Zm0 2h10v14H7V5Zm4 12h2a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2Z"/></svg>`,
};
const LABELS = { desktop: "Desktop", mobile: "Mobile" };

/**
 * Render (or update) the Desktop | Mobile toggle in `host`, which becomes the labelled group.
 * opts: { attr: the data attribute naming each option ("device" → data-device), selected: "desktop" | "mobile",
 * disabled: { [device]: reason } }.
 */
export function deviceToggle(host, opts = {}) {
  if (!host) return;
  const attr = opts.attr || "device";
  const disabled = opts.disabled || {};
  if (!host.querySelector(".vt-btn")) {
    host.classList.add("viewtoggle", "device-toggle");
    host.setAttribute("role", "group");
    if (!host.hasAttribute("aria-label")) host.setAttribute("aria-label", "Screenshot device");
    host.innerHTML = Object.keys(LABELS).map((d) =>
      `<button class="vt-btn" type="button" data-${attr}="${d}" aria-pressed="false">${ICONS[d]}${LABELS[d]}</button>`).join("");
  }
  host.querySelectorAll(`.vt-btn[data-${attr}]`).forEach((b) => {
    const d = b.dataset[attr];
    const on = d === opts.selected;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
    const reason = disabled[d];
    b.disabled = !!reason;
    if (reason) { b.setAttribute("aria-disabled", "true"); b.title = reason; }
    else { b.removeAttribute("aria-disabled"); b.removeAttribute("title"); }
  });
}

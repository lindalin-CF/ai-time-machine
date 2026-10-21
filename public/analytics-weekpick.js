// Week dropdown for the Compare controls and the Library filter bar. Single select (button + listbox: closes on pick) or
// multi select (button + menu of checkboxes: stays open, at most `max` checked). Keyboard: Enter, Space
// or the arrow keys open it; arrows, Home and End move; Enter or Space picks; Esc closes and returns
// focus to the button; Tab or a click outside closes it. Calling weekPick() again on the same
// container updates it in place, so focus and the open state survive re-renders.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CHEVRON = `<svg class="an-wp-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>`;

/** Closed-state text in multi mode. */
export function weeksSummary(n) {
  return n === 0 ? "Pick weeks" : n === 1 ? "1 week" : `${n} weeks`;
}

let uid = 0;
let docBound = false;

function bindDocument() {
  if (docBound) return;
  docBound = true;
  document.addEventListener("click", (e) => {
    // The path at dispatch time: a pick re-renders the items, so the clicked one may be detached by now.
    const path = e.composedPath();
    document.querySelectorAll(".an-wp.is-open").forEach((wp) => {
      if (!path.includes(wp)) close(wp, false);
    });
  });
}

function items(wp) {
  return [...wp.querySelectorAll(".an-wp-item")];
}
function focusItem(wp, i) {
  const list = items(wp);
  if (!list.length) return;
  list[Math.max(0, Math.min(list.length - 1, i))].focus();
}
function open(wp, where = "selected") {
  const s = wp._wp;
  wp.classList.add("is-open");
  wp.querySelector(".an-wp-list").hidden = false;
  wp.querySelector(".an-wp-btn").setAttribute("aria-expanded", "true");
  const list = items(wp);
  if (where === "last") focusItem(wp, list.length - 1);
  else if (where === "first") focusItem(wp, 0);
  else {
    const i = list.findIndex((el) => s.selected.includes(el.dataset.v));
    focusItem(wp, i < 0 ? 0 : i);
  }
}
function close(wp, returnFocus) {
  wp.classList.remove("is-open");
  wp.querySelector(".an-wp-list").hidden = true;
  const btn = wp.querySelector(".an-wp-btn");
  btn.setAttribute("aria-expanded", "false");
  if (returnFocus) btn.focus();
}

function closedText(s) {
  if (s.multi) return weeksSummary(s.selected.length);
  return s.options.find((o) => o.value === s.selected[0])?.label ?? "Pick a week";
}

function render(wp) {
  const s = wp._wp;
  const focused = wp.contains(document.activeElement) ? document.activeElement.dataset.v : null;
  const full = s.multi && s.selected.length >= s.max;
  // Every text the button can show, stacked in one cell, so its width never jumps between choices.
  const texts = [...s.options.map((o) => o.label), s.multi ? [0, 1, 2, s.max].map(weeksSummary) : ["Pick a week"]].flat();
  wp.querySelector(".an-wp-value").innerHTML =
    `<span class="an-wp-current">${esc(closedText(s))}</span>` +
    texts.map((t) => `<span class="an-wp-sizer" aria-hidden="true">${esc(t)}</span>`).join("");
  wp.querySelector(".an-wp-list").innerHTML = s.options.map((o) => {
    const on = s.selected.includes(o.value);
    if (!s.multi) {
      return `<div class="an-wp-item" role="option" tabindex="-1" data-v="${esc(o.value)}" aria-selected="${on}">${esc(o.label)}</div>`;
    }
    const off = !on && full;
    return `<div class="an-wp-item" role="menuitemcheckbox" tabindex="-1" data-v="${esc(o.value)}" aria-checked="${on}"${off ? ` aria-disabled="true"` : ""}><span class="an-wp-check" aria-hidden="true"></span>${esc(o.label)}</div>`;
  }).join("");
  if (focused) wp.querySelector(`.an-wp-item[data-v="${CSS.escape(focused)}"]`)?.focus();
}

function pick(wp, el) {
  const s = wp._wp;
  const v = el.dataset.v;
  if (!s.multi) {
    s.selected = [v];
    render(wp);
    close(wp, true);
    s.onChange(v);
    return;
  }
  if (el.getAttribute("aria-disabled") === "true") return;
  s.selected = s.selected.includes(v) ? s.selected.filter((x) => x !== v) : [...s.selected, v];
  render(wp);
  s.onChange([...s.selected]);
}

function create(container) {
  const id = `an-wp-${++uid}`;
  const wp = document.createElement("div");
  wp.className = "an-wp";
  wp.innerHTML =
    `<button class="an-wp-btn" type="button" aria-expanded="false" aria-controls="${id}"><span class="an-wp-value"></span>${CHEVRON}</button>` +
    `<div class="an-wp-list" id="${id}" hidden></div>`;
  const btn = wp.querySelector(".an-wp-btn");
  const list = wp.querySelector(".an-wp-list");

  btn.addEventListener("click", () => {
    if (wp.classList.contains("is-open")) close(wp, false);
    else open(wp);
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(wp); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open(wp, "last"); }
  });
  list.addEventListener("click", (e) => {
    const el = e.target.closest(".an-wp-item");
    if (el) pick(wp, el);
  });
  list.addEventListener("keydown", (e) => {
    const all = items(wp);
    const i = all.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(wp, i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(wp, i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(wp, 0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(wp, all.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (all[i]) pick(wp, all[i]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(wp, true); }
    else if (e.key === "Tab") close(wp, false);
  });
  container.replaceChildren(wp);
  bindDocument();
  return wp;
}

/** Close every open week dropdown (for another menu opening whose click does not reach the document). */
export function closeWeekPicks() {
  document.querySelectorAll(".an-wp.is-open").forEach((wp) => close(wp, false));
}

/**
 * Render (or update) the week dropdown in `container`.
 * opts: { options: [{ value, label }] newest first, selected: [values], multi, max, labelledBy, onChange }
 * onChange gets the picked value (single) or the array of checked values (multi).
 */
export function weekPick(container, opts) {
  let wp = container.querySelector(":scope > .an-wp");
  if (!wp || wp._wp.multi !== !!opts.multi) wp = create(container);
  wp._wp = { options: opts.options, selected: [...opts.selected], multi: !!opts.multi, max: opts.max ?? Infinity, onChange: opts.onChange };
  const list = wp.querySelector(".an-wp-list");
  list.setAttribute("role", wp._wp.multi ? "menu" : "listbox");
  const btn = wp.querySelector(".an-wp-btn");
  btn.setAttribute("aria-haspopup", wp._wp.multi ? "menu" : "listbox");
  if (opts.labelledBy) {
    btn.setAttribute("aria-labelledby", `${opts.labelledBy} ${list.id}-value`);
    wp.querySelector(".an-wp-value").id = `${list.id}-value`;
    list.setAttribute("aria-labelledby", opts.labelledBy);
  }
  render(wp);
  return wp;
}

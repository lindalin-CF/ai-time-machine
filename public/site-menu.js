// Top-bar menu on phones (≤ 640px), shared by the homepage and the server-rendered pages (siteHeader in src/portal-page.ts).
// CSS hides the nav behind the menu button only once html.js is set (inline <head> script), so without JS the links stay visible.
// Open: html.menu-open shows the panel; the page behind keeps scrolling. Closes on a link tap, a tap outside (a click,
// so a scroll or swipe never counts), Esc (focus back to the button), focus leaving the menu, or the window growing past 640px.
(() => {
  const btn = document.querySelector(".topnav-toggle");
  const nav = btn && document.getElementById(btn.getAttribute("aria-controls"));
  if (!nav) return;
  const root = document.documentElement;
  const phone = matchMedia("(max-width:640px)");
  const isOpen = () => btn.getAttribute("aria-expanded") === "true";
  const set = (open) => {
    btn.setAttribute("aria-expanded", String(open));
    root.classList.toggle("menu-open", open);
  };
  btn.addEventListener("click", () => set(!isOpen()));
  // Library / Collection / Compare are hash links on the homepage: no reload, so close here.
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  // A tap outside only closes the menu; it doesn't also press whatever was under it.
  document.addEventListener("click", (e) => {
    if (!isOpen() || btn.contains(e.target) || nav.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    set(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen()) return;
    set(false);
    btn.focus();
  });
  // Tabbing out closes it. Focus from a press (:focus-visible is false) is left to the click rule above, so that tap is still swallowed.
  document.addEventListener("focusin", (e) => {
    if (isOpen() && !btn.contains(e.target) && !nav.contains(e.target) && e.target.matches?.(":focus-visible")) set(false);
  });
  phone.addEventListener("change", () => { if (!phone.matches) set(false); });
})();

// Analytics consent, shared by every page (loaded with defer from <head>).
//
// Decides whether Google Analytics and Microsoft Clarity may load, shows the consent bar when the
// visitor must be asked, and wires every "Cookie preferences" button (data-consent-open).
//
// Rules, first match wins:
// 1. Global Privacy Control is on: never load analytics and show no bar, whatever the region.
// 2. A stored choice (localStorage, strictly necessary): "accepted" loads, "declined" loads nothing.
// 3. <html data-consent="not-required">, set per request by the Worker (src/consent.ts): load.
// 4. Otherwise ("required", or no attribute at all, e.g. a static fallback page): show the bar
//    and load nothing until Accept.
(() => {
  const GA_ID = "G-X9PB6Q8VT6";
  const CLARITY_ID = "yoxz5c38mi";
  const KEY = "analytics-consent";

  const root = document.documentElement;
  const gpc = navigator.globalPrivacyControl === true;
  const required = root.dataset.consent !== "not-required";

  function storedChoice() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "accepted" || v === "declined" ? v : null;
    } catch {
      return null;
    }
  }
  function saveChoice(v) {
    try { localStorage.setItem(KEY, v); } catch {}
  }

  // ---- analytics ------------------------------------------------------------
  let loaded = false;
  function addScript(src) {
    const s = document.createElement("script");
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }
  function loadAnalytics() {
    if (gpc) return;
    window[`ga-disable-${GA_ID}`] = false;
    if (loaded) {
      // Declined and then accepted again on the same page: turn the running tags back on.
      window.gtag("consent", "update", { analytics_storage: "granted" });
      window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
      return;
    }
    loaded = true;

    // Google Analytics, with Consent Mode: analytics granted, every advertising signal denied.
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
    addScript(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`);

    // Microsoft Clarity. The queue stub lets the Consent API v2 signal go ahead of the tag.
    window.clarity = window.clarity || function clarity() { (window.clarity.q = window.clarity.q || []).push(arguments); };
    window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
    addScript(`https://www.clarity.ms/tag/${CLARITY_ID}`);
  }
  // Turning analytics off on a page where they already run: stop sending, clear their cookies.
  // Later page views load nothing, because the stored choice is "declined".
  function stopAnalytics() {
    if (!loaded) return;
    window[`ga-disable-${GA_ID}`] = true;
    if (typeof window.gtag === "function") window.gtag("consent", "update", { analytics_storage: "denied" });
    if (typeof window.clarity === "function") window.clarity("consent", false);
    clearCookies(/^(_ga|_gid|_gat|_clck|_clsk)/);
  }
  function clearCookies(pattern) {
    const parts = location.hostname.split(".");
    const domains = [""];
    for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join(".")}`);
    for (const c of document.cookie.split(";")) {
      const name = c.split("=")[0].trim();
      if (!pattern.test(name)) continue;
      for (const d of domains) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
    }
  }

  // ---- consent bar ----------------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
.consent-bar{position:fixed;left:0;right:0;bottom:0;z-index:100;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 20px;
  padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--cf-border-strong,#d8cfc2);
  background:var(--cf-bg-100,#fffdf9);color:var(--cf-text,#231f1a);font:15px/1.5 var(--font-sans,system-ui,-apple-system,Segoe UI,sans-serif);
  box-shadow:0 -8px 24px -16px rgba(35,31,26,.35)}
.consent-bar[hidden]{display:none}
.consent-bar p{margin:0;flex:1 1 320px;max-width:720px}
.consent-bar a{color:inherit;text-decoration:underline}
.consent-status{display:block;margin-top:2px;font-size:13px;opacity:.8}
.consent-actions{display:flex;gap:10px;flex:0 1 auto}
.consent-btn{flex:1 1 0;min-width:112px;min-height:44px;padding:10px 18px;border:1px solid var(--cf-text,#231f1a);border-radius:8px;
  background:var(--cf-bg-100,#fffdf9);color:var(--cf-text,#231f1a);font:inherit;font-weight:600;cursor:pointer}
.consent-btn:hover{background:var(--cf-bg-200,#f4efe8)}
.consent-btn:focus-visible,.consent-bar a:focus-visible{outline:2px solid var(--cf-orange,#eb622c);outline-offset:2px}
@media (max-width:480px){.consent-actions{flex:1 1 100%}}
html.consent-bar-open body{padding-bottom:var(--consent-bar-h,0px)}
html.consent-bar-open .voice-fab{bottom:calc(var(--consent-bar-h,0px) + 12px)}
html.consent-bar-open .voice-panel{bottom:calc(var(--consent-bar-h,0px) + 68px)}
`;
  document.head.appendChild(style);

  const TEXT = "This site uses analytics from Google and Microsoft to understand how it&#39;s used. You can accept or decline.";
  const GPC_TEXT = "Your browser sends a Global Privacy Control signal, so this site never loads analytics.";

  const bar = document.createElement("section");
  bar.id = "consent-banner";
  bar.className = "consent-bar";
  bar.setAttribute("aria-label", "Cookie preferences");
  bar.hidden = true;
  bar.innerHTML = gpc
    ? `<p>${GPC_TEXT} <a href="/privacy">Privacy</a></p>
  <div class="consent-actions"><button type="button" class="consent-btn" data-consent-close>Close</button></div>`
    : `<p>${TEXT} <a href="/privacy">Privacy</a><span class="consent-status" hidden></span></p>
  <div class="consent-actions">
    <button type="button" class="consent-btn" data-consent-choice="accepted">Accept</button>
    <button type="button" class="consent-btn" data-consent-choice="declined">Decline</button>
  </div>`;
  // First in the page so keyboard users reach it first; CSS keeps it at the bottom of the screen.
  document.body.prepend(bar);

  const status = bar.querySelector(".consent-status");
  let opener = null;

  function syncHeight() {
    root.style.setProperty("--consent-bar-h", `${bar.hidden ? 0 : bar.offsetHeight}px`);
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(syncHeight).observe(bar);

  function showBar(from) {
    opener = from || null;
    if (status) {
      const choice = storedChoice();
      const on = choice ? choice === "accepted" : !required;
      status.textContent = `Analytics are ${on ? "on" : "off"} for this browser.`;
      status.hidden = !from;
    }
    bar.hidden = false;
    root.classList.add("consent-bar-open");
    syncHeight();
    if (from) bar.querySelector("button").focus();
  }
  function hideBar() {
    bar.hidden = true;
    root.classList.remove("consent-bar-open");
    syncHeight();
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const choice = btn.dataset.consentChoice;
    if (choice) {
      saveChoice(choice);
      if (choice === "accepted") loadAnalytics();
      else stopAnalytics();
    }
    hideBar();
  });
  // Escape closes the bar only when it was opened from Cookie preferences; a first-visit question stays until answered.
  bar.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opener) hideBar();
  });

  for (const btn of document.querySelectorAll("[data-consent-open]")) {
    btn.setAttribute("aria-controls", bar.id);
    btn.addEventListener("click", () => showBar(btn));
  }

  // ---- decide ---------------------------------------------------------------
  if (gpc) return;
  const choice = storedChoice();
  if (choice === "accepted") loadAnalytics();
  else if (choice === "declined") return;
  else if (!required) loadAnalytics();
  else showBar(null);
})();

// GA4 events, on every page: public/app.js imports this module on the homepage, and the server pages
// (src/portal-page.ts) load it on their own.
//
// window.gtag exists only once public/consent.js has loaded Google Analytics, so without consent nothing is
// sent and nothing breaks. ?ga_debug=1 in the URL marks every event debug_mode, so it shows in GA4 DebugView.

const MAX_PORTALS = 4;

/** Send one GA4 event. A no-op when gtag is not there; empty params are left out. */
export function track(name, params = {}) {
  if (typeof window.gtag !== "function") return;
  const p = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p[k] = v;
  try {
    if (new URLSearchParams(location.search).get("ga_debug") === "1") p.debug_mode = true;
    window.gtag("event", name, p);
  } catch {}
}

/** compare_click's common params, from a Compare link's hash (the format of public/analytics-share.js).
 * Single portal (mode=time) reports its portal and the newest of its weeks. */
export function compareLinkParams(hash) {
  const i = String(hash || "").indexOf("?");
  const q = new URLSearchParams(i < 0 ? "" : hash.slice(i + 1));
  const time = q.get("mode") === "time";
  const portals = time ? [q.get("portal")] : String(q.get("portals") || "").split(",");
  return {
    compare_mode: time ? "time" : "portals",
    portals: portals.filter(Boolean).slice(0, MAX_PORTALS).join(","),
    week: time ? String(q.get("weeks") || "").split(",")[0] : q.get("week"),
    device: q.get("device") === "mobile" ? "mobile" : "desktop",
  };
}

/** A compare_click: sent by beacon, so a link that leaves the page still delivers it, and never held up. */
export function trackCompare(ctaLocation, params) {
  track("compare_click", { cta_location: ctaLocation, ...params, transport_type: "beacon" });
}

// The top bar's Compare link: the homepage knows what Compare will open (setNavCompareParams); a server page
// only knows Compare's defaults.
let navParams = () => ({ compare_mode: "portals", device: "desktop" });
export function setNavCompareParams(fn) { navParams = fn; }

// Listen only; the browser follows the link as usual. (No document when a unit test imports this module.)
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a) return;
  const hash = new URL(a.href, location.href).hash;
  if (a.classList.contains("compare-cta")) {
    const params = compareLinkParams(hash);
    trackCompare("portal_page", { ...params, portal: params.portals });
  } else if (a.classList.contains("topnav-link") && hash.split("?")[0] === "#compare") {
    trackCompare("nav", navParams());
  }
});

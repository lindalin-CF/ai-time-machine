// Region-based analytics consent.
//
// The Worker decides per request whether the visitor must be asked before analytics load, from
// Cloudflare's country code, and writes the answer onto <html data-consent="...">. public/consent.js
// reads it in the browser. The answer is visitor-specific, so every response that carries it is
// sent with a private cache-control and is never written to KV or the Cache API.

/** Where visitors are asked first: the EEA (the 27 EU countries plus IS, LI, NO), GB and CH. */
export const CONSENT_COUNTRIES: ReadonlySet<string> = new Set([
  // EU 27
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // Rest of the EEA
  "IS", "LI", "NO",
  // United Kingdom and Switzerland
  "GB", "CH",
]);

/** Cloudflare's codes for "no country": XX (unknown) and T1 (Tor). */
const UNKNOWN_COUNTRIES = new Set(["XX", "T1"]);

/** True when the visitor must accept before analytics load. A missing or unknown country counts as required. */
export function consentRequired(request: Request): boolean {
  const country = (request as { cf?: { country?: unknown } }).cf?.country;
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country) || UNKNOWN_COUNTRIES.has(country)) return true;
  return CONSENT_COUNTRIES.has(country);
}

export type ConsentMode = "required" | "not-required";

export function consentMode(request: Request): ConsentMode {
  return consentRequired(request) ? "required" : "not-required";
}

/** Add data-consent to the page's <html> tag. */
export function withConsentAttr(html: string, mode: ConsentMode): string {
  return html.replace(/<html\b(?![^>]*\bdata-consent=)/, `<html data-consent="${mode}"`);
}

/**
 * Cache-control for a page that carries data-consent. `private` keeps shared caches (proxies, CDNs)
 * from storing it, so one visitor's region can never be served to another.
 */
export const PRIVATE_HTML_CACHE = "private, max-age=300";

/**
 * What the browser reports when it opens the voice connection (public/voice.js, ?analytics=...),
 * from public/consent.js: the visitor's stored choice ("accepted" / "declined"), "default" when
 * there is none, or "off" when Global Privacy Control is on.
 */
export type AnalyticsChoice = "accepted" | "declined" | "default" | "off";

/**
 * Whether analytics are allowed for this request, under the same rules public/consent.js applies to
 * Google Analytics and Clarity. The stored choice lives in the browser's localStorage, so the browser
 * reports it; the server adds what it can check itself:
 * - a Sec-GPC: 1 header means no, whatever the browser reports;
 * - "accepted" (a stored Accept) means yes;
 * - "default" (no stored choice) means yes only outside the consent region, the same default the
 *   Worker writes into data-consent, so a client can't claim a default in a consent region;
 * - anything else, including "declined", "off" and a missing value, means no.
 */
export function analyticsAllowed(request: Request): boolean {
  if (request.headers.get("sec-gpc")?.trim() === "1") return false;
  const choice = new URL(request.url).searchParams.get("analytics");
  if (choice === "accepted") return true;
  if (choice === "default") return !consentRequired(request);
  return false;
}

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

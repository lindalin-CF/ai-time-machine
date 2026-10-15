// One address per page for search engines. Search Console found the homepage indexed under http,
// www and the bare domain; the http versions need Cloudflare's Always Use HTTPS, and this file
// handles the rest.

/** The only hostname that is redirected; everything else (including workers.dev) is served as is. */
export const WWW_HOST = "www.ai-portal-library.dev";
export const CANONICAL_HOST = "ai-portal-library.dev";

/**
 * A 301 to https://ai-portal-library.dev with the same path and query, for requests to the www host.
 * Nothing else is redirected: the capture scripts upload over the workers.dev address, and a
 * redirected POST would fail.
 */
export function canonicalRedirect(url: URL): Response | null {
  if (url.hostname !== WWW_HOST) return null;
  return Response.redirect(`https://${CANONICAL_HOST}${url.pathname}${url.search}`, 301);
}

/**
 * The workers.dev copy of the site stays reachable (uploads use it), so its pages ask search engines
 * not to index them. Only HTML is marked: the API, /img/ screenshots and uploads are left alone.
 */
export function noindexOnWorkersDev(url: URL, response: Response): Response {
  if (!url.hostname.endsWith(".workers.dev")) return response;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/img/")) return response;
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) return response;
  const marked = new Response(response.body, response);
  marked.headers.set("x-robots-tag", "noindex");
  return marked;
}

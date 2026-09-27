import type { Env } from "./types";
import { statsPayload, capturesPayload } from "./api";
import { latestWeek } from "./db";
import { esc } from "./portal-page";
import { consentMode, withConsentAttr } from "./consent";

type Stats = Awaited<ReturnType<typeof statsPayload>>;
type Captures = { label: string; captures: { slug: string; portal: string; company: string; status: string }[] } | null;

/**
 * Fill the static homepage (public/index.html) with real content so crawlers see more than
 * placeholders: the three stats, the week heading, and a link to every portal in the latest week.
 * public/app.js later renders the same stats and heading, and the .js class hides the link list
 * (the cards link to the same pages), so visitors with JavaScript see no change.
 */
export function renderHomepage(html: string, stats: Stats, latest: Captures): string {
  const heading = latest
    ? `${latest.label} · ${latest.captures.filter((c) => c.status === "ok").length} portals`
    : "No captures yet";
  const items = (latest?.captures ?? [])
    .map((c) => `\n        <li><a href="/portals/${esc(c.slug)}">${esc(c.portal)}</a> <span>${esc(c.company)}</span></li>`)
    .join("");
  return html
    .replace(/(<dd data-stat="(screenshots|portals|weeks)">)–(<\/dd>)/g, (_, open: string, key: keyof Stats, close: string) => `${open}${stats[key]}${close}`)
    .replace('<h2 id="weekHeading">Loading…</h2>', `<h2 id="weekHeading">${esc(heading)}</h2>`)
    .replace(/(<ul class="portal-index" id="portalIndex"[^>]*>)(<\/ul>)/, (_, open: string, close: string) => `${open}${items}${items ? "\n      " : ""}${close}`);
}

export async function handleHomepage(request: Request, env: Env): Promise<Response> {
  // A fresh GET so conditional request headers never turn the asset into an empty 304.
  const asset = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!asset.ok) return asset;
  const html = await asset.text();
  const headers = new Headers(asset.headers);
  headers.delete("content-length");
  headers.delete("etag");
  // The page carries this visitor's consent region, so no shared cache may store it.
  headers.set("cache-control", "private, no-cache");

  let body = html;
  try {
    const week = await latestWeek(env);
    const [stats, latest] = await Promise.all([statsPayload(env), week ? capturesPayload(env, week) : null]);
    body = renderHomepage(html, stats, latest);
  } catch (err) {
    console.error("homepage render failed; serving the static page:", err);
  }
  body = withConsentAttr(body, consentMode(request));
  return new Response(request.method === "HEAD" ? null : body, { status: asset.status, headers });
}

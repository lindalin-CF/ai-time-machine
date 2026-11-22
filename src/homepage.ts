import type { Env } from "./types";
import { statsPayload, capturesPayload, cached } from "./api";
import { latestWeek, listWeeks, notHeld } from "./db";
import { weekDigests } from "./weeks";
import { wireframe, timelineHtml, TIMELINE_SLOT, type HeroTimeline, type TimelineFrame } from "./wireframe";
import { esc, jsonLdScript, ORIGIN, FEED_URL, FEED_DESCRIPTION, SITE_PERSON, LICENSE_URL } from "./portal-page";
import { SYSTEM_TEST_WEEKS, isPublishedAnalysis } from "./analysis";
import { consentMode, withConsentAttr } from "./consent";

type Stats = Awaited<ReturnType<typeof statsPayload>>;
type Captures = { week?: string; label: string; captures: { slug: string; portal: string; company: string; status: string }[] } | null;
/** First and last archived week (YYYY-MM-DD), leaving out the system-test weeks. */
export type Coverage = { from: string; to: string } | null;

/** Homepage structured data: the site (WebSite) and its weekly archive (Dataset). */
export function homepageJsonLd(coverage: Coverage): unknown {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "AI Interface Library", url: `${ORIGIN}/`, description: FEED_DESCRIPTION, inLanguage: "en", publisher: SITE_PERSON },
      {
        "@type": "Dataset",
        name: "AI Interface Library: weekly AI product interface captures",
        description: "Weekly desktop and mobile screenshots of the first screen of AI products such as ChatGPT, Claude and Gemini, each with a short design analysis of layout, visual hierarchy, text contrast and menu changes.",
        url: `${ORIGIN}/`,
        inLanguage: "en",
        license: LICENSE_URL,
        ...(coverage ? { temporalCoverage: `${coverage.from}/${coverage.to}` } : {}),
        distribution: { "@type": "DataDownload", encodingFormat: "application/rss+xml", contentUrl: FEED_URL },
      },
    ],
  };
}

/**
 * Fill the static homepage (public/index.html) with real content so crawlers see more than
 * placeholders: the three stats, the hero's timeline, the week heading, and a link to every portal in the latest week.
 * public/app.js later renders the same stats and heading, and the .js class hides the link list
 * (the cards link to the same pages), so visitors with JavaScript see no change.
 */
export function renderHomepage(html: string, stats: Stats, latest: Captures, coverage: Coverage = null, timeline: HeroTimeline | null = null): string {
  const heading = latest ? latest.label : "No captures yet";
  const items = (latest?.captures ?? [])
    .map((c) => `\n        <li><a href="/portals/${esc(c.slug)}">${esc(c.portal)}</a> <span>${esc(c.company)}</span></li>`)
    .join("");
  return html
    .replace(/(<dd data-stat="(screenshots|portals|weeks)">)–(<\/dd>)/g, (_, open: string, key: keyof Stats, close: string) => `${open}${stats[key]}${close}`)
    .replace(TIMELINE_SLOT, () => (timeline ? timelineHtml(timeline) : TIMELINE_SLOT))
    .replace('<h2 id="weekHeading">Loading…</h2>', `<h2 id="weekHeading">${esc(heading)}</h2>`)
    // The heading's week links to its digest; public/app.js points it at the week picked later.
    .replace('<a class="btn-secondary" id="weekDigest" href="/weeks" hidden>', () => latest?.week ? `<a class="btn-secondary" id="weekDigest" href="/weeks/${esc(latest.week)}">` : '<a class="btn-secondary" id="weekDigest" href="/weeks" hidden>')
    // The static WebSite block (kept for when the database can't be read) becomes WebSite + Dataset.
    .replace(/ *<script type="application\/ld\+json">[\s\S]*?<\/script>\n/, () => jsonLdScript(homepageJsonLd(coverage)))
    .replace(/(<ul class="portal-index" id="portalIndex"[^>]*>)(<\/ul>)/, (_, open: string, close: string) => `${open}${items}${items ? "\n      " : ""}${close}`);
}

/** At least this many drawable weeks, or the strip says too little; at most this many (the newest). */
export const TIMELINE_MIN = 3, TIMELINE_MAX = 16;

/**
 * The hero timeline's product and frames: the product with the most recent recorded change (the newest week digest
 * with changes, its first changed portal in portal order; the next one if it has fewer than TIMELINE_MIN drawable
 * weeks), one frame per week with a published desktop analysis, oldest first. Null when no product qualifies.
 * `n` is the week's place among the archived weeks (the hero's "Weeks archived" count), so the latest is "W<count>".
 */
export async function heroTimeline(env: Env): Promise<HeroTimeline | null> {
  return await cached(env, "cache:hero-timeline", 300, async () => {
    const [digests, weeks] = await Promise.all([weekDigests(env), listWeeks(env)]);
    const asc = weeks.map((w) => w.week).sort();
    const labels = new Map(weeks.map((w) => [w.week, w.label]));
    const seen = new Set<string>();
    const candidates = digests.flatMap((d) => d.changed).filter((p) => !seen.has(p.slug) && !!seen.add(p.slug));
    for (const p of candidates) {
      const { results } = await env.DB.prepare(
        `SELECT c.week AS week, c.analysis AS analysis, c.analysis_by AS analysis_by, c.analysis_json AS analysis_json
         FROM captures c WHERE c.slug = ? AND c.status = 'ok' AND ${await notHeld(env)} AND c.analysis_by LIKE 'guideline-v%'
         ORDER BY c.week ASC`
      ).bind(p.slug).all<{ week: string; analysis: string; analysis_by: string; analysis_json: string | null }>();
      const frames: TimelineFrame[] = [];
      for (const r of results ?? []) {
        if (SYSTEM_TEST_WEEKS.includes(r.week) || !labels.has(r.week) || !isPublishedAnalysis(r) || !r.analysis_json) continue;
        let a: unknown;
        try { a = JSON.parse(r.analysis_json); } catch { continue; }
        if ((a as { week?: unknown } | null)?.week !== r.week) continue;
        const boxes = wireframe(a);
        if (boxes) frames.push({ week: r.week, n: asc.indexOf(r.week) + 1, label: labels.get(r.week)!, boxes });
      }
      if (frames.length >= TIMELINE_MIN) return { slug: p.slug, name: p.name, frames: frames.slice(-TIMELINE_MAX) };
    }
    return null;
  });
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
    const [stats, latest, weeks, timeline] = await Promise.all([
      statsPayload(env), week ? capturesPayload(env, week) : null, listWeeks(env),
      // The strip is decoration: without it the hero still works, so its failure never costs the rest of the page.
      heroTimeline(env).catch((err) => { console.error("hero timeline failed:", err); return null; }),
    ]);
    const archived = weeks.map((w) => w.week).filter((w) => !SYSTEM_TEST_WEEKS.includes(w)); // newest first
    body = renderHomepage(html, stats, latest, archived.length ? { from: archived.at(-1)!, to: archived[0] } : null, timeline);
  } catch (err) {
    console.error("homepage render failed; serving the static page:", err);
  }
  body = withConsentAttr(body, consentMode(request));
  return new Response(request.method === "HEAD" ? null : body, { status: asset.status, headers });
}

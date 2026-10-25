import type { Env, CaptureRow } from "./types";
import { getPortal, latestCaptureForPortal, captureForPortalWeek, captureWeeksForPortal, sitemapCaptures, feedCaptures, publishedCaptures, type SitemapCapture } from "./db";
import { isPublishedAnalysis, displayedAnalysis, summaryDescription, feedSummary, SYSTEM_TEST_WEEKS } from "./analysis";
import { cached } from "./api";
import { consentMode, PRIVATE_HTML_CACHE, type ConsentMode } from "./consent";
import { desktopSize, mobileSize } from "./api";
import { MOBILE_CAPTURE_SIZE } from "./image-size";
import { shotAlt, weekInWords, weekShort } from "./format";
import { captureMetrics } from "./capture-metrics";
import { changeEntries, navChangeSentence, navItemName, type ChangeEntry } from "./nav-changes";
import { COMPARE_WITH_LINKS, POPULAR_PAIRINGS, comparePath, indexablePairs } from "./compare";
import { weekDigests, latestIndexableWeek } from "./weeks";
import { CHANGELOG, CHANGELOG_UPDATED, changelogDate, changelogDatetime, utcOffsetLabel, type ChangelogEntry } from "./changelog";

export const ORIGIN = "https://ai-portal-library.dev";
export const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };
export const MARKDOWN_HEADERS = { "content-type": "text/markdown; charset=utf-8" };

/** The person who runs the site, as named in structured data. */
export const SITE_PERSON = { "@type": "Person", name: "Linda" } as const;

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function shotUrl(key: string | null, slug: string, capturedAt: string): string {
  if (!key) return `/samples/${slug}.svg`;
  return `/img/${key}?v=${Date.parse(capturedAt) || 0}`;
}

function shortText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/** Footer copyright and license line (with License, Privacy and Cookie preferences) + Disclaimer and Contact dialogs. The homepage (public/index.html) carries the same markup; both use /footer-dialogs.js. */
const FOOTER_LEGAL = `      <div class="legal">&copy; 2026 AI Interface Library. Analyses licensed under CC BY 4.0 &middot; <a href="/license">License</a> &middot; <a href="/changelog">Changelog</a> &middot; <button type="button" class="linkbtn" data-dialog="disclaimer" aria-haspopup="dialog">Disclaimer</button> &middot; <button type="button" class="linkbtn" data-dialog="contact" aria-haspopup="dialog">Contact</button> &middot; <a href="/privacy">Privacy</a> &middot; <button type="button" class="linkbtn" data-consent-open>Cookie preferences</button></div>
      <dialog id="disclaimer" class="site-dialog" aria-labelledby="disclaimer-title">
        <form method="dialog">
          <button type="submit" class="site-dialog-x" aria-label="Close">&times;</button>
          <h2 id="disclaimer-title">Disclaimer</h2>
          <p>Product screenshots, logos, and trademarks belong to their respective owners. AI Interface Library is an independent project, unaffiliated with the brands featured.</p>
          <p>Content is for reference and research. Screenshots may differ from current interfaces.</p>
          <p><a href="/how-we-analyze">Learn how the design analysis is made.</a></p>
          <div class="site-dialog-actions"><button type="submit" class="site-dialog-close">Close</button></div>
        </form>
      </dialog>
      <dialog id="contact" class="site-dialog" aria-labelledby="contact-title">
        <form method="dialog">
          <button type="submit" class="site-dialog-x" aria-label="Close">&times;</button>
          <h2 id="contact-title">Contact</h2>
          <p>For removal requests, corrections or questions, email:</p>
          <p class="contact-row"><span class="contact-address" data-copy-source>contact@ai-portal-library.dev</span> <button type="button" class="contact-copy" data-copy="contact@ai-portal-library.dev" aria-live="polite">Copy</button></p>
          <div class="site-dialog-actions"><a class="contact-mail" href="mailto:contact@ai-portal-library.dev">Open email app</a><button type="submit" class="site-dialog-close">Close</button></div>
        </form>
      </dialog>`;

/**
 * Other names people search for a portal by (at most 2, most used first). The first shows in the hub
 * description and under the h1; all go into the product's JSON-LD alternateName.
 */
export const PORTAL_ALIASES: Record<string, string[]> = {
  mistral: ["LeChat", "Mistral Le Chat"],
  qwen: ["QwenChat"],
  copilot: ["Copilot"],
};

export const BRAND = " | AI Interface Library";
/** Search results show about this many characters of a description. */
const DESCRIPTION_SHOWN = 155;

/** Hub title before the brand: "ChatGPT UI screenshots & interface changes, week by week", shortened past 70 characters. */
export function hubTitle(name: string): string {
  const full = `${name} UI screenshots & interface changes, week by week`;
  return full.length <= 70 ? full : `${name} UI screenshots, week by week`;
}

/** Hub description: what the page shows, the first alias, and the latest week when it still fits. */
export function hubDescription(name: string, aliases: string[], changed: boolean, latestWeek: string | null): string {
  let d = `Weekly ${name} UI screenshots, desktop and mobile, with interface design analysis${changed ? ` and how the ${name} UI changed` : ""}.`;
  if (aliases[0]) d += ` Also called ${aliases[0]}.`;
  const latest = latestWeek ? ` Latest: week of ${weekInWords(latestWeek)}.` : "";
  return latest && (d + latest).length <= DESCRIPTION_SHOWN ? d + latest : d;
}

/** One timeline line per week with menu changes, newest first: the week and its changes as short phrases. */
export type TimelineWeek = { week: string; phrases: string[] };

function timelineWeeks(entries: ChangeEntry[]): TimelineWeek[] {
  const out: TimelineWeek[] = [];
  for (const e of entries) { // already newest week first
    const last = out.at(-1);
    if (last && last.week === e.week) last.phrases.push(e.phrase);
    else out.push({ week: e.week, phrases: [e.phrase] });
  }
  return out;
}

export type PreviewImage = { url: string; width: number; height: number; alt: string };

export const FEED_URL = `${ORIGIN}/feed.xml`;
/** Channel description: the same as the homepage's meta description. */
export const FEED_DESCRIPTION = "Weekly screenshots of AI chatbot interfaces — ChatGPT, Claude, Gemini, Perplexity, Copilot and more — on desktop and mobile, with design analysis and UI changes week by week.";

/** The site-wide link preview (public/og-image.png), used where a page has no screenshot of its own. */
export const SITE_PREVIEW: PreviewImage = { url: `${ORIGIN}/og-image.png`, width: 1200, height: 630, alt: "AI Interface Library" };

/** Link preview and search metadata for an indexable page (one with a canonical URL). */
function socialMeta(title: string, description: string, canonical: string, image: PreviewImage): string {
  return `  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="AI Interface Library" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(image.url)}" />
  <meta property="og:image:width" content="${image.width}" />
  <meta property="og:image:height" content="${image.height}" />
  <meta property="og:image:alt" content="${esc(image.alt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image.url)}" />
  <meta name="twitter:image:alt" content="${esc(image.alt)}" />
`;
}

/** A JSON-LD <script>; "<" is escaped so the data can never close the script element. */
export function jsonLdScript(data: unknown): string {
  return `  <script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>\n`;
}

/** The top bar's menu button for phones (≤ 640px; public/site-menu.js). public/index.html carries the same markup. */
export const MENU_BUTTON = `<button type="button" class="topnav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><svg class="topnav-toggle-open" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg><svg class="topnav-toggle-close" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button>`;

/**
 * The site's top bar, the same as the homepage's (public/index.html): wordmark, then Library · Collection · Compare.
 * The homepage views are hashes on /, so no link is current on a server-rendered page (the Changelog is in the footer).
 */
export function siteHeader(): string {
  const links: [string, string][] = [["/", "Library"], ["/#collection", "Collection"], ["/#compare", "Compare"]];
  const nav = links.map(([href, label]) => `<a href="${href}" class="topnav-link">${label}</a>`).join("\n        ");
  return `    <header class="topbar">
      <a class="wordmark" href="/"><span class="wordmark-dot" aria-hidden="true"></span><span class="wordmark-text">AI Interface Library</span></a>
      ${MENU_BUTTON}
      <nav class="topnav" id="site-nav" aria-label="Site">
        ${nav}
      </nav>
    </header>`;
}

/**
 * A screenshot <img> wrapped in a link to its original full-size file, which public/lightbox.js opens in the lightbox
 * (a set of `group`, walked with the arrows; download name and GA4 params as on the homepage). Without JS it opens the image.
 */
export function shotLink(o: { slug: string; name: string; week: string; device: "desktop" | "mobile"; url: string; group: string }, img: string): string {
  const device = o.device === "mobile" ? "Mobile" : "Desktop";
  const file = `${o.slug}-${o.week}${o.device === "mobile" ? "-mobile" : ""}`;
  const label = `Open the ${o.name} ${o.device} screenshot, week of ${weekInWords(o.week)}, full size`;
  return `<a class="shot-link" href="${esc(o.url)}" aria-label="${esc(label)}" data-full="${esc(o.url)}" data-lb-group="${esc(o.group)}" data-title="${esc(o.name)}" data-caption="${esc(`${o.name} · ${device} · week of ${weekInWords(o.week)}`)}" data-file="${esc(file)}" data-ga-image="${esc(`${o.slug}-${o.week}-${o.device}`)}" data-ga-source="weekly_capture" data-ga-portal="${esc(o.slug)}" data-ga-week="${esc(o.week)}" data-ga-device="${o.device}">${img}</a>`;
}

/** The lightbox's stylesheet and script, for page({ lightbox: true }). */
const LIGHTBOX_HEAD = `  <link rel="stylesheet" href="/lightbox.css" />
`;
const LIGHTBOX_SCRIPT = `  <!-- Screenshots open large in the lightbox, as on the homepage. -->
  <script type="module">import { initLightbox } from "/lightbox.js"; initLightbox();</script>
`;

export function page(opts: { title: string; description: string; canonical?: string; noindex?: boolean; image?: PreviewImage; jsonLd?: unknown; markdown?: string; head?: string; lightbox?: boolean; consent: ConsentMode; body: string }): string {
  return `<!doctype html>
<html lang="en" data-consent="${opts.consent}">
<head>
  <meta charset="utf-8" />
  <!-- Analytics load only as public/consent.js allows (region, stored choice, Global Privacy Control). -->
  <script src="/consent.js" defer></script>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- html.js: on phones the top-bar links sit behind the menu button from the first paint; without JS they stay visible. -->
  <script>document.documentElement.classList.add("js")</script>
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}" />
  <meta name="robots" content="${opts.noindex ? "noindex" : "max-image-preview:large"}" />
${opts.canonical ? socialMeta(opts.title, opts.description, opts.canonical, opts.image ?? SITE_PREVIEW) : ""}${opts.jsonLd ? jsonLdScript(opts.jsonLd) : ""}  <link rel="alternate" type="application/rss+xml" title="AI Interface Library" href="${FEED_URL}" />
${opts.markdown ? `  <link rel="alternate" type="text/markdown" href="${esc(opts.markdown)}" />\n` : ""}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <!-- Body text font (all weights in one file): fetch it before CSS discovers it, as the homepage does. -->
  <link rel="preload" href="/fonts/space-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="/fonts/fonts.css" />
  <!-- The site's shared buttons (.btn-primary, .btn-secondary), as on the homepage. -->
  <link rel="stylesheet" href="/buttons.css" />
  <style>
    /* The homepage's fonts (public/styles.css --font-sans, --font-mono): Space Grotesk for text, headings and controls. */
    body{margin:0;font:16px/1.6 'Space Grotesk','Inter',system-ui,-apple-system,sans-serif;background:#f4efe8;color:#231f1a}
    :where(a,button,summary,[tabindex]):focus-visible{outline:2px solid var(--brand);outline-offset:2px}
    .wrap{max-width:1000px;margin:0 auto;padding:24px 16px}
    a{color:inherit}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .wordmark{display:inline-flex;align-items:center;gap:9px;min-width:0;font-size:14px;font-weight:700;letter-spacing:.02em;text-decoration:none}
    .wordmark-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 14%,transparent)}
    .wordmark-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .topnav{display:flex;gap:20px;flex:0 0 auto;white-space:nowrap}
    /* A 32px-tall hit area; the negative margin keeps the bar's height as it was. */
    .topnav-link{display:inline-flex;align-items:center;min-height:32px;margin-block:-6px;font-size:13px;font-weight:500;color:#6b6257;text-decoration:none;transition:color .15s ease-out}
    .topnav-link.active{color:var(--brand-text)}
    @media (hover:hover){.topnav-link:not(.active):hover{color:#231f1a}}
    @media (max-width:760px){.wordmark{font-size:12px}.topnav{gap:14px}.topnav-link{font-size:12px}}
    @media (max-width:420px){.topbar{gap:8px}.wordmark{font-size:12px;gap:7px}.topnav{gap:8px}.topnav-link{font-size:11px}} /* the homepage's values at this width */
    /* Phones: the menu button and panel, as on the homepage (public/styles.css), with this page's colours as fallbacks. */
    .topnav-toggle{display:none}
    @media (max-width:640px){
      html:not(.js) .topbar{flex-wrap:wrap}
      html:not(.js) .topnav{width:100%;flex-wrap:wrap}
      html.js .topbar{position:relative;z-index:10}
      html.js .topnav-toggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:40px;height:40px;padding:0;border:1px solid var(--cf-border,#d8cfc2);border-radius:8px;background:transparent;color:var(--cf-text,#231f1a);cursor:pointer;transition:background-color .15s ease-out,transform 160ms ease-out}
      html.js .topnav-toggle:hover,html.js .topnav-toggle:active{background:var(--cf-bg-300,#ded4c6)}
      html.js .topnav-toggle:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
      .topnav-toggle[aria-expanded="true"] .topnav-toggle-open,.topnav-toggle[aria-expanded="false"] .topnav-toggle-close{display:none}
      /* Full width: the bar sits inside .wrap's 16px side padding. */
      html.js .topnav{position:absolute;top:calc(100% + 8px);left:-16px;right:-16px;flex-direction:column;gap:0;white-space:normal;background:var(--cf-bg-100,#f5f1e9);border-bottom:1px solid var(--cf-border,#d8cfc2);box-shadow:0 16px 32px -20px rgba(35,31,26,.35);opacity:0;transform:translateY(-6px);visibility:hidden;transition:opacity .15s ease-out,transform .15s ease-out,visibility 0s linear .15s}
      html.menu-open .topnav{opacity:1;transform:none;visibility:visible;transition:opacity .15s ease-out,transform .15s ease-out,visibility 0s}
      html.js .topnav-link{display:flex;align-items:center;height:48px;margin:0;padding:0 16px;font-size:13px}
    }
    @media (max-width:640px) and (prefers-reduced-motion:reduce){html.js .topnav{transition:none}}
    @media (max-width:640px) and (prefers-reduced-motion:no-preference){html.js .topnav-toggle:active{transform:scale(.97)}}
    h1{font-size:2rem;margin:24px 0 4px}
    .meta{color:#6b6257;margin:0 0 24px}
    .shots{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
    .shots figure{margin:0}
    .shots img{max-width:100%;height:auto;border:1px solid #d8cfc2;border-radius:8px;background:#fff}
    .weeknav{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 24px;font-size:.95rem}
    .desktop{flex:1 1 560px}.mobile{flex:0 1 240px}
    figcaption{font-size:.85rem;color:#6b6257;margin-top:6px}
    .analysis{white-space:pre-line;margin:32px 0}
    .timeline{margin:32px 0}
    .timeline ul{padding-left:1.25em;margin:0}
    .timeline li{margin:0 0 6px}
    .method{font-size:.85rem;color:#6b6257}
    .compare-with{margin:32px 0}
    .compare-with ul{padding-left:1.25em;margin:0}
    .compare-with li{margin:0 0 6px}
    .howto h2{font-size:1.25rem;margin:32px 0 8px}
    .howto ul{padding-left:1.25em}
    .howto li{margin:0 0 6px}
    footer{border-top:1px solid #d8cfc2;margin-top:48px;padding-top:16px;font-size:.85rem;color:#6b6257}
    .legal{margin-top:4px}
    .linkbtn{background:none;border:0;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer}
    .linkbtn:hover{color:#231f1a}
    .site-dialog{width:min(480px,calc(100vw - 32px));max-width:none;padding:0;border:1px solid #d8cfc2;border-radius:12px;background:#fffdf9;color:#231f1a;font-size:1rem;box-shadow:0 16px 48px -16px rgba(35,31,26,.35)}
    .site-dialog::backdrop{background:rgba(35,31,26,.45)}
    .site-dialog form{position:relative;padding:24px 20px 20px}
    .site-dialog h2{font-size:1.25rem;margin:0 40px 12px 0}
    .site-dialog p{margin:0 0 12px}
    .site-dialog-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:8px;background:none;color:#6b6257;font-size:1.5rem;line-height:1;cursor:pointer}
    .site-dialog-x:hover{background:#f4efe8;color:#231f1a}
    .site-dialog-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:16px}
    .site-dialog-close{font:inherit;padding:8px 16px;border:1px solid #d8cfc2;border-radius:8px;background:#f4efe8;color:#231f1a;cursor:pointer}
    .site-dialog-close:hover{border-color:#6b6257}
    .contact-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
    .contact-address{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.95rem;padding:6px 10px;border:1px solid #d8cfc2;border-radius:8px;background:#f4efe8;user-select:all;overflow-wrap:anywhere}
    .contact-copy{font:inherit;font-size:.9rem;min-width:5.5em;padding:6px 12px;border:1px solid #d8cfc2;border-radius:8px;background:#fffdf9;color:#231f1a;cursor:pointer}
    .contact-copy:hover{border-color:#6b6257}
    .contact-mail{display:inline-flex;align-items:center;padding:8px 16px;border-radius:8px;background:#231f1a;color:#fffdf9;text-decoration:none}
    .contact-mail:hover{background:#3a332b}
    .shot-link{display:block;border-radius:8px;cursor:zoom-in}
    .shot-link img{display:block}
  </style>
${opts.lightbox ? LIGHTBOX_HEAD : ""}${opts.head ?? ""}</head>
<body>
  <div class="wrap">
${siteHeader()}
${opts.body}
    <footer>Independent personal project. Not affiliated with any of the companies featured.
${FOOTER_LEGAL}
    </footer>
  </div>
  <script src="/footer-dialogs.js" defer></script>
  <script src="/site-menu.js" defer></script>
  <!-- GA4 events for the Compare links (sent only when consent.js has loaded gtag). -->
  <script src="/track.js" type="module"></script>
${opts.lightbox ? LIGHTBOX_SCRIPT : ""}</body>
</html>`;
}

function notFound(request: Request): Response {
  const html = page({
    consent: consentMode(request),
    title: "Portal not found | AI Interface Library",
    description: "This portal page does not exist.",
    noindex: true,
    body: `    <main><h1>Portal not found</h1><p><a href="/">Browse the AI Interface Library</a></p></main>`,
  });
  return new Response(html, { status: 404, headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE } });
}

/**
 * The Compare page (public/index.html) in Single portal mode, Canvas, desktop, for one portal and two weeks (newer first),
 * in the same format as its Copy link button (buildAnalyticsHash in public/analytics-share.js), so it opens as a shared link.
 */
export function compareWeeksHash(slug: string, weeks: [string, string]): string {
  return `#compare?view=canvas&mode=time&portal=${encodeURIComponent(slug)}&weeks=${weeks.map(encodeURIComponent).join(",")}&device=desktop`;
}

/**
 * The two weeks a portal page compares: the shown week and the nearest newer one (the "Next week" link), newer first.
 * The hub and the latest week have no newer week, so they use the nearest older one (the "Previous week" link).
 * Null with fewer than two captures.
 */
export function compareWeeks(curWeek: string | null, prevWeek: string | null, nextWeek: string | null): [string, string] | null {
  if (!curWeek) return null;
  if (nextWeek) return [nextWeek, curWeek];
  if (prevWeek) return [curWeek, prevWeek];
  return null;
}

/**
 * Portal pages with a Compare button: it sits at the right end of the week links' row (on its own line, left-aligned,
 * when the row wraps). A .btn-secondary (public/buttons.css): a link, not a selection, so not the dark selected fill.
 */
const COMPARE_HEAD = `  <style>
    .weeknav-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:0 0 24px}
    .weeknav-row.solo{justify-content:flex-end}
    .weeknav-row .weeknav{margin:0}
  </style>
`;

/** True for a real calendar date written YYYY-MM-DD. */
function isValidWeek(w: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) return false;
  const d = new Date(w + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === w;
}

export async function handlePortalPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(request.url);
  // "/portals/<slug>.md" and "/portals/<slug>/<week>.md" are the Markdown versions of the same pages.
  const markdown = url.pathname.endsWith(".md");
  let parts: string[];
  try { parts = url.pathname.replace(/^\/portals\//, "").replace(/\.md$/, "").replace(/\/$/, "").split("/").map(decodeURIComponent); } catch { return notFound(request); }
  if (parts.length < 1 || parts.length > 2) return notFound(request);
  const slug = parts[0];
  const weekParam = parts.length === 2 ? parts[1] : null;
  if (!/^[a-z0-9-]+$/.test(slug)) return notFound(request);
  if (weekParam !== null && !isValidWeek(weekParam)) return notFound(request);

  const portal = await getPortal(env, slug);
  if (!portal || !portal.active) return notFound(request);

  const cap: CaptureRow | null = weekParam === null
    ? await latestCaptureForPortal(env, slug)
    : await captureForPortalWeek(env, slug, weekParam);
  // A weekly URL must have a successful capture; the bare portal URL still renders an empty state.
  if (weekParam !== null && !cap) return notFound(request);

  const weeks = await captureWeeksForPortal(env, slug); // newest first
  const latestWeek = weeks[0] ?? null;
  const curWeek = cap?.week ?? null;
  const prevWeek = curWeek ? weeks.find((w) => w < curWeek) ?? null : null; // nearest older
  const nextWeek = curWeek ? [...weeks].reverse().find((w) => w > curWeek) ?? null : null; // nearest newer
  const isLatest = !!curWeek && curWeek === latestWeek;
  const compareHash = (() => { const w = compareWeeks(curWeek, prevWeek, nextWeek); return w ? compareWeeksHash(slug, w) : null; })();
  // Every weekly page is its own canonical (and sitemap) URL, so it stays stable when a newer week arrives.
  const canonical = weekParam !== null ? `${ORIGIN}/portals/${slug}/${weekParam}` : `${ORIGIN}/portals/${slug}`;

  const name = portal.name;
  // Meta description: guideline analyses only. The section text also shows the system-test note.
  const analysis = cap && isPublishedAnalysis(cap) ? cap.analysis.trim() : "";
  // Weekly pages with a published analysis describe it in its own words (meta, og and twitter).
  const summary = weekParam !== null && cap ? summaryDescription(cap) : null;
  const aliases = PORTAL_ALIASES[slug] ?? [];
  // The hub's "How the <Name> UI changed" timeline: recorded menu changes of this portal only.
  const timeline = weekParam === null ? timelineWeeks((await changes(env)).filter((e) => e.slug === slug)) : [];
  const description = weekParam === null
    ? hubDescription(name, aliases, timeline.length > 0, cap?.week ?? null)
    : summary ?? shortText(`${name} UI screenshots by ${portal.company} from the week of ${weekInWords(weekParam)}, on desktop and mobile, with a short design analysis of the interface. ${analysis}`, 300);

  let shots = "";
  const shotImages: { device: "Desktop" | "Mobile"; url: string; alt: string; width: number; height: number }[] = []; // also described in JSON-LD and Markdown
  if (cap) {
    const desktop = shotUrl(cap.r2_key, slug, cap.captured_at);
    const d = desktopSize(cap);
    const dAlt = shotAlt(name, "desktop", cap.week);
    shotImages.push({ device: "Desktop", url: desktop, alt: dAlt, ...d });
    shots += `      <figure class="desktop">${shotLink({ slug, name, week: cap.week, device: "desktop", url: desktop, group: "shots" }, `<img src="${esc(desktop)}" alt="${esc(dAlt)}" width="${d.width}" height="${d.height}" loading="eager" />`)}<figcaption>Desktop &middot; week of ${esc(weekInWords(cap.week))}</figcaption></figure>\n`;
    if (cap.r2_key_mobile) {
      const mobile = shotUrl(cap.r2_key_mobile, slug, cap.captured_at);
      const m = (await mobileSize(env, cap)) ?? MOBILE_CAPTURE_SIZE;
      const mAlt = shotAlt(name, "mobile", cap.week);
      shotImages.push({ device: "Mobile", url: mobile, alt: mAlt, ...m });
      shots += `      <figure class="mobile">${shotLink({ slug, name, week: cap.week, device: "mobile", url: mobile, group: "shots" }, `<img src="${esc(mobile)}" alt="${esc(mAlt)}" width="${m.width}" height="${m.height}" loading="lazy" />`)}<figcaption>Mobile &middot; week of ${esc(weekInWords(cap.week))}</figcaption></figure>\n`;
    }
  }

  const navLinks: string[] = [];
  if (prevWeek) navLinks.push(`<a href="/portals/${esc(slug)}/${esc(prevWeek)}" rel="prev">&larr; Previous week (${esc(prevWeek)})</a>`);
  if (nextWeek) navLinks.push(nextWeek === latestWeek
    ? `<a href="/portals/${esc(slug)}" rel="next">Next week (${esc(nextWeek)}) &rarr;</a>`
    : `<a href="/portals/${esc(slug)}/${esc(nextWeek)}" rel="next">Next week (${esc(nextWeek)}) &rarr;</a>`);
  if (latestWeek && !isLatest) navLinks.push(`<a href="/portals/${esc(slug)}">Latest (${esc(latestWeek)})</a>`);
  const nav = navLinks.length ? `<nav class="weeknav" aria-label="${esc(name)} weekly captures">${navLinks.join(" ")}</nav>` : "";
  const compareLink = compareHash
    ? `<a class="btn-secondary compare-cta" href="/${esc(compareHash)}" aria-label="Compare ${esc(name)} week by week">Compare <span class="arrow" aria-hidden="true">&rarr;</span></a>`
    : "";
  // Compare shares the week links' row, at its right end (alone on the right when there are no week links).
  const weekNav = compareLink
    ? `      <div class="weeknav-row${nav ? "" : " solo"}">\n${nav ? `        ${nav}\n` : ""}        ${compareLink}\n      </div>\n`
    : nav ? `      ${nav}\n` : "";

  const timelineHtml = weekParam !== null ? "" : `      <section class="timeline"><h2>How the ${esc(name)} UI changed</h2>
${timeline.length
    ? `        <ul>\n${timeline.map((w) => `          <li><a href="/portals/${esc(slug)}/${esc(w.week)}">${esc(weekInWords(w.week))}</a> \u2014 ${esc(w.phrases.join("; "))}</li>`).join("\n")}\n        </ul>`
    : `        <p>No menu changes have been recorded for ${esc(name)} yet.</p>`}
      </section>\n`;

  // "Compare with …": this portal's pair pages with the most compared products (src/compare.ts), skipping itself.
  const partners = (await Promise.all(POPULAR_PAIRINGS.filter((s) => s !== slug).map((s) => getPortal(env, s))))
    .filter((x): x is NonNullable<typeof x> => !!x && !!x.active)
    .slice(0, COMPARE_WITH_LINKS);
  const compareWith = partners.length
    ? `\n      <nav class="compare-with" aria-label="Compare ${esc(name)} with other products"><h2>Compare with other products</h2>
        <ul>
${partners.map((x) => `          <li><a href="${esc(comparePath(slug, x.slug))}">Compare with ${esc(x.name)}</a></li>`).join("\n")}
        </ul>
      </nav>`
    : "";

  // "Le Chat by Mistral AI · also called LeChat" for portals with an alias, otherwise just the company.
  const byline = aliases[0] ? `${name} by ${portal.company} \u00b7 also called ${aliases[0]}` : portal.company;
  const body = `    <main>
      <h1>${esc(name)}</h1>
      <p class="meta">${esc(byline)}${cap ? ` &middot; captured week of ${esc(weekInWords(cap.week))}` : ""}</p>
${weekNav}${cap ? `      <section class="shots" aria-label="${esc(name)} screenshots">\n${shots}      </section>
${timelineHtml}      <section class="analysis"><h2>Design analysis</h2><p>${esc(displayedAnalysis(cap))}</p><p class="method"><a href="/how-we-analyze">How this analysis is made</a></p></section>` : `      <p>No captures yet for ${esc(name)}.</p>\n${timelineHtml.replace(/\n$/, "")}`}${compareWith}
    </main>`;

  if (markdown) {
    const md = portalMarkdown({
      name, company: portal.company, canonical, cap, timeline: weekParam === null ? timeline : null, slug,
      compareWith: partners.map((x) => ({ name: x.name, url: `${ORIGIN}${comparePath(slug, x.slug)}` })),
      compare: compareHash ? `${ORIGIN}/${compareHash}` : null,
      shots: shotImages.map((img) => ({ device: img.device, url: img.url.startsWith("/") ? `${ORIGIN}${img.url}` : img.url })),
    });
    const headers: Record<string, string> = { ...MARKDOWN_HEADERS, "cache-control": "public, max-age=3600", link: `<${canonical}>; rel="canonical"` };
    if (cap && SYSTEM_TEST_WEEKS.includes(cap.week)) headers["x-robots-tag"] = "noindex";
    return new Response(request.method === "HEAD" ? null : md, { headers });
  }

  // Link preview: this page's desktop screenshot (the hub shows its latest week); the site image if there is none yet.
  const image: PreviewImage | undefined = cap?.r2_key
    ? { url: `${ORIGIN}${shotUrl(cap.r2_key, slug, cap.captured_at)}`, ...desktopSize(cap), alt: shotAlt(name, "desktop", cap.week) }
    : undefined;

  // Structured data: the breadcrumb trail (names as shown on the page) and each screenshot shown.
  const hubUrl = `${ORIGIN}/portals/${slug}`;
  const crumbs = [
    { name: "AI Interface Library", item: `${ORIGIN}/` }, // the header's wordmark, back to the homepage
    { name, item: hubUrl },
    ...(weekParam !== null ? [{ name: `Week of ${weekInWords(weekParam)}`, item: canonical }] : []),
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })),
      },
      ...shotImages.map((img) => ({
        "@type": "ImageObject",
        contentUrl: img.url.startsWith("/") ? `${ORIGIN}${img.url}` : img.url,
        caption: img.alt,
        width: img.width,
        height: img.height,
      })),
      // The published analysis, about the product it describes.
      ...(cap && analysis && cap.analysis_published_at ? [{
        "@type": "Article",
        headline: `${name} interface — week of ${weekInWords(cap.week)}`,
        datePublished: cap.analysis_published_at,
        dateModified: cap.analysis_published_at,
        ...(image ? { image: image.url } : {}),
        about: { "@type": "SoftwareApplication", name, ...(aliases.length ? { alternateName: aliases } : {}), publisher: { "@type": "Organization", name: portal.company } },
      }] : []),
      // The page itself, dated by the week it shows.
      ...(cap ? [{
        "@type": "WebPage",
        "@id": canonical,
        url: canonical,
        name: weekParam !== null ? `${name} UI \u2014 week of ${weekInWords(weekParam)}` : hubTitle(name),
        dateModified: cap.week,
      }] : []),
    ],
  };

  const html = page({
    consent: consentMode(request),
    image,
    jsonLd,
    title: (weekParam !== null ? `${name} UI \u2014 week of ${weekInWords(weekParam)}` : hubTitle(name)) + BRAND,
    description,
    canonical,
    markdown: `${canonical}.md`,
    noindex: !!cap && SYSTEM_TEST_WEEKS.includes(cap.week),
    head: compareHash ? COMPARE_HEAD : undefined,
    lightbox: shotImages.length > 0,
    body,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

const HOW_WE_ANALYZE = `    <main class="howto">
      <h1>How we analyze</h1>
      <p>Each week, this site captures the screen of each AI product right after signing in, on a desktop screen 1280 by 800 pixels, before scrolling. Each screenshot then gets a short design analysis.</p>
      <h2>What we look at</h2>
      <ul>
        <li>Layout: where the main areas sit, such as the sidebar and the message box, and how much of the screen they take.</li>
        <li>What stands out most: which items carry the most visual weight, based on their size and contrast.</li>
        <li>Text and color: whether text is light or dark enough against its background to meet common accessibility guidelines.</li>
        <li>Where you start: the message box, suggested prompts, and whether the product says it can make mistakes.</li>
      </ul>
      <h2>How we measure</h2>
      <p>Colors, contrast and sizes are measured from the screenshot pixels with a script, using the contrast formula from the Web Content Accessibility Guidelines (WCAG 2.2). Other observations, such as what stands out most, are made by an AI model following a fixed checklist. A person reviews every analysis before it is published.</p>
      <h2>What we don&#39;t claim</h2>
      <p>An analysis only describes what is visible in one screenshot. It does not judge whether a product is easy to use, predict what people will do, or certify that a product meets accessibility standards. Measurements taken from a screenshot are close estimates, not official test results. Mobile screenshots are shown but not analyzed.</p>
      <h2>Week-to-week changes</h2>
      <p>When the previous week&#39;s analysis exists, the two weeks are compared. Differences that could come from the account, the time of day or a rotating greeting are not reported as redesigns.</p>
      <h2>Special cases</h2>
      <p>Kimi is captured while signed out, because no account is used for it. Muse always opens on a conversation, so only the interface around it is analyzed.</p>
      <h2>Privacy</h2>
      <p>Screenshots come from real accounts. Names, conversation titles and other account details are left out of every analysis, and are covered in the screenshots where possible.</p>
      <h2>Reusing the analyses</h2>
      <p>The design analysis text and the menu change records can be reused under CC BY 4.0, with credit to AI Interface Library. Screenshots and product names are not covered. <a href="/license">See the license</a></p>
      <h2>Sources</h2>
      <ul>
        <li><a href="https://www.w3.org/TR/WCAG22/">W3C, Web Content Accessibility Guidelines (WCAG) 2.2</a></li>
        <li><a href="https://www.nngroup.com/articles/visual-hierarchy-ux-definition/">Nielsen Norman Group, visual hierarchy in UX</a></li>
        <li><a href="https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/">Microsoft Research, Guidelines for Human-AI Interaction (Amershi et al., CHI 2019)</a></li>
      </ul>
    </main>`;

/** Last content change of /how-we-analyze (YYYY-MM-DD), for its sitemap <lastmod>. Update it with the text. */
export const HOW_WE_ANALYZE_UPDATED = "2026-10-10";

/** /how-we-analyze: how the weekly screenshots and design analyses are made. */
export function handleHowWeAnalyze(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const html = page({
    consent: consentMode(request),
    title: "How we analyze | AI Interface Library",
    description: "How AI Interface Library captures AI product screens each week and analyzes their layout, visual hierarchy, text contrast and starting points, and what the analysis does not claim.",
    canonical: `${ORIGIN}/how-we-analyze`,
    body: HOW_WE_ANALYZE,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

/** Last content change of /license (YYYY-MM-DD): shown on the page and used as its sitemap <lastmod>. */
export const LICENSE_UPDATED_DATE = "2026-10-10";
export const LICENSE_URL = `${ORIGIN}/license`;

const LICENSE = `    <main class="howto">
      <h1>License</h1>
      <p class="meta">Last updated: ${weekInWords(LICENSE_UPDATED_DATE)}</p>
      <h2>Analyses and menu changes: CC BY 4.0</h2>
      <p>The design analysis text and the records of menu changes on this site are licensed under the <a href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0 International license (CC BY 4.0)</a>. You may copy, share and adapt them for any purpose, including commercial use, as long as you give credit.</p>
      <h2>How to give credit</h2>
      <p>Name AI Interface Library and link to the page you used, or to <a href="${ORIGIN}/">${ORIGIN}/</a>. For example: &quot;Source: AI Interface Library, ${ORIGIN}/changes, CC BY 4.0.&quot;</p>
      <h2>What this license does not cover</h2>
      <p>Screenshots, product names, logos and trademarks belong to their respective companies and are not covered by this license. AI Interface Library is an independent project and is not affiliated with any of these companies.</p>
      <h2>Questions</h2>
      <p>For questions about reuse, email <a href="mailto:contact@ai-portal-library.dev">contact@ai-portal-library.dev</a>.</p>
    </main>`;

/** /license: what may be reused (analyses and menu changes, CC BY 4.0) and what may not (screenshots, names, trademarks). */
export function handleLicense(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const html = page({
    consent: consentMode(request),
    title: "License | AI Interface Library",
    description: "The design analyses and menu change records on AI Interface Library are licensed under CC BY 4.0. Screenshots, product names and trademarks belong to their companies and are not covered.",
    canonical: LICENSE_URL,
    body: LICENSE,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

export const CHANGELOG_URL = `${ORIGIN}/changelog`;

/** Changelog layout: date column with a dot on a connecting line, entry on the right; the date stacks above the title on phones. The page title is larger than the entry titles. Colors match page(); the accent is the site orange (--brand, public/buttons.css). */
const CHANGELOG_HEAD = `  <style>
    .changelog h1{font-size:48px;line-height:1.05;letter-spacing:-.03em}
    .changelog .meta{font-size:1.05rem}
    .cl{list-style:none;margin:56px 0 0;padding:0}
    .cl-entry{position:relative;display:grid;grid-template-columns:220px minmax(0,1fr);padding-bottom:64px;scroll-margin-top:24px}
    .cl-entry:last-child{padding-bottom:0}
    .cl-entry::before{content:"";position:absolute;left:0;top:8px;width:9px;height:9px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 4px #f4efe8;z-index:1}
    .cl-entry:not(:last-child)::after{content:"";position:absolute;left:4px;top:12px;bottom:-12px;width:1px;background:#d8cfc2}
    .cl-when{display:flex;flex-direction:column;padding:0 24px}
    .cl-date{font-weight:700;line-height:1.6}
    .cl-time{font-size:.85rem;color:#6b6257}
    .cl-body{font-size:18px;line-height:1.6;min-width:0}
    .cl-body h2{font-size:32px;line-height:1.15;letter-spacing:-.02em;font-weight:700;margin:0;overflow-wrap:anywhere}
    .cl-anchor{margin-left:12px;font-size:18px;font-weight:600;letter-spacing:0;color:var(--brand-text);text-decoration:none;vertical-align:middle}
    .cl-anchor:hover,.cl-anchor:focus-visible{text-decoration:underline}
    .cl-copied{margin-left:8px;font-size:.8rem;font-weight:500;letter-spacing:0;color:#6b6257;vertical-align:middle}
    .cl-body .cl-sub{margin:10px 0 24px;font-style:italic;color:#6b6257}
    .cl-body ul{list-style:disc;margin:0 0 24px;padding-left:1.2em}
    .cl-body li{margin:0 0 8px}
    .cl-body li::marker{color:#6b6257}
    .cl-body p{margin:0}
    @media (max-width:720px){
      .cl{margin-top:40px}
      .cl-entry{grid-template-columns:minmax(0,1fr);padding-left:24px;padding-bottom:56px}
      .cl-when{flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:0 10px;padding:0;margin-bottom:8px}
      .changelog h1{font-size:40px}
      .cl-body h2{font-size:26px}
    }
  </style>
`;

/** Clicking an entry's "#" also copies its /changelog#<slug> URL. */
const CHANGELOG_SCRIPT = `  <script>
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".cl-anchor");
      if (!a || !navigator.clipboard) return;
      navigator.clipboard.writeText(a.href).then(function () {
        var note = a.nextElementSibling;
        note.textContent = "Link copied";
        clearTimeout(note._t);
        note._t = setTimeout(function () { note.textContent = ""; }, 2000);
      }, function () {});
    });
  </script>
`;

function changelogEntry(e: ChangelogEntry): string {
  const time = e.time ? `\n          <span class="cl-time">${esc(e.time)} &middot; ${esc(utcOffsetLabel())}</span>` : "";
  return `      <li class="cl-entry" id="${esc(e.slug)}">
        <time class="cl-when" datetime="${esc(changelogDatetime(e))}">
          <span class="cl-date">${esc(changelogDate(e.date))}</span>${time}
        </time>
        <div class="cl-body">
          <h2>${esc(e.title)}<a class="cl-anchor" href="/changelog#${esc(e.slug)}" aria-label="Link to ${esc(e.title)}">#</a><span class="cl-copied" aria-live="polite"></span></h2>
          <p class="cl-sub">${esc(e.subtitle)}</p>
          <ul>
${e.bullets.map((b) => `            <li><strong>${esc(b.lead)}:</strong> ${esc(b.text)}</li>`).join("\n")}
          </ul>
          <p>${esc(e.closing)}</p>
        </div>
      </li>`;
}

/** /changelog: decisions and releases for the site (src/changelog.ts), newest first. Not /changes, which lists the products' menu changes. */
export function handleChangelog(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const html = page({
    consent: consentMode(request),
    title: "Changelog | AI Interface Library",
    description: "Decisions and releases for AI Interface Library, newest first.",
    canonical: CHANGELOG_URL,
    head: CHANGELOG_HEAD,
    body: `    <main class="changelog">
      <h1>Changelog</h1>
      <p class="meta">Decisions and releases for AI Interface Library.</p>
      <ol class="cl">
${CHANGELOG.map(changelogEntry).join("\n")}
      </ol>
    </main>
${CHANGELOG_SCRIPT}`,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

/** Last content change of /privacy (YYYY-MM-DD): shown on the page and used as its sitemap <lastmod>. */
export const PRIVACY_UPDATED_DATE = "2026-09-27";
export const PRIVACY_UPDATED = weekInWords(PRIVACY_UPDATED_DATE);

const PRIVACY = `    <main class="howto">
      <h1>Privacy</h1>
      <p class="meta">Last updated: ${PRIVACY_UPDATED}</p>
      <h2>Who runs this site</h2>
      <p>AI Interface Library (ai-portal-library.dev) is an independent personal project run by one person. It is not a company and is not affiliated with any of the products it shows.</p>
      <h2>The short version</h2>
      <ul>
        <li>There are no accounts and no sign-ups.</li>
        <li>There are no ads, and your data is never sold.</li>
        <li>Google Analytics and Microsoft Clarity show how the site is used. You can turn them off at any time.</li>
        <li>Cloudflare Web Analytics also counts page views, without cookies.</li>
      </ul>
      <h2>Google Analytics</h2>
      <p>When analytics are allowed, the site loads Google Analytics. It records the pages you view, the site you came from, your browser, device type, screen size and language, your approximate location based on your IP address, and simple actions such as scrolling and clicks on links to other sites. It sets cookies whose names start with _ga to recognize return visits. Advertising features are turned off.</p>
      <h2>Microsoft Clarity</h2>
      <p>When analytics are allowed, the site also loads Microsoft Clarity. Clarity records how pages are used, such as clicks, taps, mouse movement and scrolling, so the visit can be replayed as a session recording and summarized as heatmaps. It also records your browser, device, screen size and approximate location based on your IP address. It sets cookies named _clck and _clsk to connect the pages of one visit, and Microsoft may set its own cookies on its domains.</p>
      <p>Clarity masks anything you type into a text box on this site, such as the search box or the voice guide&#39;s question box, so it is never sent to Microsoft. The voice guide&#39;s conversation panel is masked in full.</p>
      <h2>When Google Analytics and Clarity load</h2>
      <ul>
        <li>Visitors in the European Economic Area, the UK and Switzerland are asked first. Nothing loads until you choose Accept.</li>
        <li>Visitors elsewhere get analytics by default and can decline at any time with Cookie preferences at the bottom of every page.</li>
        <li>If your country can&#39;t be determined, you are asked first.</li>
        <li>If your browser sends a Global Privacy Control signal, analytics never load and you are not asked.</li>
        <li>Your choice is saved in your browser&#39;s local storage so the site remembers it. If you decline after accepting, analytics stop loading from the next page you open, and the site removes the Google Analytics and Clarity cookies it can reach. Clearing your browser&#39;s data for this site resets your choice.</li>
      </ul>
      <h2>The voice guide</h2>
      <p>The &quot;Talk to the library&quot; guide answers questions about the screenshots in the library. It connects only when you open it.</p>
      <ul>
        <li>Each browser tab has its own conversation, identified by a random code that is kept only in that tab. Other visitors can&#39;t see your questions or the answers, and your conversation is never used to answer anyone else.</li>
        <li>Questions you type are sent as text to this site&#39;s server, which runs on Cloudflare.</li>
        <li>If you start a call, your browser asks for microphone access first. While the call is on, your voice is streamed to this site&#39;s server, turned into text, answered, and read back to you. All three steps run on Cloudflare Workers AI, using Deepgram Flux for speech to text, OpenAI gpt-oss-120b for the answer and Deepgram Aura-1 for speech. This site does not save the audio.</li>
        <li>The text of your questions and the answers is saved with your conversation on Cloudflare, so the guide can follow up on what you asked before. It is deleted 24 hours after your last message.</li>
        <li>If analytics are allowed for you (see &quot;When Google Analytics and Clarity load&quot; above), the text of your questions, not the answers and not your voice, is also saved in a separate log that has no link to you or your conversation. Email addresses, phone numbers and long numbers are removed first. Only the date is kept, not the time. Entries are deleted after 360 days. The log is used only to improve the library.</li>
        <li>Please don&#39;t include personal information, such as your name, email address or phone number, in your questions.</li>
        <li>Nothing from the voice guide is sent to Google or Microsoft.</li>
      </ul>
      <h2>Hosting</h2>
      <p>The site is hosted on Cloudflare. Like any web host, Cloudflare processes your IP address and request details to deliver pages and protect the site from abuse, and keeps request logs for a short time. Fonts and product icons are served from this site, not from other companies.</p>
      <h2>Cloudflare Web Analytics</h2>
      <p>Cloudflare adds its Web Analytics script to every page, for every visitor. It counts page views and measures how quickly pages load, using the page address, the site you came from, your browser and device type, page load timings, and your country, which Cloudflare works out from your IP address. According to Cloudflare, it uses no cookies or local storage, does not fingerprint visitors or track them across sites, and does not collect or use visitors&#39; personal data.</p>
      <h2>Your choices</h2>
      <p>You can change your choice at any time with Cookie preferences at the bottom of every page. You can also block cookies in your browser or turn on Global Privacy Control. For questions or requests about your data, email <a href="mailto:contact@ai-portal-library.dev">contact@ai-portal-library.dev</a>.</p>
      <h2>Privacy statements from these services</h2>
      <ul>
        <li><a href="https://policies.google.com/privacy">Google Privacy Policy</a></li>
        <li><a href="https://policies.google.com/technologies/partner-sites">How Google uses information from sites that use its services</a></li>
        <li><a href="https://www.microsoft.com/privacy/privacystatement">Microsoft Privacy Statement</a></li>
        <li><a href="https://www.cloudflare.com/privacypolicy/">Cloudflare Privacy Policy</a></li>
        <li><a href="https://blog.cloudflare.com/privacy-first-web-analytics/">Cloudflare, privacy-first Web Analytics</a></li>
      </ul>
      <h2>Changes</h2>
      <p>When this page changes, the date at the top is updated.</p>
    </main>`;

/** /privacy: what the site and its analytics collect, and how to decline. */
export function handlePrivacy(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const html = page({
    consent: consentMode(request),
    title: "Privacy | AI Interface Library",
    description: "What AI Interface Library collects: Google Analytics and Microsoft Clarity only with your permission where required, what the voice guide sends, and how to decline at any time.",
    canonical: `${ORIGIN}/privacy`,
    body: PRIVACY,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

/** Sitemap: home, then every active portal's page and its weekly pages, leaving out the system-test weeks, then the indexable comparison pages. */
export async function handleSitemap(env: Env): Promise<Response> {
  const xml = await cached(env, "cache:sitemap", 300, async () => {
    const rows = (await sitemapCaptures(env)).filter((r) => !SYSTEM_TEST_WEEKS.includes(r.week)); // portal order, newest week first
    // Screenshots in R2 only (not the sample placeholders), at the same URLs the pages use.
    const images = (r: SitemapCapture) =>
      [r.r2_key, r.r2_key_mobile].filter((k): k is string => !!k).map((k) => `${ORIGIN}${shotUrl(k, r.slug, r.captured_at)}`);
    // <lastmod>: the newest capture or analysis publish that changed the page (W3C datetime, whole seconds).
    const changed = (r: SitemapCapture) => [r.captured_at, r.analysis_published_at].filter((t): t is string => !!t && !Number.isNaN(Date.parse(t))).map(Date.parse);
    const lastmod = (times: number[]) => (times.length ? new Date(Math.max(...times)).toISOString().replace(/\.\d{3}Z$/, "Z") : undefined);
    const bySlug = new Map<string, number[]>();
    for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), ...changed(r)]);
    const entries: { loc: string; lastmod?: string; images: string[] }[] = [
      { loc: `${ORIGIN}/`, lastmod: lastmod(rows.flatMap(changed)), images: [] },
      { loc: `${ORIGIN}/how-we-analyze`, lastmod: HOW_WE_ANALYZE_UPDATED, images: [] },
      { loc: `${ORIGIN}/privacy`, lastmod: PRIVACY_UPDATED_DATE, images: [] },
      { loc: LICENSE_URL, lastmod: LICENSE_UPDATED_DATE, images: [] },
    ];
    // /changes once it lists something, dated by its newest change.
    const changesMod = changesLastmod(await changes(env));
    if (changesMod) entries.push({ loc: `${ORIGIN}/changes`, lastmod: changesMod, images: [] });
    entries.push({ loc: CHANGELOG_URL, lastmod: CHANGELOG_UPDATED, images: [] });
    // Weekly digests (src/weeks.ts): the indexable weeks, and /weeks once it lists one.
    const digests = (await weekDigests(env)).filter((d) => d.indexable);
    if (digests.length) entries.push({ loc: `${ORIGIN}/weeks`, lastmod: digests.map((d) => d.lastmod).filter((t): t is string => !!t).sort().at(-1), images: [] });
    for (const d of digests) entries.push({ loc: `${ORIGIN}/weeks/${d.week}`, lastmod: d.lastmod, images: d.images.map((i) => `${ORIGIN}${shotUrl(i.key, i.slug, i.capturedAt)}`) });
    const seen = new Set<string>();
    for (const r of rows) {
      // The portal page shows its newest week, which is the first row for each portal.
      if (!seen.has(r.slug)) { seen.add(r.slug); entries.push({ loc: `${ORIGIN}/portals/${r.slug}`, lastmod: lastmod(bySlug.get(r.slug)!), images: images(r) }); }
      entries.push({ loc: `${ORIGIN}/portals/${r.slug}/${r.week}`, lastmod: lastmod(changed(r)), images: images(r) });
    }
    // Comparison pages with enough findings (src/compare.ts), with both desktop screenshots.
    for (const p of await indexablePairs(env)) {
      entries.push({ loc: `${ORIGIN}${comparePath(p.a, p.b)}`, lastmod: p.lastmod, images: p.images.map((i) => `${ORIGIN}${shotUrl(i.key, i.slug, i.capturedAt)}`) });
    }
    const entry = (e: { loc: string; lastmod?: string; images: string[] }) =>
      `  <url>\n    <loc>${esc(e.loc)}</loc>\n${e.lastmod ? `    <lastmod>${esc(e.lastmod)}</lastmod>\n` : ""}${e.images.map((i) => `    <image:image>\n      <image:loc>${esc(i)}</image:loc>\n    </image:image>\n`).join("")}  </url>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.map(entry).join("\n")}
</urlset>
`;
  });
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/** /feed.xml: one item per portal per week with a published analysis, newest first, each linked to its week's digest (/weeks/<week>). */
export async function handleFeed(env: Env): Promise<Response> {
  const xml = await cached(env, "cache:feed", 300, async () => {
    const rows = (await feedCaptures(env)).filter((r) => !SYSTEM_TEST_WEEKS.includes(r.week) && isPublishedAnalysis(r));
    const when = (r: { captured_at: string; analysis_published_at: string | null }) =>
      Math.max(...[r.captured_at, r.analysis_published_at].map((t) => Date.parse(t ?? "")).filter((n) => !Number.isNaN(n)));
    const items = rows.map((r) => {
      // The guid stays the portal's weekly page, so items already in readers keep their identity.
      const guid = `${ORIGIN}/portals/${r.slug}/${r.week}`;
      return `    <item>
      <title>${esc(`${r.name} interface — week of ${weekInWords(r.week)}`)}</title>
      <link>${esc(`${ORIGIN}/weeks/${r.week}`)}</link>
      <guid isPermaLink="true">${esc(guid)}</guid>
      <pubDate>${new Date(when(r)).toUTCString()}</pubDate>
      <description>${esc(feedSummary(r))}</description>
    </item>`;
    });
    const built = rows.length ? new Date(Math.max(...rows.map(when))).toUTCString() : null;
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Interface Library</title>
    <link>${ORIGIN}/</link>
    <description>${esc(FEED_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />
${built ? `    <lastBuildDate>${built}</lastBuildDate>\n` : ""}${items.join("\n")}${items.length ? "\n" : ""}  </channel>
</rss>
`;
  });
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/** Every recorded menu change, newest week first (cached like the sitemap and feed). */
export async function changes(env: Env): Promise<ChangeEntry[]> {
  return await cached(env, "cache:changes", 300, async () => changeEntries(await publishedCaptures(env)));
}

/** /changes sitemap <lastmod>: when the newest listed change was published (W3C datetime, whole seconds). */
function changesLastmod(entries: ChangeEntry[]): string | undefined {
  const times = entries.map((e) => Date.parse(e.publishedAt ?? "")).filter((n) => !Number.isNaN(n));
  return times.length ? new Date(Math.max(...times)).toISOString().replace(/\.\d{3}Z$/, "Z") : undefined;
}

/** "Week of October 5, 2026 — ChatGPT: the sidebar item Scheduled is now labeled Tasks." */
export function changeLine(e: ChangeEntry): string {
  return `Week of ${weekInWords(e.week)} \u2014 ${e.name}: ${e.sentence}`;
}

/** /changes: every menu change recorded in a published analysis, newest week first, each linked to its weekly page. */
export async function handleChanges(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const [entries, digests] = await Promise.all([changes(env), weekDigests(env)]);
  const latestDigest = latestIndexableWeek(digests);
  const url = (e: ChangeEntry) => `/portals/${e.slug}/${e.week}`;
  const list = entries.length
    ? `      <ul>\n${entries.map((e) => `        <li><a href="${esc(url(e))}">${esc(changeLine(e))}</a></li>`).join("\n")}\n      </ul>`
    : `      <p>No menu changes have been recorded yet.</p>`;
  const body = `    <main class="howto">
      <h1>Menu changes</h1>
      <p class="meta">Changes to the built-in menu items of AI products, from one weekly capture to the next.</p>
      <p>Each line comes from a published design analysis that compares a product&#39;s desktop screen with the week before. Only menu items that can be seen and clicked are compared, and changes that could come from the account, the plan or the interface language are left out. <a href="/how-we-analyze">How we analyze</a></p>
${latestDigest ? `      <p>Latest week: <a href="/weeks/${esc(latestDigest)}">AI interface changes, week of ${esc(weekShort(latestDigest))}</a> &middot; <a href="/weeks">All weeks</a></p>\n` : ""}${list}
    </main>`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Menu changes in AI product interfaces",
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    numberOfItems: entries.length,
    itemListElement: entries.map((e, i) => ({ "@type": "ListItem", position: i + 1, name: changeLine(e), url: `${ORIGIN}${url(e)}` })),
  };
  const html = page({
    consent: consentMode(request),
    title: "Menu changes in AI products, week by week | AI Interface Library",
    description: "Every change to the built-in menu items of AI products such as ChatGPT, Claude and Gemini, found by comparing weekly screenshots, newest first.",
    canonical: `${ORIGIN}/changes`,
    jsonLd,
    body,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

/** Markdown version of a portal page: the same facts as the HTML page, plus its menu items and menu changes. */
function portalMarkdown(o: { name: string; slug: string; company: string; canonical: string; cap: CaptureRow | null; timeline: TimelineWeek[] | null; shots: { device: string; url: string }[]; compare: string | null; compareWith: { name: string; url: string }[] }): string {
  const lines = [`# ${o.name}`, "", `- Company: ${o.company}`];
  // Hub only: the same "How the <Name> UI changed" list as the HTML page.
  const timeline = o.timeline === null ? [] : [`## How the ${o.name} UI changed`, "", ...(o.timeline.length
    ? o.timeline.map((w) => `- [${weekInWords(w.week)}](${ORIGIN}/portals/${o.slug}/${w.week}) \u2014 ${w.phrases.join("; ")}`)
    : [`No menu changes have been recorded for ${o.name} yet.`]), ""];
  const compareWith = o.compareWith.length ? ["## Compare with other products", "", ...o.compareWith.map((c) => `- [Compare with ${c.name}](${c.url})`), ""] : [];
  if (!o.cap) return [...lines, `- Page: ${o.canonical}`, "", `No captures yet for ${o.name}.`, "", ...timeline, ...compareWith].join("\n");
  const cap = o.cap;
  lines.push(`- Week: week of ${weekInWords(cap.week)} (${cap.week})`, `- Page: ${o.canonical}`, ...(o.compare ? [`- Compare week by week: ${o.compare}`] : []), "", "## Design analysis", "", displayedAnalysis(cap), "");

  const m = captureMetrics(cap);
  lines.push("## Menu items", "");
  if (m?.navItems?.length) {
    for (const region of ["sidebar", "top bar", "input area"] as const) {
      const items = m.navItems.filter((it) => it.region === region);
      if (items.length) lines.push(`- ${region[0].toUpperCase()}${region.slice(1)}: ${items.map(navItemName).join(", ")}`);
    }
    if (m.navSidebarVisible === false) lines.push("- The sidebar is collapsed in this capture, so its items are not listed.");
  } else {
    lines.push("No menu item data for this week.");
  }
  lines.push("", "## Menu changes", "");
  if (m?.navChanges) {
    const nc = m.navChanges;
    lines.push(nc.items.length
      ? `Compared with the week of ${weekInWords(nc.previousWeek)}:\n\n${nc.items.map((c) => `- ${navChangeSentence(c)[0].toUpperCase()}${navChangeSentence(c).slice(1)}`).join("\n")}`
      : `No menu changes compared with the week of ${weekInWords(nc.previousWeek)}.`);
  } else {
    lines.push("No menu comparison for this week.");
  }
  lines.push("", ...timeline, "## Screenshots", "", ...(o.shots.length ? o.shots.map((s) => `- ${s.device}: ${s.url}`) : ["No screenshots."]), "", ...compareWith);
  return lines.join("\n");
}

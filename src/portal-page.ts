import type { Env, CaptureRow } from "./types";
import { getPortal, latestCaptureForPortal, captureForPortalWeek, captureWeeksForPortal, sitemapCaptures } from "./db";
import { isPublishedAnalysis, displayedAnalysis, SYSTEM_TEST_WEEKS } from "./analysis";
import { cached } from "./api";
import { consentMode, PRIVATE_HTML_CACHE, type ConsentMode } from "./consent";

export const ORIGIN = "https://ai-portal-library.dev";
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function shotUrl(key: string | null, slug: string, capturedAt: string): string {
  if (!key) return `/samples/${slug}.svg`;
  return `/img/${key}?v=${Date.parse(capturedAt) || 0}`;
}

function shortText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/** Footer copyright line (with Privacy and Cookie preferences) + Disclaimer and Contact dialogs. The homepage (public/index.html) carries the same markup; both use /footer-dialogs.js. */
const FOOTER_LEGAL = `      <div class="legal">&copy; 2026 AI Interface Library. All rights reserved. &middot; <button type="button" class="linkbtn" data-dialog="disclaimer" aria-haspopup="dialog">Disclaimer</button> &middot; <button type="button" class="linkbtn" data-dialog="contact" aria-haspopup="dialog">Contact</button> &middot; <a href="/privacy">Privacy</a> &middot; <button type="button" class="linkbtn" data-consent-open>Cookie preferences</button></div>
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

function page(opts: { title: string; description: string; canonical?: string; noindex?: boolean; consent: ConsentMode; body: string }): string {
  return `<!doctype html>
<html lang="en" data-consent="${opts.consent}">
<head>
  <meta charset="utf-8" />
  <!-- Analytics load only as public/consent.js allows (region, stored choice, Global Privacy Control). -->
  <script src="/consent.js" defer></script>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}" />
${opts.noindex ? '  <meta name="robots" content="noindex" />\n' : ""}${opts.canonical ? `  <link rel="canonical" href="${esc(opts.canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="AI Interface Library" />
  <meta property="og:title" content="${esc(opts.title)}" />
  <meta property="og:description" content="${esc(opts.description)}" />
  <meta property="og:url" content="${esc(opts.canonical)}" />
  <meta property="og:image" content="${ORIGIN}/og-image.png" />
` : ""}  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>
    body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:#f4efe8;color:#231f1a}
    .wrap{max-width:1000px;margin:0 auto;padding:24px 16px}
    a{color:inherit}
    header a{font-weight:600;text-decoration:none}
    h1{font-size:2rem;margin:24px 0 4px}
    .meta{color:#6b6257;margin:0 0 24px}
    .shots{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
    .shots figure{margin:0}
    .shots img{max-width:100%;height:auto;border:1px solid #d8cfc2;border-radius:8px;background:#fff}
    .weeknav{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 24px;font-size:.95rem}
    .desktop{flex:1 1 560px}.mobile{flex:0 1 240px}
    figcaption{font-size:.85rem;color:#6b6257;margin-top:6px}
    .analysis{white-space:pre-line;margin:32px 0}
    .method{font-size:.85rem;color:#6b6257}
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
    .contact-address{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.95rem;padding:6px 10px;border:1px solid #d8cfc2;border-radius:8px;background:#f4efe8;user-select:all;overflow-wrap:anywhere}
    .contact-copy{font:inherit;font-size:.9rem;min-width:5.5em;padding:6px 12px;border:1px solid #d8cfc2;border-radius:8px;background:#fffdf9;color:#231f1a;cursor:pointer}
    .contact-copy:hover{border-color:#6b6257}
    .contact-mail{display:inline-flex;align-items:center;padding:8px 16px;border-radius:8px;background:#231f1a;color:#fffdf9;text-decoration:none}
    .contact-mail:hover{background:#3a332b}
  </style>
</head>
<body>
  <div class="wrap">
    <header><a href="/">&larr; AI Interface Library</a></header>
${opts.body}
    <footer>Independent personal project. Not affiliated with any of the companies featured.
${FOOTER_LEGAL}
    </footer>
  </div>
  <script src="/footer-dialogs.js" defer></script>
</body>
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

/** True for a real calendar date written YYYY-MM-DD. */
function isValidWeek(w: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) return false;
  const d = new Date(w + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === w;
}

export async function handlePortalPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(request.url);
  let parts: string[];
  try { parts = url.pathname.replace(/^\/portals\//, "").replace(/\/$/, "").split("/").map(decodeURIComponent); } catch { return notFound(request); }
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
  // Every weekly page is its own canonical (and sitemap) URL, so it stays stable when a newer week arrives.
  const canonical = weekParam !== null ? `${ORIGIN}/portals/${slug}/${weekParam}` : `${ORIGIN}/portals/${slug}`;

  const name = portal.name;
  // Meta description: guideline analyses only. The section text also shows the system-test note.
  const analysis = cap && isPublishedAnalysis(cap) ? cap.analysis.trim() : "";
  const description = shortText(
    weekParam !== null
      ? `${name} by ${portal.company}: logged-in interface screenshots, desktop and mobile, captured the week of ${weekParam}, with design analysis. ${analysis}`
      : `${name} by ${portal.company}: screenshots of the logged-in interface, desktop and mobile, with design analysis.${cap ? ` Latest capture: week of ${cap.week}.` : ""} ${analysis}`,
    300
  );

  let shots = "";
  if (cap) {
    const desktop = shotUrl(cap.r2_key, slug, cap.captured_at);
    shots += `      <figure class="desktop"><img src="${esc(desktop)}" alt="${esc(`${name} desktop interface screenshot (${cap.week})`)}" width="${cap.width || 1280}" loading="eager" /><figcaption>Desktop &middot; week of ${esc(cap.week)}</figcaption></figure>\n`;
    if (cap.r2_key_mobile) {
      const mobile = shotUrl(cap.r2_key_mobile, slug, cap.captured_at);
      shots += `      <figure class="mobile"><img src="${esc(mobile)}" alt="${esc(`${name} mobile interface screenshot (${cap.week})`)}" loading="lazy" /><figcaption>Mobile &middot; week of ${esc(cap.week)}</figcaption></figure>\n`;
    }
  }

  const navLinks: string[] = [];
  if (prevWeek) navLinks.push(`<a href="/portals/${esc(slug)}/${esc(prevWeek)}" rel="prev">&larr; Previous week (${esc(prevWeek)})</a>`);
  if (nextWeek) navLinks.push(nextWeek === latestWeek
    ? `<a href="/portals/${esc(slug)}" rel="next">Next week (${esc(nextWeek)}) &rarr;</a>`
    : `<a href="/portals/${esc(slug)}/${esc(nextWeek)}" rel="next">Next week (${esc(nextWeek)}) &rarr;</a>`);
  if (latestWeek && !isLatest) navLinks.push(`<a href="/portals/${esc(slug)}">Latest (${esc(latestWeek)})</a>`);
  const weekNav = navLinks.length ? `      <nav class="weeknav" aria-label="${esc(name)} weekly captures">${navLinks.join(" ")}</nav>\n` : "";

  const body = `    <main>
      <h1>${esc(name)}</h1>
      <p class="meta">${esc(portal.company)}${cap ? ` &middot; captured week of ${esc(cap.week)}` : ""}</p>
${weekNav}${cap ? `      <section class="shots" aria-label="${esc(name)} screenshots">\n${shots}      </section>
      <section class="analysis"><h2>Design analysis</h2><p>${esc(displayedAnalysis(cap))}</p><p class="method"><a href="/how-we-analyze">How this analysis is made</a></p></section>` : `      <p>No captures yet for ${esc(name)}.</p>`}
    </main>`;

  const html = page({
    consent: consentMode(request),
    title: weekParam !== null
      ? `${name} — logged-in UI screenshots, week of ${weekParam} | AI Interface Library`
      : `${name} — logged-in UI screenshots | AI Interface Library`,
    description,
    canonical,
    noindex: !!cap && SYSTEM_TEST_WEEKS.includes(cap.week),
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
      <h2>Sources</h2>
      <ul>
        <li><a href="https://www.w3.org/TR/WCAG22/">W3C, Web Content Accessibility Guidelines (WCAG) 2.2</a></li>
        <li><a href="https://www.nngroup.com/articles/visual-hierarchy-ux-definition/">Nielsen Norman Group, visual hierarchy in UX</a></li>
        <li><a href="https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/">Microsoft Research, Guidelines for Human-AI Interaction (Amershi et al., CHI 2019)</a></li>
      </ul>
    </main>`;

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

export const PRIVACY_UPDATED = "September 27, 2026";

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

/** Sitemap: home, then every active portal's page and its weekly pages, leaving out the system-test weeks. */
export async function handleSitemap(env: Env): Promise<Response> {
  const xml = await cached(env, "cache:sitemap", 300, async () => {
    const rows = (await sitemapCaptures(env)).filter((r) => !SYSTEM_TEST_WEEKS.includes(r.week)); // portal order, newest week first
    const urls = [`${ORIGIN}/`, `${ORIGIN}/how-we-analyze`, `${ORIGIN}/privacy`];
    const seen = new Set<string>();
    for (const r of rows) {
      if (!seen.has(r.slug)) { seen.add(r.slug); urls.push(`${ORIGIN}/portals/${r.slug}`); }
      urls.push(`${ORIGIN}/portals/${r.slug}/${r.week}`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${esc(u)}</loc>\n  </url>`).join("\n")}
</urlset>
`;
  });
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

// /compare/<a>-vs-<b>: a crawlable comparison of two portals for the latest week both have a desktop screenshot,
// with Compare's Differences and Similarities (src/compare.ts) and each portal's latest menu changes.
// The interactive Compare view lives at /#compare, which crawlers can't read; this page links to it.
import type { Env, PortalRow } from "./types";
import { getPortal, compareCaptures } from "./db";
import { desktopSize } from "./api";
import { consentMode, PRIVATE_HTML_CACHE } from "./consent";
import { shotAlt, weekInWords, weekShort } from "./format";
import { comparePair, comparePath, compareTableHash, parseComparePath, type ComparePair } from "./compare";
import { BRAND, HTML_HEADERS, MARKDOWN_HEADERS, ORIGIN, changes, esc, hubTitle, page, shotUrl, type PreviewImage } from "./portal-page";
import type { ChangeEntry } from "./nav-changes";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The h1, and the title before its date: "ChatGPT vs Claude: UI comparison". */
export const compareHeading = (p: ComparePair) => `${p.a.name} vs ${p.b.name}: UI comparison`;

/** The paragraph at the top of the page, also its meta description. */
export function compareSummary(p: ComparePair): string {
  const who = `${p.a.name} (${p.a.company}) and ${p.b.name} (${p.b.company})`;
  if (!p.week) return `There is no week with desktop screenshots of both ${p.a.name} and ${p.b.name} yet.`;
  const { differences, similarities } = p.counts;
  if (!differences && !similarities) return `${who} side by side on a desktop screen in the week of ${weekInWords(p.week)}. There is not enough analysis data to compare them yet.`;
  return `How ${who} compare on a desktop screen in the week of ${weekInWords(p.week)}: ${plural(differences, "difference", "differences")} and ${plural(similarities, "similarity", "similarities")}, measured from each product's weekly screenshot.`;
}

/** A portal's newest week with recorded menu changes, and those changes; null when none are recorded. */
function latestChanges(entries: ChangeEntry[], slug: string): { week: string; previousWeek: string; sentences: string[] } | null {
  const mine = entries.filter((e) => e.slug === slug); // newest week first
  if (!mine.length) return null;
  const week = mine[0].week;
  const those = mine.filter((e) => e.week === week);
  return { week, previousWeek: those[0].previousWeek, sentences: those.map((e) => e.sentence[0].toUpperCase() + e.sentence.slice(1)) };
}

function notFound(request: Request): Response {
  const html = page({
    consent: consentMode(request),
    title: "Comparison not found" + BRAND,
    description: "This comparison page does not exist.",
    noindex: true,
    body: `    <main><h1>Comparison not found</h1><p><a href="/#compare">Open Compare</a> or <a href="/">browse the AI Interface Library</a></p></main>`,
  });
  return new Response(html, { status: 404, headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE } });
}

/** Two screenshots side by side (stacked on phones), the two finding lists and menu changes. Open in Compare is a .btn-secondary. */
const COMPARE_PAGE_HEAD = `  <style>
    .cmp-summary{font-size:1.1rem;margin:0 0 16px;max-width:720px}
    .cmp-shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0 0}
    .cmp-shots figure{margin:0;min-width:0}
    .cmp-shots img{display:block;width:100%;height:auto;border:1px solid #d8cfc2;border-radius:8px;background:#fff}
    .cmp-lists{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 32px;margin:32px 0 0}
    .cmp h2{font-size:1.25rem;margin:0 0 8px}
    .cmp section ul{padding-left:1.25em;margin:0}
    .cmp section li{margin:0 0 6px}
    .cmp-empty{color:#6b6257;margin:0}
    .cmp-block{margin:32px 0 0}
    .cmp-block h3{font-size:1rem;margin:16px 0 4px}
    .cmp-block p{margin:0 0 6px}
    @media (max-width:640px){
      .cmp-shots,.cmp-lists{grid-template-columns:minmax(0,1fr)}
      .cmp-lists{gap:24px}
      h1{font-size:1.6rem;line-height:1.2}
    }
  </style>
`;

/** /compare/<a>-vs-<b> and its Markdown version /compare/<a>-vs-<b>.md. */
export async function handleComparePage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(request.url);
  const parsed = parseComparePath(url.pathname);
  if (!parsed || parsed.a === parsed.b) return notFound(request);
  const [p, q] = await Promise.all([getPortal(env, parsed.a), getPortal(env, parsed.b)]);
  if (!p || !p.active || !q || !q.active) return notFound(request);
  // One URL per pair: slugs in alphabetical order, no trailing slash.
  const path = comparePath(p.slug, q.slug);
  if (parsed.a > parsed.b || parsed.trailingSlash) {
    return Response.redirect(new URL(`${path}${parsed.markdown ? ".md" : ""}${url.search}`, url).toString(), 301);
  }

  const [caps, entries] = await Promise.all([compareCaptures(env, [p.slug, q.slug]), changes(env)]);
  const pair = comparePair(p, q, caps);
  const canonical = `${ORIGIN}${path}`;
  const compareHref = `/${compareTableHash(pair.a.slug, pair.b.slug, pair.week)}`;
  const summary = compareSummary(pair);
  const menu = [pair.a, pair.b].map((portal) => ({ portal, latest: latestChanges(entries, portal.slug) }));
  const shots = pair.capA && pair.capB
    ? ([[pair.a, pair.capA], [pair.b, pair.capB]] as const).map(([portal, cap]) => ({
        portal, week: cap.week, url: shotUrl(cap.r2_key, portal.slug, cap.captured_at), alt: shotAlt(portal.name, "desktop", cap.week), ...desktopSize(cap),
      }))
    : [];

  if (parsed.markdown) {
    const md = compareMarkdown({ pair, canonical, summary, compare: `${ORIGIN}${compareHref}`, menu, shots: shots.map((s) => ({ name: s.portal.name, url: `${ORIGIN}${s.url}` })) });
    const headers: Record<string, string> = { ...MARKDOWN_HEADERS, "cache-control": "public, max-age=3600", link: `<${canonical}>; rel="canonical"` };
    if (!pair.indexable) headers["x-robots-tag"] = "noindex";
    return new Response(request.method === "HEAD" ? null : md, { headers });
  }

  const list = (items: string[] | undefined, empty: string) => items && items.length
    ? `<ul>\n${items.map((l) => `          <li>${esc(l)}</li>`).join("\n")}\n        </ul>`
    : `<p class="cmp-empty">${esc(empty)}</p>`;
  const noData = pair.week ? "Not enough data to compare." : "No week with screenshots of both yet.";
  const figures = shots.map((s) => `        <figure><img src="${esc(s.url)}" alt="${esc(s.alt)}" width="${s.width}" height="${s.height}" loading="eager" /><figcaption><a href="/portals/${esc(s.portal.slug)}/${esc(s.week)}">${esc(s.portal.name)}</a> &middot; desktop &middot; week of ${esc(weekInWords(s.week))}</figcaption></figure>`).join("\n");
  const menuHtml = menu.map(({ portal, latest }) => latest
    ? `        <h3>${esc(portal.name)}</h3>\n        <p>Week of <a href="/portals/${esc(portal.slug)}/${esc(latest.week)}">${esc(weekInWords(latest.week))}</a>, compared with the week of ${esc(weekInWords(latest.previousWeek))}:</p>\n        ${list(latest.sentences, "")}`
    : `        <h3>${esc(portal.name)}</h3>\n        <p class="cmp-empty">No menu changes have been recorded for ${esc(portal.name)} yet.</p>`).join("\n");

  const body = `    <main class="cmp">
      <h1>${esc(compareHeading(pair))}</h1>
      <p class="meta">${esc(pair.a.company)} &middot; ${esc(pair.b.company)}${pair.week ? ` &middot; week of ${esc(weekInWords(pair.week))}` : ""}</p>
      <p class="cmp-summary">${esc(summary)}</p>
      <a class="btn-secondary cmp-open" href="${esc(compareHref)}">Open in Compare <span aria-hidden="true">&rarr;</span></a>
${figures ? `      <section class="cmp-shots" aria-label="Desktop screenshots">\n${figures}\n      </section>\n` : ""}      <div class="cmp-lists">
        <section><h2>Differences</h2>
        ${list(pair.findings?.differences, pair.findings ? "No differences found." : noData)}
        </section>
        <section><h2>Similarities</h2>
        ${list(pair.findings?.similarities, pair.findings ? "No similarities found." : noData)}
        </section>
      </div>
      <section class="cmp-block"><h2>Latest menu changes</h2>
${menuHtml}
      </section>
      <section class="cmp-block"><h2>Portal pages</h2>
        <ul>
          <li><a href="/portals/${esc(pair.a.slug)}">${esc(hubTitle(pair.a.name))}</a></li>
          <li><a href="/portals/${esc(pair.b.slug)}">${esc(hubTitle(pair.b.name))}</a></li>
        </ul>
      </section>
      <p class="method"><a href="/how-we-analyze">How the analysis is made</a></p>
    </main>`;

  const image: PreviewImage | undefined = shots[0]
    ? { url: `${ORIGIN}${shots[0].url}`, width: shots[0].width, height: shots[0].height, alt: shots[0].alt }
    : undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": canonical,
        url: canonical,
        name: compareHeading(pair),
        description: summary,
        ...(pair.week ? { dateModified: pair.week } : {}),
        isPartOf: { "@type": "WebSite", name: "AI Interface Library", url: `${ORIGIN}/` },
        about: [pair.a, pair.b].map((x: PortalRow) => ({ "@type": "SoftwareApplication", name: x.name, publisher: { "@type": "Organization", name: x.company } })),
        ...(image ? { primaryImageOfPage: { "@type": "ImageObject", contentUrl: image.url } } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AI Interface Library", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: `${pair.a.name} vs ${pair.b.name}`, item: canonical },
        ],
      },
      ...shots.map((s) => ({ "@type": "ImageObject", contentUrl: `${ORIGIN}${s.url}`, caption: s.alt, width: s.width, height: s.height })),
    ],
  };

  const html = page({
    consent: consentMode(request),
    title: `${pair.a.name} vs ${pair.b.name} UI comparison${pair.week ? ` — ${weekShort(pair.week)}` : ""}${BRAND}`,
    description: summary,
    canonical,
    noindex: !pair.indexable,
    image,
    jsonLd,
    markdown: `${canonical}.md`,
    head: COMPARE_PAGE_HEAD,
    body,
  });
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE } });
}

/** Markdown version: the same facts as the HTML page. */
function compareMarkdown(o: {
  pair: ComparePair; canonical: string; summary: string; compare: string;
  menu: { portal: PortalRow; latest: ReturnType<typeof latestChanges> }[]; shots: { name: string; url: string }[];
}): string {
  const { pair } = o;
  const items = (l: string[] | undefined, empty: string) => (l && l.length ? l.map((x) => `- ${x}`) : [empty]);
  const noData = pair.week ? "Not enough data to compare." : "No week with screenshots of both yet.";
  return [
    `# ${compareHeading(pair)}`,
    "",
    ...(pair.week ? [`- Week: week of ${weekInWords(pair.week)} (${pair.week})`] : []),
    `- Page: ${o.canonical}`,
    `- Open in Compare: ${o.compare}`,
    "",
    o.summary,
    "",
    "## Differences",
    "",
    ...items(pair.findings?.differences, pair.findings ? "No differences found." : noData),
    "",
    "## Similarities",
    "",
    ...items(pair.findings?.similarities, pair.findings ? "No similarities found." : noData),
    "",
    "## Latest menu changes",
    "",
    ...o.menu.flatMap(({ portal, latest }) => latest
      ? [`### ${portal.name}`, "", `Week of ${weekInWords(latest.week)}, compared with the week of ${weekInWords(latest.previousWeek)}:`, "", ...latest.sentences.map((s) => `- ${s}`), ""]
      : [`### ${portal.name}`, "", `No menu changes have been recorded for ${portal.name} yet.`, ""]),
    "## Portal pages",
    "",
    `- ${pair.a.name}: ${ORIGIN}/portals/${pair.a.slug}`,
    `- ${pair.b.name}: ${ORIGIN}/portals/${pair.b.slug}`,
    "",
    "## Screenshots",
    "",
    ...(o.shots.length ? o.shots.map((s) => `- ${s.name}, desktop: ${s.url}`) : ["No screenshots."]),
    "",
  ].join("\n");
}

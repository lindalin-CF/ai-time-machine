// /weeks/<week>: a crawlable digest of one week's captures (src/weeks.ts): how many portals were captured, each
// changed portal's recorded menu changes with a small desktop screenshot and a link to Compare (this week vs the
// week its analysis compared with), and the portals without changes.
// /weeks lists every week, newest first. Both are built from existing data only.
import type { Env } from "./types";
import { capturesForWeek } from "./db";
import { desktopSize } from "./api";
import { consentMode, PRIVATE_HTML_CACHE } from "./consent";
import { shotAlt, weekInWords, weekShort } from "./format";
import { SYSTEM_TEST_WEEKS } from "./analysis";
import { BRAND, HTML_HEADERS, MARKDOWN_HEADERS, ORIGIN, SITE_PERSON, compareWeeksHash, esc, page, shotUrl, type PreviewImage } from "./portal-page";
import { weekDigests, weekLine, weekSummary, type WeekDigest } from "./weeks";

export const WEEKS_URL = `${ORIGIN}/weeks`;

/** The h1: "AI interface changes — week of Oct 19, 2026". */
export const weekHeading = (week: string) => `AI interface changes — week of ${weekShort(week)}`;
/** The title before the brand: "AI interface changes, week of Oct 19, 2026". */
export const weekTitle = (week: string) => `AI interface changes, week of ${weekShort(week)}`;

/** Search results show about this many characters of a description. */
const DESCRIPTION_MAX = 160;

/** The summary's sentences, as many as fit in DESCRIPTION_MAX (always at least the first). */
export function weekDescription(summary: string): string {
  let out = "";
  for (const s of summary.split(/(?<=\.)\s+/)) {
    const next = out ? `${out} ${s}` : s;
    if (out && next.length > DESCRIPTION_MAX) break;
    out = next;
  }
  return out;
}

function notFound(request: Request): Response {
  const html = page({
    consent: consentMode(request),
    title: "Week not found" + BRAND,
    description: "This weekly digest does not exist.",
    noindex: true,
    body: `    <main><h1>Week not found</h1><p><a href="/weeks">See all weeks</a> or <a href="/">browse the AI Interface Library</a></p></main>`,
  });
  return new Response(html, { status: 404, headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE } });
}

/** A thumbnail beside each changed portal's changes (stacked on phones), and the week links. */
const WEEK_PAGE_HEAD = `  <style>
    .wk-summary{font-size:1.1rem;margin:0 0 16px;max-width:720px}
    .wk-portal{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;align-items:start;margin:32px 0 0;padding-top:24px;border-top:1px solid #d8cfc2;scroll-margin-top:24px}
    .wk-portal figure{margin:0}
    .wk-portal img{display:block;width:100%;height:auto;border:1px solid #d8cfc2;border-radius:8px;background:#fff}
    .wk-portal h2{font-size:1.25rem;margin:0 0 4px}
    .wk-portal p{margin:0 0 6px}
    .wk-portal ul{padding-left:1.25em;margin:0 0 8px}
    .wk-portal li{margin:0 0 4px}
    .wk-links{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.95rem}
    .wk-unchanged{margin:32px 0 0;padding-top:24px;border-top:1px solid #d8cfc2}
    .wk-list{padding-left:1.25em}
    .wk-list li{margin:0 0 6px}
    @media (max-width:640px){
      .wk-portal{grid-template-columns:minmax(0,1fr);gap:12px}
      .wk-portal figure{max-width:320px}
      h1{font-size:1.6rem;line-height:1.2}
    }
  </style>
`;

/** /weeks, /weeks/<week> and /weeks/<week>.md. */
export async function handleWeeks(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(request.url);
  if (url.pathname === "/weeks" || url.pathname === "/weeks/") return await handleWeeksIndex(request, env);
  const m = /^\/weeks\/(\d{4}-\d{2}-\d{2})(\.md)?(\/)?$/.exec(url.pathname);
  if (!m) return notFound(request);
  const [, week, md, slash] = m;
  // One URL per week, without a trailing slash.
  if (slash) return Response.redirect(new URL(`/weeks/${week}${md ?? ""}${url.search}`, url).toString(), 301);

  const digests = await weekDigests(env); // newest first
  const i = digests.findIndex((d) => d.week === week);
  if (i < 0) return notFound(request);
  const d = digests[i];
  const newer = digests[i - 1]?.week ?? null;
  const older = digests[i + 1]?.week ?? null;
  const caps = await capturesForWeek(env, week);
  const canonical = `${ORIGIN}/weeks/${week}`;
  const summary = weekSummary(d);
  const changedSlugs = new Set(d.changed.map((p) => p.slug));
  const unchanged = d.captured.filter((p) => !changedSlugs.has(p.slug));
  const sections = d.changed.map((p) => {
    const cap = caps.find((c) => c.slug === p.slug && c.status === "ok");
    return {
      portal: p,
      weekly: `/portals/${p.slug}/${week}`,
      // Compare's Single portal canvas: this week vs the week the changes are measured against.
      compare: `/${compareWeeksHash(p.slug, [week, p.previousWeek])}`,
      shot: cap?.r2_key ? { url: shotUrl(cap.r2_key, p.slug, cap.captured_at), alt: shotAlt(p.name, "desktop", week), ...desktopSize(cap) } : null,
    };
  });

  if (md) {
    const text = weekMarkdown({ d, canonical, summary, older, newer, unchanged, sections });
    const headers: Record<string, string> = { ...MARKDOWN_HEADERS, "cache-control": "public, max-age=3600", link: `<${canonical}>; rel="canonical"` };
    if (!d.indexable) headers["x-robots-tag"] = "noindex";
    return new Response(request.method === "HEAD" ? null : text, { headers });
  }

  const navLinks: string[] = [];
  if (older) navLinks.push(`<a href="/weeks/${esc(older)}" rel="prev">&larr; Previous week (${esc(weekShort(older))})</a>`);
  if (newer) navLinks.push(`<a href="/weeks/${esc(newer)}" rel="next">Next week (${esc(weekShort(newer))}) &rarr;</a>`);
  navLinks.push(`<a href="/weeks">All weeks</a>`);
  const sectionsHtml = sections.map((s) => `      <section class="wk-portal" id="${esc(s.portal.slug)}">
${s.shot ? `        <figure><a href="${esc(s.weekly)}"><img src="${esc(s.shot.url)}" alt="${esc(s.shot.alt)}" width="${s.shot.width}" height="${s.shot.height}" loading="lazy" /></a></figure>\n` : ""}        <div>
          <h2>${esc(s.portal.name)}</h2>
          <p>Compared with the week of ${esc(weekInWords(s.portal.previousWeek))}:</p>
          <ul>
${s.portal.changes.map((c) => `            <li>${esc(c.phrase)}</li>`).join("\n")}
          </ul>
          <p class="wk-links"><a href="${esc(s.weekly)}">${esc(s.portal.name)}, week of ${esc(weekShort(week))}</a><a href="${esc(s.compare)}" aria-label="See ${esc(s.portal.name)} this week vs last week">See this week vs last week</a></p>
        </div>
      </section>`).join("\n");
  const unchangedHtml = unchanged.length
    ? `      <p class="wk-unchanged">No recorded menu changes: ${unchanged.map((p) => `<a href="/portals/${esc(p.slug)}/${esc(week)}">${esc(p.name)}</a>`).join(", ")}.</p>\n`
    : "";

  const body = `    <main class="wk">
      <h1>${esc(weekHeading(week))}</h1>
      <p class="meta">Weekly digest &middot; ${esc(weekLine(d))}</p>
      <p class="wk-summary">${esc(summary)}</p>
      <nav class="weeknav" aria-label="Weekly digests">${navLinks.join(" ")}</nav>
${sectionsHtml ? `${sectionsHtml}\n` : ""}${unchangedHtml}      <p class="method"><a href="/changes">Every menu change</a> &middot; <a href="/how-we-analyze">How the analysis is made</a></p>
    </main>`;

  const first = sections.find((s) => s.shot)?.shot;
  const image: PreviewImage | undefined = first ? { url: `${ORIGIN}${first.url}`, width: first.width, height: first.height, alt: first.alt } : undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": canonical,
        url: canonical,
        mainEntityOfPage: canonical,
        headline: weekHeading(week),
        description: summary,
        datePublished: week,
        dateModified: week,
        inLanguage: "en",
        author: SITE_PERSON,
        publisher: SITE_PERSON,
        isPartOf: { "@type": "WebSite", name: "AI Interface Library", url: `${ORIGIN}/` },
        ...(image ? { image: image.url } : {}),
        ...(d.changed.length ? { about: d.changed.map((p) => ({ "@type": "SoftwareApplication", name: p.name })) } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AI Interface Library", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Weekly digests", item: WEEKS_URL },
          { "@type": "ListItem", position: 3, name: `Week of ${weekInWords(week)}`, item: canonical },
        ],
      },
    ],
  };

  const html = page({
    consent: consentMode(request),
    title: weekTitle(week) + BRAND,
    description: weekDescription(summary),
    canonical,
    noindex: !d.indexable,
    image,
    jsonLd,
    markdown: `${canonical}.md`,
    head: WEEK_PAGE_HEAD,
    body,
  });
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE } });
}

/** /weeks: every week except the system-test weeks, newest first. */
async function handleWeeksIndex(request: Request, env: Env): Promise<Response> {
  const listed = (await weekDigests(env)).filter((d) => !SYSTEM_TEST_WEEKS.includes(d.week));
  const items = listed.map((d) => ({ d, name: `Week of ${weekInWords(d.week)}`, url: `/weeks/${d.week}` }));
  const list = items.length
    ? `      <ul class="wk-list">\n${items.map((x) => `        <li><a href="${esc(x.url)}">${esc(x.name)}</a> — ${esc(weekLine(x.d))}</li>`).join("\n")}\n      </ul>`
    : `      <p>No weeks have been captured yet.</p>`;
  const body = `    <main class="howto">
      <h1>AI interface changes by week</h1>
      <p class="meta">One digest per weekly capture: which AI products changed their built-in menu items, newest first.</p>
${list}
      <p class="method"><a href="/changes">Every menu change</a> &middot; <a href="/how-we-analyze">How the analysis is made</a></p>
    </main>`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ItemList",
        name: "AI interface changes by week",
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: items.length,
        itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, url: `${ORIGIN}${x.url}` })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AI Interface Library", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Weekly digests", item: WEEKS_URL },
        ],
      },
    ],
  };
  const html = page({
    consent: consentMode(request),
    title: "AI interface changes by week" + BRAND,
    description: "A weekly digest of AI product interfaces such as ChatGPT, Claude and Gemini: how many were captured each week and which changed their menu items, newest first.",
    canonical: WEEKS_URL,
    head: WEEK_PAGE_HEAD,
    jsonLd,
    body,
  });
  return new Response(request.method === "HEAD" ? null : html, { headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE } });
}

/** Markdown version of a weekly digest: the same facts as the HTML page. */
function weekMarkdown(o: {
  d: WeekDigest; canonical: string; summary: string; older: string | null; newer: string | null;
  unchanged: { slug: string; name: string }[];
  sections: { portal: WeekDigest["changed"][number]; weekly: string; compare: string; shot: { url: string } | null }[];
}): string {
  const { d } = o;
  return [
    `# ${weekHeading(d.week)}`,
    "",
    `- Week: week of ${weekInWords(d.week)} (${d.week})`,
    `- Page: ${o.canonical}`,
    ...(o.older ? [`- Previous week: ${ORIGIN}/weeks/${o.older}`] : []),
    ...(o.newer ? [`- Next week: ${ORIGIN}/weeks/${o.newer}`] : []),
    "",
    o.summary,
    "",
    ...o.sections.flatMap((s) => [
      `## ${s.portal.name}`,
      "",
      `Compared with the week of ${weekInWords(s.portal.previousWeek)}:`,
      "",
      ...s.portal.changes.map((c) => `- ${c.phrase}`),
      "",
      `- Weekly page: ${ORIGIN}${s.weekly}`,
      `- See this week vs last week: ${ORIGIN}${s.compare}`,
      ...(s.shot ? [`- Desktop screenshot: ${ORIGIN}${s.shot.url}`] : []),
      "",
    ]),
    ...(o.unchanged.length ? [`No recorded menu changes: ${o.unchanged.map((p) => p.name).join(", ")}.`, ""] : []),
  ].join("\n");
}

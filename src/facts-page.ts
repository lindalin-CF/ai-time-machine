// /facts and /facts.md: Key facts about each active portal's interface in its latest published analysis
// (src/facts.ts), laid out like /changelog. Linked from the footer only, not the top bar.
import type { Env } from "./types";
import { consentMode, PRIVATE_HTML_CACHE } from "./consent";
import { weekInWords, weekShort } from "./format";
import { comparePath } from "./compare";
import { factsUpdated, portalFacts, type PortalFacts } from "./facts";
import { BRAND, HTML_HEADERS, MARKDOWN_HEADERS, ORIGIN, esc, page } from "./portal-page";

export const FACTS_URL = `${ORIGIN}/facts`;
const TITLE = "Key facts about AI portal interfaces";
const DESCRIPTION = "Key facts about ChatGPT, Claude, Gemini and other AI portals in their latest weekly capture: layout, suggested prompts, color scheme and the latest menu change.";
const INTRO = "What each AI portal's interface looks like in its latest capture.";
const ONE_ACCOUNT = "Each portal is captured with one account, so details can differ by plan.";
/** Where the second intro sentence links: /how-we-analyze has no "One account per portal" section yet. */
const ONE_ACCOUNT_HREF = "/how-we-analyze";

/** The changelog's layout (CHANGELOG_HEAD in src/portal-page.ts), with the portal's logo where the changelog has its dot. */
const FACTS_HEAD = `  <style>
    .facts h1{font-size:48px;line-height:1.05;letter-spacing:-.03em}
    .facts .meta{font-size:1.05rem;margin:0 0 8px}
    .facts .fx-updated{color:#6b6257;margin:0}
    .fx{list-style:none;margin:56px 0 0;padding:0}
    .fx-entry{position:relative;display:grid;grid-template-columns:220px minmax(0,1fr);padding-bottom:56px;scroll-margin-top:24px}
    .fx-entry:last-child{padding-bottom:0}
    .fx-entry:not(:last-child)::after{content:"";position:absolute;left:15px;top:40px;bottom:-4px;width:1px;background:#d8cfc2}
    .fx-who{display:grid;grid-template-columns:32px minmax(0,1fr);column-gap:12px;align-items:center;align-content:start;padding-right:24px}
    .fx-logo{display:block;width:32px;height:32px;border-radius:8px;background:#fffdf9;box-shadow:0 0 0 4px #f4efe8}
    .fx-who h2{font-size:20px;line-height:1.2;letter-spacing:-.01em;margin:0;overflow-wrap:anywhere}
    .fx-week{grid-column:2;font-size:.85rem;color:#6b6257;white-space:nowrap}
    .fx-body{font-size:18px;line-height:1.6;min-width:0}
    .fx-body ul{list-style:disc;margin:0 0 16px;padding-left:1.2em}
    .fx-body li{margin:0 0 8px}
    .fx-body li::marker{color:#6b6257}
    .fx-links{display:flex;flex-wrap:wrap;gap:4px 20px;margin:0;font-size:1rem}
    .fx-links a{color:var(--brand-text)}
    @media (max-width:720px){
      .facts h1{font-size:40px}
      .fx{margin-top:40px}
      .fx-entry{grid-template-columns:minmax(0,1fr);padding-bottom:48px}
      .fx-entry:not(:last-child)::after{display:none}
      .fx-who{padding:0;margin-bottom:12px}
      .fx-body{font-size:17px}
    }
  </style>
`;

type Bullet = { lead: string; text: string; href?: string };

/** 1 to 3 bullets: layout and start screen when known, then the latest menu change (or that none is recorded). */
export function factBullets(f: PortalFacts): Bullet[] {
  const out: Bullet[] = [];
  if (f.layout) out.push({ lead: "Layout", text: f.layout });
  if (f.start) out.push({ lead: "Start screen", text: f.start });
  out.push(f.latestChange
    ? { lead: "Latest menu change", text: `Week of ${weekInWords(f.latestChange.week)}: ${f.latestChange.phrases.join("; ")}.`, href: `/portals/${f.slug}/${f.latestChange.week}` }
    : { lead: "Menu changes", text: "No menu changes recorded yet." });
  return out;
}

function entryHtml(f: PortalFacts): string {
  const bullets = factBullets(f).map((b) => {
    const text = b.href ? `<a href="${esc(b.href)}">${esc(b.text)}</a>` : esc(b.text);
    return `            <li><strong>${esc(b.lead)}:</strong> ${text}</li>`;
  });
  const links = [`<a href="/portals/${esc(f.slug)}">${esc(f.name)} screenshots</a>`];
  if (f.compareWith) links.push(`<a href="${esc(comparePath(f.slug, f.compareWith.slug))}">Compare with ${esc(f.compareWith.name)}</a>`);
  return `      <li class="fx-entry" id="${esc(f.slug)}">
        <div class="fx-who">
          <img class="fx-logo" src="/icons/${esc(f.slug)}.png" alt="" width="32" height="32" loading="lazy" />
          <h2>${esc(f.name)}</h2>${f.week ? `\n          <span class="fx-week">Week of ${esc(weekShort(f.week))}</span>` : ""}
        </div>
        <div class="fx-body">
          <ul>
${bullets.join("\n")}
          </ul>
          <p class="fx-links">${links.join(" ")}</p>
        </div>
      </li>`;
}

export function factsMarkdown(facts: PortalFacts[]): string {
  const updated = factsUpdated(facts);
  const lines = [`# Key facts`, "", `${INTRO} ${ONE_ACCOUNT} [How we analyze](${ORIGIN}${ONE_ACCOUNT_HREF})`, ""];
  if (updated) lines.push(`Last updated ${weekInWords(updated)}.`, "");
  for (const f of facts) {
    lines.push(`## ${f.name}`, "");
    if (f.week) lines.push(`- Week of ${weekInWords(f.week)}`);
    for (const b of factBullets(f)) lines.push(`- ${b.lead}: ${b.href ? `[${b.text}](${ORIGIN}${b.href})` : b.text}`);
    lines.push(`- Page: ${ORIGIN}/portals/${f.slug}`);
    if (f.compareWith) lines.push(`- Compare with ${f.compareWith.name}: ${ORIGIN}${comparePath(f.slug, f.compareWith.slug)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function factsJsonLd(facts: PortalFacts[]): unknown {
  const updated = factsUpdated(facts);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": FACTS_URL, url: FACTS_URL, name: TITLE, description: DESCRIPTION, ...(updated ? { dateModified: updated } : {}) },
      {
        "@type": "ItemList",
        name: "AI portals",
        numberOfItems: facts.length,
        itemListElement: facts.map((f, i) => ({ "@type": "ListItem", position: i + 1, name: f.name, url: `${ORIGIN}/portals/${f.slug}` })),
      },
    ],
  };
}

/** /facts, /facts/ and /facts.md. */
export async function handleFacts(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const facts = await portalFacts(env);
  if (new URL(request.url).pathname === "/facts.md") {
    const headers = { ...MARKDOWN_HEADERS, "cache-control": "public, max-age=3600", link: `<${FACTS_URL}>; rel="canonical"` };
    return new Response(request.method === "HEAD" ? null : factsMarkdown(facts), { headers });
  }
  const updated = factsUpdated(facts);
  const html = page({
    consent: consentMode(request),
    title: TITLE + BRAND,
    description: DESCRIPTION,
    canonical: FACTS_URL,
    markdown: `${FACTS_URL}.md`,
    jsonLd: factsJsonLd(facts),
    head: FACTS_HEAD,
    body: `    <main class="facts">
      <h1>Key facts</h1>
      <p class="meta">${esc(INTRO)} <a href="${ONE_ACCOUNT_HREF}">${esc(ONE_ACCOUNT)}</a></p>
${updated ? `      <p class="fx-updated">Last updated ${esc(weekInWords(updated))}</p>\n` : ""}      <ol class="fx">
${facts.map(entryHtml).join("\n")}
      </ol>
    </main>`,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": PRIVATE_HTML_CACHE },
  });
}

// /llms.txt and /llms-full.txt (https://llmstxt.org): a plain summary of the site for language models
// and AI agents. Built only from portal names, published analysis summaries and captureMetrics() menu
// data, the same content the public pages already show.
import type { Env } from "./types";
import { listPortals, publishedCaptures } from "./db";
import { cached } from "./api";
import { SYSTEM_TEST_WEEKS } from "./analysis";
import { captureMetrics } from "./capture-metrics";
import { navChangeSentence, navItemName } from "./nav-changes";
import { weekInWords } from "./format";
import { ORIGIN, FEED_URL } from "./portal-page";
import { comparePath, indexablePairs } from "./compare";
import { weekDigests, weekLine } from "./weeks";

const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" };

/** What the site is, in one blockquote paragraph (shared by both files). */
function about(portalCount: number): string {
  return `> Each week, AI Interface Library captures the first screen of ${portalCount} AI products on a 1280 by 800 desktop screen, before scrolling, usually right after signing in (Kimi is captured signed out). Each capture gets a short design analysis of the layout, what stands out most, text contrast, where you start, and changes to the built-in menu items since the week before. Sizes and colors are measured from the screenshot pixels, other observations follow a fixed checklist, and a person reviews every analysis before it is published.`;
}

/** /llms.txt: the site summary and its main pages, grouped by section. */
export async function handleLlmsTxt(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const text = await cached(env, "cache:llms", 300, async () => {
    const [portals, pairs, digests] = await Promise.all([listPortals(env), indexablePairs(env), weekDigests(env)]);
    const weeks = digests.filter((d) => d.indexable);
    return [
      "# AI Interface Library",
      "",
      about(portals.length),
      "",
      "Every portal page, weekly page, weekly digest and comparison page also has a Markdown version at the same address with .md added. The full text of each product's latest published analysis is in /llms-full.txt.",
      "",
      "## Key facts",
      "",
      `- [Key facts](${ORIGIN}/facts): what each AI portal's interface looks like in its latest capture: layout, suggested prompts, color scheme and the latest menu change ([Markdown](${ORIGIN}/facts.md))`,
      "",
      "## Portals",
      "",
      ...portals.map((p) => `- [${p.name}](${ORIGIN}/portals/${p.slug}): ${p.company}. Weekly desktop and mobile screenshots with a design analysis ([Markdown](${ORIGIN}/portals/${p.slug}.md))`),
      "",
      ...(pairs.length ? [
        "## Comparisons",
        "",
        ...pairs.map((p) => `- [${p.aName} vs ${p.bName}](${ORIGIN}${comparePath(p.a, p.b)}): UI comparison for the week of ${weekInWords(p.week)}, with differences and similarities ([Markdown](${ORIGIN}${comparePath(p.a, p.b)}.md))`),
        "",
      ] : []),
      ...(weeks.length ? [
        "## Weekly digests",
        "",
        `- [All weeks](${ORIGIN}/weeks): one digest per weekly capture, newest first`,
        ...weeks.map((d) => `- [AI interface changes, week of ${weekInWords(d.week)}](${ORIGIN}/weeks/${d.week}): ${weekLine(d)} ([Markdown](${ORIGIN}/weeks/${d.week}.md))`),
        "",
      ] : []),
      "## Changes",
      "",
      `- [Menu changes](${ORIGIN}/changes): every change to the products' built-in menu items between weekly captures, newest first`,
      `- [Changelog](${ORIGIN}/changelog): decisions and releases for the library itself, newest first`,
      "",
      "## Method",
      "",
      `- [How we analyze](${ORIGIN}/how-we-analyze): what the analysis looks at, how it is measured, and what it does not claim`,
      "",
      "## Feeds",
      "",
      `- [RSS feed](${FEED_URL}): one item per product per week with a published analysis`,
      `- [Sitemap](${ORIGIN}/sitemap.xml): every page, with screenshot URLs`,
      "",
    ].join("\n");
  });
  return new Response(request.method === "HEAD" ? null : text, { headers: TEXT_HEADERS });
}

/** /llms-full.txt: for each active product, the full summary of its latest published analysis, with its menu facts. */
export async function handleLlmsFullTxt(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const text = await cached(env, "cache:llms-full", 300, async () => {
    const [portals, rows] = await Promise.all([listPortals(env), publishedCaptures(env)]);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!SYSTEM_TEST_WEEKS.includes(r.week) && !latest.has(r.slug)) latest.set(r.slug, r); // rows are newest week first per portal
    const sections = portals.map((p) => {
      const r = latest.get(p.slug);
      if (!r) return `## ${p.name} (${p.company})\n\nNo published analysis yet. Page: ${ORIGIN}/portals/${p.slug}\n`;
      const m = captureMetrics(r);
      const menu = m?.navItems?.length ? `Menu items: ${m.navItems.map((it) => `${navItemName(it)} (${it.region})`).join(", ")}.` : "";
      const changes = m?.navChanges
        ? m.navChanges.items.length
          ? `Menu changes since the week of ${weekInWords(m.navChanges.previousWeek)}: ${m.navChanges.items.map(navChangeSentence).join(" ")}`
          : `No menu changes since the week of ${weekInWords(m.navChanges.previousWeek)}.`
        : "";
      return [
        `## ${p.name} (${p.company}): week of ${weekInWords(r.week)}`,
        "",
        `Page: ${ORIGIN}/portals/${p.slug}/${r.week}`,
        "",
        r.analysis.trim(),
        ...(menu ? ["", menu] : []),
        ...(changes ? ["", changes] : []),
        "",
      ].join("\n");
    });
    return ["# AI Interface Library: latest analyses", "", about(portals.length), "", ...sections].join("\n");
  });
  return new Response(request.method === "HEAD" ? null : text, { headers: TEXT_HEADERS });
}

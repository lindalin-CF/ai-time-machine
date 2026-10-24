// Comparison pages (/compare/<a>-vs-<b>, src/compare-page.ts): which pairs exist, which week each one shows, and
// its findings. The findings come from the same code as Compare's Table rows (findingLists in
// public/analytics-canvas.js, in the Table's wording), over the whitelisted captureMetrics() data, so nothing new
// is generated. The page has room for every finding, so it skips the Table's 6 and 5 line limits.
import type { Env, CaptureRow, PortalRow } from "./types";
import { compareCaptures, listPortals } from "./db";
import { cached } from "./api";
import { SYSTEM_TEST_WEEKS } from "./analysis";
import { captureMetrics } from "./capture-metrics";
import { findingLists } from "../public/analytics-canvas.js";

/**
 * The products people compare most, most compared first. Each portal page links to its pairs with the first
 * COMPARE_WITH_LINKS of these, skipping itself (src/portal-page.ts), so every portal gets the same number of links.
 */
export const POPULAR_PAIRINGS = ["chatgpt", "claude", "gemini", "perplexity", "copilot"];
export const COMPARE_WITH_LINKS = 4;

/** A pair with fewer findings than this is shown with noindex and left out of the sitemap and llms.txt. */
export const MIN_INDEXABLE_FINDINGS = 3;

/** One URL per pair: the two slugs in alphabetical order, "/compare/chatgpt-vs-claude". */
export function comparePath(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `/compare/${x}-vs-${y}`;
}

/** "/compare/<a>-vs-<b>" (or ".md", with or without a trailing slash) → its two slugs as written; null for anything else. */
export function parseComparePath(pathname: string): { a: string; b: string; markdown: boolean; trailingSlash: boolean } | null {
  const m = /^\/compare\/([a-z0-9-]+?)-vs-([a-z0-9-]+?)(\.md)?(\/)?$/.exec(pathname);
  if (!m || m[1].includes("-vs-") || m[2].includes("-vs-")) return null;
  return { a: m[1], b: m[2], markdown: !!m[3], trailingSlash: !!m[4] };
}

/** The interactive Compare view of the same pair and week: Across portals, Table, desktop (the format of public/analytics-share.js). */
export function compareTableHash(a: string, b: string, week: string | null): string {
  const [x, y] = [a, b].sort();
  return `#compare?view=table&mode=portals${week ? `&week=${encodeURIComponent(week)}` : ""}&portals=${encodeURIComponent(x)},${encodeURIComponent(y)}&device=desktop`;
}

export type Findings = { differences: string[]; similarities: string[] };

/** What a comparison page shows for one pair: the latest week both portals have a desktop screenshot, and its findings. */
export type ComparePair = {
  a: PortalRow; b: PortalRow; // alphabetical by slug
  week: string | null;
  capA: CaptureRow | null; capB: CaptureRow | null;
  /** Every difference and similarity, in the Table's wording and order. Null when the two have no field in common. */
  findings: Findings | null;
  counts: { differences: number; similarities: number };
  indexable: boolean;
};

const findingCard = (p: PortalRow, cap: CaptureRow) => ({ label: p.name, slug: p.slug, week: cap.week, metrics: captureMetrics(cap) });

/** `caps`: either portal's desktop captures, newest week first (compareCaptures()). */
export function comparePair(p: PortalRow, q: PortalRow, caps: CaptureRow[]): ComparePair {
  const [a, b] = p.slug < q.slug ? [p, q] : [q, p];
  const usable = (slug: string) => caps.filter((c) => c.slug === slug && c.r2_key && !SYSTEM_TEST_WEEKS.includes(c.week));
  const capsB = usable(b.slug);
  const capA = usable(a.slug).find((c) => capsB.some((d) => d.week === c.week)) ?? null;
  const capB = capA ? capsB.find((d) => d.week === capA.week)! : null;
  if (!capA || !capB) return { a, b, week: null, capA: null, capB: null, findings: null, counts: { differences: 0, similarities: 0 }, indexable: false };
  const ca = findingCard(a, capA), cb = findingCard(b, capB);
  const { differences, similarities } = findingLists(ca, cb, { navChangeLines: Infinity, brief: true });
  const counts = { differences: differences.length, similarities: similarities.length };
  return {
    a, b, week: capA.week, capA, capB,
    findings: differences.length || similarities.length ? { differences, similarities } : null,
    counts,
    indexable: counts.differences + counts.similarities >= MIN_INDEXABLE_FINDINGS,
  };
}

/** An indexable pair as the sitemap and llms.txt list it. `lastmod`: the newer capture or analysis publish of its two captures. */
export type IndexablePair = { a: string; b: string; aName: string; bName: string; week: string; lastmod: string; images: { key: string; capturedAt: string; slug: string }[] };

/** Every indexable pair of active portals, in portal order (cached like the sitemap). */
export async function indexablePairs(env: Env): Promise<IndexablePair[]> {
  return await cached(env, "cache:compare-pairs", 300, async () => {
    const [portals, caps] = await Promise.all([listPortals(env), compareCaptures(env)]);
    const out: IndexablePair[] = [];
    for (let i = 0; i < portals.length; i++) {
      for (let j = i + 1; j < portals.length; j++) {
        const pair = comparePair(portals[i], portals[j], caps);
        if (!pair.indexable || !pair.capA || !pair.capB) continue;
        const times = [pair.capA, pair.capB].flatMap((c) => [c.captured_at, c.analysis_published_at]).map((t) => Date.parse(t ?? "")).filter((n) => !Number.isNaN(n));
        out.push({
          a: pair.a.slug, b: pair.b.slug, aName: pair.a.name, bName: pair.b.name, week: pair.week!,
          lastmod: times.length ? new Date(Math.max(...times)).toISOString().replace(/\.\d{3}Z$/, "Z") : pair.week!,
          images: [pair.capA, pair.capB].map((c) => ({ key: c.r2_key!, capturedAt: c.captured_at, slug: c.slug })),
        });
      }
    }
    return out;
  });
}

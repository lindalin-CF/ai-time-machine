// Weekly digests (/weeks/<week>, src/week-page.ts): for each archived week, which portals were captured, which had
// recorded menu changes (changeEntries() in src/nav-changes.ts, the same lines as the portal timeline), and whether the
// page is indexable. Built only from D1 rows and the published analyses' menu data, so nothing new is generated.
import type { Env } from "./types";
import { listPortals, listWeeks, publishedCaptures, sitemapCaptures } from "./db";
import { cached } from "./api";
import { isPublishedAnalysis, SYSTEM_TEST_WEEKS } from "./analysis";
import { weekInWords } from "./format";
import { changes, planChanges } from "./portal-page";

export type DigestChange = { phrase: string; sentence: string; weight: number };
/** A portal with recorded menu changes in the week, against the week its analysis compared with. */
export type DigestPortal = { slug: string; name: string; previousWeek: string; changes: DigestChange[] };

export type WeekDigest = {
  week: string;
  /** Portals with a successful capture that week, portal order. */
  captured: { slug: string; name: string }[];
  /** How many of those captures have a published analysis. */
  published: number;
  /** Portals with recorded menu changes, portal order. */
  changed: DigestPortal[];
  /** Portals whose account plan changed this week (src/plan.ts), portal order: their differences are not product changes. */
  planChanged: { slug: string; name: string }[];
  /** False for the system-test weeks and weeks without a published analysis: noindex, and left out of the sitemap, llms.txt and /weeks. */
  indexable: boolean;
  /** Newest capture or analysis publish of the week (W3C datetime, whole seconds). */
  lastmod?: string;
  /** Desktop screenshots of the changed portals, as the page shows them. */
  images: { key: string; slug: string; capturedAt: string }[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Every archived week's digest, newest first (cached like the sitemap). */
export async function weekDigests(env: Env): Promise<WeekDigest[]> {
  return await cached(env, "cache:week-digests", 300, async () => {
    const [weeks, portals, caps, published, entries] = await Promise.all([listWeeks(env), listPortals(env), sitemapCaptures(env), publishedCaptures(env), changes(env)]);
    const plans = await planChanges(env);
    const order = new Map(portals.map((p, i) => [p.slug, i]));
    const names = new Map(portals.map((p) => [p.slug, p.name]));
    const byOrder = (a: { slug: string }, b: { slug: string }) => order.get(a.slug)! - order.get(b.slug)!;
    return weeks.map(({ week }) => {
      const mine = caps.filter((c) => c.week === week && names.has(c.slug)).sort(byOrder);
      const pub = published.filter((r) => r.week === week && isPublishedAnalysis(r));
      const changed: DigestPortal[] = [];
      for (const e of entries) {
        if (e.week !== week || !names.has(e.slug)) continue;
        let p = changed.find((x) => x.slug === e.slug);
        if (!p) changed.push((p = { slug: e.slug, name: e.name, previousWeek: e.previousWeek, changes: [] }));
        p.changes.push({ phrase: e.phrase, sentence: e.sentence, weight: e.weight ?? 0 });
      }
      changed.sort(byOrder);
      const planChanged = plans.filter((e) => e.week === week && names.has(e.slug)).map((e) => ({ slug: e.slug, name: names.get(e.slug)! })).sort(byOrder);
      const times = [...mine.map((c) => c.captured_at), ...pub.map((r) => r.analysis_published_at)].map((t) => Date.parse(t ?? "")).filter((n) => !Number.isNaN(n));
      const images = changed
        .map((p) => mine.find((c) => c.slug === p.slug))
        .filter((c): c is NonNullable<typeof c> => !!c?.r2_key)
        .map((c) => ({ key: c.r2_key!, slug: c.slug, capturedAt: c.captured_at }));
      return {
        week,
        captured: mine.map((c) => ({ slug: c.slug, name: names.get(c.slug)! })),
        published: pub.length,
        changed,
        planChanged,
        indexable: !SYSTEM_TEST_WEEKS.includes(week) && pub.length > 0,
        ...(times.length ? { lastmod: new Date(Math.max(...times)).toISOString().replace(/\.\d{3}Z$/, "Z") } : {}),
        images,
      };
    });
  });
}

/** "the sidebar item More is now labeled Explore." -> "the sidebar item More is now labeled Explore" */
const clause = (sentence: string) => sentence.replace(/\.$/, "");

/** The most notable change of each changed portal (renames first, then added or removed items, src/nav-changes.ts), at most `max` portals. */
export function notableChanges(d: WeekDigest, max = 3): { name: string; sentence: string }[] {
  return d.changed
    .map((p, i) => ({ i, name: p.name, top: p.changes.reduce((best, c) => (c.weight > best.weight ? c : best)) }))
    .sort((a, b) => b.top.weight - a.top.weight || a.i - b.i)
    .slice(0, max)
    .map((x) => ({ name: x.name, sentence: x.top.sentence }));
}

/** The paragraph at the top of a weekly digest, also its meta description (shortened) and Markdown summary. */
export function weekSummary(d: WeekDigest): string {
  const when = `In the week of ${weekInWords(d.week)}`;
  if (!d.captured.length) return `${when}, no AI portals were captured.`;
  const out = [`${when}, AI Interface Library captured ${plural(d.captured.length, "AI portal", "AI portals")}.`];
  if (!d.published) {
    out.push("Their design analyses are not published yet, so no menu changes are recorded.");
  } else if (!d.changed.length) {
    out.push("No menu changes were recorded compared with the week before.");
  } else {
    out.push(`${d.changed.length} of them had menu changes compared with the week before.`);
    const top = notableChanges(d);
    out.push(`${top.length === 1 ? "Most notable change" : "Most notable changes"}: ${top.map((t) => `in ${t.name}, ${clause(t.sentence)}`).join("; ")}.`);
  }
  return out.join(" ");
}

/** One line for the /weeks index and llms.txt: "15 portals captured, 3 with menu changes". */
export function weekLine(d: WeekDigest): string {
  const captured = `${plural(d.captured.length, "portal", "portals")} captured`;
  if (!d.published) return `${captured}, analyses not published yet`;
  return `${captured}, ${d.changed.length ? `${d.changed.length} with menu changes` : "no menu changes"}`;
}

/** The newest indexable digest week, for the links from the homepage and /changes. */
export function latestIndexableWeek(digests: WeekDigest[]): string | null {
  return digests.find((d) => d.indexable)?.week ?? null;
}

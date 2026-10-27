// /facts (src/facts-page.ts): a few short facts per active portal from its latest published analysis. Built
// only from listPortals() and captureMetrics() data; the latest menu change comes from changeEntries(), the
// same rules as the portal timeline and /changes (model-picker normalization, only "changed" N1 entries, so
// possibly_confounded and confounded weeks are left out, and so is a week whose account plan changed, src/plan.ts).
// Nothing new is generated.
import type { Env } from "./types";
import { listPortals, publishedCaptures } from "./db";
import { cached } from "./api";
import { isPublishedAnalysis, SYSTEM_TEST_WEEKS } from "./analysis";
import { captureMetrics, type CaptureMetrics } from "./capture-metrics";
import { changeEntries } from "./nav-changes";
import { POPULAR_PAIRINGS } from "./compare";
import { isPlan, type Plan } from "./plan";

export type PortalFacts = {
  slug: string;
  name: string;
  /** The week of the analysis the facts come from; null without a published analysis. */
  week: string | null;
  /** The account plan of that capture (src/plan.ts); null when unknown. */
  plan: Plan | null;
  /** "A sidebar, 9 menu items, message box in the middle third of the screen."; null when all three are missing. */
  layout: string | null;
  /** "3 suggested prompts, a note about the AI's limits is shown."; null when both are missing. */
  start: string | null;
  /** The newest week with recorded menu changes, and its changes as timeline phrases. */
  latestChange: { week: string; phrases: string[] } | null;
  /** The most compared other active portal (POPULAR_PAIRINGS), for its /compare page. */
  compareWith: { slug: string; name: string } | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sentence = (parts: (string | null)[]): string | null => {
  const kept = parts.filter((p): p is string => !!p);
  if (!kept.length) return null;
  const s = kept.join(", ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
};

/** Sidebar, number of menu items and message box position; each part is skipped when its value is missing. */
export function layoutFact(m: CaptureMetrics): string | null {
  const sidebar = m.sidebarPct === null ? null
    : m.sidebarPct === 0 ? "no sidebar"
    : m.navSidebarVisible === false ? "a collapsed sidebar" : "a sidebar";
  const items = m.navItems?.length ? plural(m.navItems.length, "menu item", "menu items") : null;
  const input = m.inputPosition ? `message box in the ${m.inputPosition} third of the screen` : null;
  return sentence([sidebar, items, input]);
}

/**
 * Suggested prompts and the note about the AI's limits; each part is skipped when its value is missing. The color
 * scheme is left out: it follows the capture machine's system setting, not the product.
 */
export function startFact(m: CaptureMetrics): string | null {
  const prompts = m.suggestedPrompts === null ? null
    : m.suggestedPrompts === 0 ? "no suggested prompts" : plural(m.suggestedPrompts, "suggested prompt", "suggested prompts");
  const note = m.aiNote === null ? null : m.aiNote ? "a note about the AI's limits is shown" : "no note about the AI's limits";
  return sentence([prompts, note]);
}

/** One entry per active portal, in the homepage chips' order (listPortals()). */
export async function portalFacts(env: Env): Promise<PortalFacts[]> {
  return await cached(env, "cache:facts", 300, async () => {
    const [portals, rows] = await Promise.all([listPortals(env), publishedCaptures(env)]);
    const active = new Map(portals.map((p) => [p.slug, p]));
    const changes = changeEntries(rows); // newest week first
    return portals.map((p) => {
      // rows are newest week first per portal: the first one with metrics is the latest published analysis.
      let week: string | null = null, plan: Plan | null = null, m: CaptureMetrics | null = null;
      for (const r of rows) {
        if (r.slug !== p.slug || SYSTEM_TEST_WEEKS.includes(r.week) || !isPublishedAnalysis(r)) continue;
        m = captureMetrics(r);
        if (m) { week = r.week; plan = isPlan(r.plan) ? r.plan : null; break; }
      }
      const mine = changes.filter((e) => e.slug === p.slug);
      const latest = mine[0]?.week;
      const partner = POPULAR_PAIRINGS.find((s) => s !== p.slug && active.has(s));
      return {
        slug: p.slug,
        name: p.name,
        week,
        plan,
        layout: m ? layoutFact(m) : null,
        start: m ? startFact(m) : null,
        latestChange: latest ? { week: latest, phrases: mine.filter((e) => e.week === latest).map((e) => e.phrase) } : null,
        compareWith: partner ? { slug: partner, name: active.get(partner)!.name } : null,
      };
    });
  });
}

/** The newest week any entry comes from ("Last updated", dateModified, the sitemap <lastmod>); null when there is none. */
export function factsUpdated(facts: PortalFacts[]): string | null {
  return facts.map((f) => f.week).filter((w): w is string => !!w).sort().at(-1) ?? null;
}

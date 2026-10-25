// Plain-English menu (N1) facts for /changes, the Markdown pages and /llms-full.txt. Built only from
// captureMetrics() output (src/capture-metrics.ts), so nothing beyond its whitelisted names is shown.
// public/analytics-canvas.js words the same changes for the canvas; tests/unit/aeo.test.ts checks they agree.
import { captureMetrics, type NavChange, type NavItem } from "./capture-metrics";
import { isPublishedAnalysis, SYSTEM_TEST_WEEKS } from "./analysis";
import type { PublishedCapture } from "./db";

const article = (region: string) => (/^[aeiou]/.test(region) ? "an" : "a");

/** One change as a sentence that continues after "<Portal>: ", e.g. "the sidebar item Scheduled is now labeled Tasks." */
export function navChangeSentence(c: NavChange): string {
  if (c.picker) return c.change === "added" ? "a model picker now appears in the input area." : "the model picker no longer appears in the input area.";
  if (c.change === "icon_changed") return `the icon of ${article(c.region)} ${c.region} button changed (${c.previous} → ${c.current}).`;
  if (c.icon) {
    return c.change === "added"
      ? `an icon button (${c.current}) now appears in the ${c.region}.`
      : `an icon button (${c.previous}) no longer appears in the ${c.region}.`;
  }
  if (c.change === "renamed") return `the ${c.region} item ${c.previous} is now labeled ${c.current}.`;
  if (c.change === "added") return `a new ${c.current} item appears in the ${c.region}.`;
  return `the ${c.previous} item no longer appears in the ${c.region}.`;
}

/** One change as a short phrase for a timeline line, e.g. "Scheduled renamed to Tasks" or "Upgrade removed from the top bar". */
export function navChangePhrase(c: NavChange): string {
  const p = (() => {
    if (c.picker) return c.change === "added" ? "model picker added to the input area" : "model picker removed from the input area";
    if (c.change === "icon_changed") return `${c.region} button icon changed (${c.previous} → ${c.current})`;
    if (c.icon) {
      return c.change === "added"
        ? `icon button (${c.current}) added to the ${c.region}`
        : `icon button (${c.previous}) removed from the ${c.region}`;
    }
    if (c.change === "renamed") return `${c.previous} renamed to ${c.current}`;
    if (c.change === "added") return `${c.current} added to the ${c.region}`;
    return `${c.previous} removed from the ${c.region}`;
  })();
  return p[0].toUpperCase() + p.slice(1);
}

/** How notable a change is, for a weekly digest's summary: a rename, then an added or removed item, then the model picker, then an icon button. */
export function navChangeWeight(c: NavChange): number {
  if (c.picker) return 1;
  if (c.icon) return 0;
  return c.change === "renamed" ? 3 : 2;
}

/** A menu item as shown in text: its name, "a model picker", or "an icon button (clock icon)" for an item without text. */
export function navItemName(it: NavItem): string {
  if (it.picker) return `a ${it.label}`;
  return it.icon ? `an icon button (${it.label})` : it.label;
}

export type ChangeEntry = { slug: string; name: string; week: string; previousWeek: string; sentence: string; phrase: string; weight: number; publishedAt: string | null };

/**
 * Every recorded menu change in published analyses, newest week first (portal order within a week).
 * Rows come from publishedCaptures(); system-test weeks and unpublished analyses are left out.
 */
export function changeEntries(rows: PublishedCapture[]): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const r of rows) {
    if (SYSTEM_TEST_WEEKS.includes(r.week) || !isPublishedAnalysis(r)) continue;
    const nc = captureMetrics(r)?.navChanges;
    if (!nc) continue;
    for (const c of nc.items) {
      out.push({ slug: r.slug, name: r.name, week: r.week, previousWeek: nc.previousWeek, sentence: navChangeSentence(c), phrase: navChangePhrase(c), weight: navChangeWeight(c), publishedAt: r.analysis_published_at });
    }
  }
  // Stable sort keeps portal order (and each analysis's own order) within a week.
  return out.sort((a, b) => (a.week === b.week ? 0 : a.week < b.week ? 1 : -1));
}

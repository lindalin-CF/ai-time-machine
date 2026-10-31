// What the voice guide knows, and how it is told to answer (src/voice.ts). Built only from published
// guideline analyses (isPublishedAnalysis) and the whitelisted captureMetrics() fields, the same data
// the public pages, /changes and /llms-full.txt show. No other text from analysis_json is used.
import type { Env, PortalRow } from "./types";
import { listPortals, type PublishedCapture } from "./db";
import { cached } from "./api";
import { isPublishedAnalysis, FIXED_SUMMARY_OPENING, SYSTEM_TEST_WEEKS } from "./analysis";
import { captureMetrics, type CaptureMetrics } from "./capture-metrics";
import { changeEntries, regionName, type ChangeEntry } from "./nav-changes";
import { weekInWords } from "./format";

/** The context is cut to this many characters (oldest weeks first) so the prompt stays fast. */
export const VOICE_CONTEXT_MAX = 24_000;

/** Words the speech recognizer should favour: every active portal name and company, plus the site's own terms. */
export const VOICE_TERMS = ["portal", "sidebar", "menu", "message box", "suggested prompts"] as const;
export function voiceKeyterms(portals: Pick<PortalRow, "name" | "company">[]): string[] {
  return [...new Set([...portals.flatMap((p) => [p.name, p.company]), ...VOICE_TERMS].map((t) => t.trim()).filter(Boolean))];
}

export const FLUX_MODEL = "@cf/deepgram/flux";

/** The part of the AI binding the Flux transcriber uses (@cloudflare/voice's AiLike). */
export type AiRunner = { run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };

/**
 * The AI binding as the Flux transcriber sees it: every Flux session gets all voice keyterms (active
 * portal names and companies from D1, plus the site terms), cached for an hour. Other models pass through.
 *
 * TODO: @cloudflare/voice 0.3.5 accepts a `keyterms` option but sends only its first entry
 * (`input.keyterm = keyterms[0]`). A test on 2026-10-10 showed the Workers AI binding accepts an array
 * and boosts every term in it, so this adds the array itself. Switch to WorkersAIFluxSTT's `keyterms`
 * option once @cloudflare/voice sends them all.
 */
export function fluxWithKeyterms(env: Env, ai: AiRunner = env.AI as unknown as AiRunner): AiRunner {
  return {
    async run(model, input, options) {
      if (model === FLUX_MODEL) {
        try {
          const terms = await cached(env, "cache:voice-keyterms", 3600, async () => voiceKeyterms(await listPortals(env)));
          if (terms.length) input = { ...input, keyterm: terms };
        } catch (err) {
          console.error("[voice] keyterms unavailable; transcribing without them:", err);
        }
      }
      return ai.run(model, input, options);
    },
  };
}

type Row = PublishedCapture & { metrics: CaptureMetrics | null };

const yesNo = (b: boolean | null | undefined) => (b == null ? "?" : b ? "yes" : "no");
const num = (n: number | null | undefined) => (n == null ? "?" : String(n));

// Summary sentences that only restate what the measures line and the menu changes already give
// (sidebar width, message box size, the note about AI mistakes, a menu change) are left out to keep the
// prompt short. A sentence is judged by its published `sources` metric IDs; only its text is ever used.
const MEASURED = new Set(["L2", "H2", "D6", "N1"]);
const COVERED = new Set([...MEASURED, "L1"]);

/** A summary sentence that compares with another week ("... than in the week of 2026-09-28."). */
const COMPARES = /\bweek of \d{4}-\d{2}-\d{2}\b/;

/**
 * The published summary for the prompt, split in two: the description (without the fixed opening and
 * without sentences the measures cover) and the sentences that compare with an earlier week.
 */
function summaryParts(r: PublishedCapture): { body: string; comparisons: string[]; compared: { text: string; sources: string[] }[] } {
  let sentences: { text: string; sources: string[] }[] = [];
  try {
    const parsed = JSON.parse(r.analysis_json || "null") as { summary_sentences?: { text?: unknown; sources?: unknown }[] } | null;
    sentences = (parsed?.summary_sentences ?? []).flatMap((x) =>
      typeof x?.text === "string" && x.text.trim()
        ? [{ text: x.text.trim(), sources: Array.isArray(x.sources) ? x.sources.filter((v): v is string => typeof v === "string") : [] }]
        : []);
  } catch { /* fall back to the summary text */ }
  if (!sentences.length) sentences = r.analysis.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((text) => ({ text, sources: [] }));
  const kept = sentences
    .filter((x, i) => !(i === 0 && FIXED_SUMMARY_OPENING.test(x.text)))
    .filter((x) => !(x.sources.length && x.sources.every((id) => COVERED.has(id)) && x.sources.some((id) => MEASURED.has(id))));
  const compared = kept.filter((x) => COMPARES.test(x.text));
  return { body: kept.filter((x) => !COMPARES.test(x.text)).map((x) => x.text).join(" "), comparisons: compared.map((x) => x.text), compared };
}

/** Labelled menu items by region; icon buttons without text are only counted, to keep the prompt short. */
function menuLine(m: CaptureMetrics | null): string {
  if (!m?.navItems?.length) return "";
  const regions = (["sidebar", "top bar", "input area"] as const).flatMap((r) => {
    const items = m.navItems!.filter((it) => it.region === r);
    if (!items.length) return [];
    const names = items.filter((it) => !it.icon).map((it) => it.label);
    const icons = items.length - names.length;
    const iconText = icons ? `${icons} icon button${icons === 1 ? "" : "s"}` : "";
    return [`in ${regionName(r)}: ${[names.join(", "), iconText].filter(Boolean).join(names.length ? " and " : "")}`];
  });
  return `Menu items, ${regions.join("; ")}${m.navSidebarVisible === false ? " (the side menu is collapsed, its items not visible)" : ""}.`;
}

/**
 * One history entry: "2026-10-05: 20, 3.3, middle, 23, 3, no". The color scheme is left out of the voice guide: it
 * follows the capture machine's system setting, not the product.
 */
function historyEntry(r: Row): string {
  const m = r.metrics;
  return `${r.week}: ${num(m?.sidebarPct)}, ${num(m?.inputAreaPct)}, ${m?.inputPosition ?? "?"}, ${num(m?.clickableApprox)}, ${num(m?.suggestedPrompts)}, ${yesNo(m?.aiNote)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-05" -> "Oct 5" (the year is added when it isn't `year`). */
export function shortWeek(week: string, year = week.slice(0, 4)): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
  if (!m) return week;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}${m[1] === year ? "" : `, ${m[1]}`}`;
}

type Latest = { name: string; row: Row };

/**
 * "Which products ..." answers, worked out in code from each product's latest analysis: every product
 * in each group, with counts. A product whose latest analysis is from another week says so.
 */
export function productGroups(latest: Latest[]): string[] {
  if (!latest.length) return [];
  const weeks = latest.map((l) => l.row.week);
  const week = weeks.sort()[weeks.length - 1];
  const total = latest.length;
  const name = (l: Latest) => (l.row.week === week ? l.name : `${l.name} (week of ${shortWeek(l.row.week, week.slice(0, 4))})`);
  const group = (label: string, test: (m: CaptureMetrics | null) => boolean) => {
    const names = latest.filter((l) => test(l.row.metrics)).map(name);
    return `${label}: ${names.length ? names.join(", ") : "none"} (${names.length} of ${total}).`;
  };
  const unknown = (label: string, test: (m: CaptureMetrics | null) => boolean) => {
    const names = latest.filter((l) => test(l.row.metrics)).map(name);
    return names.length ? ` ${label}: ${names.join(", ")} (${names.length} of ${total}).` : "";
  };
  const when = `(latest analyses, week of ${shortWeek(week)})`;
  return [
    `- Note that the AI can make mistakes ${when}: ${group("Shown", (m) => m?.aiNote === true)} ${group("Not shown", (m) => m?.aiNote === false)}${unknown("Not measured", (m) => m?.aiNote == null)}`,
    `- Sidebar ${when}: ${group("Has a sidebar", (m) => (m?.sidebarPct ?? 0) > 0)} ${group("No sidebar", (m) => m?.sidebarPct === 0)}${unknown("Not measured", (m) => m?.sidebarPct == null)}`,
    `- Message box position ${when}: ${group("Top third", (m) => m?.inputPosition === "top")} ${group("Middle third", (m) => m?.inputPosition === "middle")} ${group("Bottom third", (m) => m?.inputPosition === "bottom")}${unknown("Not measured", (m) => !m?.inputPosition)}`,
  ];
}

// Week-to-week thresholds from the guideline (SKILL.md section 9.3).
type Metric = { label: string; get: (m: CaptureMetrics) => string | number | boolean | null; differs: (a: never, b: never) => boolean; show: (v: never) => string };
const metric = <T extends string | number | boolean>(label: string, get: (m: CaptureMetrics) => T | null, differs: (a: T, b: T) => boolean, show: (v: T) => string = String): Metric =>
  ({ label, get, differs, show } as unknown as Metric);
const TRACKED: Metric[] = [
  metric("sidebar width", (m) => m.sidebarPct, (a, b) => Math.abs(a - b) >= 5 || (a === 0) !== (b === 0), (v) => `${v}%`),
  metric("message box size", (m) => m.inputAreaPct, (a, b) => Math.abs(a - b) >= 1, (v) => `${v}%`),
  metric("message box position", (m) => m.inputPosition, (a, b) => a !== b, (v) => `${v} third`),
  metric("clickable items", (m) => m.clickableApprox, (a, b) => Math.abs(a - b) >= 3),
  metric("suggested prompts", (m) => m.suggestedPrompts, (a, b) => a !== b),
  metric("note about AI mistakes", (m) => m.aiNote, (a, b) => a !== b, (v) => (v ? "shown" : "not shown")),
];

/**
 * One product's changes across its analysed weeks, worked out in code: each measure that moved past
 * its guideline threshold, as a chain of values with the week each new value was first seen, then its
 * menu changes and the summary sentences that say how a week differs from the one before.
 */
/** Each value a measure moved to past its threshold, with the value before and the week it was first seen. */
function metricSteps(t: Metric, ordered: Row[]): { week: string; from: string; to: string }[] {
  let current: unknown = null;
  const steps: { week: string; from: string; to: string }[] = [];
  for (const r of ordered) {
    const v = r.metrics ? t.get(r.metrics) : null;
    if (v == null) continue;
    if (current == null) { current = v; continue; }
    if (t.differs(current as never, v as never)) {
      steps.push({ week: r.week, from: t.show(current as never), to: t.show(v as never) });
      current = v;
    }
  }
  return steps;
}

/** Menu changes and the summary sentences that say how a week differs from the one before (not "the same as" ones). */
function datedChanges(ordered: Row[], menu: ChangeEntry[]): { week: string; text: string }[] {
  return [
    ...menu.map((c) => ({ week: c.week, text: c.sentence.replace(/\.$/, "") })),
    ...ordered.flatMap((r) => summaryParts(r).comparisons
      .filter((c) => !/\b(?:is|are|looks|look|stays|stay) the same\b/i.test(c)) // "no change" sentences
      .map((c) => ({ week: r.week, text: c.replace(/\.$/, "") }))),
  ].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
}

/** Dates written inside a sentence ("the week of 2026-09-28") in the same short form as the rest. */
const shortDates = (text: string, year: string) => text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => shortWeek(d, year));

export function productChanges(name: string, rows: Row[], menu: ChangeEntry[]): string {
  const ordered = [...rows].sort((a, b) => (a.week < b.week ? -1 : 1)); // oldest first
  if (!ordered.length) return "";
  const year = ordered.at(-1)!.week.slice(0, 4);
  const at = (week: string) => `(${shortWeek(week, year)})`;
  const parts: string[] = [];
  for (const t of TRACKED) {
    const steps = metricSteps(t, ordered);
    if (steps.length) parts.push(`${t.label} ${steps[0].from} \u2192 ${steps.map((st) => `${st.to} ${at(st.week)}`).join(" \u2192 ")}`);
  }
  // Dated changes lead with the week they were seen; dates inside a sentence are shortened the same way.
  parts.push(...datedChanges(ordered, menu).map((d) => `seen ${shortWeek(d.week, year)}: ${shortDates(d.text, year)}`));
  const span = ordered.length === 1 ? `week of ${shortWeek(ordered[0].week)}` : `${ordered.length} weeks, ${shortWeek(ordered[0].week, year)} to ${shortWeek(ordered.at(-1)!.week)}`;
  if (ordered.length === 1) return `- ${name}: Only one week analyzed (${span}), so there is nothing to compare yet.`;
  return parts.length ? `- ${name} changes (${span}): ${parts.join("; ")}.` : `- ${name}: No changes recorded across ${ordered.length} weeks (${shortWeek(ordered[0].week, year)} to ${shortWeek(ordered.at(-1)!.week)}).`;
}

type ChangeStatus = "changed" | "possibly_confounded" | "confounded";
const STATUSES: readonly string[] = ["changed", "possibly_confounded", "confounded"];

/** How the analysis judged each metric's change against the week before (IDs and status only; N1 is handled separately). */
function changeStatuses(r: PublishedCapture): Map<string, ChangeStatus[]> {
  const out = new Map<string, ChangeStatus[]>();
  try {
    const parsed = JSON.parse(r.analysis_json || "null") as { changes_vs_previous?: { id?: unknown; status?: unknown }[] } | null;
    for (const c of parsed?.changes_vs_previous ?? []) {
      if (typeof c?.id !== "string" || c.id === "N1" || typeof c.status !== "string" || !STATUSES.includes(c.status)) continue;
      out.set(c.id, [...(out.get(c.id) ?? []), c.status as ChangeStatus]);
    }
  } catch { /* no statuses */ }
  return out;
}

/**
 * One status for a set of metric IDs: "changed" if any of them changed, else "possibly_confounded" if any
 * might come from the visit (rotating greetings, pop-ups, promotions), else "confounded" or none.
 * `fallback`: with no matching ID, judge by all of the analysis's own changes (sentences that cite
 * changes_vs_previous itself).
 */
function statusOf(statuses: Map<string, ChangeStatus[]>, ids: string[], fallback = false): ChangeStatus | null {
  let found = ids.flatMap((id) => statuses.get(id) ?? []);
  if (!found.length && fallback) found = [...statuses.values()].flat();
  for (const st of ["changed", "possibly_confounded", "confounded"] as const) if (found.includes(st)) return st;
  return null;
}

// The metric each measured change is judged by, so "this week" follows the analysis's own status.
const METRIC_ID: Record<string, string> = {
  "sidebar width": "L2", "message box size": "H2", "message box position": "L3",
  "clickable items": "L4", "suggested prompts": "D5", "note about AI mistakes": "D6",
};

/**
 * "This week" answers, worked out in code: only the changes first seen in the latest week, per product,
 * each compared with that product's previous analysed week. Products whose latest analysis is from an
 * earlier week are named with their week instead of being counted as unchanged.
 */
export function thisWeekChanges(latest: Latest[], rowsOf: (name: string) => Row[], menuOf: (name: string) => ChangeEntry[]): string[] {
  if (!latest.length) return [];
  const week = latest.map((l) => l.row.week).sort().at(-1)!;
  const year = week.slice(0, 4);
  const lines: string[] = [];
  const unchanged: string[] = [], first: string[] = [], older: string[] = [], rotating: string[] = [];
  for (const l of latest) {
    if (l.row.week !== week) { older.push(`${l.name} (latest analysis: week of ${shortWeek(l.row.week, year)})`); continue; }
    const ordered = [...rowsOf(l.name)].sort((a, b) => (a.week < b.week ? -1 : 1));
    const previous = ordered.at(-2)?.week;
    if (!previous) { first.push(l.name); continue; }
    // Only what the analysis judged "changed" counts; "possibly_confounded" (text that may rotate between
    // visits, pop-ups, promotions) is named on one line; "confounded" is left out.
    const statuses = changeStatuses(l.row);
    const items: string[] = [];
    let mayRotate = false;
    const sort = (status: ChangeStatus | null, text: string) => {
      if (status === "changed") items.push(text);
      else if (status === "possibly_confounded") mayRotate = true;
    };
    for (const t of TRACKED) {
      for (const st of metricSteps(t, ordered).filter((x) => x.week === week)) sort(statusOf(statuses, [METRIC_ID[t.label]]), `${t.label} ${st.from} \u2192 ${st.to}`);
    }
    for (const c of menuOf(l.name).filter((c) => c.week === week)) items.push(c.sentence.replace(/\.$/, "")); // menu changes are "changed" only
    for (const c of summaryParts(l.row).compared) {
      if (/\b(?:is|are|looks|look|stays|stay) the same\b/i.test(c.text)) continue;
      sort(statusOf(statuses, c.sources, true), shortDates(c.text.replace(/\.$/, ""), year));
    }
    if (mayRotate) rotating.push(l.name);
    if (items.length) lines.push(`- ${l.name} (compared with ${shortWeek(previous, year)}): ${items.join("; ")}.`);
    else unchanged.push(l.name);
  }
  return [
    ...lines,
    `- No changes this week: ${unchanged.length ? unchanged.join(", ") : "none"}.`,
    ...(rotating.length ? [`- Text or content that may rotate between visits (greetings, headings, pop-ups, promotions) also differs for: ${rotating.join(", ")}. These are not counted as changes.`] : []),
    ...(first.length ? [`- First analysed this week, nothing to compare yet: ${first.join(", ")}.`] : []),
    ...(older.length ? [`- Not analysed this week, so not part of this week's changes: ${older.join(", ")}.`] : []),
  ];
}

/**
 * The library data block for the system prompt. `links` adds each page's path (typed answers cite
 * them; spoken answers never read addresses). Longer than `max`: the history and menu changes lose
 * their oldest weeks first, and `log` is told what was dropped.
 */
export function buildVoiceContext(
  portals: Pick<PortalRow, "slug" | "name" | "company">[],
  published: PublishedCapture[],
  opts: { links?: boolean; max?: number; log?: (msg: string) => void } = {},
): string {
  const max = opts.max ?? VOICE_CONTEXT_MAX;
  const path = (p: string) => (opts.links ? ` [${p}]` : "");
  const rows: Row[] = published
    .filter((r) => !SYSTEM_TEST_WEEKS.includes(r.week) && isPublishedAnalysis(r))
    .map((r) => ({ ...r, metrics: captureMetrics(r) }));
  const bySlug = new Map<string, Row[]>();
  for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r]);
  for (const list of bySlug.values()) list.sort((a, b) => (a.week < b.week ? 1 : -1)); // newest first
  const weeks = [...new Set(rows.map((r) => r.week))].sort().reverse();
  const changes = changeEntries(published);

  const head = [
    "LIBRARY DATA",
    `Products tracked (${portals.length}): ${portals.map((p) => `${p.name} (${p.company})`).join(", ")}.`,
    weeks.length
      ? `Published analyses cover ${weeks.length} weeks, from the week of ${weekInWords(weeks.at(-1)!)} to the week of ${weekInWords(weeks[0])}.`
      : "No published analyses yet.",
  ];

  const latest: string[] = [];
  const latestRows: Latest[] = [];
  for (const p of portals) {
    const r = bySlug.get(p.slug)?.[0];
    if (!r) continue;
    latestRows.push({ name: p.name, row: r });
    const menu = menuLine(r.metrics);
    // The page path already names the week; spoken context has no paths, so it names the week itself.
    const where = opts.links ? path(`/portals/${p.slug}/${r.week}`) : `, week of ${r.week}`;
    latest.push(`- ${p.name}${where}: ${summaryParts(r).body}${menu ? ` ${menu}` : ""}`);
  }
  const groups = productGroups(latestRows);

  const render = (keep: string[]): string => {
    const kept = new Set(keep);
    const changeLines = changes.filter((c) => kept.has(c.week))
      .map((c) => `- Week of ${weekInWords(c.week)} (compared with ${weekInWords(c.previousWeek)}), ${c.name}: ${c.sentence}${path(`/portals/${c.slug}/${c.week}`)}`);
    // Each product's latest week always stays: it carries the numbers for "which has the largest ..." questions.
    const keptRows = (slug: string) => (bySlug.get(slug) ?? []).filter((r, i) => i === 0 || kept.has(r.week));
    const history = portals.flatMap((p) => {
      const list = keptRows(p.slug);
      return list.length ? [`- ${p.name}: ${list.map(historyEntry).join("; ")}`] : [];
    });
    const slugOf = new Map(portals.map((p) => [p.name, p.slug]));
    const thisWeek = thisWeekChanges(latestRows, (name) => bySlug.get(slugOf.get(name)!) ?? [], (name) => changes.filter((c) => c.slug === slugOf.get(name)));
    const perProduct = portals.flatMap((p) => {
      const list = keptRows(p.slug);
      return list.length ? [productChanges(p.name, list, changes.filter((c) => c.slug === p.slug && kept.has(c.week)))] : [];
    });
    // Most important first: if the text ever has to be cut, the cut falls in the history at the end.
    return [
      ...head,
      "",
      "PRODUCT GROUPS, every product in each group, worked out from each product's latest analysis",
      ...(groups.length ? groups : ["- No published analyses yet."]),
      "",
      `THIS WEEK'S CHANGES${weeks.length ? `, week of ${shortWeek(weeks[0])}` : ""}: only changes first seen in the latest week, each compared with that product's previous analysed week`,
      ...(thisWeek.length ? thisWeek : ["- No published analyses yet."]),
      "",
      "CHANGES PER PRODUCT, every change worked out across all analysed weeks (the week in brackets is when it was first seen)",
      ...(perProduct.length ? perProduct : ["- No published analyses yet."]),
      "",
      `MENU CHANGES, newest first${path("/changes")}`,
      ...(changeLines.length ? changeLines : ["- None recorded."]),
      "",
      `LATEST ANALYSIS PER PRODUCT${opts.links ? " (the week is in each page path)" : ""}`,
      ...latest,
      "",
      "WEEKLY MEASURES PER PRODUCT, newest week first. Each entry is week: sidebar width as % of the screen width, message box area as % of the screen, vertical third the message box sits in, approximate number of clickable items, number of suggested prompts, note about AI mistakes shown (? means not measured).",
      ...history,
    ].join("\n");
  };

  for (let n = weeks.length; n >= 1; n--) {
    const text = render(weeks.slice(0, n));
    if (text.length <= max) {
      if (n < weeks.length) opts.log?.(`[voice] context over ${max} chars; history and menu changes before the week of ${weeks[n - 1]} were left out (${text.length} chars kept).`);
      return text;
    }
  }
  const text = render(weeks.slice(0, 1));
  opts.log?.(`[voice] context still ${text.length} chars with only the latest week; cut to ${max}.`);
  return text.slice(0, max);
}

/** System prompt for one turn. `spoken`: the question came from the microphone and the answer will be read aloud. */
export function voiceSystemPrompt(context: string, spoken: boolean): string {
  return [
    'You are the guide for "AI Interface Library", a website that each week captures the signed-in desktop home screen',
    "of AI products (1280 by 800 pixels, before scrolling). Kimi is captured signed out. Each capture gets a short design",
    "analysis, and a person reviews every analysis before it is published.",
    "",
    "You can answer questions about: layout, what stands out most, text and color, where the user starts (message box,",
    "suggested prompts, notes about AI mistakes), menu items and how they changed week to week, comparisons between",
    "products, and which products are tracked.",
    "",
    "Answering rules:",
    "- Use ONLY the library data below. Never invent products, numbers, menu items or changes. If something is not in the",
    "  data, say it has not been captured or measured.",
    "- When comparing, give the specific numbers from the data (for example the message box's share of the screen).",
    "- When describing a change, say which week it was seen in, written out (for example \"the week of October 5, 2026\").",
    "- For questions about menu items, use only the \"Menu items\" lists. A product without such a list has no menu data:",
    "  say so instead of guessing.",
    "- For \"which products\" questions, answer from PRODUCT GROUPS, and for questions about changes, answer from CHANGES",
    "  PER PRODUCT. These lists are already complete: name every product or change they give, with the count, and never",
    "  pick only some of them (when the answer is read aloud, the three-item rule below applies, and the rest follow on",
    "  request). For a change question about one product, include every item on its line and every step of each",
    "  \"a -> b (week) -> c (week)\" chain, in order.",
    "- Only describe what is visible. Do not judge usability or design quality (no \"user-friendly\", \"intuitive\",",
    "  \"clean\", \"better\"), do not predict what users will do, do not guess design intent, and do not call a change a",
    "  redesign, launch or new feature.",
    "- Do not say whether a product uses a dark or light theme or mode. If asked, say the screenshots follow the color",
    "  setting of the computer that took them, so the library does not record a product's color scheme.",
    "- Do not mention databases, JSON, context or that you were given data.",
    "- Always write plain text. Never use Markdown: no bold or italics, no headings, no bullet or numbered lists, no",
    "  backticks, no tables. To list things, use full sentences or separate the items with commas.",
    "- \"This week\" means the latest week. For questions about this week, answer only from THIS WEEK'S CHANGES and name",
    "  its week; changes listed there are compared with each product's previous analysed week. Do not use older changes.",
    "  Give the real changes first. Then always add one short sentence naming the products whose text or content may",
    "  rotate between visits (for example \"Text that may rotate between visits also differs for ChatGPT and Gemini.\"),",
    "  and do not describe those differences as changes.",
    "",
    "Understanding the question:",
    "- Questions often come from speech recognition and can contain misheard words, or typos. Product names and site terms",
    "  may be heard as words that sound alike: \"potter\" is probably \"portal\", \"dark sea\" is probably \"DeepSeek\",",
    "  \"switch button\" may be \"which portals\". Use the product list in the data to guess what was meant.",
    "- When you had to guess, start the answer with one short sentence that says what you understood, for example",
    "  \"If you're asking about DeepSeek: ...\".",
    "- If the question is only a product name or a few words (for example \"CoPilot.\"), do not describe the product. Reply",
    "  with one question only: which aspect they want, its layout, its menu items, or its recent changes.",
    "- If the user sounds frustrated or says it doesn't work (for example \"It don't work\"), first say in one sentence",
    "  what you can answer and give one example question, such as \"Which products show a note that the AI can make",
    "  mistakes?\". Then answer what they asked, if you can tell what it was: \"What is switch button do you track?\" is",
    "  most likely \"Which portals do you track?\", so list the tracked products.",
    "",
    ...(spoken
      ? [
          "This answer will be read aloud:",
          "- Answer in English, in one to three short sentences unless asked for more.",
          "- When listing, say at most three items, then ask \"Want me to go through the rest?\" if there are more. If the user",
          "  says yes, continue with the next three. This also applies to this-week, which-products and change answers: say how",
          "  many there are in total, give the first three with what changed for each (not just the product names), and ask.",
          "  Skip the rotating-text sentence until the list is done.",
          "- Never read out web addresses or page paths.",
        ]
      : [
          "This question was typed:",
          "- Answer in the language of the question (for example Chinese for a Chinese question), in the same script: Traditional",
          "  Chinese for a Traditional Chinese question, Simplified for Simplified. Keep product names and menu item names as",
          "  they are written in the data.",
          "- Keep it short: one to four sentences. When listing, you can give the complete list, separated by commas.",
          "- If the answer is about specific products or menu changes, end with a line \"Pages:\" followed by the page paths",
          "  given in square brackets in the data for those products or changes, written without the brackets and separated by",
          "  spaces (for example \"Pages: /portals/chatgpt/2026-10-05 /changes\"). Use only paths that appear in the data, and at",
          "  most three. Give /changes only for answers about menu changes. For an answer about many products, leave the line out.",
        ]),
    "",
    context,
  ].join("\n");
}

/** Typed answers end with at most this many page links. */
export const MAX_PAGE_LINKS = 3;
const PAGES = "Pages:";

/**
 * Typed answers only: pass the model's stream through, but keep at most `max` links on the "Pages:"
 * line. Text before "Pages:" streams as it comes; only the links line is held back and trimmed.
 * Works on AI SDK fullStream parts (text in `text-delta` parts); other parts pass unchanged.
 */
export async function* capPageLinks<T extends { type: string; text?: unknown }>(parts: AsyncIterable<T>, max = MAX_PAGE_LINKS): AsyncGenerator<T> {
  let held = "";
  let inPages = false;
  let kept = 0;
  let last: T | null = null;
  // Text after "Pages:": links beyond `max` on that line are dropped; anything after the line stays.
  const trim = (rest: string): string => {
    const nl = rest.indexOf("\n");
    const line = nl < 0 ? rest : rest.slice(0, nl);
    const links = (line.match(/\S+/g) ?? []).filter(() => kept++ < max);
    return (links.length ? ` ${links.join(" ")}` : "") + (nl < 0 ? "" : rest.slice(nl));
  };
  const flush = (): T | null => {
    if (!held || !last) return null;
    const out = { ...last, text: inPages ? trim(held) : held };
    held = "";
    return out;
  };
  for await (const part of parts) {
    if (part.type !== "text-delta" || typeof part.text !== "string") {
      const out = flush();
      if (out) yield out;
      yield part;
      continue;
    }
    last = part;
    held += part.text;
    if (inPages) continue;
    const at = held.indexOf(PAGES);
    if (at >= 0) {
      const before = held.slice(0, at + PAGES.length);
      held = held.slice(at + PAGES.length);
      inPages = true;
      yield { ...part, text: before };
      continue;
    }
    // Hold back only a tail that could be the start of "Pages:".
    let keep = Math.min(PAGES.length - 1, held.length);
    while (keep > 0 && !PAGES.startsWith(held.slice(held.length - keep))) keep--;
    const out = held.slice(0, held.length - keep);
    held = held.slice(held.length - keep);
    if (out) yield { ...part, text: out };
  }
  const out = flush();
  if (out) yield out;
}

// Markdown that reached speech was read aloud ("star star Grok"), so answers are cleaned before they are
// spoken or shown: these characters go everywhere, list markers only at the start of a line.
// public/voice.js cleans displayed text the same way (cleanAnswer).
const MD_CHARS = /[*#`_]/g;
const LIST_MARKER = /^([ \t]*)(?:[-\u2022]|\d{1,3}\.)[ \t]+/;
/** Text at the start of a line that may still turn into a list marker once more arrives. */
const MAYBE_MARKER = /^[ \t]*(?:[-\u2022]|\d{1,3}\.?)?$/;

/** The same cleanup on a whole text (used for complete answers and in tests). */
export function stripMarkdownText(text: string): string {
  return text.replace(MD_CHARS, "").split("\n").map((line) => line.replace(LIST_MARKER, "$1")).join("\n");
}

/**
 * Stream version of stripMarkdownText for AI SDK fullStream parts. Characters are dropped one by one,
 * so a "**" split across chunks is still removed; only a possible list marker at the start of a line
 * is held back until the next chunk shows whether it is one.
 */
export async function* stripMarkdown<T extends { type: string; text?: unknown }>(parts: AsyncIterable<T>): AsyncGenerator<T> {
  let pending = "";
  let lineStart = true;
  let last: T | null = null;
  const clean = (text: string, final: boolean): string => {
    let out = "";
    let rest = pending + text.replace(MD_CHARS, "");
    pending = "";
    while (rest) {
      const nl = rest.indexOf("\n");
      const line = nl < 0 ? rest : rest.slice(0, nl + 1);
      rest = nl < 0 ? "" : rest.slice(nl + 1);
      if (!lineStart) { out += line; lineStart = nl >= 0; continue; }
      if (nl < 0 && !final && MAYBE_MARKER.test(line)) { pending = line; break; }
      out += line.replace(LIST_MARKER, "$1");
      lineStart = nl >= 0;
    }
    return out;
  };
  for await (const part of parts) {
    if (part.type === "text-delta" && typeof part.text === "string") {
      last = part;
      const text = clean(part.text, false);
      if (text) yield { ...part, text };
      continue;
    }
    if (pending && last) { const text = clean("", true); if (text) yield { ...last, text }; }
    yield part;
  }
  if (pending && last) { const text = clean("", true); if (text) yield { ...last, text }; }
}

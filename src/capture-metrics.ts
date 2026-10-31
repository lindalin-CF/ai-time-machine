// Public, whitelisted numbers from a capture's private guideline analysis (analysis_json), for the
// Analytics canvas. Only numbers, enums and booleans leave this module: never text from the
// screenshot (greeting, prompt or note text), hex colours, coordinates, metric IDs or approx_* values.
// One deliberate exception: the names of the product's own navigation items (N1 labels and N1 entries
// in changes_vs_previous), which the public summary already states, and the short icon_label of an item
// without text. After common punctuation is mapped to ASCII and a legacy " (translated from ...)" suffix
// is removed, they are passed only when they are printable ASCII (labels at most 60 characters, icon
// labels at most 24) in a known region, never notes, icon descriptions or badges.
// The whole object is null unless the analysis is a published, ok, matching desktop analysis outside
// the system-test weeks. Inside one, each field is parsed on its own: a field whose stored shape is not
// one of the known shapes is null ("No data") and the others are still returned.
// The model/mode selector is collapsed to one "model picker" item in its region, and changes that only
// rename it are dropped (src/model-picker.ts): the model it shows is session state, not a menu change.
// Two more exceptions, for Compare's layout findings: the top edge (y, CSS px on the 1280 x 800 desktop screen) of the
// message box and of the greeting, from their published bounding boxes (L3 and D7 location; the analyses record them
// on a 10px grid), and, for layout changes recorded against the previous week, the analysis's own published summary
// sentences about them (src/analysis.ts already shows that summary on every page).
// A capture whose account plan differs from the portal's previous capture (src/plan.ts) is possibly
// confounded: planChange is set and its recorded menu changes are dropped, so no surface shows them as
// product changes. Applied here at display time, from the stored plans, so past weeks are covered too.
import { FIXED_SUMMARY_OPENING, SYSTEM_TEST_WEEKS } from "./analysis";
import { isPlan, planChange, type Plan, type PlanChange } from "./plan";
import { isModelNameOnly, isModelPickerItem, looksLikeModelName, MODEL_PICKER_LABEL, readsAsModelName } from "./model-picker";

/** Every field is null when its stored value could not be parsed with confidence. */
export interface CaptureMetrics {
  colorScheme: "light" | "dark" | null;
  /** Sidebar width as a percentage of the 1280px screen width (0 = no sidebar). */
  sidebarPct: number | null;
  /** Message box area as a percentage of the screen. */
  inputAreaPct: number | null;
  /** Which vertical third of the screen the message box centre falls in. */
  inputPosition: "top" | "middle" | "bottom" | null;
  /** Approximate count of clickable items outside excluded areas (about ±2). */
  clickableApprox: number | null;
  /** Number of distinct text sizes. */
  textSizes: number | null;
  /** Number of suggested prompts (count only, never their text). */
  suggestedPrompts: number | null;
  /** Whether a note about the AI's limits (e.g. "can make mistakes") is visible. */
  aiNote: boolean | null;
  /** N1 navigation items: labelled items, plus items without text that carry an icon_label (icon: true). */
  navItems: NavItem[] | null;
  /** false when N1 records the sidebar as collapsed, so sidebar items cannot be compared. */
  navSidebarVisible: boolean | null;
  /** N1 changes with status "changed", against the week the analysis compared with. */
  navChanges: { previousWeek: string; items: NavChange[] } | null;
  /** Top edge of the message box (L3 location y), CSS px on the 1280 x 800 desktop screen, on the analyses' 10px grid. */
  inputTop: number | null;
  /** Top edge of the greeting (D7 location y), same units; null when no greeting is recorded. */
  greetingTop: number | null;
  /**
   * Layout changes (L1-L4) recorded against `previousWeek` with status "changed", none of them confounded, as the
   * analysis's own summary sentences that state them. `confounded`: some layout change against that week is marked
   * confounded or possibly confounded (a pop-up, a promo card...). Null without a valid previous_week.
   */
  layoutChanges: { previousWeek: string; sentences: string[]; confounded: boolean } | null;
  /** The account plan the capture was taken with. */
  plan: Plan | null;
  /** Set when the plan differs from the previous capture's: navChanges then has no items. */
  planChange: PlanChange | null;
}

export type NavRegion = "sidebar" | "top bar" | "input area";
/** `label` is the item's text, or its icon_label when `icon` is true. */
export interface NavItem {
  label: string;
  region: NavRegion;
  icon?: true;
  /** A model picker (usually in the input area): `label` is always "model picker", never the model it shows. */
  picker?: true;
  /**
   * A text item whose label reads as a model or mode name but was not taken as a picker ("Manus 2.0 Lite" in the
   * top bar). Compare pairs it with a model picker the other week shows in the same region (public/analytics-canvas.js).
   */
  modelName?: true;
}
export interface NavChange {
  change: "added" | "removed" | "renamed" | "icon_changed";
  previous: string | null;
  current: string | null;
  region: NavRegion;
  /** previous/current are icon_labels of an item without text. */
  icon?: true;
  /** The model picker appeared ("added") or disappeared ("removed") in `region`; previous/current is "model picker". */
  picker?: true;
}

type Row = { week?: string | null; slug?: string | null; analysis_by?: string | null; analysis_json?: string | null; plan?: string | null; previous_plan?: string | null };

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** "22%" or "4.5%" -> number. */
function percent(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,3}(?:\.\d+)?)%$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 100 ? n : null;
}

/** L3: { vertical_third } or a sentence naming exactly one third ("middle third vertically"). */
function inputPosition(v: unknown): CaptureMetrics["inputPosition"] {
  if (isObject(v)) {
    const t = v.vertical_third;
    return t === "top" || t === "middle" || t === "bottom" ? t : null;
  }
  if (typeof v !== "string") return null;
  const found = new Set([...v.matchAll(/\b(top|middle|bottom) (?:vertical )?third\b/gi)].map((m) => m[1].toLowerCase()));
  return found.size === 1 ? ([...found][0] as CaptureMetrics["inputPosition"]) : null;
}

/** L4: per-region counts with or without a total (total must equal the sum), or "About N ...". */
function clickable(v: unknown): number | null {
  if (isObject(v)) {
    const regions = Object.entries(v).filter(([k]) => k !== "total").map(([, n]) => n);
    if (!regions.length || !regions.every(isCount)) return null;
    const sum = regions.reduce((a, b) => a + b, 0);
    if ("total" in v) return isCount(v.total) && v.total === sum ? v.total : null;
    return sum;
  }
  if (typeof v !== "string") return null;
  const m = /^About (\d+)\b/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

/** H3: 4, "1", or "3 levels (estimated ...)". */
function textSizes(v: unknown): number | null {
  if (isCount(v)) return v;
  if (typeof v !== "string") return null;
  const m = /^(\d+)(?: levels?\b|$)/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

/**
 * D5.suggested_prompts: a count or { count }. Other D5 shapes (free text, other keys) are not parsed.
 * TODO: many published analyses record suggested prompts in other D5 shapes, so the canvas and the voice
 * guide show "not measured" for them; parse those shapes (or settle one shape in the guideline).
 */
function suggestedPrompts(v: unknown): number | null {
  if (!isObject(v) || !("suggested_prompts" in v)) return null;
  const s = v.suggested_prompts;
  if (isCount(s)) return s;
  if (isObject(s) && isCount(s.count)) return s.count;
  return null;
}

/** D6: "none" / "none visible", { present }, or the note's own text (present). */
function aiNote(v: unknown): boolean | null {
  if (isObject(v)) return typeof v.present === "boolean" ? v.present : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim().toLowerCase();
  if (t === "none" || t === "none visible") return false;
  if (/^(none|no |not )/.test(t) || t === "not_measured" || t === "cannot_determine") return null;
  return true;
}

const NAV_REGIONS: readonly string[] = ["sidebar", "top bar", "input area"];
const NAV_MAX = 30;
const isRegion = (v: unknown): v is NavRegion => typeof v === "string" && NAV_REGIONS.includes(v);
const LABEL_MAX = 60;
const ICON_LABEL_MAX = 24;
const TO_ASCII: Record<string, string> = {
  "\u00b7": "-", "\u2022": "-", "\u2027": "-", "\u2219": "-", "\u2013": "-", "\u2014": "-",
  "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u00a0": " ",
};
/**
 * A navigation item name ready to pass on, or null: common punctuation mapped to ASCII, a legacy
 * " (translated from ...)" suffix removed, then printable ASCII, not blank, at most `max` characters.
 */
function navName(v: unknown, max = LABEL_MAX): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/[\u00b7\u2022\u2027\u2219\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00a0]/g, (c) => TO_ASCII[c])
    .replace(/\s*\(translated from [^)]*\)\s*$/i, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return t && t.length <= max && /^[\x20-\x7E]+$/.test(t) ? t : null;
}

const pickerItem = (region: NavRegion): NavItem => ({ label: MODEL_PICKER_LABEL, region, picker: true });

/**
 * N1 value: an array of { label, region, ... }. Malformed items are dropped; a non-array or more than 30
 * kept items is null. A model picker (role "model_picker" in any region, an input-area label that reads as a
 * model name, or a top-bar label that is only a model name) becomes one "model picker" item per region, at
 * the position of the first one.
 */
function navItems(v: unknown): NavItem[] | null {
  if (!Array.isArray(v)) return null;
  const items: NavItem[] = [];
  const pickers = new Set<NavRegion>();
  for (const it of v) {
    if (!isObject(it) || !isRegion(it.region)) continue;
    const label = navName(it.label);
    if (it.role === "model_picker" || (label && isModelPickerItem({ ...it, label }))) {
      if (!pickers.has(it.region)) items.push(pickerItem(it.region));
      pickers.add(it.region);
      continue;
    }
    const iconLabel = it.label === null ? navName(it.icon_label, ICON_LABEL_MAX) : null;
    if (label) items.push({ label, region: it.region, ...(readsAsModelName(label) ? { modelName: true as const } : {}) });
    else if (iconLabel) items.push({ label: iconLabel, region: it.region, icon: true });
  }
  return items.length <= NAV_MAX ? items : null;
}

/**
 * Model-picker changes for display, per region. In the input area a model name is any label that reads as one;
 * in the top bar, a label that is only a model name; anywhere, the label "model picker" (role "model_picker").
 * A rename between two model names, or a removed + added pair of them, is only a different model picked in
 * the session, so it is dropped. A model name that only appears (or only disappears) means the picker itself
 * appeared (or disappeared): it becomes one "model picker" change. A rename between a model name and a normal
 * item is a picker change plus a normal item change. A label that merely reads as a model name outside the
 * input area ("Manus 2.0 Lite") counts as the picker only when it pairs with a "model picker" change.
 */
function normalizePickerChanges(items: NavChange[]): NavChange[] {
  const model = (s: string | null, region: NavRegion) => s !== null &&
    (s === MODEL_PICKER_LABEL || (region === "input area" ? looksLikeModelName(s) : region === "top bar" && isModelNameOnly(s)));
  const loose = (s: string | null) => s !== null && (s === MODEL_PICKER_LABEL || readsAsModelName(s));
  const isPicker = (s: string | null) => s === MODEL_PICKER_LABEL;
  // Per region: model names added and removed, and changes that read as a model name only loosely, which are
  // kept unless they pair with an opposite picker change.
  const state = new Map(NAV_REGIONS.map((r) => [r as NavRegion, { added: 0, removed: 0, looseAdded: [] as NavChange[], looseRemoved: [] as NavChange[] }]));
  const out: NavChange[] = [];
  for (const c of items) {
    const st = state.get(c.region)!;
    if (c.icon) { out.push(c); continue; }
    if (c.change === "renamed") {
      const p = model(c.previous, c.region), n = model(c.current, c.region);
      if ((p && n) || (isPicker(c.previous) && loose(c.current)) || (isPicker(c.current) && loose(c.previous))) continue;
      if (p) { st.removed++; out.push({ change: "added", previous: null, current: c.current, region: c.region }); continue; }
      if (n) { st.added++; out.push({ change: "removed", previous: c.previous, current: null, region: c.region }); continue; }
      out.push(c);
    } else if (c.change === "added" && model(c.current, c.region)) st.added++;
    else if (c.change === "removed" && model(c.previous, c.region)) st.removed++;
    else if (c.change === "added" && loose(c.current) && c.region !== "input area") st.looseAdded.push(c);
    else if (c.change === "removed" && loose(c.previous) && c.region !== "input area") st.looseRemoved.push(c);
    else out.push(c);
  }
  for (const [region, st] of state) {
    // A picker that appears while a loose model name disappears (or the other way round) is the same picker.
    while (st.added > st.removed && st.looseRemoved.length) { st.looseRemoved.shift(); st.removed++; }
    while (st.removed > st.added && st.looseAdded.length) { st.looseAdded.shift(); st.added++; }
    out.push(...st.looseAdded, ...st.looseRemoved);
    // Paired removed + added model names cancel out; what is left is the picker appearing or disappearing.
    if (st.added > st.removed) out.push({ change: "added", previous: null, current: MODEL_PICKER_LABEL, region, picker: true });
    if (st.removed > st.added) out.push({ change: "removed", previous: MODEL_PICKER_LABEL, current: null, region, picker: true });
  }
  return out;
}

/** The y of a metric's location [x, y, w, h] when it lies on the 1280 x 800 screen; otherwise null. */
function locationTop(m: Record<string, unknown> | undefined): number | null {
  const l = m?.location;
  if (!Array.isArray(l) || l.length !== 4 || !l.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  const [, y, , h] = l as number[];
  return y + h <= 800 ? y : null;
}

const LAYOUT_IDS = ["L1", "L2", "L3", "L4"];
/** A summary sentence that states a change: "than in the week of 2026-09-28", "now", "no longer", "since". */
const STATES_CHANGE = /\b(?:week of \d{4}-\d{2}-\d{2}|now|no longer|since)\b/i;

/**
 * Summary sentences that state the layout changes recorded against the previous week: every source of the sentence
 * is a layout metric with a "changed" entry and no confounded or possibly confounded entry, and the sentence states
 * a change (not the fixed opening, not a caveat).
 */
function layoutChanges(a: Record<string, unknown>, week: string): CaptureMetrics["layoutChanges"] {
  const previousWeek = a.previous_week;
  if (typeof previousWeek !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(previousWeek) || previousWeek >= week) return null;
  if (!Array.isArray(a.changes_vs_previous) || !Array.isArray(a.summary_sentences)) return null;
  const changed = new Set<string>(), confounded = new Set<string>();
  for (const c of a.changes_vs_previous) {
    if (!isObject(c) || typeof c.id !== "string" || !LAYOUT_IDS.includes(c.id)) continue;
    (c.status === "changed" ? changed : confounded).add(c.id);
  }
  const clean = (id: unknown) => typeof id === "string" && changed.has(id) && !confounded.has(id);
  const sentences = a.summary_sentences.flatMap((x) => {
    if (!isObject(x) || typeof x.text !== "string" || !Array.isArray(x.sources) || !x.sources.length) return [];
    const text = x.text.trim();
    return x.sources.every(clean) && STATES_CHANGE.test(text) && !FIXED_SUMMARY_OPENING.test(text) ? [text] : [];
  });
  return { previousWeek, sentences, confounded: confounded.size > 0 };
}

/** N1 metric's sidebar field: "visible" / "not_visible". */
function navSidebarVisible(n1: unknown): boolean | null {
  if (!isObject(n1)) return null;
  return n1.sidebar === "visible" ? true : n1.sidebar === "not_visible" ? false : null;
}

/** N1 entries of changes_vs_previous with status "changed". Null without a valid previous_week or array. */
function navChanges(changes: unknown, previousWeek: unknown, week: string): CaptureMetrics["navChanges"] {
  if (!Array.isArray(changes)) return null;
  if (typeof previousWeek !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(previousWeek) || previousWeek >= week) return null;
  const items: NavChange[] = [];
  for (const c of changes) {
    if (!isObject(c) || c.id !== "N1" || c.status !== "changed" || !isRegion(c.region)) continue;
    const icon = c.icon_only === true;
    const max = icon ? ICON_LABEL_MAX : LABEL_MAX;
    const previous = navName(c.previous, max), current = navName(c.current, max);
    const ok =
      (c.change === "renamed" && !icon && previous && current && previous !== current) ||
      (c.change === "added" && c.previous === null && current) ||
      (c.change === "removed" && previous && c.current === null) ||
      (c.change === "icon_changed" && icon && previous && current && previous !== current);
    if (ok) items.push({ change: c.change as NavChange["change"], previous, current, region: c.region, ...(icon ? { icon: true as const } : {}) });
  }
  const normalized = normalizePickerChanges(items);
  return normalized.length <= NAV_MAX ? { previousWeek, items: normalized } : null;
}

/** Whitelisted metrics for a published, ok, non-system-test desktop analysis (fields null when unparseable); otherwise null. */
export function captureMetrics(row: Row): CaptureMetrics | null {
  if (!row.week || SYSTEM_TEST_WEEKS.includes(row.week)) return null;
  if (!row.analysis_by || !row.analysis_by.startsWith("guideline-v") || !row.analysis_json) return null;
  let a: unknown;
  try { a = JSON.parse(row.analysis_json); } catch { return null; }
  if (!isObject(a) || a.status !== "ok" || a.variant !== "desktop") return null;
  if (a.week !== row.week || (row.slug && a.portal !== row.slug)) return null;
  const context = isObject(a.context) ? a.context : {};
  const metrics = Array.isArray(a.metrics) ? a.metrics : [];

  const metric = (id: string): Record<string, unknown> | undefined => {
    const hits = (metrics as unknown[]).filter((m) => isObject(m) && m.id === id);
    return hits.length === 1 ? (hits[0] as Record<string, unknown>) : undefined;
  };
  const value = (id: string): unknown => metric(id)?.value;
  const scheme = context.color_scheme;
  const plan = planChange(row.previous_plan, row.plan);
  const nav = navChanges(a.changes_vs_previous, a.previous_week, row.week);
  const layout = layoutChanges(a, row.week);
  const greeting = metric("D7");
  return {
    colorScheme: scheme === "light" || scheme === "dark" ? scheme : null,
    sidebarPct: percent(value("L2")),
    inputAreaPct: percent(value("H2")),
    inputPosition: inputPosition(value("L3")),
    clickableApprox: clickable(value("L4")),
    textSizes: textSizes(value("H3")),
    suggestedPrompts: suggestedPrompts(value("D5")),
    aiNote: aiNote(value("D6")),
    navItems: navItems(value("N1")),
    navSidebarVisible: navSidebarVisible(metric("N1")),
    navChanges: nav && plan ? { previousWeek: nav.previousWeek, items: [] } : nav,
    inputTop: a.viewport === "1280x800" ? locationTop(metric("L3")) : null,
    greetingTop: a.viewport === "1280x800" && typeof greeting?.value === "string" && greeting.value.trim() ? locationTop(greeting) : null,
    layoutChanges: layout && plan ? { ...layout, sentences: [] } : layout,
    plan: isPlan(row.plan) ? row.plan : null,
    planChange: plan,
  };
}

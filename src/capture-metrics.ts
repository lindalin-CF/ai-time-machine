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
import { SYSTEM_TEST_WEEKS } from "./analysis";

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
}

export type NavRegion = "sidebar" | "top bar" | "input area";
/** `label` is the item's text, or its icon_label when `icon` is true. */
export interface NavItem { label: string; region: NavRegion; icon?: true }
export interface NavChange {
  change: "added" | "removed" | "renamed";
  previous: string | null;
  current: string | null;
  region: NavRegion;
  /** previous/current are icon_labels of an item without text. */
  icon?: true;
}

type Row = { week?: string | null; slug?: string | null; analysis_by?: string | null; analysis_json?: string | null };

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

/** D5.suggested_prompts: a count or { count }. Other D5 shapes (free text, other keys) are not parsed. */
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

/** N1 value: an array of { label, region, ... }. Malformed items are dropped; a non-array or more than 30 kept items is null. */
function navItems(v: unknown): NavItem[] | null {
  if (!Array.isArray(v)) return null;
  const items: NavItem[] = [];
  for (const it of v) {
    if (!isObject(it) || !isRegion(it.region)) continue;
    const label = navName(it.label);
    const iconLabel = it.label === null ? navName(it.icon_label, ICON_LABEL_MAX) : null;
    if (label) items.push({ label, region: it.region });
    else if (iconLabel) items.push({ label: iconLabel, region: it.region, icon: true });
  }
  return items.length <= NAV_MAX ? items : null;
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
      (c.change === "removed" && previous && c.current === null);
    if (ok) items.push({ change: c.change as NavChange["change"], previous, current, region: c.region, ...(icon ? { icon: true as const } : {}) });
  }
  return items.length <= NAV_MAX ? { previousWeek, items } : null;
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
    navChanges: navChanges(a.changes_vs_previous, a.previous_week, row.week),
  };
}

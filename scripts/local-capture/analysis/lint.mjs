#!/usr/bin/env node
/**
 * Deterministic lint for guideline design analyses (.claude/skills/portal-design-analysis/SKILL.md).
 * It only reports: it never edits an analysis and never blocks publishing (exit code is 0 unless the
 * arguments are wrong). No network, no model.
 *
 * USAGE (from scripts/local-capture/):
 *   node analysis/lint.mjs <week>                  # text report for every analysis/work/<slug>/<week>/analysis.json
 *   node analysis/lint.mjs <week> --markdown       # the "## Lint" section for review-<week>.md, on stdout
 *   node analysis/lint.mjs <week> --write-review   # also put that section into analysis/work/review-<week>.md
 *                                                  # (replaces an earlier "## Lint" section; the file must exist)
 *
 * Rules (each finding is a warning):
 *   banned-wording  phrases the guideline forbids (§8 examples, §7/§10.2 "不寫 …" lists anywhere in the text,
 *                   the §10.2 term table in the public summary only), read from SKILL.md, never hard-coded
 *   metric-range    metric values outside their valid ranges or vocabularies
 *   text-vs-metrics summary sentences that contradict the metrics (suggested prompts, mistakes note,
 *                   contrast, sidebar width, E1 sentence, message box outline)
 *   menu-items      menu items named in the summary that aren't in N1 (or in the previous week's N1 for
 *                   removed items); N1 items without a label that have no icon_label
 *   cross-week      §9.1 confound rules and §9.3 thresholds for changes_vs_previous; comparison sentences
 *                   without a matching change; week-over-week claims when previous_week is missing
 *   privacy         §2 excluded content (emails, handles, names in greetings, private-terms.txt hits,
 *                   mentions of excluded areas, privacy_flag consistency). Findings name the field only
 *                   and never quote the text, so the report can't leak what it found.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SKILL_PATH = resolve(__dirname, "../../../.claude/skills/portal-design-analysis/SKILL.md");

// ---------------------------------------------------------------------------------------------
// Banned wording, read from SKILL.md

/** Lines of the section that starts with `startRe`, up to the next heading of the same or higher level. */
function section(md, startRe) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return [];
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+\s/.test(l) && l.match(/^#+/)[0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** Cells of the markdown table rows in `lines` (header and separator rows dropped). */
function tableRows(lines) {
  const rows = lines.filter((l) => /^\|.*\|\s*$/.test(l.trim())).map((l) =>
    l.trim().slice(1, -1).split("|").map((c) => c.trim()));
  return rows.slice(2); // header + |---|
}

const CJK = /[　-鿿＀-￯]/;

/** Latin phrases in one guideline cell: split on 、 and " / ", take the Latin runs out of mixed text. */
function phrasesIn(cell) {
  const out = [];
  for (let part of cell.replace(/[`"]/g, "").split(/、|\s\/\s/)) {
    part = part.replace(/（[^）]*）/g, "").trim();
    const runs = CJK.test(part) ? part.split(/[　-鿿＀-￯]+/) : [part];
    for (let r of runs) {
      r = r.trim().replace(/[,.;:]+$/, "");
      if (!/^[A-Za-z]/.test(r) || r.length < 3) continue;
      out.push(r);
    }
  }
  return out;
}

/** Normalise one example into match phrases ("users will quickly find…" → prefix match, etc.). */
function expand(phrase) {
  let p = phrase.trim();
  const prefix = /…$|\.\.\.$/.test(p);
  p = p.replace(/(…|\.\.\.)$/, "").trim();
  const words = p.split(/\s+/);
  // "Copilot redesigned its greeting": the example names a portal; the wording is what's banned.
  if (words.length >= 3 && /^[A-Z][a-z]+$/.test(words[0]) && /^[a-z]/.test(words[1])) words.shift();
  // "contrast ratio 15.3:1, approx_pass", "type scale with 4 levels": keep the words before the number.
  const num = words.findIndex((w) => /\d/.test(w));
  if (num > 0) {
    words.length = num;
    while (words.length > 1 && /^(with|of|at|in|on|to|the|a|an)$/i.test(words.at(-1))) words.pop();
  }
  if (num === 0) return [];
  const base = words.join(" ");
  const out = [{ text: base, prefix }];
  // "introduced a new feature", "updated the sidebar": the -ed verb alone, and the noun phrase after the article.
  // These are derived, not written in the guideline, so they are only checked in the public summary.
  const m = base.match(/^(\w+ed) (?:a|an|the) (.+)$/i);
  if (m) {
    out.push({ text: m[1], prefix: false, derived: true });
    if (m[2].split(/\s+/).length >= 2) out.push({ text: m[2], prefix: false, derived: true });
  }
  return out;
}

/**
 * Banned phrases from the guideline text.
 * Returns { anywhere: [{ text, prefix, source }], summaryOnly: [...] }.
 *   anywhere:    §8 examples and every "不寫 X、Y" list (summary and notes)
 *   summaryOnly: §10.2 term table, left column (fine in notes, not on the public page)
 */
export function bannedPhrases(md) {
  const anywhere = [];
  const summaryOnly = [];
  const add = (list, phrase, source) => {
    for (const e of expand(phrase)) {
      if (!list.some((x) => x.text.toLowerCase() === e.text.toLowerCase())) list.push({ ...e, source });
    }
  };
  for (const row of tableRows(section(md, /^## 8\./))) {
    for (const p of phrasesIn(row[1] ?? "")) add(anywhere, p, `§8 ${row[0]}`);
  }
  for (const line of md.split(/\r?\n/)) {
    for (const m of line.matchAll(/不寫\s*([`"A-Za-z][^，。；（）]*?)(?=\s*(?:這類|，|。|；|（|）|$))/g)) {
      for (const p of phrasesIn(m[1])) add(anywhere, p, "不寫 list");
    }
  }
  const terms = section(md, /^### 10\.2/);
  const at = terms.findIndex((l) => l.includes("術語改寫對照"));
  if (at >= 0) {
    for (const row of tableRows(terms.slice(at + 1))) {
      for (const p of phrasesIn(row[0] ?? "")) add(summaryOnly, p, "§10.2 term table");
    }
  }
  // A §10.2 term ("send button") stays summary-only even when a 不寫 list repeats it: the guideline itself
  // prescribes notes such as "No send button visible in this state; …" (§7.5 D4).
  const inSummaryList = new Set(summaryOnly.map((p) => p.text.toLowerCase()));
  return { anywhere: anywhere.filter((p) => !inSummaryList.has(p.text.toLowerCase())), summaryOnly };
}

function phraseRegex({ text, prefix }) {
  const body = text.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
  return new RegExp(`(?<![A-Za-z])${body}${prefix ? "" : "(?![A-Za-z])"}`, "i");
}

// ---------------------------------------------------------------------------------------------
// Helpers

const METRIC_IDS = ["L1", "L2", "L3", "L4", "L5", "N1", "H1", "H2", "H3", "C1", "C2", "C3", "C4", "C5",
  "D1", "D2", "D3", "D4", "D5", "D6", "D7"];
const NOT_MEASURED = new Set(["not_measured", "cannot_determine"]);
const NUMBER_WORDS = { no: 0, zero: 0, one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const FRACTIONS = { half: 50, third: 33, quarter: 25, fourth: 25, fifth: 20, sixth: 17, seventh: 14, eighth: 12.5,
  tenth: 10, twentieth: 5 };

function version(v) {
  return String(v ?? "").split(".").map((n) => parseInt(n, 10) || 0);
}
function versionAtLeast(v, min) {
  const a = version(v), b = version(min);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}
const str = (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
const ratios = (v) => [...str(v).matchAll(/(\d+(?:\.\d+)?)\s*:\s*1\b/g)].map((m) => Number(m[1]));
const pct = (v) => { const m = str(v).match(/(-?\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : null; };
const results = (v) => [...str(v).matchAll(/approx_(pass|fail|unclear)/g)].map((m) => m[1]);
const hexes = (v) => [...str(v).matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => m[1]);
const firstInt = (v) => { if (typeof v === "number") return v; const m = str(v).match(/-?\d+/); return m ? Number(m[0]) : null; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[“”"'.]/g, "").replace(/\s+/g, " ").trim();
const isCount = (n) => Number.isInteger(n) && n >= 0;

/** Sentences of a free-text field, so a finding can quote the one that matched. */
function sentencesOf(text) {
  return String(text).split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/).map((s) => s.trim()).filter(Boolean);
}

/** Every free-text field the lint reads: the summary sentences, then notes and reasons. */
function textFields(a) {
  const out = [];
  for (const [i, s] of (a.summary_sentences ?? []).entries()) {
    out.push({ where: `summary sentence ${i + 1}`, text: str(s?.text), summary: true, index: i });
  }
  if (a.status_reason) out.push({ where: "status_reason", text: str(a.status_reason) });
  for (const [k, v] of Object.entries(a.context ?? {})) {
    if (v && typeof v === "object" && typeof v.note === "string" && v.note) out.push({ where: `context.${k}.note`, text: v.note });
  }
  if (typeof a.context?.notes === "string" && a.context.notes) out.push({ where: "context.notes", text: a.context.notes });
  for (const m of a.metrics ?? []) {
    if (typeof m?.note === "string" && m.note) out.push({ where: `metrics.${m.id}.note`, text: m.note });
  }
  for (const [i, c] of (a.changes_vs_previous ?? []).entries()) {
    if (typeof c?.note === "string" && c.note) out.push({ where: `changes_vs_previous[${i}] (${c.id}).note`, text: c.note });
  }
  return out;
}

/** Every string anywhere in the JSON, with its path (for the privacy checks). */
function allStrings(v, path = "", out = []) {
  if (typeof v === "string") out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => allStrings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) allStrings(x, path ? `${path}.${k}` : k, out);
  return out;
}

function metricMap(a) {
  const m = {};
  for (const x of a?.metrics ?? []) if (x && typeof x.id === "string") m[x.id] = x;
  return m;
}

/** Suggested-prompt count from D5, whichever of the shapes the analyses have used; null if unknown. */
export function suggestedCount(d5) {
  const v = d5?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  for (const [k, x] of Object.entries(v)) {
    if (!/^sugg/i.test(k)) continue;
    if (typeof x === "number") return x;
    if (Array.isArray(x)) return x.length;
    if (x && typeof x === "object" && typeof x.count === "number") return x.count;
  }
  return null;
}

/** true / false / null (unknown) for "a limitations note is visible", from D6. */
export function disclaimerPresent(d6) {
  const v = d6?.value;
  if (v == null || NOT_MEASURED.has(v)) return null;
  if (typeof v === "object" && !Array.isArray(v)) return typeof v.present === "boolean" ? v.present : null;
  if (typeof v === "string") return !/^(none|none visible|no|absent|not visible)\b/i.test(v.trim());
  return null;
}
function disclaimerType(d6) {
  const v = d6?.value;
  if (v && typeof v === "object" && v.type) return v.type;
  const t = str(v) + " " + str(d6?.note);
  if (/ai[- ]generated|generated by ai|come[s]? from ai/i.test(t)) return "ai_generated";
  if (/mistake/i.test(t)) return "mistakes";
  return null;
}

/** C4 result for the message box: its own sub-result when the value has one, else the overall result. */
function boxResult(c4) {
  const v = c4?.value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const key = Object.keys(v).find((k) => /prompt|input|message/i.test(k) && v[k] && typeof v[k] === "object" && typeof v[k].result === "string");
    if (key) return v[key].result;
  }
  return typeof c4?.result === "string" ? c4.result : null;
}

/** Names a reader would use for one N1 item. */
function itemNames(it) {
  return [it?.label, it?.icon_label, it?.icon, it?.current, it?.original_text].filter((x) => typeof x === "string" && x).map(norm);
}
function n1Items(a) {
  const n1 = metricMap(a).N1;
  return Array.isArray(n1?.value) ? n1.value : null;
}
function namedIn(name, names) {
  const n = norm(name).replace(/^(a|an|the) /, "");
  if (!n) return true;
  return names.some((x) => x === n || x === `${n} icon` || x.replace(/-shaped/, "") === n || n === x.replace(/ icon$/, ""));
}

// ---------------------------------------------------------------------------------------------
// Rules

function ruleBanned(a, banned, push) {
  for (const f of textFields(a)) {
    const lists = f.summary ? [...banned.anywhere, ...banned.summaryOnly] : banned.anywhere.filter((p) => !p.derived);
    // In notes, text in quotes is the portal's own UI text (an 'UPDATED' badge), not the analysis's wording.
    const text = f.summary ? f.text : f.text.replace(/'[^']*'|"[^"]*"|“[^”]*”/g, "''");
    for (const p of lists) {
      const re = phraseRegex(p);
      if (!re.test(text)) continue;
      const sentence = f.summary ? f.text : sentencesOf(f.text).find((s) => re.test(s)) ?? f.text;
      push("banned-wording", `"${p.text}${p.prefix ? "…" : ""}" (${p.source})`, f.where, sentence);
    }
  }
  for (const [i, it] of (n1Items(a) ?? []).entries()) {
    for (const key of ["icon", "icon_label"]) {
      if (typeof it?.[key] !== "string") continue;
      for (const p of banned.anywhere) {
        if (phraseRegex(p).test(it[key])) push("banned-wording", `"${p.text}" (${p.source})`, `metrics.N1 item ${i + 1}.${key}`, it[key]);
      }
    }
  }
}

function ruleRanges(a, push) {
  const m = metricMap(a);
  const required = METRIC_IDS.filter((id) => id !== "N1" || versionAtLeast(a.guideline_version, "1.5.0"));
  const missing = required.filter((id) => !m[id]);
  if (missing.length) push("metric-range", `missing metrics: ${missing.join(", ")} (§10.1: every metric is output)`, "metrics");

  for (const x of a.metrics ?? []) {
    const id = x?.id;
    const where = `metrics.${id}`;
    if (x.evidence !== "E1" && x.evidence !== "E2") push("metric-range", `evidence is ${JSON.stringify(x.evidence)} (must be E1 or E2)`, where);
    if (x.confidence !== undefined && !["high", "medium", "low"].includes(x.confidence)) {
      push("metric-range", `confidence is ${JSON.stringify(x.confidence)} (must be high, medium or low)`, where);
    }
    if (x.result !== undefined && x.result !== null && !["C2", "C3", "C4"].includes(id)) {
      push("metric-range", `result is only used by C2, C3 and C4`, where);
    }
    if (Array.isArray(x.location) && x.location.length === 4 && x.location.every((n) => typeof n === "number")) {
      const [lx, ly, lw, lh] = x.location;
      if (lx < 0 || ly < 0 || lw < 0 || lh < 0 || lx + lw > 1290 || ly + lh > 810) {
        push("metric-range", `location [${x.location.join(", ")}] is outside the 1280x800 screen`, where);
      }
    }
    const v = x.value;
    if (NOT_MEASURED.has(v)) continue;
    switch (id) {
      case "L2": case "H2": {
        const p = pct(v);
        if (p === null) push("metric-range", `value ${JSON.stringify(v)} is not a percentage`, where);
        else if (p < 0 || p > 100) push("metric-range", `value ${p}% is outside 0-100%`, where);
        break;
      }
      case "L3":
        if (v && typeof v === "object" && v.vertical_third !== undefined && !["top", "middle", "bottom"].includes(v.vertical_third)) {
          push("metric-range", `vertical_third is ${JSON.stringify(v.vertical_third)} (must be top, middle or bottom)`, where);
        }
        if (Array.isArray(v?.center) && (v.center[0] < 0 || v.center[0] > 1280 || v.center[1] < 0 || v.center[1] > 800)) {
          push("metric-range", `center [${v.center.join(", ")}] is outside the 1280x800 screen`, where);
        }
        break;
      case "L4":
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const parts = Object.entries(v).filter(([k]) => k !== "total");
          for (const [k, n] of Object.entries(v)) if (!isCount(n)) push("metric-range", `count ${k} is ${JSON.stringify(n)} (must be a whole number >= 0)`, where);
          if (isCount(v.total) && parts.every(([, n]) => isCount(n))) {
            const sum = parts.reduce((s, [, n]) => s + n, 0);
            if (sum !== v.total) push("metric-range", `total is ${v.total} but the regions add up to ${sum}`, where);
          }
        }
        break;
      case "H1":
        if (Array.isArray(v)) {
          if (v.length < 1 || v.length > 3) push("metric-range", `H1 lists ${v.length} elements (must be the top 3)`, where);
          const ranks = v.map((e) => e?.rank).filter((r) => r !== undefined);
          if (ranks.some((r) => ![1, 2, 3].includes(r)) || new Set(ranks).size !== ranks.length) {
            push("metric-range", `H1 ranks ${JSON.stringify(ranks)} must be distinct values from 1 to 3`, where);
          }
        }
        break;
      case "H3":
        if (typeof v === "number" && (!Number.isInteger(v) || v < 1 || v > 12)) push("metric-range", `H3 is ${v} type levels (expected a whole number from 1 to 12)`, where);
        break;
      case "C1":
        for (const h of str(v).match(/#[0-9A-Za-z]+\b/g) ?? []) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(h)) push("metric-range", `colour ${h} is not a 6-digit hex value`, where);
        }
        break;
      case "C2": case "C3": case "C4": {
        const allowed = id === "C4" ? ["approx_pass", "approx_unclear", "approx_fail", null] : ["approx_pass", "approx_fail", null];
        if (x.result !== undefined && !allowed.includes(x.result)) push("metric-range", `result is ${JSON.stringify(x.result)} (allowed: ${allowed.join(", ")})`, where);
        for (const r of ratios(v)) if (r < 1 || r > 21) push("metric-range", `contrast ratio ${r}:1 is outside 1:1-21:1`, where);
        if (id !== "C4") {
          const [r] = ratios(v);
          if (r !== undefined && x.result === "approx_pass" && r < 3) push("metric-range", `${r}:1 is marked approx_pass (below 3:1 never passes)`, where);
          if (r !== undefined && x.result === "approx_fail" && r >= 4.5) push("metric-range", `${r}:1 is marked approx_fail (4.5:1 or more always passes)`, where);
        }
        break;
      }
      case "D3":
        if (typeof v === "number" && !isCount(v)) push("metric-range", `D3 is ${v} (must be a whole number >= 0)`, where);
        break;
      case "D5": {
        const n = suggestedCount(x);
        if (n !== null && !isCount(n)) push("metric-range", `suggested prompt count is ${n} (must be a whole number >= 0)`, where);
        const sp = v && typeof v === "object" ? Object.entries(v).find(([k]) => /^sugg/i.test(k))?.[1] : null;
        if (sp && typeof sp === "object" && Array.isArray(sp.texts) && sp.texts.length && isCount(sp.count) && sp.texts.length !== sp.count) {
          push("metric-range", `suggested prompts count is ${sp.count} but ${sp.texts.length} texts are listed`, where);
        }
        break;
      }
      case "N1":
        if (Array.isArray(v)) {
          if (!["visible", "not_visible", "none"].includes(x.sidebar)) push("metric-range", `N1.sidebar is ${JSON.stringify(x.sidebar)} (must be visible, not_visible or none)`, where);
          for (const [i, it] of v.entries()) {
            if (!["sidebar", "top bar", "input area"].includes(it?.region)) push("metric-range", `item ${i + 1} region ${JSON.stringify(it?.region)} (must be sidebar, top bar or input area)`, where);
            if (!(Number.isInteger(it?.order) && it.order >= 1)) push("metric-range", `item ${i + 1} order ${JSON.stringify(it?.order)} (must be a whole number from 1)`, where);
          }
        }
        break;
    }
  }
}

function ruleTextVsMetrics(a, push) {
  const m = metricMap(a);
  const sentences = (a.summary_sentences ?? []).map((s, i) => ({ text: str(s?.text), sources: s?.sources ?? [], i }));
  const say = (s, msg) => push("text-vs-metrics", msg, `summary sentence ${s.i + 1}`, s.text);

  const count = suggestedCount(m.D5);
  const present = disclaimerPresent(m.D6);
  const dType = disclaimerType(m.D6);
  const l2 = pct(m.L2?.value);

  for (const s of sentences) {
    const t = s.text;
    // Suggested prompts
    if (count !== null && /suggest(ed|ion)/i.test(t) && !/\bweek of\b/i.test(t)) {
      const nm = t.match(/\b(no|zero|one|a|an|single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:\w+\s+)?suggest(?:ed prompts?|ions?)/i);
      const none = /\bno (?:\w+ )?suggest(?:ed|ion)|\bnot? (?:any )?suggest|suggest(?:ed prompts|ions) (?:are|is) not\b|without suggest/i.test(t) || /\bno suggested prompts\b/i.test(t);
      if (none && count > 0) say(s, `says there are no suggested prompts, but D5 counts ${count}`);
      else if (nm) {
        const n = /^\d+$/.test(nm[1]) ? Number(nm[1]) : NUMBER_WORDS[nm[1].toLowerCase()];
        if (n !== undefined && n !== count && !(n === 1 && /^an?$/i.test(nm[1]) && count >= 1)) say(s, `names ${n} suggested prompts, but D5 counts ${count}`);
      } else if (!none && count === 0 && /\bsuggested prompts?\b/i.test(t) && !/\bor\b/i.test(t)) {
        say(s, `mentions suggested prompts, but D5 counts 0`);
      }
    }
    // Limitations note (D6)
    if (present !== null && /mistake|ai[- ]generated|come[s]? from ai/i.test(t) && !/\bweek of\b/i.test(t)) {
      const negative = /\bno (?:visible )?(?:note|warning)s?\b|\bnor? (?:any )?(?:visible )?note\b|\bno [^.,]*mistake warnings\b|\bor (?:a )?(?:visible )?note that it can make mistakes|\b(?:is|are)n't visible|\b(?:is|are) not visible/i.test(t);
      if (negative && present) say(s, `says no mistakes note is visible, but D6 records one`);
      if (!negative && !present) say(s, `describes a mistakes note, but D6 records none`);
      if (!negative && present && dType === "ai_generated" && /make mistakes|can be wrong|may be wrong/i.test(t)) {
        say(s, `calls the note "can make mistakes", but D6 type is ai_generated (§7.5 D6)`);
      }
    }
    // Contrast claims (C2 / C3), by the sentence's sources
    const cs = s.sources.filter((x) => x === "C2" || x === "C3");
    if (cs.length && /guideline|recommend/i.test(t) && !/\bweek of\b/i.test(t)) {
      const neg = /lighter than|fainter than|darker than|than (?:a |the )?(?:common )?(?:accessibility )?guideline|recommends|recommended|does not meet|doesn't meet|do not meet|not meet|below/i.test(t);
      const pos = !neg && /\bmeets?\b|\bmeeting\b/i.test(t);
      const res = cs.map((id) => m[id]?.result).filter(Boolean);
      if (pos && res.includes("approx_fail")) say(s, `says the text meets the guideline, but ${cs.filter((id) => m[id]?.result === "approx_fail").join(", ")} is approx_fail`);
      if (neg && res.length && res.every((r) => r === "approx_pass")) say(s, `says the text is below the guideline, but ${cs.join(", ")} is approx_pass`);
    }
    // Sidebar width (L2)
    if (l2 !== null && /\bsidebar|menu on the left|strip of icons|bar of icons|column of icons/i.test(t)) {
      if (/\bno (?:open )?sidebar\b/i.test(t) && l2 > 0) say(s, `says there is no sidebar, but L2 is ${l2}%`);
      const fr = t.match(/\b(half|third|quarter|fourth|fifth|sixth|seventh|eighth|tenth|twentieth)\b/i);
      const pc = t.match(/\b(\d+(?:\.\d+)?)\s*(?:percent|%)/i);
      const target = fr ? FRACTIONS[fr[1].toLowerCase()] : pc ? Number(pc[1]) : null;
      if (target !== null && Math.abs(target - l2) > 6) say(s, `describes the sidebar as about ${target}% of the width, but L2 is ${l2}%`);
    }
    // Message box outline (C4)
    const c4 = boxResult(m.C4);
    if (/outline of the message box|message box outline/i.test(t) && c4) {
      if (/faint, but/i.test(t) && c4 !== "approx_unclear") say(s, `uses the approx_unclear sentence, but C4 for the message box is ${c4}`);
      if (/easy to see/i.test(t) && !/faint/i.test(t) && c4 !== "approx_pass") say(s, `says the outline is easy to see, but C4 for the message box is ${c4}`);
      if (/hard to see/i.test(t) && c4 === "approx_pass") say(s, `says the outline is hard to see, but C4 for the message box is approx_pass`);
    }
  }
  // E1 not measured (§10.2)
  const e1Sentence = sentences.find((s) => /colors were not measured/i.test(s.text));
  if (a.e1_available === false && !e1Sentence) push("text-vs-metrics", `e1_available is false but the summary lacks "Text and background colors were not measured for this capture."`, "summary");
  if (a.e1_available === true && e1Sentence) say(e1Sentence, `says colours were not measured, but e1_available is true`);
}

/** Menu-item names a sentence mentions, with their role ("current" = should be in this week's N1). */
export function menuNames(text) {
  const t = text.replace(/[.]$/, "");
  const out = [];
  const add = (role, s) => {
    for (const n of String(s).split(/,\s*|\s+and\s+/)) {
      const name = n.replace(/^(?:the|a|an)\s+/i, "").replace(/["“”]/g, "").trim();
      if (name) out.push({ role, name });
    }
  };
  let m;
  if ((m = t.match(/\b(?:item|section|label|button|tab|link)\s+(.+?)\s+(?:is|are)\s+now\s+(?:labeled|labelled|called|named)\s+(.+)$/i))) { add("previous", m[1]); add("current", m[2]); }
  else if ((m = t.match(/\bThe\s+(.+?)\s+(?:label|item|button|tab)\b.*?\bnow\s+reads\s+(.+)$/i))) { add("previous", m[1]); add("current", m[2]); }
  else if ((m = t.match(/\bchanged from\s+(.+?)\s+to\s+(.+)$/i))) { add("previous", m[1]); add("current", m[2]); }
  else if ((m = t.match(/\b(?:item|button)\s+(.+?)\s+now appears as\s+(.+?)(?:\s+without.*)?$/i))) { add("previous", m[1]); add("current", m[2]); }
  else if ((m = t.match(/^The\s+(.+?)\s+(?:items?|buttons?|tabs?|links?|sections?)\s+no longer appears?\b/i))) add("previous", m[1]);
  else if ((m = t.match(/^An? (?:new\s+)?icon button \((.+?)\) no longer appears\b/i))) add("previous", m[1]);
  else if ((m = t.match(/^An? (?:new\s+)?icon button \((.+?)\) (?:now )?appears\b/i))) add("current", m[1]);
  else if ((m = t.match(/^An? new\s+(.+?)\s+(?:items?|buttons?|tabs?|links?)\s+(?:now\s+)?appears?\b/i))) add("current", m[1]);
  return out;
}

function ruleMenuItems(a, prev, push) {
  const items = n1Items(a);
  const hasIconLabel = versionAtLeast(a.guideline_version, "1.5.1"); // icon_label arrived in guideline 1.5.1
  if (items) {
    for (const [i, it] of items.entries()) {
      if (hasIconLabel && (it?.label === null || it?.label === undefined || it?.label === "")) {
        if (typeof it?.icon_label !== "string" || !it.icon_label.trim()) {
          push("menu-items", `N1 item ${i + 1} (${it?.region ?? "?"} #${it?.order ?? "?"}) has no label and no icon_label (§7.2)`, "metrics.N1");
        } else if (it.icon_label.length > 24 || it.icon_label.trim().split(/\s+/).length > 3 || it.icon_label.trim().split(/\s+/).length < 2) {
          push("menu-items", `N1 item ${i + 1} icon_label "${it.icon_label}" must be 2-3 words, at most 24 characters (§7.2)`, "metrics.N1");
        }
      }
      if (typeof it?.label === "string" && /\(translated from/i.test(it.label)) {
        push("menu-items", `N1 item ${i + 1} label "${it.label}" contains "(translated from …)"; use translated_from (§7.2)`, "metrics.N1");
      }
    }
  }
  const current = (items ?? []).flatMap(itemNames);
  const n1Changes = (a.changes_vs_previous ?? []).filter((c) => c?.id === "N1");
  const prevItems = prev ? n1Items(prev.analysis) : null;
  const previous = [...(prevItems ?? []).flatMap(itemNames), ...n1Changes.map((c) => norm(c.previous)).filter(Boolean)];
  const changeCurrent = n1Changes.map((c) => norm(c.current)).filter(Boolean);

  for (const [i, s] of (a.summary_sentences ?? []).entries()) {
    const text = str(s?.text);
    const fromN1 = (s?.sources ?? []).includes("N1");
    if (!fromN1) continue;
    for (const { role, name } of menuNames(text)) {
      if (role === "current") {
        if (items && !namedIn(name, current) && !namedIn(name, changeCurrent)) {
          push("menu-items", `"${name}" is named as a current menu item but isn't in N1`, `summary sentence ${i + 1}`, text);
        }
      } else {
        if (items && namedIn(name, current) && /no longer/i.test(text)) {
          push("menu-items", `"${name}" is said to no longer appear, but it is still in N1`, `summary sentence ${i + 1}`, text);
        }
        if ((prevItems || n1Changes.length) && !namedIn(name, previous)) {
          push("menu-items", `"${name}" is named as a previous menu item but isn't in the previous week's N1 or in the N1 changes`, `summary sentence ${i + 1}`, text);
        }
      }
    }
  }
  // N1 change entries that contradict this week's N1
  if (items) {
    for (const [i, c] of (a.changes_vs_previous ?? []).entries()) {
      if (c?.id !== "N1") continue;
      const where = `changes_vs_previous[${i}] (N1 ${c.change})`;
      if (["added", "renamed", "icon_changed"].includes(c.change) && c.current && !namedIn(c.current, current)) {
        push("menu-items", `current "${c.current}" isn't in this week's N1`, where);
      }
      if (c.change === "removed" && c.previous && items.some((it) => it?.region === c.region && itemNames(it).includes(norm(c.previous)))) {
        push("menu-items", `removed item "${c.previous}" is still in this week's N1 (${c.region})`, where);
      }
    }
  }
}

const COMPARISON = /\b(no longer|differs?|differ from|looks the same|is the same as|are the same as|unlike|compared with|now|changed from)\b|\bweek of \d{4}-\d{2}-\d{2}|^An? new .+ appears?\b/i;
const DEFINITE = /\b(now|no longer|new|changed|unlike|brighter|darker|fainter|lighter|smaller|larger|bigger|narrower|wider|lower|higher|moved)\b/i;
const POPUP = /pop-?up|popover|onboarding|feature tour|\btour\b|survey|welcome (?:card|dialog|modal|pop)|cookie|promo|promotional|upgrade card|banner/i;

// §9.1: context field → metrics whose changes are possibly_confounded when it differs.
const CONFOUND_TABLE = {
  plan_tier_visible: ["L1", "L4", "N1", "D3", "D4", "D5", "D6"],
  personalized_content: ["H1", "D7"],
  time_dependent_content: ["H1", "H3", "D7"],
  ui_language: ["H3", "C5", "N1", "D5", "D6", "D7"],
  hover_or_focus_visible: ["C1"],
  promotional_content: ["L1", "L4", "H1", "H2", "D3"],
};
const ctxValue = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

/** Why a change entry doesn't meet the §9.3 threshold, or null when it does (or can't be judged). */
export function belowThreshold(c) {
  const { id, previous: p, current: q } = c;
  if (p == null && q == null) return null;
  if (id !== "N1" && JSON.stringify(p) === JSON.stringify(q)) return "previous and current are identical";
  switch (id) {
    case "L2": { const a = pct(p), b = pct(q); if (a !== null && b !== null && Math.abs(a - b) < 5) return `L2 differs by ${Math.abs(a - b).toFixed(1)} points (threshold 5)`; break; }
    case "H2": { const a = pct(p), b = pct(q); if (a !== null && b !== null && Math.abs(a - b) < 1) return `H2 differs by ${Math.abs(a - b).toFixed(1)} points (threshold 1.0)`; break; }
    case "C2": case "C3": case "C4": {
      const a = ratios(p), b = ratios(q), ra = results(p), rb = results(q);
      if (a.length && a.length === b.length && JSON.stringify(ra) === JSON.stringify(rb)) {
        const d = Math.max(...a.map((x, i) => Math.abs(x - b[i])));
        if (d < 0.5) return `${id} ratios differ by at most ${d.toFixed(1)} and the result is the same (threshold 0.5)`;
      }
      break;
    }
    case "C1": {
      const a = hexes(p), b = hexes(q);
      if (a.length && a.length === b.length) {
        let d = 0;
        for (let i = 0; i < a.length; i++) for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(parseInt(a[i].slice(k * 2, k * 2 + 2), 16) - parseInt(b[i].slice(k * 2, k * 2 + 2), 16)));
        if (d < 16) return `C1 colours differ by at most ${d} per channel (threshold 16)`;
      }
      break;
    }
    case "D3": { const a = firstInt(p), b = firstInt(q); if (a !== null && b !== null && a === b) return `D3 count is ${a} in both weeks`; break; }
    case "L4": {
      const parse = (v) => (v && typeof v === "object" ? v : Object.fromEntries([...str(v).matchAll(/([A-Za-z][A-Za-z _-]*?)\s*:?\s*(\d+)\b/g)].map((m) => [m[1].trim().toLowerCase(), Number(m[2])])));
      const a = parse(p), b = parse(q);
      const keys = Object.keys(a).filter((k) => k !== "total");
      if (keys.length && keys.length === Object.keys(b).filter((k) => k !== "total").length && keys.every((k) => typeof b[k] === "number")) {
        if (keys.every((k) => Math.abs(a[k] - b[k]) < 3)) return `no L4 region count differs by 3 or more`;
      }
      break;
    }
    case "N1":
      if (!["added", "removed", "renamed", "badge_changed", "icon_changed"].includes(c.change)) return `N1 change "${c.change}" isn't one of added, removed, renamed, badge_changed, icon_changed`;
      if ((c.change === "renamed" || c.change === "icon_changed") && norm(p) === norm(q)) return `N1 ${c.change} with the same name in both weeks`;
      break;
  }
  return null;
}

function ruleCrossWeek(a, prev, push, previousWeek) {
  const changes = Array.isArray(a.changes_vs_previous) ? a.changes_vs_previous : [];
  const sentences = (a.summary_sentences ?? []).map((s, i) => ({ text: str(s?.text), sources: s?.sources ?? [], i }));
  const comparisons = sentences.filter((s) => s.i > 0 && COMPARISON.test(s.text));
  const say = (s, msg) => push("cross-week", msg, `summary sentence ${s.i + 1}`, s.text);

  if (!previousWeek) {
    if (changes.length) push("cross-week", `previous_week is missing but changes_vs_previous has ${changes.length} entries`, "changes_vs_previous");
    for (const s of comparisons) say(s, `week-over-week claim, but previous_week is missing`);
    return;
  }

  // Each change entry: thresholds and confound rules
  const pc = prev?.analysis?.context ?? null;
  const cc = a.context ?? {};
  const premiseBroken = prev?.analysis
    ? ["viewport", "scope"].filter((k) => prev.analysis[k] !== undefined && prev.analysis[k] !== a[k])
      .concat(["color_scheme", "account_type"].filter((k) => pc?.[k] !== undefined && pc[k] !== cc[k]))
    : [];
  // A field missing from either week (older guideline versions lacked promotional_content and
  // conversation_open) is unknown, not a difference.
  const known = (k) => pc && pc[k] !== undefined && cc[k] !== undefined;
  const differing = pc ? Object.keys(CONFOUND_TABLE).filter((k) => known(k) && JSON.stringify(ctxValue(pc[k])) !== JSON.stringify(ctxValue(cc[k]))) : [];
  const convDiffers = known("conversation_open") && Boolean(pc.conversation_open) !== Boolean(cc.conversation_open);
  const prevSidebar = prev ? metricMap(prev.analysis).N1?.sidebar : undefined;
  const curSidebar = metricMap(a).N1?.sidebar;

  for (const [i, c] of changes.entries()) {
    const where = `changes_vs_previous[${i}] (${c?.id}${c?.change ? ` ${c.change}` : ""})`;
    if (!["changed", "possibly_confounded", "confounded"].includes(c?.status)) {
      push("cross-week", `status ${JSON.stringify(c?.status)} (must be changed, possibly_confounded or confounded)`, where);
      continue;
    }
    const below = belowThreshold(c);
    if (below) push("cross-week", `below the §9.3 threshold: ${below}`, where);
    if (c.status === "confounded") continue;
    if (premiseBroken.length) { push("cross-week", `§9.1 premise differs from the previous week (${premiseBroken.join(", ")}), so every change must be confounded`, where); continue; }
    if (convDiffers) { push("cross-week", `conversation_open differs from the previous week, so every change must be confounded (§9.1)`, where); continue; }
    if (c.id === "N1") {
      const n1Strict = ["ui_language", "plan_tier_visible"].filter((k) => differing.includes(k));
      if (n1Strict.length) push("cross-week", `${n1Strict.join(", ")} differs from the previous week, so N1 changes must be confounded (§9.1)`, where);
      else if (c.region === "sidebar" && prevSidebar && curSidebar && prevSidebar !== curSidebar) push("cross-week", `N1.sidebar is ${prevSidebar} last week and ${curSidebar} this week, so sidebar changes must be confounded (§9.1)`, where);
      const pickers = (n1Items(a) ?? []).filter((it) => it?.role === "model_picker").map((it) => norm(it.current));
      if (c.change === "renamed" && c.current && pickers.includes(norm(c.current))) push("cross-week", `the model picker's shown name changed; that is session state, not an N1 change (§9.3 rule 5)`, where);
      if (c.status === "changed" && POPUP.test(`${str(c.previous)} ${str(c.current)} ${str(c.note)}`)) push("cross-week", `pop-up or promotional element marked changed; it must be possibly_confounded (§9.1)`, where);
      continue;
    }
    if (c.status !== "changed") continue;
    const d7Text = (v) => norm(str(v).replace(/\([^)]*\)/g, "").split(";")[0]);
    if (c.id === "D7" && d7Text(c.previous) !== d7Text(c.current)) push("cross-week", `D7 greeting text changes are always possibly_confounded (§9.1 greeting rotation)`, where);
    const fields = differing.filter((k) => CONFOUND_TABLE[k].includes(c.id));
    if (fields.length) push("cross-week", `${fields.join(", ")} differs from the previous week, so a ${c.id} change must be possibly_confounded (§9.1)`, where);
    else if (POPUP.test(`${str(c.previous)} ${str(c.current)}`)) push("cross-week", `pop-up or promotional element marked changed; it must be possibly_confounded (§9.1)`, where);
  }

  // Summary comparison sentences
  const reportable = changes.filter((c) => c?.status === "changed" || c?.status === "possibly_confounded");
  const same = comparisons.filter((s) => /looks the same|is the same as|are the same as/i.test(s.text));
  if (a.previous_week && !reportable.length && !same.length && !comparisons.length) {
    push("cross-week", `no reportable changes, but the summary lacks "The main screen looks the same as the week of ${previousWeek}." (§10.2)`, "summary");
  }
  for (const s of same) if (reportable.some((c) => c.status === "changed")) say(s, `says the screen looks the same, but changes_vs_previous has changed entries`);
  for (const s of comparisons) {
    const weeks = [...s.text.matchAll(/\bweek of (\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
    for (const w of weeks) if (w !== previousWeek) say(s, `compares with the week of ${w}, but previous_week is ${previousWeek}`);
    if (same.includes(s)) continue;
    const ids = s.sources.filter((x) => /^[LNHCD][1-7]$/.test(x));
    if (!ids.length) continue; // e.g. sources ["changes_vs_previous"]: nothing to match against
    const matched = changes.filter((c) => ids.includes(c?.id));
    const usable = matched.filter((c) => c.status !== "confounded");
    if (!matched.length) say(s, `comparison sentence, but none of its sources (${ids.join(", ")}) has an entry in changes_vs_previous`);
    else if (!usable.length) say(s, `comparison sentence built only on confounded changes (§10.2: confounded changes aren't written)`);
    else if (usable.every((c) => c.status === "possibly_confounded") && DEFINITE.test(s.text) && !/\bdiffers?\b/i.test(s.text)) {
      say(s, `written as a definite change, but its changes are only possibly_confounded; use neutral wording such as "differs from" (§10.2)`);
    }
  }
  const menuChanged = changes.some((c) => c?.id === "N1" && c.status === "changed");
  const firstReal = comparisons.find((s) => !same.includes(s));
  if (menuChanged && firstReal && !firstReal.sources.includes("N1")) say(firstReal, `menu changes come first among comparison sentences (§10.2), but this one isn't from N1`);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const HANDLE = /(?:^|[\s(])@[A-Za-z0-9_]{3,}\b/;
const GREETING_NAME = /\b(?:hi|hello|hey|good (?:morning|afternoon|evening)|welcome back|evening|morning|afternoon),?\s+([A-Z][a-z]{1,})\b/;
const NOT_A_NAME = new Set(["I", "What", "How", "Where", "When", "Why", "Who", "Ready", "Let", "Lets", "Welcome", "There", "Here",
  "Ask", "Need", "Want", "Got", "Time", "Is", "Are", "Can", "Shall", "Please", "Today", "Again", "Back", "Friend", "Everyone", "World", "Is"]);
const EXCLUDED_MENTION = /\b(?:account|avatar|profile (?:photo|picture)|user ?name|e-?mail|excluded|redact|recent (?:chats|conversations)|chat history|conversation (?:titles?|list|history)|pinned|your (?:projects|chats|conversations|files))\b/i;
const EXCLUDED_REGION = "account-specific area (excluded)";

function rulePrivacy(a, privateTerms, push) {
  // Field names only, never the matched text: the review file must not repeat excluded content.
  for (const { path, text } of allStrings(a)) {
    if (EMAIL.test(text)) push("privacy", `email-like text`, path);
    if (HANDLE.test(text) && !/original_text$/.test(path)) push("privacy", `@handle-like text`, path);
    const g = text.match(GREETING_NAME);
    if (g && !NOT_A_NAME.has(g[1])) push("privacy", `greeting followed by a capitalised word that may be a name; use [name] (§2.2)`, path);
  }
  if (privateTerms?.length) {
    const hay = JSON.stringify(a).toLowerCase();
    const lines = privateTerms.map((t, i) => [t, i + 1]).filter(([t]) => hay.includes(t.toLowerCase())).map(([, n]) => n);
    if (lines.length) push("privacy", `private-terms.txt hit(s) on line(s) ${lines.join(", ")}`, "analysis.json");
  }
  for (const [i, s] of (a.summary_sentences ?? []).entries()) {
    if (EXCLUDED_MENTION.test(str(s?.text))) push("privacy", `the public summary may mention an excluded area or account content (§2.2: never mentioned)`, `summary sentence ${i + 1}`);
  }
  const l1 = metricMap(a).L1?.value;
  let excluded = 0;
  if (Array.isArray(l1)) {
    for (const [i, r] of l1.entries()) {
      const name = str(r?.region ?? r?.name ?? r);
      if (name === EXCLUDED_REGION) excluded++;
      else if (/exclud|account/i.test(name)) push("privacy", `L1 region ${i + 1} looks like an excluded area but isn't named exactly "${EXCLUDED_REGION}"`, `metrics.L1.value[${i}]`);
    }
  } else if (typeof l1 === "string" && l1.includes(EXCLUDED_REGION)) excluded++;
  if (typeof a.context?.privacy_flag !== "boolean") push("privacy", `context.privacy_flag must be true or false`, "context.privacy_flag");
  else if (excluded && !a.context.privacy_flag) push("privacy", `L1 has ${excluded} excluded area(s) but privacy_flag is false (§2.3)`, "context.privacy_flag");
  const d5 = metricMap(a).D5;
  if (d5 && /Suggestions are labeled as personali[sz]ed/i.test(str(d5.note))) {
    const sp = d5.value && typeof d5.value === "object" ? Object.entries(d5.value).find(([k]) => /^sugg/i.test(k))?.[1] : null;
    const texts = sp && typeof sp === "object" ? [sp.texts, sp.labels].flat().filter(Boolean) : [];
    if (texts.length || d5.original_text) push("privacy", `D5 suggestions are labeled personalized, but their texts are recorded (§2.2)`, "metrics.D5");
  }
}

// ---------------------------------------------------------------------------------------------
// Entry points

/**
 * Lint one analysis.
 * @param a analysis JSON
 * @param opts.banned      bannedPhrases(SKILL.md) result
 * @param opts.previous    { analysis, source } for the previous week, or null
 * @param opts.privateTerms lines of private-terms.txt (optional)
 * @param opts.previousWeek fallback for analyses that predate the previous_week field (input.json's value)
 * @returns [{ rule, message, where, sentence? }]
 */
export function lintAnalysis(a, { banned, previous = null, privateTerms = [], previousWeek = null } = {}) {
  const findings = [];
  const push = (rule, message, where, sentence) => {
    const f = { rule, message, where };
    if (sentence !== undefined && rule !== "privacy") f.sentence = sentence;
    if (!findings.some((x) => x.rule === f.rule && x.message === f.message && x.where === f.where)) findings.push(f);
  };
  if (!a || typeof a !== "object") return [{ rule: "metric-range", message: "analysis is not a JSON object", where: "analysis.json" }];
  if (a.status !== "ok") return findings; // not_analyzable: nothing to lint
  ruleBanned(a, banned ?? { anywhere: [], summaryOnly: [] }, push);
  ruleRanges(a, push);
  ruleTextVsMetrics(a, push);
  ruleMenuItems(a, previous, push);
  ruleCrossWeek(a, previous, push, a.previous_week !== undefined ? a.previous_week : previousWeek);
  rulePrivacy(a, privateTerms, push);
  return findings;
}

/** The previous week's analysis for comparison: previous.json if prepare.mjs fetched it, else the local file. */
function loadPrevious(workDir, slug, a, previousWeek) {
  if (!previousWeek) return null;
  const candidates = [
    [join(workDir, slug, a.week, "previous.json"), "previous.json (published)"],
    [join(workDir, slug, previousWeek, "analysis.json"), `local ${previousWeek} analysis.json`],
  ];
  for (const [file, source] of candidates) {
    if (!existsSync(file)) continue;
    try {
      const p = JSON.parse(readFileSync(file, "utf8"));
      if (p?.week === previousWeek || file.endsWith("previous.json")) return { analysis: p, source };
    } catch { /* unreadable: try the next one */ }
  }
  return null;
}

/** Lint every analysis/work/<slug>/<week>/analysis.json. Returns [{ slug, file, status, previousSource, findings }]. */
export function lintWeek(week, { workDir = join(__dirname, "work"), skillPath = SKILL_PATH, termsPath = join(__dirname, "private-terms.txt") } = {}) {
  const banned = bannedPhrases(readFileSync(skillPath, "utf8"));
  const privateTerms = existsSync(termsPath)
    ? readFileSync(termsPath, "utf8").split(/\r?\n/).map((t) => t.trim()).filter(Boolean) : [];
  const out = [];
  const slugs = existsSync(workDir) ? readdirSync(workDir).filter((s) => statSync(join(workDir, s)).isDirectory() && s !== "redact").sort() : [];
  for (const slug of slugs) {
    const file = join(workDir, slug, week, "analysis.json");
    if (!existsSync(file)) continue;
    let a;
    try { a = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
      out.push({ slug, file, status: "invalid", previousSource: null, findings: [{ rule: "metric-range", message: `not valid JSON: ${e.message}`, where: "analysis.json" }] });
      continue;
    }
    let previousWeek = a.previous_week ?? null;
    if (a.previous_week === undefined) { // older analyses predate the field; prepare.mjs recorded it in input.json
      try { previousWeek = JSON.parse(readFileSync(join(workDir, slug, week, "input.json"), "utf8")).previous_week ?? null; } catch { /* no input.json */ }
    }
    const previous = loadPrevious(workDir, slug, a, previousWeek);
    out.push({ slug, file, status: a.status, previousSource: previous?.source ?? null, findings: lintAnalysis(a, { banned, previous, privateTerms, previousWeek }) });
  }
  return out;
}

const quote = (s) => `"${String(s).replace(/\s+/g, " ")}"`;

export function textReport(week, results) {
  const lines = [`Lint — week ${week} (${results.length} analyses; warnings only, nothing is blocked)`];
  for (const r of results) {
    const n = r.findings.length;
    lines.push("", `${r.slug}: ${r.status !== "ok" ? `skipped (status ${r.status})` : n ? `${n} warning${n === 1 ? "" : "s"}` : "PASS"}${r.previousSource ? `  [previous: ${r.previousSource}]` : ""}`);
    for (const f of r.findings) {
      lines.push(`  - [${f.rule}] ${f.where}: ${f.message}`);
      if (f.sentence) lines.push(`      ${quote(f.sentence)}`);
    }
  }
  return lines.join("\n");
}

export function markdownReport(week, results) {
  const lines = ["## Lint", "",
    `Deterministic checks from \`analysis/lint.mjs ${week}\` (guideline wording, metric ranges, text vs metrics, menu items, cross-week rules, privacy). Warnings only; they never block publishing. Privacy findings name the field and never repeat its text.`,
    "", "| Portal | Result | Rules |", "|---|---|---|"];
  for (const r of results) {
    const n = r.findings.length;
    const rules = [...new Set(r.findings.map((f) => f.rule))].join(", ");
    lines.push(`| ${r.slug} | ${r.status !== "ok" ? `skipped (${r.status})` : n ? `${n} warning${n === 1 ? "" : "s"}` : "pass"} | ${rules || "—"} |`);
  }
  for (const r of results.filter((x) => x.findings.length)) {
    lines.push("", `### ${r.slug}`, "");
    if (r.previousSource) lines.push(`Previous week read from ${r.previousSource}.`, "");
    for (const f of r.findings) {
      lines.push(`- **${f.rule}** · ${f.where}: ${f.message}${f.sentence ? `\n  > ${String(f.sentence).replace(/\s+/g, " ")}` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Put the Lint section into a review file: replace an earlier "## Lint" section, else insert it before the first "## ". */
export function withLintSection(review, section) {
  const lines = review.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Lint");
  if (start >= 0) {
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;
    return [...lines.slice(0, start), ...section.trimEnd().split("\n"), "", ...lines.slice(end)].join("\n");
  }
  const first = lines.findIndex((l) => /^## /.test(l));
  if (first < 0) return review.trimEnd() + "\n\n" + section;
  return [...lines.slice(0, first), ...section.trimEnd().split("\n"), "", ...lines.slice(first)].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const week = args.find((x) => !x.startsWith("--"));
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    console.error("usage: node analysis/lint.mjs <week YYYY-MM-DD> [--markdown] [--write-review]");
    process.exit(1);
  }
  const results = lintWeek(week);
  if (!results.length) console.error(`· no analysis/work/*/${week}/analysis.json files`);
  if (args.includes("--markdown")) process.stdout.write(markdownReport(week, results));
  else console.log(textReport(week, results));
  if (args.includes("--write-review")) {
    const file = join(__dirname, "work", `review-${week}.md`);
    if (!existsSync(file)) { console.error(`✗ ${file} doesn't exist; nothing written`); return; }
    writeFileSync(file, withLintSection(readFileSync(file, "utf8"), markdownReport(week, results)));
    console.error(`✓ Lint section written to ${file}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

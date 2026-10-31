import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareFindings, findingLists, findingsCellHTML, tableFindings } from '../../public/analytics-canvas.js';

// The findings behind the Canvas box and the Table's Differences / Similarities rows (public/analytics-canvas.js).
// Real metrics from /api/captures for 2026-09-28 to 2026-10-12, with the Canvas output recorded before the refactor.

type Card = { label: string; slug: string; week: string; metrics: Record<string, unknown> | null };
const SNAP = JSON.parse(readFileSync(new URL('../fixtures/compare-findings-before.json', import.meta.url), 'utf8')) as {
  cards: Record<string, Card>; cases: { a: string; b: string; weekLabels?: boolean; out: string[] }[];
};
/** A real card; Single portal labels cards by their week, like Compare does. */
const card = (id: string, label?: string): Card => ({ ...SNAP.cards[id], ...(label ? { label } : {}) });
const oct12 = card('chatgpt@2026-10-12', 'Oct 12'), oct5 = card('chatgpt@2026-10-05', 'Oct 5');

const base = { colorScheme: 'dark', sidebarPct: 20, inputAreaPct: 4, inputPosition: 'middle', clickableApprox: 20, textSizes: 4, suggestedPrompts: 0, aiNote: false };
const synthetic = (label: string, metrics: Record<string, unknown> | null, extra = {}) => ({ label, slug: label.toLowerCase(), week: '2026-10-12', metrics, ...extra });

describe('findingLists', () => {
  it('splits ChatGPT Oct 12 vs Oct 5: menu changes first among differences, the rules on one side each', () => {
    const { differences, similarities, missing } = findingLists(oct12, oct5);
    expect(differences.slice(0, 2)).toEqual(['The More item in the side menu is now labeled Explore.', 'The Upgrade item no longer appears in the bar across the top.']);
    expect(missing).toEqual([]);
    // Every rule lands on exactly one side; the color scheme is not a rule.
    expect(differences.length - 2 + similarities.length).toBe(7);
  });

  it('names the fields each card is missing, never the color scheme', () => {
    const a = synthetic('A', { ...base, aiNote: null }), b = synthetic('B', { ...base, colorScheme: null, textSizes: null });
    expect(findingLists(a, b).missing).toEqual(['No data for A: menu items, note about AI limits', 'No data for B: menu items, text sizes']);
  });

  // The color scheme follows the capture machine's system setting, so it is never a finding.
  it('never compares the color scheme, the same or different', () => {
    for (const [x, y] of [['dark', 'dark'], ['dark', 'light'], ['light', 'light']]) {
      for (const brief of [false, true]) {
        const a = synthetic('A', { ...base, colorScheme: x }), b = synthetic('B', { ...base, colorScheme: y });
        const { differences, similarities } = findingLists(a, b, { brief });
        expect([...differences, ...similarities].join(' ')).not.toMatch(/\b(?:dark|light)\b|color scheme|colour scheme|\bmode\b|theme/i);
        expect(findingLists(a, b, { brief })).toEqual(findingLists(synthetic('A', { ...base, colorScheme: 'dark' }), synthetic('B', { ...base, colorScheme: 'dark' }), { brief }));
      }
    }
  });
});

describe('compareFindings (Canvas box) is unchanged by the refactor', () => {
  // Recorded before the color scheme stopped being a finding: pairs without a color-scheme line must match exactly;
  // the others lose that line and keep every other recorded line, in order (a similarity may take its place).
  const colorLine = (l: string) => /captured in (?:dark|light) mode/.test(l);
  // Recorded before menu lines named regions plainly ("in the side menu") and week-only lists began "Only on Oct 5:".
  const REGION: Record<string, string> = { sidebar: 'the side menu', 'top bar': 'the bar across the top', 'input area': 'the message box' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (w: string) => `${MONTHS[Number(w.slice(5, 7)) - 1]} ${Number(w.slice(8))}`;
  // The recorded "<label> shows menu items that <label> does not:" could not tell two weeks of one portal apart
  // ("ChatGPT ... ChatGPT"), so the week an "Only on" line names is checked on its own below.
  const ONLY = /^(?:Only on [A-Z][a-z]{2} \d{1,2}|.+ shows menu items that .+ does not):/;
  const plain = (l: string) => l
    .replace(ONLY, 'Only on <week>:')
    .replace(/\((sidebar|top bar|input area)\)/g, (_, r) => `(in ${REGION[r]})`)
    .replace(/The (sidebar|top bar|input area) item (.+?) is now labeled/, (_, r, x) => `The ${x} item in ${REGION[r]} is now labeled`)
    .replace(/(appears|appear) in the (sidebar|top bar|input area)/, (_, v, r) => `${v} in ${REGION[r]}`)
    .replace(/of an? (sidebar|top bar|input area) button/, (_, r) => `of a button in ${REGION[r]}`)
    .replace('outside the sidebar', 'outside the side menu');
  it(`gives the recorded output for all ${SNAP.cases.length} real card pairs, without the color scheme`, () => {
    let withColor = 0;
    for (const c of SNAP.cases) {
      const a = c.weekLabels ? card(c.a, c.a.split('@')[1]) : card(c.a);
      const b = c.weekLabels ? card(c.b, c.b.split('@')[1]) : card(c.b);
      const raw = compareFindings(a, b);
      for (const l of raw.filter((x) => x.startsWith('Only on '))) expect([a.week, b.week].map((w) => `Only on ${day(w)}:`)).toContain(l.split(':')[0] + ':');
      const out = raw.map(plain);
      expect(out.join(' '), `${c.a} vs ${c.b}`).not.toMatch(/captured in|color scheme/);
      const recorded = c.out.map(plain);
      if (!recorded.some(colorLine)) { expect(out, `${c.a} vs ${c.b}`).toEqual(recorded); continue; }
      withColor++;
      const kept = recorded.filter((l) => !colorLine(l) && !l.startsWith('No data for'));
      expect(out.filter((l) => kept.includes(l)), `${c.a} vs ${c.b}`).toEqual(kept);
    }
    expect(withColor).toBe(22);
  });
});

describe('tableFindings and findingsCellHTML (Table rows)', () => {
  it('missing metrics: Not enough data to compare', () => {
    const meta = card('meta-ai@2026-10-12'); // no metrics that week
    expect(meta.metrics).toBeNull();
    expect(tableFindings(meta, card('chatgpt@2026-10-12'))).toBeNull();
    for (const kind of ['differences', 'similarities'] as const) {
      expect(findingsCellHTML(null, kind, { heading: 'vs ChatGPT', note: 'From the desktop analysis' }))
        .toBe('<div class="an-cmp-head">vs ChatGPT</div><div class="an-cmp-empty">Not enough data to compare</div>');
    }
  });

  it('more than 6 differences: 5 lines, then "and N more differences"', () => {
    const items = ['A', 'B', 'C', 'D'].map((x) => ({ change: 'renamed', previous: x, current: `${x}2`, region: 'sidebar' }));
    const newer = synthetic('New', { ...base, navChanges: { previousWeek: '2026-10-05', items } }, { slug: 'p' });
    const older = synthetic('Old', { ...base, sidebarPct: 40, textSizes: 7, suggestedPrompts: 2, aiNote: true }, { slug: 'p', week: '2026-10-05' });
    const all = findingLists(newer, older, { navChangeLines: Infinity, brief: true }).differences;
    expect(all).toHaveLength(8); // 4 menu changes + 4 rules
    const t = tableFindings(newer, older)!;
    expect(t.differences).toEqual([...all.slice(0, 5), 'and 3 more differences']);
    // The Canvas box still shows one menu change and a count.
    expect(compareFindings(newer, older)[0]).toBe('The A item in the side menu is now labeled A2.');
    expect(compareFindings(newer, older)[1]).toBe('and 3 more menu changes.');
  });

  it('lists every menu change before the other differences, when there are few enough', () => {
    expect(tableFindings(oct12, oct5)!.differences.slice(0, 2)).toEqual(findingLists(oct12, oct5).differences.slice(0, 2));
  });

  it('at most 5 similarities', () => {
    const a = synthetic('A', { ...base, navItems: [], navSidebarVisible: true }), b = synthetic('B', { ...base, navItems: [], navSidebarVisible: true });
    expect(findingLists(a, b).similarities).toHaveLength(8); // same menu items + 7 rules
    const t = tableFindings(a, b)!;
    expect(t.similarities).toEqual(findingLists(a, b, { brief: true }).similarities.slice(0, 5));
    expect(t.differences).toEqual([]);
    expect(findingsCellHTML(t, 'differences', { heading: 'vs B' })).toBe('<div class="an-cmp-head">vs B</div><div class="an-cmp-empty">No differences found</div>');
  });

  it('renders a heading, the optional note and a bullet list, escaping every text', () => {
    const a = synthetic('<b>A</b>', base), b = synthetic('B & co', { ...base, textSizes: 6 });
    const html = findingsCellHTML(tableFindings(a, b), 'differences', { heading: 'vs <i>B</i>', note: 'From the desktop analysis' });
    expect(html).toBe('<div class="an-cmp-head">vs &lt;i&gt;B&lt;/i&gt;</div><div class="an-cmp-note">From the desktop analysis</div>'
      + '<ul class="an-cmp-list"><li>&lt;b&gt;A&lt;/b&gt; uses 4 text sizes; B &amp; co uses 6.</li></ul>');
  });

  // Each Table list sits under a "<A> vs <B>" heading, so its lines do not repeat both names or dates.
  it('two weeks of one product: "the newer week" and "the older week" instead of their dates', () => {
    const t = tableFindings(oct12, oct5)!;
    expect(t.differences).toContain('The newer week shows no suggested prompts; the older shows 3.');
    expect(t.differences).toContain('The older week shows more clickable items than the newer week (~23 vs ~19).');
    expect(t.similarities).toEqual([
      'Both message boxes cover about 4% of the screen.',
      'Both use 4 text sizes.',
      "Neither shows a note about the AI's limits.",
      'Both message boxes sit in the middle third of the screen.',
    ]);
    expect([...t.differences, ...t.similarities].join(' ')).not.toMatch(/Oct \d/);
    // The same pair in the other order still calls the later week newer.
    expect(tableFindings(oct5, oct12)!.differences).toContain('The older week shows 3 suggested prompts; the newer shows none.');
  });

  it('two products: their names, once each, with "Both" for what they share', () => {
    const t = tableFindings(card('claude@2026-10-12'), card('chatgpt@2026-10-12'))!;
    expect(t.differences).toEqual([
      'Claude shows 14 menu items; ChatGPT shows 13.',
      "Claude's message box covers more of the screen than ChatGPT's (6.5% vs 3.9%).",
      'Claude uses 2 text sizes; ChatGPT uses 4.',
    ]);
    expect(t.similarities).toContain('Both show about the same number of clickable items (~18 vs ~19).');
  });

  it('the Canvas box keeps the full names', () => {
    expect(compareFindings(oct12, oct5).join(' ')).toContain('Oct 12');
  });
});

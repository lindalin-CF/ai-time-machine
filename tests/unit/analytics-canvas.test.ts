import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain browser module without type declarations
import { compareFindings, defaultEdges, defaultLayout, edgeCurve } from '../../public/analytics-canvas.js';

const base = {
  colorScheme: 'dark', sidebarPct: 20, inputAreaPct: 3.3, inputPosition: 'middle',
  clickableApprox: 23, textSizes: 4, suggestedPrompts: 3, aiNote: false,
};
const chatgpt = { label: 'ChatGPT', metrics: base };
const claude = {
  label: 'Claude',
  metrics: { ...base, sidebarPct: 23, inputAreaPct: 6.5, clickableApprox: 18, textSizes: 2, suggestedPrompts: 0 },
};

// Words that would claim more than a metric measures.
const BANNED = /\b(more text|words?|easier|easy|harder|better|worse|cleaner|cluttered|intuitive|user-friendly|usab|readab|convert|engag|perform|effective|modern|redesign)/i;

describe('compareFindings', () => {
  const lines = compareFindings(chatgpt, claude);

  it('gives 2 to 4 one-line findings', () => {
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const l of lines) expect(l).not.toContain('\n');
  });

  it('states the measured values, differences first', () => {
    expect(lines[0]).toBe("Claude's message box covers more of the screen than ChatGPT's (6.5% vs 3.3%).");
    expect(lines[1]).toBe('ChatGPT shows more clickable items than Claude (~23 vs ~18).');
    expect(lines[2]).toBe('ChatGPT shows 3 suggested prompts, Claude shows none.');
  });

  it('always shows clickable counts as approximate', () => {
    const all = compareFindings(
      { label: 'A', metrics: { ...base, clickableApprox: 12 } },
      { label: 'B', metrics: { ...base, clickableApprox: 8 } },
    );
    expect(all).toContain('A shows more clickable items than B (~12 vs ~8).');
    const same = compareFindings(
      { label: 'A', metrics: { ...base, clickableApprox: 12 } },
      { label: 'B', metrics: { ...base, clickableApprox: 11 } },
    ).find((l: string) => l.includes('clickable'));
    expect(same).toBe('A and B show about the same number of clickable items (~12 vs ~11).');
    expect(same.replace(/~\d+/g, '')).not.toMatch(/\d/);
  });

  it('uses only measurement wording', () => {
    const pairs = [
      [chatgpt, claude],
      [{ label: 'A', metrics: { ...base, colorScheme: 'light', inputPosition: 'bottom', aiNote: true, sidebarPct: 0 } }, { label: 'B', metrics: base }],
      [{ label: 'A', metrics: base }, { label: 'B', metrics: base }],
    ];
    for (const [a, b] of pairs) for (const l of compareFindings(a, b)) expect(l).not.toMatch(BANNED);
  });

  it('fills with similarities when little differs', () => {
    const same = compareFindings({ label: 'A', metrics: base }, { label: 'B', metrics: base });
    expect(same).toEqual([
      "A's and B's message boxes cover a similar share of the screen (3.3% vs 3.3%).",
      'A and B show about the same number of clickable items (~23 vs ~23).',
      // base has no N1 data (an analysis from before guideline v1.5).
      'No data for A: menu items; No data for B: menu items.',
    ]);
  });

  it('caps at four findings', () => {
    const other = { colorScheme: 'light', sidebarPct: 0, inputAreaPct: 9, inputPosition: 'bottom', clickableApprox: 5, textSizes: 6, suggestedPrompts: 0, aiNote: true };
    expect(compareFindings({ label: 'A', metrics: base }, { label: 'B', metrics: other })).toHaveLength(4);
  });

  it('compares a field only when both cards have it and names the missing ones', () => {
    const grok = { label: 'Grok', metrics: { ...base, sidebarPct: null, textSizes: null, clickableApprox: null, suggestedPrompts: 0 } };
    expect(compareFindings(chatgpt, grok)).toEqual([
      'ChatGPT shows 3 suggested prompts, Grok shows none.',
      "ChatGPT's and Grok's message boxes cover a similar share of the screen (3.3% vs 3.3%).",
      'No data for ChatGPT: menu items; No data for Grok: menu items, clickable items, sidebar width, text sizes.',
    ]);
  });

  it('names missing fields on both sides in one line', () => {
    const a = { label: 'A', metrics: { ...base, aiNote: null } };
    const b = { label: 'B', metrics: { ...base, colorScheme: null } };
    expect(compareFindings(a, b).at(-1)).toBe('No data for A: menu items, note about AI limits; No data for B: menu items, color scheme.');
  });

  it('says No comparable data when no field is on both sides', () => {
    expect(compareFindings(chatgpt, { label: 'Grok', metrics: null })).toEqual(['No comparable data for ChatGPT and Grok.']);
    expect(compareFindings({ label: 'Kimi' }, { label: 'Grok', metrics: null })).toEqual(['No comparable data for Kimi and Grok.']);
    const onlyA = { label: 'A', metrics: { ...base, inputAreaPct: null, clickableApprox: null, suggestedPrompts: null, sidebarPct: null } };
    const onlyB = { label: 'B', metrics: { colorScheme: null, inputPosition: null, textSizes: null, aiNote: null, inputAreaPct: 4, clickableApprox: 9, suggestedPrompts: 1, sidebarPct: 20 } };
    expect(compareFindings(onlyA, onlyB)).toEqual(['No comparable data for A and B.']);
  });
});

describe('compareFindings menu items (N1)', () => {
  const item = (label: string, region = 'sidebar') => ({ label, region });
  const SEP28 = [item('New chat'), item('Images'), item('Library'), item('Scheduled'), item('Codex'), item('Upgrade', 'top bar')];
  const OCT5 = [item('New chat'), item('Images'), item('Library'), item('Tasks'), item('Codex'), item('Upgrade', 'top bar')];
  const card = (label: string, week: string, nav: Record<string, unknown>, slug = 'chatgpt') =>
    ({ label, slug, week, metrics: { ...base, navSidebarVisible: true, navChanges: null, ...nav } });
  const change = (c: string, previous: string | null, current: string | null, region = 'sidebar') => ({ change: c, previous, current, region });
  const changes = (previousWeek: string, ...items: unknown[]) => ({ navChanges: { previousWeek, items } });

  const sep28 = card('Sep 28', '2026-09-28', { navItems: SEP28 });
  const oct5 = card('Oct 5', '2026-10-05', { navItems: OCT5, ...changes('2026-09-28', change('renamed', 'Scheduled', 'Tasks')) });

  it('adjacent weeks: states a rename first, in either card order', () => {
    expect(compareFindings(sep28, oct5)[0]).toBe('The sidebar item Scheduled is now labeled Tasks.');
    expect(compareFindings(oct5, sep28)[0]).toBe('The sidebar item Scheduled is now labeled Tasks.');
    expect(compareFindings(sep28, oct5).length).toBeLessThanOrEqual(4);
  });

  it('adjacent weeks: uses the recorded changes even when the older card has no menu data', () => {
    const old = card('Sep 28', '2026-09-28', { navItems: null });
    const lines = compareFindings(old, oct5);
    expect(lines[0]).toBe('The sidebar item Scheduled is now labeled Tasks.');
    expect(lines.join(' ')).not.toContain('menu items');
  });

  it('adjacent weeks: an added and a removed item, one line each', () => {
    const b = card('Oct 5', '2026-10-05', { navItems: OCT5, ...changes('2026-09-28', change('added', null, 'Tasks'), change('removed', 'Library', null)) });
    expect(compareFindings(sep28, b).slice(0, 2)).toEqual([
      'A new Tasks item appears in the sidebar.',
      'The Library item no longer appears in the sidebar.',
    ]);
  });

  it('adjacent weeks: more than two changes become one line and a count', () => {
    const b = card('Oct 5', '2026-10-05', { navItems: OCT5, ...changes('2026-09-28',
      change('renamed', 'Scheduled', 'Tasks'), change('added', null, 'Pulse'), change('removed', 'Sora', null, 'top bar')) });
    const lines = compareFindings(sep28, b);
    expect(lines.slice(0, 2)).toEqual(['The sidebar item Scheduled is now labeled Tasks.', 'and 2 more menu changes.']);
    expect(lines.filter((l: string) => /Pulse|Sora/.test(l))).toEqual([]);
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it('non-adjacent weeks of one portal: lists items only one side shows', () => {
    const sep14 = card('Sep 14', '2026-09-14', { navItems: [...SEP28.filter((i) => i.label !== 'Codex'), item('Sora', 'top bar')] });
    expect(compareFindings(sep14, oct5).slice(0, 2)).toEqual([
      'Oct 5 shows menu items that Sep 14 does not: Tasks (sidebar), Codex (sidebar).',
      'Sep 14 shows menu items that Oct 5 does not: Scheduled (sidebar), Sora (top bar).',
    ]);
  });

  it('falls back to comparing items when no change was recorded against the other week', () => {
    const noneRecorded = card('Oct 5', '2026-10-05', { navItems: SEP28, ...changes('2026-09-28') });
    expect(compareFindings(sep28, noneRecorded)[0]).toBe('Both show the same menu items.');
  });

  it('across portals: states each portal\'s item count', () => {
    const claude = card('Claude', '2026-10-05', { navItems: [item('New chat'), item('Chats'), item('Projects')] }, 'claude');
    const chatgpt = card('ChatGPT', '2026-10-05', { navItems: OCT5 });
    expect(compareFindings(chatgpt, claude)[0]).toBe('ChatGPT shows 6 menu items, Claude shows 3.');
    const same = card('Claude', '2026-10-05', { navItems: OCT5 }, 'claude');
    expect(compareFindings(chatgpt, same)).toContain('Both show the same menu items.');
    const sameCount = card('Claude', '2026-10-05', { navItems: OCT5.map((i) => ({ ...i, label: `${i.label}!` })) }, 'claude');
    expect(compareFindings(chatgpt, sameCount)).toContain('ChatGPT and Claude each show 6 menu items.');
  });

  it('leaves out the sidebar when either sidebar is collapsed', () => {
    const collapsed = card('Sep 21', '2026-09-21', { navItems: [item('Upgrade', 'top bar')], navSidebarVisible: false });
    expect(compareFindings(collapsed, oct5)).toContain('Both show the same menu items outside the sidebar.');
    const claude = card('Claude', '2026-10-05', { navItems: [item('Share', 'top bar'), item('Upgrade', 'top bar')], navSidebarVisible: false }, 'claude');
    expect(compareFindings(oct5, claude)[0]).toBe('Oct 5 shows 1 menu item outside the sidebar, Claude shows 2.');
  });

  it('names menu items in the No data line when either card has none', () => {
    const lines = compareFindings(card('Sep 21', '2026-09-21', { navItems: null }), oct5);
    expect(lines.at(-1)).toBe('No data for Sep 21: menu items.');
    expect(lines.some((l: string) => /Tasks|Scheduled/.test(l))).toBe(false);
  });

  it('states icon-only changes as icon buttons', () => {
    const b = card('Oct 5', '2026-10-05', { navItems: OCT5, ...changes('2026-09-28',
      { change: 'added', previous: null, current: 'slider icon', region: 'input area', icon: true },
      { change: 'removed', previous: 'clock icon', current: null, region: 'sidebar', icon: true }) });
    expect(compareFindings(sep28, b).slice(0, 2)).toEqual([
      'An icon button (slider icon) now appears in the input area.',
      'An icon button (clock icon) no longer appears in the sidebar.',
    ]);
  });

  it('states an icon change with the region of the button', () => {
    const iconChanged = (region: string) => ({ change: 'icon_changed', previous: 'bubble-clock icon', current: 'dashed bubble icon', region, icon: true });
    const b = card('Oct 5', '2026-10-05', { navItems: OCT5, ...changes('2026-09-28', iconChanged('top bar'), iconChanged('input area')) });
    expect(compareFindings(sep28, b).slice(0, 2)).toEqual([
      'The icon of a top bar button changed (bubble-clock icon \u2192 dashed bubble icon).',
      'The icon of an input area button changed (bubble-clock icon \u2192 dashed bubble icon).',
    ]);
  });

  it('lists items without text by their icon label when both cards record them', () => {
    const icon = (label: string, region = 'sidebar') => ({ label, region, icon: true });
    const a = card('Sep 14', '2026-09-14', { navItems: [...SEP28, icon('magnifier icon')] });
    const b = card('Oct 5', '2026-10-05', { navItems: [...SEP28, icon('magnifier icon'), icon('bell icon', 'top bar')] });
    expect(compareFindings(a, b)[0]).toBe('Oct 5 shows menu items that Sep 14 does not: an icon button (bell icon) (top bar).');
  });

  it('leaves out items without text when only one card records them', () => {
    const older = card('Sep 14', '2026-09-14', { navItems: SEP28 });
    const newer = card('Oct 5', '2026-10-05', { navItems: [...SEP28, { label: 'bell icon', region: 'top bar', icon: true }] });
    expect(compareFindings(older, newer)[0]).toBe('Both show the same menu items.');
    const claude = card('Claude', '2026-10-05', { navItems: [...SEP28, { label: 'ghost icon', region: 'top bar', icon: true }] }, 'claude');
    expect(compareFindings(card('ChatGPT', '2026-10-05', { navItems: OCT5 }), claude)).toContain('ChatGPT and Claude each show 6 menu items.');
  });

  it('uses only visible-change wording', () => {
    const all = [sep28, oct5, card('Claude', '2026-10-05', { navItems: [item('Chats')] }, 'claude')]
      .flatMap((x) => [sep28, oct5].flatMap((y) => compareFindings(x, y)));
    for (const l of all) expect(l).not.toMatch(/launch|redesign|new feature|introduc|updated/i);
  });
});

describe('default layout', () => {
  it('puts cards in one row and links the first card to each other card', () => {
    const pos = defaultLayout(['a', 'b', 'c']);
    expect(new Set(Object.values(pos).map((p: { y: number }) => p.y))).toEqual(new Set([0]));
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toBeLessThan(pos.c.x);
    expect(defaultEdges(['a', 'b', 'c'])).toEqual([['a', 'b'], ['a', 'c']]);
  });

  it('arcs long lines below the row so their boxes do not sit on the card between', () => {
    const near = edgeCurve(280, 120, 540, 120, 240);
    const far = edgeCurve(280, 120, 1080, 120, 240);
    expect(near.mid[1]).toBe(120);
    expect(far.mid[1]).toBeGreaterThan(120 + 120 + 60);
  });
});

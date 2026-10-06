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
      'No data for Grok: clickable items, sidebar width, text sizes.',
    ]);
  });

  it('names missing fields on both sides in one line', () => {
    const a = { label: 'A', metrics: { ...base, aiNote: null } };
    const b = { label: 'B', metrics: { ...base, colorScheme: null } };
    expect(compareFindings(a, b).at(-1)).toBe('No data for A: note about AI limits; No data for B: color scheme.');
  });

  it('says No comparable data when no field is on both sides', () => {
    expect(compareFindings(chatgpt, { label: 'Grok', metrics: null })).toEqual(['No comparable data for ChatGPT and Grok.']);
    expect(compareFindings({ label: 'Kimi' }, { label: 'Grok', metrics: null })).toEqual(['No comparable data for Kimi and Grok.']);
    const onlyA = { label: 'A', metrics: { ...base, inputAreaPct: null, clickableApprox: null, suggestedPrompts: null, sidebarPct: null } };
    const onlyB = { label: 'B', metrics: { colorScheme: null, inputPosition: null, textSizes: null, aiNote: null, inputAreaPct: 4, clickableApprox: 9, suggestedPrompts: 1, sidebarPct: 20 } };
    expect(compareFindings(onlyA, onlyB)).toEqual(['No comparable data for A and B.']);
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

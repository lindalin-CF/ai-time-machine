import { describe, expect, it } from 'vitest';
import { captureMetrics } from '../../src/capture-metrics';
import { compareFindings, findingLists, tableFindings } from '../../public/analytics-canvas.js';

// Compare's layout findings (public/analytics-canvas.js layoutFindings): the message box and greeting positions from
// their published bounding boxes, and, for two weeks in a row, the newer week's recorded layout changes as the
// analysis's own summary sentences, never confounded ones. Rows are built like published analyses.

type Change = Record<string, unknown>;
type Sentence = { text: string; sources: string[] };
const OPENING = (slug: string, week: string): Sentence =>
  ({ text: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling.`, sources: ['L1'] });

/** A published row: the message box at y `input` (L3), the greeting at y `greeting` (D7, null: none recorded). */
function row(slug: string, week: string, input: number | null, greeting: number | null, o: {
  previousWeek?: string | null; changes?: Change[]; sentences?: Sentence[]; plan?: string; previousPlan?: string; viewport?: string;
} = {}) {
  const analysis = {
    status: 'ok', variant: 'desktop', portal: slug, week, previous_week: o.previousWeek ?? null, guideline_version: '1.10.0',
    viewport: o.viewport ?? '1280x800', context: { color_scheme: 'dark' },
    metrics: [
      { id: 'L3', value: { vertical_third: 'middle' }, location: input === null ? null : [380, input, 770, 60] },
      { id: 'D7', value: greeting === null ? null : 'Hi, how can I help?', location: greeting === null ? null : [440, greeting, 290, 30] },
    ],
    changes_vs_previous: o.changes ?? [],
    summary_sentences: [OPENING(slug, week), ...(o.sentences ?? [])],
  };
  return {
    slug, week, analysis_by: 'guideline-v1.10.0', analysis_json: JSON.stringify(analysis),
    plan: o.plan ?? null, previous_plan: o.previousPlan ?? null,
  };
}
const card = (r: ReturnType<typeof row>, label: string) => ({ label, slug: r.slug, week: r.week, metrics: captureMetrics(r) });
const both = (a: ReturnType<typeof card>, b: ReturnType<typeof card>) =>
  [findingLists(a, b).differences, tableFindings(a, b)!.differences, compareFindings(a, b)].map((l) => l.join(' ')).join(' | ');

// Copilot, as published: the message box 440 -> 400 on the 10px grid (44px from the exact edges), the greeting 350 -> 320.
const L1_CHANGED = { id: 'L1', previous: 'prompt input [380, 440, 770, 60]', current: 'prompt input [380, 400, 770, 60]', status: 'changed', note: '' };
const MOVED = 'Since the week of 2026-10-19, the message box moved up 44 pixels, the prompts 40 and the greeting 34.';
const GAP = 'The gap under the greeting is now 10 pixels smaller.';
const CAVEAT = 'A single capture cannot show whether this is a lasting change or a test shown to some accounts.';
const oct12 = row('copilot', '2026-10-12', 440, 350);
const oct19 = row('copilot', '2026-10-19', 440, 350, { previousWeek: '2026-10-12' });
const oct26 = row('copilot', '2026-10-26', 400, 320, {
  previousWeek: '2026-10-19', changes: [L1_CHANGED],
  sentences: [{ text: 'A sidebar on the left takes up about a fifth of the screen width.', sources: ['L2'] },
    { text: MOVED, sources: ['L1'] }, { text: GAP, sources: ['L1'] }, { text: CAVEAT, sources: ['L1'] }],
});

describe('captureMetrics: positions and recorded layout changes', () => {
  it('passes the message box and greeting top edges, and only the sentences that state a clean layout change', () => {
    const m = captureMetrics(oct26)!;
    expect(m.inputTop).toBe(400);
    expect(m.greetingTop).toBe(320);
    // Not the opening, not the caveat, not a sentence about an unchanged metric.
    expect(m.layoutChanges).toEqual({ previousWeek: '2026-10-19', sentences: [MOVED, GAP], confounded: false });
    expect(JSON.stringify(m)).not.toContain('how can I help');
  });

  it('is null without a bounding box, off the 1280 x 800 screen, or without a greeting', () => {
    expect(captureMetrics(row('x', '2026-10-26', null, null))).toMatchObject({ inputTop: null, greetingTop: null });
    expect(captureMetrics(row('x', '2026-10-26', 400, 320, { viewport: '390x844' }))).toMatchObject({ inputTop: null, greetingTop: null });
    expect(captureMetrics(row('x', '2026-10-26', 790, null))).toMatchObject({ inputTop: null }); // 790 + 60 is below the screen
  });
});

describe('Copilot, Oct 26 vs Oct 19: the layout shift is a difference', () => {
  it('two weeks in a row: the analysis\'s own sentences, with its exact measurements, and no bounding-box line', () => {
    for (const [a, b] of [[card(oct26, 'Oct 26'), card(oct19, 'Oct 19')], [card(oct19, 'Oct 19'), card(oct26, 'Oct 26')]]) {
      const t = tableFindings(a, b)!;
      expect(t.differences).toEqual([MOVED, GAP]);
      expect(both(a, b)).not.toMatch(/sits about|cannot show/);
      expect(t.similarities).toContain('Both message boxes sit in the middle third of the screen.');
    }
  });

  it('weeks further apart: the bounding boxes, newest week first, in "about" px', () => {
    for (const [a, b] of [[card(oct26, 'Oct 26'), card(oct12, 'Oct 12')], [card(oct12, 'Oct 12'), card(oct26, 'Oct 26')]]) {
      expect(tableFindings(a, b)!.differences).toEqual([
        'On Oct 26 the message box sits about 40px higher than on Oct 12.',
        'On Oct 26 the greeting sits about 30px higher than on Oct 12.',
      ]);
    }
  });

  it('two weeks in a row without recorded sentences: the bounding boxes', () => {
    const plain = row('copilot', '2026-10-26', 400, 320, { previousWeek: '2026-10-19' });
    expect(tableFindings(card(plain, 'Oct 26'), card(oct19, 'Oct 19'))!.differences)
      .toContain('On Oct 26 the message box sits about 40px higher than on Oct 19.');
  });

  it('lower, too', () => {
    const later = row('copilot', '2026-11-02', 480, 350);
    expect(tableFindings(card(later, 'Nov 2'), card(oct12, 'Oct 12'))!.differences)
      .toEqual(['On Nov 2 the message box sits about 40px lower than on Oct 12.']);
  });
});

describe('Portals mode', () => {
  it('names each portal', () => {
    const copilot = card(row('copilot', '2026-10-26', 250, null), 'Copilot');
    const gemini = card(row('gemini', '2026-10-26', 370, null), 'Gemini');
    expect(findingLists(copilot, gemini).differences).toContain("Copilot's message box sits about 120px higher than Gemini's.");
    expect(tableFindings(gemini, copilot)!.differences).toContain("Gemini's message box sits about 120px lower than Copilot's.");
  });
});

describe('a shift under 16px', () => {
  it('is not a difference; the same screen third stays a similarity', () => {
    const a = card(row('kimi', '2026-10-26', 330, 250), 'Oct 26'), b = card(row('kimi', '2026-10-12', 320, 240), 'Oct 12');
    const t = tableFindings(a, b)!;
    expect(both(a, b)).not.toMatch(/sits about/);
    expect(t.similarities).toContain('Both message boxes sit in the middle third of the screen.');
    // 16px is enough.
    expect(tableFindings(card(row('kimi', '2026-10-26', 304, null), 'Oct 26'), b)!.differences)
      .toEqual(['On Oct 26 the message box sits about 16px higher than on Oct 12.']);
  });

  it('a missing bounding box is skipped silently', () => {
    const a = card(row('kimi', '2026-10-26', null, null), 'Oct 26'), b = card(row('kimi', '2026-10-12', 320, 240), 'Oct 12');
    const f = findingLists(a, b);
    expect(f.differences.join(' ')).not.toMatch(/sits about/);
    expect(f.missing.join(' ')).not.toMatch(/position|greeting/);
  });
});

describe('confounded changes never appear', () => {
  const moved = (status: string) => row('gemini', '2026-10-19', 370, 290, {
    previousWeek: '2026-10-12',
    changes: [{ id: 'L1', previous: 'heading region [380, 210, 580, 40]', current: 'heading region [470, 290, 380, 30]', status, note: '' }],
    sentences: [{ text: 'The heading now sits lower than in the week of 2026-10-12.', sources: ['L1'] }],
  });
  const before = card(row('gemini', '2026-10-12', 370, 210), 'Oct 12');

  it.each(['possibly_confounded', 'confounded'])('%s: no sentence, and no position line for the week it was compared with', (status) => {
    const m = captureMetrics(moved(status))!;
    expect(m.layoutChanges).toEqual({ previousWeek: '2026-10-12', sentences: [], confounded: true });
    const a = card(moved(status), 'Oct 19');
    expect(both(a, before)).not.toMatch(/heading|greeting|sits about/);
  });

  it('a sentence citing a confounded metric with a clean one is left out too', () => {
    const r = row('manus', '2026-09-28', 490, null, {
      previousWeek: '2026-09-21',
      changes: [{ id: 'L3', previous: {}, current: {}, status: 'changed', note: '' }, { id: 'L1', previous: 'a', current: 'b', status: 'possibly_confounded', note: '' }],
      sentences: [{ text: 'The message box now sits lower than in the week of 2026-09-21.', sources: ['L3'] },
        { text: 'A promo card now sits under the message box.', sources: ['L3', 'L1'] }],
    });
    expect(captureMetrics(r)!.layoutChanges!.sentences).toEqual(['The message box now sits lower than in the week of 2026-09-21.']);
  });

  it('a week captured on another account plan drops its recorded sentences', () => {
    const r = row('copilot', '2026-10-26', 400, 320, { previousWeek: '2026-10-19', changes: [L1_CHANGED], sentences: [{ text: MOVED, sources: ['L1'] }], plan: 'Pro', previousPlan: 'Free' });
    expect(captureMetrics(r)!.layoutChanges!.sentences).toEqual([]);
  });
});

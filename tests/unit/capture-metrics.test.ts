import { beforeEach, describe, expect, it, vi } from 'vitest';

// capture.ts imports Browser Rendering, which only exists inside the Workers runtime.
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { handleApi } from '../../src/api';
import { captureMetrics } from '../../src/capture-metrics';
import { SYSTEM_TEST_WEEKS } from '../../src/analysis';
import { makeEnv } from './fake-env';

const SLUG = 'claude';
const WEEK = '2026-09-21';
const ctx = {} as ExecutionContext;

// Private text and values a real analysis carries; none of it may reach /api/captures.
const GREETING = 'Good evening, Avery Quinn';
const PROMPT_TEXT = 'Plan a trip to Lisbon';
const PLACEHOLDER = 'How can I help you today?';
const NOTE_TEXT = 'Claude can make mistakes. Please double-check responses.';
const HEX = '#1A2B3C';

/** A v1.4-style analysis with the structured shapes. */
function analysis(metricOverrides: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    L1: [{ region: 'sidebar', location: [0, 0, 290, 800] }, { region: 'account-specific area (excluded)', location: [0, 700, 290, 100] }],
    L2: '23%',
    L3: { center: [780, 400], vertical_third: 'middle', horizontally_centered: true },
    L4: { sidebar: 10, main_content: 8 },
    H1: [{ rank: 1, element: 'message box', basis: '6.5% of the screen' }],
    H2: '6.5%',
    H3: 2,
    C1: { main_background: HEX, primary_text: '#FAFAFA' },
    C2: '15.3:1',
    D5: { placeholder: PLACEHOLDER, suggested_prompts: { count: 2, texts: [PROMPT_TEXT, 'Write a poem'] }, model_selector: 'Opus' },
    D6: { present: true, text: NOTE_TEXT, location: 'below input', type: 'mistakes' },
    D7: GREETING,
    ...metricOverrides,
  };
  return {
    guideline_version: '1.4',
    portal: SLUG,
    week: WEEK,
    variant: 'desktop',
    status: 'ok',
    context: { color_scheme: 'dark', modal_present: 'none', account_type: 'personal', privacy_flag: true, notes: `greeting includes ${GREETING}` },
    metrics: Object.entries(values).map(([id, value]) => ({
      id, value, evidence: 'E1', confidence: 'high', note: `${id} note`,
      ...(id === 'C2' ? { result: 'approx_pass', samples: { foreground: '#FAFAFA', background: HEX } } : {}),
    })),
    summary: 'This shows the desktop version of Claude for the week of 2026-09-21, before scrolling.',
    ...top,
  };
}

const row = (a: unknown, extra: Record<string, unknown> = {}) => ({
  week: WEEK, slug: SLUG, analysis_by: 'guideline-v1.4', analysis_json: JSON.stringify(a), ...extra,
});

const EXPECTED = {
  colorScheme: 'dark', sidebarPct: 23, inputAreaPct: 6.5, inputPosition: 'middle',
  clickableApprox: 18, textSizes: 2, suggestedPrompts: 2, aiNote: true,
  // The v1.4 fixture has no N1 and no changes_vs_previous.
  navItems: null, navSidebarVisible: null, navChanges: null, plan: null, planChange: null,
  // No viewport and no bounding boxes; no summary_sentences.
  inputTop: null, greetingTop: null, layoutChanges: null,
};

/** A v1.5 N1 value: labelled and icon-only items in three regions. */
const N1_ITEMS = [
  { label: null, region: 'sidebar', order: 1, icon: 'magnifier-shaped icon', badge: null },
  { label: 'New chat', region: 'sidebar', order: 2, icon: 'pencil-on-square icon', badge: null },
  { label: 'Tasks', region: 'sidebar', order: 3, icon: 'clock icon', badge: 'NEW' },
  { label: 'Upgrade', region: 'top bar', order: 1, icon: null, badge: null },
  { label: 'Think', region: 'input area', order: 1, icon: 'brain-shaped icon', badge: null },
];
const N1_RENAMED = { id: 'N1', change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar', status: 'changed', note: 'Same clock icon.' };

/** A v1.5 analysis: N1 with a sidebar field, a previous week and changes_vs_previous. */
function analysisV15(n1: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  const a = analysis();
  a.guideline_version = '1.5';
  a.metrics.push({ id: 'N1', value: N1_ITEMS, sidebar: 'visible', evidence: 'E2', confidence: 'high', note: 'N1 note', ...n1 } as never);
  return { ...a, previous_week: '2026-09-14', changes_vs_previous: [N1_RENAMED, { id: 'D7', previous: 'Hi', current: GREETING, status: 'possibly_confounded', note: '' }], ...top };
}

describe('captureMetrics', () => {
  it('returns only the whitelisted numbers, enums and booleans', () => {
    const m = captureMetrics(row(analysis()));
    expect(m).toEqual(EXPECTED);
    for (const v of Object.values(m!)) if (v !== null) expect(['number', 'string', 'boolean']).toContain(typeof v);
  });

  it('is null for system-test weeks', () => {
    for (const week of SYSTEM_TEST_WEEKS) {
      expect(captureMetrics(row(analysis({}, { week }), { week }))).toBeNull();
    }
    expect(SYSTEM_TEST_WEEKS).toEqual(['2026-07-20', '2026-08-03', '2026-08-10']);
  });

  it('is null unless the analysis is a published, ok, matching desktop analysis', () => {
    expect(captureMetrics(row(analysis({}, { status: 'not_analyzable' })))).toBeNull();
    expect(captureMetrics(row(analysis(), { analysis_by: 'not_analyzable' }))).toBeNull();
    expect(captureMetrics(row(analysis(), { analysis_by: 'system-test' }))).toBeNull();
    expect(captureMetrics(row(analysis(), { analysis_by: 'workers-ai' }))).toBeNull();
    expect(captureMetrics(row(analysis({}, { variant: 'mobile' })))).toBeNull();
    expect(captureMetrics(row(analysis({}, { week: '2026-09-14' })))).toBeNull();
    expect(captureMetrics(row(analysis({}, { portal: 'chatgpt' })))).toBeNull();
    expect(captureMetrics({ week: WEEK, slug: SLUG, analysis_by: 'guideline-v1.4', analysis_json: '{not json' })).toBeNull();
    expect(captureMetrics({ week: WEEK, slug: SLUG, analysis_by: 'guideline-v1.4', analysis_json: null })).toBeNull();
  });

  it('sets only the unparseable field to null and keeps the others', () => {
    expect(captureMetrics(row(analysis({ H2: 'not_measured' })))).toEqual({ ...EXPECTED, inputAreaPct: null });
    expect(captureMetrics(row(analysis({ L2: 'about a fifth' })))).toEqual({ ...EXPECTED, sidebarPct: null });
    expect(captureMetrics(row(analysis({}, { context: { color_scheme: 'unknown' } })))).toEqual({ ...EXPECTED, colorScheme: null });
    const a = analysis();
    a.metrics = a.metrics.filter((m) => m.id !== 'H3');
    expect(captureMetrics(row(a))).toEqual({ ...EXPECTED, textSizes: null });
  });

  it('treats a metric listed twice as unparseable', () => {
    const a = analysis();
    a.metrics.push({ id: 'H2', value: '9.9%', evidence: 'E1', confidence: 'high', note: '' });
    expect(captureMetrics(row(a))).toEqual({ ...EXPECTED, inputAreaPct: null });
  });

  it('returns all-null fields when a valid analysis has no context or metrics', () => {
    const m = captureMetrics(row(analysis({}, { context: undefined, metrics: undefined })));
    expect(m).not.toBeNull();
    expect(Object.values(m!).every((v) => v === null)).toBe(true);
  });

  describe('N1 navigation items and changes', () => {
    const m15 = (n1: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => captureMetrics(row(analysisV15(n1, top)))!;
    const label = (s: string) => ({ label: s, region: 'sidebar', order: 9, icon: null, badge: null });

    it('keeps only label and region of labelled items', () => {
      const m = m15();
      expect(m.navItems).toEqual([
        { label: 'New chat', region: 'sidebar' }, { label: 'Tasks', region: 'sidebar' },
        { label: 'Upgrade', region: 'top bar' }, { label: 'Think', region: 'input area' },
      ]);
      expect(m.navSidebarVisible).toBe(true);
      expect(m.navChanges).toEqual({ previousWeek: '2026-09-14', items: [{ change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar' }] });
      expect({ ...m, navItems: null, navSidebarVisible: null, navChanges: null }).toEqual(EXPECTED);
    });

    it('drops labels longer than 60 characters or not printable ASCII', () => {
      const long = 'x'.repeat(61);
      const items = [label('x'.repeat(60)), label(long), label('Tâches'), label('任務'), label('Tab\tbed'), label('   '), label('Library')];
      expect(m15({ value: items }).navItems).toEqual([{ label: 'x'.repeat(60), region: 'sidebar' }, { label: 'Library', region: 'sidebar' }]);
    });

    it('maps common punctuation to ASCII instead of dropping the item', () => {
      const items = [label('Free plan · Upgrade'), label('Help – feedback'), label('Kimi’s “Docs”'), label('More…'), label('New\u00a0chat')];
      expect(m15({ value: items }).navItems!.map((i) => i.label)).toEqual(['Free plan - Upgrade', 'Help - feedback', 'Kimi\'s "Docs"', 'More...', 'New chat']);
    });

    it('removes a legacy " (translated from ...)" suffix before checking the length', () => {
      const items = [label('Download desktop app (translated from Chinese)'), label('Library (Translated from Japanese)'), label('Notes (beta)')];
      expect(m15({ value: items }).navItems!.map((i) => i.label)).toEqual(['Download desktop app', 'Library', 'Notes (beta)']);
    });

    it('uses icon_label for items without text, up to 24 characters', () => {
      const items = [
        { label: null, icon_label: 'clock icon', region: 'sidebar', icon: 'clock-shaped icon with a dot', badge: null },
        { label: null, icon_label: 'x'.repeat(25), region: 'sidebar' },
        { label: null, icon_label: 'x'.repeat(24), region: 'top bar' },
        { label: null, region: 'sidebar', icon: 'magnifier-shaped icon' },
        { label: 'Tasks', icon_label: 'ignored icon', region: 'sidebar' },
        { label: 'Tâches', icon_label: 'clock icon', region: 'sidebar' },
      ];
      expect(m15({ value: items }).navItems).toEqual([
        { label: 'clock icon', region: 'sidebar', icon: true },
        { label: 'x'.repeat(24), region: 'top bar', icon: true },
        { label: 'Tasks', region: 'sidebar' },
      ]);
    });

    it('drops items in unknown regions or with non-string labels', () => {
      const items = [{ label: 'Home', region: 'main content' }, { label: 7, region: 'sidebar' }, 'Library', null, { label: 'Library', region: 'sidebar' }];
      expect(m15({ value: items }).navItems).toEqual([{ label: 'Library', region: 'sidebar' }]);
    });

    it('is null when N1 is not an array, listed twice, or has more than 30 items', () => {
      expect(m15({ value: 'not_measured' }).navItems).toBeNull();
      expect(m15({ value: Array.from({ length: 31 }, (_, i) => label(`Item ${i}`)) }).navItems).toBeNull();
      expect(m15({ value: Array.from({ length: 30 }, (_, i) => label(`Item ${i}`)) }).navItems).toHaveLength(30);
      const a = analysisV15();
      a.metrics.push({ id: 'N1', value: N1_ITEMS } as never);
      expect(captureMetrics(row(a))!.navItems).toBeNull();
    });

    it('marks a collapsed sidebar', () => {
      expect(m15({ sidebar: 'not_visible' }).navSidebarVisible).toBe(false);
      expect(m15({ sidebar: 'hidden' }).navSidebarVisible).toBeNull();
    });

    it('keeps only well-formed N1 changes with status "changed"', () => {
      const changes = [
        N1_RENAMED,
        { id: 'N1', change: 'added', previous: null, current: 'Codex', region: 'sidebar', status: 'changed' },
        { id: 'N1', change: 'removed', previous: 'Sora', current: null, region: 'top bar', status: 'changed' },
        { id: 'N1', change: 'renamed', previous: 'GPTs', current: 'Explore', region: 'sidebar', status: 'possibly_confounded' },
        { id: 'N1', change: 'badge_changed', previous: null, current: 'NEW', region: 'sidebar', status: 'changed' },
        { id: 'N1', change: 'renamed', previous: 'Scheduled', current: 'Tâches', region: 'sidebar', status: 'changed' },
        { id: 'N1', change: 'added', previous: 'x', current: 'Codex', region: 'sidebar', status: 'changed' },
        { id: 'N1', change: 'added', previous: null, current: 'Codex', region: 'footer', status: 'changed' },
        { id: 'D7', previous: 'Hi', current: GREETING, status: 'changed' },
      ];
      expect(m15({}, { changes_vs_previous: changes }).navChanges).toEqual({
        previousWeek: '2026-09-14',
        items: [
          { change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar' },
          { change: 'added', previous: null, current: 'Codex', region: 'sidebar' },
          { change: 'removed', previous: 'Sora', current: null, region: 'top bar' },
        ],
      });
    });

    it('normalizes change names and keeps icon_only changes as icon changes', () => {
      const changes = [
        { id: 'N1', change: 'added', previous: null, current: 'slider icon', icon_only: true, region: 'input area', status: 'changed' },
        { id: 'N1', change: 'removed', previous: 'x'.repeat(25), current: null, icon_only: true, region: 'sidebar', status: 'changed' },
        { id: 'N1', change: 'renamed', previous: 'clock icon', current: 'bell icon', icon_only: true, region: 'sidebar', status: 'changed' },
        { id: 'N1', change: 'renamed', previous: 'Agents (translated from Chinese)', current: 'Free plan · Upgrade', region: 'top bar', status: 'changed' },
        // Legacy v1.5 data: an icon description in current, without icon_only, is kept as a name (52 characters).
        { id: 'N1', change: 'added', previous: null, current: 'slider-shaped icon (three horizontal lines with dots)', region: 'input area', status: 'changed' },
      ];
      expect(m15({}, { changes_vs_previous: changes }).navChanges!.items).toEqual([
        { change: 'added', previous: null, current: 'slider icon', region: 'input area', icon: true },
        { change: 'renamed', previous: 'Agents', current: 'Free plan - Upgrade', region: 'top bar' },
        { change: 'added', previous: null, current: 'slider-shaped icon (three horizontal lines with dots)', region: 'input area' },
      ]);
    });

    it('keeps icon_changed only for icon_only items with two different icon labels', () => {
      const ic = (extra: Record<string, unknown>) => ({ id: 'N1', change: 'icon_changed', previous: 'bubble-clock icon', current: 'dashed bubble icon', icon_only: true, region: 'top bar', status: 'changed', ...extra });
      const changes = [
        ic({}),
        ic({ icon_only: undefined }),
        ic({ current: 'bubble-clock icon' }),
        ic({ current: 'x'.repeat(25) }),
        ic({ previous: null }),
        ic({ status: 'possibly_confounded' }),
      ];
      expect(m15({}, { changes_vs_previous: changes }).navChanges!.items).toEqual([
        { change: 'icon_changed', previous: 'bubble-clock icon', current: 'dashed bubble icon', region: 'top bar', icon: true },
      ]);
    });

    it('has an empty list when the previous week had no menu changes', () => {
      expect(m15({}, { changes_vs_previous: [] }).navChanges).toEqual({ previousWeek: '2026-09-14', items: [] });
    });

    it('is null without a valid previous_week or changes_vs_previous array', () => {
      expect(m15({}, { previous_week: undefined }).navChanges).toBeNull();
      expect(m15({}, { previous_week: null }).navChanges).toBeNull();
      expect(m15({}, { previous_week: '14 Sep 2026' }).navChanges).toBeNull();
      expect(m15({}, { previous_week: WEEK }).navChanges).toBeNull();
      expect(m15({}, { changes_vs_previous: null }).navChanges).toBeNull();
    });
  });

  describe('L4 clickable items', () => {
    const l4 = (value: unknown) => captureMetrics(row(analysis({ L4: value })))?.clickableApprox ?? null;
    it('sums per-region counts without a total', () => expect(l4({ sidebar: 10, main_content: 8 })).toBe(18));
    it('uses a total that matches the regions', () => expect(l4({ sidebar: 11, top_bar: 4, main_content: 8, total: 23 })).toBe(23));
    it('accepts any region names', () => expect(l4({ prompt_input: 3, chip_row: 7, top_left: 2, total: 12 })).toBe(12));
    it('rejects a total that does not match the regions', () => expect(l4({ sidebar: 10, main_content: 8, total: 30 })).toBeNull());
    it('rejects non-integer region values', () => expect(l4({ sidebar: '10', main_content: 8 })).toBeNull());
    it('reads "About N" text', () => expect(l4('About 24: sidebar 10, main top 2, prompt input area 7, suggestion chips 5.')).toBe(24));
    it('does not add up free-text region lists', () => expect(l4('Sidebar: 9 (logo, square icon, New Chat). Main content: 4.')).toBeNull());
  });

  describe('L3 message box position', () => {
    const l3 = (value: unknown) => captureMetrics(row(analysis({ L3: value })))?.inputPosition ?? null;
    it('reads the object form', () => expect(l3({ center: [674, 600], vertical_third: 'bottom', horizontally_centered: true })).toBe('bottom'));
    it('reads "middle third vertically"', () => expect(l3('Center (784, 404); middle third vertically; horizontally centered')).toBe('middle'));
    it('reads "middle vertical third"', () => expect(l3('Prompt input center at (770, 440); middle vertical third')).toBe('middle'));
    it('rejects text naming two thirds', () => expect(l3('between the middle third and the bottom third')).toBeNull());
    it('rejects an unknown enum', () => expect(l3({ vertical_third: 'center' })).toBeNull());
  });

  describe('H3 text sizes', () => {
    const h3 = (value: unknown) => captureMetrics(row(analysis({ H3: value })))?.textSizes ?? null;
    it('reads a number', () => expect(h3(4)).toBe(4));
    it('reads a digit string', () => expect(h3('1')).toBe(1));
    it('reads "2 levels"', () => expect(h3('2 levels')).toBe(2));
    it('reads "3 levels (estimated ...)"', () => expect(h3('3 levels (estimated about 27px, 16-17px, 14px)')).toBe(3));
    it('rejects other text', () => expect(h3('about three sizes')).toBeNull());
  });

  describe('D5 suggested prompts', () => {
    const d5 = (value: unknown) => captureMetrics(row(analysis({ D5: value })))?.suggestedPrompts ?? null;
    it('reads a bare count', () => expect(d5({ placeholder: PLACEHOLDER, suggested_prompts: 0 })).toBe(0));
    it('reads { count }', () => expect(d5({ suggested_prompts: { count: 3 } })).toBe(3));
    it('reads { count, texts } without the texts', () => expect(d5({ suggested_prompts: { count: 2, texts: [PROMPT_TEXT, 'x'] } })).toBe(2));
    it('does not treat other keys as suggested prompts', () => {
      expect(d5({ suggestion_chips: { count: 7, labels: ['Slides'] } })).toBeNull();
      expect(d5({ suggestions_count: 3 })).toBeNull();
      expect(d5({ suggestions: { count: 6 } })).toBeNull();
    });
    it('does not parse free text', () => expect(d5("Placeholder 'Ask'; 0 suggested prompts")).toBeNull());
  });

  describe('D6 note about AI limits', () => {
    const d6 = (value: unknown) => captureMetrics(row(analysis({ D6: value })))?.aiNote ?? null;
    it('"none" is false', () => expect(d6('none')).toBe(false));
    it('"none visible" is false', () => expect(d6('none visible')).toBe(false));
    it('{ present } is used as is', () => {
      expect(d6({ present: false, location: 'none' })).toBe(false);
      expect(d6({ present: true, text: NOTE_TEXT })).toBe(true);
    });
    it('the note text itself means present', () => expect(d6('Pi may make mistakes, so double-check important info.')).toBe(true));
    it('rejects negative or unmeasured text', () => {
      expect(d6('No disclaimer visible')).toBeNull();
      expect(d6('not_measured')).toBeNull();
      expect(d6({ present: 'yes' })).toBeNull();
    });
  });
});

describe('/api/captures metrics', () => {
  let t: ReturnType<typeof makeEnv>;

  const insert = (week: string, a: unknown, analysisBy = 'guideline-v1.4') => {
    t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
    t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, captured_at)
                  VALUES (?, ?, ?, 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757', ?, ?, ?, ?, ?)`)
      .run(`${SLUG}-${week}`, week, SLUG, `shots/${week}/${SLUG}.local.png`, 'A public summary.', analysisBy, JSON.stringify(a), `${week}T09:00:00Z`);
  };
  const captures = async (week: string) => {
    const res = await handleApi(new Request(`https://x/api/captures?week=${week}`), t.env, ctx);
    const text = await res.text();
    return { text, body: JSON.parse(text) as { captures: { metrics: unknown }[] } };
  };

  beforeEach(() => { t = makeEnv(); });

  it('exposes the whitelisted metrics and none of the private text, hex values, metric IDs or approx_* values', async () => {
    insert(WEEK, analysis());
    const { text, body } = await captures(WEEK);
    expect(body.captures[0].metrics).toEqual(EXPECTED);
    for (const secret of [GREETING, 'Avery', PROMPT_TEXT, 'Write a poem', PLACEHOLDER, NOTE_TEXT, 'mistakes', HEX, '#FAFAFA', 'Opus', 'L4 note']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/approx_/);
    expect(text).not.toMatch(/\b[LHCDN][1-7]\b/);
    expect(text).not.toMatch(/\bE[12]\b/);
    expect(text).not.toContain('analysis_json');
    expect(JSON.stringify(body.captures[0].metrics)).not.toContain('#');
  });

  it('exposes N1 labels but none of their icons, badges, notes or the other changes', async () => {
    insert(WEEK, analysisV15());
    const { text, body } = await captures(WEEK);
    expect((body.captures[0].metrics as { navItems: unknown[] }).navItems).toHaveLength(4);
    for (const secret of ['clock icon', 'pencil-on-square', 'NEW', 'N1 note', 'Same clock icon', GREETING, 'possibly_confounded']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/\b[LHCDN][1-7]\b/);
  });

  it('returns null metrics for a system-test week', async () => {
    insert('2026-08-03', analysis({}, { week: '2026-08-03' }));
    const { text, body } = await captures('2026-08-03');
    expect(body.captures[0].metrics).toBeNull();
    expect(text).not.toContain(GREETING);
  });

  it('returns null for one unparseable field and keeps the rest', async () => {
    insert(WEEK, analysis({ L4: 'Sidebar: 9 (logo, icons). Main: 4.' }));
    const { text, body } = await captures(WEEK);
    expect(body.captures[0].metrics).toEqual({ ...EXPECTED, clickableApprox: null });
    expect(text).not.toContain('logo, icons');
  });

  it('returns null metrics when the analysis is not published or not ok', async () => {
    insert(WEEK, analysis(), 'pending');
    expect((await captures(WEEK)).body.captures[0].metrics).toBeNull();

    t = makeEnv();
    insert(WEEK, analysis({}, { status: 'not_analyzable' }));
    expect((await captures(WEEK)).body.captures[0].metrics).toBeNull();
  });
});

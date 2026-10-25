import { beforeEach, describe, expect, it } from 'vitest';
import { handlePortalPage, keyFacts } from '../../src/portal-page';
import type { CaptureMetrics } from '../../src/capture-metrics';
import type { ChangeEntry } from '../../src/nav-changes';
import { makeEnv } from './fake-env';

// Key facts under a portal page's h1 (keyFacts() in src/portal-page.ts): built from captureMetrics() and the recorded menu changes.

const ORIGIN = 'https://ai-portal-library.dev';

const METRICS: CaptureMetrics = {
  colorScheme: 'dark', sidebarPct: 20, inputAreaPct: 4, inputPosition: 'middle', clickableApprox: 20, textSizes: 4,
  suggestedPrompts: 0, aiNote: true,
  navItems: [
    ...Array.from({ length: 9 }, (_, i) => ({ label: `Item ${i}`, region: 'sidebar' as const })),
    { label: 'Share', region: 'top bar' as const },
  ],
  navSidebarVisible: true, navChanges: null,
};
const NONE: CaptureMetrics = {
  colorScheme: null, sidebarPct: null, inputAreaPct: null, inputPosition: null, clickableApprox: null, textSizes: null,
  suggestedPrompts: null, aiNote: null, navItems: null, navSidebarVisible: null, navChanges: null,
};
const entry = (week: string, sentence: string): ChangeEntry => ({ slug: 'chatgpt', name: 'ChatGPT', week, previousWeek: '2026-10-05', sentence, phrase: sentence, weight: 3, publishedAt: null });
const RENAME = entry('2026-10-12', 'the sidebar item More is now labeled Explore.');

describe('keyFacts', () => {
  it('states the layout, the look and the most recent menu change', () => {
    expect(keyFacts('ChatGPT', '2026-10-19', METRICS, [RENAME])).toEqual([
      'As of Oct 19, 2026, ChatGPT shows a sidebar with 9 menu items, a centered message box and no suggested prompts.',
      "It uses a dark color scheme and shows a note about the AI's limits.",
      'Most recent menu change (week of Oct 12, 2026): the sidebar item More is now labeled Explore.',
    ]);
  });

  it('words each layout value', () => {
    const first = (m: Partial<CaptureMetrics>) => keyFacts('X', '2026-10-19', { ...NONE, ...m }, [])[0];
    expect(first({ sidebarPct: 0 })).toBe('As of Oct 19, 2026, X shows no sidebar.');
    expect(first({ navSidebarVisible: false, sidebarPct: 3 })).toBe('As of Oct 19, 2026, X shows a collapsed sidebar.');
    expect(first({ sidebarPct: 18 })).toBe('As of Oct 19, 2026, X shows a sidebar.'); // no menu item data
    expect(first({ sidebarPct: 18, navItems: [{ label: 'Chats', region: 'sidebar' }] })).toBe('As of Oct 19, 2026, X shows a sidebar with 1 menu item.');
    expect(first({ inputPosition: 'top', suggestedPrompts: 1 })).toBe('As of Oct 19, 2026, X shows a message box near the top and 1 suggested prompt.');
    expect(first({ inputPosition: 'bottom', suggestedPrompts: 4 })).toBe('As of Oct 19, 2026, X shows a message box at the bottom and 4 suggested prompts.');
  });

  it('words the look with one value missing', () => {
    expect(keyFacts('X', '2026-10-19', { ...NONE, colorScheme: 'light' }, [])).toEqual(['It uses a light color scheme.']);
    expect(keyFacts('X', '2026-10-19', { ...NONE, aiNote: false }, [])).toEqual(["It shows no note about the AI's limits."]);
  });

  it('skips sentences whose values are missing', () => {
    expect(keyFacts('ChatGPT', '2026-10-19', NONE, [])).toEqual([]);
    expect(keyFacts('ChatGPT', '2026-10-19', null, [])).toEqual([]);
    expect(keyFacts('ChatGPT', null, null, [])).toEqual([]);
    // Unpublished week: only the menu change recorded earlier.
    expect(keyFacts('ChatGPT', '2026-10-19', null, [RENAME])).toEqual(['Most recent menu change (week of Oct 12, 2026): the sidebar item More is now labeled Explore.']);
  });

  it('uses the newest change up to the shown week only', () => {
    const later = entry('2026-10-26', 'a new Tasks item appears in the sidebar.');
    expect(keyFacts('ChatGPT', '2026-10-19', null, [later, RENAME])).toEqual(['Most recent menu change (week of Oct 12, 2026): the sidebar item More is now labeled Explore.']);
    expect(keyFacts('ChatGPT', '2026-10-05', null, [later, RENAME])).toEqual([]);
  });

  it('lists up to 2 changes of that week and counts the rest', () => {
    const w = '2026-10-12';
    const many = [entry(w, 'one.'), entry(w, 'two.'), entry(w, 'three.'), entry(w, 'four.')];
    expect(keyFacts('ChatGPT', w, null, many)).toEqual(['Most recent menu changes (week of Oct 12, 2026): one; two, and 2 more changes.']);
    expect(keyFacts('ChatGPT', w, null, many.slice(0, 3))).toEqual(['Most recent menu changes (week of Oct 12, 2026): one; two, and 1 more change.']);
    expect(keyFacts('ChatGPT', w, null, many.slice(0, 2))).toEqual(['Most recent menu changes (week of Oct 12, 2026): one; two.']);
  });
});

describe('portal pages', () => {
  const OLD = '2026-10-05', NEW = '2026-10-12', PENDING = '2026-10-19';
  let t: ReturnType<typeof makeEnv>;

  function addCapture(week: string, a: unknown) {
    t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
    t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at)
                  VALUES (?, ?, 'chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#000000', ?, ?, ?, ?, ?, 'ok', ?)`)
      .run(`chatgpt-${week}`, week, `shots/${week}/chatgpt.local.png`, a ? 'This shows the desktop version of chatgpt. Fine.' : '', a ? 'guideline-v1.5.2' : 'pending',
        a ? JSON.stringify(a) : null, a ? `${week}T20:00:00Z` : null, `${week}T09:00:00Z`);
  }
  const analysis = (week: string, n1: unknown[], changes: unknown[] = []) => ({
    guideline_version: '1.5.2', portal: 'chatgpt', week, previous_week: OLD, variant: 'desktop', status: 'ok',
    context: { color_scheme: 'dark' },
    metrics: [
      { id: 'L2', value: '20%' }, { id: 'L3', value: { vertical_third: 'middle' } }, { id: 'D5', value: { suggested_prompts: 0 } },
      { id: 'N1', value: n1, sidebar: 'visible' },
    ],
    changes_vs_previous: changes,
  });
  const item = (label: string) => ({ label, region: 'sidebar' });

  beforeEach(() => {
    t = makeEnv();
    t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f')`);
    addCapture(OLD, analysis(OLD, [item('New chat'), item('More')]));
    addCapture(NEW, analysis(NEW, [item('New chat'), item('Explore')], [{ id: 'N1', status: 'changed', change: 'renamed', previous: 'More', current: 'Explore', region: 'sidebar' }]));
  });

  const get = (path: string) => handlePortalPage(new Request(`${ORIGIN}${path}`), t.env);
  const facts = (html: string) => html.match(/<section class="key-facts" aria-labelledby="key-facts"><h2 id="key-facts">Key facts<\/h2><p>([^<]*)<\/p><\/section>/)?.[1];
  const webPage = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])['@graph'].find((n: any) => n['@type'] === 'WebPage');
  const NEW_FACTS = 'As of Oct 12, 2026, ChatGPT shows a sidebar with 2 menu items, a centered message box and no suggested prompts. It uses a dark color scheme. '
    + 'Most recent menu change (week of Oct 12, 2026): the sidebar item More is now labeled Explore.';

  it('shows Key facts under the h1 on the hub and weekly pages', async () => {
    const hub = await (await get('/portals/chatgpt')).text();
    expect(facts(hub)).toBe(NEW_FACTS);
    expect(hub.indexOf('class="key-facts"')).toBeGreaterThan(hub.indexOf('<h1>ChatGPT</h1>'));
    expect(hub.indexOf('class="key-facts"')).toBeLessThan(hub.indexOf('class="shots"'));
    const old = await (await get(`/portals/chatgpt/${OLD}`)).text();
    expect(facts(old)).toBe('As of Oct 5, 2026, ChatGPT shows a sidebar with 2 menu items, a centered message box and no suggested prompts. It uses a dark color scheme.');
  });

  it('adds dateModified = the shown week to the JSON-LD', async () => {
    expect(webPage(await (await get('/portals/chatgpt')).text())).toEqual({
      '@type': 'WebPage', '@id': `${ORIGIN}/portals/chatgpt`, url: `${ORIGIN}/portals/chatgpt`,
      name: 'ChatGPT UI screenshots & interface changes, week by week', description: NEW_FACTS, dateModified: NEW,
    });
    expect(webPage(await (await get(`/portals/chatgpt/${OLD}`)).text()).dateModified).toBe(OLD);
  });

  it('includes the same summary in the Markdown version', async () => {
    const md = await (await get('/portals/chatgpt.md')).text();
    expect(md).toContain(`## Key facts\n\n${NEW_FACTS}\n\n## Design analysis`);
  });

  it('keeps only the facts the data has on a week without a published analysis', async () => {
    addCapture(PENDING, null);
    const hub = await (await get('/portals/chatgpt')).text();
    expect(facts(hub)).toBe('Most recent menu change (week of Oct 12, 2026): the sidebar item More is now labeled Explore.');
    expect(webPage(hub).dateModified).toBe(PENDING);
  });

  it('has no Key facts section when nothing is known', async () => {
    t.db.exec(`DELETE FROM captures`);
    addCapture(PENDING, null);
    const hub = await (await get('/portals/chatgpt')).text();
    expect(hub).not.toContain('class="key-facts"');
    expect(webPage(hub)).not.toHaveProperty('description');
    expect(await (await get('/portals/chatgpt.md')).text()).not.toContain('## Key facts');
  });
});

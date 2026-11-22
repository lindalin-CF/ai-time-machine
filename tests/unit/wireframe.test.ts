import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { wireframe, shapes, timelineHtml, TIMELINE_SLOT, type HeroTimeline } from '../../src/wireframe';
import { heroTimeline, renderHomepage } from '../../src/homepage';
import { invalidate } from '../../src/capture';
import { CACHE_VERSION } from '../../src/db';
import { makeEnv } from './fake-env';

// The hero timeline's wireframes (src/wireframe.ts) and the product the Worker picks for it (src/homepage.ts).

const base = (metrics: unknown[], extra: Record<string, unknown> = {}) =>
  ({ status: 'ok', variant: 'desktop', viewport: '1280x800', metrics, ...extra });
const L1 = (value: unknown) => ({ id: 'L1', value });

describe('wireframe()', () => {
  it('reads L1 as a list of regions, leaving out excluded areas, icons and rows that only mention the input', () => {
    const w = wireframe(base([L1([
      { region: 'sidebar (product navigation and section headings)', location: [0, 0, 340, 800] },
      { region: 'account-specific area (excluded)', location: [0, 340, 340, 30] },
      { region: 'top bar', location: [340, 0, 940, 50] },
      { region: 'main content', location: [340, 50, 940, 750] },
      { region: 'heading', bbox: [662, 308, 298, 33] },
      { region: 'prompt input', location: [430, 370, 770, 50] },
      { region: 'row of controls below the prompt input (Project, model picker)', location: [470, 470, 620, 10] },
      { region: 'suggested prompt list (three rows with icons)', location: [440, 460, 250, 140] },
      { region: 'ghost-shaped icon, top right', location: [1250, 20, 20, 20] },
    ])]));
    expect(w).toEqual({ sidebar: [0, 0, 340, 800], topbar: [340, 0, 940, 50], heading: [660, 310, 300, 30], input: [430, 370, 770, 50], cards: [[440, 460, 250, 140]] });
  });

  it('reads L1 as a sentence with inline boxes, one clause per label', () => {
    const w = wireframe(base([L1('Left sidebar with product navigation [0, 0, 250, 800]; account-specific area (excluded) [10, 300, 240, 430]; '
      + 'main content [250, 0, 1030, 800] containing heading [400, 210, 310, 30], prompt input [380, 270, 770, 130], topic chip row [390, 440, 450, 40]; '
      + 'main content with a heading and input; a single icon at top right [1230, 20, 20, 20]. No top bar.')]));
    expect(w).toEqual({ sidebar: [0, 0, 250, 800], topbar: null, heading: [400, 210, 310, 30], input: [380, 270, 770, 130], cards: [[390, 440, 450, 40]] });
  });

  it('prefers L3\'s measured message box, the greeting from D7 and the sidebar from L2 when L1 has no boxes', () => {
    const w = wireframe(base([
      L1('Top bar with a sidebar toggle icon; centered main content with wordmark and prompt input. No sidebar open.'),
      { id: 'L2', value: '20%' },
      { id: 'L3', value: { vertical_third: 'middle' }, location: [260, 320, 770, 110] },
      { id: 'D7', value: 'Hello', location: [560, 240, 150, 40] },
    ]));
    expect(w).toEqual({ sidebar: [0, 0, 260, 800], topbar: null, heading: [560, 240, 150, 40], input: [260, 320, 770, 110], cards: [] });
  });

  it('is null for analyses that are not ok, not desktop, another viewport, or without a message box', () => {
    const ok = [L1([{ region: 'prompt input', location: [0, 300, 600, 60] }])];
    expect(wireframe(base(ok))).not.toBeNull();
    expect(wireframe(base(ok, { status: 'not_analyzable' }))).toBeNull();
    expect(wireframe(base(ok, { variant: 'mobile' }))).toBeNull();
    expect(wireframe(base(ok, { viewport: '1440x900' }))).toBeNull();
    expect(wireframe(base([L1([{ region: 'sidebar', location: [0, 0, 260, 800] }])]))).toBeNull();
    expect(wireframe('nope')).toBeNull();
  });

  it('draws a heading as a bar at most 36 units tall and keeps a slot for every region', () => {
    const sh = shapes({ sidebar: null, topbar: null, heading: [400, 230, 600, 100], input: [400, 390, 740, 60], cards: [] });
    expect(sh).toHaveLength(8);
    expect(sh[2]).toEqual([400, 262, 600, 36, 1]);
    expect(sh[0][4]).toBe(0);
  });
});

const TL: HeroTimeline = {
  slug: 'chatgpt', name: 'Chat<GPT>',
  frames: [
    { week: '2026-11-09', n: 14, label: 'Week of Nov 9, 2026', boxes: { sidebar: [0, 0, 340, 800], topbar: null, heading: null, input: [430, 340, 770, 50], cards: [] } },
    { week: '2026-11-16', n: 15, label: 'Week of Nov 16, 2026', boxes: { sidebar: [0, 0, 340, 800], topbar: null, heading: null, input: [430, 370, 770, 50], cards: [] } },
  ],
};

describe('timelineHtml()', () => {
  it('renders one link per week to its digest, one label above each frame, and marks the latest', () => {
    const html = timelineHtml(TL);
    expect([...html.matchAll(/<a class="tl-frame[^"]*" href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/weeks/2026-11-09', '/weeks/2026-11-16']);
    expect([...html.matchAll(/<span class="tl-label" aria-hidden="true">([^<]+)</g)].map((m) => m[1])).toEqual(['W14 · Nov 9', 'W15 · Nov 16']);
    expect(html.match(/is-latest/g)).toHaveLength(1);
    expect(html).toContain('class="tl-frame is-latest" href="/weeks/2026-11-16" aria-label="Chat&lt;GPT&gt; · Week of Nov 16, 2026"');
    expect(html.match(/class="tl-lock"/g)).toHaveLength(1);
    expect(html).not.toContain('<GPT>');
  });
});

describe('the homepage strip (src/homepage.ts)', () => {
  let t: ReturnType<typeof makeEnv>;
  const WEEKS = ['2026-08-10', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
  const a = (slug: string, week: string, inputY: number, changes: unknown[] = [], prev: string | null = null) => ({
    guideline_version: '1.10.2', portal: slug, week, previous_week: prev, variant: 'desktop', viewport: '1280x800', status: 'ok',
    context: { color_scheme: 'dark' },
    metrics: [
      // The label carries screenshot text: it must never reach the page.
      L1([{ region: "serif heading 'Secret greeting text'", location: [500, inputY - 60, 300, 30] }, { region: 'sidebar', location: [0, 0, 260, 800] }]),
      { id: 'L3', value: { vertical_third: 'middle' }, location: [400, inputY, 640, 60] },
      { id: 'N1', value: [{ label: 'New chat', region: 'sidebar', badge: null }], sidebar: 'visible' },
    ],
    changes_vs_previous: changes,
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling.`,
  });
  const add = (slug: string, week: string, analysis: unknown, held = 0) => {
    t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${new Date(week + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}', '${week}T00:00:00Z')`);
    t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at, held)
                  VALUES (?, ?, ?, ?, 'Co', 'https://x/', '#000', ?, ?, 'guideline-v1.10.2', ?, ?, 'ok', ?, ?)`)
      .run(`${slug}-${week}`, week, slug, slug, `shots/${week}/${slug}.png`, (analysis as { summary: string }).summary, JSON.stringify(analysis), `${week}T20:00:00Z`, `${week}T09:00:00Z`, held);
  };
  const rename = [{ id: 'N1', status: 'changed', region: 'sidebar', change: 'renamed', previous: 'Chats', current: 'New chat' }];

  beforeEach(() => {
    t = makeEnv(); // has Claude
    t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0)`);
    t.db.exec(`UPDATE portals SET sort_order = 1 WHERE slug = 'claude'`);
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('2026-08-10', 'Week of Aug 10, 2026', '2026-08-10T00:00:00Z')`); // a system-test week
    for (const [i, w] of WEEKS.slice(1).entries()) {
      // Claude changes in the latest week; ChatGPT changed earlier (Nov 2).
      add('claude', w, a('claude', w, 340 - i * 10, w === '2026-11-16' ? rename : [], i ? WEEKS[i] : null));
      add('chatgpt', w, a('chatgpt', w, 340, w === '2026-11-02' ? rename : [], i ? WEEKS[i] : null));
    }
  });

  it('picks the product with the most recent recorded change and numbers its weeks among the archived ones', async () => {
    const tl = (await heroTimeline(t.env))!;
    expect(tl.slug).toBe('claude');
    expect(tl.frames.map((f) => [f.n, f.week])).toEqual([[2, '2026-10-26'], [3, '2026-11-02'], [4, '2026-11-09'], [5, '2026-11-16']]);
    expect(tl.frames.map((f) => f.boxes.input![1])).toEqual([340, 330, 320, 310]);
  });

  it('leaves out held captures (their week is not public yet)', async () => {
    add('claude', '2026-11-23', a('claude', '2026-11-23', 200, rename, '2026-11-16'), 1);
    const tl = (await heroTimeline(t.env))!;
    expect(tl.frames.at(-1)!.week).toBe('2026-11-16');
  });

  it('falls back to the next changed product when one has too few drawable weeks, and to none', async () => {
    t.db.exec(`UPDATE captures SET analysis_json = NULL, analysis_by = 'pending' WHERE slug = 'claude' AND week != '2026-11-16'`);
    expect((await heroTimeline(t.env))!.slug).toBe('chatgpt');
    t.kv.clear();
    t.db.exec(`UPDATE captures SET analysis_by = 'pending' WHERE slug = 'chatgpt'`);
    expect(await heroTimeline(t.env)).toBeNull();
  });

  it('is cached and cleared when a week changes', async () => {
    await heroTimeline(t.env);
    expect(t.kv.has(`${CACHE_VERSION}:cache:hero-timeline`)).toBe(true);
    await invalidate(t.env, '2026-11-16');
    expect(t.kv.has(`${CACHE_VERSION}:cache:hero-timeline`)).toBe(false);
  });

  it('renders into the static page\'s slot with no text from the screenshots', async () => {
    const index = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    expect(index).toContain(TIMELINE_SLOT);
    const stats = { screenshots: 1, portals: 2, weeks: 5 };
    const out = renderHomepage(index, stats, null, null, await heroTimeline(t.env));
    expect(out).not.toContain(TIMELINE_SLOT);
    expect(out).toContain('aria-label="Claude, week by week"');
    expect(out).toContain('W5 · Nov 16');
    expect(out).not.toMatch(/Secret greeting|serif heading|New chat|Chats/);
    // Without a timeline the empty, hidden slot stays.
    expect(renderHomepage(index, stats, null)).toContain(TIMELINE_SLOT);
  });
});

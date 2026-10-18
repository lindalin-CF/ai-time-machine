import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';

// Compare's Table view: the Differences and Similarities rows under Snapshot (public/app.js, anFindingRows), with real
// metrics from /api/captures (tests/fixtures/compare-findings-before.json).

const SNAP = JSON.parse(readFileSync(new URL('../fixtures/compare-findings-before.json', import.meta.url), 'utf8')) as {
  cards: Record<string, { metrics: unknown }>;
};
const METRICS = Object.fromEntries(Object.entries(SNAP.cards).map(([id, c]) => [id, c.metrics]));
const WEEKS = ['2026-10-12', '2026-10-05', '2026-09-28'];
const PORTALS = [
  { slug: 'chatgpt', name: 'ChatGPT', brand: '#111111' },
  { slug: 'claude', name: 'Claude', brand: '#d97757' },
  { slug: 'gemini', name: 'Gemini', brand: '#4285f4' },
  { slug: 'meta-ai', name: 'Meta <b>AI</b>', brand: '#0866ff' }, // no metrics on 2026-10-12; markup in the name
];

/** Each body row's label, and per cell: colspan, "vs …" heading, muted lines and list items. */
const table = (page: Page) => page.locator('#anTableWrap .an-table').evaluate((t) =>
  [...t.querySelectorAll('tbody tr')].map((tr) => ({
    label: tr.querySelector('.an-rowhead')!.textContent,
    cells: [...tr.querySelectorAll('td')].map((td) => ({
      span: td.colSpan,
      head: td.querySelector('.an-cmp-head')?.textContent ?? null,
      note: td.querySelector('.an-cmp-note')?.textContent ?? null,
      empty: td.querySelector('.an-cmp-empty')?.textContent ?? null,
      items: [...td.querySelectorAll('.an-cmp-list li')].map((li) => li.textContent),
    })),
  })));

describe('Compare Table: Differences and Similarities (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const open = async (setup: string, width = 1280) => {
    const page = await openSite(browser, `#compare?view=table&${setup}`, { weeks: WEEKS, portals: PORTALS, metrics: METRICS, width });
    await page.locator('#anTableWrap .an-cmp-row').first().waitFor();
    return page;
  };

  it('two columns: one cell spanning both, directly under Snapshot, with the menu changes first', async () => {
    const page = await open(`mode=time&portal=chatgpt&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
    const rows = await table(page);
    expect(rows.map((r) => r.label).slice(0, 4)).toEqual(['Snapshot', 'Differences', 'Similarities', 'Brand colour']);
    expect(rows.at(-1)!.label).toBe('Design notes');
    const [diff, same] = [rows[1], rows[2]];
    for (const r of [diff, same]) {
      expect(r.cells).toHaveLength(1);
      expect(r.cells[0].span).toBe(2);
      expect(r.cells[0].head).toBe('Oct 12, 2026 vs Oct 5, 2026');
    }
    expect(diff.cells[0].items.slice(0, 2)).toEqual(['The sidebar item More is now labeled Explore.', 'The Upgrade item no longer appears in the top bar.']);
    expect(same.cells[0].items).toContain('Oct 12, 2026 and Oct 5, 2026 were both captured in dark mode.');
    expect(same.cells[0].items.length).toBeLessThanOrEqual(5);
    await page.context().close();
  });

  it('three weeks: each week against the next older one; the last says Oldest week shown', async () => {
    const page = await open(`mode=time&portal=chatgpt&weeks=${WEEKS.join(',')}&device=desktop`);
    const rows = await table(page);
    for (const r of [rows[1], rows[2]]) {
      expect(r.cells.map((c) => c.span)).toEqual([1, 1, 1]);
      expect(r.cells.map((c) => c.head)).toEqual(['vs Oct 5, 2026', 'vs Sep 28, 2026', null]);
      expect(r.cells[2].empty).toBe('Oldest week shown');
      expect(r.cells[0].items.length + r.cells[1].items.length).toBeGreaterThan(0);
    }
    await page.context().close();
  });

  it('three products: each against the first; the first says Compared against this', async () => {
    const page = await open(`mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude,gemini&device=desktop`);
    const rows = await table(page);
    for (const r of [rows[1], rows[2]]) {
      expect(r.cells.map((c) => c.head)).toEqual([null, 'vs ChatGPT', 'vs ChatGPT']);
      expect(r.cells[0].empty).toBe('Compared against this');
    }
    expect(rows[1].cells[1].items).toContain('Claude shows 14 menu items, ChatGPT shows 13.');
    await page.context().close();
  });

  it('a product without metrics: Not enough data to compare, and its name is escaped', async () => {
    const page = await open(`mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude,meta-ai&device=desktop`);
    const rows = await table(page);
    for (const r of [rows[1], rows[2]]) expect(r.cells[2]).toMatchObject({ head: 'vs ChatGPT', empty: 'Not enough data to compare', items: [] });
    expect(await page.locator('#anTableWrap td b').count()).toBe(0);
    await page.context().close();
  });

  it('with Mobile selected, shows the same findings and says they come from the desktop analysis', async () => {
    const setup = `mode=time&portal=chatgpt&weeks=${WEEKS[0]},${WEEKS[1]}`;
    const desktop = await open(`${setup}&device=desktop`);
    const mobile = await open(`${setup}&device=mobile`);
    const [d, m] = [await table(desktop), await table(mobile)];
    expect(m[1].cells[0].items).toEqual(d[1].cells[0].items);
    expect(m[2].cells[0].items).toEqual(d[2].cells[0].items);
    expect(d[1].cells[0].note).toBeNull();
    expect(m[1].cells[0].note).toBe('From the desktop analysis');
    await desktop.context().close();
    await mobile.context().close();
  });

  it('at 390px the spanning cell\'s text stays within the visible table, and the page does not scroll sideways', async () => {
    const page = await open(`mode=time&portal=chatgpt&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`, 390);
    const r = await page.evaluate(() => {
      const scroller = document.querySelector('#anTableWrap')!.getBoundingClientRect();
      const label = document.querySelector('.an-cmp-row .an-rowhead')!.getBoundingClientRect();
      return [...document.querySelectorAll('.an-cmp--span .an-cmp-inner')].map((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left >= label.right, right: b.right <= scroller.right, overflow: document.documentElement.scrollWidth > innerWidth };
      });
    });
    expect(r).toEqual([{ left: true, right: true, overflow: false }, { left: true, right: true, overflow: false }]);
    await page.context().close();
  });

  it('at 1280px nothing overflows with four columns', async () => {
    const page = await open(`mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude,gemini,meta-ai&device=desktop`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect((await table(page))[1].cells.map((c) => c.head)).toEqual([null, 'vs ChatGPT', 'vs ChatGPT', 'vs ChatGPT']);
    await page.context().close();
  });
});

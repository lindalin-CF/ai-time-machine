import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';

// Compare's Table view: the PAGE row links each column to its portal page (public/app.js, anPageLink). The latest
// captured week links to /portals/<slug>, older weeks to /portals/<slug>/<week>, decided when the table renders.

const WEEKS = ['2026-10-12', '2026-10-05', '2026-09-28'];
const PORTALS = [
  { slug: 'chatgpt', name: 'ChatGPT', brand: '#111111' },
  { slug: 'claude', name: 'Claude', brand: '#d97757' },
  { slug: 'gemini', name: 'Gemini', brand: '#4285f4' },
];

/** The PAGE row: each cell's link (href, text, aria-label) or its text when there is no link. */
const pageRow = (page: Page) => page.locator('#anTableWrap .an-table').evaluate((t) => {
  const rows = [...t.querySelectorAll('tbody tr')];
  return {
    labels: rows.map((r) => r.querySelector('.an-rowhead')!.textContent),
    cells: [...rows.find((r) => r.querySelector('.an-rowhead')!.textContent === 'Page')!.querySelectorAll('td')].map((td) => {
      const a = td.querySelector('a');
      return a ? { href: a.getAttribute('href'), text: a.textContent, aria: a.getAttribute('aria-label') } : td.textContent;
    }),
  };
});

describe('Compare Table: PAGE row (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const open = async (setup: string, opts: { weeks?: string[]; statuses?: Record<string, string>; width?: number } = {}) => {
    const page = await openSite(browser, `#compare?view=table&${setup}`, { weeks: opts.weeks ?? WEEKS, portals: PORTALS, statuses: opts.statuses, width: opts.width });
    await page.locator('#anTableWrap .an-table').waitFor();
    return page;
  };

  it('Week by week, Gemini Oct 12 vs Oct 5: the latest week links to the portal page, the older to its weekly page', async () => {
    const page = await open(`mode=time&portal=gemini&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
    const { labels, cells } = await pageRow(page);
    expect(labels.slice(labels.indexOf('Captured'))).toEqual(['Captured', 'Page', 'Design notes']);
    expect(cells).toEqual([
      { href: '/portals/gemini', text: 'Gemini · Oct 12, 2026 →', aria: 'Open the Gemini page for the week of Oct 12, 2026' },
      { href: '/portals/gemini/2026-10-05', text: 'Gemini · Oct 5, 2026 →', aria: 'Open the Gemini page for the week of Oct 5, 2026' },
    ]);
    await page.context().close();
  });

  it('Across products for an older week: every column links to its weekly page', async () => {
    const page = await open(`mode=portals&week=${WEEKS[1]}&portals=chatgpt,claude,gemini&device=desktop`);
    expect((await pageRow(page)).cells.map((c) => (typeof c === 'string' ? c : c.href)))
      .toEqual(['/portals/chatgpt/2026-10-05', '/portals/claude/2026-10-05', '/portals/gemini/2026-10-05']);
    await page.context().close();
  });

  it('Across products for the latest week: every column links to its portal page', async () => {
    const page = await open(`mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude,gemini&device=desktop`);
    expect((await pageRow(page)).cells.map((c) => (typeof c === 'string' ? c : c.href))).toEqual(['/portals/chatgpt', '/portals/claude', '/portals/gemini']);
    await page.context().close();
  });

  it('when a newer week is added, the old latest column links to its weekly URL', async () => {
    const page = await open(`mode=time&portal=gemini&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`, { weeks: ['2026-10-19', ...WEEKS] });
    expect((await pageRow(page)).cells.map((c) => (typeof c === 'string' ? c : c.href))).toEqual(['/portals/gemini/2026-10-12', '/portals/gemini/2026-10-05']);
    await page.context().close();
  });

  it('each portal uses its own latest captured week; a failed capture has no page link', async () => {
    // Claude's newest week failed, so its latest page is Oct 5; ChatGPT has Oct 12.
    const page = await open(`mode=portals&week=${WEEKS[1]}&portals=chatgpt,claude&device=desktop`, { statuses: { 'claude@2026-10-12': 'error' } });
    expect((await pageRow(page)).cells.map((c) => (typeof c === 'string' ? c : c.href))).toEqual(['/portals/chatgpt/2026-10-05', '/portals/claude']);
    await page.context().close();
    const failed = await open(`mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude&device=desktop`, { statuses: { 'claude@2026-10-12': 'error' } });
    expect((await pageRow(failed)).cells.map((c) => (typeof c === 'string' ? c : c.href))).toEqual(['/portals/chatgpt', '—']);
    await failed.context().close();
  });

  it('escapes portal names in the label and aria-label', async () => {
    const page = await openSite(browser, `#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude&device=desktop`,
      { weeks: WEEKS, portals: [PORTALS[0], { slug: 'claude', name: 'Claude <b>"x"</b>', brand: '#d97757' }] });
    await page.locator('#anTableWrap .an-table').waitFor();
    const c = (await pageRow(page)).cells[1] as { text: string; aria: string };
    expect(c.text).toBe('Claude <b>"x"</b> · Oct 12, 2026 →');
    expect(c.aria).toBe('Open the Claude <b>"x"</b> page for the week of Oct 12, 2026');
    expect(await page.locator('#anTableWrap .an-page-link b').count()).toBe(0);
    await page.context().close();
  });

  it('looks like the portal pages\' Compare button, with hover and keyboard focus states', async () => {
    const page = await open(`mode=time&portal=gemini&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
    const link = page.locator('.an-page-link').first();
    const look = () => link.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        radius: cs.borderTopLeftRadius, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, bg: cs.backgroundColor, color: cs.color,
        font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0]}`, padding: cs.padding, underline: cs.textDecorationLine,
        outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor} ${cs.outlineOffset}`,
      };
    });
    const base = { radius: '8px', border: '1px solid rgb(217, 206, 189)', bg: 'rgb(245, 241, 233)', color: 'rgb(204, 80, 30)',
      font: '600 12.5px "Space Grotesk"', padding: '6px 11px', underline: 'none', outline: 'none' };
    expect(await look()).toEqual(base);
    await link.hover();
    expect(await look()).toEqual({ ...base, bg: 'rgb(222, 212, 198)' });
    await page.mouse.move(0, 0);
    await link.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
    expect(await look()).toEqual({ ...base, outline: '2px solid rgb(235, 98, 44) 2px' });
    await page.context().close();
  });

  it.each([1280, 390])('at %ipx every button can be seen in full (scrolling the table sideways at narrow widths)', async (width) => {
    const page = await open(`mode=time&portal=gemini&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`, { width });
    for (const link of await page.locator('.an-page-link').all()) {
      await link.scrollIntoViewIfNeeded();
      const r = await link.evaluate((el) => {
        const b = el.getBoundingClientRect(), s = document.querySelector('#anTableWrap')!.getBoundingClientRect();
        const label = document.querySelector('.an-table tbody .an-rowhead')!.getBoundingClientRect();
        return { inScroller: b.left >= label.right - 1 && b.right <= s.right + 1, inViewport: b.left >= 0 && b.right <= innerWidth, height: b.height };
      });
      expect(r).toMatchObject({ inScroller: true, inViewport: true });
      expect(r.height).toBeGreaterThan(20);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.context().close();
  });
});

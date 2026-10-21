import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, openSite, WEEKS } from './analytics-page';

// Compare's portals: every portal in one row that scrolls sideways (no "+N more"), snapping to chips, with 24px fades
// on the edges that have more to scroll. Opening the page brings the first selected chip into view; a focused chip
// scrolls into view; a vertical mouse wheel over the row scrolls it sideways.

const PORTALS = [
  { slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' },
  { slug: 'gemini', name: 'Gemini', brand: '#4285f4' }, { slug: 'perplexity', name: 'Perplexity', brand: '#20808d' },
  { slug: 'copilot', name: 'Microsoft Copilot', brand: '#0078d4' }, { slug: 'grok', name: 'Grok', brand: '#111111' },
  { slug: 'deepseek', name: 'DeepSeek', brand: '#4d6bfe' }, { slug: 'lechat', name: 'Le Chat', brand: '#fa520f' },
  { slug: 'meta', name: 'Meta AI', brand: '#0866ff' }, { slug: 'manus', name: 'Manus', brand: '#5b4a3a' },
  { slug: 'poe', name: 'Poe', brand: '#5d5cde' }, { slug: 'kimi', name: 'Kimi', brand: '#222222' },
];
const NAMES = PORTALS.map((p) => p.name);

describe('Compare portal row (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const open = (width = 1280) => openAnalytics(browser, { portals: PORTALS, width });
  const picked = (page: Page) => page.locator('#anPortals .chip[aria-selected="true"]').allTextContents();
  const row = (page: Page) => page.locator('#anPortals').evaluate((el) => {
    const cs = getComputedStyle(el);
    const tops = new Set([...el.querySelectorAll('.chip')].map((c) => Math.round(c.getBoundingClientRect().top)));
    return {
      rows: tops.size, wrap: cs.flexWrap, overflowX: cs.overflowX, snap: cs.scrollSnapType, chipSnap: getComputedStyle(el.querySelector('.chip')!).scrollSnapAlign,
      scrollbar: el.offsetHeight - el.clientHeight, overflows: el.scrollWidth > el.clientWidth,
      noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  const fades = (page: Page) => page.locator('#anPortals').evaluate((el) => ({
    start: el.classList.contains('fade-start'), end: el.classList.contains('fade-end'), mask: getComputedStyle(el).maskImage,
  }));
  /** Whether a chip is fully visible inside the row: clear of the 24px fade on each edge that has one (a pixel to spare). */
  const inView = (page: Page, slug: string) => page.evaluate((slug) => {
    const row = document.querySelector('#anPortals')!, r = row.getBoundingClientRect();
    const c = row.querySelector(`.chip[data-v="${slug}"]`)!.getBoundingClientRect();
    const start = row.classList.contains('fade-start') ? 23 : 0, end = row.classList.contains('fade-end') ? 23 : 0;
    return c.left >= r.left + start && c.right <= r.right - end;
  }, slug);

  it.each([1280, 390])('at %ipx: every portal in one row that scrolls sideways, without "+N more"', async (width) => {
    const page = await open(width);
    expect(await page.locator('#anPortals .chip').allTextContents()).toEqual(NAMES);
    expect(await page.locator('#analyticsView .chip-more, #anMoreMenu').count()).toBe(0);
    expect(await row(page)).toEqual({ rows: 1, wrap: 'nowrap', overflowX: 'auto', snap: 'x', chipSnap: 'start', scrollbar: 0, overflows: true, noSideScroll: true });
    expect(await page.locator('#anPortals .chip').evaluateAll((els) => els.every((e) => e.tagName === 'BUTTON' && e.getAttribute('type') === 'button'))).toBe(true);
    await page.context().close();
  });

  it('fades only the edges that have more to scroll, over 24px', async () => {
    const page = await open(900);
    const f = await fades(page);
    expect(f).toMatchObject({ start: false, end: true });
    expect(f.mask).toContain('calc(100% - 24px)');
    await page.locator('#anPortals').evaluate((el) => { el.scrollLeft = 120; });
    await expect.poll(() => fades(page)).toMatchObject({ start: true, end: true });
    await page.locator('#anPortals').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect.poll(() => fades(page)).toMatchObject({ start: true, end: false });
    await page.context().close();
  });

  it('keeps the multi-select rules: up to four, with the count and Clear', async () => {
    const page = await open();
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude']);
    for (const slug of ['grok', 'poe', 'kimi']) await page.locator(`#anPortals .chip[data-v="${slug}"]`).click();
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'Grok', 'Poe']); // the fifth is ignored
    expect(await page.locator('#anCount').textContent()).toBe('4 of 4 selected');
    await page.locator('#anPortals .chip[data-v="grok"]').click();
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'Poe']);
    await page.locator('#anClear').click();
    expect(await picked(page)).toEqual([]);
    expect(await page.locator('#anCount').textContent()).toBe('0 of 4 selected');
    await page.locator('#anPortals .chip[data-v="chatgpt"]').click();
    await page.waitForTimeout(250);
    const look = await page.locator('#anPortals .chip[data-v="chatgpt"]').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
    expect(look).toEqual(['rgb(66, 50, 23)', 'rgb(245, 241, 233)']); // --selected-bg / --selected-fg
    await page.context().close();
  });

  it('clicking a chip far along the row keeps the row where it was scrolled', async () => {
    const page = await open();
    await page.locator('#anPortals').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const before = await page.locator('#anPortals').evaluate((el) => el.scrollLeft);
    await page.locator('#anPortals .chip[data-v="kimi"]').click();
    expect(await picked(page)).toContain('Kimi');
    expect(Math.abs(await page.locator('#anPortals').evaluate((el) => el.scrollLeft) - before)).toBeLessThanOrEqual(1);
    await page.context().close();
  });

  it.each([1280, 390])('at %ipx: a shared link opens with the first selected chip scrolled into view', async (width) => {
    const page = await openSite(browser, `#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=manus,kimi&device=desktop`, { portals: PORTALS, width });
    await page.locator('#anTableWrap').locator('.an-table, .an-mstack').first().waitFor();
    expect(await picked(page)).toEqual(['Manus', 'Kimi']);
    expect(await inView(page, 'manus')).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // only the row scrolled, not the page
    await page.context().close();
  });

  it('Single portal from a link: its chip is scrolled into view', async () => {
    const page = await openSite(browser, `#compare?view=table&mode=time&portal=poe&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`, { portals: PORTALS, width: 390 });
    await page.locator('#anTableWrap').locator('.an-table, .an-mstack').first().waitFor();
    expect(await picked(page)).toEqual(['Poe']);
    expect(await inView(page, 'poe')).toBe(true);
    await page.context().close();
  });

  it('Tab reaches every chip, and each focused chip scrolls into view', async () => {
    const page = await open(390);
    await page.locator('#anPortals .chip').first().focus();
    const seen: string[] = [];
    for (let i = 0; i < PORTALS.length; i++) {
      const slug = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.v!);
      seen.push(slug);
      expect(await inView(page, slug)).toBe(true);
      await page.keyboard.press('Tab');
    }
    expect(seen).toEqual(PORTALS.map((p) => p.slug));
    await page.context().close();
  });

  it('a vertical mouse wheel over the row scrolls it sideways, then lets the page scroll at the end', async () => {
    const page = await open();
    const box = (await page.locator('#anPortals').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const y0 = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => page.locator('#anPortals').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(y0);
    await page.locator('#anPortals').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.mouse.wheel(0, 200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0);
    await page.context().close();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics } from './analytics-page';

// Compare's portals use the Library filter bar's look: one row of chips that scrolls sideways (the first four, then
// any picked portal from the menu) and a "+N more" menu with the rest.

const PORTALS = [
  { slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' },
  { slug: 'gemini', name: 'Gemini', brand: '#4285f4' }, { slug: 'perplexity', name: 'Perplexity', brand: '#20808d' },
  { slug: 'copilot', name: 'Copilot', brand: '#0078d4' }, { slug: 'grok', name: 'Grok', brand: '#111111' },
  { slug: 'deepseek', name: 'DeepSeek', brand: '#4d6bfe' },
];

describe('Compare portal row (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const open = (width = 1280) => openAnalytics(browser, { portals: PORTALS, width });
  const chips = (page: Page) => page.locator('#anPortals .chip').allTextContents();
  const picked = (page: Page) => page.locator('#anPortals .chip[aria-selected="true"]').allTextContents();
  const more = (page: Page) => page.locator('#anMoreMenu .chip-more');
  const option = (page: Page, slug: string) => page.locator(`#anMoreMenuList [data-portal="${slug}"]`);
  const isOpen = (page: Page) => page.locator('#anMoreMenu').evaluate((m) => m.classList.contains('open'));
  const row = (page: Page) => page.locator('#anPortals').evaluate((el) => {
    const cs = getComputedStyle(el);
    const tops = new Set([...el.querySelectorAll('.chip')].map((c) => Math.round(c.getBoundingClientRect().top)));
    const m = document.querySelector('#anMoreMenu')!.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { rows: tops.size, wrap: cs.flexWrap, overflowX: cs.overflowX, scrollbar: el.offsetHeight - el.clientHeight,
      moreOnRow: Math.abs((m.top + m.height / 2) - (r.top + r.height / 2)) < 2,
      noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
  });

  it.each([1280, 390])('at %ipx: one scrolling row of the first four portals, with "+3 more" on the same line', async (width) => {
    const page = await open(width);
    expect(await chips(page)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
    expect((await more(page).textContent())!.trim()).toBe('+3 more');
    expect(await row(page)).toEqual({ rows: 1, wrap: 'nowrap', overflowX: 'auto', scrollbar: 0, moreOnRow: true, noSideScroll: true });
    await more(page).click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.context().close();
  });

  it('Across portals: menu picks add to the comparison and join the row; at four, the rest are unavailable', async () => {
    const page = await open();
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude']);
    await more(page).click();
    expect(await page.locator('#anMoreMenuList').getAttribute('aria-multiselectable')).toBe('true');
    await option(page, 'grok').click();
    expect(await isOpen(page)).toBe(false);
    expect(await chips(page)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok']);
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'Grok']);
    expect(await page.locator('#anCount').textContent()).toBe('3 of 4 selected');
    await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toContain('portals=chatgpt,claude,grok');

    await more(page).click();
    await option(page, 'copilot').click();
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'Copilot', 'Grok']);
    await more(page).click();
    expect(await option(page, 'deepseek').getAttribute('aria-disabled')).toBe('true');
    await option(page, 'deepseek').click({ force: true }); // does nothing, and the menu stays open
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'Copilot', 'Grok']);

    // Unpicking from the menu takes it out of the comparison and the row.
    await option(page, 'grok').click();
    expect(await chips(page)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot']);
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'Copilot']);
    await page.context().close();
  });

  it('Single portal: a menu pick becomes the one portal, shown in the row', async () => {
    const page = await open();
    await page.locator('[data-mode="weeks"]').click();
    expect(await picked(page)).toEqual(['ChatGPT']);
    await more(page).click();
    expect(await page.locator('#anMoreMenuList').getAttribute('aria-multiselectable')).toBeNull();
    await option(page, 'deepseek').click();
    expect(await picked(page)).toEqual(['DeepSeek']);
    expect(await chips(page)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'DeepSeek']);
    await page.locator('#anPortals .chip[data-v="claude"]').click();
    expect(await picked(page)).toEqual(['Claude']);
    expect(await chips(page)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
    await page.context().close();
  });

  it('works from the keyboard: Enter opens, arrows move, Enter picks and focus lands on the new chip, Esc closes', async () => {
    const page = await open();
    const active = () => page.evaluate(() => document.activeElement!.textContent!.trim());
    await more(page).focus();
    await page.keyboard.press('Enter');
    expect(await active()).toBe('Copilot');
    await page.keyboard.press('ArrowDown');
    expect(await active()).toBe('Grok');
    await page.keyboard.press('Escape');
    expect(await isOpen(page)).toBe(false);
    expect(await active()).toBe('+3 more');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    expect(await picked(page)).toEqual(['ChatGPT', 'Claude', 'DeepSeek']);
    expect(await active()).toBe('DeepSeek');
    await page.context().close();
  });

  it('a click outside closes it', async () => {
    const page = await open();
    await more(page).click();
    await page.locator('.analytics-title').click();
    expect(await isOpen(page)).toBe(false);
    await page.context().close();
  });
});

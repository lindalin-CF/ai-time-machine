import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { handleChangelog } from '../../src/portal-page';
import { openSite } from './analytics-page';

// The top bar on phones (≤ 640px): the three links sit behind a menu button (public/site-menu.js) on the homepage and
// on the server-rendered pages. Above 640px, and without JS, the links show as before.

const ORANGES = ['rgb(235, 98, 44)', 'rgb(204, 80, 30)'];
const PHONE = 390;

const toggle = (page: Page) => page.locator('.topnav-toggle');
const links = (page: Page) => page.locator('.topnav-link');
const visibleLinks = (page: Page) => links(page).evaluateAll((els) =>
  els.filter((a) => a.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((a) => a.textContent!.trim()));
const orangeLinks = (page: Page) => links(page).evaluateAll((els, o) => els.filter((a) => o.includes(getComputedStyle(a).color)).map((a) => a.textContent!.trim()), ORANGES);
const openMenu = async (page: Page) => {
  await toggle(page).click();
  await expect.poll(() => visibleLinks(page)).toEqual(['Library', 'Collection', 'Compare']);
};
const closed = async (page: Page) => {
  await expect.poll(() => visibleLinks(page)).toEqual([]);
  expect(await toggle(page).getAttribute('aria-expanded')).toBe('false');
  expect(await page.evaluate(() => document.documentElement.classList.contains('menu-open'))).toBe(false);
};
/** The styles a scroll lock would change, on html and body (computed, plus any inline style). */
const rootStyles = (page: Page) => page.evaluate(() => [document.documentElement, document.body].map((el) => {
  const s = getComputedStyle(el);
  return { overflow: s.overflow, position: s.position, top: s.top, paddingRight: s.paddingRight, touchAction: s.touchAction, inline: el.getAttribute('style') };
}));
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

describe('phone menu (browser)', () => {
  let browser: Browser;
  const pages: Record<string, string> = {};
  beforeAll(async () => {
    browser = await chromium.launch();
    pages['/changelog'] = await handleChangelog(new Request('https://site.test/changelog')).text();
  });
  afterAll(async () => { await browser?.close(); });

  it.each(['', 'changelog'])('/%s at 390px: the links hide behind the button, which opens a panel of the three links', async (path) => {
    const page = await openSite(browser, path, { width: PHONE, pages });
    expect(await visibleLinks(page)).toEqual([]);
    expect(await toggle(page).isVisible()).toBe(true);
    expect(await toggle(page).getAttribute('aria-expanded')).toBe('false');
    expect(await toggle(page).getAttribute('aria-label')).toBe('Menu');
    expect(await toggle(page).getAttribute('aria-controls')).toBe('site-nav');
    expect(await toggle(page).boundingBox()).toMatchObject({ width: 40, height: 40 });
    const wordmark = (await page.locator('.wordmark').boundingBox())!;
    const btn = (await toggle(page).boundingBox())!;
    expect(btn.x).toBeGreaterThan(wordmark.x + wordmark.width); // same row, on the right
    expect(Math.abs((btn.y + btn.height / 2) - (wordmark.y + wordmark.height / 2))).toBeLessThan(2);

    await openMenu(page);
    expect(await toggle(page).getAttribute('aria-expanded')).toBe('true');
    expect(await page.locator('#site-nav .topnav-link').allTextContents()).toEqual(['Library', 'Collection', 'Compare']);
    await page.waitForTimeout(200); // the panel slides in over .15s
    const bar = (await page.locator('.topbar').boundingBox())!;
    const panel = (await page.locator('#site-nav').boundingBox())!;
    expect(panel.width).toBe(PHONE); // full width
    expect(panel.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1); // under the bar
    for (const box of await links(page).evaluateAll((els) => els.map((a) => a.getBoundingClientRect().height))) expect(box).toBeCloseTo(48, 2);
    expect(await noSideScroll(page)).toBe(true);
    await page.context().close();
  });

  it('a link closes the menu, including the hash links that don\'t reload the page', async () => {
    const page = await openSite(browser, '', { width: PHONE });
    await openMenu(page);
    await page.locator('.topnav-link[data-nav="compare"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compare');
    expect(await page.locator('#analyticsView').isVisible()).toBe(true);
    await closed(page);
    await page.context().close();
  });

  it.each(['wheel', 'swipe'])('the page behind keeps scrolling while the menu is open (%s), and the menu stays open', async (how) => {
    const page = await openSite(browser, '', { width: PHONE, hasTouch: how === 'swipe' });
    await page.waitForTimeout(300);
    const before = await rootStyles(page);
    if (how === 'swipe') await toggle(page).tap(); else await toggle(page).click();
    await expect.poll(() => visibleLinks(page)).toHaveLength(3);
    expect(await rootStyles(page)).toEqual(before); // no overflow, position or padding change on html or body
    if (how === 'wheel') {
      await page.mouse.move(200, 600);
      await page.mouse.wheel(0, 600);
    } else {
      // A real touch drag from below the panel, finger moving up 600px.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 750, yDistance: -600, gestureSourceType: 'touch', speed: 1200 });
    }
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(590);
    expect(await toggle(page).getAttribute('aria-expanded')).toBe('true');
    expect(await visibleLinks(page)).toHaveLength(3);
    expect(await rootStyles(page)).toEqual(before);
    // The panel is still attached under the sticky bar.
    const bar = (await page.locator('.topbar').boundingBox())!;
    const panel = (await page.locator('#site-nav').boundingBox())!;
    expect(bar.y).toBe(0);
    expect(Math.abs(panel.y - (bar.y + bar.height))).toBeLessThan(1.5);
    // A plain tap outside still closes it, and doesn't also press the card link under it.
    const url = page.url();
    const pressed = await page.evaluate(() => document.elementFromPoint(200, 700)?.closest('a, button')?.outerHTML.slice(0, 40) ?? '');
    expect(pressed).not.toBe(''); // there is something to press there
    if (how === 'swipe') await page.touchscreen.tap(200, 700); else await page.mouse.click(200, 700);
    await closed(page);
    await page.waitForTimeout(200);
    expect(page.url()).toBe(url);
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.evaluate(() => (document.querySelector('.lb') as HTMLElement | null)?.hidden ?? true)).toBe(true); // no lightbox
    expect(await page.locator('dialog[open]').count()).toBe(0);
    await page.context().close();
  });

  it('Esc closes the menu and puts focus back on the button', async () => {
    const page = await openSite(browser, '', { width: PHONE });
    await openMenu(page);
    await page.locator('.topnav-link[data-nav="collection"]').focus();
    await page.keyboard.press('Escape');
    await closed(page);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('topnav-toggle'))).toBe(true);
    await page.context().close();
  });

  it('tabbing out of the menu closes it', async () => {
    const page = await openSite(browser, '', { width: PHONE });
    await openMenu(page);
    await page.locator('.topnav-link[data-nav="compare"]').focus();
    await page.keyboard.press('Tab');
    await closed(page);
    await page.context().close();
  });

  it('a tap outside closes the menu without pressing what was under it', async () => {
    const page = await openSite(browser, '', { width: PHONE, hasTouch: true });
    await toggle(page).tap();
    await expect.poll(() => visibleLinks(page)).toHaveLength(3);
    const url = page.url();
    await page.touchscreen.tap(200, 700);
    await closed(page);
    expect(page.url()).toBe(url);
    // The button toggles it too.
    await toggle(page).tap();
    await expect.poll(() => visibleLinks(page)).toHaveLength(3);
    await toggle(page).tap();
    await closed(page);
    await page.context().close();
  });

  it('growing the window past 640px closes the menu and shows the links in the bar', async () => {
    const page = await openSite(browser, '', { width: PHONE });
    await openMenu(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('menu-open'))).toBe(false);
    expect(await toggle(page).getAttribute('aria-expanded')).toBe('false');
    expect(await toggle(page).isVisible()).toBe(false);
    expect(await visibleLinks(page)).toEqual(['Library', 'Collection', 'Compare']);
    await page.context().close();
  });

  it.each([
    ['', 'Library', '.hero'],
    ['#collection', 'Collection', '.topnav-link.active'],
    ['#compare', 'Compare', '#anCanvasWrap .anc-card img'],
    ['changelog', '', 'main.changelog h1'],
  ])('"%s": the menu marks exactly one item (%s), or none on /changelog', async (path, current, ready) => {
    const page = await openSite(browser, path, { width: PHONE, pages });
    await page.locator(ready).first().waitFor({ state: 'attached' });
    await openMenu(page);
    await page.waitForTimeout(200); // link colours fade over .15s
    const expected = current ? [current] : [];
    expect(await orangeLinks(page)).toEqual(expected);
    expect(await page.locator('.topnav-link[aria-current="page"]').allTextContents()).toEqual(expected);
    await page.context().close();
  });

  it('under prefers-reduced-motion the panel opens without a transition', async () => {
    const page = await openSite(browser, '', { width: PHONE, reducedMotion: 'reduce' });
    expect(await page.locator('#site-nav').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await toggle(page).click();
    expect(await visibleLinks(page)).toHaveLength(3);
    await page.context().close();
  });

  it.each(['', 'changelog'])('/%s at 1280px: no menu button, the links sit in the bar as before', async (path) => {
    const page = await openSite(browser, path, { pages });
    expect(await toggle(page).isVisible()).toBe(false);
    expect(await visibleLinks(page)).toEqual(['Library', 'Collection', 'Compare']);
    const nav = await page.locator('#site-nav').evaluate((el) => {
      const s = getComputedStyle(el);
      return { position: s.position, direction: s.flexDirection, gap: s.columnGap, font: getComputedStyle(el.querySelector('a')!).fontSize };
    });
    expect(nav).toEqual({ position: 'static', direction: 'row', gap: '20px', font: '13px' });
    const tops = await links(page).evaluateAll((els) => els.map((a) => Math.round(a.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1); // one row
    const bar = (await page.locator('.topbar').boundingBox())!;
    expect(tops[0]).toBeLessThan(bar.y + bar.height);
    await page.context().close();
  });

  it.each(['', 'changelog'])('/%s at 390px without JS: all three links are visible', async (path) => {
    const page = await openSite(browser, path, { width: PHONE, pages, javaScriptEnabled: false });
    expect(await visibleLinks(page)).toEqual(['Library', 'Collection', 'Compare']);
    expect(await toggle(page).isVisible()).toBe(false);
    expect(await noSideScroll(page)).toBe(true);
    await page.context().close();
  });

  it.each(['', '#collection', '#compare', 'changelog'])('/%s at 360px has no horizontal scroll, menu closed or open', async (path) => {
    const page = await openSite(browser, path, { width: 360, pages });
    await page.waitForTimeout(300);
    expect(await noSideScroll(page)).toBe(true);
    await openMenu(page);
    expect(await noSideScroll(page)).toBe(true);
    await page.context().close();
  });
});

describe('phone menu first paint (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  // Records, on every animation frame from the first one with styles, whether any top-bar link is drawn.
  const PROBE = `(() => {
    window.__shown = [];
    const tick = () => {
      if (document.styleSheets.length && document.body) window.__shown.push([...document.querySelectorAll('.topnav-link')].some((a) => a.checkVisibility({ visibilityProperty: true, opacityProperty: true })));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();`;

  it.each(['', '#compare'])('/%s at 390px never shows the links before collapsing them', async (hash) => {
    const page = await openSite(browser, hash, { width: PHONE, initScript: PROBE });
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() => (window as unknown as { __shown: boolean[] }).__shown);
    expect(shown.length).toBeGreaterThan(5);
    expect(shown.filter(Boolean)).toEqual([]);
    await page.context().close();
  });
});

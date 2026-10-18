import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { WEEKS, frames, openSite, probe } from './analytics-page';

// Links to #compare, #collection and #notes show that view from the first paint (html[data-view], set by the
// inline script in index.html's <head>), never the homepage; Compare opens in Canvas at 136%.

const HERO_ANIMATIONS = ['title-rise', 'word-in', 'grid-draw', 'orb-flow', 'ann-tag', 'ann-box', 'ann-rule', 'ann-sw'];
const heroAnimations = (page: Page) => page.evaluate((names) =>
  document.getAnimations().map((a) => (a as CSSAnimation).animationName).filter((n) => names.includes(n)), HERO_ANIMATIONS);
const pct = (page: Page) => page.locator('.anc-zoom-pct').textContent();
const pressed = (page: Page, v: string) => page.locator(`.an-view [data-anview="${v}"]`).getAttribute('aria-pressed');

describe('first paint of view links (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const SHARED = `#compare?view=canvas&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude`;
  it.each([
    [SHARED, '#analyticsView', 'compare', '#anCanvasWrap .anc-card img'],
    ['#compare', '#analyticsView', 'compare', '#anCanvasWrap .anc-card img'],
    ['#collection', '#collectionView', 'collection', '.topnav-link.active'],
    ['#notes', '#insightsView', 'insights', '.topnav-link.active'],
  ])('%s never shows the homepage and marks its nav link from the start', async (hash, view, nav, ready) => {
    const page = await openSite(browser, hash, { initScript: probe(view, nav) });
    await page.locator(ready).first().waitFor();
    await page.waitForTimeout(300);
    const log = await frames(page);
    expect(log.length).toBeGreaterThan(5);
    expect(log.filter((f) => f.gallery)).toEqual([]);
    expect(log.filter((f) => !f.target || !f.navActive)).toEqual([]);
    // The first frames come before app.js has the data (route() not run yet).
    expect(log[0].routed).toBe(false);
    if (view === '#analyticsView') expect(log[0].loading).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.view)).toBe(nav === 'insights' ? 'notes' : nav);
    expect(await heroAnimations(page)).toEqual([]);
    expect(await page.locator('.hero-sub').evaluate((el) => el.classList.contains('annot'))).toBe(false);
  });

  it('the homepage still shows the hero and plays its animation', async () => {
    const page = await openSite(browser, '');
    expect(await page.evaluate(() => document.documentElement.dataset.view)).toBe('gallery');
    expect(await page.locator('.hero').isVisible()).toBe(true);
    expect(await page.locator('#analyticsView').isVisible()).toBe(false);
    expect(await heroAnimations(page)).toEqual(expect.arrayContaining(['title-rise', 'word-in', 'grid-draw', 'orb-flow']));
    await page.locator('.hero-sub.annot').waitFor({ state: 'attached', timeout: 5000 });
    expect(await page.locator('.topnav-link.active').getAttribute('data-nav')).toBe('gallery');
  });

  it('navigating keeps html[data-view] in sync, and the hero starts when the homepage is first shown', async () => {
    const page = await openSite(browser, '#compare');
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    const viewIs = (v: string) => page.waitForFunction((v) => document.documentElement.dataset.view === v, v);
    await page.locator('.topnav-link[data-nav="collection"]').click();
    await viewIs('collection');
    expect(await page.evaluate(() => document.documentElement.dataset.view)).toBe('collection');
    expect(await page.locator('#collectionView').isVisible()).toBe(true);
    expect(await page.locator('#analyticsView').isVisible()).toBe(false);
    await page.locator('.topnav-link[data-nav="gallery"]').click();
    await viewIs('gallery');
    expect(await page.evaluate(() => document.documentElement.dataset.view)).toBe('gallery');
    expect(await page.locator('.hero').isVisible()).toBe(true);
    expect(await page.locator('#collectionView').isVisible()).toBe(false);
    await page.locator('.hero-sub.annot').waitFor({ state: 'attached', timeout: 5000 });
  });

  it('without JavaScript the homepage shows as before', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../public/styles.css', import.meta.url));
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://site.test/#compare');
    expect(await page.locator('#galleryView').isVisible()).toBe(true);
    expect(await page.locator('#analyticsView').isVisible()).toBe(false);
    await context.close();
  });
});

describe('Compare defaults (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('opens in Canvas at 136%, centred on the cards (1280px)', async () => {
    const page = await openSite(browser, '#compare', { shotShaped: true });
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(await pressed(page, 'canvas')).toBe('true');
    expect(await pressed(page, 'table')).toBe('false');
    expect(await pct(page)).toBe('136%');
    const off = await page.evaluate(() => {
      const board = document.querySelector('.anc-board')!.getBoundingClientRect();
      const rects = [...document.querySelectorAll('.anc-card, .anc-board .anc-box')].map((el) => el.getBoundingClientRect());
      const x0 = Math.min(...rects.map((r) => r.left)), x1 = Math.max(...rects.map((r) => r.right));
      const y0 = Math.min(...rects.map((r) => r.top)), y1 = Math.max(...rects.map((r) => r.bottom));
      return { x: (x0 + x1) / 2 - (board.left + board.width / 2), y: (y0 + y1) / 2 - (board.top + board.height / 2) };
    });
    expect(Math.abs(off.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(off.y)).toBeLessThanOrEqual(2);
    // Nothing changed yet, so nothing is written to the URL.
    await page.waitForTimeout(400);
    expect(page.url()).toBe('https://site.test/#compare');
    // Fit still fits (at most 100%).
    await page.locator('[data-zoom="fit"]').click();
    expect(parseInt((await pct(page))!, 10)).toBeLessThanOrEqual(100);
  });

  it('a board narrower than 760px fits as before (800px window)', async () => {
    const page = await openSite(browser, '#compare', { width: 800 });
    await page.locator('#anCanvasWrap .anc-board .anc-card img').first().waitFor();
    expect(await page.locator('.anc-board').evaluate((el) => el.clientWidth)).toBeLessThan(760);
    expect(parseInt((await pct(page))!, 10)).toBeLessThanOrEqual(100);
  });

  it('at 390px Canvas shows the stacked cards, as before', async () => {
    const page = await openSite(browser, '#compare', { width: 390 });
    await page.locator('#anCanvasWrap .anc-card--stack img').first().waitFor();
    expect(await pressed(page, 'canvas')).toBe('true');
    expect(await page.locator('.anc-board').count()).toBe(0);
    expect(await page.locator('#anCanvasTools').isVisible()).toBe(false);
  });

  it('a link with view=table opens Table, and zoom=1.28 opens at 128%', async () => {
    const table = await openSite(browser, `#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude&device=desktop`);
    await table.locator('#anTableWrap .an-table').waitFor();
    expect(await pressed(table, 'table')).toBe('true');
    expect(await table.locator('#anCanvasWrap').isVisible()).toBe(false);

    const zoomed = await openSite(browser, `#compare?view=canvas&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude&device=desktop&zoom=1.28`);
    await zoomed.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(await pct(zoomed)).toBe('128%');
  });

  it('a link with zoom and pan opens at exactly that zoom and pan; zoom without pan is centred on the cards', async () => {
    const base = `#compare?view=canvas&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude&device=desktop`;
    const world = (page: Page) => page.locator('.anc-world').evaluate((el) => (el as HTMLElement).style.transform);
    const exact = await openSite(browser, `${base}&zoom=1.36&pan=16,182`, { shotShaped: true });
    await exact.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(await world(exact)).toBe('translate(16px, 182px) scale(1.36)');
    expect(await pct(exact)).toBe('136%');

    const centred = await openSite(browser, `${base}&zoom=1.36`, { shotShaped: true });
    await centred.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(await world(centred)).toMatch(/scale\(1\.36\)$/);
    expect(await world(centred)).not.toBe('translate(16px, 182px) scale(1.36)');
  });
});

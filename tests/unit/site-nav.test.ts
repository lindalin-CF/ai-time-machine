import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { MENU_BUTTON, handleChangelog, handleHowWeAnalyze, handleLicense, handlePortalPage, handlePrivacy, siteHeader } from '../../src/portal-page';
import { makeEnv } from './fake-env';
import { openSite } from './analytics-page';

// The top bar: Library · Collection · Compare on the homepage (public/index.html) and on every server-rendered
// page (siteHeader in src/portal-page.ts). Exactly one item is current on the homepage views and none elsewhere.
// The Changelog is linked from both footers, and the retired Notes links (#notes, #insights) go to /changelog.

const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
/** The accent orange and the darker orange-ink: both read as "orange" (the old hover colour was orange-ink). */
const ORANGES = ['rgb(235, 98, 44)', 'rgb(204, 80, 30)'];

describe('top bar markup', () => {
  it('the homepage lists Library, Collection and Compare, with no Changelog or Notes', () => {
    const nav = INDEX_HTML.match(/<nav class="topnav" id="site-nav" aria-label="Site">([\s\S]*?)<\/nav>/)![1];
    expect([...nav.matchAll(/<a href="([^"]+)" class="topnav-link" data-nav="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2], m[3]])).toEqual([
      ['#', 'gallery', 'Library'], ['#collection', 'collection', 'Collection'], ['#compare', 'compare', 'Compare'],
    ]);
    expect(nav).not.toContain('Changelog');
    expect(INDEX_HTML).not.toMatch(/>\s*Notes\s*</);
  });

  it('server pages have the same three links, none of them current', async () => {
    const t = makeEnv();
    const req = (p: string) => new Request(`https://x${p}`);
    const pages: [string, string][] = [
      ['/changelog', await handleChangelog(req('/changelog')).text()],
      ['/how-we-analyze', await handleHowWeAnalyze(req('/how-we-analyze')).text()],
      ['/privacy', await handlePrivacy(req('/privacy')).text()],
      ['/license', await handleLicense(req('/license')).text()],
      ['/portals/claude', await (await handlePortalPage(req('/portals/claude'), t.env)).text()],
      ['/portals/nope (404)', await (await handlePortalPage(req('/portals/nope'), t.env)).text()],
    ];
    for (const [path, html] of pages) {
      const nav = html.match(/<nav class="topnav" id="site-nav" aria-label="Site">([\s\S]*?)<\/nav>/)?.[1] ?? '';
      expect([...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`), path)
        .toEqual(['Library /', 'Collection /#collection', 'Compare /#compare']);
      expect(nav, path).not.toMatch(/aria-current|active/);
      expect(html, path).toContain(siteHeader());
      expect(html, path).not.toMatch(/>\s*Notes\s*</);
      // The footer keeps Changelog right after License.
      expect(html, path).toContain('<a href="/license">License</a> &middot; <a href="/changelog">Changelog</a> &middot;');
    }
  });

  it('the homepage footer keeps Changelog right after License', () => {
    const foot = INDEX_HTML.match(/<footer class="sitefoot">([\s\S]*?)<\/footer>/)![1];
    expect(foot).toContain('<a href="/license">License</a> &middot; <a href="/changelog">Changelog</a> &middot;');
  });

  it('the homepage and the server pages share the same menu button, right before the nav it controls', () => {
    expect(MENU_BUTTON).toMatch(/^<button type="button" class="topnav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">/);
    expect(INDEX_HTML).toContain(`${MENU_BUTTON}\n    <nav class="topnav" id="site-nav"`);
    expect(siteHeader()).toMatch(/<\/button>\s*<nav class="topnav" id="site-nav"/);
    expect(siteHeader()).toContain(MENU_BUTTON);
  });
});

/**
 * Runs before every page of the context: on each animation frame (once styles have loaded) records the top-bar
 * links drawn in orange, whether the gallery or a Notes view is visible, and the page's path. Kept in sessionStorage
 * so frames from a page that redirected away can still be read.
 */
const PROBE = `(() => {
  const log = () => JSON.parse(sessionStorage.getItem('navFrames') || '[]');
  const tick = () => {
    const sheet = [...document.styleSheets].length && document.body;
    if (sheet) {
      const vis = (el) => !!el && el.checkVisibility({ visibilityProperty: true });
      const frames = log();
      frames.push({
        path: location.pathname + location.hash,
        orange: [...document.querySelectorAll('.topnav-link')].filter((a) => vis(a) && ${JSON.stringify(ORANGES)}.includes(getComputedStyle(a).color)).map((a) => a.textContent.trim()),
        gallery: vis(document.querySelector('#galleryView')) || vis(document.querySelector('.hero')),
        notes: !!document.querySelector('#insightsView') || [...document.querySelectorAll('h1')].some((h) => vis(h) && h.textContent.trim() === 'Notes'),
      });
      sessionStorage.setItem('navFrames', JSON.stringify(frames.slice(-400)));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;
type Frame = { path: string; orange: string[]; gallery: boolean; notes: boolean };
const frames = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('navFrames') || '[]') as Frame[]);

describe('top bar in the browser', () => {
  let browser: Browser;
  const pages: Record<string, string> = {};
  beforeAll(async () => {
    browser = await chromium.launch();
    pages['/changelog'] = await handleChangelog(new Request('https://site.test/changelog')).text();
  });
  afterAll(async () => { await browser?.close(); });

  it.each(['#notes', '#insights?x=1'])('/%s ends up on /changelog without showing the homepage or a Notes view', async (hash) => {
    const page = await openSite(browser, hash, { pages, initScript: PROBE });
    await page.waitForURL('https://site.test/changelog');
    await page.locator('main.changelog h1').waitFor();
    await page.waitForTimeout(200);
    const log = await frames(page);
    expect(log.filter((f) => f.gallery)).toEqual([]);
    expect(log.filter((f) => f.notes)).toEqual([]);
    expect(log.filter((f) => f.path !== '/changelog')).toEqual([]); // nothing was drawn before leaving
    expect(log.at(-1)!.orange).toEqual([]);
    await page.context().close();
  });

  it('following a #notes link from inside the site also goes to /changelog', async () => {
    const page = await openSite(browser, '#collection', { pages });
    await page.locator('.topnav-link.active').waitFor();
    await page.evaluate(() => { location.hash = '#notes'; });
    await page.waitForURL('https://site.test/changelog');
    await page.context().close();
  });

  it.each([
    ['', 'Library', '.hero'],
    ['#compare', 'Compare', '#anCanvasWrap .anc-card img'],
    ['#collection', 'Collection', '.topnav-link.active'],
  ])('"%s": exactly one orange item (%s) on every frame from the first paint', async (hash, current, ready) => {
    const page = await openSite(browser, hash, { initScript: PROBE });
    await page.locator(ready).first().waitFor();
    await page.waitForTimeout(300);
    const log = await frames(page);
    expect(log.length).toBeGreaterThan(5);
    expect(log.filter((f) => f.orange.length !== 1 || f.orange[0] !== current)).toEqual([]);
    expect(await page.locator('.topnav-link[aria-current="page"]').allTextContents()).toEqual([current]);
    await page.context().close();
  });

  it('/changelog: no orange item and no aria-current, on every frame', async () => {
    const page = await openSite(browser, 'changelog', { pages, initScript: PROBE });
    await page.waitForTimeout(300);
    const log = await frames(page);
    expect(log.length).toBeGreaterThan(5);
    expect(log.filter((f) => f.orange.length)).toEqual([]);
    expect(await page.locator('.topnav-link').allTextContents()).toEqual(['Library', 'Collection', 'Compare']);
    expect(await page.locator('.topnav-link[aria-current]').count()).toBe(0);
    await page.context().close();
  });

  it.each([false, true])('going Back keeps one orange item, with the pointer or a tap left on another link (touch: %s)', async (touch) => {
    const page = await openSite(browser, '#compare', { hasTouch: touch, width: touch ? 390 : 1280 });
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    const collection = page.locator('.topnav-link[data-nav="collection"]');
    if (touch) await page.locator('.topnav-toggle').tap(); // phones reach the links through the menu
    if (touch) await collection.tap(); else await collection.click(); // the pointer stays on Collection
    await page.waitForFunction(() => document.documentElement.dataset.view === 'collection');
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compare');
    const orange = () => page.locator('.topnav-link').evaluateAll((els, o) => els.filter((a) => o.includes(getComputedStyle(a).color)).map((a) => a.textContent), ORANGES);
    await expect.poll(orange).toEqual(['Compare']); // the links fade their colour over .15s
    await page.waitForTimeout(300);
    expect(await orange()).toEqual(['Compare']); // and stays the only one
    await page.context().close();
  });
});

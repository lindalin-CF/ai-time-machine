import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { WEEKS, openSite } from './analytics-page';
import { encodeLayout } from '../../public/analytics-share.js';

// Compare (called Analytics until Oct 2026): its name in the nav, page and toggles, and #analytics links,
// already shared, which keep opening it as #compare. Also the homepage hero sentence and its annotations.

const LAYOUT = encodeLayout({ pos: { [WEEKS[0]]: { x: 0, y: 0 }, [WEEKS[1]]: { x: 700, y: 120 } }, edges: [[WEEKS[0], WEEKS[1]]] }, [WEEKS[0], WEEKS[1]]);
const SETUP = `view=canvas&mode=time&portal=claude&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop&zoom=0.9&pan=40,-30&layout=${LAYOUT}`;

/** What Compare shows: pressed toggles, selection, cards with their positions, lines and zoom. */
const setup = (page: Page) => page.evaluate(() => {
  const pressed = (sel: string) => [...document.querySelectorAll(`${sel} .vt-btn[aria-pressed="true"]`)].map((b) => b.textContent!.trim());
  return {
    mode: pressed('.an-mode'), device: pressed('.an-device'), view: pressed('.an-view'),
    portals: [...document.querySelectorAll('#anPortals .chip[aria-selected="true"]')].map((c) => c.textContent),
    count: document.querySelector('#anCount')!.textContent,
    cards: [...document.querySelectorAll('.anc-card')].map((el) => `${(el as HTMLElement).dataset.id}@${(el as HTMLElement).style.transform}`),
    edges: document.querySelectorAll('.anc-edge').length,
    pct: document.querySelector('.anc-zoom-pct')!.textContent,
  };
});
const cardsReady = (page: Page) => page.locator('#anCanvasWrap .anc-card img').first().waitFor();

describe('Compare (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('the nav shows Compare, active, and the page is titled Compare', async () => {
    const page = await openSite(browser, '#compare');
    await cardsReady(page);
    expect(await page.locator('.topnav-link').allTextContents()).toEqual(['Library', 'Collection', 'Compare', 'Notes']);
    const link = page.locator('.topnav-link[data-nav="compare"]');
    expect(await link.getAttribute('href')).toBe('#compare');
    expect(await page.locator('.topnav-link.active').allTextContents()).toEqual(['Compare']);
    expect(await page.evaluate(() => document.documentElement.dataset.view)).toBe('compare');
    expect(await page.locator('#analyticsView h1').textContent()).toBe('Compare');
    expect(await page.locator('#analyticsView .analytics-sub').textContent())
      .toBe('Compare AI product UIs side by side, or see how one product changes week by week.');
    expect(await page.locator('header, #analyticsView').filter({ hasText: 'Analytics' }).count()).toBe(0);
  });

  it('the mode toggle shows Across products and Week by week, with the same mode values', async () => {
    const page = await openSite(browser, '#compare');
    await cardsReady(page);
    expect(await page.locator('.an-mode .vt-btn').evaluateAll((els) => els.map((b) => `${b.getAttribute('data-mode')}=${b.textContent!.trim()}`)))
      .toEqual(['portals=Across products', 'weeks=Week by week']);
    await page.locator('[data-mode="weeks"]').click();
    await page.waitForFunction(() => location.hash.includes('mode=time'));
    expect(new URL(page.url()).hash).toMatch(/^#compare\?view=canvas&mode=time&/);
  });

  it('/#analytics?… opens Compare with the same setup, and the URL becomes /#compare?…', async () => {
    const current = await openSite(browser, `#compare?${SETUP}`);
    await cardsReady(current);
    const old = await openSite(browser, `#analytics?${SETUP}`);
    await cardsReady(old);
    expect(old.url()).toBe(`https://site.test/#compare?${SETUP}`);
    // Replaced, not a new history entry: as many entries as opening #compare directly.
    expect(await old.evaluate(() => history.length)).toBe(await current.evaluate(() => history.length));
    const seen = await setup(old);
    expect(seen).toEqual(await setup(current));
    expect(seen).toMatchObject({ mode: ['Week by week'], view: ['Canvas'], portals: ['Claude'], count: '2 of 4 selected', edges: 1, pct: '90%' });
    expect(await old.locator('.topnav-link.active').allTextContents()).toEqual(['Compare']);
  });

  it('a plain /#analytics link opens Compare at /#compare', async () => {
    const page = await openSite(browser, '#analytics');
    await cardsReady(page);
    expect(page.url()).toBe('https://site.test/#compare');
    expect(await page.evaluate(() => document.documentElement.dataset.view)).toBe('compare');
  });

  it('following an #analytics link from another view also lands on #compare with its setup', async () => {
    const page = await openSite(browser, '#notes');
    await page.locator('.topnav-link.active').waitFor();
    await page.evaluate((s) => { location.hash = `#analytics?${s}`; }, SETUP);
    await cardsReady(page);
    expect(page.url()).toBe(`https://site.test/#compare?${SETUP}`);
    expect((await setup(page)).mode).toEqual(['Week by week']);
    // Copy link and URL sync write #compare.
    await page.locator('[data-anview="table"]').click();
    await page.waitForFunction(() => location.hash.includes('view=table'));
    expect(new URL(page.url()).hash).toMatch(/^#compare\?view=table&mode=time&portal=claude&/);
  });
});

describe('homepage hero (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('reads the new sentence and shows the three annotations in order: layout, hierarchy, colour', async () => {
    const page = await openSite(browser, '');
    expect(await page.locator('.hero-sub .sr-only').textContent())
      .toBe('Find UI references from AI products, updated weekly, and compare layout, hierarchy and colour for your next design.');
    await page.locator('.hero-sub.annot').waitFor({ state: 'attached', timeout: 5000 });
    // Each keyword's tag animation starts 1.5s after the previous one.
    const delays = await page.evaluate(() => ['kw-layout', 'kw-hier', 'kw-colour'].map((kw) => {
      const tag = document.querySelector(`.hero-sub .${kw} .tag`)!;
      return tag.getAnimations().map((a) => (a.effect as KeyframeEffect).getTiming().delay);
    }));
    expect(delays).toEqual([[0], [1500], [3000]]);
    // Paused 0.8s into each tag's turn, that tag (and only it) is fully shown.
    for (const [i, kw] of ['kw-layout', 'kw-hier', 'kw-colour'].entries()) {
      const shown = await page.evaluate((t) => {
        for (const a of document.getAnimations()) if ((a as CSSAnimation).animationName?.startsWith('ann-')) { a.pause(); a.currentTime = t; }
        return [...document.querySelectorAll('.hero-sub .tag')].filter((tag) => Number(getComputedStyle(tag).opacity) > 0.97)
          .map((tag) => tag.closest('.kw')!.classList[1]);
      }, i * 1500 + 800);
      expect(shown).toEqual([kw]);
    }
  });

  it('keeps every tag inside the panel, including when its keyword starts a line (360px)', async () => {
    for (const width of [1280, 760, 390, 360]) {
      const page = await openSite(browser, '', { width });
      await page.locator('.hero-sub.annot').waitFor({ state: 'attached', timeout: 5000 });
      const outside = await page.evaluate(() => {
        const panel = document.querySelector('.hero-panel')!.getBoundingClientRect();
        return [...document.querySelectorAll('.hero-sub .tag')].filter((t) => {
          const r = t.getBoundingClientRect();
          return r.left < panel.left || r.right > panel.right;
        }).map((t) => t.textContent);
      });
      expect(outside, `${width}px`).toEqual([]);
      await page.context().close();
    }
  });

  it('with reduced motion shows every word at once and no annotations', async () => {
    const page = await openSite(browser, '');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('.hero-sub .w').evaluateAll((els) => els.every((w) => getComputedStyle(w).opacity === '1'))).toBe(true);
    expect(await page.locator('.hero-sub .ann').evaluateAll((els) => els.map((a) => getComputedStyle(a).display))).toEqual(Array(6).fill('none'));
  });
});

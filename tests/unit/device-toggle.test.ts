import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, openSite, showCanvas } from './analytics-page';

// The gallery's Desktop/Mobile toggle (syncToggles in public/app.js) keeps the gallery and collection
// buttons in step, and leaves every other .vt-btn (Analytics Mode/Device/View, canvas zoom) alone.

describe('gallery device toggle and other toggles (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  /** "label*" for highlighted buttons, with aria-pressed, for every .vt-btn matching `sel`. */
  const buttons = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) =>
    els.map((e) => `${e.textContent!.trim()}${e.classList.contains('active') ? '*' : ''}:${e.getAttribute('aria-pressed')}`));
  const gallery = (page: Page) => buttons(page, '.vt-btn[data-device]');
  const shotSrcs = (page: Page) => page.locator('#grid img[src*="/img/shots/"]').evaluateAll((els) => els.map((e) => e.getAttribute('src')));

  it('loads with Desktop highlighted in the gallery and collection toggles', async () => {
    const page = await openSite(browser, '');
    await page.locator('#grid img[src*="/img/shots/"]').first().waitFor();
    expect(await gallery(page)).toEqual(['Desktop*:true', 'Mobile:false', 'Desktop*:true', 'Mobile:false']);
    expect((await shotSrcs(page)).every((s) => !s!.includes('.mobile.'))).toBe(true);
  });

  it('switching to Mobile and back updates both toggles and the cards', async () => {
    const page = await openSite(browser, '');
    await page.locator('#grid img[src*="/img/shots/"]').first().waitFor();
    await page.locator('#galleryView [data-device="mobile"]').click();
    expect(await gallery(page)).toEqual(['Desktop:false', 'Mobile*:true', 'Desktop:false', 'Mobile*:true']);
    expect((await shotSrcs(page)).every((s) => s!.includes('.mobile.'))).toBe(true);

    await page.locator('#galleryView [data-device="desktop"]').click();
    expect(await gallery(page)).toEqual(['Desktop*:true', 'Mobile:false', 'Desktop*:true', 'Mobile:false']);
    expect((await shotSrcs(page)).every((s) => !s!.includes('.mobile.'))).toBe(true);
  });

  // The Compare, Device and View toggles (not Clear selection or the canvas zoom buttons).
  const anToggles = '#analyticsView .viewtoggle:not(.anc-zoom) .vt-btn';

  it('Analytics loads with Across portals, Desktop and Table highlighted, as the HTML marks them', async () => {
    const page = await openAnalytics(browser);
    expect(await buttons(page, anToggles)).toEqual([
      'Across portals*:true', 'Over time:false', 'Desktop*:true', 'Mobile:false', 'Table*:true', 'Canvas:false',
    ]);
  });

  it('the gallery toggle leaves the Analytics and canvas buttons alone', async () => {
    const page = await openAnalytics(browser);
    await showCanvas(page);
    const before = await buttons(page, '#analyticsView .vt-btn');
    expect(before.length).toBeGreaterThan(6);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#galleryView [data-device="mobile"]')!.click());
    expect(await buttons(page, '#analyticsView .vt-btn')).toEqual(before);
    expect(await page.locator('#anCanvasTools .vt-btn[aria-pressed], #anCanvasWrap .vt-btn[aria-pressed], #anClear[aria-pressed]').count()).toBe(0);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';

// The hero's three stats count up from 0 when /api/stats arrives (public/app.js renderStats): they end at the API's
// values, nothing moves while they count, screen readers get only the final values, reduced motion and a hero already
// out of view skip the count, and it runs once per page load.

const STATS = { screenshots: 1234, portals: 17, weeks: 9 };
const FINAL = ['1234', '17', '9'];

/** Runs before the page: every animation frame, the numbers as shown (the counting copy when there is one), whether
 * they are visible, each stat's boxes and the width each number takes. Layout shifts inside the hero are summed in __heroShift. */
const RECORD = `(() => {
  const frames = window.__statFrames = [];
  window.__heroShift = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      if (e.sources.some((s) => s.node && s.node.closest && s.node.closest('.hero'))) window.__heroShift += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
  const tick = () => {
    const dds = [...document.querySelectorAll('[data-stat]')];
    if (dds.length === 3 && document.querySelector('link[href="/styles.css"]')?.sheet) frames.push({
      shown: dds.map((d) => (d.querySelector('.stat-count') || d).textContent),
      visible: dds.every((d) => getComputedStyle(d).visibility === 'visible'),
      boxes: [...document.querySelectorAll('.stat, .stat dt, .stat dd')].map((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(); }),
      // The width the number takes: its counting copy while it counts, its text after.
      widths: dds.map((d) => { const c = d.querySelector('.stat-count'); if (c) return c.getBoundingClientRect().width;
        const r = document.createRange(); r.selectNodeContents(d); return r.getBoundingClientRect().width; }),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

type Frame = { shown: string[]; visible: boolean; boxes: string[]; widths: number[] };
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __statFrames: Frame[] }).__statFrames);
const counted = (page: Page) => page.waitForFunction(() => document.querySelectorAll('[data-stat][data-counted]').length === 3);
const settled = (page: Page) => page.waitForFunction((final) =>
  [...document.querySelectorAll('[data-stat]')].map((d) => d.textContent).join() === final.join() && !document.querySelector('.stat-count'), FINAL);
/** The visible frames only (hidden frames are not seen by anyone). */
const seen = async (page: Page) => (await recorded(page)).filter((f) => f.visible);

describe('hero stats count-up', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it.each([[1280], [700], [390]])('at %ipx counts from 0 up to the exact API values, without moving anything', async (width) => {
    const page = await openSite(browser, '', { width, stats: STATS, initScript: RECORD, reducedMotion: 'no-preference' });
    await settled(page);
    await page.waitForTimeout(100);
    const frames = await seen(page);
    expect(frames[0].shown).toEqual(['0', '0', '0']);
    // It really counts: some frames show values between 0 and the final ones.
    expect(frames.some((f) => Number(f.shown[0]) > 0 && Number(f.shown[0]) < STATS.screenshots)).toBe(true);
    expect(frames.at(-1)!.shown).toEqual(FINAL);
    // Never above the final value, never going down.
    for (let i = 0; i < 3; i++) {
      const values = frames.map((f) => Number(f.shown[i]));
      expect(Math.max(...values)).toBe(Number(FINAL[i]));
      expect(values.every((v, j) => j === 0 || v >= values[j - 1])).toBe(true);
    }
    // Every label and number keeps the same box from the first visible frame to the last.
    expect(new Set(frames.map((f) => f.boxes.join('|'))).size).toBe(1);
    // Each number takes its final width the whole time, so a narrower count never pulls anything beside it.
    for (let i = 0; i < 3; i++) expect(new Set(frames.map((f) => Math.round(f.widths[i] * 10))).size).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __heroShift: number }).__heroShift)).toBe(0);
    await page.context().close();
  });

  it('staggers the three numbers and takes at least 900ms', async () => {
    const page = await openSite(browser, '', { stats: STATS, initScript: RECORD, reducedMotion: 'no-preference' });
    await counted(page);
    const t0 = Date.now();
    await settled(page);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThan(900);
    expect(took).toBeLessThan(5000); // loose: frames slow down when the suite runs Chromium in parallel
    // While the first number has started, the third is still at 0 for a moment.
    const frames = await seen(page);
    expect(frames.some((f) => f.shown[0] !== '0' && f.shown[2] === '0')).toBe(true);
    await page.context().close();
  });

  it('gives screen readers only the final values while counting', async () => {
    const page = await openSite(browser, '', { stats: STATS, reducedMotion: 'no-preference' });
    await page.locator('#stats .stat-count').first().waitFor();
    const during = await page.locator('#stats').ariaSnapshot();
    for (const v of FINAL) expect(during).toContain(`: "${v}"`);
    expect(during).not.toMatch(/: "0"/);
    expect(await page.locator('#stats .stat-count[aria-hidden="true"]').count()).toBe(3);
    await settled(page);
    const after = await page.locator('#stats').ariaSnapshot();
    for (const v of FINAL) expect(after).toContain(`: "${v}"`);
    await page.context().close();
  });

  it('with reduced motion shows the final values straight away, without counting', async () => {
    const page = await openSite(browser, '', { stats: STATS, initScript: RECORD, reducedMotion: 'reduce', statsDelay: 300 });
    await counted(page);
    expect(await page.locator('[data-stat]').allTextContents()).toEqual(FINAL);
    expect(await page.locator('.stat-count').count()).toBe(0);
    await page.waitForTimeout(300);
    const frames = await seen(page);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.shown.join() === FINAL.join())).toBe(true);
    await page.context().close();
  });

  it('skips the count when the hero is already scrolled out of view as the stats arrive', async () => {
    const page = await openSite(browser, '', { stats: STATS, initScript: RECORD, reducedMotion: 'no-preference', height: 500, statsDelay: 800 });
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.hero')!.getBoundingClientRect().bottom + scrollY + 50));
    await counted(page);
    expect(await page.locator('[data-stat]').allTextContents()).toEqual(FINAL);
    expect(await page.locator('.stat-count').count()).toBe(0);
    await page.waitForTimeout(200);
    expect((await seen(page)).every((f) => f.shown.join() === FINAL.join())).toBe(true);
    await page.context().close();
  });

  it('runs once per page load, not again when coming back to the Library', async () => {
    const page = await openSite(browser, '', { stats: STATS, initScript: RECORD, reducedMotion: 'no-preference' });
    await settled(page);
    await page.locator('#grid .card').first().waitFor();
    await page.evaluate(() => { location.hash = '#compare'; });
    await page.locator('#anCanvasWrap .anc-card').first().waitFor();
    const before = (await recorded(page)).length;
    await page.evaluate(() => { location.hash = ''; });
    await page.locator('.hero').waitFor();
    await page.waitForTimeout(400);
    const after = (await recorded(page)).slice(before).filter((f) => f.visible);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((f) => f.shown.join() === FINAL.join())).toBe(true);
    expect(await page.locator('.stat-count').count()).toBe(0);
    await page.context().close();
  });

  it('shows the page\'s numbers at once when /api/stats fails', async () => {
    const page = await openSite(browser, '', { stats: STATS, reducedMotion: 'no-preference', initScript: `window.fetch = ((f) => (u, o) => String(u).includes('/api/stats') ? Promise.resolve(new Response('', { status: 500 })) : f(u, o))(window.fetch);` });
    await counted(page);
    expect(await page.locator('[data-stat]').allTextContents()).toEqual(FINAL);
    await page.context().close();
  });
});

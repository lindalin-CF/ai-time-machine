import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';

// The homepage's dark sand hero (public/sand-hero.js, styles.css; prototype docs/prototypes/sand-hero.html): the canvas
// draws the ring, pauses off screen, holds one still frame with reduced motion; the keyword annotations still play;
// the camera-focus reticle follows a mouse but not a finger; the text on the dark panel meets WCAG AA; nothing shifts.

/** How many canvas pixels are lit (red channel above 40), and a cheap fingerprint of the whole frame. */
const canvasState = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('.hero-sand') as HTMLCanvasElement;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] > 40) lit++; sum = (sum + d[i] * ((i >> 2) % 9973 + 1)) % 2147483647; }
  return { lit, sum, w: c.width, h: c.height };
});
const sandMode = (page: Page) => page.locator('.hero-panel').getAttribute('data-sand');

describe('sand hero (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('draws the ring on the canvas and keeps animating it', async () => {
    const page = await openSite(browser, '', { sand: true, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'running');
    const a = await canvasState(page);
    expect(a.lit).toBeGreaterThan(1000); // thousands of grains, not a black panel
    await page.waitForTimeout(300);
    expect((await canvasState(page)).sum).not.toBe(a.sum);
    await page.context().close();
  });

  it('pauses while the hero is scrolled off screen, and resumes when it comes back', async () => {
    const page = await openSite(browser, '', { sand: true, height: 700, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'running');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.hero')!.getBoundingClientRect().bottom + scrollY + 400));
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'paused');
    const a = await canvasState(page);
    await page.waitForTimeout(400);
    expect((await canvasState(page)).sum).toBe(a.sum); // nothing drawn while off screen
    // The film grain stops with it.
    expect(await page.locator('.hero-grain').evaluate((g) => getComputedStyle(g).animationPlayState)).toBe('paused');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'running');
    await page.context().close();
  });

  it('with reduced motion draws one still frame of the ring', async () => {
    const page = await openSite(browser, '', { sand: true, reducedMotion: 'reduce' });
    expect(await sandMode(page)).toBe('still');
    const a = await canvasState(page);
    expect(a.lit).toBeGreaterThan(1000);
    await page.waitForTimeout(500);
    expect((await canvasState(page)).sum).toBe(a.sum);
    expect(await page.locator('.hero-grain').evaluate((g) => getComputedStyle(g).animationName)).toBe('none');
    await page.context().close();
  });

  it('caps the canvas at 1.75 device pixels per CSS pixel on a 3x screen', async () => {
    const page = await openSite(browser, '', { sand: true, deviceScaleFactor: 3 });
    const ratio = await page.evaluate(() => {
      const c = document.querySelector('.hero-sand') as HTMLCanvasElement;
      return c.width / c.getBoundingClientRect().width;
    });
    expect(ratio).toBeCloseTo(1.75, 2);
    await page.context().close();
  });

  it('still plays the keyword annotations, recoloured for the dark panel', async () => {
    const page = await openSite(browser, '', { sand: true, reducedMotion: 'no-preference' });
    await page.locator('.hero-sub.annot').waitFor({ state: 'attached', timeout: 5000 });
    const colours = await page.evaluate(() => {
      const bg = (s: string) => getComputedStyle(document.querySelector(s)!).backgroundColor;
      return {
        tag: bg('.hero-sub .kw-hier .tag'),
        orange: bg('.hero-sub .kw-layout .tag'),
        next: getComputedStyle(document.querySelector('.hero-sub em')!).color,
        playing: document.getAnimations().some((a) => (a as CSSAnimation).animationName === 'ann-tag'),
      };
    });
    expect(colours).toEqual({ tag: 'rgb(242, 240, 236)', orange: 'rgb(196, 76, 28)', next: 'rgb(236, 138, 95)', playing: true });
    await page.context().close();
  });

  it('shows the camera-focus reticle for a mouse, locking it after a rest, and hides it on leave', async () => {
    const page = await openSite(browser, '', { sand: true, reducedMotion: 'no-preference' });
    const box = (await page.locator('.hero-panel').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.52, { steps: 4 });
    await expect.poll(() => page.locator('.hero-panel').getAttribute('class')).toContain('is-focusing');
    await expect.poll(() => page.locator('.hero-reticle').evaluate((r) => getComputedStyle(r).opacity)).toBe('1');
    expect(await page.locator('.hero-focus').evaluate((f) => getComputedStyle(f).backdropFilter)).toBe('blur(2.4px)');
    // At rest for 260ms the brackets lock in orange.
    await expect.poll(() => page.locator('.hero-reticle-label').textContent()).toBe('AF-L · f/1.8');
    await expect.poll(() => page.locator('.hero-reticle-box i').first().evaluate((i) => getComputedStyle(i).borderTopColor)).toBe('rgb(236, 138, 95)');
    // The reticle trails the cursor: just after a jump it has not caught up yet.
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3);
    const lag = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hero-panel')!).getPropertyValue('--rx')));
    expect(lag).toBeGreaterThan(box.width * 0.4 + 5);
    expect(await page.locator('.hero-reticle-label').textContent()).toBe('AF · f/1.8');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
    await expect.poll(() => page.locator('.hero-panel').getAttribute('class')).not.toContain('is-focusing');
    await page.context().close();
  });

  it('shows no reticle or blur for touch', async () => {
    const page = await openSite(browser, '', { sand: true, width: 390, height: 844, hasTouch: true, isMobile: true });
    const box = (await page.locator('.hero-panel').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 3);
    await page.waitForTimeout(400);
    expect(await page.locator('.hero-panel').getAttribute('class')).not.toContain('is-focusing');
    expect(await page.locator('.hero-reticle').evaluate((r) => getComputedStyle(r).display)).toBe('none');
    expect(await page.locator('.hero-focus').evaluate((f) => getComputedStyle(f).display)).toBe('none');
    await page.context().close();
  });

  it('keeps the text on the dark panel at WCAG AA contrast', async () => {
    const page = await openSite(browser, '', { sand: true });
    await page.waitForFunction(() => document.querySelectorAll('[data-stat][data-counted]').length === 3);
    const ratios = await page.evaluate(() => {
      // Each colour flattened onto the panel's #0b0b0c (the soft text is translucent).
      const bg = [11, 11, 12];
      const lum = (c: number[]) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
      const ratio = (sel: string) => {
        const m = getComputedStyle(document.querySelector(sel)!).color.match(/[\d.]+/g)!.map(Number);
        const a = m[3] ?? 1, fg = [0, 1, 2].map((i) => m[i] * a + bg[i] * (1 - a));
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
      };
      return Object.fromEntries(['.stat dt', '.stat dd', '.hero-week-label', '.hero-week', '.hero-sub', '.hero-sub .w.l1', '.hero-sub em', '.hero-title']
        .map((s) => [s, ratio(s)]));
    });
    for (const [sel, r] of Object.entries(ratios)) expect(r, sel).toBeGreaterThanOrEqual(4.5);
    await page.context().close();
  });

  it.each([[390], [768], [1024], [1280], [1440]])('at %ipx loads without shifting anything in the hero', async (width) => {
    const page = await openSite(browser, '', {
      sand: true, width, statsDelay: 300, stats: { screenshots: 157, portals: 15, weeks: 11 }, reducedMotion: 'no-preference',
      initScript: `window.__heroShift = 0; new PerformanceObserver((l) => { for (const e of l.getEntries())
        if (e.sources.some((s) => s.node && s.node.closest && s.node.closest('.hero'))) window.__heroShift += e.value; }).observe({ type: 'layout-shift', buffered: true });`,
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-stat][data-counted]').length === 3);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __heroShift: number }).__heroShift)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.context().close();
  });
});

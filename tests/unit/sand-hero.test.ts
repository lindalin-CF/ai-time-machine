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
/**
 * Resolves after `n` animation frames. The sand loop draws on animation frames (at most one draw per ~16ms), so a
 * canvas that is still unchanged after many frames is not drawing; counting frames instead of milliseconds keeps
 * that true on a slow, busy machine.
 */
const frames = (page: Page, n: number) => page.evaluate((n) => new Promise<void>((done) => {
  let k = 0;
  const tick = () => (++k >= n ? done() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);

describe('sand hero (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('draws the ring on the canvas and keeps animating it', async () => {
    const page = await openSite(browser, '', { sand: true, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'running');
    const a = await canvasState(page);
    expect(a.lit).toBeGreaterThan(1000); // thousands of grains, not a black panel
    await expect.poll(async () => (await canvasState(page)).sum).not.toBe(a.sum);
    await page.context().close();
  });

  it('pauses while the hero is scrolled off screen, and resumes when it comes back', async () => {
    const page = await openSite(browser, '', { sand: true, height: 700, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'running');
    // Room below the hero, so the scroll takes it fully off screen even before the Library below has loaded
    // (with a 700px window the page is only ~35px taller than needed once it has).
    await page.evaluate(() => {
      document.body.style.paddingBottom = '2000px';
      window.scrollTo(0, document.querySelector('.hero')!.getBoundingClientRect().bottom + scrollY + 400);
    });
    await page.waitForFunction(() => document.querySelector('.hero-panel')!.getBoundingClientRect().bottom < 0);
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'paused');
    const a = await canvasState(page);
    await frames(page, 30);
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
    await frames(page, 30);
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
    await frames(page, 30);
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

  // The black panel has no dark inset around it: its left and right edges are the filter bar's, the "Week of …" heading
  // row's and the card grid's. The ring (redrawn by the ResizeObserver at the new size) stays inside it and off the type.
  it.each([[390, 844], [768, 1000], [1024, 900], [1280, 900], [1440, 900], [1440, 760]])('at %ix%ipx the panel lines up with the filter bar and the grid, and the ring stays clear of the text', async (width, height) => {
    const page = await openSite(browser, '', { sand: true, width, height, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'still');
    await page.waitForSelector('#grid > *');
    const r = await page.evaluate(() => {
      const x = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [b.left, b.right]; };
      const frame = getComputedStyle(document.querySelector('.hero-frame')!), panel = getComputedStyle(document.querySelector('.hero-panel')!);
      const c = document.querySelector('.hero-sand') as HTMLCanvasElement, pr = c.getBoundingClientRect(), k = c.width / pr.width;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const isLit = (px: number, py: number) => d[(py * c.width + px) * 4] > 40;
      const litIn = (s: string) => {
        const b = document.querySelector(s)!.getBoundingClientRect(); let n = 0;
        for (let py = Math.max(0, Math.floor((b.top - pr.top) * k)); py < Math.min(c.height, (b.bottom - pr.top) * k); py++)
          for (let px = Math.max(0, Math.floor((b.left - pr.left) * k)); px < Math.min(c.width, (b.right - pr.left) * k); px++) if (isLit(px, py)) n++;
        return n;
      };
      let edge = 0, lit = 0;
      for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) if (isLit(px, py)) {
        lit++; if (px < 3 || py < 3 || px >= c.width - 3 || py >= c.height - 3) edge++;
      }
      return {
        panel: x('.hero-panel'), controls: x('.controls'), head: x('main .section-head'), grid: x('#grid'),
        canvasFillsPanel: Math.abs(pr.width - document.querySelector('.hero-panel')!.getBoundingClientRect().width) < 0.5,
        padding: frame.padding, radius: [panel.borderTopLeftRadius, panel.borderBottomRightRadius], frameRadius: frame.borderTopLeftRadius,
        shadow: frame.boxShadow !== 'none', lit, edge,
        text: { title: litIn('.hero-title'), sub: litIn('.hero-sub'), week: litIn('.hero-week'), stats: litIn('.stats') },
      };
    });
    expect(r.panel).toEqual(r.controls);
    expect(r.head).toEqual(r.controls);
    expect(r.grid).toEqual(r.controls);
    expect(r.canvasFillsPanel).toBe(true);
    expect(r.padding).toBe('0px');
    expect(r.radius).toEqual([r.frameRadius, r.frameRadius]);
    expect(parseFloat(r.frameRadius)).toBeGreaterThan(0);
    expect(r.shadow).toBe(true);
    expect(r.lit).toBeGreaterThan(1000); // the ring is drawn
    expect(r.edge).toBe(0); // and none of it reaches the panel's edges
    expect(r.text).toMatchObject({ title: 0, sub: 0, week: 0 });
    expect(r.text.stats).toBeLessThan(20); // at most a few stray grains of dust near the stats' box, not the ring
    await page.context().close();
  });

  // Desktop and tablet keep the MacBook Air ring's shape (1440x900: a/b 1.512 in px, tilt -0.46) at every panel size;
  // only its size and place change. sand-hero.js reports the ring it draws in data-ring: "cx cy a b tilt" (px, radians).
  const STANDARD_RATIO = 211.64 / 140; // 0.185 x the 1144px panel / 0.28 x the 500px panel, before the change
  it.each([[761, 900], [900, 900], [1024, 900], [1180, 900], [1280, 900], [1280, 800], [1440, 900], [1440, 760], [1920, 1080]])('at %ix%ipx the ring has the standard shape and stays inside the panel and off the text', async (width, height) => {
    const page = await openSite(browser, '', { sand: true, width, height, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'still');
    await page.waitForFunction(() => document.querySelectorAll('[data-stat][data-counted]').length === 3);
    const r = await page.evaluate(() => {
      const p = document.querySelector('.hero-panel')!, pb = p.getBoundingClientRect();
      const [cx, cy, a, b, t] = p.getAttribute('data-ring')!.split(' ').map(Number);
      // the tilted ellipse's bounding box
      const hw = Math.hypot(a * Math.cos(t), b * Math.sin(t)), hh = Math.hypot(a * Math.sin(t), b * Math.cos(t));
      const c = document.querySelector('.hero-sand') as HTMLCanvasElement, k = c.width / pb.width;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const litIn = (s: string) => {
        const e = document.querySelector(s)!.getBoundingClientRect(); let n = 0;
        for (let py = Math.max(0, Math.floor((e.top - pb.top) * k)); py < Math.min(c.height, (e.bottom - pb.top) * k); py++)
          for (let px = Math.max(0, Math.floor((e.left - pb.left) * k)); px < Math.min(c.width, (e.right - pb.left) * k); px++) if (d[(py * c.width + px) * 4] > 40) n++;
        return n;
      };
      let edge = 0;
      for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++)
        if (d[(py * c.width + px) * 4] > 40 && (px < 3 || py < 3 || px >= c.width - 3 || py >= c.height - 3)) edge++;
      return { ratio: a / b, tilt: t, box: [cx - hw, cy - hh, cx + hw, cy + hh], W: pb.width, H: pb.height, edge,
        text: { title: litIn('.hero-title'), sub: litIn('.hero-sub'), week: litIn('.hero-week'), stats: litIn('.stats') } };
    });
    expect(Math.abs(r.ratio / STANDARD_RATIO - 1)).toBeLessThan(0.03);
    expect(r.tilt).toBe(-0.46);
    const [left, top, right, bottom] = r.box;
    expect(left).toBeGreaterThan(0); expect(top).toBeGreaterThan(0);
    expect(right).toBeLessThan(r.W); expect(bottom).toBeLessThan(r.H);
    expect(r.edge).toBe(0); // not even the dust reaches the panel's edges
    expect(r.text).toMatchObject({ title: 0, sub: 0, week: 0 });
    expect(r.text.stats).toBeLessThan(20);
    await page.context().close();
  });

  it('keeps the phone ring as it was (fractions of the panel, not the desktop shape)', async () => {
    const page = await openSite(browser, '', { sand: true, width: 390, height: 844, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-sand') === 'still');
    const r = await page.evaluate(() => {
      const p = document.querySelector('.hero-panel')!, pb = p.getBoundingClientRect();
      const [cx, cy, a, b] = p.getAttribute('data-ring')!.split(' ').map(Number);
      return [cx / pb.width, cy / pb.height, a / pb.width, b / pb.height];
    });
    [0.52, 0.34, 0.33, 0.135].forEach((v, i) => expect(r[i]).toBeCloseTo(v, 3));
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

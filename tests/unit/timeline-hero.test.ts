import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';
import { TIMELINE } from './timeline-fixture';

// The homepage's timeline hero (public/timeline-hero.js, styles.css; markup src/wireframe.ts; prototype
// docs/prototypes/timeline-hero.html): one product's weekly wireframes drift left, each eases from the previous week's
// layout as it enters, the latest rests locked at the right end; the strip pauses off screen and under a pointer or
// focus, is still with reduced motion; frames name their week on hover and link to its digest; nothing shifts.

const mode = (page: Page) => page.locator('.hero-panel').getAttribute('data-timeline');
const nFrames = (page: Page, n: number) => page.evaluate((n) => new Promise<void>((done) => {
  let k = 0; const tick = () => (++k >= n ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick);
}), n);
const trackX = (page: Page) => page.locator('.tl-track').evaluate((t) => new DOMMatrix(getComputedStyle(t).transform).m41);

describe('timeline hero (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('starts with the latest week locked at the right end, then drifts left and loops with copies', async () => {
    // The strip's state when the script first places it (a mutation observer runs before the next frame), so a busy
    // machine that takes longer than the 1.5s hold to get here can't change what is measured.
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'no-preference', initScript: `
      new MutationObserver((_, obs) => {
        const t = document.querySelector('.tl-track');
        if (!t || !t.style.transform) return;
        obs.disconnect();
        const v = document.querySelector('.tl-view').getBoundingClientRect();
        const latest = document.querySelector('.tl-track > .tl-frame.is-latest:not([aria-hidden])');
        window.__rest = { gap: v.right - latest.querySelector('.tl-screen').getBoundingClientRect().right, locked: latest.classList.contains('is-locked'), x: new DOMMatrix(t.style.transform).m41 };
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });` });
    await page.waitForFunction(() => (window as unknown as { __rest?: unknown }).__rest);
    const atRest = await page.evaluate(() => (window as unknown as { __rest: { gap: number; locked: boolean; x: number } }).__rest);
    expect(atRest.locked).toBe(true);
    expect(atRest.gap).toBeGreaterThan(20); // the panel's right padding
    expect(atRest.gap).toBeLessThan(40);
    // Then it drifts left.
    await page.waitForFunction((x0) => new DOMMatrix(getComputedStyle(document.querySelector('.tl-track')!).transform).m41 < x0 - 10, atRest.x, { timeout: 10_000 });
    // Copies before and after are inert: keyboard and screen readers get the six real frames only.
    const r = await page.evaluate(() => ({
      all: document.querySelectorAll('.tl-frame').length,
      real: document.querySelectorAll('.tl-frame:not([aria-hidden])').length,
      copiesInert: [...document.querySelectorAll('.tl-frame[aria-hidden]')].every((a) => (a as HTMLElement).inert && (a as HTMLElement).tabIndex === -1),
    }));
    expect(r.real).toBe(6);
    expect(r.all % 6).toBe(0);
    expect(r.all).toBeGreaterThanOrEqual(18);
    expect(r.copiesInert).toBe(true);
    await page.context().close();
  });

  it('eases a moved message box from the previous week to its own as the frame enters', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'no-preference' });
    // Sample the message boxes of every copy of the fourth week (its box moved from y 400 to 300) for one whole loop
    // (six frames x 3s, after the 1.5s hold): that week enters from the right once in it.
    const ys = await page.evaluate(() => new Promise<number[]>((done) => {
      const seen = new Set<number>(); const t0 = performance.now();
      const tick = () => {
        document.querySelectorAll('.tl-frame[href$="2026-11-02"] .w-in').forEach((r) => seen.add(Math.round(+r.getAttribute('y')!)));
        performance.now() - t0 > 20000 ? done([...seen]) : requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    expect(ys).toContain(300);
    expect(ys).toContain(400);
    expect(ys.some((y) => y > 305 && y < 395)).toBe(true); // in between: it moves, it doesn't jump
    await page.context().close();
  }, 40_000);

  it('pauses off screen and in a hidden view, and runs again when back', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, height: 700, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'running');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'paused');
    const x = await trackX(page);
    await nFrames(page, 30);
    expect(await trackX(page)).toBe(x);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'running');
    await page.context().close();
  });

  it('is a still strip with reduced motion: no copies, the latest week locked at the right end', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'still');
    const r = await page.evaluate(() => {
      const latest = document.querySelector('.tl-frame.is-latest')!;
      return { frames: document.querySelectorAll('.tl-frame').length, transform: getComputedStyle(document.querySelector('.tl-track')!).transform,
        bracket: getComputedStyle(latest.querySelector('.tl-lock i')!).borderTopColor, label: getComputedStyle(latest.querySelector('.tl-label')!).color,
        border: getComputedStyle(latest.querySelector('.tl-screen')!).boxShadow };
    });
    expect(r.frames).toBe(6);
    expect(r.transform).toBe('none');
    expect(r.bracket).toBe('rgb(236, 138, 95)');
    expect(r.label).toBe('rgb(236, 138, 95)');
    expect(r.border).toContain('rgb(196, 76, 28)');
    await page.context().close();
  });

  it('names the week under a mouse, holds still meanwhile, and links to the weekly digest', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'running');
    const latest = page.locator('.tl-track > .tl-frame.is-latest:not([aria-hidden])');
    // The frame drifts, so hover() would wait for it to stop moving; move the mouse to where it is now instead.
    const box = (await latest.locator('.tl-screen').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => mode(page)).toBe('paused');
    await expect.poll(() => page.locator('.tl-tip').evaluate((t) => getComputedStyle(t).opacity)).toBe('1');
    expect(await page.locator('.tl-tip').textContent()).toBe('ChatGPT · Week of Nov 16, 2026');
    const x = await trackX(page);
    await nFrames(page, 20);
    expect(await trackX(page)).toBe(x);
    expect(await latest.getAttribute('href')).toBe('/weeks/2026-11-16');
    expect(await latest.getAttribute('aria-label')).toBe('ChatGPT · Week of Nov 16, 2026');
    expect(await latest.locator('.tl-label').textContent()).toBe('W15 · Nov 16');
    await page.mouse.move(5, 5);
    await expect.poll(() => mode(page)).toBe('running');
    await page.context().close();
  });

  it('is reachable by keyboard: a focused frame is brought into view and named', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'running');
    const first = page.locator('.tl-frame:not([aria-hidden])').first();
    await first.focus();
    await expect.poll(() => mode(page)).toBe('paused');
    const r = await page.evaluate(() => {
      const v = document.querySelector('.tl-view')!.getBoundingClientRect(), f = document.activeElement!.querySelector('.tl-screen')!.getBoundingClientRect();
      return { inside: f.left >= v.left && f.right <= v.right, tip: document.querySelector('.tl-tip')!.textContent, outline: getComputedStyle(document.activeElement!.querySelector('.tl-screen')!).outlineStyle };
    });
    expect(r).toEqual({ inside: true, tip: 'ChatGPT · Week of Oct 12, 2026', outline: 'solid' });
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('href'))).toBe('/weeks/2026-10-19');
    await page.context().close();
  });

  it('on phones sits between the stats and the title, three frames wide', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width: 390, height: 844, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'still');
    const r = await page.evaluate(() => {
      const b = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const v = b('.tl-view'), f = document.querySelector('.tl-frame')!.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(document.querySelector('.tl-track')!).columnGap);
      return { below: b('.tl-view').top >= b('.stats').bottom, above: b('.hero-timeline').bottom <= b('.hero-title').top,
        perView: (v.width - 36 + gap) / (f.width + gap) };
    });
    expect(r.below).toBe(true);
    expect(r.above).toBe(true);
    expect(r.perView).toBeCloseTo(3, 1);
    await page.context().close();
  });

  // The black panel has no dark inset around it: its edges are the filter bar's and the grid's; the strip stays off the type.
  it.each([[360, 740], [390, 844], [768, 1000], [1024, 900], [1280, 800], [1280, 900], [1440, 760], [1920, 1080]])('at %ix%ipx the panel lines up with the filter bar and the strip stays clear of the text', async (width, height) => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width, height, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'still');
    await page.waitForSelector('#grid > *');
    const r = await page.evaluate(() => {
      const x = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [b.left, b.right]; };
      const hits = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const screens = [...document.querySelectorAll('.tl-frame')].map((f) => f.getBoundingClientRect());
      const panel = document.querySelector('.hero-panel')!.getBoundingClientRect(), view = document.querySelector('.tl-view')!.getBoundingClientRect();
      const visible = screens.filter((s) => s.right > view.left + 56 && s.left < view.right);
      const overlaps = ['.hero-title', '.hero-sub', '.stats'].filter((s) => visible.some((f) => hits(f, document.querySelector(s)!.getBoundingClientRect())));
      return { panel: x('.hero-panel'), controls: x('.controls'), grid: x('#grid'), overlaps, inside: view.top >= panel.top && view.bottom <= panel.bottom, visible: visible.length };
    });
    expect(r.panel).toEqual(r.controls);
    expect(r.grid).toEqual(r.controls);
    expect(r.overlaps).toEqual([]);
    expect(r.inside).toBe(true);
    expect(r.visible).toBeGreaterThanOrEqual(2);
    await page.context().close();
  });

  it('still plays the keyword annotations, recoloured for the dark panel', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'no-preference' });
    await page.locator('.hero-sub.annot').waitFor({ state: 'attached', timeout: 5000 });
    const c = await page.evaluate(() => ({
      tag: getComputedStyle(document.querySelector('.hero-sub .kw-hier .tag')!).backgroundColor,
      orange: getComputedStyle(document.querySelector('.hero-sub .kw-layout .tag')!).backgroundColor,
      next: getComputedStyle(document.querySelector('.hero-sub em')!).color,
    }));
    expect(c).toEqual({ tag: 'rgb(242, 240, 236)', orange: 'rgb(196, 76, 28)', next: 'rgb(236, 138, 95)' });
    await page.context().close();
  });

  it('keeps the text on the dark panel, the week labels included, at WCAG AA contrast', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelectorAll('[data-stat][data-counted]').length === 3);
    const ratios = await page.evaluate(() => {
      const bg = [11, 11, 12];
      const lum = (c: number[]) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
      const ratio = (sel: string) => {
        const m = getComputedStyle(document.querySelector(sel)!).color.match(/[\d.]+/g)!.map(Number);
        const a = m[3] ?? 1, fg = [0, 1, 2].map((i) => m[i] * a + bg[i] * (1 - a));
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
      };
      return Object.fromEntries(['.stat dt', '.stat dd', '.hero-sub', '.hero-sub em', '.hero-title', '.tl-frame .tl-label', '.tl-frame.is-latest .tl-label']
        .map((s) => [s, ratio(s)]));
    });
    for (const [sel, r] of Object.entries(ratios)) expect(r, sel).toBeGreaterThanOrEqual(4.5);
    await page.context().close();
  });

  it.each([[390], [768], [1024], [1280], [1440]])('at %ipx loads without shifting anything in the hero', async (width) => {
    const page = await openSite(browser, '', {
      timeline: TIMELINE, width, statsDelay: 300, stats: { screenshots: 157, portals: 15, weeks: 11 }, reducedMotion: 'no-preference',
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

describe('hero copy lined up with the timeline (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  /** Where the title's last baseline and the frames' bottom edge are, the gap from title to sub, and the copy's room. */
  const measure = (page: Page) => page.evaluate(() => {
    const b = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const layer = document.querySelector('.hero-layer')!, pb = parseFloat(getComputedStyle(layer).paddingBottom);
    const p = b('.hero-panel'), c = b('.hero-copy'), s = b('.stats');
    return { baseline: b('.title-base').bottom, frames: b('.tl-track > .tl-frame:not([aria-hidden]) .tl-screen').bottom,
      gap: b('.hero-sub').top - b('.hero-title').bottom, inside: c.bottom <= b('.hero-layer').bottom - pb + 0.5,
      clear: c.top >= s.bottom || c.right <= s.left, above: s.top - p.top, below: p.bottom - c.bottom, phone: innerWidth <= 760,
      week: document.querySelector('.hero-week, #heroWeek') === null };
  });

  // Desktop and tablet: the baseline of "Library" sits on the frames' bottom edge, measured, at every width and on
  // short desktop screens; the sub keeps its 18px gap and the copy stays inside the panel and clear of the stats.
  it.each([[768, 1000], [1024, 900], [1180, 900], [1280, 800], [1280, 640], [1440, 900], [1440, 760], [1920, 1080]])('at %ix%ipx the title\'s last baseline is on the frames\' bottom edge', async (width, height) => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width, height, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'still');
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => { const r = await measure(page); return Math.abs(r.baseline - r.frames); }).toBeLessThanOrEqual(2);
    const r = await measure(page);
    expect(r.week).toBe(true);
    expect(r.gap).toBeCloseTo(18, 0);
    expect(r.inside).toBe(true);
    expect(r.clear).toBe(true);
    await page.context().close();
  });

  it('stays lined up while the title rises in, and after a resize', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width: 1280, height: 800, reducedMotion: 'no-preference' });
    await page.evaluate(() => document.fonts.ready);
    // The title's lines rise into place over .8s; once they are there the baseline is on the frames' edge.
    await page.waitForTimeout(1200);
    let r = await measure(page);
    expect(Math.abs(r.baseline - r.frames)).toBeLessThanOrEqual(2);
    for (const [w, h] of [[1024, 900], [1920, 1080], [1440, 760]]) {
      await page.setViewportSize({ width: w, height: h });
      await expect.poll(async () => { r = await measure(page); return Math.abs(r.baseline - r.frames); }).toBeLessThanOrEqual(2);
    }
    // Down to a phone: the stacked layout, with no drop.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator('.hero-copy').evaluate((c) => (c as HTMLElement).style.transform)).toBe('');
    await page.context().close();
  });

  // Phones: stats, timeline and copy are one group with equal room above and below.
  it.each([[360, 740], [390, 844]])('at %ix%ipx keeps the stacked phone layout centred', async (width, height) => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width, height, reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'still');
    const r = await measure(page);
    expect(r.phone).toBe(true);
    expect(r.clear).toBe(true);
    expect(Math.abs(r.above - r.below)).toBeLessThan(4);
    expect(await page.locator('.hero-copy').evaluate((c) => getComputedStyle(c).transform)).toBe('none');
    await page.context().close();
  });
});

describe('timeline speed by screen size (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  /** Milliseconds per frame of drift, from the strip's real movement over about 1.5s (the loop's wrap jumps ignored). */
  const msPerFrame = (page: Page) => page.evaluate(() => new Promise<number>((done) => {
    const track = document.querySelector('.tl-track')!, real = [...track.querySelectorAll(':scope > .tl-frame:not([aria-hidden])')] as HTMLElement[];
    const pitch = real[1].offsetLeft - real[0].offsetLeft;
    const xNow = () => new DOMMatrix(getComputedStyle(track).transform).m41;
    let prev = xNow(), moved = 0; const t0 = performance.now();
    const tick = () => {
      const x = xNow(); if (x < prev) moved += prev - x; prev = x;
      const dt = performance.now() - t0;
      dt > 1500 ? done(dt / (moved / pitch)) : requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const running = (page: Page) => page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'running');

  it.each([[1280, 800, 3000], [1024, 900, 4500], [768, 1000, 4500], [390, 844, 5000]])('at %ix%ipx a frame takes %ims', async (width, height, ms) => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width, height, reducedMotion: 'no-preference', ...(width <= 760 ? { hasTouch: true, isMobile: true } : {}) });
    await running(page);
    await page.waitForTimeout(1700); // past the 1.5s hold at rest
    expect(await page.locator('.hero-panel').getAttribute('data-timeline-period')).toBe(String(ms));
    const measured = await msPerFrame(page);
    expect(measured).toBeGreaterThan(ms * 0.88);
    expect(measured).toBeLessThan(ms * 1.12);
    await page.context().close();
  });

  it('changes speed on resize, keeps its place in the loop, and reduced motion still stands still', async () => {
    const page = await openSite(browser, '', { timeline: TIMELINE, width: 1280, height: 800, reducedMotion: 'no-preference' });
    await running(page);
    await page.waitForTimeout(1700);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(() => page.locator('.hero-panel').getAttribute('data-timeline-period')).toBe('4500');
    await page.waitForFunction(() => document.querySelector('.hero-panel')?.getAttribute('data-timeline') === 'running');
    const m = await msPerFrame(page);
    expect(m).toBeGreaterThan(4500 * 0.88);
    expect(m).toBeLessThan(4500 * 1.12);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.locator('.hero-panel').getAttribute('data-timeline-period')).toBe('3000');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => mode(page)).toBe('still');
    expect(await page.locator('.tl-track').evaluate((t) => getComputedStyle(t).transform)).toBe('none');
    await page.context().close();
  });
});

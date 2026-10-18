import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { WEEKS, openAnalytics, openSite, pauseClock, showCanvas } from './analytics-page';

// Shareable Compare links (public/analytics-share.js): a canvas set up in one browser opens the same
// in a fresh one, from the URL alone.

const KEY = `anCanvas:v1:weeks:chatgpt:${[WEEKS[0], WEEKS[1]].sort().join(',')}`;

/** What the board shows: cards with world positions, lines with their findings, and the zoom. */
const boardState = (page: Page) => page.evaluate(() => {
  const xy = (el: Element) => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec((el as HTMLElement).style.transform)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const world = document.querySelector<HTMLElement>('.anc-world')!.style.transform;
  return {
    cards: [...document.querySelectorAll('.anc-card')].map((el) => ({ id: (el as HTMLElement).dataset.id!, ...xy(el) })),
    boxes: [...document.querySelectorAll('.anc-board .anc-box')].map((el) => ({
      head: el.querySelector('.anc-box-head span')!.textContent,
      lines: [...el.querySelectorAll('li')].map((li) => li.textContent),
    })),
    edges: document.querySelectorAll('.anc-edge').length,
    k: Number(/scale\(([-\d.]+)\)/.exec(world)![1]),
    pct: document.querySelector('.anc-zoom-pct')!.textContent,
  };
});
const cardIds = (page: Page) => page.locator('.anc-card').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.id));

async function center(page: Page, sel: string) {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
/** Ctrl + wheel on the board until the zoom is `k`. */
async function zoomTo(page: Page, k: number) {
  for (let i = 0; i < 10; i++) {
    const done = await page.evaluate((target) => {
      const board = document.querySelector('.anc-board')!;
      const now = Number(/scale\(([-\d.]+)\)/.exec(document.querySelector<HTMLElement>('.anc-world')!.style.transform)![1]);
      if (Math.abs(now - target) < 0.0005) return true;
      const dy = Math.max(-50, Math.min(50, -Math.log(target / now) / 0.006));
      const r = board.getBoundingClientRect();
      board.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      return false;
    }, k);
    if (done) return;
  }
  throw new Error('zoom did not settle');
}

describe('shareable Compare links (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('defaults to the latest 2 weeks with no parameters, in Canvas and Table', async () => {
    const page = await openSite(browser, '#compare');
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(page.url()).toBe('https://site.test/#compare');
    await page.locator('[data-mode="weeks"]').click();
    await page.locator(`#anCanvasWrap .anc-card[data-id="${WEEKS[1]}"] img`).waitFor();
    expect(await page.locator('#anCount').textContent()).toBe('2 of 4 selected');
    expect(await cardIds(page)).toEqual([WEEKS[0], WEEKS[1]]);
    await page.locator('[data-anview="table"]').click();
    await page.locator('#anTableWrap .an-table').waitFor();
    expect(await page.locator('#anTableWrap .an-colhead').count()).toBe(2);
  });

  it('a link opens the same Over time canvas in a fresh browser, and never touches its saved layout', async () => {
    const page = await openAnalytics(browser, { clipboard: true });
    const historyLength = await page.evaluate(() => history.length);
    await page.locator('[data-mode="weeks"]').click();
    await showCanvas(page);
    await page.locator('.anc-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));

    // Move the newest card down and right.
    const head = await center(page, `.anc-card[data-id="${WEEKS[0]}"] .anc-card-head`);
    await drag(page, head, { x: head.x + 140, y: head.y + 90 });
    // Replace the default line with one drawn the other way: older week → newest week.
    await page.locator('.anc-board .anc-box-x').click();
    expect(await page.locator('.anc-board .anc-box').count()).toBe(0);
    await drag(page, await center(page, `.anc-card[data-id="${WEEKS[1]}"] .anc-handle--out`), await center(page, `.anc-card[data-id="${WEEKS[0]}"] .anc-card-head`));
    await zoomTo(page, 1.28);
    await page.waitForTimeout(400); // the URL follows ~300ms after the last change

    const before = await boardState(page);
    expect(before.cards[0]).toMatchObject({ id: WEEKS[0] });
    expect(before.cards[0].y).toBeGreaterThan(50); // moved off the default row
    expect(before.pct).toBe('128%');
    expect(before.edges).toBe(1);
    expect(before.boxes).toHaveLength(1);
    expect(before.boxes[0].head).toBe('Sep 21, 2026 → Sep 28, 2026');

    const url = page.url();
    expect(url).toMatch(/^https:\/\/site\.test\/#compare\?view=canvas&mode=time&portal=chatgpt&weeks=2026-09-28,2026-09-21&device=desktop&zoom=1\.28&pan=-?\d+,-?\d+&layout=[A-Za-z0-9_-]+$/);
    expect(await page.evaluate(() => history.length)).toBe(historyLength); // replaceState only

    // Copy link copies that URL and says so for 2 seconds.
    await page.locator('#anShare').click();
    await expect.poll(() => page.locator('#anShare .anc-share-label').textContent()).toBe('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await page.waitForTimeout(2100);
    expect(await page.locator('#anShare .anc-share-label').textContent()).toBe('Copy link');

    // A fresh browser (empty localStorage) opening the link.
    const hash = new URL(url).hash;
    const fresh = await openSite(browser, hash);
    await fresh.locator('#anCanvasWrap .anc-card img').first().waitFor();
    const after = await boardState(fresh);
    expect(await fresh.locator('.an-mode [data-mode="weeks"]').getAttribute('aria-pressed')).toBe('true');
    expect(await fresh.locator('.an-view [data-anview="canvas"]').getAttribute('aria-pressed')).toBe('true');
    expect(await fresh.locator('#anCount').textContent()).toBe('2 of 4 selected');
    expect(after.cards.map((c) => c.id)).toEqual([WEEKS[0], WEEKS[1]]);
    for (const [i, c] of after.cards.entries()) {
      expect(Math.abs(c.x - before.cards[i].x)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.y - before.cards[i].y)).toBeLessThanOrEqual(2);
    }
    expect(after.edges).toBe(1);
    expect(after.boxes).toEqual(before.boxes);
    expect(after.pct).toBe('128%');
    expect(after.k).toBeCloseTo(1.28, 2);
    expect(await fresh.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull(); // nothing saved until they change something
    expect(await fresh.evaluate(() => scrollY)).toBe(0);

    // A viewer with their own saved layout sees the link's layout, and keeps their own saved one.
    const own = JSON.stringify({ pos: { [WEEKS[0]]: { x: 0, y: 900 }, [WEEKS[1]]: { x: 900, y: 900 } }, edges: [], cam: { x: 0, y: 0, k: 0.5 } });
    const viewer = await openSite(browser, hash, { storage: { [KEY]: own } });
    await viewer.locator('#anCanvasWrap .anc-card img').first().waitFor();
    const seen = await boardState(viewer);
    expect(seen.cards).toEqual(after.cards);
    expect(seen.pct).toBe('128%');
    expect(await viewer.evaluate((k) => localStorage.getItem(k), KEY)).toBe(own);
    // Their first change saves the link's setup as theirs.
    await viewer.locator('[data-zoom="in"]').click();
    const saved = JSON.parse((await viewer.evaluate((k) => localStorage.getItem(k), KEY))!);
    expect(saved.edges).toEqual([[WEEKS[1], WEEKS[0]]]);
    expect(saved.pos[WEEKS[0]]).toEqual({ x: after.cards[0].x, y: after.cards[0].y });
  });

  it('changing the URL does not re-render or scroll, and leaving Compare before the update keeps the new hash', async () => {
    // Fake timers: the URL update (300ms after a change) runs only when the test moves the clock on.
    const page = await openAnalytics(browser, { clock: true });
    await page.waitForFunction(() => location.hash.includes('view=table')); // the switch to Table has been written to the URL
    await pauseClock(page);
    await page.locator('#analyticsView [data-andevice="mobile"]').click();
    await page.locator('#anTableWrap .an-shot--mobile').first().waitFor();
    // Scroll before the URL update runs.
    await page.evaluate(() => window.scrollTo(0, 200));
    const table = await page.locator('#anTableWrap .an-table').elementHandle();
    await page.clock.runFor(299);
    expect(page.url()).not.toContain('device=mobile');
    await page.clock.runFor(1);
    expect(page.url()).toBe('https://site.test/#compare?view=table&mode=portals&week=2026-09-28&portals=chatgpt,claude&device=mobile');
    expect(await page.evaluate(() => scrollY)).toBe(200);
    expect(await table!.evaluate((el) => el.isConnected)).toBe(true); // not re-rendered

    // Leave for Notes while the update for this change is still pending: it must not overwrite #notes.
    await page.locator('#analyticsView [data-andevice="desktop"]').click();
    await page.locator('.topnav-link[data-nav="insights"], a[href="#notes"]').first().click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notes');
    await page.clock.runFor(400);
    expect(new URL(page.url()).hash).toBe('#notes');
  });

  it('a link with unknown values falls back to defaults', async () => {
    const page = await openSite(browser, '#compare?view=canvas&mode=time&portal=nope&weeks=1999-01-01,<b>x</b>&zoom=99&layout=%%%');
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(await cardIds(page)).toEqual([WEEKS[0], WEEKS[1]]);
    expect(await page.locator('#anPortals .chip[aria-selected="true"]').allTextContents()).toEqual(['ChatGPT']);
    expect((await boardState(page)).pct).toBe('200%');
    expect(await page.locator('.anc-board .anc-box').count()).toBe(1); // default line
    expect(await page.locator('#analyticsView b').count()).toBe(0);
  });
});

describe('Copy link in Table and Canvas (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const OCT = ['2026-10-12', ...WEEKS];
  const ORIGIN = 'https://site.test/';
  const label = (page: Page) => page.locator('#anShare .anc-share-label').textContent();
  const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const copy = async (page: Page) => {
    await page.locator('#anShare').click();
    await expect.poll(() => label(page)).toBe('Link copied');
    return clipboard(page);
  };

  it('in Table, copies the table setup, and the link opens the same Table', async () => {
    const page = await openSite(browser, '#compare', { clipboard: true, weeks: OCT });
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    await page.locator('[data-anview="table"]').click();
    await page.locator('#anTableWrap .an-table').waitFor();
    const url = await copy(page);
    expect(url).toBe(`${ORIGIN}#compare?view=table&mode=portals&week=2026-10-12&portals=chatgpt,claude&device=desktop`);
    expect(page.url()).toBe(url);

    const fresh = await openSite(browser, new URL(url).hash, { weeks: OCT });
    await fresh.locator('#anTableWrap .an-table').waitFor();
    expect(await fresh.locator('.an-view [data-anview="table"]').getAttribute('aria-pressed')).toBe('true');
    expect(await fresh.locator('.an-mode [data-mode="portals"]').getAttribute('aria-pressed')).toBe('true');
    expect(await fresh.locator('.an-device [data-andevice="desktop"]').getAttribute('aria-pressed')).toBe('true');
    expect(await fresh.locator('#anWeek .an-wp-current').textContent()).toBe('Oct 12, 2026');
    expect(await fresh.locator('#anPortals .chip[aria-selected="true"]').allTextContents()).toEqual(['ChatGPT', 'Claude']);
    expect(await fresh.locator('#anTableWrap .an-colhead').allTextContents()).toEqual(['ChatGPT', 'Claude']);
  });

  it('a change copied right away (within 300ms) is in the link, in Table and in Canvas', async () => {
    // Fake timers, paused: the 300ms URL update can't run between the change and Copy link, whatever the machine's speed.
    const page = await openSite(browser, '#compare', { clipboard: true, weeks: OCT, clock: true });
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    await page.locator('[data-anview="table"]').click();
    await page.locator('#anTableWrap .an-table').waitFor();
    await page.waitForFunction(() => location.hash.includes('view=table'));

    await pauseClock(page);
    await page.locator('#analyticsView [data-andevice="mobile"]').click();
    await page.locator('#anShare').click();
    await expect.poll(() => label(page)).toBe('Link copied');
    expect(await clipboard(page)).toBe(`${ORIGIN}#compare?view=table&mode=portals&week=2026-10-12&portals=chatgpt,claude&device=mobile`);
    await page.clock.resume();

    await page.locator('#analyticsView [data-andevice="desktop"]').click();
    await page.locator('[data-anview="canvas"]').click();
    await page.locator('#anCanvasWrap .anc-board .anc-card img').first().waitFor();
    await page.waitForFunction(() => location.hash.includes('view=canvas') && location.hash.includes('device=desktop'));
    await pauseClock(page);
    await page.locator('[data-zoom="in"]').click();
    await page.locator('#anShare').click();
    await expect.poll(() => clipboard(page)).toContain('&zoom=1.63&');
    expect(await page.locator('.anc-zoom-pct').textContent()).toBe('163%');
  });

  it.each([[1280], [390]])('at %ipx Copy link is visible at the right end of the Table/Canvas row in both views', async (width) => {
    const page = await openSite(browser, '#compare', { width });
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    const place = () => page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const bar = r('#analyticsView .an-resultsbar'), view = r('#analyticsView .an-view'), share = r('#anShare');
      return { right: Math.round(bar.right - share.right), sameRow: Math.abs(view.top - share.top) < 1, inView: share.left >= 0 && share.right <= innerWidth };
    });
    expect(await page.locator('#anShare').isVisible()).toBe(true);
    expect(await place()).toEqual({ right: 0, sameRow: true, inView: true });
    await page.locator('[data-anview="table"]').click();
    await page.locator('#anTableWrap .an-table').waitFor();
    expect(await page.locator('#anShare').isVisible()).toBe(true);
    expect(await page.locator('#anCanvasTools').isVisible()).toBe(false);
    expect(await place()).toEqual({ right: 0, sameRow: true, inView: true });
  });
});

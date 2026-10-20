import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { WEEKS, openAnalytics, openSite, showCanvas } from './analytics-page';

// Analytics canvas (public/analytics-canvas.js): a line's findings box can be dragged. Its place is kept as an
// offset from the line's midpoint, so it follows the line when a card moves, and it is saved and shared
// like card positions.

const KEY = `anCanvas:v1:portals:${WEEKS[0]}:chatgpt,claude`;
const LINE = 'chatgpt\u0000claude';
const BOX = '.anc-board .anc-box';

/** The box's centre minus the line's midpoint (the cubic at t = 0.5), in world pixels. */
const boxOffset = (page: Page) => page.evaluate(() => {
  const box = document.querySelector<HTMLElement>('.anc-board .anc-box')!;
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(box.style.transform)!;
  const n = document.querySelector('.anc-edge')!.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number);
  const mid = [0, 1].map((i) => (n[i] + 3 * n[2 + i] + 3 * n[4 + i] + n[6 + i]) / 8);
  return { dx: Number(m[1]) - mid[0], dy: Number(m[2]) - mid[1] };
});
const zoom = (page: Page) => page.evaluate(() => Number(/scale\(([-\d.]+)\)/.exec(document.querySelector<HTMLElement>('.anc-world')!.style.transform)![1]));

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
/** A point on the box's findings, away from its × button. */
const boxBody = (page: Page) => center(page, `${BOX} .anc-box-list`);

describe('analytics canvas findings box drag (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  async function openCanvas(opts: Parameters<typeof openSite>[2] = {}): Promise<Page> {
    const page = await openAnalytics(browser, opts);
    await showCanvas(page);
    await page.locator('.anc-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    return page;
  }
  /** Drag the box by (sx, sy) screen pixels; returns the expected offset in world pixels. */
  async function dragBox(page: Page, sx: number, sy: number) {
    const k = await zoom(page);
    const from = await boxBody(page);
    await drag(page, from, { x: from.x + sx, y: from.y + sy });
    return { dx: sx / k, dy: sy / k };
  }
  const near = (a: { dx: number; dy: number }, b: { dx: number; dy: number }, tol = 1.5) => {
    expect(Math.abs(a.dx - b.dx)).toBeLessThanOrEqual(tol);
    expect(Math.abs(a.dy - b.dy)).toBeLessThanOrEqual(tol);
  };

  it('looks like a card: grab cursor, and the dragging look while it moves', async () => {
    const page = await openCanvas();
    expect(await page.locator(BOX).evaluate((el) => getComputedStyle(el).cursor)).toBe('grab');
    const from = await boxBody(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 40, { steps: 4 });
    expect(await page.locator(BOX).evaluate((el) => [el.classList.contains('is-dragging'), getComputedStyle(el).cursor])).toEqual([true, 'grabbing']);
    await page.mouse.up();
    expect(await page.locator(BOX).evaluate((el) => el.classList.contains('is-dragging'))).toBe(false);
  });

  it('dragging moves the box, and it keeps its offset from the line when a card is dragged', async () => {
    const page = await openCanvas();
    near(await boxOffset(page), { dx: 0, dy: 0 }, 0.01);
    const want = await dragBox(page, 60, 140);
    near(await boxOffset(page), want);

    const boxBefore = (await page.locator(BOX).boundingBox())!;
    const head = await center(page, '.anc-card[data-id="claude"] .anc-card-head');
    await drag(page, head, { x: head.x + 120, y: head.y + 80 });
    const boxAfter = (await page.locator(BOX).boundingBox())!;
    expect(boxAfter.y).toBeGreaterThan(boxBefore.y + 20); // followed the line
    near(await boxOffset(page), want);
  });

  it('a click without movement selects the line, and × removes it', async () => {
    const page = await openCanvas();
    const before = await page.locator(BOX).evaluate((el) => (el as HTMLElement).style.transform);
    const p = await boxBody(page);
    await page.mouse.click(p.x, p.y);
    expect(await page.locator(BOX).evaluate((el) => el.classList.contains('is-selected'))).toBe(true);
    expect(await page.locator('.anc-edge').evaluate((el) => el.classList.contains('is-selected'))).toBe(true);
    expect(await page.locator(BOX).evaluate((el) => (el as HTMLElement).style.transform)).toBe(before);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull(); // nothing changed, nothing saved

    await page.locator(`${BOX} .anc-box-x`).click();
    expect(await page.locator(BOX).count()).toBe(0);
    expect(await page.locator('.anc-edge').count()).toBe(0);
    const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
    expect(saved.edges).toEqual([]);
    expect(saved.offsets).toEqual({});
  });

  it('removing a moved box drops its offset, so drawing the line again puts the box at the midpoint', async () => {
    const page = await openCanvas();
    await dragBox(page, 0, 120);
    await page.locator(`${BOX} .anc-box-x`).click();
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!).offsets).toEqual({});
    await drag(page, await center(page, '.anc-card[data-id="chatgpt"] .anc-handle--out'), await center(page, '.anc-card[data-id="claude"] .anc-card-head'));
    expect(await page.locator(BOX).count()).toBe(1);
    near(await boxOffset(page), { dx: 0, dy: 0 }, 0.01);
  });

  it('the offset survives a reload', async () => {
    const page = await openCanvas();
    const want = await dragBox(page, -40, 130);
    const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
    near(saved.offsets[LINE], want);
    expect(Number.isInteger(saved.offsets[LINE].dx) && Number.isInteger(saved.offsets[LINE].dy)).toBe(true);
    await page.reload();
    await page.locator('#anCanvasWrap .anc-board .anc-card img').first().waitFor();
    near(await boxOffset(page), want);
  });

  it('a shared link opens with the box where it was moved, and saves nothing until a change', async () => {
    const page = await openCanvas();
    const want = await dragBox(page, 80, 150);
    await page.waitForTimeout(400); // the URL follows ~300ms after the last change
    const hash = new URL(page.url()).hash;
    expect(hash).toContain('&layout=');

    const fresh = await openSite(browser, hash);
    await fresh.locator('#anCanvasWrap .anc-board .anc-card img').first().waitFor();
    near(await boxOffset(fresh), want, 2);
    expect(await fresh.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    await fresh.locator('[data-zoom="in"]').click(); // the first change saves the link's setup, offsets too
    near(JSON.parse((await fresh.evaluate((k) => localStorage.getItem(k), KEY))!).offsets[LINE], want, 2);
  });

  it('an old link without offsets opens with the box at the midpoint', async () => {
    const layout = btoa(JSON.stringify({ p: [['chatgpt', 0, 0], ['claude', 560, 120]], e: [[0, 1]] })).replace(/=+$/, '');
    const page = await openSite(browser, `#compare?view=canvas&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude&device=desktop&layout=${layout}`);
    await page.locator('#anCanvasWrap .anc-board .anc-card img').first().waitFor();
    expect(await page.locator(BOX).count()).toBe(1);
    near(await boxOffset(page), { dx: 0, dy: 0 }, 0.01);
  });

  it('a saved offset with bad values is ignored', async () => {
    const own = JSON.stringify({ pos: {}, edges: [['chatgpt', 'claude']], offsets: { [LINE]: { dx: 'x', dy: 5 }, other: { dx: 1, dy: 1 } } });
    const page = await openCanvas({ storage: { [KEY]: own } });
    near(await boxOffset(page), { dx: 0, dy: 0 }, 0.01);
  });

  it('reset puts the box back at the midpoint', async () => {
    const page = await openCanvas();
    await dragBox(page, 50, 140);
    await page.locator('[data-reset]').click();
    near(await boxOffset(page), { dx: 0, dy: 0 }, 0.01);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    await page.reload();
    await page.locator('#anCanvasWrap .anc-board .anc-card img').first().waitFor();
    near(await boxOffset(page), { dx: 0, dy: 0 }, 0.01);
  });

  it('Fit includes a moved box', async () => {
    const page = await openCanvas();
    await dragBox(page, 0, 300);
    await dragBox(page, 0, 300);
    await page.locator('[data-zoom="fit"]').click();
    expect(await page.evaluate(() => {
      const b = document.querySelector('.anc-board')!.getBoundingClientRect();
      const r = document.querySelector('.anc-board .anc-box')!.getBoundingClientRect();
      return r.top >= b.top && r.bottom <= b.bottom && r.left >= b.left && r.right <= b.right;
    })).toBe(true);
  });

  it('the default 136% view includes a box moved above the cards', async () => {
    const page = await openCanvas();
    await dragBox(page, 0, -220);
    const saved = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
    expect(saved.offsets[LINE].dy).toBeLessThan(-150);
    // Opened again without a saved camera: the top of everything, here the box, sits TOP_PAD (32px) below the board's top.
    const fresh = await openCanvas({ storage: { [KEY]: JSON.stringify({ pos: saved.pos, edges: saved.edges, offsets: saved.offsets }) } });
    expect(await zoom(fresh)).toBeCloseTo(1.36, 2);
    const top = await fresh.evaluate(() => {
      const b = document.querySelector('.anc-board')!.getBoundingClientRect();
      return Math.round(document.querySelector('.anc-board .anc-box')!.getBoundingClientRect().top - b.top);
    });
    expect(top).toBe(32);
  });
});

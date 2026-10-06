import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, showCanvas } from './analytics-page';

// Analytics canvas (public/analytics-canvas.js): a click on a card's screenshot opens the lightbox,
// while a press that travels a few pixels drags the card instead.

describe('analytics canvas thumbnail click (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  async function openCanvas(opts: { hasTouch?: boolean } = {}): Promise<Page> {
    const page = await openAnalytics(browser, opts);
    await showCanvas(page);
    await page.locator('.anc-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    return page;
  }
  async function thumbCenter(page: Page) {
    const box = (await page.locator('.anc-card[data-id="chatgpt"] .anc-thumb').boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const cardX = (page: Page) => page.locator('.anc-card[data-id="chatgpt"]').evaluate((el) => (el as HTMLElement).style.transform);
  const lightboxOpen = (page: Page) => page.locator('.lb').evaluate((el) => !(el as HTMLElement).hidden);

  it('shows the zoom-in cursor over the screenshot', async () => {
    const page = await openCanvas();
    const { x, y } = await thumbCenter(page);
    const cursor = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, [x, y]);
    expect(cursor).toBe('zoom-in');
  });

  it('a mouse click opens the lightbox with that screenshot', async () => {
    const page = await openCanvas();
    const before = await cardX(page);
    const { x, y } = await thumbCenter(page);
    await page.mouse.click(x, y);
    expect(await lightboxOpen(page)).toBe(true);
    expect(await page.locator('.lb-img').getAttribute('src')).toBe('/img/shots/2026-09-28/chatgpt.png?v=1');
    expect(await cardX(page)).toBe(before);
  });

  it('a click with a pixel or two of jitter is still a click', async () => {
    const page = await openCanvas();
    const before = await cardX(page);
    const { x, y } = await thumbCenter(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 1);
    await page.mouse.up();
    expect(await lightboxOpen(page)).toBe(true);
    expect(await cardX(page)).toBe(before);
  });

  it('a tap opens the lightbox', async () => {
    const page = await openCanvas({ hasTouch: true });
    const { x, y } = await thumbCenter(page);
    await page.touchscreen.tap(x, y);
    expect(await lightboxOpen(page)).toBe(true);
  });

  it('a drag of a few pixels moves the card and its line, and does not open the lightbox', async () => {
    const page = await openCanvas();
    const before = await cardX(page);
    const line = await page.locator('.anc-edge').getAttribute('d');
    const { x, y } = await thumbCenter(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y + 3);
    await page.mouse.move(x + 6, y + 4);
    await page.mouse.up();
    expect(await cardX(page)).not.toBe(before);
    expect(await page.locator('.anc-edge').getAttribute('d')).not.toBe(line);
    expect(await lightboxOpen(page)).toBe(false);
  });

  it('a long drag that ends over another screenshot does not open the lightbox', async () => {
    const page = await openCanvas();
    const { x, y } = await thumbCenter(page);
    const other = (await page.locator('.anc-card[data-id="claude"] .anc-thumb').boundingBox())!;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(other.x + 20, other.y + 20, { steps: 8 });
    await page.mouse.up();
    expect(await lightboxOpen(page)).toBe(false);
  });
});

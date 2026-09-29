import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

// The floating voice guide button (public/voice.js): a round, icon-only button named by its
// aria-label, with a tooltip that repeats the name on hover and keyboard focus.
// The banner lift is covered in consent.test.ts.

const PUBLIC = new URL('../../public/', import.meta.url);
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8').replace('<html lang="en"', '<html data-consent="not-required" lang="en"');
const VOICE_JS = readFileSync(new URL('voice.js', PUBLIC), 'utf8');

describe('voice guide button (source)', () => {
  it('is icon-only with an inline SVG, no text label and no dot', () => {
    expect(VOICE_JS).toContain('fab.setAttribute("aria-label", "Talk to the library");');
    expect(VOICE_JS).not.toContain('vf-dot');
    expect(VOICE_JS).toMatch(/fab\.innerHTML = `<svg [^`]*aria-hidden="true"[^`]*<\/svg><span class="vf-tip" aria-hidden="true">Talk to the library<\/span>`;/);
    expect(VOICE_JS).not.toMatch(/<link[^>]+icon|import .*icon/i); // no icon library
  });
});

describe('voice guide button (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  async function open(width: number): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== 'site.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: INDEX_HTML });
      if (url.pathname === '/app.js' || url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' });
      try { return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(new URL(`.${url.pathname}`, PUBLIC)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await context.routeWebSocket(/\/agents\//, (ws) => ws.close());
    const page = await context.newPage();
    await page.goto('https://site.test/');
    await page.waitForLoadState('load');
    return page;
  }
  const tipVisible = (p: Page) => p.locator('.voice-fab .vf-tip').evaluate((el) => getComputedStyle(el).visibility === 'visible');
  const settle = (p: Page) => p.waitForTimeout(200); // tooltip fade

  it.each([[390], [1280]])('at %ipx: a 52px orange circle in the bottom-right corner, 22px from the edges', async (width) => {
    const page = await open(width);
    const fab = page.getByRole('button', { name: 'Talk to the library' });
    const box = (await fab.boundingBox())!;
    expect(box.width).toBe(52);
    expect(box.height).toBe(52);
    expect(box.x + box.width).toBeCloseTo(width - 22, 0);
    expect(box.y + box.height).toBeCloseTo(800 - 22, 0);
    const style = await fab.evaluate((el) => {
      const s = getComputedStyle(el);
      return { radius: s.borderRadius, bg: s.backgroundColor, text: el.textContent?.trim(), svg: !!el.querySelector('svg') };
    });
    expect(style.radius).toBe('50%');
    expect(style.bg).toMatch(/^rgb\(/);
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.svg).toBe(true);
    expect(style.text).toBe('Talk to the library'); // only the (aria-hidden) tooltip text
    await page.context().close();
  });

  it('shows the tooltip on hover and hides it when the pointer leaves', async () => {
    const page = await open(1280);
    expect(await tipVisible(page)).toBe(false);
    await page.locator('.voice-fab').hover();
    await settle(page);
    expect(await tipVisible(page)).toBe(true);
    // The tooltip sits to the left of the button, fully on screen.
    const tip = (await page.locator('.vf-tip').boundingBox())!;
    const fab = (await page.locator('.voice-fab').boundingBox())!;
    expect(tip.x + tip.width).toBeLessThanOrEqual(fab.x);
    expect(tip.x).toBeGreaterThan(0);
    await page.mouse.move(10, 10);
    await settle(page);
    expect(await tipVisible(page)).toBe(false);
    await page.context().close();
  });

  it('shows the tooltip on keyboard focus, and Escape dismisses it', async () => {
    const page = await open(390);
    await page.keyboard.press('Shift'); // last input is the keyboard, so focus is :focus-visible
    await page.locator('.voice-fab').focus();
    await settle(page);
    expect(await page.locator('.voice-fab').evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    expect(await tipVisible(page)).toBe(true);
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await tipVisible(page)).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.className)).toContain('voice-fab'); // focus stays
    await page.context().close();
  });

  it('opens the voice guide panel when clicked', async () => {
    const page = await open(1280);
    await page.getByRole('button', { name: 'Talk to the library' }).click();
    await expect.poll(() => page.locator('.voice-panel.open').count()).toBe(1);
    expect(await page.locator('.voice-fab').isVisible()).toBe(false);
    await page.context().close();
  });
});

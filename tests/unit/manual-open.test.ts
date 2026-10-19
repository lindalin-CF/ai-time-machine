import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';

// The "…" button at the end of each gallery card footer (.manual-open in public/app.js) opens the
// Manual observations modal. It is an icon-only button: three dots, no visible text, labelled for screen readers.

describe('gallery card "…" button (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const firstButton = async (page: Page) => {
    const btn = page.locator('#grid .card .manual-open').first();
    await btn.waitFor();
    return btn;
  };
  const modalOpen = (page: Page) => page.locator('.manual-modal').evaluate((m) => !(m as HTMLElement).hidden);

  it('shows three dots, no text, and a label and tooltip naming the portal', async () => {
    const page = await openSite(browser, '');
    const btn = await firstButton(page);
    expect(await btn.evaluate((b) => b.tagName)).toBe('BUTTON');
    expect((await btn.textContent())!.trim()).toBe('');
    expect(await btn.getAttribute('aria-label')).toBe('More snapshots for ChatGPT');
    expect(await btn.getAttribute('title')).toBe('More snapshots for ChatGPT');
    expect(await btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(await btn.locator('svg[aria-hidden="true"] circle').count()).toBe(3);
    expect(await btn.locator('circle').evaluateAll((cs) => cs.map((c) => c.getAttribute('fill')))).toEqual(['currentColor', 'currentColor', 'currentColor']);
    expect(await page.locator('#grid').textContent()).not.toContain('View more');
  });

  it('is a quiet 32 x 32 outlined button, just before Details at the right end of the footer', async () => {
    for (const width of [1280, 390]) {
      const page = await openSite(browser, '', { width });
      const btn = await firstButton(page);
      const s = await btn.evaluate((b) => {
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        const foot = b.closest('.card-foot')!.getBoundingClientRect();
        const pal = b.closest('.card-foot')!.querySelector('.palette')!.getBoundingClientRect();
        const icon = b.querySelector('svg')!.getBoundingClientRect();
        return { w: r.width, h: r.height, icon: icon.width, bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
          radius: cs.borderTopLeftRadius, beforeDetails: Math.round(b.closest('.card-foot')!.querySelector('.details-link')!.getBoundingClientRect().left - r.right), overlap: pal.right > r.left };
      });
      expect(s).toEqual({ w: 32, h: 32, icon: 18, bg: 'rgba(0, 0, 0, 0)', border: '1px solid', radius: '8px', beforeDetails: 8, overlap: false });
    }
  });

  it('hover tints the background without lifting the button', async () => {
    const page = await openSite(browser, '');
    const btn = await firstButton(page);
    await btn.hover();
    await page.waitForTimeout(200);
    const s = await btn.evaluate((b) => ({ bg: getComputedStyle(b).backgroundColor, transform: getComputedStyle(b).transform }));
    expect(s.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(s.bg).not.toBe('rgb(235, 98, 44)');
    expect(s.transform).toBe('none');
  });

  it('opens the Manual observations modal on click', async () => {
    const page = await openSite(browser, '');
    const btn = await firstButton(page);
    expect(await modalOpen(page)).toBe(false);
    await btn.click();
    expect(await modalOpen(page)).toBe(true);
    expect(await page.locator('#manualTitle').textContent()).toBe('ChatGPT');
  });

  it('opens the modal on Enter, with a visible orange focus ring', async () => {
    const page = await openSite(browser, '');
    const btn = await firstButton(page);
    await btn.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
    expect(await btn.evaluate((b) => b === document.activeElement)).toBe(true);
    expect(await btn.evaluate((b) => { const cs = getComputedStyle(b); return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`; }))
      .toBe('solid 2px rgb(235, 98, 44) 2px');
    await page.keyboard.press('Enter');
    expect(await modalOpen(page)).toBe(true);
    expect(await page.locator('#manualTitle').textContent()).toBe('ChatGPT');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, showCanvas } from './analytics-page';

// Analytics canvas controls: the toolbar note, and the Device toggle, whose Mobile option is disabled
// in Canvas (findings come from the desktop analysis only).

const NOTE = "Drag a card to move it, drag from a card's right dot to another card's left dot to compare them.";

describe('analytics canvas controls (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  /** Rendered text lines of an element (distinct line boxes of its text). */
  const lineCount = (page: Page, sel: string) => page.locator(sel).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
  const noOverflow = (page: Page) => page.evaluate(() => {
    const note = document.querySelector('#anCanvasNote')!;
    const toolbar = document.querySelector('#analyticsView .an-resultsbar')!.getBoundingClientRect();
    const n = note.getBoundingClientRect();
    return {
      page: document.documentElement.scrollWidth <= window.innerWidth,
      note: note.scrollWidth <= note.clientWidth && n.left >= toolbar.left && n.right <= toolbar.right,
      toolbar: toolbar.right <= window.innerWidth,
    };
  });

  describe('toolbar note', () => {
    it.each([[1280], [1024]])('at %ipx: is exactly the new text, on one line', async (width) => {
      const page = await openAnalytics(browser, { width });
      await showCanvas(page);
      expect(await page.locator('#anCanvasNote').textContent()).toBe(NOTE);
      expect(await lineCount(page, '#anCanvasNote')).toBe(1);
      expect(await noOverflow(page)).toEqual({ page: true, note: true, toolbar: true });
    });

    it.each([[800], [721]])('at %ipx: may wrap but never overflows or gets cut off', async (width) => {
      const page = await openAnalytics(browser, { width });
      await showCanvas(page);
      expect(await page.locator('#anCanvasNote').textContent()).toBe(NOTE);
      expect(await noOverflow(page)).toEqual({ page: true, note: true, toolbar: true });
      expect(await page.locator('#anCanvasNote').evaluate((el) => getComputedStyle(el).overflow)).toBe('visible');
    });
  });

  describe('device toggle', () => {
    const btn = (page: Page, device: string) => page.locator(`.an-device [data-andevice="${device}"]`);
    const state = (page: Page) => page.evaluate(() => {
      const get = (d: string) => document.querySelector<HTMLButtonElement>(`.an-device [data-andevice="${d}"]`)!;
      const m = get('mobile');
      return {
        desktopPressed: get('desktop').getAttribute('aria-pressed'),
        mobilePressed: m.getAttribute('aria-pressed'),
        mobileDisabled: m.disabled,
        mobileAriaDisabled: m.getAttribute('aria-disabled'),
        mobileTitle: m.getAttribute('title'),
      };
    });

    it('switching to Canvas while Mobile is selected switches to Desktop and disables Mobile', async () => {
      const page = await openAnalytics(browser);
      await btn(page, 'mobile').click();
      await page.locator('#anTableWrap .an-shot--mobile').first().waitFor();
      await showCanvas(page);
      expect(await state(page)).toEqual({
        desktopPressed: 'true', mobilePressed: 'false', mobileDisabled: true,
        mobileAriaDisabled: 'true', mobileTitle: 'Canvas compares desktop screenshots only.',
      });
    });

    it('in Canvas, Mobile is dimmed with an existing colour token and cannot be picked', async () => {
      const page = await openAnalytics(browser);
      await showCanvas(page);
      // .vt-btn fades its colour over 150ms.
      await page.locator('.an-device [data-andevice="mobile"]').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const colors = await page.evaluate(() => {
        const m = document.querySelector('.an-device [data-andevice="mobile"]')!;
        const probe = document.createElement('span');
        probe.style.color = 'var(--cf-border-strong)';
        document.body.appendChild(probe);
        const token = getComputedStyle(probe).color;
        probe.remove();
        const d = document.querySelector('.an-device [data-andevice="desktop"]')!;
        return { mobile: getComputedStyle(m).color, token, desktop: getComputedStyle(d).color, cursor: getComputedStyle(m).cursor };
      });
      expect(colors.mobile).toBe(colors.token);
      expect(colors.mobile).not.toBe(colors.desktop);
      expect(colors.cursor).toBe('not-allowed');

      await btn(page, 'mobile').click({ force: true });
      expect((await state(page)).desktopPressed).toBe('true');
      expect(await btn(page, 'mobile').evaluate((el) => el.matches(':focus'))).toBe(false);
    });

    it('back in Table, Mobile is enabled again and the device stays Desktop until Mobile is picked', async () => {
      const page = await openAnalytics(browser);
      await btn(page, 'mobile').click();
      await showCanvas(page);
      await page.locator('[data-anview="table"]').click();
      await page.locator('#anTableWrap .an-table').waitFor();
      expect(await state(page)).toEqual({
        desktopPressed: 'true', mobilePressed: 'false', mobileDisabled: false,
        mobileAriaDisabled: null, mobileTitle: null,
      });
      expect(await page.locator('#anTableWrap .an-shot--desktop').count()).toBe(2);

      await btn(page, 'mobile').click();
      await page.locator('#anTableWrap .an-shot--mobile').first().waitFor();
      expect((await state(page)).mobilePressed).toBe('true');
    });

    it('Table mode alone never disables Mobile', async () => {
      const page = await openAnalytics(browser);
      // Pressed states on load are left to the gallery's syncToggles() (public/app.js), as before.
      expect(await state(page)).toMatchObject({ mobileDisabled: false, mobileAriaDisabled: null, mobileTitle: null });
      await btn(page, 'mobile').click();
      await page.locator('[data-mode="weeks"]').click();
      await page.locator('#anTableWrap .an-table').waitFor();
      expect((await state(page)).mobilePressed).toBe('true');
    });
  });

  describe('reset layout button', () => {
    it('is a square icon button as tall as the zoom group, named "Reset layout"', async () => {
      const page = await openAnalytics(browser);
      await showCanvas(page);
      const r = await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>('.anc-reset')!;
        const zoom = document.querySelector('.anc-zoom')!.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        const svg = btn.querySelector('svg')!;
        return {
          label: btn.getAttribute('aria-label'), title: btn.getAttribute('title'), text: btn.textContent!.trim(),
          w: b.width, h: b.height, zoomH: zoom.height,
          svg: [svg.getAttribute('width'), svg.getAttribute('stroke'), svg.getAttribute('stroke-width'), svg.getAttribute('aria-hidden')],
          bg: getComputedStyle(btn).backgroundColor, border: getComputedStyle(btn).borderTopStyle,
        };
      });
      expect(r).toMatchObject({ label: 'Reset layout', title: 'Reset layout', text: '' });
      expect(r.svg).toEqual(['15', 'currentColor', '2', 'true']);
      expect(r.h).toBeCloseTo(r.zoomH, 1);
      expect(r.w).toBeCloseTo(r.h, 1);
      expect(r.border).toBe('solid');
      expect(await page.getByRole('button', { name: 'Reset layout' }).count()).toBe(1);
    });

    it('shows the focus ring on keyboard focus and still resets the layout', async () => {
      const page = await openAnalytics(browser);
      await showCanvas(page);
      const card = page.locator('.anc-card[data-id="claude"] .anc-card-head');
      const box = (await card.boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + 8);
      await page.mouse.down();
      await page.mouse.move(box.x + 20, box.y + 120, { steps: 5 });
      await page.mouse.up();
      const moved = await page.locator('.anc-card[data-id="claude"]').evaluate((el) => (el as HTMLElement).style.transform);

      await page.locator('[data-zoom="fit"]').focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Reset layout');
      expect(await page.locator('.anc-reset').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.keyboard.press('Enter');
      expect(await page.locator('.anc-card[data-id="claude"]').evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(moved);
      expect(await page.locator('.anc-card[data-id="claude"]').evaluate((el) => (el as HTMLElement).style.transform)).toBe('translate(540px, 0px)');
    });
  });
});

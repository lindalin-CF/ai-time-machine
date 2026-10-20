import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, openSite, showCanvas } from './analytics-page';

// Analytics controls layout: row 1 (Compare, Week, Device; count and Clear selection on the right), row 2 (portal chips),
// and the results row (View toggle; canvas zoom and reset, Canvas only) with the canvas note under it.

describe('analytics controls (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const settle = (page: Page) => page.waitForFunction(() => !document.querySelector('#anTableWrap .an-loading'));
  const count = (page: Page) => page.locator('#anCount').textContent();
  const clearDisabled = (page: Page) => page.locator('#anClear').evaluate((el) => (el as HTMLButtonElement).disabled);
  const selectedChips = (page: Page) => page.locator('#anPortals .chip[aria-selected="true"]').allTextContents();
  const shown = (page: Page, sel: string) => page.locator(sel).evaluate((el) => !!(el as HTMLElement).getClientRects().length);

  describe('layout', () => {
    const row1 = (page: Page) => page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const [c, w, d] = ['#analyticsView .an-mode', '#analyticsView .an-wp-btn', '#analyticsView .an-device'].map(box);
      const btns = (sel: string) => [...document.querySelectorAll<HTMLElement>(`${sel} .vt-btn`)].map((b) => ({ w: b.getBoundingClientRect().width, justify: getComputedStyle(b).justifyContent }));
      return {
        widths: [c.width, w.width, d.width], heights: [c.height, w.height, d.height], tops: [c.top, w.top, d.top],
        toggles: [btns('#analyticsView .an-mode'), btns('#analyticsView .an-device'), btns('#analyticsView .an-view')],
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    const expectEqual = (r: Awaited<ReturnType<typeof row1>>) => {
      for (const w of r.widths) expect(w).toBeCloseTo(r.widths[0], 1);
      for (const h of r.heights) expect(h).toBeCloseTo(r.heights[0], 1);
      for (const btns of r.toggles) {
        expect(btns[0].w).toBeCloseTo(btns[1].w, 1);
        expect(btns.every((b) => b.justify === 'center')).toBe(true);
      }
      expect(r.overflow).toBe(false);
    };

    it.each([[1280], [1024], [881]])('at %ipx: Compare, Week and Device sit side by side with one width and height', async (width) => {
      const page = await openAnalytics(browser, { width });
      const r = await row1(page);
      expectEqual(r);
      expect(r.tops[1]).toBeCloseTo(r.tops[0], 1);
      expect(r.tops[2]).toBeCloseTo(r.tops[0], 1);
      await page.locator('[data-mode="weeks"]').click();
      expectEqual(await row1(page));
    });

    it.each([[880], [600], [390]])('at %ipx: row 1 stacks into equal full-width controls and nothing overflows', async (width) => {
      const page = await openAnalytics(browser, { width });
      const r = await row1(page);
      expectEqual(r);
      expect(r.tops[1]).toBeGreaterThan(r.tops[0]);
      await showCanvas(page);
      expect((await row1(page)).overflow).toBe(false);
    });

    it('row 1 width is the widest natural width among the three (no fixed pixel width)', async () => {
      const page = await openAnalytics(browser);
      const before = await row1(page);
      // Make Device wider than "Across products | Week by week"; the other two follow it.
      await page.addStyleTag({ content: '#analyticsView .an-device .vt-btn{letter-spacing:1em}' });
      const after = await row1(page);
      expect(after.widths[2]).toBeGreaterThan(before.widths[2] + 10);
      expectEqual(after);
    });

    it('has no row labels; each control is named for screen readers', async () => {
      const page = await openAnalytics(browser);
      expect(await page.locator('#analyticsView .an-label').count()).toBe(0);
      for (const name of ['Compare', 'Screenshot device', 'Comparison view', 'Portals']) {
        expect(await page.getByRole('group', { name, exact: true }).count()).toBe(1);
      }
      expect(await page.getByRole('button', { name: 'Week Sep 28, 2026' }).count()).toBe(1);
      await page.locator('[data-mode="weeks"]').click();
      expect(await page.getByRole('group', { name: 'Portal', exact: true }).count()).toBe(1);
    });

    it('shows the View toggle above the results, and the zoom tools and note only in Canvas', async () => {
      const page = await openAnalytics(browser);
      expect(await shown(page, '#analyticsView .an-view')).toBe(true);
      expect(await shown(page, '#anCanvasTools')).toBe(false);
      expect(await shown(page, '#anCanvasNote')).toBe(false);
      await showCanvas(page);
      expect(await shown(page, '#anCanvasTools')).toBe(true);
      expect(await shown(page, '#anCanvasNote')).toBe(true);
      const pos = await page.evaluate(() => {
        const bar = document.querySelector('#analyticsView .an-resultsbar')!.getBoundingClientRect();
        const view = document.querySelector('#analyticsView .an-view')!.getBoundingClientRect();
        const tools = document.querySelector('#anCanvasTools')!.getBoundingClientRect();
        const share = document.querySelector('#anShare')!.getBoundingClientRect();
        const note = document.querySelector('#anCanvasNote')!.getBoundingClientRect();
        const board = document.querySelector('.anc-board')!.getBoundingClientRect();
        const controls = document.querySelector('#analyticsView .analytics-controls')!.getBoundingClientRect();
        return { viewLeft: view.left - bar.left, toolsRight: share.left - tools.right, shareRight: bar.right - share.right,
          sameRow: Math.abs(view.top - tools.top) < 1 && Math.abs(view.top - share.top) < 1,
          order: controls.bottom <= bar.top && bar.bottom <= note.top && note.bottom <= board.top };
      });
      // The tools sit at the right end, followed by Copy link 8px after them.
      expect(pos).toEqual({ viewLeft: 0, toolsRight: 8, shareRight: 0, sameRow: true, order: true });
      expect(await page.locator('.anc-board .anc-zoom, .an-canvas-wrap [data-reset]').count()).toBe(0);
      await page.locator('[data-anview="table"]').click();
      expect(await shown(page, '#anCanvasTools')).toBe(false);
      expect(await shown(page, '#anCanvasNote')).toBe(false);
    });

    it('on narrow screens the stacked canvas hides the zoom tools and note', async () => {
      const page = await openAnalytics(browser, { width: 390 });
      await showCanvas(page);
      expect(await page.locator('.anc-stack').count()).toBe(1);
      expect(await shown(page, '#anCanvasTools')).toBe(false);
      expect(await shown(page, '#anCanvasNote')).toBe(false);
    });

    it('keeps Mobile disabled in Canvas with its tooltip', async () => {
      const page = await openAnalytics(browser);
      await showCanvas(page);
      const m = page.locator('#analyticsView [data-andevice="mobile"]');
      expect(await m.isDisabled()).toBe(true);
      expect(await m.getAttribute('aria-disabled')).toBe('true');
      expect(await m.getAttribute('title')).toBe('Canvas compares desktop screenshots only.');
    });

    it('leaves the gallery Desktop/Mobile toggle as it was', async () => {
      const page = await openSite(browser, '');
      const style = await page.locator('#galleryView .viewtoggle').evaluate((el) => ({
        display: getComputedStyle(el).display,
        justify: [...el.querySelectorAll('.vt-btn')].map((b) => getComputedStyle(b).justifyContent),
      }));
      expect(style.display).not.toBe('grid');
      expect(style.justify).not.toContain('center');
    });
  });

  describe('selection count and Clear selection', () => {
    it('Across portals: counts selected portals, and Clear empties them', async () => {
      const page = await openAnalytics(browser);
      expect(await count(page)).toBe('2 of 4 selected');
      expect(await selectedChips(page)).toEqual(['ChatGPT', 'Claude']);
      await page.locator('#anPortals .chip[data-v="claude"]').click();
      expect(await count(page)).toBe('1 of 4 selected');
      await page.locator('#anClear').click();
      expect(await count(page)).toBe('0 of 4 selected');
      expect(await selectedChips(page)).toEqual([]);
      expect(await clearDisabled(page)).toBe(true);
      await settle(page);
      expect(await page.locator('#anTableWrap .an-empty').textContent()).toBe('Pick a week and at least one portal to compare.');
      await page.locator('#anPortals .chip[data-v="chatgpt"]').click();
      expect(await clearDisabled(page)).toBe(false);
    });

    it('Over time: portal chips are single select and the count follows the weeks', async () => {
      const page = await openAnalytics(browser);
      await page.locator('[data-mode="weeks"]').click();
      expect(await selectedChips(page)).toEqual(['ChatGPT']);
      expect(await count(page)).toBe('2 of 4 selected');
      await page.locator('#anPortals .chip[data-v="claude"]').click();
      expect(await selectedChips(page)).toEqual(['Claude']);
      expect(await count(page)).toBe('2 of 4 selected');

      await page.locator('#analyticsView .an-wp-btn').click();
      await page.getByRole('menuitemcheckbox', { name: 'Sep 7, 2026' }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Aug 17, 2026' }).click();
      expect(await count(page)).toBe('4 of 4 selected');
      await page.locator('.analytics-title').click();

      await page.locator('#anClear').click();
      expect(await count(page)).toBe('0 of 4 selected');
      expect(await page.locator('#analyticsView .an-wp-current').textContent()).toBe('Pick weeks');
      expect(await selectedChips(page)).toEqual(['Claude']);
      expect(await clearDisabled(page)).toBe(true);
      await settle(page);
      expect(await page.locator('#anTableWrap .an-empty').textContent()).toBe('Pick a portal and at least one week to compare.');
    });

    it('Clear is keyboard reachable with a visible focus ring', async () => {
      const page = await openAnalytics(browser);
      await page.locator('#analyticsView [data-andevice="mobile"]').focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('anClear');
      expect(await page.locator('#anClear').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    });
  });

  describe('count and Clear placement and look', () => {
    const place = (page: Page) => page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const panel = r('#analyticsView .analytics-controls'), device = r('#analyticsView .an-device'), mode = r('#analyticsView .an-mode');
      const sel = r('#analyticsView .an-selection'), count = r('#anCount'), clear = r('#anClear'), chips = r('#anPortals');
      const pad = parseFloat(getComputedStyle(document.querySelector('#analyticsView .analytics-controls')!).paddingRight) + 1;
      return {
        centred: Math.abs((sel.top + sel.height / 2) - (device.top + device.height / 2)),
        rightGap: panel.right - pad - sel.right,
        below: sel.top >= mode.bottom,
        clearAfterCount: clear.left >= count.right,
        // Phones (≤ 640px): the chips scroll sideways in one row that runs to the panel's borders.
        chipsFullWidth: Math.abs(chips.width - (innerWidth <= 640 ? panel.width - 2 : panel.width - 2 * pad)) < 1,
        chipsBelow: chips.top >= Math.max(sel.bottom, device.bottom),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    it('at 1280px: sits top right on row 1, centred with the controls; chips use the full width below', async () => {
      const page = await openAnalytics(browser);
      const p = await place(page);
      expect(p.centred).toBeLessThan(1);
      expect(p.rightGap).toBeCloseTo(0, 0);
      expect(p).toMatchObject({ below: false, clearAfterCount: true, chipsFullWidth: true, chipsBelow: true, overflow: false });
    });

    it.each([[390], [320]])('at %ipx: the products sit in one row that scrolls sideways', async (width) => {
      const page = await openAnalytics(browser, { width });
      const r = await page.locator('#anPortals').evaluate((el) => {
        const tops = new Set([...el.querySelectorAll('.chip')].map((c) => Math.round(c.getBoundingClientRect().top)));
        const cs = getComputedStyle(el);
        return { rows: tops.size, wrap: cs.flexWrap, overflowX: cs.overflowX };
      });
      expect(r).toEqual({ rows: 1, wrap: 'nowrap', overflowX: 'auto' });
    });

    it.each([[880], [390], [320]])('at %ipx: wraps below row 1 on the right without overflowing', async (width) => {
      const page = await openAnalytics(browser, { width });
      const p = await place(page);
      expect(p.rightGap).toBeCloseTo(0, 0);
      expect(p).toMatchObject({ below: true, clearAfterCount: true, chipsFullWidth: true, chipsBelow: true, overflow: false });
    });

    const look = (page: Page) => page.locator('#anClear').evaluate((el) => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, border: cs.borderTopStyle, shadow: cs.boxShadow, color: cs.color, w: b.width, h: b.height };
    });
    const token = (page: Page, name: string) => page.evaluate((name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    }, name);
    const plain = { bg: 'rgba(0, 0, 0, 0)', bgImage: 'none', border: 'none', shadow: 'none' };

    it('is an icon-only button named "Clear selection", with a 24px hit area', async () => {
      const page = await openAnalytics(browser);
      const btn = page.getByRole('button', { name: 'Clear selection' });
      expect(await btn.count()).toBe(1);
      expect(await btn.evaluate((el) => el.tagName)).toBe('BUTTON');
      expect(await btn.getAttribute('title')).toBe('Clear selection');
      expect((await btn.textContent())!.trim()).toBe('');
      expect(await btn.locator('svg').evaluate((s) => [s.getAttribute('stroke'), s.getAttribute('aria-hidden')])).toEqual(['currentColor', 'true']);
      const l = await look(page);
      expect(l.w).toBeGreaterThanOrEqual(24);
      expect(l.h).toBeGreaterThanOrEqual(24);
    });

    it('has no background or border in any state; hover changes only the icon colour', async () => {
      const page = await openAnalytics(browser);
      const settled = () => page.locator('#anClear').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const rest = await look(page);
      expect(rest).toMatchObject(plain);
      expect(rest.color).toBe(await token(page, '--cf-text-soft'));

      await page.locator('#anClear').hover();
      await settled();
      const hover = await look(page);
      expect(hover).toMatchObject(plain);
      expect(hover.color).toBe(await token(page, '--cf-text'));

      await page.mouse.move(0, 0);
      await page.locator('#analyticsView [data-andevice="mobile"]').focus();
      await page.keyboard.press('Tab');
      expect(await look(page)).toMatchObject(plain);
      expect(await page.locator('#anClear').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

      await page.locator('#anClear').click();
      await page.locator('#anClear').hover({ force: true });
      await settled();
      const disabled = await look(page);
      expect(disabled).toMatchObject(plain);
      expect(disabled.color).toBe(await token(page, '--cf-border-strong'));
      expect(await page.locator('#anClear').evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed');
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, openSite, showCanvas } from './analytics-page';

// Analytics controls layout: row 1 (Compare alone), row 2 (Device, Week; count and Clear selection on the right), then the portal chips,
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
    const rows = (page: Page) => page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const [c, w, d, s, p] = ['#analyticsView .an-mode', '#analyticsView .an-wp-btn', '#analyticsView .an-device', '#analyticsView .an-selection', '#anPortals'].map(box);
      const panel = document.querySelector<HTMLElement>('#analyticsView .analytics-controls')!;
      const pad = parseFloat(getComputedStyle(panel).paddingLeft) + 1;
      const pr = panel.getBoundingClientRect();
      // Lines of text per button: a label that wraps has more than one client rect.
      const lines = (b: Element) => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; };
      // Font, padding and radius of a toggle's track and option (or the dropdown button), to show they share one set of values.
      const look = (track: string, btn: string) => {
        const t = getComputedStyle(document.querySelector(track)!), b = getComputedStyle(document.querySelector(btn)!);
        return { font: b.fontSize, weight: b.fontWeight, trackPad: t.paddingTop, trackRadius: t.borderTopLeftRadius, pad: b.padding, radius: b.borderTopLeftRadius };
      };
      const btns = (sel: string) => [...document.querySelectorAll<HTMLElement>(`${sel} .vt-btn`)].map((b) => ({ w: b.getBoundingClientRect().width, justify: getComputedStyle(b).justifyContent, lines: lines(b) }));
      return {
        mode: { left: c.left, right: c.right, top: c.top, bottom: c.bottom, h: c.height, font: getComputedStyle(document.querySelector('#analyticsView .an-mode .vt-btn')!).fontSize },
        week: { left: w.left, right: w.right, top: w.top, h: w.height }, device: { left: d.left, right: d.right, top: d.top, bottom: d.bottom, h: d.height },
        sel: { right: s.right, top: s.top, bottom: s.bottom, mid: s.top + s.height / 2 }, chipsTop: p.top,
        content: { left: pr.left + pad, right: pr.right - pad },
        looks: { mode: look('#analyticsView .an-mode', '#analyticsView .an-mode .vt-btn'), device: look('#analyticsView .an-device', '#analyticsView .an-device .vt-btn') },
        weekLook: (() => { const b = getComputedStyle(document.querySelector('#analyticsView .an-wp-btn')!); return { font: b.fontSize, weight: b.fontWeight, radius: b.borderTopLeftRadius }; })(),
        toggles: [btns('#analyticsView .an-mode'), btns('#analyticsView .an-device'), btns('#analyticsView .an-view')],
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    const expectToggles = (r: Awaited<ReturnType<typeof rows>>) => {
      for (const btns of r.toggles) {
        expect(btns[0].w).toBeCloseTo(btns[1].w, 1);
        expect(btns.every((b) => b.justify === 'center' && b.lines === 1)).toBe(true);
      }
      expect(r.overflow).toBe(false);
    };
    // Compare alone on row 1, spanning Device + gap + Week on row 2 (edges within 1px); Device comes first.
    const expectSpan = (r: Awaited<ReturnType<typeof rows>>) => {
      expect(r.device.top).toBeGreaterThanOrEqual(r.mode.bottom);
      expect(Math.abs(r.device.top - r.week.top)).toBeLessThan(1);
      expect(Math.abs(r.mode.left - r.device.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.mode.right - r.week.right)).toBeLessThanOrEqual(1);
      expect(r.week.left).toBeGreaterThan(r.device.right);
    };
    // Device matches the mode toggle (track and option), and the dropdown matches both in height, font and radius.
    const expectSameLook = (r: Awaited<ReturnType<typeof rows>>) => {
      expect(r.looks.device).toEqual(r.looks.mode);
      expect(r.weekLook).toEqual({ font: r.looks.mode.font, weight: r.looks.mode.weight, radius: r.looks.mode.trackRadius });
      expect(Math.abs(r.device.h - r.mode.h)).toBeLessThan(0.5);
      expect(Math.abs(r.week.h - r.mode.h)).toBeLessThan(0.5);
    };

    it.each([[1280], [1100], [881], [641]])('at %ipx: Compare sits alone on row 1, edge to edge with Week and Device below it, in both modes', async (width) => {
      const page = await openAnalytics(browser, { width });
      for (const mode of ['portals', 'weeks']) {
        await page.locator(`[data-mode="${mode}"]`).click();
        const r = await rows(page);
        expectSpan(r);
        expectToggles(r);
        expectSameLook(r);
        // Same height and font size as before the rearrangement (36px tall; 12.5px text above 760px, 12px below).
        expect(r.mode.h).toBeCloseTo(36, 1);
        expect(r.week.h).toBeCloseTo(36, 1);
        expect(r.device.h).toBeCloseTo(36, 1);
        expect(r.mode.font).toBe(width > 760 ? '12.5px' : '12px');
        // The count and Clear end row 2 at the right, centred with the Device toggle; the chips follow.
        expect(Math.abs(r.sel.mid - (r.device.top + r.device.h / 2))).toBeLessThan(1);
        expect(r.sel.right).toBeCloseTo(r.content.right, 0);
        expect(r.chipsTop).toBeGreaterThanOrEqual(r.device.bottom);
      }
    });

    it('at 390px: Compare, then Device and Week, then the count, then the chips, each row full width', async () => {
      const page = await openAnalytics(browser, { width: 390 });
      for (const mode of ['portals', 'weeks']) {
        await page.locator(`[data-mode="${mode}"]`).click();
        const r = await rows(page);
        expectSpan(r);
        expectToggles(r);
        expectSameLook(r);
        expect(r.mode.font).toBe('12px');
        expect(r.mode.left).toBeCloseTo(r.content.left, 0);
        expect(r.mode.right).toBeCloseTo(r.content.right, 0);
        expect(r.sel.top).toBeGreaterThanOrEqual(r.device.bottom);
        expect(r.sel.right).toBeCloseTo(r.content.right, 0);
        expect(r.chipsTop).toBeGreaterThanOrEqual(r.sel.bottom);
      }
      await showCanvas(page);
      expect((await rows(page)).overflow).toBe(false);
    });

    it('at 320px: Device and Week stack under Compare at full width and nothing overflows', async () => {
      const page = await openAnalytics(browser, { width: 320 });
      const r = await rows(page);
      expectToggles(r);
      for (const b of [r.mode, r.week, r.device]) {
        expect(b.left).toBeCloseTo(r.content.left, 0);
        expect(b.right).toBeCloseTo(r.content.right, 0);
      }
      expect(r.device.top).toBeGreaterThanOrEqual(r.mode.bottom);
      expect(r.week.top).toBeGreaterThanOrEqual(r.device.bottom);
    });

    it('Compare follows the width of Device and Week (no fixed pixel width)', async () => {
      const page = await openAnalytics(browser);
      const before = await rows(page);
      // Make Device wider; its column, the Week column and Compare all follow it.
      await page.addStyleTag({ content: '#analyticsView .an-device .vt-btn{letter-spacing:1em}' });
      const after = await rows(page);
      expect(after.device.right - after.device.left).toBeGreaterThan(before.device.right - before.device.left + 10);
      expectSpan(after);
      expectToggles(after);
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
      const style = await page.locator('#galleryView .controls .viewtoggle').evaluate((el) => ({
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
      // The week dropdown is the last control before Clear (row 2 reads Device, Week, then the count and Clear).
      const page = await openAnalytics(browser);
      await page.locator('#analyticsView .an-wp-btn').focus();
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

    it('at 1280px: sits on the right of row 2, centred with the controls; chips use the full width below', async () => {
      const page = await openAnalytics(browser);
      const p = await place(page);
      expect(p.centred).toBeLessThan(1);
      expect(p.rightGap).toBeCloseTo(0, 0);
      expect(p).toMatchObject({ below: true, clearAfterCount: true, chipsFullWidth: true, chipsBelow: true, overflow: false });
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

    it.each([[880], [390], [320]])('at %ipx: sits below row 1 on the right without overflowing', async (width) => {
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
      await page.locator('#analyticsView .an-wp-btn').focus();
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

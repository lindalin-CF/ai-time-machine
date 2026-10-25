import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, openSite, showCanvas } from './analytics-page';

// One Desktop | Mobile component (public/device-toggle.js) on the Library bar, the Collection and Compare.
// The gallery's Desktop/Mobile toggle (syncToggles in public/app.js) keeps the gallery and collection
// buttons in step, and leaves every other .vt-btn (Compare Mode/Device/View, canvas zoom) alone.

describe('gallery device toggle and other toggles (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  /** "label*" for highlighted buttons, with aria-pressed, for every .vt-btn matching `sel`. */
  const buttons = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) =>
    els.map((e) => `${e.textContent!.trim()}${e.classList.contains('active') ? '*' : ''}:${e.getAttribute('aria-pressed')}`));
  const gallery = (page: Page) => buttons(page, '.vt-btn[data-device]');
  const shotSrcs = (page: Page) => page.locator('#grid img[src*="/img/shots/"]').evaluateAll((els) => els.map((e) => e.getAttribute('src')));

  it('loads with Desktop highlighted in the gallery and collection toggles', async () => {
    const page = await openSite(browser, '');
    await page.locator('#grid img[src*="/img/shots/"]').first().waitFor();
    expect(await gallery(page)).toEqual(['Desktop*:true', 'Mobile:false', 'Desktop*:true', 'Mobile:false']);
    expect((await shotSrcs(page)).every((s) => !s!.includes('.mobile.'))).toBe(true);
  });

  it('switching to Mobile and back updates both toggles and the cards', async () => {
    const page = await openSite(browser, '');
    await page.locator('#grid img[src*="/img/shots/"]').first().waitFor();
    await page.locator('#galleryView [data-device="mobile"]').click();
    expect(await gallery(page)).toEqual(['Desktop:false', 'Mobile*:true', 'Desktop:false', 'Mobile*:true']);
    expect((await shotSrcs(page)).every((s) => s!.includes('.mobile.'))).toBe(true);

    await page.locator('#galleryView [data-device="desktop"]').click();
    expect(await gallery(page)).toEqual(['Desktop*:true', 'Mobile:false', 'Desktop*:true', 'Mobile:false']);
    expect((await shotSrcs(page)).every((s) => !s!.includes('.mobile.'))).toBe(true);
  });

  // The Compare, Device and View toggles (not Clear selection or the canvas zoom buttons).
  const anToggles = '#analyticsView .viewtoggle:not(.anc-zoom) .vt-btn';

  it('Compare loads with Across portals, Desktop and Table highlighted, as the HTML marks them', async () => {
    const page = await openAnalytics(browser);
    expect(await buttons(page, anToggles)).toEqual([
      'Across portals*:true', 'Single portal:false', 'Desktop*:true', 'Mobile:false', 'Table*:true', 'Canvas:false',
    ]);
  });

  it('the gallery toggle leaves the Compare and canvas buttons alone', async () => {
    const page = await openAnalytics(browser);
    await showCanvas(page);
    const before = await buttons(page, '#analyticsView .vt-btn');
    expect(before.length).toBeGreaterThan(6);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#galleryView [data-device="mobile"]')!.click());
    expect(await buttons(page, '#analyticsView .vt-btn')).toEqual(before);
    expect(await page.locator('#anCanvasTools .vt-btn[aria-pressed], #anCanvasWrap .vt-btn[aria-pressed], #anClear[aria-pressed]').count()).toBe(0);
  });

  describe('shared Desktop | Mobile component', () => {
    const DESKTOP_ICON = 'M4 5a2 2 0 0 1 2-2h12';
    const PHONE_ICON = 'M7 3a2 2 0 0 0-2 2v14';
    /** The toggle in `host`: group role and name, then per button its data value, label, icon path, pressed state and title. */
    const toggle = (page: Page, host: string, attr: string) => page.locator(host).evaluate((el, attr) => ({
      cls: el.classList.contains('device-toggle') && el.classList.contains('viewtoggle'),
      role: el.getAttribute('role'), name: el.getAttribute('aria-label'),
      buttons: [...el.querySelectorAll('button')].map((b) => ({
        v: b.getAttribute(`data-${attr}`), label: b.textContent!.trim(), icon: b.querySelector('svg[aria-hidden="true"] path')!.getAttribute('d')!.slice(0, 21),
        pressed: b.getAttribute('aria-pressed'), active: b.classList.contains('active'), disabled: (b as HTMLButtonElement).disabled,
        ariaDisabled: b.getAttribute('aria-disabled'), title: b.getAttribute('title'),
      })),
    }), attr);
    const enabled = (v: string, label: string, icon: string, on: boolean) =>
      ({ v, label, icon, pressed: String(on), active: on, disabled: false, ariaDisabled: null, title: null });
    const colours = (page: Page, sel: string) => page.locator(sel).evaluate((el) => {
      const cs = getComputedStyle(el); return { bg: cs.backgroundColor, fg: cs.color, line: `${cs.textDecorationLine} ${cs.textDecorationStyle}` };
    });
    const SELECTED = { bg: 'rgb(66, 50, 23)', fg: 'rgb(245, 241, 233)', line: 'none solid' };

    it('renders the same toggle, with both icons, on the Library bar, the Collection and Compare', async () => {
      const page = await openSite(browser, '');
      await page.locator('#grid .card:not(.skeleton)').first().waitFor();
      const both = [enabled('desktop', 'Desktop', DESKTOP_ICON, true), enabled('mobile', 'Mobile', PHONE_ICON, false)];
      for (const host of ['#deviceToggle', '#collectionDeviceToggle']) {
        expect(await toggle(page, host, 'device')).toEqual({ cls: true, role: 'group', name: 'Screenshot device', buttons: both });
      }
      const compare = await openAnalytics(browser);
      expect(await toggle(compare, '#anDevice', 'andevice')).toEqual({ cls: true, role: 'group', name: 'Screenshot device', buttons: both });
      expect(await compare.locator('#anDevice').evaluate((el) => el.classList.contains('an-device'))).toBe(true);
      // Exactly one version: no Desktop | Mobile buttons outside the component.
      expect(await compare.locator('[data-device], [data-andevice]').evaluateAll((els) => els.every((e) => e.closest('.device-toggle')))).toBe(true);
    });

    it('selected uses --selected-bg / --selected-fg, unselected is transparent, on both pages', async () => {
      const page = await openSite(browser, '');
      await page.locator('#grid .card:not(.skeleton)').first().waitFor();
      await page.mouse.move(0, 0);
      expect(await colours(page, '#deviceToggle [data-device="desktop"]')).toEqual(SELECTED);
      expect((await colours(page, '#deviceToggle [data-device="mobile"]')).bg).toBe('rgba(0, 0, 0, 0)');
      const compare = await openAnalytics(browser);
      await compare.mouse.move(0, 0);
      expect(await colours(compare, '#anDevice [data-andevice="desktop"]')).toEqual(SELECTED);
      expect(await colours(compare, '#anDevice [data-andevice="mobile"]')).toEqual(await colours(page, '#deviceToggle [data-device="mobile"]'));
    });

    it('in Compare\'s Canvas, Mobile is disabled with its reason and a dotted underline; Table enables it again', async () => {
      const page = await openAnalytics(browser);
      await showCanvas(page);
      const t = await toggle(page, '#anDevice', 'andevice');
      expect(t.buttons[1]).toEqual({ v: 'mobile', label: 'Mobile', icon: PHONE_ICON, pressed: 'false', active: false, disabled: true,
        ariaDisabled: 'true', title: 'Canvas compares desktop screenshots only.' });
      const c = await colours(page, '#anDevice [data-andevice="mobile"]');
      expect(c).toEqual({ bg: 'rgba(0, 0, 0, 0)', fg: 'rgb(111, 94, 71)', line: 'underline dotted' });
      await page.locator('[data-anview="table"]').click();
      expect((await toggle(page, '#anDevice', 'andevice')).buttons[1]).toEqual(enabled('mobile', 'Mobile', PHONE_ICON, false));
    });

    it('works from the keyboard on the Library bar, with the 2px orange ring', async () => {
      const page = await openSite(browser, '');
      await page.locator('#grid img[src*="/img/shots/"]').first().waitFor();
      await page.locator('#deviceToggle [data-device="desktop"]').focus();
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => { const el = document.activeElement!; const cs = getComputedStyle(el); return `${el.getAttribute('data-device')} ${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`; });
      expect(ring).toBe('mobile 2px solid rgb(196, 76, 28)');
      await page.keyboard.press('Space');
      expect(await gallery(page)).toEqual(['Desktop:false', 'Mobile*:true', 'Desktop:false', 'Mobile*:true']);
      expect((await shotSrcs(page)).every((s) => s!.includes('.mobile.'))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Enter');
      expect(await gallery(page)).toEqual(['Desktop*:true', 'Mobile:false', 'Desktop*:true', 'Mobile:false']);
    });

    it('works from the keyboard in Compare: Mobile updates the view and the link; in Canvas, Mobile is skipped', async () => {
      const page = await openAnalytics(browser);
      await page.locator('#anDevice [data-andevice="desktop"]').focus();
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => { const el = document.activeElement!; const cs = getComputedStyle(el); return `${el.getAttribute('data-andevice')} ${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`; });
      expect(ring).toBe('mobile 2px solid rgb(196, 76, 28)');
      await page.keyboard.press('Enter');
      expect(await buttons(page, '#anDevice .vt-btn')).toEqual(['Desktop:false', 'Mobile*:true']);
      await expect.poll(() => page.url()).toContain('device=mobile');
      await expect.poll(() => page.locator('#anTableWrap img[src*="/img/shots/"]').evaluateAll((els) => els.length > 0 && els.every((e) => e.getAttribute('src')!.includes('.mobile.')))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Space');
      expect(await buttons(page, '#anDevice .vt-btn')).toEqual(['Desktop*:true', 'Mobile:false']);
      await expect.poll(() => page.url()).toContain('device=desktop');
      await showCanvas(page);
      await page.locator('#anDevice [data-andevice="desktop"]').focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement!.closest('#anDevice'))).toBeNull();
    });

    it.each([1440, 1100])('at %ipx the Compare toggle lines up with the mode toggle, in Table and Canvas', async (width) => {
      const page = await openAnalytics(browser, { width });
      const box = () => page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const m = r('#analyticsView .an-mode'), d = r('#anDevice');
        const halves = [...document.querySelectorAll('#anDevice .vt-btn')].map((b) => b.getBoundingClientRect().width);
        const fs = (s: string) => getComputedStyle(document.querySelector(s)!).fontSize;
        return { left: Math.abs(m.left - d.left), right: Math.abs(m.right - d.right), h: d.height - m.height, halves: Math.abs(halves[0] - halves[1]),
          font: fs('#anDevice .vt-btn') === fs('#analyticsView .an-mode .vt-btn') };
      });
      for (const view of ['table', 'canvas']) {
        if (view === 'canvas') await showCanvas(page);
        const b = await box();
        expect(b.left).toBeLessThanOrEqual(1);
        expect(b.right).toBeLessThanOrEqual(1);
        expect(Math.abs(b.h)).toBeLessThan(0.5);
        expect(b.halves).toBeLessThan(0.5);
        expect(b.font).toBe(true);
      }
    });

    it('the Library filter bar toggle looks exactly as the old static markup did', async () => {
      const page = await openSite(browser, '', { width: 1440 });
      await page.locator('#grid .card:not(.skeleton)').first().waitFor();
      await page.mouse.move(0, 0);
      // The markup the bar had before the component, placed next to it in the same bar.
      await page.evaluate(() => {
        const ref = document.createElement('div');
        ref.className = 'controls-right';
        ref.style.cssText = 'position:absolute;left:0;top:100%';
        ref.innerHTML = document.querySelector('#deviceToggle')!.outerHTML.replace('id="deviceToggle"', 'id="oldToggle"');
        ref.querySelector('#oldToggle')!.className = 'viewtoggle';
        ref.querySelector('#oldToggle')!.innerHTML = `
          <button class="vt-btn active" type="button" data-ref="desktop" aria-pressed="true">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4l1 2h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h2l1-2H6a2 2 0 0 1-2-2V5Zm2 0v9h12V5H6Z"/></svg>
            Desktop
          </button>
          <button class="vt-btn" type="button" data-ref="mobile" aria-pressed="false">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M7 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H7Zm0 2h10v14H7V5Zm4 12h2a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2Z"/></svg>
            Mobile
          </button>`;
        document.querySelector('.controls')!.appendChild(ref);
      });
      const look = (sel: string) => page.evaluate((sel) => [sel, `${sel} .vt-btn`, `${sel} svg`].flatMap((s) => [...document.querySelectorAll(s)]).map((el) => {
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        const o: Record<string, string> = {};
        for (const p of cs) o[p] = cs.getPropertyValue(p);
        return { ...o, size: `${b.width}x${b.height}` };
      }), sel);
      expect(await look('#deviceToggle')).toEqual(await look('#oldToggle'));
      expect((await page.locator('#deviceToggle').boundingBox())!.height).toBe(36);
    });
  });
});

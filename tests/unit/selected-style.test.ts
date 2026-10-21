import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, openSite, showCanvas } from './analytics-page';

// "Selected" looks the same everywhere: the active option of every segmented toggle (.vt-btn.active) uses the active
// product chip's fill and text (--selected-bg / --selected-fg). Inactive and disabled options, and the top nav's
// current page (orange: "where you are"), keep their own looks.

const DARK = 'rgb(66, 50, 23)'; // --cf-text
const CREAM = 'rgb(245, 241, 233)'; // --cf-bg-100
const SOFT = 'rgb(111, 94, 71)'; // --cf-text-soft
const ORANGE = 'rgb(235, 98, 44)';
const NONE = 'rgba(0, 0, 0, 0)';

type Look = { bg: string; color: string; shadow: string; radius: string; decoration: string; svg: string[] };
const look = (page: Page, sel: string) => page.locator(sel).first().evaluate((el): Look => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow, radius: cs.borderRadius, decoration: cs.textDecorationStyle,
    svg: [...el.querySelectorAll('svg')].map((s) => `${getComputedStyle(s).color} ${getComputedStyle(s).opacity}`) };
});
/** Waits out the .15s colour transition. */
const settle = (page: Page) => page.waitForTimeout(250);

/** WCAG contrast ratio of two rgb() colours. */
const contrast = (a: string, b: string) => {
  const lum = (c: string) => {
    const [r, g, bl] = c.match(/\d+/g)!.slice(0, 3).map((v) => { const s = Number(v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('selected style (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('the active chip is the dark fill with cream text, readable at 4.5:1 or more', async () => {
    const page = await openSite(browser, '');
    await page.locator('#filters .chip[aria-pressed="true"]').first().waitFor();
    await settle(page);
    const chip = await look(page, '#filters .chip[aria-pressed="true"]');
    expect([chip.bg, chip.color]).toEqual([DARK, CREAM]);
    expect(contrast(chip.bg, chip.color)).toBeGreaterThanOrEqual(4.5);
    await page.context().close();
  });

  it('homepage Desktop / Mobile toggles: active matches the chip, the icon too; inactive stays as it was', async () => {
    const page = await openSite(browser, '');
    await page.locator('#filters .chip[aria-pressed="true"]').first().waitFor();
    await settle(page);
    const chip = await look(page, '#filters .chip[aria-pressed="true"]');
    const active = await look(page, '.controls [data-device].active');
    expect([active.bg, active.color]).toEqual([chip.bg, chip.color]);
    expect(active.shadow).toContain('0px 1px 3px');
    expect(active.radius).toBe('7px');
    for (const s of active.svg) expect(s).toBe(`${CREAM} 1`);
    const inactive = await look(page, '.controls [data-device]:not(.active)');
    expect([inactive.bg, inactive.color, inactive.shadow]).toEqual([NONE, SOFT, 'none']);

    // The Collection view's toggle is the same component.
    await page.locator('.topnav-link[data-nav="collection"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'collection');
    await settle(page);
    const coll = await look(page, '#collectionView [data-device].active');
    expect([coll.bg, coll.color]).toEqual([chip.bg, chip.color]);
    await page.context().close();
  });

  it('Compare: mode, device and view toggles match the active chip in both modes, Table and Canvas', async () => {
    const page = await openAnalytics(browser);
    for (const mode of ['portals', 'weeks']) {
      await page.locator(`[data-mode="${mode}"]`).click();
      for (const view of ['table', 'canvas']) {
        await page.locator(`[data-anview="${view}"]`).click();
        if (view === 'canvas') await showCanvas(page);
        await settle(page);
        const chip = await look(page, '#anPortals .chip[aria-selected="true"]');
        expect([chip.bg, chip.color]).toEqual([DARK, CREAM]);
        for (const group of ['.an-mode', '.an-device', '.an-view']) {
          const active = await look(page, `#analyticsView ${group} .vt-btn.active`);
          expect([active.bg, active.color], `${mode} ${view} ${group}`).toEqual([chip.bg, chip.color]);
          expect(active.shadow).toContain('0px 1px 3px');
        }
        expect(await page.locator(`#analyticsView .an-view [data-anview="${view}"]`).getAttribute('class')).toContain('active');
      }
    }
    await page.context().close();
  });

  it('the disabled Mobile option in Canvas still looks disabled, not selected', async () => {
    const page = await openAnalytics(browser);
    await showCanvas(page);
    await settle(page);
    const m = await look(page, '#analyticsView [data-andevice="mobile"]');
    expect(await page.locator('#analyticsView [data-andevice="mobile"]').isDisabled()).toBe(true);
    expect(m).toMatchObject({ bg: NONE, color: SOFT, shadow: 'none', decoration: 'dotted' });
    await page.context().close();
  });

  it('hover on an inactive option stays subtle: darker text, no fill', async () => {
    const page = await openAnalytics(browser);
    const btn = page.locator('#analyticsView [data-mode="weeks"]');
    await btn.hover();
    await settle(page);
    const h = await look(page, '#analyticsView [data-mode="weeks"]');
    expect([h.bg, h.color]).toEqual([NONE, DARK]);
    // Hovering the active option keeps it selected-looking.
    await page.locator('#analyticsView [data-mode="portals"]').hover();
    await settle(page);
    const a = await look(page, '#analyticsView [data-mode="portals"]');
    expect([a.bg, a.color]).toEqual([DARK, CREAM]);
    await page.context().close();
  });

  it('keyboard focus on the active option shows the 2px orange ring', async () => {
    const page = await openAnalytics(browser);
    await page.locator('#analyticsView [data-mode="portals"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // focus by keyboard so :focus-visible applies
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { active: el.classList.contains('active'), outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`, offset: cs.outlineOffset };
    });
    expect(ring).toEqual({ active: true, outline: `2px solid ${ORANGE}`, offset: '2px' });
    await page.context().close();
  });

  it('the top nav keeps the current page in orange text with no fill', async () => {
    const page = await openAnalytics(browser);
    await settle(page);
    const nav = await look(page, '.topnav-link.active');
    expect([nav.bg, nav.color]).toEqual([NONE, ORANGE]);
    await page.context().close();
  });
});

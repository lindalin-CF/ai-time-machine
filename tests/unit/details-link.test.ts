import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openSite } from './analytics-page';

// The "Details →" link at the right end of each gallery card footer (.details-link in public/app.js), after the
// "…" button. It is a plain <a> to the card's portal page, the same href as the portal name link.

const PORTAL_PAGE = '<!doctype html><title>ChatGPT</title><h1 id="portal">ChatGPT portal page</h1>';

/** The gallery with every card given `colours` palette swatches (real captures have 5, from paletteFromBrand). */
async function openGallery(browser: Browser, width: number, colours = 5): Promise<Page> {
  const page = await openSite(browser, '', { width, pages: { '/portals/chatgpt': PORTAL_PAGE } });
  await page.route('**/api/captures*', async (route) => {
    const week = new URL(route.request().url()).searchParams.get('week') || '2026-09-28';
    const palette = Array.from({ length: colours }, (_, i) => `#${(0x203040 + i * 0x181818).toString(16)}`);
    await route.fulfill({ json: { week, label: `Week of ${week}`, captures: [['chatgpt', 'ChatGPT'], ['claude', 'Claude']].map(([slug, portal]) => ({
      id: slug, slug, portal, company: 'Co', url: 'https://x/', brand: '#888888', week,
      image: `/img/shots/${week}/${slug}.png?v=1`, imageMobile: `/img/shots/${week}/${slug}.mobile.png?v=1`, hasMobile: true,
      width: 1280, height: 800, mobileWidth: 780, mobileHeight: 1688,
      palette, analysis: '', analysisBy: 'pending', status: 'ok', capturedAt: `${week}T09:00:00Z`, metrics: null,
    })) } });
  });
  await page.reload();
  await page.locator('#grid .card .details-link').first().waitFor();
  return page;
}

describe('gallery card Details link (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('every card has a Details link with the portal name link\'s href and a label naming the portal and week', async () => {
    const page = await openGallery(browser, 1280);
    const cards = await page.locator('#grid .card').evaluateAll((els) => els.map((card) => {
      const a = card.querySelector('.details-link') as HTMLAnchorElement;
      return { tag: a.tagName, href: a.getAttribute('href'), name: card.querySelector('.card-link')!.getAttribute('href'),
        label: a.getAttribute('aria-label'), text: a.textContent!.replace(/\s+/g, ' ').trim(), target: a.getAttribute('target'),
        arrowHidden: a.querySelector('.arrow')!.getAttribute('aria-hidden') };
    }));
    expect(cards).toEqual([
      { tag: 'A', href: '/portals/chatgpt', name: '/portals/chatgpt', label: 'Details for ChatGPT, week of Sep 28, 2026', text: 'Details →', target: null, arrowHidden: 'true' },
      { tag: 'A', href: '/portals/claude', name: '/portals/claude', label: 'Details for Claude, week of Sep 28, 2026', text: 'Details →', target: null, arrowHidden: 'true' },
    ]);
  });

  it('has the outlined orange-ink style, a hover tint and an orange focus ring', async () => {
    const page = await openGallery(browser, 1280);
    const link = page.locator('#grid .card .details-link').first();
    const style = () => link.evaluate((a) => {
      const cs = getComputedStyle(a);
      return { h: a.getBoundingClientRect().height, display: cs.display, align: cs.alignItems, gap: cs.columnGap, pad: `${cs.paddingLeft} ${cs.paddingRight}`,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color,
        font: `${cs.fontFamily.split(',')[0]} ${cs.fontWeight} ${cs.fontSize}`, underline: cs.textDecorationLine, shadow: cs.boxShadow };
    });
    // Declared inline-flex; as a flex item of .card-actions the browser blockifies it, so it computes to flex.
    expect(await page.evaluate(() => [...document.styleSheets].flatMap((sh) => [...sh.cssRules] as CSSStyleRule[])
      .find((r) => r.selectorText === '.btn-secondary')!.style.display)).toBe('inline-flex');
    expect(await style()).toEqual({ h: 32, display: 'flex', align: 'center', gap: '6px', pad: '11px 11px',
      border: '1px solid rgb(217, 206, 189)', radius: '8px', bg: 'rgb(245, 241, 233)', color: 'rgb(204, 80, 30)',
      font: '"Space Grotesk" 600 12.5px', underline: 'none', shadow: 'rgba(66, 50, 23, 0.12) 0px 1px 3px 0px' });

    await link.hover();
    await page.waitForTimeout(250);
    expect((await style()).bg).toBe('rgb(222, 212, 198)');

    await page.mouse.move(0, 0);
    await page.locator('#grid .card .manual-open').first().focus();
    await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
    expect(await link.evaluate((a) => a === document.activeElement)).toBe(true);
    expect(await link.evaluate((a) => { const cs = getComputedStyle(a); return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`; }))
      .toBe('solid 2px rgb(235, 98, 44) 2px');
  });

  for (const width of [1280, 390, 360]) {
    for (const colours of [5, 10]) {
      it(`at ${width}px with ${colours} swatches: palette, "…", Details on one line, Details at the right end, no overlap`, async () => {
        const page = await openGallery(browser, width, colours);
        const rows = await page.locator('#grid .card .card-foot').evaluateAll((foots) => foots.map((foot) => {
          const r = (sel: string) => foot.querySelector(sel)!.getBoundingClientRect();
          const f = foot.getBoundingClientRect(), pal = r('.palette'), dots = r('.manual-open'), det = r('.details-link');
          const mid = (b: DOMRect) => Math.round(b.top + b.height / 2);
          return { order: pal.right <= dots.left && dots.right <= det.left, gap: Math.round(det.left - dots.right),
            detailsAtEnd: Math.round(f.right - det.right), centred: mid(dots) === mid(det) && Math.abs(mid(pal) - mid(det)) <= 1,
            dots: `${dots.width}x${dots.height}`, inside: pal.left >= f.left && det.right <= f.right + 0.5, oneLine: det.height === 32 };
        }));
        for (const row of rows) expect(row).toEqual({ order: true, gap: 8, detailsAtEnd: 0, centred: true, dots: '32x32', inside: true, oneLine: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  }

  it('with too many swatches the palette shrinks and the buttons keep their size', async () => {
    const page = await openGallery(browser, 360, 10);
    const s = await page.locator('#grid .card .card-foot').first().evaluate((foot) => ({
      swatch: foot.querySelector('.palette i')!.getBoundingClientRect().width,
      dots: foot.querySelector('.manual-open')!.getBoundingClientRect().width,
      details: foot.querySelector('.details-link')!.scrollWidth <= foot.querySelector('.details-link')!.clientWidth,
    }));
    expect(s.swatch).toBeLessThan(24);
    expect(s.dots).toBe(32);
    expect(s.details).toBe(true);
  });

  it('clicking it opens the portal page in the same tab', async () => {
    const page = await openGallery(browser, 1280);
    await page.locator('#grid .card .details-link').first().click();
    await page.waitForURL('https://site.test/portals/chatgpt');
    expect(await page.locator('#portal').textContent()).toBe('ChatGPT portal page');
    expect(page.context().pages()).toHaveLength(1);
  });

  it('cmd/ctrl-click opens the portal page in a new tab and leaves the gallery open', async () => {
    const page = await openGallery(browser, 1280);
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('#grid .card .details-link').first().click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await tab.waitForLoadState();
    expect(tab.url()).toBe('https://site.test/portals/chatgpt');
    expect(page.url()).toBe('https://site.test/');
  });
});

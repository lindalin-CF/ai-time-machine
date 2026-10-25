import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
// @ts-expect-error -- plain browser module without type declarations
import { libraryCompareHash, parseAnalyticsHash } from '../../public/analytics-share.js';
import { frames, openSite, probe, WEEKS } from './analytics-page';

// The landing page's controls: one slim sticky filter bar (portal chips with a "+N more" menu, Desktop | Mobile, week,
// search, Compare →). Compare → opens #compare with the bar's portals, week and device.

const PORTALS = [
  { slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' },
  { slug: 'gemini', name: 'Gemini', brand: '#4285f4' }, { slug: 'perplexity', name: 'Perplexity', brand: '#20808d' },
  { slug: 'copilot', name: 'Copilot', brand: '#0078d4' }, { slug: 'grok', name: 'Grok', brand: '#111111' },
  { slug: 'deepseek', name: 'DeepSeek', brand: '#4d6bfe' },
];
const SLUGS = PORTALS.map((p) => p.slug);

describe('libraryCompareHash', () => {
  const base = { weeks: WEEKS, portals: SLUGS, week: WEEKS[0], device: 'desktop' };

  it('All portals: one week in the Table, Compare picks its default portals', () => {
    expect(libraryCompareHash({ ...base, selection: [] })).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&device=desktop`);
    expect(libraryCompareHash({ ...base, selection: [], week: WEEKS[2] })).toBe(`#compare?view=table&mode=portals&week=${WEEKS[2]}&device=desktop`);
  });

  it('one portal: that portal over this week and the nearest older one', () => {
    expect(libraryCompareHash({ ...base, selection: ['claude'] }))
      .toBe(`#compare?view=table&mode=time&portal=claude&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
    expect(libraryCompareHash({ ...base, selection: ['grok'], week: WEEKS[3] }))
      .toBe(`#compare?view=table&mode=time&portal=grok&weeks=${WEEKS[3]},${WEEKS[4]}&device=desktop`);
  });

  it('one portal in the oldest week: Across portals with Compare\'s usual second default', () => {
    const oldest = WEEKS[WEEKS.length - 1];
    expect(libraryCompareHash({ ...base, selection: ['grok'], week: oldest }))
      .toBe(`#compare?view=table&mode=portals&week=${oldest}&portals=grok,chatgpt&device=desktop`);
    expect(libraryCompareHash({ ...base, selection: ['chatgpt'], week: oldest }))
      .toBe(`#compare?view=table&mode=portals&week=${oldest}&portals=chatgpt,claude&device=desktop`);
    expect(libraryCompareHash({ ...base, selection: ['claude'], week: oldest }))
      .toBe(`#compare?view=table&mode=portals&week=${oldest}&portals=claude,chatgpt&device=desktop`);
  });

  it('several portals: those portals side by side for this week, at most four', () => {
    expect(libraryCompareHash({ ...base, selection: ['chatgpt', 'grok'] }))
      .toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=chatgpt,grok&device=desktop`);
    expect(libraryCompareHash({ ...base, selection: SLUGS, device: 'mobile' }))
      .toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude,gemini,perplexity&device=mobile`);
  });

  it('always opens the Table, on Desktop and Mobile', () => {
    expect(libraryCompareHash({ ...base, selection: [], device: 'mobile' })).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&device=mobile`);
    expect(libraryCompareHash({ ...base, selection: ['gemini'], device: 'mobile' }))
      .toBe(`#compare?view=table&mode=time&portal=gemini&weeks=${WEEKS[0]},${WEEKS[1]}&device=mobile`);
  });

  it('writes only parameters Compare already reads back', () => {
    const known = { portals: SLUGS, weeks: WEEKS, max: 4 };
    expect(parseAnalyticsHash(libraryCompareHash({ ...base, selection: ['claude'] }), known))
      .toMatchObject({ view: 'table', mode: 'weeks', portal: 'claude', weeks: [WEEKS[0], WEEKS[1]], device: 'desktop' });
    expect(parseAnalyticsHash(libraryCompareHash({ ...base, selection: [], device: 'mobile' }), known))
      .toEqual({ view: 'table', mode: 'portals', week: WEEKS[0], device: 'mobile' });
  });
});

describe('landing page controls (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const open = async (opts: { width?: number; weeks?: string[] } = {}) => {
    const page = await openSite(browser, '', { portals: PORTALS, ...opts });
    await page.locator('#grid .card:not(.skeleton)').first().waitFor();
    return page;
  };
  const pressed = (page: Page) => page.locator('#filters .chip[aria-pressed="true"]').allTextContents();
  const cardNames = (page: Page) => page.locator('#grid .card .portal-name').allTextContents();
  const compare = async (page: Page) => {
    await page.locator('#compareBtn').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compare');
    return decodeURIComponent(new URL(page.url()).hash);
  };
  const anPressed = (page: Page) => page.locator('#analyticsView .viewtoggle:not(.anc-zoom) .vt-btn[aria-pressed="true"]').allTextContents();

  describe('Compare → button', () => {
    it('is the last control in the bar: a primary button with its own name, as tall as the bar\'s other controls', async () => {
      const page = await open({ width: 1440 });
      const btn = page.locator('#compareBtn');
      expect(await btn.evaluate((b) => [b.tagName, b.getAttribute('type'), b.textContent!.trim(), b.getAttribute('aria-label')]))
        .toEqual(['BUTTON', 'button', 'Compare →', 'Compare the selected portals']);
      expect(await page.locator('.controls-right > *').evaluateAll((els) => els.map((e) => e.className || e.id)))
        .toEqual(['viewtoggle device-toggle', 'weekpick', 'searchbar', 'btn-primary fb-compare']);
      const r = await page.evaluate(() => {
        const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const bar = box('.controls'), b = box('#compareBtn'), cs = getComputedStyle(document.querySelector('#compareBtn')!);
        return { right: bar.right - b.right, height: b.height, toggle: box('.controls .viewtoggle').height, bg: cs.backgroundColor, fg: cs.color };
      });
      expect(r.right).toBeLessThan(20); // at the right end, inside the bar's padding
      expect(r.height).toBe(r.toggle);
      expect(r).toMatchObject({ bg: 'rgb(196, 76, 28)', fg: 'rgb(255, 255, 255)' });
      // White on the fill (and on the hover fill) is at least 4.5:1.
      const lum = (rgb: number[]) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
      expect(1.05 / (lum([196, 76, 28]) + 0.05)).toBeGreaterThanOrEqual(4.5);
      expect(1.05 / (lum([168, 63, 21]) + 0.05)).toBeGreaterThanOrEqual(4.5);
      await page.context().close();
    });

    it('shows a 2px orange ring on keyboard focus and presses to 97%', async () => {
      const page = await open();
      await page.locator('#searchInput').focus();
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => { const el = document.activeElement!; const cs = getComputedStyle(el); return `${el.id} ${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`; });
      expect(ring).toBe('compareBtn 2px solid rgb(196, 76, 28)');
      const b = (await page.locator('#compareBtn').boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);
      expect(await page.locator('#compareBtn').evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(0.97, 0, 0, 0.97, 0, 0)');
      await page.context().close();
    });

    it('All portals opens Across portals in the Table for this week and device', async () => {
      const page = await open();
      expect(await compare(page)).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&device=desktop`);
      expect(await page.locator('#analyticsView').isVisible()).toBe(true);
      expect(await page.locator('#galleryView').isVisible()).toBe(false);
      expect(await anPressed(page)).toEqual(['Across portals', 'Desktop', 'Table']);
      await page.context().close();
    });

    it('one portal opens Single portal over this week and the one before', async () => {
      const page = await open();
      await page.locator('#filters .chip[data-portal="claude"]').click();
      expect(await compare(page)).toBe(`#compare?view=table&mode=time&portal=claude&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
      expect(await anPressed(page)).toEqual(['Single portal', 'Desktop', 'Table']);
      await page.context().close();
    });

    it('two portals open Across portals with those portals', async () => {
      const page = await open();
      await page.locator('#filters .chip[data-portal="claude"]').click();
      await page.locator('.chip-more').click();
      await page.locator('#moreMenuList [data-portal="grok"]').click();
      expect(await compare(page)).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=claude,grok&device=desktop`);
      expect(await page.locator('#anPortals .chip[aria-selected="true"]').allTextContents()).toEqual(['Claude', 'Grok']);
      await page.context().close();
    });

    it('more than four portals: the first four in chip order', async () => {
      const page = await open();
      await page.locator('.chip-more').click();
      await page.locator('#moreMenuList [data-portal="deepseek"]').click();
      for (const slug of ['perplexity', 'gemini', 'chatgpt', 'claude']) await page.locator(`#filters .chip[data-portal="${slug}"]`).click();
      expect(await pressed(page)).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'DeepSeek']);
      expect(await compare(page)).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=chatgpt,claude,gemini,perplexity&device=desktop`);
      await page.context().close();
    });

    it('keeps the week picked on the page', async () => {
      const page = await open();
      await page.locator('.controls .an-wp-btn').click();
      await page.locator(`.controls .an-wp-item[data-v="${WEEKS[2]}"]`).click();
      await expect.poll(() => page.locator('#weekSelect').inputValue()).toBe(WEEKS[2]);
      await page.locator('#filters .chip[data-portal="gemini"]').click();
      expect(await compare(page)).toBe(`#compare?view=table&mode=time&portal=gemini&weeks=${WEEKS[2]},${WEEKS[3]}&device=desktop`);
      await page.context().close();
    });

    it('Mobile opens the Table, with Mobile kept', async () => {
      const page = await open();
      await page.locator('.controls [data-device="mobile"]').click();
      await page.locator('#filters .chip[data-portal="chatgpt"]').click();
      expect(await compare(page)).toBe(`#compare?view=table&mode=time&portal=chatgpt&weeks=${WEEKS[0]},${WEEKS[1]}&device=mobile`);
      expect(await anPressed(page)).toEqual(['Single portal', 'Mobile', 'Table']);
      await page.context().close();
    });

    it('one portal with no older week: Across portals with that portal and the usual second default', async () => {
      const page = await open({ weeks: [WEEKS[0]] });
      await page.locator('#filters .chip[data-portal="perplexity"]').click();
      expect(await compare(page)).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&portals=perplexity,chatgpt&device=desktop`);
      expect(await page.locator('#anPortals .chip[aria-selected="true"]').allTextContents()).toEqual(['ChatGPT', 'Perplexity']);
      await page.context().close();
    });

    it('opens Compare without a frame of the homepage in between, and Back returns to the homepage', async () => {
      const page = await openSite(browser, '', { portals: PORTALS, initScript: probe('#analyticsView', 'compare') });
      await page.locator('#grid .card:not(.skeleton)').first().waitFor();
      await page.locator('#filters .chip[data-portal="claude"]').click();
      await page.locator('#filters .chip[data-portal="gemini"]').click();
      // Frames from the moment the click reaches the page (a capturing listener runs before the button's own).
      await page.evaluate(() => document.addEventListener('click', () => {
        const w = window as unknown as { __frames: unknown[]; __clickAt: number };
        w.__clickAt = w.__frames.length;
      }, { capture: true, once: true }));
      await page.locator('#compareBtn').click();
      await page.locator('#anTableWrap').locator('.an-table, .an-mstack').first().waitFor();
      await page.waitForTimeout(200);
      const log = (await frames(page)).slice(await page.evaluate(() => (window as unknown as { __clickAt: number }).__clickAt));
      expect(log.length).toBeGreaterThan(3);
      expect(log.filter((f) => f.gallery || !f.target)).toEqual([]);
      await page.goBack();
      await page.waitForFunction(() => document.documentElement.dataset.view === 'gallery');
      expect(await page.locator('#galleryView').isVisible()).toBe(true);
      await page.context().close();
    });

    it('is the only Compare button on the landing page, and the Browse | Compare switch is gone', async () => {
      const page = await open();
      const compares = await page.locator('#galleryView button, #galleryView a').evaluateAll((els) =>
        els.filter((e) => /^compare\b/i.test(e.textContent!.trim())).length);
      expect(compares).toBe(1);
      expect(await page.locator('.task-switch, .task-switch-row, [data-task]').count()).toBe(0);
      await page.context().close();
    });
  });

  describe('portal chips', () => {
    it('shows All portals, the first four portals and "+3 more"; chips toggle, All portals clears, and the grid follows', async () => {
      const page = await open();
      expect(await page.locator('#filters .chip').allTextContents()).toEqual(['All portals', 'ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
      expect((await page.locator('.chip-more').textContent())!.trim()).toBe('+3 more');
      expect(await pressed(page)).toEqual(['All portals']);
      expect(await cardNames(page)).toHaveLength(7);

      await page.locator('#filters .chip[data-portal="chatgpt"]').click();
      expect(await pressed(page)).toEqual(['ChatGPT']);
      expect(await cardNames(page)).toEqual(['ChatGPT']);
      await page.locator('#filters .chip[data-portal="claude"]').click();
      expect(await pressed(page)).toEqual(['ChatGPT', 'Claude']);
      expect(await cardNames(page)).toEqual(['ChatGPT', 'Claude']);
      await page.locator('#filters .chip[data-portal="chatgpt"]').click(); // pressing it again unpicks it
      expect(await pressed(page)).toEqual(['Claude']);
      expect(await cardNames(page)).toEqual(['Claude']);
      await page.locator('#filters .chip[data-portal="claude"]').click(); // nothing picked: All portals again
      expect(await pressed(page)).toEqual(['All portals']);
      await page.locator('#filters .chip[data-portal="gemini"]').click();
      await page.locator('#filters .chip[data-portal="all"]').click();
      expect(await pressed(page)).toEqual(['All portals']);
      expect(await cardNames(page)).toHaveLength(7);
      await page.context().close();
    });

    it('scroll in one row without a visible scrollbar', async () => {
      const page = await open({ width: 1024 });
      const row = await page.locator('#filters').evaluate((el) => {
        const cs = getComputedStyle(el);
        const tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
        return { overflowX: cs.overflowX, wrap: cs.flexWrap, oneRow: new Set(tops).size === 1, scrollbar: el.offsetHeight - el.clientHeight };
      });
      expect(row).toEqual({ overflowX: 'auto', wrap: 'nowrap', oneRow: true, scrollbar: 0 });
      await page.context().close();
    });
  });

  describe('"+N more" menu', () => {
    const list = (page: Page) => page.locator('#moreMenuList');
    const isOpen = (page: Page) => page.locator('#moreMenu').evaluate((m) => m.classList.contains('open'));

    it('picking a portal by mouse selects it and shows it as the active chip at the end of the row', async () => {
      const page = await open();
      const btn = page.locator('.chip-more');
      expect(await btn.getAttribute('aria-haspopup')).toBe('listbox');
      await btn.click();
      expect(await btn.getAttribute('aria-expanded')).toBe('true');
      expect(await list(page).locator('[role="option"]').allTextContents()).toEqual(['Copilot', 'Grok', 'DeepSeek']);
      await list(page).locator('[data-portal="grok"]').click();
      expect(await isOpen(page)).toBe(false);
      expect(await page.locator('#filters .chip').allTextContents()).toEqual(['All portals', 'ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok']);
      expect(await pressed(page)).toEqual(['Grok']);
      expect(await cardNames(page)).toEqual(['Grok']);
      expect(await list(page).locator('[aria-selected="true"]').allTextContents()).toEqual(['Grok']);
      // Other chips add to it; unpicking it from the menu takes it out of the row again.
      await page.locator('#filters .chip[data-portal="claude"]').click();
      expect(await pressed(page)).toEqual(['Claude', 'Grok']);
      expect(await cardNames(page)).toEqual(['Claude', 'Grok']);
      await page.locator('.chip-more').click();
      await list(page).locator('[data-portal="copilot"]').click();
      expect(await pressed(page)).toEqual(['Claude', 'Copilot', 'Grok']);
      await page.locator('.chip-more').click();
      expect(await list(page).locator('[aria-selected="true"]').allTextContents()).toEqual(['Copilot', 'Grok']);
      await list(page).locator('[data-portal="grok"]').click();
      expect(await page.locator('#filters .chip').allTextContents()).toEqual(['All portals', 'ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot']);
      expect(await pressed(page)).toEqual(['Claude', 'Copilot']);
      await page.context().close();
    });

    it('works from the keyboard: Enter opens, arrows move, Enter picks, Esc closes back to the button', async () => {
      const page = await open();
      const active = () => page.evaluate(() => document.activeElement!.textContent!.trim());
      await page.locator('.chip-more').focus();
      await page.keyboard.press('Enter');
      expect(await isOpen(page)).toBe(true);
      expect(await active()).toBe('Copilot');
      await page.keyboard.press('ArrowDown');
      expect(await active()).toBe('Grok');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown'); // wraps
      expect(await active()).toBe('Copilot');
      await page.keyboard.press('ArrowUp');
      expect(await active()).toBe('DeepSeek');
      await page.keyboard.press('Escape');
      expect(await isOpen(page)).toBe(false);
      expect(await active()).toBe('+3 more');

      await page.keyboard.press('ArrowDown'); // opens too
      expect(await isOpen(page)).toBe(true);
      await page.keyboard.press('End');
      expect(await active()).toBe('DeepSeek');
      await page.keyboard.press('Enter');
      expect(await isOpen(page)).toBe(false);
      expect(await pressed(page)).toEqual(['DeepSeek']);
      expect(await active()).toBe('DeepSeek'); // focus lands on its chip in the row
      expect(await cardNames(page)).toEqual(['DeepSeek']);
      const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`; });
      expect(ring).toBe('2px solid rgb(196, 76, 28)');
      await page.context().close();
    });

    it('a click outside closes it without picking anything', async () => {
      const page = await open();
      await page.locator('.chip-more').click();
      expect(await isOpen(page)).toBe(true);
      await page.locator('#weekHeading').click();
      expect(await isOpen(page)).toBe(false);
      expect(await pressed(page)).toEqual(['All portals']);
      await page.context().close();
    });

    it('is not shown when there are four portals or fewer', async () => {
      const page = await openSite(browser, '', { portals: PORTALS.slice(0, 4) });
      await page.locator('#grid .card:not(.skeleton)').first().waitFor();
      expect(await page.locator('#moreMenu').isHidden()).toBe(true);
      await page.context().close();
    });
  });

  describe('sticky filter bar', () => {
    const geometry = (page: Page) => page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const bar = r('.controls');
      const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
      return { topbarBottom: r('.topbar').bottom, barTop: bar.top, barBottom: bar.bottom, barOnTop: !!hit?.closest('.controls'),
        position: getComputedStyle(document.querySelector('.controls')!).position };
    });

    it.each([1440, 1024, 390])('at %ipx: stays pinned right under the top bar while scrolling, above the cards', async (width) => {
      const page = await open({ width });
      const atTop = await geometry(page);
      expect(atTop.position).toBe('sticky');
      const firstCard = await page.locator('#grid .card').first().boundingBox();
      expect(firstCard!.y).toBeGreaterThanOrEqual(atTop.barBottom); // the first row starts below the bar
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const scrolled = await geometry(page);
      expect(Math.abs(scrolled.barTop - scrolled.topbarBottom)).toBeLessThanOrEqual(1);
      expect(scrolled.barOnTop).toBe(true);
      // The top bar stays on top of the filter bar.
      const z = await page.evaluate(() => [getComputedStyle(document.querySelector('.topbar')!).zIndex, getComputedStyle(document.querySelector('.controls')!).zIndex].map(Number));
      expect(z[0]).toBeGreaterThan(z[1]);
      await page.context().close();
    });

    it('the phone menu opens over the pinned bar', async () => {
      const page = await open({ width: 390 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.locator('.topnav-toggle').click();
      await page.waitForTimeout(250);
      const covered = await page.evaluate(() => {
        const bar = document.querySelector('.controls')!.getBoundingClientRect();
        const nav = document.querySelector('#site-nav')!.getBoundingClientRect();
        const y = Math.max(bar.top, nav.top) + 5;
        return { overlaps: nav.bottom > bar.top, onTop: !!document.elementFromPoint(nav.left + nav.width / 2, y)?.closest('#site-nav') };
      });
      expect(covered).toEqual({ overlaps: true, onTop: true });
      await page.context().close();
    });
  });

  describe('widths', () => {
    const layout = (page: Page) => page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const bar = r('.controls'), left = r('.fb-portals'), right = r('.controls-right'), btn = r('#compareBtn'), search = r('.searchbar');
      const inside = [...document.querySelectorAll('.controls *')].every((el) => {
        const b = el.getBoundingClientRect();
        return (b.width === 0 && b.height === 0) || el.closest('.an-wp-list, .more-menu-list, #filters > *') /* chips scrolled out of the row are clipped by it */ || (b.left >= bar.left - 0.5 && b.right <= bar.right + 0.5);
      });
      const mid = (b: DOMRect) => b.top + b.height / 2;
      const rightRow = [...document.querySelectorAll('.controls-right > *')].map((el) => Math.round(mid(el.getBoundingClientRect())));
      return {
        noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        oneRow: Math.abs(mid(left) - mid(right)) < 2 && new Set(rightRow).size === 1,
        chipsOnTop: right.top >= left.bottom,
        compareAtRightEnd: Math.abs(btn.right - right.right) < 1 && Math.abs(mid(btn) - mid(search)) < 2,
        compareFullWidthAtBottom: Math.abs(btn.width - right.width) < 1 && btn.top >= search.bottom && Math.abs(btn.bottom - right.bottom) < 1,
        searchFullWidth: Math.abs(search.width - right.width) < 1,
        moreVisible: r('.chip-more').right <= left.right + 0.5,
        inside,
        heights: { topbar: r('.topbar').height, bar: bar.height },
      };
    });
    const focusSearch = async (page: Page) => { await page.locator('#searchInput').focus(); await page.waitForTimeout(300); };

    it.each([1440, 1024])('%ipx: one row with Compare → at the right end, also while the search is focused', async (width) => {
      const page = await open({ width });
      const one = { noSideScroll: true, oneRow: true, compareAtRightEnd: true, moreVisible: true, inside: true };
      expect(await layout(page)).toMatchObject(one);
      await focusSearch(page);
      expect(await layout(page)).toMatchObject(one);
      await page.context().close();
    });

    it('800px: two rows, chips on top, Compare → at the right end of the second row', async () => {
      const page = await open({ width: 800 });
      expect(await layout(page)).toMatchObject({ noSideScroll: true, oneRow: false, chipsOnTop: true, compareAtRightEnd: true, inside: true });
      await page.context().close();
    });

    it.each([390, 360])('%ipx: chips on top, the search full width, then Compare → full width at the bottom; nothing overflows', async (width) => {
      const page = await open({ width });
      const l = await layout(page);
      expect(l).toMatchObject({ noSideScroll: true, chipsOnTop: true, searchFullWidth: true, compareFullWidthAtBottom: true, inside: true });
      const full = await page.evaluate(() => {
        const bar = document.querySelector('.controls')!.getBoundingClientRect();
        return ['.fb-portals', '.controls-right', '.searchbar', '#compareBtn'].map((s) => {
          const b = document.querySelector(s)!.getBoundingClientRect();
          return b.right > bar.right - 20 && b.left < bar.left + 20;
        });
      });
      expect(full).toEqual([true, true, true, true]);
      await focusSearch(page);
      expect(await layout(page)).toMatchObject({ noSideScroll: true, inside: true, compareFullWidthAtBottom: true });
      await page.locator('.chip-more').click(); // the open "+N more" list stays on the page too
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => document.querySelector('#moreMenuList')!.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
      expect((await layout(page)).noSideScroll).toBe(true);
      // Reported in the change summary: the top bar and the filter bar together.
      console.log(`${width}px: top bar ${l.heights.topbar}px + filter bar ${l.heights.bar}px = ${l.heights.topbar + l.heights.bar}px`);
      await page.context().close();
    });

    it('1440px: the search is 170px, widens to 240px on focus over 200ms, and goes back on blur', async () => {
      const page = await open({ width: 1440 });
      const w = () => page.locator('.controls .searchbar').evaluate((el) => el.getBoundingClientRect().width);
      expect(await w()).toBe(170);
      const t = await page.locator('.controls .searchbar').evaluate((el) => { const cs = getComputedStyle(el); return cs.transitionProperty.split(', ').map((p, i) => `${p} ${cs.transitionDuration.split(', ')[i]} ${cs.transitionTimingFunction.split(', ')[i]}`); });
      expect(t).toContain('width 0.2s ease-out');
      await focusSearch(page);
      expect(await w()).toBe(240);
      await page.locator('#searchInput').blur();
      await page.waitForTimeout(300);
      expect(await w()).toBe(170);
      await page.context().close();
    });

    it('with reduced motion the search width does not animate', async () => {
      const page = await openSite(browser, '', { portals: PORTALS, width: 1440, reducedMotion: 'reduce' });
      await page.locator('#grid .card:not(.skeleton)').first().waitFor();
      expect(await page.locator('.controls .searchbar').evaluate((el) => getComputedStyle(el).transitionProperty)).not.toContain('width');
      await page.locator('#searchInput').focus();
      expect(await page.locator('.controls .searchbar').evaluate((el) => el.getBoundingClientRect().width)).toBe(240);
      await page.context().close();
    });
  });

  describe('week dropdown', () => {
    const btn = (page: Page) => page.locator('.controls .an-wp-btn');
    const isOpen = (page: Page) => page.locator('.controls .an-wp').evaluate((el) => el.classList.contains('is-open'));
    const active = (page: Page) => page.evaluate(() => document.activeElement!.textContent!.trim());
    const label = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

    /** Computed styles of the week button (closed, then keyboard-focused), the open list, a hovered option and the
     * selected one, on the Library bar or on Compare (Across portals). Sizes that follow the labels (widths) are left out. */
    const weekStyles = async (hash: string, scope: string) => {
      const page = await openSite(browser, hash, { portals: PORTALS, width: 1440 });
      await page.locator(`${scope} .an-wp-btn`).waitFor();
      await page.waitForTimeout(300);
      const PROPS = ['background-color', 'border-top-color', 'border-top-width', 'border-top-style', 'border-bottom-width', 'border-left-width',
        'border-right-width', 'border-top-left-radius', 'border-bottom-right-radius', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'height', 'box-shadow', 'cursor', 'outline-width',
        'outline-style', 'outline-color', 'outline-offset', 'transform', 'gap', 'max-height', 'top', 'opacity'];
      const read = (sel: string) => page.evaluate(([sel, props]) => {
        const cs = getComputedStyle(document.querySelector(sel as string)!);
        return Object.fromEntries((props as string[]).map((p) => [p, cs.getPropertyValue(p)]));
      }, [sel, PROPS]);
      const out: Record<string, unknown> = {};
      out.button = await read(`${scope} .an-wp-btn`);
      out.chevron = await read(`${scope} .an-wp-chevron`);
      await page.locator(`${scope} .an-wp-btn`).focus();
      await page.keyboard.press('Shift+Tab'); // focus it from the keyboard, so :focus-visible applies
      await page.keyboard.press('Tab');
      out.focused = await read(`${scope} .an-wp-btn`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      out.openChevron = await read(`${scope} .an-wp-chevron`);
      out.list = await read(`${scope} .an-wp-list`);
      out.selected = await read(`${scope} .an-wp-item[aria-selected="true"]`);
      await page.keyboard.press('ArrowDown');
      out.focusedOption = await read(`${scope} .an-wp-item:nth-child(2)`);
      await page.locator(`${scope} .an-wp-item:nth-child(3)`).hover();
      out.hovered = await read(`${scope} .an-wp-item:nth-child(3)`);
      out.texts = await page.locator(`${scope} .an-wp-item`).allTextContents();
      await page.context().close();
      return out;
    };

    it('looks exactly like Compare\'s week dropdown, closed, focused and open', async () => {
      const library = await weekStyles('', '.controls');
      const compare = await weekStyles(`#compare?view=table&mode=portals&week=${WEEKS[0]}`, '#anWeek');
      expect(library).toEqual(compare);
      expect((library.focused as Record<string, string>)['outline-color']).toBe('rgb(196, 76, 28)');
      expect(library.texts).toEqual(WEEKS.map(label));
    });

    it('is the same component: one dropdown in the bar, and no second copy of the old menu', async () => {
      const page = await open();
      expect(await page.locator('.controls .an-wp').count()).toBe(1);
      expect(await page.locator('.controls .week-menu, .controls .week-menu-btn').count()).toBe(0);
      expect(await btn(page).getAttribute('aria-haspopup')).toBe('listbox');
      await page.context().close();
    });

    it('is named "Choose a week" (with the week it shows), and #weekSelect keeps its name and value', async () => {
      const page = await open();
      expect(await page.locator('.controls').getByRole('button', { name: `Choose a week ${label(WEEKS[0])}`, exact: true }).count()).toBe(1);
      expect(await page.locator('#weekSelect').getAttribute('aria-label')).toBe('Choose a week');
      expect(await page.locator('#weekSelect').inputValue()).toBe(WEEKS[0]);
      await page.context().close();
    });

    it('choosing a week updates the cards, the week heading and #weekSelect', async () => {
      const page = await open();
      const heading = await page.locator('#weekHeading').textContent();
      await btn(page).click();
      await page.locator(`.controls .an-wp-item[data-v="${WEEKS[3]}"]`).click();
      await expect.poll(() => page.locator('#weekSelect').inputValue()).toBe(WEEKS[3]);
      await expect.poll(() => page.locator('#weekHeading').textContent()).not.toBe(heading);
      await expect.poll(() => page.locator('#grid .card img').first().getAttribute('src')).toContain(`/${WEEKS[3]}/`);
      expect((await btn(page).locator('.an-wp-current').textContent())!.trim()).toBe(label(WEEKS[3]));
      expect(await isOpen(page)).toBe(false);
      await page.context().close();
    });

    it('works from the keyboard: Enter opens on the selected week, arrows move, Enter picks, Esc closes', async () => {
      const page = await open();
      await btn(page).focus();
      await page.keyboard.press('Enter');
      expect(await isOpen(page)).toBe(true);
      expect(await active(page)).toBe(label(WEEKS[0]));
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      expect(await active(page)).toBe(label(WEEKS[2]));
      await page.keyboard.press('ArrowUp');
      expect(await active(page)).toBe(label(WEEKS[1]));
      await page.keyboard.press('Escape');
      expect(await isOpen(page)).toBe(false);
      expect(await page.evaluate(() => document.activeElement!.classList.contains('an-wp-btn'))).toBe(true);
      await page.keyboard.press('ArrowUp'); // opens on the oldest week
      expect(await active(page)).toBe(label(WEEKS[WEEKS.length - 1]));
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      expect(await isOpen(page)).toBe(false);
      await expect.poll(() => page.locator('#weekSelect').inputValue()).toBe(WEEKS[1]);
      expect(await page.evaluate(() => document.activeElement!.classList.contains('an-wp-btn'))).toBe(true);
      await page.context().close();
    });

    it('closes on a click outside, and when "+N more" opens', async () => {
      const page = await open();
      await btn(page).click();
      expect(await isOpen(page)).toBe(true);
      await page.locator('#weekHeading').click();
      expect(await isOpen(page)).toBe(false);
      await btn(page).click();
      await page.locator('.chip-more').click();
      expect(await isOpen(page)).toBe(false);
      expect(await page.locator('#moreMenu').evaluate((m) => m.classList.contains('open'))).toBe(true);
      await btn(page).click(); // and the other way round
      expect(await isOpen(page)).toBe(true);
      expect(await page.locator('#moreMenu').evaluate((m) => m.classList.contains('open'))).toBe(false);
      expect(await page.locator('#weekSelect').inputValue()).toBe(WEEKS[0]);
      await page.context().close();
    });

    it.each([[1440, 62], [390, 185]])('at %ipx it is as tall as Desktop | Mobile, centred with the search, and the bar stays %ipx tall', async (width, barHeight) => {
      const page = await open({ width });
      const r = await page.evaluate(() => {
        const b = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const mid = (x: DOMRect) => x.top + x.height / 2;
        const week = b('.controls .an-wp-btn'), toggle = b('.controls .viewtoggle'), search = b('.searchbar');
        return { bar: b('.controls').height, week: week.height, toggle: toggle.height, search: search.height, weekToggleMid: Math.abs(mid(week) - mid(toggle)) };
      });
      expect(r.bar).toBe(barHeight);
      expect(r.week).toBe(r.toggle);
      expect(Math.abs(r.week - r.search)).toBeLessThanOrEqual(1); // the search pill is 35px, as before
      expect(r.weekToggleMid).toBeLessThan(1);
      await page.context().close();
    });
  });

  describe('search', () => {
    it('filters the cards as before, keeping its orange focus ring', async () => {
      const page = await open();
      await page.locator('#searchInput').fill('grok');
      await expect.poll(() => cardNames(page)).toEqual(['Grok']);
      const ring = () => page.locator('.controls .searchbar').evaluate((el) => { const cs = getComputedStyle(el); return `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor} ${cs.borderColor}`; });
      await expect.poll(ring).toBe('2px solid rgb(196, 76, 28) rgb(196, 76, 28)');
      await page.locator('#searchInput').fill('');
      await expect.poll(() => cardNames(page)).toHaveLength(7);
      await page.context().close();
    });
  });

  describe('accessible names', () => {
    it('no visible "Filter by portal" label; the chip group keeps the name', async () => {
      const page = await open();
      expect(await page.locator('.controls').innerText()).not.toContain('Filter by portal');
      expect(await page.locator('.fb-label, #filtersLabel').count()).toBe(0);
      expect(await page.locator('#filters').evaluate((el) => [el.getAttribute('role'), el.getAttribute('aria-label'), el.getAttribute('aria-labelledby')]))
        .toEqual(['group', 'Filter by portal', null]);
      await page.context().close();
    });

    it('the week select and the search input keep their names and have visually hidden labels', async () => {
      const page = await open();
      const r = await page.evaluate(() => ['weekSelect', 'searchInput'].map((id) => {
        const label = document.querySelector(`label[for="${id}"]`)!;
        return { aria: document.getElementById(id)!.getAttribute('aria-label'), hidden: label.classList.contains('sr-only') };
      }));
      expect(r).toEqual([{ aria: 'Choose a week', hidden: true }, { aria: 'Search captures', hidden: true }]);
      await page.context().close();
    });
  });

  describe('the rest of the landing page', () => {
    it('keeps its sections in order, with only the filter bar between the hero and the section heading', async () => {
      const page = await open();
      expect(await page.locator('#galleryView > *').evaluateAll((els) => els.map((e) => e.id || e.className)))
        .toEqual(['hero', 'controls', 'section-head', 'grid', 'empty', 'portalIndex', 'manualResults']);
      expect(await page.locator('.topbar').isVisible()).toBe(true);
      expect(await page.locator('footer.sitefoot').isVisible()).toBe(true);
      expect(await page.locator('#grid .card').count()).toBe(7);
      await page.context().close();
    });
  });
});

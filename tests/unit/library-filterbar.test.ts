import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
// @ts-expect-error -- plain browser module without type declarations
import { libraryCompareHash, parseAnalyticsHash } from '../../public/analytics-share.js';
import { openSite, WEEKS } from './analytics-page';

// The landing page's controls: a Browse | Compare switch, then one slim sticky filter bar (portal chips with a
// "+N more" menu, Desktop | Mobile, week, search). Compare opens #compare with this page's portal, week and device.

const PORTALS = [
  { slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' },
  { slug: 'gemini', name: 'Gemini', brand: '#4285f4' }, { slug: 'perplexity', name: 'Perplexity', brand: '#20808d' },
  { slug: 'copilot', name: 'Copilot', brand: '#0078d4' }, { slug: 'grok', name: 'Grok', brand: '#111111' },
  { slug: 'deepseek', name: 'DeepSeek', brand: '#4d6bfe' },
];
const SLUGS = PORTALS.map((p) => p.slug);

describe('libraryCompareHash', () => {
  const base = { weeks: WEEKS, portals: SLUGS, week: WEEKS[0], device: 'desktop' };

  it('All portals: one week on the canvas, Compare picks its default portals', () => {
    expect(libraryCompareHash({ ...base, portal: null })).toBe(`#compare?view=canvas&mode=portals&week=${WEEKS[0]}&device=desktop`);
    expect(libraryCompareHash({ ...base, portal: null, week: WEEKS[2] })).toBe(`#compare?view=canvas&mode=portals&week=${WEEKS[2]}&device=desktop`);
  });

  it('one portal: that portal over this week and the nearest older one', () => {
    expect(libraryCompareHash({ ...base, portal: 'claude' }))
      .toBe(`#compare?view=canvas&mode=time&portal=claude&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
    expect(libraryCompareHash({ ...base, portal: 'grok', week: WEEKS[3] }))
      .toBe(`#compare?view=canvas&mode=time&portal=grok&weeks=${WEEKS[3]},${WEEKS[4]}&device=desktop`);
  });

  it('one portal in the oldest week: Across portals with Compare\'s usual second default', () => {
    const oldest = WEEKS[WEEKS.length - 1];
    expect(libraryCompareHash({ ...base, portal: 'grok', week: oldest }))
      .toBe(`#compare?view=canvas&mode=portals&week=${oldest}&portals=grok,chatgpt&device=desktop`);
    expect(libraryCompareHash({ ...base, portal: 'chatgpt', week: oldest }))
      .toBe(`#compare?view=canvas&mode=portals&week=${oldest}&portals=chatgpt,claude&device=desktop`);
    expect(libraryCompareHash({ ...base, portal: 'claude', week: oldest }))
      .toBe(`#compare?view=canvas&mode=portals&week=${oldest}&portals=claude,chatgpt&device=desktop`);
  });

  it('Mobile opens the Table (the canvas compares desktop screenshots only)', () => {
    expect(libraryCompareHash({ ...base, portal: null, device: 'mobile' })).toBe(`#compare?view=table&mode=portals&week=${WEEKS[0]}&device=mobile`);
    expect(libraryCompareHash({ ...base, portal: 'gemini', device: 'mobile' }))
      .toBe(`#compare?view=table&mode=time&portal=gemini&weeks=${WEEKS[0]},${WEEKS[1]}&device=mobile`);
  });

  it('writes only parameters Compare already reads back', () => {
    const known = { portals: SLUGS, weeks: WEEKS, max: 4 };
    expect(parseAnalyticsHash(libraryCompareHash({ ...base, portal: 'claude' }), known))
      .toMatchObject({ view: 'canvas', mode: 'weeks', portal: 'claude', weeks: [WEEKS[0], WEEKS[1]], device: 'desktop' });
    expect(parseAnalyticsHash(libraryCompareHash({ ...base, portal: null, device: 'mobile' }), known))
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
    await page.locator('.task-switch [data-task="compare"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compare');
    return decodeURIComponent(new URL(page.url()).hash);
  };
  const anPressed = (page: Page) => page.locator('#analyticsView .viewtoggle:not(.anc-zoom) .vt-btn[aria-pressed="true"]').allTextContents();

  describe('Browse | Compare switch', () => {
    it('sits above the filter bar as a labelled group of two pressed-state buttons, Browse on, at least 44px tall', async () => {
      const page = await open();
      const sw = page.locator('.task-switch');
      expect(await sw.getAttribute('role')).toBe('group');
      expect(await sw.getAttribute('aria-label')).toBeTruthy();
      const btns = await sw.locator('button').evaluateAll((els) => els.map((b) => `${b.textContent!.trim()}:${b.getAttribute('aria-pressed')}:${b.getAttribute('type')}`));
      expect(btns).toEqual(['Browse:true:button', 'Compare:false:button']);
      const s = (await sw.boundingBox())!;
      const bar = (await page.locator('.controls').boundingBox())!;
      expect(s.height).toBeGreaterThanOrEqual(44);
      expect(s.y + s.height).toBeLessThanOrEqual(bar.y);
      expect(Math.abs(s.x - bar.x)).toBeLessThan(1); // left-aligned with the bar
      await page.context().close();
    });

    it('Compare with All portals opens Across portals for this week and device', async () => {
      const page = await open();
      expect(await compare(page)).toBe(`#compare?view=canvas&mode=portals&week=${WEEKS[0]}&device=desktop`);
      expect(await page.locator('#analyticsView').isVisible()).toBe(true);
      expect(await page.locator('#galleryView').isVisible()).toBe(false);
      expect(await anPressed(page)).toEqual(['Across portals', 'Desktop', 'Canvas']);
      await page.context().close();
    });

    it('Compare with one portal opens Single portal over this week and the one before', async () => {
      const page = await open();
      await page.locator('#filters .chip[data-portal="claude"]').click();
      expect(await compare(page)).toBe(`#compare?view=canvas&mode=time&portal=claude&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
      expect(await anPressed(page)).toEqual(['Single portal', 'Desktop', 'Canvas']);
      await page.context().close();
    });

    it('keeps the week picked on the page', async () => {
      const page = await open();
      await page.locator('.controls .week-menu-btn').click();
      await page.locator(`.controls .week-option[data-week="${WEEKS[2]}"]`).click();
      await expect.poll(() => page.locator('#weekSelect').inputValue()).toBe(WEEKS[2]);
      await page.locator('#filters .chip[data-portal="gemini"]').click();
      expect(await compare(page)).toBe(`#compare?view=canvas&mode=time&portal=gemini&weeks=${WEEKS[2]},${WEEKS[3]}&device=desktop`);
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
      expect(await compare(page)).toBe(`#compare?view=canvas&mode=portals&week=${WEEKS[0]}&portals=perplexity,chatgpt&device=desktop`);
      expect(await page.locator('#anPortals .chip[aria-selected="true"]').allTextContents()).toEqual(['ChatGPT', 'Perplexity']);
      await page.context().close();
    });

    it('is the only Compare button on the landing page', async () => {
      const page = await open();
      const compares = await page.locator('#galleryView button, #galleryView a').evaluateAll((els) =>
        els.filter((e) => /^compare$/i.test(e.textContent!.trim())).length);
      expect(compares).toBe(1);
      await page.context().close();
    });
  });

  describe('portal chips', () => {
    it('shows All portals, the first four portals and "+3 more"; one chip is active at a time and the grid follows it', async () => {
      const page = await open();
      expect(await page.locator('#filters .chip').allTextContents()).toEqual(['All portals', 'ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
      expect((await page.locator('.chip-more').textContent())!.trim()).toBe('+3 more');
      expect(await pressed(page)).toEqual(['All portals']);
      expect(await cardNames(page)).toHaveLength(7);

      await page.locator('#filters .chip[data-portal="chatgpt"]').click();
      expect(await pressed(page)).toEqual(['ChatGPT']);
      expect(await cardNames(page)).toEqual(['ChatGPT']);
      await page.locator('#filters .chip[data-portal="claude"]').click();
      expect(await pressed(page)).toEqual(['Claude']);
      expect(await cardNames(page)).toEqual(['Claude']);
      await page.locator('#filters .chip[data-portal="claude"]').click(); // pressing it again keeps it
      expect(await pressed(page)).toEqual(['Claude']);
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
      // Another chip replaces it; the row goes back to the first four.
      await page.locator('#filters .chip[data-portal="claude"]').click();
      expect(await pressed(page)).toEqual(['Claude']);
      expect(await page.locator('#filters .chip').allTextContents()).toEqual(['All portals', 'ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok']);
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
      expect(ring).toBe('2px solid rgb(235, 98, 44)');
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
      const bar = r('.controls'), left = r('.fb-portals'), right = r('.controls-right');
      const inside = [...document.querySelectorAll('.controls *')].every((el) => {
        const b = el.getBoundingClientRect();
        return (b.width === 0 && b.height === 0) || el.closest('.week-menu-list, .more-menu-list, #filters > *') /* chips scrolled out of the row are clipped by it */ || (b.left >= bar.left - 0.5 && b.right <= bar.right + 0.5);
      });
      return {
        noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        oneRow: Math.abs((left.top + left.height / 2) - (right.top + right.height / 2)) < 2,
        chipsOnTop: right.top >= left.bottom,
        inside,
        heights: { topbar: r('.topbar').height, bar: bar.height },
      };
    });

    it('1440px and 1024px: one row', async () => {
      for (const width of [1440, 1024]) {
        const page = await open({ width });
        expect(await layout(page)).toMatchObject({ noSideScroll: true, oneRow: true, inside: true });
        await page.context().close();
      }
    });

    it('800px: two rows, chips on top', async () => {
      const page = await open({ width: 800 });
      expect(await layout(page)).toMatchObject({ noSideScroll: true, oneRow: false, chipsOnTop: true, inside: true });
      await page.context().close();
    });

    it('390px: chips on top, everything full width, nothing overflows; the search widens on focus without overflowing', async () => {
      const page = await open({ width: 390 });
      const l = await layout(page);
      expect(l).toMatchObject({ noSideScroll: true, chipsOnTop: true, inside: true });
      const full = await page.evaluate(() => {
        const bar = document.querySelector('.controls')!.getBoundingClientRect();
        return ['.fb-portals', '.controls-right', '.searchbar', '.task-switch'].map((s) => {
          const b = document.querySelector(s)!.getBoundingClientRect();
          return s === '.task-switch' ? Math.round(b.width) === Math.round(bar.width) : b.right > bar.right - 20 && b.left < bar.left + 20;
        });
      });
      expect(full).toEqual([true, true, true, true]);
      await page.locator('#searchInput').focus();
      await page.waitForTimeout(250);
      expect((await layout(page)).noSideScroll).toBe(true);
      await page.locator('.chip-more').click(); // the open "+N more" list stays on the page too
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => document.querySelector('#moreMenuList')!.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
      expect((await layout(page)).noSideScroll).toBe(true);
      // Reported in the change summary: the top bar and the filter bar together.
      console.log(`390px: top bar ${l.heights.topbar}px + filter bar ${l.heights.bar}px = ${l.heights.topbar + l.heights.bar}px`);
      await page.context().close();
    });

    it('1440px: the search starts compact and widens on focus', async () => {
      const page = await open({ width: 1440 });
      const w = () => page.locator('.controls .searchbar').evaluate((el) => el.getBoundingClientRect().width);
      expect(await w()).toBeLessThanOrEqual(170);
      await page.locator('#searchInput').focus();
      await page.waitForTimeout(300);
      expect(await w()).toBe(240);
      expect((await layout(page)).noSideScroll).toBe(true);
      await page.context().close();
    });
  });

  describe('accessible names', () => {
    it('the week select and the search input keep their names and have visually hidden labels', async () => {
      const page = await open();
      const r = await page.evaluate(() => ['weekSelect', 'searchInput'].map((id) => {
        const label = document.querySelector(`label[for="${id}"]`)!;
        return { aria: document.getElementById(id)!.getAttribute('aria-label'), hidden: label.classList.contains('sr-only') };
      }));
      expect(r).toEqual([{ aria: 'Choose a week', hidden: true }, { aria: 'Search captures', hidden: true }]);
      expect(await page.locator('#filters').getAttribute('aria-labelledby')).toBe('filtersLabel');
      await page.context().close();
    });
  });
});

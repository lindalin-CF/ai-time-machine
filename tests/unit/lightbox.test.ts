import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { handlePortalPage } from '../../src/portal-page';
import { handleComparePage } from '../../src/compare-page';
import { makeEnv } from './fake-env';
import { openSite } from './analytics-page';

// The screenshot lightbox (public/lightbox.js, public/lightbox.css) on the server-rendered pages: /portals/<slug>,
// /portals/<slug>/<week> and /compare/<a>-vs-<b>. Each screenshot is a link to its original file; with JS it opens
// the lightbox: prev / next and ←/→ between the page's screenshots, Actual size, Download PNG, and dialog focus rules.
// The homepage's lightbox (same module) keeps its own tests: analytics-canvas-click, ga-events, site-menu.

const WEEK = '2026-10-12', OLD = '2026-10-05';
/** 1200 x 630: wider than the fitted frame at every test width, so Actual size scrolls. */
const BIG_PNG = readFileSync(new URL('../../public/og-image.png', import.meta.url));

const STUB = `window.gtag = function () {
  const log = JSON.parse(sessionStorage.getItem('ga') || '[]');
  log.push([...arguments]);
  sessionStorage.setItem('ga', JSON.stringify(log));
};`;

function seed(t: ReturnType<typeof makeEnv>) {
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f')`);
  for (const week of [WEEK, OLD]) {
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
    for (const [slug, name] of [['chatgpt', 'ChatGPT'], ['claude', 'Claude']]) {
      t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, r2_key_mobile, analysis, analysis_by, captured_at)
                 VALUES ('${slug}-${week}', '${week}', '${slug}', '${name}', 'Co', 'https://x/', '#000000',
                         'shots/${week}/${slug}.local.png', 'shots/${week}/${slug}.mobile.png', '', 'pending', '${week}T09:00:00Z')`);
    }
  }
}

const PORTAL = '/portals/chatgpt', PORTAL_WEEK = `/portals/chatgpt/${OLD}`, COMPARE = '/compare/chatgpt-vs-claude';
const v = Date.parse(`${WEEK}T09:00:00Z`);
const DESKTOP = `/img/shots/${WEEK}/chatgpt.local.png?v=${v}`;
const MOBILE = `/img/shots/${WEEK}/chatgpt.mobile.png?v=${v}`;
const CLAUDE = `/img/shots/${WEEK}/claude.local.png?v=${v}`;

let pages: Record<string, string>;
let browser: Browser;
beforeAll(async () => {
  const t = makeEnv();
  seed(t);
  pages = {};
  for (const path of [PORTAL, PORTAL_WEEK]) pages[path] = await (await handlePortalPage(new Request(`https://site.test${path}`), t.env)).text();
  pages[COMPARE] = await (await handleComparePage(new Request(`https://site.test${COMPARE}`), t.env)).text();
  browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); });

const open = async (path: string, opts: Parameters<typeof openSite>[2] = {}) => {
  const page = await openSite(browser, path.slice(1), { pages, shotPng: BIG_PNG, ...opts });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { page, errors };
};

const lb = (page: Page) => page.evaluate(() => {
  const el = document.querySelector('.lb') as HTMLElement | null;
  const img = document.querySelector('.lb-img') as HTMLImageElement | null;
  return el && {
    open: !el.hidden && el.classList.contains('lb--open'),
    hidden: el.hidden,
    src: img?.getAttribute('src') ?? null,
    count: document.querySelector('.lb-count')?.textContent,
    caption: document.querySelector('.lb-text')?.textContent,
    focusInside: el.contains(document.activeElement),
    bodyOverflow: document.body.style.overflow,
  };
});
const waitClosed = (page: Page) => page.waitForFunction(() => (document.querySelector('.lb') as HTMLElement).hidden);

describe('server pages: screenshot links (HTML)', () => {
  it('a portal page wraps each screenshot in a link to its original file, with a label and the GA4 params', () => {
    const html = pages[PORTAL];
    expect(html).toContain(`<a class="shot-link" href="${DESKTOP}" aria-label="Open the ChatGPT desktop screenshot, week of October 12, 2026, full size" data-full="${DESKTOP}" data-lb-group="shots" data-title="ChatGPT" data-caption="ChatGPT · Desktop · week of October 12, 2026" data-file="chatgpt-${WEEK}" data-ga-image="chatgpt-${WEEK}-desktop" data-ga-source="weekly_capture" data-ga-portal="chatgpt" data-ga-week="${WEEK}" data-ga-device="desktop"><img src="${DESKTOP}"`);
    expect(html).toContain(`aria-label="Open the ChatGPT mobile screenshot, week of October 12, 2026, full size" data-full="${MOBILE}"`);
    expect(html).toContain('data-file="chatgpt-2026-10-12-mobile" data-ga-image="chatgpt-2026-10-12-mobile"');
    expect(html).toContain('<link rel="stylesheet" href="/lightbox.css" />');
    expect(html).toContain('<script type="module">import { initLightbox } from "/lightbox.js"; initLightbox();</script>');
    // No transformed copy: the link and the lightbox use the original file.
    expect(html).not.toContain('/cdn-cgi/image/');
  });

  it('a compare page links both portals\' screenshots as one set', () => {
    const html = pages[COMPARE];
    expect(html).toContain(`aria-label="Open the ChatGPT desktop screenshot, week of October 12, 2026, full size" data-full="${DESKTOP}" data-lb-group="shots"`);
    expect(html).toContain(`aria-label="Open the Claude desktop screenshot, week of October 12, 2026, full size" data-full="${CLAUDE}" data-lb-group="shots"`);
  });
});

describe('server pages: lightbox (browser)', () => {
  it('a screenshot link shows a zoom-in cursor', async () => {
    const { page } = await open(PORTAL);
    expect(await page.locator('.shot-link').first().evaluate((a) => getComputedStyle(a).cursor)).toBe('zoom-in');
    await page.context().close();
  });

  it.each([
    [PORTAL, 0, DESKTOP, '1 / 2', 'ChatGPT · Desktop · week of October 12, 2026'],
    [PORTAL, 1, MOBILE, '2 / 2', 'ChatGPT · Mobile · week of October 12, 2026'],
    [COMPARE, 0, DESKTOP, '1 / 2', 'ChatGPT · Desktop · week of October 12, 2026'],
    [COMPARE, 1, CLAUDE, '2 / 2', 'Claude · Desktop · week of October 12, 2026'],
  ])('%s: clicking screenshot %i opens the lightbox with its original image', async (path, i, src, count, caption) => {
    const { page, errors } = await open(path);
    const link = page.locator('.shot-link').nth(i);
    expect(await link.getAttribute('href')).toBe(src);
    await link.click();
    await page.waitForFunction(() => document.querySelector('.lb')?.classList.contains('lb--open'));
    expect(page.url()).toBe(`https://site.test${path}`); // the link did not navigate
    expect(await lb(page)).toMatchObject({ open: true, src, count, caption, focusInside: true, bodyOverflow: 'hidden' });
    const dialog = page.locator('.lb');
    expect(await dialog.getAttribute('role')).toBe('dialog');
    expect(await dialog.getAttribute('aria-modal')).toBe('true');
    expect(await dialog.getAttribute('aria-label')).toBe(caption);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('←/→ and the prev / next buttons move between the page\'s screenshots, with the counter and caption', async () => {
    const { page } = await open(PORTAL);
    await page.locator('.shot-link').first().click();
    await page.keyboard.press('ArrowRight');
    expect(await lb(page)).toMatchObject({ src: MOBILE, count: '2 / 2', caption: 'ChatGPT · Mobile · week of October 12, 2026' });
    await page.keyboard.press('ArrowRight'); // wraps around
    expect(await lb(page)).toMatchObject({ src: DESKTOP, count: '1 / 2' });
    await page.keyboard.press('ArrowLeft');
    expect(await lb(page)).toMatchObject({ src: MOBILE, count: '2 / 2' });
    await page.locator('.lb-prev').click();
    expect(await lb(page)).toMatchObject({ src: DESKTOP, count: '1 / 2' });
    await page.locator('.lb-next').click();
    expect(await lb(page)).toMatchObject({ src: MOBILE, count: '2 / 2' });
    expect(await page.locator('.lb-prev').getAttribute('aria-label')).toBe('Previous screenshot');
    expect(await page.locator('.lb-next').getAttribute('aria-label')).toBe('Next screenshot');
    await page.context().close();
  });

  it('a single screenshot has no counter and no prev / next', async () => {
    const t = makeEnv();
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${WEEK}', 'w', '${WEEK}T00:00:00Z')`);
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
               VALUES ('claude-${WEEK}', '${WEEK}', 'claude', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757', 'shots/${WEEK}/claude.local.png', '', 'pending', '${WEEK}T09:00:00Z')`);
    const html = await (await handlePortalPage(new Request('https://site.test/portals/claude'), t.env)).text();
    const page = await openSite(browser, 'portals/claude', { pages: { '/portals/claude': html }, shotPng: BIG_PNG });
    await page.locator('.shot-link').click();
    expect(await page.locator('.lb-count').isVisible()).toBe(false);
    expect(await page.locator('.lb-prev').isVisible()).toBe(false);
    expect(await page.locator('.lb-next').isVisible()).toBe(false);
    expect(await page.locator('.lb-text').textContent()).toBe('Claude · Desktop · week of October 12, 2026');
    await page.context().close();
  });

  it('opens fitted to the viewport; Actual size (button or a click on the image) shows it 1:1 and scrolls, and toggles back', async () => {
    const { page } = await open(PORTAL, { width: 1000, height: 700 });
    await page.locator('.shot-link').first().click();
    await page.waitForFunction(() => (document.querySelector('.lb-img') as HTMLImageElement).complete);
    const size = () => page.evaluate(() => {
      const img = document.querySelector('.lb-img') as HTMLImageElement;
      const fig = document.querySelector('.lb-figure') as HTMLElement;
      return { w: img.offsetWidth, natural: img.naturalWidth, figW: fig.clientWidth, scrolls: fig.scrollWidth > fig.clientWidth,
        vw: innerWidth, vh: innerHeight, h: img.offsetHeight, pressed: document.querySelector('.lb-actual')!.getAttribute('aria-pressed') };
    });
    const fit = await size();
    expect(fit.natural).toBe(1200);
    expect(fit.w).toBeLessThan(fit.vw);
    expect(fit.h).toBeLessThan(fit.vh);
    expect(fit).toMatchObject({ scrolls: false, pressed: 'false' });

    await page.locator('.lb-actual').click();
    expect(await size()).toMatchObject({ w: 1200, scrolls: true, pressed: 'true' });
    await page.locator('.lb-actual').click();
    expect(await size()).toMatchObject({ w: fit.w, scrolls: false, pressed: 'false' });

    await page.locator('.lb-img').click(); // a click on the image
    expect(await size()).toMatchObject({ w: 1200, scrolls: true, pressed: 'true' });
    await page.locator('.lb-figure').click();
    expect(await size()).toMatchObject({ w: fit.w, scrolls: false, pressed: 'false' });
    await page.context().close();
  });

  it('in Actual size a mouse drag pans the image and does not toggle back', async () => {
    const { page } = await open(PORTAL, { width: 1000, height: 700 });
    await page.locator('.shot-link').first().click();
    await page.locator('.lb-actual').click();
    const fig = page.locator('.lb-figure');
    const before = await fig.evaluate((f) => f.scrollLeft);
    const box = (await fig.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await fig.evaluate((f) => f.scrollLeft)).toBe(before - 60);
    expect(await page.locator('.lb-actual').getAttribute('aria-pressed')).toBe('true');
    await page.context().close();
  });

  it('Esc closes and returns focus to the clicked screenshot; the page scrolls again', async () => {
    const { page } = await open(PORTAL_WEEK);
    await page.locator('.shot-link').nth(1).click();
    await page.keyboard.press('ArrowLeft'); // focus goes back to the clicked one, not the one on screen
    await page.keyboard.press('Escape');
    await waitClosed(page);
    expect(await lb(page)).toMatchObject({ hidden: true, src: null, bodyOverflow: '' });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-ga-device'))).toBe('mobile');
    await page.context().close();
  });

  it('a click on the backdrop closes it; so does the close button', async () => {
    const { page } = await open(COMPARE);
    await page.locator('.shot-link').first().click();
    await page.mouse.click(4, 4);
    await waitClosed(page);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-ga-portal'))).toBe('chatgpt');
    await page.locator('.shot-link').nth(1).click();
    await page.locator('.lb-close').click();
    await waitClosed(page);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-ga-portal'))).toBe('claude');
    await page.context().close();
  });

  it('keeps focus inside the dialog with Tab and Shift+Tab', async () => {
    const { page } = await open(PORTAL);
    await page.locator('.shot-link').first().click();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect((await lb(page))!.focusInside).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect((await lb(page))!.focusInside).toBe(true);
    }
    await page.context().close();
  });

  it('opens from the keyboard (Enter on the link)', async () => {
    const { page } = await open(PORTAL);
    await page.locator('.shot-link').first().focus();
    await page.keyboard.press('Enter');
    expect(await lb(page)).toMatchObject({ open: true, src: DESKTOP });
    await page.context().close();
  });

  it('Download PNG sends file_download with the shot\'s image_id, source, portal, week and device', async () => {
    const { page, errors } = await open(PORTAL, { initScript: STUB });
    await page.locator('.shot-link').nth(1).click();
    const download = page.waitForEvent('download');
    await page.locator('.lb-download').click();
    expect((await download).suggestedFilename()).toBe(`chatgpt-${WEEK}-mobile.png`);
    await page.waitForFunction(() => (JSON.parse(sessionStorage.getItem('ga') || '[]') as unknown[][]).some((c) => c[1] === 'file_download'));
    const events = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('ga') || '[]') as unknown[][]).filter((c) => c[0] === 'event').map((c) => [c[1], c[2]]));
    expect(events).toEqual([['file_download', {
      download_type: 'screenshot_png', file_name: `chatgpt-${WEEK}-mobile.png`, file_extension: 'png',
      image_id: `chatgpt-${WEEK}-mobile`, image_source: 'weekly_capture', portal: 'chatgpt', week: WEEK, device: 'mobile',
    }]]);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('without JS the link opens the original image', async () => {
    const { page } = await open(PORTAL, { javaScriptEnabled: false });
    await page.locator('.shot-link').first().click();
    await page.waitForURL(`https://site.test${DESKTOP}`);
    await page.context().close();
  });

  it('opens and closes with opacity and scale(.96 → 1) over 200ms ease-out, and without motion under reduced motion', async () => {
    const motion = async (reducedMotion: 'reduce' | 'no-preference') => {
      const { page } = await open(PORTAL, { reducedMotion });
      await page.locator('.shot-link').first().click();
      const r = await page.evaluate(() => {
        const lbCs = getComputedStyle(document.querySelector('.lb')!);
        const fig = document.querySelector('.lb-figure') as HTMLElement;
        const figCs = getComputedStyle(fig);
        const el = document.querySelector('.lb')!;
        const lbStyle = { lb: `${lbCs.transitionProperty} ${lbCs.transitionDuration} ${lbCs.transitionTimingFunction}`, fig: `${figCs.transitionProperty} ${figCs.transitionDuration}` };
        // The closed state's values, read with transitions off (otherwise this reads a value mid-transition).
        (el as HTMLElement).style.transition = fig.style.transition = 'none';
        el.classList.remove('lb--open');
        const closed = { opacity: getComputedStyle(el).opacity, transform: getComputedStyle(fig).transform };
        el.classList.add('lb--open');
        (el as HTMLElement).style.transition = fig.style.transition = '';
        return { ...lbStyle, closed };
      });
      await page.context().close();
      return r;
    };
    expect(await motion('no-preference')).toEqual({ lb: 'opacity 0.2s ease-out', fig: 'transform 0.2s', closed: { opacity: '0', transform: 'matrix(0.96, 0, 0, 0.96, 0, 0)' } });
    const reduced = await motion('reduce');
    expect(reduced.lb).toMatch(/ 0s /);
    expect(reduced.fig).toMatch(/ 0s$/);
    expect(reduced.closed.transform).toBe('none');
  });

  it('on a phone it is full-screen, and Actual size allows pinch-zoom', async () => {
    const { page } = await open(PORTAL, { width: 390, height: 844, hasTouch: true });
    await page.locator('.shot-link').first().click();
    const fig = page.locator('.lb-figure');
    await page.waitForTimeout(300); // the open transition's scale
    expect(await fig.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(await fig.evaluate((f) => getComputedStyle(f).touchAction)).toBe('none');
    await page.locator('.lb-actual').tap();
    // Chrome reports pan-x pan-y pinch-zoom as its shorthand, manipulation.
    expect(await fig.evaluate((f) => getComputedStyle(f).touchAction)).toMatch(/^(manipulation|pan-x pan-y pinch-zoom)$/);
    expect(await fig.evaluate((f) => f.scrollWidth > f.clientWidth)).toBe(true);
    await page.context().close();
  });
});

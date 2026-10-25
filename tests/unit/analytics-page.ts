// Opens the homepage (gallery or #compare) in Playwright with the static files from public/ and a mocked API,
// for the Analytics canvas browser tests. Nothing leaves the test host.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';

const PUBLIC = new URL('../../public/', import.meta.url);
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8').replace('<html lang="en"', '<html data-consent="not-required" lang="en"');
const PNG = readFileSync(new URL('icons/chatgpt.png', PUBLIC));
/** 16 x 10, the shape of a desktop capture (1280 x 800), so cards keep their height when it loads. */
const SHOT_PNG = readFileSync(new URL('../fixtures/note-image.png', import.meta.url));

/** Six weeks, newest first, so multi-week picks can reach the limit of four. */
export const WEEKS = ['2026-09-28', '2026-09-21', '2026-09-07', '2026-08-24', '2026-08-17', '2026-08-10'];
const cap = (slug: string, portal: string, week = WEEKS[0], metrics: unknown = null, status = 'ok') => ({
  id: `${slug}-${week}`, slug, portal, company: 'Co', url: 'https://x/', brand: '#888888', week,
  image: `/img/shots/${week}/${slug}.png?v=1`, imageMobile: `/img/shots/${week}/${slug}.mobile.png?v=1`, hasMobile: true,
  width: 1280, height: 800, mobileWidth: 780, mobileHeight: 1688,
  palette: [], analysis: '', analysisBy: 'pending', status, capturedAt: `${week}T09:00:00Z`, metrics,
});
const API: Record<string, unknown> = {
  '/api/stats': { screenshots: 2, portals: 2, weeks: 1 },
  '/api/portals': { portals: [{ slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' }] },
  '/api/weeks': { weeks: WEEKS.map((week) => ({ week, label: `Week of ${week}` })) },
};
type Portal = { slug: string; name: string; brand: string };
const PORTALS: Portal[] = [{ slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' }];
const captures = (week: string, portals: Portal[], metrics: Record<string, unknown>, statuses: Record<string, string>) =>
  ({ week, label: `Week of ${week}`, captures: portals.map((p) => cap(p.slug, p.name, week, metrics[`${p.slug}@${week}`] ?? null, statuses[`${p.slug}@${week}`] ?? 'ok')) });

type SiteOpts = { width?: number; height?: number; hasTouch?: boolean; javaScriptEnabled?: boolean; reducedMotion?: 'reduce' | 'no-preference'; clipboard?: boolean; storage?: Record<string, string>; initScript?: string; shotShaped?: boolean; shotPng?: Buffer; weeks?: string[]; clock?: boolean; pages?: Record<string, string>;
  portals?: Portal[]; metrics?: Record<string, unknown>; statuses?: Record<string, string> };

/** The homepage at `hash` ("" for the gallery), loaded. `storage` is put in localStorage and `initScript` runs before the page does;
 * `weeks` (newest first) replaces the archived weeks, `portals` the products, and `metrics` (by "<slug>@<week>") gives captures their metrics; `statuses` (same keys) their status ('ok' by default). `pages` serves more HTML pages by path (for example a server-rendered portal page), and `shotPng` is the image every /img/ path returns. `clock` installs Playwright's fake timers before the page runs (time still
 * flows until a test pauses it with pauseClock()). */
export async function openSite(browser: Browser, hash: string, opts: SiteOpts = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 }, hasTouch: opts.hasTouch, javaScriptEnabled: opts.javaScriptEnabled, reducedMotion: opts.reducedMotion });
  if (opts.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://site.test' });
  if (opts.initScript) await context.addInitScript({ content: opts.initScript });
  if (opts.storage) await context.addInitScript((items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }, opts.storage);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'site.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: INDEX_HTML });
    if (opts.pages?.[url.pathname]) return route.fulfill({ contentType: 'text/html', body: opts.pages[url.pathname] });
    if (url.pathname === '/api/captures') return route.fulfill({ json: captures(url.searchParams.get('week') || WEEKS[0], opts.portals ?? PORTALS, opts.metrics ?? {}, opts.statuses ?? {}) });
    if (url.pathname === '/api/portals' && opts.portals) return route.fulfill({ json: { portals: opts.portals } });
    if (url.pathname === '/api/weeks' && opts.weeks) return route.fulfill({ json: { weeks: opts.weeks.map((week) => ({ week, label: `Week of ${week}` })) } });
    if (API[url.pathname]) return route.fulfill({ json: API[url.pathname] });
    if (url.pathname.startsWith('/img/')) return route.fulfill({ contentType: 'image/png', body: opts.shotPng ?? (opts.shotShaped ? SHOT_PNG : PNG) });
    if (url.pathname.startsWith('/agents/')) return route.fulfill({ status: 404, body: '' });
    try {
      return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(new URL(`.${url.pathname}`, PUBLIC)) });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  if (opts.clock) await page.clock.install();
  await page.goto(`https://site.test/${hash}`);
  await page.waitForLoadState('load');
  return page;
}

/**
 * Runs before each page: on every DOM change and every animation frame, records which views are visible and
 * whether the nav link for `view` is coloured as active. Frames before styles.css has loaded are skipped (the
 * browser does not paint them), so pages without it (server-rendered pages) record nothing.
 */
export const probe = (view: string, nav: string) => `(() => {
  const frames = window.__frames = [];
  const check = () => {
    const css = document.querySelector('link[href="/styles.css"]');
    if (!css || !css.sheet || !document.body) return;
    const vis = (sel) => { const el = document.querySelector(sel); return !!el && el.checkVisibility(); };
    const link = document.querySelector('.topnav-link[data-nav="${nav}"]');
    const other = document.querySelector('.topnav-link:not([data-nav="${nav}"])');
    frames.push({
      gallery: vis('#galleryView') || vis('.hero'),
      target: vis('${view}'),
      navActive: !!link && !!other && getComputedStyle(link).color !== getComputedStyle(other).color,
      loading: !!document.querySelector('#anCanvasWrap .an-loading'),
      routed: !!document.querySelector('.topnav-link.active'),
    });
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
  const tick = () => { check(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();`;

export type Frame = { gallery: boolean; target: boolean; navActive: boolean; loading: boolean; routed: boolean };
/** The frames probe() recorded on the current page. */
export const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

/** Stop the page's timers (setTimeout, requestAnimationFrame); after this only page.clock.runFor() moves them on.
 * The page's fake time keeps running until pauseAt() arrives, so it jumps 10s ahead to stay in the future (a target in
 * the past throws); timers due by then fire first. Call it once earlier changes have settled. Needs { clock: true } in openSite. */
export async function pauseClock(page: Page): Promise<void> {
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 10_000);
}

/** The Analytics view switched from the default Canvas to Table (stacked cards at 640px and below), ready to use. */
export async function openAnalytics(browser: Browser, opts: SiteOpts = {}): Promise<Page> {
  const page = await openSite(browser, '#compare', opts);
  await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
  await page.locator('[data-anview="table"]').click();
  await page.locator('#anTableWrap').locator('.an-table, .an-mstack').first().waitFor();
  return page;
}

/** Switch to Canvas and wait for the board (wide screens) or the stacked cards (narrow screens). */
export async function showCanvas(page: Page): Promise<void> {
  await page.locator('[data-anview="canvas"]').click();
  await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
}

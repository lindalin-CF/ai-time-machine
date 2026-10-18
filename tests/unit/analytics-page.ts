// Opens the homepage (gallery or #analytics) in Playwright with the static files from public/ and a mocked API,
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
const cap = (slug: string, portal: string, week = WEEKS[0]) => ({
  id: `${slug}-${week}`, slug, portal, company: 'Co', url: 'https://x/', brand: '#888888', week,
  image: `/img/shots/${week}/${slug}.png?v=1`, imageMobile: `/img/shots/${week}/${slug}.mobile.png?v=1`, hasMobile: true,
  width: 1280, height: 800, mobileWidth: 780, mobileHeight: 1688,
  palette: [], analysis: '', analysisBy: 'pending', status: 'ok', capturedAt: `${week}T09:00:00Z`, metrics: null,
});
const API: Record<string, unknown> = {
  '/api/stats': { screenshots: 2, portals: 2, weeks: 1 },
  '/api/portals': { portals: [{ slug: 'chatgpt', name: 'ChatGPT', brand: '#10a37f' }, { slug: 'claude', name: 'Claude', brand: '#d97757' }] },
  '/api/weeks': { weeks: WEEKS.map((week) => ({ week, label: `Week of ${week}` })) },
};
const captures = (week: string) => ({ week, label: `Week of ${week}`, captures: [cap('chatgpt', 'ChatGPT', week), cap('claude', 'Claude', week)] });

type SiteOpts = { width?: number; hasTouch?: boolean; clipboard?: boolean; storage?: Record<string, string>; initScript?: string; shotShaped?: boolean };

/** The homepage at `hash` ("" for the gallery), loaded. `storage` is put in localStorage and `initScript` runs before the page does. */
export async function openSite(browser: Browser, hash: string, opts: SiteOpts = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: 900 }, hasTouch: opts.hasTouch });
  if (opts.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://site.test' });
  if (opts.initScript) await context.addInitScript({ content: opts.initScript });
  if (opts.storage) await context.addInitScript((items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v); }, opts.storage);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'site.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: INDEX_HTML });
    if (url.pathname === '/api/captures') return route.fulfill({ json: captures(url.searchParams.get('week') || WEEKS[0]) });
    if (API[url.pathname]) return route.fulfill({ json: API[url.pathname] });
    if (url.pathname.startsWith('/img/')) return route.fulfill({ contentType: 'image/png', body: opts.shotShaped ? SHOT_PNG : PNG });
    if (url.pathname.startsWith('/agents/')) return route.fulfill({ status: 404, body: '' });
    try {
      return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(new URL(`.${url.pathname}`, PUBLIC)) });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  await page.goto(`https://site.test/${hash}`);
  await page.waitForLoadState('load');
  return page;
}

/** The Analytics view switched from the default Canvas to Table, ready to use. */
export async function openAnalytics(browser: Browser, opts: SiteOpts = {}): Promise<Page> {
  const page = await openSite(browser, '#analytics', opts);
  await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
  await page.locator('[data-anview="table"]').click();
  await page.locator('#anTableWrap .an-table').waitFor();
  return page;
}

/** Switch to Canvas and wait for the board (wide screens) or the stacked cards (narrow screens). */
export async function showCanvas(page: Page): Promise<void> {
  await page.locator('[data-anview="canvas"]').click();
  await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
}

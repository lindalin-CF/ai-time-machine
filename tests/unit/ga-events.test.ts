import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { handlePortalPage } from '../../src/portal-page';
// @ts-expect-error -- plain browser module without type declarations
import { compareLinkParams } from '../../public/track.js';
import { makeEnv } from './fake-env';
import { openSite, WEEKS } from './analytics-page';

// GA4 events (public/track.js): file_download for Download PNG and Download all (.zip), compare_click for the
// Library's Compare →, the portal pages' Compare button and the top bar's Compare. gtag is stubbed before the page
// runs (public/consent.js keeps an existing window.gtag); the stub logs to sessionStorage, which survives navigation.

const STUB = `window.gtag = function () {
  const log = JSON.parse(sessionStorage.getItem('ga') || '[]');
  log.push([...arguments]);
  sessionStorage.setItem('ga', JSON.stringify(log));
};`;

type Call = [string, string, Record<string, unknown>];
/** The events gtag received (consent.js's own consent / js / config calls left out). */
const events = (page: Page) => page.evaluate(() =>
  (JSON.parse(sessionStorage.getItem('ga') || '[]') as Call[]).filter((c) => c[0] === 'event').map((c) => [c[1], c[2]]));

/** Wait until the page has logged `n` events (or a short while), then return them. */
async function eventsAfter(page: Page, n = 1) {
  await page.waitForFunction((n) => (JSON.parse(sessionStorage.getItem('ga') || '[]') as Call[]).filter((c) => c[0] === 'event').length >= n, n, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150); // a second event would have arrived by now
  return events(page);
}

const PORTAL_WEEKS = ['2026-10-12', '2026-10-05', '2026-09-28'];
function seed(t: ReturnType<typeof makeEnv>) {
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f')`);
  for (const week of PORTAL_WEEKS) {
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
               VALUES ('chatgpt-${week}', '${week}', 'chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f',
                       'shots/${week}/chatgpt.local.png', '', 'pending', '${week}T09:00:00Z')`);
  }
}

describe('compareLinkParams', () => {
  it('Across portals: the portals (at most four), the week and the device', () => {
    expect(compareLinkParams('#compare?view=table&mode=portals&week=2026-09-28&portals=chatgpt,claude,gemini,grok,deepseek&device=mobile'))
      .toEqual({ compare_mode: 'portals', portals: 'chatgpt,claude,gemini,grok', week: '2026-09-28', device: 'mobile' });
  });
  it('Single portal: the portal and the newest week', () => {
    expect(compareLinkParams('#compare?view=canvas&mode=time&portal=chatgpt&weeks=2026-10-12,2026-10-05&device=desktop'))
      .toEqual({ compare_mode: 'time', portals: 'chatgpt', week: '2026-10-12', device: 'desktop' });
  });
});

describe('GA4 events (browser)', () => {
  let browser: Browser;
  let pages: Record<string, string>;
  beforeAll(async () => {
    browser = await chromium.launch();
    const t = makeEnv();
    seed(t);
    pages = { '/portals/chatgpt/2026-10-05': await (await handlePortalPage(new Request('https://site.test/portals/chatgpt/2026-10-05'), t.env)).text() };
  });
  afterAll(async () => { await browser?.close(); });

  const open = async (path: string, opts: { gtag?: boolean } = {}) => {
    const page = await openSite(browser, path, {
      pages, weeks: WEEKS, initScript: opts.gtag === false ? undefined : STUB,
      // Without the stub, a declined choice: consent.js never defines gtag.
      storage: opts.gtag === false ? { 'analytics-consent': 'declined' } : undefined,
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/api/collection.zip*', (r) => r.fulfill({ contentType: 'application/zip', body: Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary') }));
    return { page, errors };
  };

  const downloadPng = async (page: Page) => {
    await page.locator('[data-anview="table"]').click();
    await page.locator('.an-shot[data-ga-portal="chatgpt"]').click();
    const download = page.waitForEvent('download');
    await page.locator('.lb-download').click();
    return download;
  };
  const downloadZip = async (page: Page) => {
    await page.locator('#dlAll:not([disabled])').waitFor();
    const download = page.waitForEvent('download');
    await page.locator('#dlAll').click();
    return download;
  };

  it('Download PNG sends one file_download with the shot\'s portal, week and device', async () => {
    const { page, errors } = await open('#compare');
    expect((await downloadPng(page)).suggestedFilename()).toBe(`chatgpt-${WEEKS[0]}.png`);
    expect(await eventsAfter(page)).toEqual([['file_download', {
      download_type: 'screenshot_png', file_name: `chatgpt-${WEEKS[0]}.png`, file_extension: 'png',
      image_id: `chatgpt-${WEEKS[0]}-desktop`, image_source: 'weekly_capture', portal: 'chatgpt', week: WEEKS[0], device: 'desktop',
    }]]);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('Download PNG of a manual snapshot (the "…" modal) sends image_id "manual-<id>"', async () => {
    const { page, errors } = await open('');
    await page.route('**/api/manual?*', (r) => r.fulfill({ json: { shots: [{
      id: 'm42', slug: 'chatgpt', portal: 'ChatGPT', device: 'mobile', description: 'A note', image: '/img/manual/chatgpt/m42-0.mobile.png',
      images: ['/img/manual/chatgpt/m42-0.mobile.png'], sizes: [], createdAt: '2026-10-01T09:00:00Z',
    }] } }));
    await page.locator('#grid .card .manual-open').first().click();
    await page.locator('.manual-modal .manual-img[data-ga-image]').first().click();
    const download = page.waitForEvent('download');
    await page.locator('.lb-download').click();
    expect((await download).suggestedFilename()).toBe('chatgpt-manual-mobile.png');
    expect(await eventsAfter(page)).toEqual([['file_download', {
      download_type: 'screenshot_png', file_name: 'chatgpt-manual-mobile.png', file_extension: 'png',
      image_id: 'manual-m42', image_source: 'manual_snapshot', portal: 'chatgpt', device: 'mobile',
    }]]);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('Download all (.zip) sends one file_download with the week and device', async () => {
    const { page, errors } = await open('#collection');
    expect((await downloadZip(page)).suggestedFilename()).toBe(`ai-portals-${WEEKS[0]}.zip`);
    expect(await eventsAfter(page)).toEqual([['file_download', {
      download_type: 'week_zip', file_name: `ai-portals-${WEEKS[0]}.zip`, file_extension: 'zip', image_id: `week-${WEEKS[0]}-desktop`, week: WEEKS[0], device: 'desktop',
    }]]);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('Compare → in the filter bar: one compare_click with what Compare opens, by beacon', async () => {
    const { page } = await open('');
    await page.locator('#compareBtn').click();
    await page.locator('#analyticsView').waitFor();
    expect(await eventsAfter(page)).toEqual([['compare_click', {
      cta_location: 'landing_filter_bar', compare_mode: 'portals', portals: 'chatgpt,claude', week: WEEKS[0], device: 'desktop', transport_type: 'beacon',
    }]]);
    await page.context().close();
  });

  it('Compare → with one portal picked: Single portal, that portal and the week on screen', async () => {
    const { page } = await open('');
    await page.locator('#filters .chip[data-portal="claude"]').click();
    await page.locator('#compareBtn').click();
    expect(await eventsAfter(page)).toEqual([['compare_click', {
      cta_location: 'landing_filter_bar', compare_mode: 'time', portals: 'claude', week: WEEKS[0], device: 'desktop', transport_type: 'beacon',
    }]]);
    await page.context().close();
  });

  it('the top bar\'s Compare on the homepage: one compare_click, and Compare opens', async () => {
    const { page } = await open('');
    await page.locator('.topnav-link[data-nav="compare"]').click();
    await page.locator('#analyticsView').waitFor();
    expect(page.url()).toBe('https://site.test/#compare');
    expect(await eventsAfter(page)).toEqual([['compare_click', {
      cta_location: 'nav', compare_mode: 'portals', portals: 'chatgpt,claude', week: WEEKS[0], device: 'desktop', transport_type: 'beacon',
    }]]);
    await page.context().close();
  });

  it('a portal page\'s Compare: one compare_click with that page\'s portal, and the link still navigates', async () => {
    const { page, errors } = await open('portals/chatgpt/2026-10-05');
    await page.locator('.compare-cta').click();
    await page.waitForURL('https://site.test/#compare?view=canvas&mode=time&portal=chatgpt&weeks=2026-10-12,2026-10-05&device=desktop');
    await page.locator('#analyticsView').waitFor();
    expect(await eventsAfter(page)).toEqual([['compare_click', {
      cta_location: 'portal_page', compare_mode: 'time', portals: 'chatgpt', week: '2026-10-12', device: 'desktop', portal: 'chatgpt', transport_type: 'beacon',
    }]]);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it('a portal page\'s top bar Compare: one compare_click with Compare\'s defaults, and the link still navigates', async () => {
    const { page } = await open('portals/chatgpt/2026-10-05');
    await page.locator('.topnav-link[href="/#compare"]').click();
    await page.waitForURL('https://site.test/#compare');
    expect(await eventsAfter(page)).toEqual([['compare_click', { cta_location: 'nav', compare_mode: 'portals', device: 'desktop', transport_type: 'beacon' }]]);
    await page.context().close();
  });

  it('the Compare links do not hold up or cancel the navigation', async () => {
    const { page } = await open('portals/chatgpt/2026-10-05');
    const prevented = page.evaluate(() => new Promise((done) =>
      window.addEventListener('click', (e) => done(e.defaultPrevented), { once: true })));
    await page.locator('.compare-cta').click();
    expect(await prevented).toBe(false);
    await page.waitForURL(/#compare\?/);
    await page.context().close();
  });

  it('?ga_debug=1 adds debug_mode: true', async () => {
    const { page } = await open('?ga_debug=1#collection');
    await downloadZip(page);
    const [[name, params]] = await eventsAfter(page);
    expect(name).toBe('file_download');
    expect(params).toMatchObject({ download_type: 'week_zip', debug_mode: true });
    await page.context().close();
  });

  it('without gtag nothing is sent and nothing breaks: downloads still start, links still navigate', async () => {
    const { page, errors } = await open('#compare', { gtag: false });
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe('undefined');
    await downloadPng(page);
    await page.keyboard.press('Escape');
    await page.locator('.topnav-link[data-nav="collection"]').click();
    await downloadZip(page);
    await page.locator('.topnav-link[data-nav="gallery"]').click();
    await page.locator('#compareBtn').click();
    await page.waitForURL(/#compare\?/);
    await page.locator('.topnav-link[data-nav="compare"]').click();
    await page.goto('https://site.test/portals/chatgpt/2026-10-05');
    await page.locator('.compare-cta').click();
    await page.waitForURL(/#compare\?view=canvas/);
    expect(await events(page)).toEqual([]);
    expect(errors).toEqual([]);
    await page.context().close();
  });
});

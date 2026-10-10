import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { CONSENT_COUNTRIES, consentRequired } from '../../src/consent';
import { handleHowWeAnalyze, handlePortalPage, handlePrivacy, handleSitemap } from '../../src/portal-page';
import { handleHomepage } from '../../src/homepage';
import { handleApi } from '../../src/api';
import { makeEnv } from './fake-env';
import { expectFooterDialogs, LEGAL_LINE } from './footer-dialogs';

const PUBLIC = new URL('../../public/', import.meta.url);
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');
const ORIGIN = 'https://ai-portal-library.dev';
const GA = 'https://www.googletagmanager.com/gtag/js?id=G-X9PB6Q8VT6';
const CLARITY = 'https://www.clarity.ms/tag/yoxz5c38mi';
const BANNER_TEXT = "This site uses analytics from Google and Microsoft to understand how it's used. You can accept or decline.";

/** A request as Cloudflare delivers it: `country` undefined means no cf.country at all. */
function req(path: string, country?: string, init?: RequestInit): Request {
  const r = new Request(`https://x${path}`, init);
  if (country !== undefined) Object.defineProperty(r, 'cf', { value: { country } });
  return r;
}

let t: ReturnType<typeof makeEnv>;
beforeEach(() => {
  t = makeEnv();
  t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('2026-09-21', 'Week of 2026-09-21', '2026-09-21T00:00:00Z')`);
  t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
             VALUES ('claude-2026-09-21', '2026-09-21', 'claude', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757',
                     'shots/2026-09-21/claude.local.png', '', 'pending', '2026-09-21T09:00:00Z')`);
  (t.env as unknown as { ASSETS: unknown }).ASSETS = {
    async fetch() { return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate' } }); },
  };
});

/** Every server-rendered HTML page, as served to a visitor from `country`. */
const PAGES: Record<string, (country?: string) => Promise<Response>> = {
  home: (c) => handleHomepage(req('/', c), t.env),
  portal: (c) => handlePortalPage(req('/portals/claude', c), t.env),
  week: (c) => handlePortalPage(req('/portals/claude/2026-09-21', c), t.env),
  notFound: (c) => handlePortalPage(req('/portals/nope', c), t.env),
  howWeAnalyze: async (c) => handleHowWeAnalyze(req('/how-we-analyze', c)),
  privacy: async (c) => handlePrivacy(req('/privacy', c)),
};

const htmlTag = (html: string) => html.match(/<html\b[^>]*>/)![0];

describe('region detection', () => {
  it('keeps one list: the 27 EU countries, IS, LI, NO, GB and CH', () => {
    expect(CONSENT_COUNTRIES.size).toBe(32);
    for (const c of ['DE', 'FR', 'IE', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH']) expect(CONSENT_COUNTRIES.has(c)).toBe(true);
    for (const c of ['US', 'CA', 'JP', 'TW', 'AU', 'TR']) expect(CONSENT_COUNTRIES.has(c)).toBe(false);
  });

  it.each([
    ['US', false], ['DE', true], ['GB', true], ['CH', true],
    [undefined, true], ['XX', true], ['T1', true], ['', true], ['us', true], ['USA', true],
  ])('country %s requires consent: %s', (country, required) => {
    expect(consentRequired(req('/', country as string | undefined))).toBe(required);
  });

  it('is only read in src/consent.ts', () => {
    const src = new URL('../../src/', import.meta.url);
    for (const f of readdirSync(src)) {
      if (f === 'consent.ts') continue;
      expect(readFileSync(new URL(f, src), 'utf8'), f).not.toMatch(/\.cf\b|cf\?\.|\.country\b/);
    }
  });
});

describe('the region reaches every page, per request', () => {
  it.each([
    ['US', 'not-required'], ['DE', 'required'], ['GB', 'required'], ['CH', 'required'], [undefined, 'required'], ['XX', 'required'],
  ])('%s -> data-consent="%s" on every page', async (country, mode) => {
    for (const [name, get] of Object.entries(PAGES)) {
      const html = await (await get(country as string | undefined)).text();
      expect(htmlTag(html), name).toContain(`data-consent="${mode}"`);
      expect(html.match(/data-consent="/g), name).toHaveLength(1);
    }
  });

  it('routes /privacy in the Worker entry point', () => {
    const index = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('if (url.pathname === "/privacy" || url.pathname === "/privacy/") return handlePrivacy(request);');
  });
});

describe('no region information in any cached response', () => {
  it('sends every page that carries the region as private, so no shared cache stores it', async () => {
    for (const [name, get] of Object.entries(PAGES)) {
      for (const country of ['US', 'DE']) {
        const cc = (await get(country)).headers.get('cache-control') ?? '';
        expect(cc, `${name} ${country}`).toMatch(/^private\b/);
        expect(cc).not.toContain('public');
      }
    }
  });

  it('gives each visitor their own region even after other visitors warmed every cache', async () => {
    // Alternate visitors on one env, so the KV cache is shared between them.
    for (const [country, mode] of [['DE', 'required'], ['US', 'not-required'], ['GB', 'required'], ['US', 'not-required'], [undefined, 'required']] as const) {
      for (const [name, get] of Object.entries(PAGES)) {
        expect(htmlTag(await (await get(country)).text()), `${name} ${country}`).toContain(`data-consent="${mode}"`);
      }
    }
    // Nothing stored in KV knows about regions.
    expect(t.kv.size).toBeGreaterThan(0);
    for (const [key, value] of t.kv) expect(`${key} ${value}`).not.toMatch(/data-consent|not-required|consent/);
  });

  it('keeps the region out of the publicly cacheable responses: sitemap, API and the static homepage file', async () => {
    const sitemap = await handleSitemap(t.env);
    expect(sitemap.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await sitemap.text()).not.toContain('consent');
    const ctx = { waitUntil() {} } as unknown as ExecutionContext;
    for (const path of ['/api/stats', '/api/weeks', '/api/captures?week=2026-09-21']) {
      const body = await (await handleApi(req(path, 'DE'), t.env, ctx)).text();
      expect(body, path).not.toContain('consent');
    }
    // public/index.html is served from Cloudflare's asset cache (and as the SPA fallback), so it must never carry a region.
    expect(htmlTag(INDEX_HTML)).toBe('<html lang="en" data-theme="kumo">');
  });

  it('never uses the Cache API', () => {
    const src = new URL('../../src/', import.meta.url);
    for (const f of readdirSync(src)) expect(readFileSync(new URL(f, src), 'utf8'), f).not.toMatch(/\bcaches\./);
  });
});

describe('analytics tags in the HTML', () => {
  it('no page loads Google Analytics or Clarity directly; every page loads /consent.js', async () => {
    const pages = [INDEX_HTML, ...await Promise.all(Object.values(PAGES).map(async (get) => (await get('US')).text()))];
    for (const html of pages) {
      expect(html).not.toMatch(/googletagmanager|gtag\(|clarity\.ms|G-X9PB6Q8VT6|yoxz5c38mi/);
      expect(html).toContain('<script src="/consent.js" defer></script>');
    }
  });
});

describe('footer', () => {
  it('has "Privacy · Cookie preferences" after Contact on every page', async () => {
    expect(LEGAL_LINE).toMatch(/Contact<\/button> &middot; <a href="\/privacy">Privacy<\/a> &middot; <button type="button" class="linkbtn" data-consent-open>Cookie preferences<\/button>$/);
    expect(INDEX_HTML).toContain(LEGAL_LINE);
    for (const [name, get] of Object.entries(PAGES)) {
      const html = await (await get('US')).text();
      expect(html.match(/data-consent-open/g), name).toHaveLength(1);
      expectFooterDialogs(html, { extraMailto: name === 'privacy' ? 1 : 0 });
    }
  });
});

describe('/privacy', () => {
  let html: string;
  beforeEach(async () => { html = await (await handlePrivacy(req('/privacy', 'US'))).text(); });
  const text = () => html.match(/<main class="howto">([\s\S]*?)<\/main>/)![1].replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('uses the /how-we-analyze template, with its own title and canonical URL', () => {
    expect(html).toContain('<title>Privacy | AI Interface Library</title>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/privacy" />`);
    expect(html).toContain('<header><a href="/">&larr; AI Interface Library</a></header>');
    expect(html).toContain('<main class="howto">');
    expect(html).not.toContain('noindex');
  });

  it('covers every required topic', () => {
    const s = text();
    for (const phrase of [
      'Last updated: September 27, 2026',
      'independent personal project',
      'no accounts', 'no ads', 'never sold',
      'Google Analytics', 'Microsoft Clarity', '_ga', '_clck',
      'European Economic Area, the UK and Switzerland are asked first',
      'decline at any time with Cookie preferences',
      'Global Privacy Control',
      'Clarity masks anything you type',
      'Talk to the library', 'Cloudflare Workers AI', 'microphone',
      'Each browser tab has its own conversation',
      "Other visitors can't see your questions or the answers, and your conversation is never used to answer anyone else.",
      'It is deleted 24 hours after your last message.',
      'Cloudflare Web Analytics', 'uses no cookies or local storage',
      'Fonts and product icons are served from this site',
      'contact@ai-portal-library.dev',
    ]) expect(s).toContain(phrase);
    // Gone: the shared voice log and the Google Fonts / favicon paragraph.
    for (const phrase of ['All visitors share', 'whoever is asking', '1,000 messages', 'Google Fonts', 'favicon']) expect(s).not.toContain(phrase);
    expect(html).toContain('<a href="https://policies.google.com/privacy">');
    expect(html).toContain('<a href="https://www.microsoft.com/privacy/privacystatement">');
    expect(html).toContain('<a href="mailto:contact@ai-portal-library.dev">contact@ai-portal-library.dev</a>');
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    expect(await handlePrivacy(req('/privacy', 'US', { method: 'HEAD' })).text()).toBe('');
    expect(handlePrivacy(req('/privacy', 'US', { method: 'POST' })).status).toBe(405);
  });

  it('is routed to the Worker and listed in the sitemap', async () => {
    for (const f of ['wrangler.jsonc', 'wrangler.dev.jsonc']) {
      const cfg = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      expect(cfg, f).toMatch(/"\/privacy",\s*"\/privacy\/"/);
    }
    const xml = await (await handleSitemap(t.env)).text();
    expect(xml).toContain(`<loc>${ORIGIN}/privacy</loc>`);
  });
});

// ---- browser behavior (headless Chromium) -----------------------------------

describe('in the browser', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  type Opts = { country?: string; gpc?: boolean; stored?: 'accepted' | 'declined'; html?: string; width?: number };
  type Visit = { page: Page; context: BrowserContext; analytics: string[]; reload: () => Promise<void> };

  /** Open /privacy (or `html`) as a visitor from `country`, recording every analytics request. */
  async function visit(o: Opts = {}): Promise<Visit> {
    const html = o.html ?? await (await handlePrivacy(req('/privacy', o.country))).text();
    const context = await browser.newContext({ viewport: { width: o.width ?? 1280, height: 800 } });
    if (o.gpc) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    if (o.stored) await context.addInitScript((v) => { if (!localStorage.getItem('analytics-consent')) localStorage.setItem('analytics-consent', v); }, o.stored);
    const analytics: string[] = [];
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('https://site.test/')) {
        const path = new URL(url).pathname;
        if (path === '/' || path === '/privacy') return route.fulfill({ contentType: 'text/html', body: html });
        if (path === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
        try { return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(new URL(`.${path}`, PUBLIC)) }); } catch { return route.fulfill({ status: 404 }); }
      }
      if (url.includes('googletagmanager.com') || url.includes('clarity.ms')) {
        analytics.push(url);
        return route.fulfill({ contentType: 'text/javascript', body: '' });
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(o.html ? 'https://site.test/' : 'https://site.test/privacy');
    await page.waitForLoadState('load');
    return { page, context, analytics, reload: async () => { analytics.length = 0; await page.reload(); await page.waitForLoadState('load'); } };
  }
  const banner = (p: Page) => p.locator('#consent-banner');
  const loadedBoth = async (a: string[]) => { await expect.poll(() => [...a].sort()).toEqual([GA, CLARITY].sort()); };

  it('US: loads both right away, no banner', async () => {
    const v = await visit({ country: 'US' });
    await loadedBoth(v.analytics);
    await expect(banner(v.page).isVisible()).resolves.toBe(false);
    // Clarity got the Consent API v2 signal before its tag loaded; Google got analytics-only consent.
    const queue = await v.page.evaluate(() => JSON.stringify([(window as any).clarity.q, (window as any).dataLayer]));
    expect(queue).toContain('{"0":"consentv2","1":{"ad_Storage":"denied","analytics_Storage":"granted"}}');
    expect(queue).toContain('{"0":"consent","1":"default","2":{"ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","analytics_storage":"granted"}}');
    await v.context.close();
  });

  it.each([['DE'], ['GB'], ['CH'], ['XX'], [undefined]])('%s: shows the banner and loads nothing until Accept', async (country) => {
    const v = await visit({ country });
    await expect(banner(v.page).isVisible()).resolves.toBe(true);
    await expect(banner(v.page).innerText()).resolves.toContain(BANNER_TEXT);
    await expect(banner(v.page).locator('a[href="/privacy"]').innerText()).resolves.toBe('Privacy');
    await v.page.waitForTimeout(200);
    expect(v.analytics).toEqual([]);
    await v.page.getByRole('button', { name: 'Accept' }).click();
    await loadedBoth(v.analytics);
    await expect(banner(v.page).isVisible()).resolves.toBe(false);
    await v.reload(); // the choice sticks
    await loadedBoth(v.analytics);
    await expect(banner(v.page).isVisible()).resolves.toBe(false);
    await v.context.close();
  });

  it('DE: Decline loads nothing, now or on the next page view', async () => {
    const v = await visit({ country: 'DE' });
    await v.page.getByRole('button', { name: 'Decline' }).click();
    await expect(banner(v.page).isVisible()).resolves.toBe(false);
    await v.reload();
    await v.page.waitForTimeout(200);
    expect(v.analytics).toEqual([]);
    await expect(banner(v.page).isVisible()).resolves.toBe(false);
    await v.context.close();
  });

  it('treats a page without data-consent (the static homepage file) as consent required', async () => {
    const v = await visit({ html: INDEX_HTML });
    await expect(banner(v.page).isVisible()).resolves.toBe(true);
    expect(v.analytics).toEqual([]);
    await v.context.close();
  });

  it.each([['US'], ['DE'], [undefined]])('GPC in %s: never loads analytics and shows no banner, even with a stored Accept', async (country) => {
    for (const stored of [undefined, 'accepted'] as const) {
      const v = await visit({ country, gpc: true, stored });
      await v.page.waitForTimeout(200);
      expect(v.analytics).toEqual([]);
      await expect(banner(v.page).isVisible()).resolves.toBe(false);
      // Cookie preferences explains the signal and offers no Accept.
      await v.page.getByRole('button', { name: 'Cookie preferences' }).click();
      await expect(banner(v.page).innerText()).resolves.toContain('Global Privacy Control');
      await expect(v.page.getByRole('button', { name: 'Accept' }).count()).resolves.toBe(0);
      expect(v.analytics).toEqual([]);
      await v.context.close();
    }
  });

  it('a stored choice overrides the region default', async () => {
    const de = await visit({ country: 'DE', stored: 'accepted' });
    await loadedBoth(de.analytics);
    await expect(banner(de.page).isVisible()).resolves.toBe(false);
    await de.context.close();

    const us = await visit({ country: 'US', stored: 'declined' });
    await us.page.waitForTimeout(200);
    expect(us.analytics).toEqual([]);
    await expect(banner(us.page).isVisible()).resolves.toBe(false);
    await us.context.close();
  });

  it('US: Cookie preferences opens the same banner, and declining stops both from the next page view on', async () => {
    const v = await visit({ country: 'US' });
    await loadedBoth(v.analytics);
    await v.page.evaluate(() => { document.cookie = '_ga=GA1.1.1; path=/'; document.cookie = '_clck=abc; path=/'; document.cookie = 'keep=1; path=/'; });
    await v.page.getByRole('button', { name: 'Cookie preferences' }).click();
    await expect(banner(v.page).innerText()).resolves.toContain(BANNER_TEXT);
    await expect(banner(v.page).innerText()).resolves.toContain('Analytics are on for this browser.');
    await v.page.getByRole('button', { name: 'Decline' }).click();
    await expect(v.page.evaluate(() => document.cookie)).resolves.toBe('keep=1');
    await expect(v.page.evaluate(() => (window as any)['ga-disable-G-X9PB6Q8VT6'])).resolves.toBe(true);
    await v.reload();
    await v.page.waitForTimeout(200);
    expect(v.analytics).toEqual([]);
    await expect(banner(v.page).isVisible()).resolves.toBe(false);
    await v.context.close();
  });

  it('works at 390px: fits the screen, equal buttons, does not block scrolling or reading', async () => {
    const v = await visit({ country: 'DE', width: 390 });
    const p = v.page;
    const box = (await banner(p).boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(box.height).toBeLessThan(800 / 2);
    await expect(p.evaluate(() => document.documentElement.scrollWidth)).resolves.toBeLessThanOrEqual(390);

    const accept = p.getByRole('button', { name: 'Accept' });
    const decline = p.getByRole('button', { name: 'Decline' });
    const [a, d] = [(await accept.boundingBox())!, (await decline.boundingBox())!];
    expect(Math.abs(a.width - d.width)).toBeLessThan(1);
    expect(a.height).toBe(d.height);
    expect(a.height).toBeGreaterThanOrEqual(44);
    const look = (el: Element) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.borderColor, s.borderWidth, s.fontSize, s.fontWeight, s.padding].join('|'); };
    expect(await accept.evaluate(look)).toBe(await decline.evaluate(look));

    // Not a modal: the rest of the page stays readable and scrollable.
    const top = await p.evaluate(() => document.elementFromPoint(195, 200)?.closest('#consent-banner'));
    expect(top).toBeNull();
    await p.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="height:3000px"></div>'));
    await p.mouse.move(195, 200);
    await p.mouse.wheel(0, 600);
    await expect.poll(() => p.evaluate(() => scrollY)).toBeGreaterThan(0);
    await v.context.close();
  });

  it('is keyboard accessible, on first visit and from Cookie preferences', async () => {
    const v = await visit({ country: 'DE' });
    const p = v.page;
    // First visit: the banner comes first in the tab order: Privacy link, Accept, Decline.
    const focused = () => p.evaluate(() => document.activeElement?.textContent?.trim());
    await p.keyboard.press('Tab'); expect(await focused()).toBe('Privacy');
    await p.keyboard.press('Tab'); expect(await focused()).toBe('Accept');
    await p.keyboard.press('Tab'); expect(await focused()).toBe('Decline');
    await p.keyboard.press('Escape'); // a first-visit question stays until answered
    await expect(banner(p).isVisible()).resolves.toBe(true);
    await p.keyboard.press('Enter');
    await expect(banner(p).isVisible()).resolves.toBe(false);
    await expect(p.evaluate(() => localStorage.getItem('analytics-consent'))).resolves.toBe('declined');

    // Cookie preferences: focus moves into the banner, Escape closes it and returns focus.
    await p.getByRole('button', { name: 'Cookie preferences' }).focus();
    await p.keyboard.press('Enter');
    await expect(banner(p).isVisible()).resolves.toBe(true);
    expect(await focused()).toBe('Accept');
    await expect(banner(p).innerText()).resolves.toContain('Analytics are off for this browser.');
    await p.keyboard.press('Escape');
    await expect(banner(p).isVisible()).resolves.toBe(false);
    expect(await focused()).toBe('Cookie preferences');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter'); // Accept
    await loadedBoth(v.analytics);
    expect(await focused()).toBe('Cookie preferences');
    await v.context.close();
  });

  it('lifts the voice button above the banner so it never covers Accept or Decline', async () => {
    const v = await visit({ html: INDEX_HTML.replace('<html lang="en" data-theme="kumo">', '<html lang="en" data-theme="kumo" data-consent="required">'), width: 390 });
    const fab = (await v.page.locator('.voice-fab').boundingBox())!;
    const bar = (await banner(v.page).boundingBox())!;
    expect(fab.y + fab.height).toBeLessThanOrEqual(bar.y);
    await v.page.getByRole('button', { name: 'Accept' }).click();
    const fabAfter = (await v.page.locator('.voice-fab').boundingBox())!;
    expect(fabAfter.y + fabAfter.height).toBeCloseTo(800 - 22, 0);
    await v.context.close();
  });
});

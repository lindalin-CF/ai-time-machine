import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { handleApi } from '../../src/api';
import { handleHomepage } from '../../src/homepage';
import { handlePortalPage, handlePrivacy } from '../../src/portal-page';
import { makeEnv } from './fake-env';

// No page may contact Google (or any other outside host) before the visitor accepts analytics.
// Fonts and portal icons are self-hosted; only Accept brings in Google Analytics and Clarity.

const PUBLIC = new URL('../../public/', import.meta.url);
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');
const WEEK = '2026-09-21';
const PORTALS: [string, string, string, string][] = [
  ['chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/'],
  ['copilot', 'Copilot', 'Microsoft', 'https://copilot.microsoft.com/'],
  ['kimi', 'Kimi', 'Moonshot AI', 'https://www.kimi.com/'],
];

function fixture() {
  const t = makeEnv(); // already has claude
  for (const [slug, name, company, url] of PORTALS) {
    t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('${slug}', '${name}', '${company}', '${url}', '#123456')`);
  }
  t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${WEEK}', 'Week of ${WEEK}', '${WEEK}T00:00:00Z')`);
  for (const [slug, name, company, url] of [['claude', 'Claude', 'Anthropic', 'https://claude.ai/'], ...PORTALS]) {
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
               VALUES ('${slug}-${WEEK}', '${WEEK}', '${slug}', '${name}', '${company}', '${url}', '#123456',
                       'shots/${WEEK}/${slug}.local.png', '', 'pending', '${WEEK}T09:00:00Z')`);
  }
  (t.env as unknown as { ASSETS: unknown }).ASSETS = { async fetch() { return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } }); } };
  return t;
}

const GOOGLE = /(^|\.)(google|googleapis|gstatic|googletagmanager|google-analytics|doubleclick|googleusercontent)\.[a-z.]+$/;

describe('self-hosted fonts and icons', () => {
  it('has no Google Fonts or favicon-service reference left in the site', () => {
    const files = ['index.html', 'app.js', 'styles.css', 'voice.js', 'consent.js', 'footer-dialogs.js', 'fonts/fonts.css'];
    for (const f of files) {
      // fonts.css names its Google source in a comment, for provenance; only code counts here.
      const text = readFileSync(new URL(f, PUBLIC), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text, f).not.toMatch(/fonts\.googleapis|fonts\.gstatic|google\.com\/s2\/favicons/);
    }
    const src = new URL('../../src/', import.meta.url);
    for (const f of readdirSync(src)) expect(readFileSync(new URL(f, src), 'utf8'), f).not.toMatch(/fonts\.googleapis|fonts\.gstatic|s2\/favicons/);
  });

  it('declares every font file it serves, with its OFL license alongside', () => {
    const css = readFileSync(new URL('fonts/fonts.css', PUBLIC), 'utf8');
    const urls = [...css.matchAll(/url\((\/fonts\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
    expect(css.match(/@font-face/g)).toHaveLength(52);
    for (const u of new Set(urls)) expect(existsSync(new URL(`.${u}`, PUBLIC)), u).toBe(true);
    const onDisk = readdirSync(new URL('fonts/', PUBLIC)).filter((f) => f.endsWith('.woff2')).map((f) => `/fonts/${f}`);
    expect([...new Set(urls)].sort()).toEqual(onDisk.sort());
    for (const family of ['inter', 'space-grotesk', 'jetbrains-mono']) {
      const ofl = readFileSync(new URL(`fonts/${family}-OFL.txt`, PUBLIC), 'utf8');
      expect(ofl).toContain('SIL Open Font License, Version 1.1');
    }
    expect(INDEX_HTML).toContain('<link rel="stylesheet" href="/fonts/fonts.css" />');
  });

  it('has a PNG icon for every portal in the seed list', () => {
    const seed = JSON.parse(readFileSync(new URL('../../scripts/seed-source/portals.json', import.meta.url), 'utf8')).portals as { slug: string }[];
    for (const { slug } of seed) {
      const bytes = readFileSync(new URL(`icons/${slug}.png`, PUBLIC));
      expect([...bytes.subarray(0, 8)], slug).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });
});

describe('in a headless browser', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  /** Open a page as a visitor from Germany; every request is recorded, outside hosts are answered with an empty body. */
  async function open(path: string): Promise<{ page: Page; context: BrowserContext; outside: string[]; local: string[] }> {
    const t = fixture();
    const ctx = { waitUntil() {} } as unknown as ExecutionContext;
    const de = (p: string) => { const r = new Request(`https://x${p}`); Object.defineProperty(r, 'cf', { value: { country: 'DE' } }); return r; };
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const outside: string[] = [];
    const local: string[] = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== 'site.test') {
        outside.push(url.href);
        return route.fulfill({ contentType: 'text/javascript', body: '' });
      }
      local.push(url.pathname);
      const p = url.pathname;
      let res: Response | null = null;
      if (p === '/') res = await handleHomepage(de('/'), t.env);
      else if (p === '/privacy') res = handlePrivacy(de(p));
      else if (p.startsWith('/portals/')) res = await handlePortalPage(de(p), t.env);
      else if (p.startsWith('/api/')) res = await handleApi(de(p + url.search), t.env, ctx);
      if (res) return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
      const file = new URL(`.${p}`, PUBLIC);
      if (!p.endsWith('/') && existsSync(file)) {
        const type = p.endsWith('.css') ? 'text/css' : p.endsWith('.js') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' : p.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
        return route.fulfill({ contentType: type, body: readFileSync(file) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    await page.goto(`https://site.test${path}`);
    await page.waitForLoadState('networkidle');
    return { page, context, outside, local };
  }

  it('homepage: nothing outside the site loads before Accept; fonts and icons come from the site', async () => {
    const v = await open('/');
    // Cards rendered with self-hosted icons, and the self-hosted fonts are in use.
    await expect.poll(() => v.page.locator('.brand-logo img').count()).toBe(4);
    for (const slug of ['claude', 'chatgpt', 'copilot', 'kimi']) {
      const img = v.page.locator(`.brand-logo img[src="/icons/${slug}.png"]`);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    const faces = await v.page.evaluate(async () => {
      const loaded = [...await document.fonts.load('600 16px "Space Grotesk"'), ...await document.fonts.load('400 16px Inter'), ...await document.fonts.load('400 16px "JetBrains Mono"')];
      return loaded.map((f) => `${f.family} ${f.status}`);
    });
    expect(faces).toEqual(expect.arrayContaining(['Space Grotesk loaded', 'Inter loaded', 'JetBrains Mono loaded']));
    expect(v.local.some((p) => /^\/fonts\/.+\.woff2$/.test(p))).toBe(true);

    // The Analytics view's table icons are self-hosted too.
    await v.page.goto('https://site.test/#analytics');
    await v.page.waitForLoadState('networkidle');
    await v.page.locator('#anPicker button').first().click().catch(() => {});
    await v.page.waitForLoadState('networkidle');
    for (const src of await v.page.locator('.an-logo img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))) {
      expect(src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
    }

    expect(v.outside).toEqual([]);

    // Accept brings in exactly the two analytics tags, and nothing else from outside.
    await v.page.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => [...new Set(v.outside.map((u) => new URL(u).host))].sort()).toEqual(['www.clarity.ms', 'www.googletagmanager.com']);
    await v.context.close();
  });

  it.each([['/privacy'], ['/portals/claude'], ['/portals/claude/2026-09-21']])('%s: nothing outside the site loads before Accept', async (path) => {
    const v = await open(path);
    await v.page.waitForTimeout(200);
    expect(v.outside).toEqual([]);
    expect(v.outside.filter((u) => GOOGLE.test(new URL(u).hostname))).toEqual([]);
    await v.context.close();
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { parseImageSize, imageSizeOf, IMAGE_SIZE_HEAD, SAMPLE_SIZES, DEFAULT_SAMPLE_SIZE, MOBILE_CAPTURE_SIZE } from '../../src/image-size';
import { weekInWords, shotAlt } from '../../src/format';
import { handlePortalPage, handleSitemap, ORIGIN } from '../../src/portal-page';
import { handleApi } from '../../src/api';
import { CACHE_VERSION } from '../../src/db';
import { makeEnv } from './fake-env';

// Image SEO: descriptive alt text, real width/height on every <img>, the image sitemap, and titles.

const PUBLIC = new URL('../../public/', import.meta.url);
const APP_JS = readFileSync(new URL('app.js', PUBLIC), 'utf8');
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

// ---- minimal image headers ---------------------------------------------------
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const png = (w: number, h: number) => new Uint8Array([0x89, ...ascii('PNG\r\n\x1a\n'), 0, 0, 0, 13, ...ascii('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const gif = (w: number, h: number) => new Uint8Array([...ascii('GIF89a'), ...le16(w), ...le16(h), 0, 0, 0]);
const webp = (w: number, h: number) => new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
/** JPEG with an optional EXIF orientation and `pad` bytes of APP2 segments before the SOF. */
function jpeg(w: number, h: number, { orientation = 0, pad = 0 } = {}) {
  const out: number[] = [0xff, 0xd8];
  if (orientation) {
    const tiff = [...ascii('MM'), 0, 42, ...be32(8), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0, ...be32(0)];
    const body = [...ascii('Exif\0\0'), ...tiff];
    out.push(0xff, 0xe1, ...be16(body.length + 2), ...body);
  }
  for (let left = pad; left > 0; left -= 60000) {
    const n = Math.min(60000, left);
    out.push(0xff, 0xe2, ...be16(n + 2), ...new Array(n).fill(0));
  }
  out.push(0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1);
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

describe('parseImageSize', () => {
  it('reads PNG, GIF, WebP and JPEG sizes', () => {
    expect(parseImageSize(png(780, 1688))).toEqual({ width: 780, height: 1688 });
    expect(parseImageSize(gif(640, 480))).toEqual({ width: 640, height: 480 });
    expect(parseImageSize(webp(1200, 900))).toEqual({ width: 1200, height: 900 });
    expect(parseImageSize(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });
  it('reports a rotated JPEG the way browsers show it', () => {
    expect(parseImageSize(jpeg(4032, 3024, { orientation: 6 }))).toEqual({ width: 3024, height: 4032 });
    expect(parseImageSize(jpeg(4032, 3024, { orientation: 1 }))).toEqual({ width: 4032, height: 3024 });
  });
  it('returns null for unknown data or a header cut short', () => {
    expect(parseImageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(parseImageSize(jpeg(10, 10, { pad: 100_000 }).subarray(0, IMAGE_SIZE_HEAD))).toBeNull();
  });
});

describe('imageSizeOf', () => {
  it('measures from a ranged R2 read, then serves the size from KV', async () => {
    const t = makeEnv();
    t.r2.set('shots/w/a.mobile.png', png(780, 1688));
    expect(await imageSizeOf(t.env, 'shots/w/a.mobile.png', 5)).toEqual({ width: 780, height: 1688 });
    expect(t.r2Reads).toEqual([{ key: 'shots/w/a.mobile.png', length: png(1, 1).length }]);
    expect(JSON.parse(t.kv.get(`${CACHE_VERSION}:imgsize:shots/w/a.mobile.png@5`)!)).toEqual({ width: 780, height: 1688 });
    await imageSizeOf(t.env, 'shots/w/a.mobile.png', 5);
    expect(t.r2Reads).toHaveLength(1); // cached
  });
  it('falls back to a full read for a JPEG whose size is past the first 64KB', async () => {
    const t = makeEnv();
    t.r2.set('manual/x.jpg', jpeg(1440, 900, { pad: 100_000 }));
    expect(await imageSizeOf(t.env, 'manual/x.jpg', 1)).toEqual({ width: 1440, height: 900 });
    expect(t.r2Reads.map((r) => r.length)).toEqual([IMAGE_SIZE_HEAD, t.r2.get('manual/x.jpg')!.length]);
  });
  it('returns null for a missing object', async () => {
    expect(await imageSizeOf(makeEnv().env, 'nope.png', 1)).toBeNull();
  });
});

describe('sizes the code assumes match the real files', () => {
  const svgSize = (f: string) => {
    const m = /<svg[^>]*\swidth="(\d+)"\s+height="(\d+)"/.exec(readFileSync(new URL(`samples/${f}`, PUBLIC), 'utf8'))!;
    return { width: +m[1], height: +m[2] };
  };
  it('SAMPLE_SIZES lists every sample that is not 1280x800', () => {
    for (const f of readdirSync(new URL('samples/', PUBLIC)).filter((n) => n.endsWith('.svg'))) {
      expect(SAMPLE_SIZES[f.replace('.svg', '')] ?? DEFAULT_SAMPLE_SIZE, f).toEqual(svgSize(f));
    }
  });
  it("app.js ICON_SIZES matches public/icons", () => {
    const listed = Object.fromEntries([...APP_JS.match(/const ICON_SIZES = \{([^}]*)\}/)![1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], +m[2]]));
    for (const f of readdirSync(new URL('icons/', PUBLIC)).filter((n) => n.endsWith('.png'))) {
      const size = parseImageSize(new Uint8Array(readFileSync(new URL(`icons/${f}`, PUBLIC))))!;
      const n = listed[f.replace('.png', '')] ?? 64;
      expect({ file: f, ...size }).toEqual({ file: f, width: n, height: n });
    }
  });
  it('the mobile fallback is the capture viewport at its scale factor, in both places', () => {
    const capture = readFileSync(new URL('../../scripts/local-capture/capture.mjs', import.meta.url), 'utf8');
    const m = /MOBILE_VIEWPORT = \{ width: (\d+), height: (\d+), deviceScaleFactor: (\d+)/.exec(capture)!;
    expect(MOBILE_CAPTURE_SIZE).toEqual({ width: +m[1] * +m[3], height: +m[2] * +m[3] });
    expect(APP_JS).toContain(`const MOBILE_CAPTURE_SIZE = { width: ${MOBILE_CAPTURE_SIZE.width}, height: ${MOBILE_CAPTURE_SIZE.height} };`);
  });
});

describe('wording', () => {
  it('writes the week out in words', () => {
    expect(weekInWords('2026-09-21')).toBe('September 21, 2026');
    expect(weekInWords('2026-08-03')).toBe('August 3, 2026');
    expect(shotAlt('ChatGPT', 'mobile', '2026-09-21')).toBe('ChatGPT mobile interface, week of September 21, 2026');
  });
  it('app.js uses the same wording as src/format.ts', () => {
    const src = APP_JS.match(/const MONTHS = [\s\S]*?\nfunction shotAlt\(portal, device, week\) \{[\s\S]*?\n\}/)![0];
    const fns = new Function(`${src}; return { weekInWords, shotAlt };`)();
    for (const w of ['2026-01-05', '2026-09-21', '2026-12-28']) {
      expect(fns.weekInWords(w)).toBe(weekInWords(w));
      expect(fns.shotAlt('Le Chat', 'desktop', w)).toBe(shotAlt('Le Chat', 'desktop', w));
    }
  });
  it('drops the old "landing page" alt text', () => {
    expect(APP_JS).not.toMatch(/"landing"|landing page/);
  });
});

// ---- Worker pages ---------------------------------------------------------------
function seed() {
  const t = makeEnv();
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#111111', 1)`);
  t.db.exec(`UPDATE portals SET sort_order = 2 WHERE slug = 'claude'`);
  for (const [w, label] of [['2026-09-21', 'Week of Sep 21, 2026'], ['2026-09-07', 'Week of Sep 7, 2026'], ['2026-08-03', 'Week of Aug 3, 2026']]) {
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${w}', '${label}', '${w}T00:00:00Z')`);
  }
  const cap = (slug: string, portal: string, company: string, week: string, mobile: boolean) =>
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, r2_key_mobile, width, height, analysis, analysis_by, captured_at)
      VALUES ('${slug}-${week}', '${week}', '${slug}', '${portal}', '${company}', 'https://x/', '#000', 'shots/${week}/${slug}.local.png',
              ${mobile ? `'shots/${week}/${slug}.mobile.local.png'` : 'NULL'}, 1280, 800, '', 'pending', '${week}T12:00:00.000Z')`);
  cap('chatgpt', 'ChatGPT', 'OpenAI', '2026-09-21', true);
  cap('chatgpt', 'ChatGPT', 'OpenAI', '2026-09-07', false);
  cap('chatgpt', 'ChatGPT', 'OpenAI', '2026-08-03', true); // system-test week
  cap('claude', 'Claude', 'Anthropic', '2026-09-21', true);
  // Distinct mobile sizes prove the page uses the measured size, not the fallback.
  t.r2.set('shots/2026-09-21/chatgpt.mobile.local.png', png(786, 1700));
  t.r2.set('shots/2026-09-21/claude.mobile.local.png', png(780, 1688));
  t.r2.set('shots/2026-08-03/chatgpt.mobile.local.png', png(780, 1688));
  return t;
}
const v = (week: string) => Date.parse(`${week}T12:00:00.000Z`);

describe('portal and weekly pages', () => {
  let t: ReturnType<typeof seed>;
  beforeEach(() => { t = seed(); });
  const html = async (path: string) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();

  it('titles and describes the portal page', async () => {
    const h = await html('/portals/chatgpt');
    expect(h).toContain('<title>ChatGPT interface screenshots — weekly UI history | AI Interface Library</title>');
    expect(h).toContain('<meta name="description" content="Weekly screenshots of the ChatGPT interface by OpenAI, on desktop and mobile, with a short design analysis of each week. Latest: week of September 21, 2026." />');
  });

  it('titles and describes a weekly page', async () => {
    const h = await html('/portals/chatgpt/2026-09-07');
    expect(h).toContain('<title>ChatGPT interface — week of September 7, 2026 | AI Interface Library</title>');
    expect(h).toContain('<meta name="description" content="Screenshots of the ChatGPT interface by OpenAI from the week of September 7, 2026, on desktop and mobile, with a short design analysis." />');
  });

  it('gives each screenshot a descriptive alt and its real size', async () => {
    const h = await html('/portals/chatgpt/2026-09-21');
    expect(h).toContain(`<img src="/img/shots/2026-09-21/chatgpt.local.png?v=${v('2026-09-21')}" alt="ChatGPT desktop interface, week of September 21, 2026" width="1280" height="800" loading="eager" />`);
    expect(h).toContain(`<img src="/img/shots/2026-09-21/chatgpt.mobile.local.png?v=${v('2026-09-21')}" alt="ChatGPT mobile interface, week of September 21, 2026" width="786" height="1700" loading="lazy" />`);
    for (const img of h.match(/<img [^>]*>/g)!) expect(img).toMatch(/ width="\d+" height="\d+"/);
  });

  it('falls back to the capture size when a mobile screenshot cannot be measured', async () => {
    t.r2.delete('shots/2026-09-21/claude.mobile.local.png');
    const h = await html('/portals/claude');
    expect(h).toContain('alt="Claude mobile interface, week of September 21, 2026" width="780" height="1688"');
  });
});

describe('/sitemap.xml images', () => {
  it('lists each screenshot under its portal and weekly page, and leaves out system-test weeks', async () => {
    const t = seed();
    const xml = await (await handleSitemap(t.env)).text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">');
    const entry = (loc: string) => xml.match(new RegExp(`<url>\\s*<loc>${loc.replace(/[.?]/g, '\\$&')}</loc>[\\s\\S]*?</url>`))![0];
    const imgs = (e: string) => [...e.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1]);
    const shot = (week: string, file: string) => `${ORIGIN}/img/shots/${week}/${file}?v=${v(week)}`;

    expect(imgs(entry(`${ORIGIN}/portals/chatgpt`))).toEqual([shot('2026-09-21', 'chatgpt.local.png'), shot('2026-09-21', 'chatgpt.mobile.local.png')]);
    expect(imgs(entry(`${ORIGIN}/portals/chatgpt/2026-09-21`))).toEqual([shot('2026-09-21', 'chatgpt.local.png'), shot('2026-09-21', 'chatgpt.mobile.local.png')]);
    expect(imgs(entry(`${ORIGIN}/portals/chatgpt/2026-09-07`))).toEqual([shot('2026-09-07', 'chatgpt.local.png')]);
    expect(imgs(entry(`${ORIGIN}/portals/claude`))).toEqual([shot('2026-09-21', 'claude.local.png'), shot('2026-09-21', 'claude.mobile.local.png')]);
    expect(imgs(entry(`${ORIGIN}/`))).toEqual([]);
    expect(xml).not.toContain('2026-08-03');
  });
});

describe('API sizes', () => {
  it('/api/captures gives the desktop and measured mobile size', async () => {
    const t = seed();
    const res = await handleApi(new Request('https://x/api/captures?week=2026-09-21'), t.env, ctx);
    const { captures } = await res.json() as { captures: Record<string, unknown>[] };
    expect(captures.find((c) => c.slug === 'chatgpt')).toMatchObject({ width: 1280, height: 800, mobileWidth: 786, mobileHeight: 1700 });
  });
  it('a sample capture reports the sample asset size', async () => {
    const t = seed();
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('2026-09-14', 'Week of Sep 14, 2026', '2026-09-14T00:00:00Z')`);
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, captured_at) VALUES ('chatgpt-2026-09-14', '2026-09-14', 'chatgpt', 'ChatGPT', 'OpenAI', 'https://x/', '#000', NULL, '2026-09-14T00:00:00Z')`);
    const { captures } = await (await handleApi(new Request('https://x/api/captures?week=2026-09-14'), t.env, ctx)).json() as { captures: Record<string, unknown>[] };
    expect(captures[0]).toMatchObject({ image: '/samples/chatgpt.svg', width: 1280, height: 860, mobileWidth: null });
  });
  it('manual snapshots and notes list a size for each image', async () => {
    const t = seed();
    t.db.exec(`INSERT INTO manual_shots (id, slug, portal, device, r2_key, images, created_at) VALUES ('m1', 'claude', 'Claude', 'desktop', 'manual/claude/m1-0.desktop.jpg', '["manual/claude/m1-0.desktop.jpg","manual/claude/m1-1.desktop.png"]', '2026-09-12T10:00:00Z')`);
    t.db.exec(`INSERT INTO insights (id, title, images, created_at) VALUES ('n1', 'A note', '["insights/n1-0.png"]', '2026-09-13T10:00:00Z')`);
    t.r2.set('manual/claude/m1-0.desktop.jpg', jpeg(1600, 1000));
    t.r2.set('manual/claude/m1-1.desktop.png', png(1440, 900));
    t.r2.set('insights/n1-0.png', png(1200, 630));
    for (const path of ['/api/manual/all', '/api/manual?slug=claude']) {
      const { shots } = await (await handleApi(new Request(`https://x${path}`), t.env, ctx)).json() as { shots: { sizes: unknown }[] };
      expect(shots[0].sizes).toEqual([{ width: 1600, height: 1000 }, { width: 1440, height: 900 }]);
    }
    const { insights } = await (await handleApi(new Request('https://x/api/insights'), t.env, ctx)).json() as { insights: { sizes: unknown }[] };
    expect(insights[0].sizes).toEqual([{ width: 1200, height: 630 }]);
  });
});

describe('homepage meta description', () => {
  it('matches the hero subtitle and says nothing about landing pages', () => {
    const sub = INDEX_HTML.match(/<p class="hero-sub">\s*([\s\S]*?)\s*<\/p>/)![1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      expect(INDEX_HTML).toContain(`<meta ${tag} content="${sub}" />`);
    }
    expect(INDEX_HTML).not.toMatch(/landing page/i);
  });
});

// ---- homepage in the browser -------------------------------------------------------
describe('homepage images in the browser', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  async function open(): Promise<Page> {
    const t = seed();
    t.db.exec(`INSERT INTO insights (id, title, images, created_at) VALUES ('n1', 'A note', '["insights/n1-0.png"]', '2026-09-13T10:00:00Z')`);
    t.r2.set('insights/n1-0.png', png(1200, 630));
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== 'site.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: INDEX_HTML.replace('<html lang="en"', '<html data-consent="not-required" lang="en"') });
      if (url.pathname.startsWith('/api/')) {
        const res = await handleApi(new Request(url.href), t.env, ctx);
        return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
      }
      if (url.pathname.startsWith('/img/')) return route.fulfill({ status: 404, body: '' });
      try {
        const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        return route.fulfill({ contentType: type, body: readFileSync(new URL(`.${url.pathname}`, PUBLIC)) });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await context.routeWebSocket(/\/agents\//, (ws) => ws.close());
    const page = await context.newPage();
    await page.goto('https://site.test/');
    await page.waitForSelector('.card .shot img');
    return page;
  }
  const imgs = (p: Page, sel: string) => p.locator(sel).evaluateAll((els) => els.map((e) => ({
    alt: e.getAttribute('alt'), width: e.getAttribute('width'), height: e.getAttribute('height'), src: e.getAttribute('src'),
  })));
  const everyImgHasASize = async (p: Page) => {
    const missing = await p.locator('img[src]').evaluateAll((els) => els.filter((e) => !(+e.getAttribute('width')! > 0 && +e.getAttribute('height')! > 0)).map((e) => e.outerHTML));
    expect(missing).toEqual([]);
  };

  it('cards: descriptive alt and real sizes, desktop and mobile, and logos named', async () => {
    const page = await open();
    expect(await imgs(page, '.card .shot img')).toEqual([
      { alt: 'ChatGPT desktop interface, week of September 21, 2026', width: '1280', height: '800', src: `/img/shots/2026-09-21/chatgpt.local.png?v=${v('2026-09-21')}` },
      { alt: 'Claude desktop interface, week of September 21, 2026', width: '1280', height: '800', src: `/img/shots/2026-09-21/claude.local.png?v=${v('2026-09-21')}` },
    ]);
    expect((await imgs(page, '.card .brand-logo img')).map((i) => [i.alt, i.width, i.height])).toEqual([['ChatGPT logo', '64', '64'], ['Claude logo', '64', '64']]);
    await everyImgHasASize(page);

    await page.locator('#gallery [data-device="mobile"], [data-device="mobile"]').first().click();
    await page.waitForFunction(() => document.querySelector('.card .shot img')?.getAttribute('alt')?.includes('mobile'));
    expect((await imgs(page, '.card .shot img')).map((i) => [i.alt, i.width, i.height])).toEqual([
      ['ChatGPT mobile interface, week of September 21, 2026', '786', '1700'],
      ['Claude mobile interface, week of September 21, 2026', '780', '1688'],
    ]);
    await everyImgHasASize(page);
    await page.context().close();
  });

  it('notes: thumbnails carry their size, and the lightbox takes the size and alt of the image it opens', async () => {
    const page = await open();
    await page.goto('https://site.test/#notes');
    await page.waitForSelector('.insight-thumb img');
    expect(await imgs(page, '.insight-thumb img')).toEqual([{ alt: 'A note image 1', width: '1200', height: '630', src: `/img/insights/n1-0.png?v=${Date.parse('2026-09-13T10:00:00Z')}` }]);
    await page.locator('.insight-thumb').click();
    expect((await imgs(page, '.lb-img'))[0]).toMatchObject({ alt: 'A note image 1', width: '1200', height: '630' });
    await everyImgHasASize(page);
    await page.context().close();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleSitemap, handlePortalPage, handleHowWeAnalyze, handlePrivacy, ORIGIN, HOW_WE_ANALYZE_UPDATED, PRIVACY_UPDATED_DATE, PRIVACY_UPDATED, SITE_PREVIEW } from '../../src/portal-page';
import { handleApi } from '../../src/api';
import { makeEnv } from './fake-env';

// SEO metadata: sitemap <lastmod>, robots, link previews, descriptions, JSON-LD and the RSS feed.

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const png = (w: number, h: number) => new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 6, 0, 0, 0]);

const SUMMARY_SENTENCES = [
  'This shows the desktop version of ChatGPT for the week of 2026-09-21, before scrolling.',
  'The screen uses a black background with a sidebar on the left.',
  'The message box sits in the middle, under the question.',
];

/** ChatGPT (3 weeks, one a system-test week) and Claude (1 week), with published analyses on some rows. */
export function seed() {
  const t = makeEnv();
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#111111', 1)`);
  t.db.exec(`UPDATE portals SET sort_order = 2 WHERE slug = 'claude'`);
  for (const [w, label] of [['2026-09-21', 'Week of Sep 21, 2026'], ['2026-09-07', 'Week of Sep 7, 2026'], ['2026-08-03', 'Week of Aug 3, 2026']]) {
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${w}', '${label}', '${w}T00:00:00Z')`);
  }
  const cap = (slug: string, portal: string, company: string, week: string, o: { mobile?: boolean; capturedAt: string; publishedAt?: string | null; sentences?: string[] }) => {
    const sentences = o.sentences ?? [];
    const summary = sentences.join(' ');
    const json = sentences.length ? JSON.stringify({ summary, summary_sentences: sentences.map((text) => ({ text })) }) : null;
    t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, r2_key_mobile, width, height, analysis, analysis_by, analysis_json, analysis_published_at, captured_at)
      VALUES (?, ?, ?, ?, ?, 'https://x/', '#000', ?, ?, 1280, 800, ?, ?, ?, ?, ?)`).run(
      `${slug}-${week}`, week, slug, portal, company, `shots/${week}/${slug}.local.png`, o.mobile ? `shots/${week}/${slug}.mobile.local.png` : null,
      summary, sentences.length ? 'guideline-v1.3' : 'pending', json, o.publishedAt ?? null, o.capturedAt);
  };
  cap('chatgpt', 'ChatGPT', 'OpenAI', '2026-09-21', { mobile: true, capturedAt: '2026-09-25T15:12:37.969Z', publishedAt: '2026-09-26T08:00:00.500Z', sentences: SUMMARY_SENTENCES });
  cap('chatgpt', 'ChatGPT', 'OpenAI', '2026-09-07', { capturedAt: '2026-09-13T16:59:51.824Z' });
  cap('chatgpt', 'ChatGPT', 'OpenAI', '2026-08-03', { mobile: true, capturedAt: '2026-09-28T00:00:00.000Z', publishedAt: '2026-09-28T01:00:00Z', sentences: ['Test week.'] }); // system-test week
  cap('claude', 'Claude', 'Anthropic', '2026-09-21', { mobile: true, capturedAt: '2026-09-26T00:52:33.938Z', sentences: ['This shows the desktop version of Claude for the week of 2026-09-21, before scrolling.'] });
  t.r2.set('shots/2026-09-21/chatgpt.mobile.local.png', png(780, 1688));
  t.r2.set('shots/2026-09-21/claude.mobile.local.png', png(780, 1688));
  return t;
}

describe('sitemap <lastmod>', () => {
  let xml: string;
  beforeEach(async () => { xml = await (await handleSitemap(seed().env)).text(); });
  const lastmod = (loc: string) => xml.match(new RegExp(`<loc>${loc.replace(/[.?]/g, '\\$&')}</loc>\\s*<lastmod>([^<]+)</lastmod>`))?.[1];

  it('gives every URL a lastmod', () => {
    expect(xml.match(/<url>/g)!.length).toBe(xml.match(/<lastmod>/g)!.length);
  });
  it('weekly pages use the later of their capture and analysis publish time', () => {
    expect(lastmod(`${ORIGIN}/portals/chatgpt/2026-09-21`)).toBe('2026-09-26T08:00:00Z'); // analysis published after capture
    expect(lastmod(`${ORIGIN}/portals/chatgpt/2026-09-07`)).toBe('2026-09-13T16:59:51Z'); // no analysis
  });
  it('portal hubs and the homepage use the newest change across their weeks, ignoring system-test weeks', () => {
    expect(lastmod(`${ORIGIN}/portals/chatgpt`)).toBe('2026-09-26T08:00:00Z');
    expect(lastmod(`${ORIGIN}/portals/claude`)).toBe('2026-09-26T00:52:33Z');
    expect(lastmod(`${ORIGIN}/`)).toBe('2026-09-26T08:00:00Z'); // not the 2026-09-28 system-test row
  });
  it('/how-we-analyze and /privacy use their last-updated dates', () => {
    expect(lastmod(`${ORIGIN}/how-we-analyze`)).toBe(HOW_WE_ANALYZE_UPDATED);
    expect(lastmod(`${ORIGIN}/privacy`)).toBe(PRIVACY_UPDATED_DATE);
    expect(PRIVACY_UPDATED).toBe('September 27, 2026'); // the date shown on /privacy
  });
});

describe('analysis publish time', () => {
  it('POST /api/analysis records when it was published', async () => {
    const t = seed();
    const analysis = {
      guideline_version: '1.3', portal: 'chatgpt', week: '2026-09-07', variant: 'desktop', status: 'not_analyzable',
    };
    const before = Date.now();
    const res = await handleApi(new Request('https://x/api/analysis', {
      method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'chatgpt', week: '2026-09-07', analysis }),
    }), t.env, ctx);
    expect(res.status).toBe(200);
    const row = t.db.prepare(`SELECT analysis_published_at FROM captures WHERE id = 'chatgpt-2026-09-07'`).get() as { analysis_published_at: string };
    expect(Date.parse(row.analysis_published_at)).toBeGreaterThanOrEqual(before);
  });
});

// ---- robots and link previews ------------------------------------------------------
const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const head = (html: string) => html.match(/<head>([\s\S]*?)<\/head>/)![1];
/** content of <meta property|name="key">, or undefined; fails if the tag appears more than once. */
function meta(html: string, key: string): string | undefined {
  const all = [...head(html).matchAll(new RegExp(`<meta (?:property|name)="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)" />`, 'g'))];
  expect(all.length, key).toBeLessThanOrEqual(1);
  return all[0]?.[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
const canonicalOf = (html: string) => head(html).match(/<link rel="canonical" href="([^"]+)" \/>/)?.[1];

describe('robots and link previews', () => {
  let t: ReturnType<typeof seed>;
  beforeEach(() => { t = seed(); });
  const portal = async (path: string) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();
  const v = (at: string) => Date.parse(at);

  it('marks every indexable page max-image-preview:large and keeps noindex on system-test weeks', async () => {
    for (const html of [INDEX_HTML, await portal('/portals/chatgpt'), await portal('/portals/chatgpt/2026-09-07'),
      await (await handleHowWeAnalyze(new Request('https://x/how-we-analyze'))).text(),
      await (await handlePrivacy(new Request('https://x/privacy'))).text()]) {
      expect(meta(html, 'robots')).toBe('max-image-preview:large');
    }
    expect(meta(await portal('/portals/chatgpt/2026-08-03'), 'robots')).toBe('noindex');
    expect(meta(await portal('/portals/nope'), 'robots')).toBe('noindex');
  });

  it('a weekly page previews its own desktop screenshot', async () => {
    const html = await portal('/portals/chatgpt/2026-09-07');
    expect(meta(html, 'og:image')).toBe(`${ORIGIN}/img/shots/2026-09-07/chatgpt.local.png?v=${v('2026-09-13T16:59:51.824Z')}`);
    expect(meta(html, 'og:image:width')).toBe('1280');
    expect(meta(html, 'og:image:height')).toBe('800');
    expect(meta(html, 'og:image:alt')).toBe('ChatGPT desktop interface, week of September 7, 2026');
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
    // The preview image is the screenshot shown on the page, with the same alt.
    expect(html).toContain(`<img src="/img/shots/2026-09-07/chatgpt.local.png?v=${v('2026-09-13T16:59:51.824Z')}" alt="${meta(html, 'og:image:alt')}"`);
  });

  it('a portal hub previews its latest week', async () => {
    const html = await portal('/portals/chatgpt');
    expect(meta(html, 'og:image')).toBe(`${ORIGIN}/img/shots/2026-09-21/chatgpt.local.png?v=${v('2026-09-25T15:12:37.969Z')}`);
    expect(meta(html, 'og:image:alt')).toBe('ChatGPT desktop interface, week of September 21, 2026');
  });

  it('pages without a screenshot keep the site preview image', async () => {
    for (const html of [await (await handleHowWeAnalyze(new Request('https://x/how-we-analyze'))).text(), await (await handlePrivacy(new Request('https://x/privacy'))).text(), INDEX_HTML]) {
      expect(meta(html, 'og:image')).toBe(SITE_PREVIEW.url);
      expect([meta(html, 'og:image:width'), meta(html, 'og:image:height')]).toEqual(['1200', '630']);
      expect(meta(html, 'og:image:alt')).toBe(SITE_PREVIEW.alt);
      expect(meta(html, 'twitter:card')).toBe('summary_large_image');
      expect(meta(html, 'twitter:image')).toBe(SITE_PREVIEW.url);
    }
    // og-image.png really is 1200x630.
    const b = readFileSync(new URL('../../public/og-image.png', import.meta.url));
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('every page has og:url matching its canonical', async () => {
    for (const html of [INDEX_HTML, await portal('/portals/chatgpt'), await portal('/portals/chatgpt/'), await portal('/portals/chatgpt/2026-09-21'),
      await (await handleHowWeAnalyze(new Request('https://x/how-we-analyze'))).text(), await (await handlePrivacy(new Request('https://x/privacy'))).text()]) {
      expect(canonicalOf(html)).toBeTruthy();
      expect(meta(html, 'og:url')).toBe(canonicalOf(html));
    }
  });
});

// ---- weekly descriptions from the analysis summary -----------------------------------
describe('weekly page descriptions', () => {
  let t: ReturnType<typeof seed>;
  beforeEach(() => { t = seed(); });
  const portal = async (path: string) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();
  const descriptions = (html: string) => ['description', 'og:description', 'twitter:description'].map((k) => meta(html, k));

  it('uses the first two summary sentences when they fit under 160 characters', async () => {
    const d = `${SUMMARY_SENTENCES[0]} ${SUMMARY_SENTENCES[1]}`;
    expect(d.length).toBeLessThan(160);
    expect(descriptions(await portal('/portals/chatgpt/2026-09-21'))).toEqual([d, d, d]);
  });

  it('uses one sentence when two would be too long, and ends at a sentence end', async () => {
    const long = 'The message box sits in the middle of the screen, under a large greeting, with suggested prompts below it.';
    t.db.prepare(`UPDATE captures SET analysis_json = ? WHERE id = 'chatgpt-2026-09-21'`).run(JSON.stringify({ summary_sentences: [{ text: SUMMARY_SENTENCES[0] }, { text: long }] }));
    const [d] = descriptions(await portal('/portals/chatgpt/2026-09-21'));
    expect(d).toBe(SUMMARY_SENTENCES[0]);
    expect(d!.endsWith('.')).toBe(true);
  });

  it('keeps the current description when the first sentence alone is 160 characters or more', async () => {
    const first = `This shows the desktop version of ChatGPT ${'with a very long description '.repeat(5)}for the week.`;
    expect(first.length).toBeGreaterThanOrEqual(160);
    t.db.prepare(`UPDATE captures SET analysis_json = ? WHERE id = 'chatgpt-2026-09-21'`).run(JSON.stringify({ summary_sentences: [{ text: first }] }));
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toMatch(/^Screenshots of the ChatGPT interface by OpenAI from the week of September 21, 2026/);
  });

  it('a first sentence of exactly 160 characters is too long', async () => {
    const first = `${'x'.repeat(159)}.`;
    expect(first.length).toBe(160);
    t.db.prepare(`UPDATE captures SET analysis_json = ? WHERE id = 'chatgpt-2026-09-21'`).run(JSON.stringify({ summary_sentences: [{ text: first }] }));
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toMatch(/^Screenshots of the ChatGPT/);
  });

  it('falls back to splitting the summary text when summary_sentences is missing', async () => {
    t.db.exec(`UPDATE captures SET analysis_json = NULL WHERE id = 'chatgpt-2026-09-21'`);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toBe(`${SUMMARY_SENTENCES[0]} ${SUMMARY_SENTENCES[1]}`);
  });

  it('keeps the current description without a published analysis, and on portal hubs', async () => {
    expect(meta(await portal('/portals/chatgpt/2026-09-07'), 'description')).toBe('Screenshots of the ChatGPT interface by OpenAI from the week of September 7, 2026, on desktop and mobile, with a short design analysis.');
    t.db.exec(`UPDATE captures SET analysis_by = 'pending' WHERE id = 'chatgpt-2026-09-21'`);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toMatch(/^Screenshots of the ChatGPT interface/);
    t.db.exec(`UPDATE captures SET analysis_by = 'guideline-v1.3' WHERE id = 'chatgpt-2026-09-21'`);
    expect(meta(await portal('/portals/chatgpt'), 'description')).toMatch(/^Weekly screenshots of the ChatGPT interface by OpenAI/);
  });
});

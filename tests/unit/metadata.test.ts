import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readFileSync } from 'node:fs';
import { handleSitemap, handleFeed, handlePortalPage, handleHowWeAnalyze, handlePrivacy, ORIGIN, FEED_URL, FEED_DESCRIPTION, HOW_WE_ANALYZE_UPDATED, PRIVACY_UPDATED_DATE, PRIVACY_UPDATED, SITE_PREVIEW } from '../../src/portal-page';
import { handleApi } from '../../src/api';
import { makeEnv } from './fake-env';
import { invalidate } from '../../src/capture';
import { FIXED_SUMMARY_OPENING } from '../../src/analysis';
import { CACHE_VERSION } from '../../src/db';

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
  const setSentences = (id: string, sentences: string[]) =>
    t.db.prepare(`UPDATE captures SET analysis_json = ?, analysis = ? WHERE id = ?`).run(JSON.stringify({ summary_sentences: sentences.map((text) => ({ text })) }), sentences.join(' '), id);
  const OPENING = SUMMARY_SENTENCES[0];
  const CURRENT = /^Screenshots of the ChatGPT interface by OpenAI from the week of September 21, 2026/;

  it('skips the fixed opening and uses the sentences after it, as many as fit under 160 characters', async () => {
    expect(OPENING).toMatch(FIXED_SUMMARY_OPENING);
    const d = `${SUMMARY_SENTENCES[1]} ${SUMMARY_SENTENCES[2]}`;
    expect(d.length).toBeLessThan(160);
    expect(descriptions(await portal('/portals/chatgpt/2026-09-21'))).toEqual([d, d, d]);
  });

  it('stops at the last sentence that fits, so it always ends at a sentence end', async () => {
    const s = ['The screen is dark.', 'A sidebar runs down the left side of the screen with the conversation list and settings.', 'The message box sits in the middle of the screen, under a large greeting.'];
    setSentences('chatgpt-2026-09-21', [OPENING, ...s]);
    const [d] = descriptions(await portal('/portals/chatgpt/2026-09-21'));
    expect(d).toBe(`${s[0]} ${s[1]}`);
    expect(`${d} ${s[2]}`.length).toBeGreaterThanOrEqual(160);
    expect(d!.endsWith('.')).toBe(true);
  });

  it('keeps the current description when the first sentence after the opening is 160 characters or more', async () => {
    setSentences('chatgpt-2026-09-21', [OPENING, `${'x'.repeat(159)}.`, 'Short.']);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toMatch(CURRENT);
  });

  it('keeps the current description when the summary is only the fixed opening', async () => {
    setSentences('chatgpt-2026-09-21', [OPENING]);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toMatch(CURRENT);
    expect(meta(await portal('/portals/claude/2026-09-21'), 'description')).toMatch(/^Screenshots of the Claude interface/); // seeded that way
  });

  it('does not skip a first sentence that is not the fixed opening', async () => {
    setSentences('chatgpt-2026-09-21', ['A dark screen with a sidebar.', 'The message box sits in the middle.']);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toBe('A dark screen with a sidebar. The message box sits in the middle.');
  });

  it('falls back to splitting the summary text when summary_sentences is missing', async () => {
    t.db.exec(`UPDATE captures SET analysis_json = NULL WHERE id = 'chatgpt-2026-09-21'`);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toBe(`${SUMMARY_SENTENCES[1]} ${SUMMARY_SENTENCES[2]}`);
  });

  it('keeps the current description without a published analysis, and on portal hubs', async () => {
    expect(meta(await portal('/portals/chatgpt/2026-09-07'), 'description')).toBe('Screenshots of the ChatGPT interface by OpenAI from the week of September 7, 2026, on desktop and mobile, with a short design analysis.');
    t.db.exec(`UPDATE captures SET analysis_by = 'pending' WHERE id = 'chatgpt-2026-09-21'`);
    expect(meta(await portal('/portals/chatgpt/2026-09-21'), 'description')).toMatch(CURRENT);
    t.db.exec(`UPDATE captures SET analysis_by = 'guideline-v1.3' WHERE id = 'chatgpt-2026-09-21'`);
    expect(meta(await portal('/portals/chatgpt'), 'description')).toMatch(/^Weekly screenshots of the ChatGPT interface by OpenAI/);
  });
});

// ---- JSON-LD -----------------------------------------------------------------------
const FORBIDDEN = /"(author|creator|license|acquireLicensePage|copyright\w*|publisher|creditText)"/i;
/** Every JSON-LD block on the page, parsed (a block that doesn't parse fails the test). */
function jsonLd(html: string): Record<string, any>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}
/** The page's visible text: body without scripts and tags, entities decoded, whitespace collapsed. */
function visibleText(html: string): string {
  return html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&larr;/g, '←').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
}
/** Every <img> on the page as {src (absolute), alt, width, height}. */
function pageImages(html: string) {
  return [...html.matchAll(/<img ([^>]*)\/?>/g)].map((m) => {
    const a = (k: string) => m[1].match(new RegExp(`${k}="([^"]*)"`))?.[1];
    const src = a('src')!;
    return { src: src.startsWith('/') ? ORIGIN + src : src, alt: a('alt'), width: Number(a('width')), height: Number(a('height')) };
  });
}

describe('JSON-LD', () => {
  let t: ReturnType<typeof seed>;
  beforeEach(() => { t = seed(); });
  const portal = async (path: string) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();

  it('homepage: a WebSite with the site name and URL, and nothing else', () => {
    expect(jsonLd(INDEX_HTML)).toEqual([{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'AI Interface Library', url: `${ORIGIN}/` }]);
    expect(INDEX_HTML).toContain('<link rel="canonical" href="https://ai-portal-library.dev/" />');
    expect(INDEX_HTML).toContain('aria-label="AI Interface Library"'); // the visible site title
  });

  it('portal hub: breadcrumb Home › Portal, and an ImageObject per screenshot shown', async () => {
    const html = await portal('/portals/chatgpt');
    const [block] = jsonLd(html);
    expect(block['@context']).toBe('https://schema.org');
    const [crumbs, ...images] = block['@graph'];
    expect(crumbs).toEqual({ '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'AI Interface Library', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'ChatGPT', item: `${ORIGIN}/portals/chatgpt` },
    ] });
    expect(images.map((i: any) => i['@type'])).toEqual(['ImageObject', 'ImageObject']);
  });

  it('weekly page: breadcrumb Home › Portal › Week of Month D, YYYY', async () => {
    const [block] = jsonLd(await portal('/portals/chatgpt/2026-09-07'));
    expect(block['@graph'][0].itemListElement.map((c: any) => [c.position, c.name, c.item])).toEqual([
      [1, 'AI Interface Library', `${ORIGIN}/`],
      [2, 'ChatGPT', `${ORIGIN}/portals/chatgpt`],
      [3, 'Week of September 7, 2026', `${ORIGIN}/portals/chatgpt/2026-09-07`],
    ]);
    expect(block['@graph'].slice(1)).toHaveLength(1); // desktop only that week
  });

  it.each([['/portals/chatgpt'], ['/portals/chatgpt/2026-09-21'], ['/portals/chatgpt/2026-09-07'], ['/portals/claude']])(
    '%s: every block parses and matches the visible page', async (path) => {
      const html = await portal(path);
      const blocks = jsonLd(html);
      expect(blocks).toHaveLength(1);
      expect(html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)![0]).not.toMatch(FORBIDDEN);
      const text = visibleText(html).toLowerCase();
      const graph = blocks[0]['@graph'];

      // Breadcrumbs: each name is on the page, the portal is the <h1>, links are this site's pages.
      const crumbs = graph[0].itemListElement;
      for (const c of crumbs) expect(text, c.name).toContain(c.name.toLowerCase());
      expect(html).toContain(`<h1>${crumbs[1].name}</h1>`);
      expect(html).toContain(`<a href="/">&larr; ${crumbs[0].name}</a>`);
      expect(crumbs.at(-1).item).toBe(html.match(/<link rel="canonical" href="([^"]+)" \/>/)![1]);

      // ImageObjects: exactly the screenshots on the page, same URL, caption = alt, same size.
      const images = graph.slice(1).map((i: any) => ({ src: i.contentUrl, alt: i.caption, width: i.width, height: i.height }));
      expect(images).toEqual(pageImages(html));
      for (const i of graph.slice(1)) expect(Object.keys(i).sort()).toEqual(['@type', 'caption', 'contentUrl', 'height', 'width']);
    });

  it('escapes "<" so data can never close the script element', async () => {
    t.db.exec(`UPDATE portals SET name = 'Chat</script><b>GPT' WHERE slug = 'chatgpt'`);
    const html = await portal('/portals/chatgpt');
    const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(script).not.toContain('<');
    expect(JSON.parse(script)['@graph'][0].itemListElement[1].name).toBe('Chat</script><b>GPT');
  });
});

// ---- RSS feed --------------------------------------------------------------------------
describe('/feed.xml', () => {
  let t: ReturnType<typeof seed>;
  let xml: string;
  beforeEach(async () => { t = seed(); xml = await (await handleFeed(t.env)).text(); });
  const items = (x: string) => [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const f = (k: string) => m[1].match(new RegExp(`<${k}[^>]*>([\\s\\S]*?)</${k}>`))?.[1];
    return { title: f('title'), link: f('link'), guid: f('guid'), pubDate: f('pubDate'), description: f('description') };
  });

  it('has one item per portal per week with a published analysis, newest first, without system-test weeks', () => {
    expect(items(xml).map((i) => i.link)).toEqual([`${ORIGIN}/portals/chatgpt/2026-09-21`, `${ORIGIN}/portals/claude/2026-09-21`]);
  });

  it('titles, links and describes each item from its weekly page and summary', () => {
    expect(items(xml)[0]).toEqual({
      title: 'ChatGPT interface — week of September 21, 2026',
      link: `${ORIGIN}/portals/chatgpt/2026-09-21`,
      guid: `${ORIGIN}/portals/chatgpt/2026-09-21`,
      pubDate: 'Sat, 26 Sep 2026 08:00:00 GMT', // the analysis was published after the capture
      description: SUMMARY_SENTENCES.slice(1).join(' '), // the full summary without the fixed opening
    });
    expect(xml).toContain(`<guid isPermaLink="true">${ORIGIN}/portals/chatgpt/2026-09-21</guid>`);
    expect(items(xml)[1].pubDate).toBe('Sat, 26 Sep 2026 00:52:33 GMT'); // no publish time recorded: capture time
    // A summary that is only the fixed opening stays as it is, rather than an empty description.
    expect(items(xml)[1].description).toBe('This shows the desktop version of Claude for the week of 2026-09-21, before scrolling.');
  });

  it('describes the channel and links to itself', () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:atom="http:\/\/www.w3.org\/2005\/Atom">/);
    expect(xml).toContain('<title>AI Interface Library</title>');
    expect(xml).toContain(`<link>${ORIGIN}/</link>`);
    expect(xml).toContain(`<description>${FEED_DESCRIPTION}</description>`);
    expect(xml).toContain(`<atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />`);
    expect(xml).toContain('<lastBuildDate>Sat, 26 Sep 2026 08:00:00 GMT</lastBuildDate>');
    expect(INDEX_HTML).toContain(`<meta name="description" content="${FEED_DESCRIPTION}" />`);
  });

  it('leaves out unpublished analyses and escapes text', async () => {
    t.db.exec(`UPDATE captures SET analysis_by = 'pending' WHERE id = 'claude-2026-09-21'`);
    t.db.exec(`UPDATE captures SET analysis = 'Tabs <b> & "quotes"', analysis_json = NULL WHERE id = 'chatgpt-2026-09-21'`);
    t.kv.clear();
    const x = await (await handleFeed(t.env)).text();
    expect(items(x).map((i) => i.link)).toEqual([`${ORIGIN}/portals/chatgpt/2026-09-21`]);
    expect(items(x)[0].description).toBe('Tabs &lt;b&gt; &amp; &quot;quotes&quot;');
  });

  it('is RSS, cached in KV, and cleared by invalidate()', async () => {
    const res = await handleFeed(t.env);
    expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    expect(t.kv.has(`${CACHE_VERSION}:cache:feed`)).toBe(true);
    await invalidate(t.env, '2026-09-21');
    expect(t.kv.has(`${CACHE_VERSION}:cache:feed`)).toBe(false);
  });

  it('is routed to the Worker in both configs', () => {
    for (const f of ['wrangler.jsonc', 'wrangler.dev.jsonc']) {
      const w = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      expect(w.match(/"run_worker_first": \[([^\]]*)\]/)![1], f).toContain('"/feed.xml"');
    }
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).toContain('if (url.pathname === "/feed.xml") return await handleFeed(env);');
  });

  it('is linked from every page', async () => {
    const LINK = `<link rel="alternate" type="application/rss+xml" title="AI Interface Library" href="${FEED_URL}" />`;
    for (const html of [INDEX_HTML, await (await handlePortalPage(new Request('https://x/portals/chatgpt'), t.env)).text(),
      await (await handlePortalPage(new Request('https://x/portals/chatgpt/2026-09-21'), t.env)).text(),
      await (await handlePortalPage(new Request('https://x/portals/chatgpt/2026-08-03'), t.env)).text(),
      await (await handleHowWeAnalyze(new Request('https://x/how-we-analyze'))).text(),
      await (await handlePrivacy(new Request('https://x/privacy'))).text()]) {
      expect(head(html).split(LINK).length - 1).toBe(1);
    }
  });

  it('is not listed in robots.txt, which has no directive for feeds', () => {
    const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).not.toContain('feed.xml');
  });
});

describe('XML is well formed', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });
  it.each([['sitemap.xml'], ['feed.xml']])('%s parses with no errors', async (name) => {
    const t = seed();
    t.db.exec(`UPDATE captures SET analysis = 'Tabs <b> & "quotes" — ok' WHERE id = 'chatgpt-2026-09-21'`);
    const xml = await (await (name === 'feed.xml' ? handleFeed(t.env) : handleSitemap(t.env))).text();
    const page = await browser.newPage();
    const errors = await page.evaluate((x) => {
      const doc = new DOMParser().parseFromString(x, 'application/xml');
      return doc.getElementsByTagName('parsererror').length;
    }, xml);
    expect(errors).toBe(0);
    await page.close();
  });
});

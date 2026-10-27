import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleComparePage } from '../../src/compare-page';
import { comparePair, compareTableHash, parseComparePath } from '../../src/compare';
import { handlePortalPage, handleSitemap } from '../../src/portal-page';
import { handleLlmsTxt } from '../../src/aeo';
import { captureMetrics } from '../../src/capture-metrics';
import type { CaptureRow, PortalRow } from '../../src/types';
import { makeEnv } from './fake-env';
// @ts-expect-error -- plain browser module without type declarations
import { findingLists, tableFindings } from '../../public/analytics-canvas.js';

// /compare/<a>-vs-<b> (src/compare-page.ts, src/compare.ts): crawlable comparisons of two portals.

const ORIGIN = 'https://ai-portal-library.dev';
const NEW = '2026-10-12', OLD = '2026-10-05';

let t: ReturnType<typeof makeEnv>;

function analysis(slug: string, week: string, o: { sidebar: string; input: string; sizes: number; note: string; scheme: string; n1: unknown[]; changes?: unknown[] }) {
  return {
    guideline_version: '1.5.2', portal: slug, week, previous_week: OLD, variant: 'desktop', status: 'ok',
    context: { color_scheme: o.scheme },
    metrics: [
      { id: 'L2', value: o.sidebar }, { id: 'H2', value: o.input }, { id: 'H3', value: o.sizes },
      { id: 'D6', value: o.note }, { id: 'L3', value: { vertical_third: 'middle' } },
      { id: 'N1', value: o.n1, sidebar: 'visible' },
    ],
    changes_vs_previous: o.changes ?? [],
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`,
  };
}

function addCapture(slug: string, week: string, a: unknown, by = 'guideline-v1.5.2') {
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at)
                VALUES (?, ?, ?, ?, 'Co', 'https://example.com/', '#000000', ?, ?, ?, ?, ?, 'ok', ?)`)
    .run(`${slug}-${week}`, week, slug, slug, `shots/${week}/${slug}.local.png`, (a as { summary?: string } | null)?.summary ?? '', by, a ? JSON.stringify(a) : null,
      `${week}T20:00:00Z`, `${week}T09:00:00Z`);
}

const item = (label: string, region = 'sidebar') => ({ label, region, badge: null });
const renamed = { id: 'N1', change: 'renamed', previous: 'More', current: 'Explore', region: 'sidebar', status: 'changed' };

beforeEach(() => {
  t = makeEnv(); // has Claude
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES
    ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0),
    ('gemini', 'Gemini', 'Google', 'https://gemini.google.com/', '#4285f4', 2),
    ('perplexity', 'Perplexity', 'Perplexity AI', 'https://perplexity.ai/', '#20808d', 3),
    ('copilot', 'Microsoft Copilot', 'Microsoft', 'https://copilot.microsoft.com/', '#0078d4', 4),
    ('poe', 'Poe', 'Quora', 'https://poe.com/', '#5d5cde', 10)`);
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, active) VALUES ('retired', 'Retired', 'Gone Inc', 'https://x/', '#000000', 0)`);
  t.db.exec(`UPDATE portals SET sort_order = 1 WHERE slug = 'claude'`);
  addCapture('chatgpt', OLD, analysis('chatgpt', OLD, { sidebar: '20%', input: '4%', sizes: 4, note: 'none', scheme: 'dark', n1: [item('New chat'), item('More')] }));
  addCapture('chatgpt', NEW, analysis('chatgpt', NEW, { sidebar: '20%', input: '4%', sizes: 4, note: 'none', scheme: 'dark', n1: [item('New chat'), item('Explore')], changes: [renamed] }));
  addCapture('claude', OLD, analysis('claude', OLD, { sidebar: '18%', input: '9%', sizes: 6, note: 'Claude can make mistakes', scheme: 'light', n1: [item('New chat')] }));
  addCapture('claude', NEW, analysis('claude', NEW, { sidebar: '18%', input: '9%', sizes: 6, note: 'Claude can make mistakes', scheme: 'light', n1: [item('New chat')] }));
  // Gemini: a shared week, but its analysis is not published, so there are no findings. Perplexity: no captures at all.
  addCapture('gemini', OLD, null, 'pending');
});

const get = (path: string, init?: RequestInit) => handleComparePage(new Request(`https://x${path}`, init), t.env);
const html = async (path: string) => (await get(path)).text();
const jsonLd = (s: string) => [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const robots = (s: string) => s.match(/<meta name="robots" content="([^"]+)"/)?.[1];

describe('URLs', () => {
  it('301s the reversed pair, a trailing slash and the reversed .md to the one canonical URL', async () => {
    for (const [from, to] of [
      ['/compare/claude-vs-chatgpt', '/compare/chatgpt-vs-claude'],
      ['/compare/chatgpt-vs-claude/', '/compare/chatgpt-vs-claude'],
      ['/compare/claude-vs-chatgpt.md', '/compare/chatgpt-vs-claude.md'],
    ]) {
      const res = await get(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.get('location'), from).toBe(`https://x${to}`);
    }
  });

  it('404s unknown, inactive, repeated and malformed slugs', async () => {
    for (const path of ['/compare/chatgpt-vs-nope', '/compare/nope-vs-chatgpt', '/compare/chatgpt-vs-retired', '/compare/chatgpt-vs-chatgpt',
      '/compare/chatgpt', '/compare/chatgpt-vs-claude-vs-gemini', '/compare/ChatGPT-vs-Claude', '/compare/']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
    }
  });

  it('parses slugs with hyphens', () => {
    expect(parseComparePath('/compare/chatgpt-vs-meta-ai')).toEqual({ a: 'chatgpt', b: 'meta-ai', markdown: false, trailingSlash: false });
    expect(parseComparePath('/compare/meta-ai-vs-poe.md')).toEqual({ a: 'meta-ai', b: 'poe', markdown: true, trailingSlash: false });
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    expect(await (await get('/compare/chatgpt-vs-claude', { method: 'HEAD' })).text()).toBe('');
    expect((await get('/compare/chatgpt-vs-claude', { method: 'POST' })).status).toBe(405);
  });

  it('is routed to the Worker', () => {
    for (const f of ['wrangler.jsonc', 'wrangler.dev.jsonc']) {
      expect(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'), f).toContain('"/compare/*"');
    }
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).toContain('url.pathname.startsWith("/compare/")) return await handleComparePage(request, env)');
  });
});

describe('/compare/chatgpt-vs-claude', () => {
  let page: string;
  beforeEach(async () => { page = await html('/compare/chatgpt-vs-claude'); });

  it('has the h1, title, summary with the week, and meta description from the summary', () => {
    expect(page).toContain('<h1>ChatGPT vs Claude: UI comparison</h1>');
    expect(page).toContain('<title>ChatGPT vs Claude UI comparison — Oct 12, 2026 | AI Interface Library</title>');
    const summary = page.match(/<p class="cmp-summary">([^<]+)<\/p>/)?.[1];
    expect(summary).toBe('How ChatGPT (OpenAI) and Claude (Anthropic) compare on a desktop screen in the week of October 12, 2026: 5 differences and 2 similarities, measured from each product&#39;s weekly screenshot.');
    expect(page).toContain(`<meta name="description" content="${summary}" />`);
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}/compare/chatgpt-vs-claude" />`);
    expect(page).toContain(`<link rel="alternate" type="text/markdown" href="${ORIGIN}/compare/chatgpt-vs-claude.md" />`);
    expect(robots(page)).toBe('max-image-preview:large');
  });

  it('shows both desktop screenshots of the latest shared week side by side, with alt text', () => {
    const imgs = [...page.matchAll(/<section class="cmp-shots"[\s\S]*?<\/section>/g)][0][0].match(/<img [^>]+>/g)!;
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toContain(`src="/img/shots/${NEW}/chatgpt.local.png?v=`);
    expect(imgs[0]).toContain('alt="ChatGPT UI screenshot, desktop, week of October 12, 2026"');
    expect(imgs[1]).toContain(`src="/img/shots/${NEW}/claude.local.png?v=`);
    expect(imgs[1]).toContain('alt="Claude UI screenshot, desktop, week of October 12, 2026"');
  });

  it("lists the Compare Table's Differences and Similarities, without its line limits", () => {
    const card = (slug: string, label: string) => {
      const row = t.db.prepare(`SELECT * FROM captures WHERE slug = ? AND week = ?`).get(slug, NEW) as unknown as CaptureRow;
      return { label, slug, week: NEW, metrics: captureMetrics(row) };
    };
    const [a, b] = [card('chatgpt', 'ChatGPT'), card('claude', 'Claude')];
    const expected = findingLists(a, b, { navChangeLines: Infinity, brief: true });
    // The Table's cells show the same lines (it has room for all of them here).
    expect(tableFindings(a, b)).toEqual({ differences: expected.differences, similarities: expected.similarities, note: '' });
    const section = (h: string) => [...page.match(new RegExp(`<h2>${h}</h2>([\\s\\S]*?)</section>`))![1].matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1].replace(/&#39;/g, "'"));
    expect(section('Differences')).toEqual(expected.differences);
    expect(section('Similarities')).toEqual(expected.similarities);
    expect(expected.differences).toContain('ChatGPT shows 2 menu items; Claude shows 1.');
    expect(expected.similarities).toEqual(['Both sidebars take a similar share of the screen width (20% vs 18%).', 'Both message boxes sit in the middle third of the screen.']);
  });

  it("shows each portal's latest recorded menu changes", () => {
    const block = page.match(/<h2>Latest menu changes<\/h2>([\s\S]*?)<\/section>/)![1];
    expect(block).toContain('<h3>ChatGPT</h3>');
    expect(block).toContain(`Week of <a href="/portals/chatgpt/${NEW}">October 12, 2026</a>, compared with the week of October 5, 2026:`);
    expect(block).toContain('<li>The sidebar item More is now labeled Explore.</li>');
    expect(block).toContain('No menu changes have been recorded for Claude yet.');
  });

  it('links to both portal pages and opens the same pair and week in Compare', () => {
    expect(page).toContain('<a href="/portals/chatgpt">ChatGPT UI screenshots &amp; interface changes, week by week</a>');
    expect(page).toContain('<a href="/portals/claude">Claude UI screenshots &amp; interface changes, week by week</a>');
    expect(compareTableHash('claude', 'chatgpt', NEW)).toBe(`#compare?view=table&mode=portals&week=${NEW}&portals=chatgpt,claude&device=desktop`);
    expect(page).toContain(`<a class="btn-secondary cmp-open" href="/#compare?view=table&amp;mode=portals&amp;week=${NEW}&amp;portals=chatgpt,claude&amp;device=desktop">Open in Compare`);
  });

  it('describes itself as a WebPage with a breadcrumb and both screenshots', () => {
    const [ld] = jsonLd(page);
    const graph = ld['@graph'] as any[];
    const web = graph.find((n) => n['@type'] === 'WebPage');
    expect(web).toMatchObject({ url: `${ORIGIN}/compare/chatgpt-vs-claude`, name: 'ChatGPT vs Claude: UI comparison', dateModified: NEW });
    expect(web.description).toMatch(/^How ChatGPT \(OpenAI\) and Claude \(Anthropic\) compare/);
    expect(graph.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i: any) => [i.position, i.name, i.item])).toEqual([
      [1, 'AI Interface Library', `${ORIGIN}/`],
      [2, 'ChatGPT vs Claude', `${ORIGIN}/compare/chatgpt-vs-claude`],
    ]);
    const images = graph.filter((n) => n['@type'] === 'ImageObject');
    expect(images.map((i) => [i.caption, i.width, i.height])).toEqual([
      ['ChatGPT UI screenshot, desktop, week of October 12, 2026', 1280, 800],
      ['Claude UI screenshot, desktop, week of October 12, 2026', 1280, 800],
    ]);
    expect(images[0].contentUrl).toMatch(new RegExp(`^${ORIGIN}/img/shots/${NEW}/chatgpt\\.local\\.png\\?v=\\d+$`));
  });

  it('has a Markdown version with the same facts', async () => {
    const res = await get('/compare/chatgpt-vs-claude.md');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('link')).toBe(`<${ORIGIN}/compare/chatgpt-vs-claude>; rel="canonical"`);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    const md = await res.text();
    expect(md.split('\n')[0]).toBe('# ChatGPT vs Claude: UI comparison');
    expect(md).toContain(`- Week: week of October 12, 2026 (${NEW})`);
    expect(md).toContain(`- Open in Compare: ${ORIGIN}/#compare?view=table&mode=portals&week=${NEW}&portals=chatgpt,claude&device=desktop`);
    expect(md).toContain('## Differences\n\n- ');
    expect(md).toContain('## Similarities\n\n- Both sidebars take a similar share of the screen width (20% vs 18%).\n- Both message boxes sit in the middle third of the screen.\n');
    expect(md).toContain('- The sidebar item More is now labeled Explore.');
    expect(md).toContain(`- ChatGPT: ${ORIGIN}/portals/chatgpt`);
    expect(md).toMatch(new RegExp(`- Claude, desktop: ${ORIGIN}/img/shots/${NEW}/claude\\.local\\.png\\?v=\\d+`));
  });
});

describe('noindex', () => {
  it('marks pairs without enough findings or without a shared capture, and leaves them out of the sitemap and llms.txt', async () => {
    const gemini = await html('/compare/chatgpt-vs-gemini'); // shared week, no published analysis
    expect(robots(gemini)).toBe('noindex');
    expect(gemini).toContain('There is not enough analysis data to compare them yet.');
    expect(gemini).toContain('<title>ChatGPT vs Gemini UI comparison — Oct 5, 2026 | AI Interface Library</title>');
    const perplexity = await html('/compare/chatgpt-vs-perplexity'); // no capture
    expect(robots(perplexity)).toBe('noindex');
    expect(perplexity).toContain('There is no week with desktop screenshots of both ChatGPT and Perplexity yet.');
    expect(perplexity).not.toContain('class="cmp-shots"');
    expect((await get('/compare/chatgpt-vs-perplexity.md')).headers.get('x-robots-tag')).toBe('noindex');

    const xml = await (await handleSitemap(t.env)).text();
    const llms = await (await handleLlmsTxt(new Request(`${ORIGIN}/llms.txt`), t.env)).text();
    for (const pair of ['chatgpt-vs-gemini', 'chatgpt-vs-perplexity', 'claude-vs-gemini', 'claude-vs-perplexity', 'gemini-vs-perplexity']) {
      expect(xml).not.toContain(`/compare/${pair}`);
      expect(llms).not.toContain(`/compare/${pair}`);
    }
  });

  it('needs at least 3 findings', () => {
    const p = (slug: string): PortalRow => ({ slug, name: slug, company: 'Co', url: '', brand: '', wait_for: 0, full_page: 0, active: 1, sort_order: 0 });
    const cap = (slug: string, metrics: unknown[]) => ({
      slug, week: NEW, r2_key: `shots/${NEW}/${slug}.local.png`, captured_at: `${NEW}T09:00:00Z`, analysis: 'x', analysis_by: 'guideline-v1.5.2',
      analysis_json: JSON.stringify({ portal: slug, week: NEW, variant: 'desktop', status: 'ok', context: { color_scheme: 'dark' }, metrics }),
    }) as unknown as CaptureRow;
    const two = comparePair(p('a'), p('b'), [cap('a', [{ id: 'H3', value: 3 }]), cap('b', [{ id: 'H3', value: 4 }])]);
    expect(two.counts.differences + two.counts.similarities).toBe(2);
    expect(two.indexable).toBe(false);
    const three = comparePair(p('a'), p('b'), [cap('a', [{ id: 'H3', value: 3 }, { id: 'D6', value: 'none' }]), cap('b', [{ id: 'H3', value: 4 }, { id: 'D6', value: 'none' }])]);
    expect(three.indexable).toBe(true);
  });
});

describe('sitemap and llms.txt', () => {
  it('lists the indexable pair with both screenshots, dated by its newest capture or publish', async () => {
    const xml = await (await handleSitemap(t.env)).text();
    const entry = xml.match(new RegExp(`<url>\\s*<loc>${ORIGIN}/compare/chatgpt-vs-claude</loc>[\\s\\S]*?</url>`))?.[0];
    expect(entry).toBeDefined();
    expect(entry).toContain(`<lastmod>${NEW}T20:00:00Z</lastmod>`);
    expect(entry!.match(/<image:loc>[^<]+<\/image:loc>/g)!.map((s) => s.replace(/\?v=\d+/, ''))).toEqual([
      `<image:loc>${ORIGIN}/img/shots/${NEW}/chatgpt.local.png</image:loc>`,
      `<image:loc>${ORIGIN}/img/shots/${NEW}/claude.local.png</image:loc>`,
    ]);
  });

  it('lists the indexable pair under Comparisons in llms.txt', async () => {
    const text = await (await handleLlmsTxt(new Request(`${ORIGIN}/llms.txt`), t.env)).text();
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Key facts', 'Portals', 'Comparisons', 'Weekly digests', 'Changes', 'Method', 'Feeds']);
    expect(text).toContain(`- [ChatGPT vs Claude](${ORIGIN}/compare/chatgpt-vs-claude): UI comparison for the week of October 12, 2026, with differences and similarities ([Markdown](${ORIGIN}/compare/chatgpt-vs-claude.md))`);
  });
});

describe('portal pages link to their most common pairs', () => {
  const links = (s: string) => [...(s.match(/<nav class="compare-with"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  const portal = async (path: string) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();

  it('gives each popular portal 4 links, skipping itself, on the hub and weekly pages', async () => {
    for (const path of ['/portals/chatgpt', `/portals/chatgpt/${NEW}`]) {
      expect(links(await portal(path)), path).toEqual([
        ['/compare/chatgpt-vs-claude', 'Compare with Claude'],
        ['/compare/chatgpt-vs-gemini', 'Compare with Gemini'],
        ['/compare/chatgpt-vs-perplexity', 'Compare with Perplexity'],
        ['/compare/chatgpt-vs-copilot', 'Compare with Microsoft Copilot'],
      ]);
    }
    expect(links(await portal('/portals/perplexity'))).toEqual([ // no captures yet
      ['/compare/chatgpt-vs-perplexity', 'Compare with ChatGPT'],
      ['/compare/claude-vs-perplexity', 'Compare with Claude'],
      ['/compare/gemini-vs-perplexity', 'Compare with Gemini'],
      ['/compare/copilot-vs-perplexity', 'Compare with Microsoft Copilot'],
    ]);
    expect(links(await portal('/portals/copilot')).map(([href]) => href)).toEqual([
      '/compare/chatgpt-vs-copilot', '/compare/claude-vs-copilot', '/compare/copilot-vs-gemini', '/compare/copilot-vs-perplexity',
    ]);
  });

  it('gives other portals the 4 most compared, in alphabetical-slug URLs', async () => {
    expect(links(await portal('/portals/poe')).map(([href]) => href)).toEqual([
      '/compare/chatgpt-vs-poe', '/compare/claude-vs-poe', '/compare/gemini-vs-poe', '/compare/perplexity-vs-poe',
    ]);
  });

  it('skips an inactive partner, so the next one fills its place', async () => {
    t.db.exec(`UPDATE portals SET active = 0 WHERE slug = 'gemini'`);
    expect(links(await portal('/portals/poe')).map(([href]) => href)).toEqual([
      '/compare/chatgpt-vs-poe', '/compare/claude-vs-poe', '/compare/perplexity-vs-poe', '/compare/copilot-vs-poe',
    ]);
    expect(links(await portal('/portals/chatgpt')).map(([href]) => href)).toEqual([
      '/compare/chatgpt-vs-claude', '/compare/chatgpt-vs-perplexity', '/compare/chatgpt-vs-copilot',
    ]);
  });

  it('lists them in the Markdown version too', async () => {
    const md = await portal('/portals/claude.md');
    expect(md).toContain(`## Compare with other products\n\n- [Compare with ChatGPT](${ORIGIN}/compare/chatgpt-vs-claude)\n- [Compare with Gemini](${ORIGIN}/compare/claude-vs-gemini)\n- [Compare with Perplexity](${ORIGIN}/compare/claude-vs-perplexity)\n- [Compare with Microsoft Copilot](${ORIGIN}/compare/claude-vs-copilot)\n`);
  });
});

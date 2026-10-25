import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleWeeks, weekDescription } from '../../src/week-page';
import { notableChanges, weekSummary, type WeekDigest } from '../../src/weeks';
import { handleChanges, handleFeed, handleSitemap } from '../../src/portal-page';
import { handleLlmsTxt } from '../../src/aeo';
import { renderHomepage } from '../../src/homepage';
import { makeEnv } from './fake-env';

// /weeks and /weeks/<week> (src/week-page.ts, src/weeks.ts): one digest per weekly capture.

const ORIGIN = 'https://ai-portal-library.dev';
const OLD = '2026-10-05', NEW = '2026-10-12', PENDING = '2026-10-19', TEST_WEEK = '2026-08-10';
const WRANGLER = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
const WRANGLER_DEV = readFileSync(new URL('../../wrangler.dev.jsonc', import.meta.url), 'utf8');
const INDEX_TS = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const APP_JS = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

let t: ReturnType<typeof makeEnv>;

const item = (label: string, region = 'sidebar') => ({ label, region, badge: null });
function analysis(slug: string, week: string, n1: unknown[], changes: unknown[] = []) {
  return {
    guideline_version: '1.5.2', portal: slug, week, previous_week: OLD, variant: 'desktop', status: 'ok',
    context: { color_scheme: 'light' },
    metrics: [{ id: 'N1', value: n1, sidebar: 'visible' }],
    changes_vs_previous: changes,
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`,
  };
}

function addCapture(slug: string, week: string, a: unknown, by = 'guideline-v1.5.2') {
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at)
                VALUES (?, ?, ?, ?, 'Co', 'https://example.com/', '#000000', ?, ?, ?, ?, ?, 'ok', ?)`)
    .run(`${slug}-${week}`, week, slug, slug, `shots/${week}/${slug}.local.png`, (a as { summary?: string } | null)?.summary ?? (by === 'system-test' ? 'System test.' : ''), by,
      a ? JSON.stringify(a) : null, a ? `${week}T20:00:00Z` : null, `${week}T09:00:00Z`);
}

const change = (o: Record<string, unknown>) => ({ id: 'N1', status: 'changed', region: 'sidebar', ...o });

beforeEach(() => {
  t = makeEnv(); // has Claude
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES
    ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0),
    ('gemini', 'Gemini', 'Google', 'https://gemini.google.com/', '#4285f4', 2),
    ('poe', 'Poe', 'Quora', 'https://poe.com/', '#5d5cde', 10)`);
  t.db.exec(`UPDATE portals SET sort_order = 1 WHERE slug = 'claude'`);
  for (const slug of ['chatgpt', 'claude', 'gemini']) addCapture(slug, OLD, analysis(slug, OLD, [item('New chat')]));
  // NEW: ChatGPT renames an item, Gemini only changes an icon and adds an item, Claude has no changes, Poe is not analyzed.
  addCapture('chatgpt', NEW, analysis('chatgpt', NEW, [item('Explore')], [change({ change: 'renamed', previous: 'More', current: 'Explore' })]));
  addCapture('claude', NEW, analysis('claude', NEW, [item('New chat')]));
  addCapture('gemini', NEW, analysis('gemini', NEW, [item('Gems')], [
    change({ change: 'icon_changed', previous: 'star icon', current: 'spark icon', region: 'top bar', icon_only: true }),
    change({ change: 'added', previous: null, current: 'Gems' }),
  ]));
  addCapture('poe', NEW, null, 'pending');
  // PENDING: captured, nothing published yet. TEST_WEEK: a system-test week.
  addCapture('chatgpt', PENDING, null, 'pending');
  addCapture('claude', PENDING, null, 'pending');
  addCapture('chatgpt', TEST_WEEK, null, 'system-test');
});

const get = (path: string, init?: RequestInit) => handleWeeks(new Request(`https://x${path}`, init), t.env);
const html = async (path: string) => (await get(path)).text();
const jsonLd = (s: string) => [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const robots = (s: string) => s.match(/<meta name="robots" content="([^"]+)"/)?.[1];
const SUMMARY = 'In the week of October 12, 2026, AI Interface Library captured 4 AI portals. 2 of them had menu changes compared with the week before. '
  + 'Most notable changes: in ChatGPT, the sidebar item More is now labeled Explore; in Gemini, a new Gems item appears in the sidebar.';

describe('routes', () => {
  it('is routed to the Worker in both configs', () => {
    expect(INDEX_TS).toContain('if (url.pathname === "/weeks" || url.pathname.startsWith("/weeks/")) return await handleWeeks(request, env);');
    expect(WRANGLER).toMatch(/"run_worker_first": \[[^\]]*"\/weeks", "\/weeks\/\*"/);
    expect(WRANGLER_DEV).toMatch(/"\/weeks",\s*"\/weeks\/\*"/);
  });

  it('serves /weeks, /weeks/, every archived week and its .md', async () => {
    for (const path of ['/weeks', '/weeks/', `/weeks/${NEW}`, `/weeks/${PENDING}`, `/weeks/${TEST_WEEK}`, `/weeks/${NEW}.md`]) {
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it('301s a trailing slash to the one URL', async () => {
    for (const [from, to] of [[`/weeks/${NEW}/`, `/weeks/${NEW}`], [`/weeks/${NEW}.md/`, `/weeks/${NEW}.md`]]) {
      const res = await get(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.get('location')).toBe(`https://x${to}`);
    }
  });

  it('404s weeks that are not archived and malformed paths, with noindex', async () => {
    for (const path of ['/weeks/2026-10-26', '/weeks/2026-13-01', '/weeks/latest', `/weeks/${NEW}/chatgpt`]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(robots(await res.text())).toBe('noindex');
    }
  });

  it('rejects other methods and sends no body for HEAD', async () => {
    expect((await get(`/weeks/${NEW}`, { method: 'POST' })).status).toBe(405);
    const head = await get(`/weeks/${NEW}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});

describe('noindex', () => {
  it('indexes a week with a published analysis', async () => {
    expect(robots(await html(`/weeks/${NEW}`))).toBe('max-image-preview:large');
    expect((await get(`/weeks/${NEW}.md`)).headers.get('x-robots-tag')).toBeNull();
  });

  it('marks the system-test weeks and weeks without a published analysis noindex, HTML and Markdown', async () => {
    for (const week of [TEST_WEEK, PENDING]) {
      expect(robots(await html(`/weeks/${week}`)), week).toBe('noindex');
      expect((await get(`/weeks/${week}.md`)).headers.get('x-robots-tag'), week).toBe('noindex');
    }
  });
});

describe('/weeks/<week>', () => {
  it('has the h1, title, summary as the first paragraph and the meta description', async () => {
    const page = await html(`/weeks/${NEW}`);
    expect(page).toContain('<h1>AI interface changes — week of Oct 12, 2026</h1>');
    expect(page).toContain('<title>AI interface changes, week of Oct 12, 2026 | AI Interface Library</title>');
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}/weeks/${NEW}" />`);
    expect(page).toContain(`<p class="wk-summary">${SUMMARY}</p>`);
    expect(page).toContain(`<meta name="description" content="${weekDescription(SUMMARY)}" />`);
    expect(page).toContain(`<link rel="alternate" type="text/markdown" href="${ORIGIN}/weeks/${NEW}.md" />`);
  });

  it('has a section per changed portal: its changes in timeline wording, a thumbnail, its weekly page and a comparison', async () => {
    const page = await html(`/weeks/${NEW}`);
    const sections = [...page.matchAll(/<section class="wk-portal" id="([^"]+)">([\s\S]*?)<\/section>/g)];
    expect(sections.map((m) => m[1])).toEqual(['chatgpt', 'gemini']); // portal order, Claude and Poe have none
    const [chatgpt, gemini] = sections.map((m) => m[2]);
    expect(chatgpt).toContain('<h2>ChatGPT</h2>');
    expect(chatgpt).toContain('<p>Compared with the week of October 5, 2026:</p>');
    expect(chatgpt).toContain('<li>More renamed to Explore</li>');
    expect(chatgpt).toMatch(new RegExp(`<img src="/img/shots/${NEW}/chatgpt.local.png\\?v=\\d+" alt="ChatGPT UI screenshot, desktop, week of October 12, 2026" width="\\d+" height="\\d+" loading="lazy" />`));
    expect(chatgpt).toContain(`<a href="/portals/chatgpt/${NEW}">ChatGPT, week of Oct 12, 2026</a>`);
    expect(chatgpt).toContain('<a href="/compare/chatgpt-vs-claude">ChatGPT vs Claude</a>');
    expect(gemini).toContain('<li>Top bar button icon changed (star icon → spark icon)</li>');
    expect(gemini).toContain('<li>Gems added to the sidebar</li>');
    expect(gemini).toContain('<a href="/compare/chatgpt-vs-gemini">Gemini vs ChatGPT</a>');
  });

  it('lists the portals without recorded changes on one line', async () => {
    expect(await html(`/weeks/${NEW}`)).toContain(`<p class="wk-unchanged">No recorded menu changes: <a href="/portals/claude/${NEW}">Claude</a>, <a href="/portals/poe/${NEW}">Poe</a>.</p>`);
  });

  it('links the previous and next week, and all weeks', async () => {
    const page = await html(`/weeks/${NEW}`);
    expect(page).toContain(`<a href="/weeks/${OLD}" rel="prev">&larr; Previous week (Oct 5, 2026)</a>`);
    expect(page).toContain(`<a href="/weeks/${PENDING}" rel="next">Next week (Oct 19, 2026) &rarr;</a>`);
    expect(page).toContain('<a href="/weeks">All weeks</a>');
    const newest = await html(`/weeks/${PENDING}`);
    expect(newest).not.toContain('rel="next"');
    expect(newest).toContain(`<a href="/weeks/${NEW}" rel="prev">`);
  });

  it('says when no changes were recorded, or the analyses are not published yet', async () => {
    const old = await html(`/weeks/${OLD}`);
    expect(old).toContain('<p class="wk-summary">In the week of October 5, 2026, AI Interface Library captured 3 AI portals. No menu changes were recorded compared with the week before.</p>');
    expect(old).not.toContain('class="wk-portal"');
    expect(await html(`/weeks/${PENDING}`)).toContain('captured 2 AI portals. Their design analyses are not published yet, so no menu changes are recorded.</p>');
  });

  it('has Article and BreadcrumbList JSON-LD dated by the week', async () => {
    const [block] = jsonLd(await html(`/weeks/${NEW}`));
    const [article, crumbs] = block['@graph'];
    expect(article).toMatchObject({
      '@type': 'Article', '@id': `${ORIGIN}/weeks/${NEW}`, url: `${ORIGIN}/weeks/${NEW}`,
      headline: 'AI interface changes — week of Oct 12, 2026', description: SUMMARY,
      datePublished: NEW, dateModified: NEW,
      about: [{ '@type': 'SoftwareApplication', name: 'ChatGPT' }, { '@type': 'SoftwareApplication', name: 'Gemini' }],
    });
    expect(article.image).toMatch(new RegExp(`^${ORIGIN}/img/shots/${NEW}/chatgpt.local.png`));
    expect(crumbs.itemListElement.map((c: any) => [c.position, c.name, c.item])).toEqual([
      [1, 'AI Interface Library', `${ORIGIN}/`],
      [2, 'Weekly digests', `${ORIGIN}/weeks`],
      [3, 'Week of October 12, 2026', `${ORIGIN}/weeks/${NEW}`],
    ]);
  });

  it('has a Markdown version with the same facts', async () => {
    const res = await get(`/weeks/${NEW}.md`);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('link')).toBe(`<${ORIGIN}/weeks/${NEW}>; rel="canonical"`);
    const text = await res.text();
    expect(text.startsWith([
      '# AI interface changes — week of Oct 12, 2026', '',
      `- Week: week of October 12, 2026 (${NEW})`,
      `- Page: ${ORIGIN}/weeks/${NEW}`,
      `- Previous week: ${ORIGIN}/weeks/${OLD}`,
      `- Next week: ${ORIGIN}/weeks/${PENDING}`, '',
      SUMMARY, '',
      '## ChatGPT', '',
      'Compared with the week of October 5, 2026:', '',
      '- More renamed to Explore', '',
      `- Weekly page: ${ORIGIN}/portals/chatgpt/${NEW}`,
      `- ChatGPT vs Claude: ${ORIGIN}/compare/chatgpt-vs-claude`,
    ].join('\n'))).toBe(true);
    expect(text).toContain('## Gemini');
    expect(text.trimEnd().endsWith('No recorded menu changes: Claude, Poe.')).toBe(true);
  });

  it('escapes portal names', async () => {
    t.db.exec(`UPDATE portals SET name = 'Chat<b>GPT' WHERE slug = 'chatgpt'`);
    const page = await html(`/weeks/${NEW}`);
    expect(page).toContain('<h2>Chat&lt;b&gt;GPT</h2>');
    expect(page).not.toContain('Chat<b>GPT');
  });
});

describe('summary', () => {
  const digest = (changed: WeekDigest['changed']): WeekDigest => ({
    week: NEW, captured: changed.map((p) => ({ slug: p.slug, name: p.name })), published: changed.length, changed, indexable: true, images: [],
  });
  const portal = (slug: string, ...weights: number[]) => ({
    slug, name: slug.toUpperCase(), previousWeek: OLD, changes: weights.map((w) => ({ phrase: `p${w}`, sentence: `${slug} change ${w}.`, weight: w })),
  });

  it('picks each portal\'s most notable change, renames first, at most 3 portals, portal order on ties', () => {
    const d = digest([portal('a', 0, 1), portal('b', 2), portal('c', 3), portal('d', 2), portal('e', 0)]);
    expect(notableChanges(d)).toEqual([
      { name: 'C', sentence: 'c change 3.' }, { name: 'B', sentence: 'b change 2.' }, { name: 'D', sentence: 'd change 2.' },
    ]);
  });

  it('says "change" for one portal', () => {
    expect(weekSummary(digest([portal('a', 2)]))).toBe('In the week of October 12, 2026, AI Interface Library captured 1 AI portal. 1 of them had menu changes compared with the week before. Most notable change: in A, a change 2.');
  });

  it('keeps the meta description to whole sentences of about 160 characters', () => {
    expect(weekDescription(SUMMARY)).toBe('In the week of October 12, 2026, AI Interface Library captured 4 AI portals. 2 of them had menu changes compared with the week before.');
    expect(weekDescription('A very long first sentence. B.'.replace('A', 'A'.repeat(200)))).toBe(`${'A'.repeat(200)} very long first sentence.`);
  });
});

describe('/weeks index', () => {
  it('lists every week except the system-test weeks, newest first, with a line each', async () => {
    const page = await html('/weeks');
    expect(page).toContain('<h1>AI interface changes by week</h1>');
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}/weeks" />`);
    expect(robots(page)).toBe('max-image-preview:large');
    const items = [...page.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a> — ([^<]+)<\/li>/g)].map((m) => m.slice(1));
    expect(items).toEqual([
      [`/weeks/${PENDING}`, 'Week of October 19, 2026', '2 portals captured, analyses not published yet'],
      [`/weeks/${NEW}`, 'Week of October 12, 2026', '4 portals captured, 2 with menu changes'],
      [`/weeks/${OLD}`, 'Week of October 5, 2026', '3 portals captured, no menu changes'],
    ]);
    const [block] = jsonLd(page);
    expect(block['@graph'][0]).toMatchObject({ '@type': 'ItemList', numberOfItems: 3 });
    expect(block['@graph'][0].itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Week of October 12, 2026', url: `${ORIGIN}/weeks/${NEW}` });
  });
});

describe('sitemap, llms.txt, feed, /changes and homepage', () => {
  it('lists /weeks and the indexable weeks in the sitemap, with the changed portals\' screenshots', async () => {
    const xml = await (await handleSitemap(t.env)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((l) => l.includes('/weeks'));
    expect(locs).toEqual([`${ORIGIN}/weeks`, `${ORIGIN}/weeks/${NEW}`, `${ORIGIN}/weeks/${OLD}`]);
    const entry = xml.match(new RegExp(`<url>\\s*<loc>${ORIGIN}/weeks/${NEW}</loc>([\\s\\S]*?)</url>`))![1];
    expect(entry).toContain(`<lastmod>${NEW}T20:00:00Z</lastmod>`);
    expect([...entry.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1].replace(/\?v=\d+$/, ''))).toEqual([
      `${ORIGIN}/img/shots/${NEW}/chatgpt.local.png`, `${ORIGIN}/img/shots/${NEW}/gemini.local.png`,
    ]);
    expect(xml).toContain(`<loc>${ORIGIN}/weeks</loc>\n    <lastmod>${NEW}T20:00:00Z</lastmod>`);
  });

  it('lists the indexable weeks in llms.txt', async () => {
    const text = await (await handleLlmsTxt(new Request(`${ORIGIN}/llms.txt`), t.env)).text();
    const section = text.split('## Weekly digests\n\n')[1].split('\n\n')[0].split('\n');
    expect(section).toEqual([
      `- [All weeks](${ORIGIN}/weeks): one digest per weekly capture, newest first`,
      `- [AI interface changes, week of October 12, 2026](${ORIGIN}/weeks/${NEW}): 4 portals captured, 2 with menu changes ([Markdown](${ORIGIN}/weeks/${NEW}.md))`,
      `- [AI interface changes, week of October 5, 2026](${ORIGIN}/weeks/${OLD}): 3 portals captured, no menu changes ([Markdown](${ORIGIN}/weeks/${OLD}.md))`,
    ]);
  });

  it('points each feed item to its week\'s digest', async () => {
    const xml = await (await handleFeed(t.env)).text();
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(new RegExp(`^${ORIGIN}/weeks/(${NEW}|${OLD})$`));
  });

  it('links the latest indexable week from /changes', async () => {
    const page = await (await handleChanges(new Request(`${ORIGIN}/changes`), t.env)).text();
    expect(page).toContain(`<p>Latest week: <a href="/weeks/${NEW}">AI interface changes, week of Oct 12, 2026</a> &middot; <a href="/weeks">All weeks</a></p>`);
  });

  it('links the homepage week heading to its digest, and public/app.js follows the picked week', () => {
    expect(INDEX_HTML).toContain('<a class="section-link" id="weekDigest" href="/weeks" hidden>');
    const stats = { screenshots: 1, portals: 1, weeks: 1 };
    const out = renderHomepage(INDEX_HTML, stats, { week: PENDING, label: 'Week of Oct 19, 2026', captures: [] });
    expect(out).toContain(`<a class="section-link" id="weekDigest" href="/weeks/${PENDING}">This week&#39;s changes`);
    expect(renderHomepage(INDEX_HTML, stats, null)).toContain('<a class="section-link" id="weekDigest" href="/weeks" hidden>');
    expect(APP_JS).toContain('digest.href = `/weeks/${encodeURIComponent(state.week)}`;');
  });
});

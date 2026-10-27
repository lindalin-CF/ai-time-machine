import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleFacts } from '../../src/facts-page';
import { handleChangelog, handleSitemap, siteHeader } from '../../src/portal-page';
import { handleLlmsTxt } from '../../src/aeo';
import { makeEnv } from './fake-env';
import { LEGAL_LINE } from './footer-dialogs';

// /facts (src/facts.ts, src/facts-page.ts): a few facts per active portal from its latest published analysis.

const ORIGIN = 'https://ai-portal-library.dev';
const W1 = '2026-10-05', W2 = '2026-10-12', W3 = '2026-10-19';
const WRANGLER = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
const WRANGLER_DEV = readFileSync(new URL('../../wrangler.dev.jsonc', import.meta.url), 'utf8');
const INDEX_TS = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const SITE_MENU_JS = readFileSync(new URL('../../public/site-menu.js', import.meta.url), 'utf8');

let t: ReturnType<typeof makeEnv>;

const item = (label: string, region = 'sidebar') => ({ label, region, badge: null });
const change = (o: Record<string, unknown>) => ({ id: 'N1', status: 'changed', region: 'sidebar', ...o });

function analysis(slug: string, week: string, o: { metrics?: unknown[]; context?: Record<string, unknown>; changes?: unknown[]; previous?: string } = {}) {
  return {
    guideline_version: '1.7.1', portal: slug, week, previous_week: o.previous ?? W1, variant: 'desktop', status: 'ok',
    context: o.context ?? { color_scheme: 'light' },
    metrics: o.metrics ?? [],
    changes_vs_previous: o.changes ?? [],
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`,
  };
}

function addCapture(slug: string, week: string, a: unknown, by = 'guideline-v1.7.1') {
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at)
                VALUES (?, ?, ?, ?, 'Co', 'https://example.com/', '#000000', ?, ?, ?, ?, ?, 'ok', ?)`)
    .run(`${slug}-${week}`, week, slug, slug, `shots/${week}/${slug}.local.png`, (a as { summary?: string } | null)?.summary ?? '', by,
      a ? JSON.stringify(a) : null, a ? `${week}T20:00:00Z` : null, `${week}T09:00:00Z`);
}

const FULL_METRICS = [
  { id: 'L2', value: '22%' },
  { id: 'L3', value: { vertical_third: 'middle' } },
  { id: 'D5', value: { suggested_prompts: 3 } },
  { id: 'D6', value: { present: true } },
  { id: 'N1', sidebar: 'visible', value: [item('New chat'), item('Explore'), item('Codex'), { label: 'GPT-6', region: 'input area', role: 'model_picker' }] },
];

beforeEach(() => {
  t = makeEnv(); // has Claude
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order, active) VALUES
    ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0, 1),
    ('gemini', 'Gemini', 'Google', 'https://gemini.google.com/', '#4285f4', 2, 1),
    ('poe', 'Poe', 'Quora', 'https://poe.com/', '#5d5cde', 10, 1),
    ('pi', 'Pi', 'Inflection', 'https://pi.ai/', '#000000', 5, 0)`);
  t.db.exec(`UPDATE portals SET sort_order = 1 WHERE slug = 'claude'`);
  // ChatGPT: a rename in W2; in W3 only the model picker's model changed, which is not a menu change.
  addCapture('chatgpt', W1, analysis('chatgpt', W1, { previous: '2026-09-28' }));
  addCapture('chatgpt', W2, analysis('chatgpt', W2, { previous: W1, changes: [change({ change: 'renamed', previous: 'More', current: 'Explore' })] }));
  addCapture('chatgpt', W3, analysis('chatgpt', W3, { previous: W2, metrics: FULL_METRICS, changes: [
    change({ change: 'renamed', previous: 'GPT-5', current: 'GPT-6', region: 'input area' }),
  ] }));
  // Claude: W3 only differs in possibly confounded and confounded ways (a plan change), and records only a dark scheme.
  addCapture('claude', W2, analysis('claude', W2, { previous: W1 }));
  addCapture('claude', W3, analysis('claude', W3, { previous: W2, context: { color_scheme: 'dark' }, changes: [
    change({ status: 'possibly_confounded', change: 'removed', previous: 'Upgrade', current: null, region: 'top bar' }),
    change({ status: 'confounded', change: 'added', previous: null, current: 'Max plan' }),
  ] }));
  // Gemini: an added item in W3, no sidebar, no suggested prompts, no note.
  addCapture('gemini', W3, analysis('gemini', W3, { previous: W2, metrics: [
    { id: 'L2', value: '0%' },
    { id: 'D5', value: { suggested_prompts: 0 } },
    { id: 'D6', value: 'none' },
    { id: 'N1', sidebar: 'not_visible', value: [item('Gems', 'top bar')] },
  ], changes: [change({ change: 'added', previous: null, current: 'Gems', region: 'top bar' })] }));
  // Poe: captured, nothing published. Pi: inactive.
  addCapture('poe', W3, null, 'pending');
  addCapture('pi', W3, analysis('pi', W3));
});

const get = (path: string, init?: RequestInit) => handleFacts(new Request(`${ORIGIN}${path}`, init), t.env);
const html = async (path = '/facts') => (await get(path)).text();
const entries = (s: string) => [...s.matchAll(/<li class="fx-entry" id="([^"]+)">([\s\S]*?)<\/li>(?=\n      <\/?(?:li|ol))/g)].map((m) => ({ id: m[1], body: m[2] }));
const entry = async (id: string) => (entries(await html())).find((e) => e.id === id)!.body;
const bullets = (body: string) => [...body.matchAll(/<li><strong>([^<]+):<\/strong> (.*?)<\/li>/g)].map((m) => `${m[1]}: ${m[2].replace(/<[^>]+>/g, '')}`);
const jsonLd = (s: string) => [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('route', () => {
  it('is routed to the Worker in both configs', () => {
    expect(INDEX_TS).toContain('if (url.pathname === "/facts" || url.pathname === "/facts/" || url.pathname === "/facts.md") return await handleFacts(request, env);');
    expect(WRANGLER).toMatch(/"run_worker_first": \[[^\]]*"\/facts", "\/facts\/", "\/facts\.md"/);
    expect(WRANGLER_DEV).toMatch(/"\/facts",\s*"\/facts\/",\s*"\/facts\.md"/);
  });

  it('serves the same page at /facts and /facts/, with /facts as canonical', async () => {
    const [a, b] = [await get('/facts'), await get('/facts/')];
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await b.text();
    expect(body).toBe(await a.text());
    expect(body).toContain(`<link rel="canonical" href="${ORIGIN}/facts" />`);
  });

  it('rejects other methods and sends no body for HEAD', async () => {
    expect((await get('/facts', { method: 'POST' })).status).toBe(405);
    const head = await get('/facts', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});

describe('page', () => {
  it('has the title, description, h1, intro and last-updated week', async () => {
    const s = await html();
    expect(s).toContain('<title>Key facts about AI portal interfaces | AI Interface Library</title>');
    expect(s).toMatch(/<meta name="description" content="Key facts about ChatGPT, Claude, Gemini and other AI portals[^"]+" \/>/);
    expect(s).toContain('<meta name="robots" content="max-image-preview:large" />');
    expect(s).toContain('<h1>Key facts</h1>');
    expect(s).toContain('<p class="meta">What each AI portal&#39;s interface looks like in its latest capture. <a href="/how-we-analyze#one-account-per-portal">Each portal is captured with one account, so details can differ by plan.</a></p>');
    expect(s).toContain('<p class="fx-updated">Last updated October 19, 2026</p>');
    expect(s).toContain(`<link rel="alternate" type="text/markdown" href="${ORIGIN}/facts.md" />`);
  });

  it('has one entry per active portal, in the homepage chips\' order, each with an id for direct links', async () => {
    expect(entries(await html()).map((e) => e.id)).toEqual(['chatgpt', 'claude', 'gemini', 'poe']);
  });

  it('shows the logo, name and week on the left, and links to the portal page and its most compared pair', async () => {
    const chatgpt = await entry('chatgpt');
    expect(chatgpt).toContain('<img class="fx-logo" src="/icons/chatgpt.png" alt="" width="32" height="32" loading="lazy" />');
    expect(chatgpt).toContain('<h2>ChatGPT</h2>');
    expect(chatgpt).toContain('<span class="fx-week">Week of Oct 19, 2026</span>'); // short in the left column; long in the Markdown
    expect(chatgpt).toContain('<a href="/portals/chatgpt">ChatGPT screenshots</a> <a href="/compare/chatgpt-vs-claude">Compare with Claude</a>');
    expect(await entry('claude')).toContain('<a href="/compare/chatgpt-vs-claude">Compare with ChatGPT</a>');
    expect(await entry('poe')).toContain('<a href="/compare/chatgpt-vs-poe">Compare with ChatGPT</a>');
  });

  it('builds the facts from the latest published analysis', async () => {
    expect(bullets(await entry('chatgpt'))).toEqual([
      'Layout: A sidebar, 4 menu items, message box in the middle third of the screen.',
      'Start screen: 3 suggested prompts, a note about the AI&#39;s limits is shown.',
      'Latest menu change: Week of October 12, 2026: More renamed to Explore.',
    ]);
    expect(bullets(await entry('gemini'))).toEqual([
      'Layout: No sidebar, 1 menu item.',
      'Start screen: No suggested prompts, no note about the AI&#39;s limits.',
      'Latest menu change: Week of October 19, 2026: Gems added to the top bar.',
    ]);
  });

  it('skips every fact whose value is missing', async () => {
    const claude = await entry('claude');
    // Its analysis records only the color scheme, which is never shown, so it has no Start screen line.
    expect(bullets(claude)).toEqual(['Menu changes: No menu changes recorded yet.']);
    // No published analysis: no week, only the menu changes line.
    const poe = await entry('poe');
    expect(poe).not.toContain('fx-week');
    expect(bullets(poe)).toEqual(['Menu changes: No menu changes recorded yet.']);
    expect(await html()).not.toMatch(/null|undefined/);
  });

  it('links the latest menu change to its weekly page', async () => {
    expect(await entry('chatgpt')).toContain('<a href="/portals/chatgpt/2026-10-12">Week of October 12, 2026: More renamed to Explore.</a>');
  });
});

describe('latest menu change rules (the portal timeline\'s)', () => {
  it('ignores a week where only the model picker\'s model changed', async () => {
    const s = await entry('chatgpt');
    expect(s).not.toContain('GPT-6');
    expect(s).not.toContain('October 19, 2026:');
  });

  it('counts the model picker appearing as a change', async () => {
    t.db.prepare('UPDATE captures SET analysis_json = ? WHERE id = ?').run(JSON.stringify(analysis('chatgpt', W3, { previous: W2, metrics: FULL_METRICS, changes: [
      change({ change: 'added', previous: null, current: 'GPT-6', region: 'input area' }),
    ] })), `chatgpt-${W3}`);
    expect(bullets(await entry('chatgpt'))[2]).toBe('Latest menu change: Week of October 19, 2026: Model picker added to the input area.');
  });

  it('ignores possibly confounded and confounded changes, such as a plan change', async () => {
    const s = await entry('claude');
    expect(s).not.toContain('Upgrade');
    expect(s).not.toContain('Max plan');
  });

  it('falls back to an older week when the newest one is confounded', async () => {
    addCapture('gemini', '2026-10-26', analysis('gemini', '2026-10-26', { previous: W3, changes: [
      change({ status: 'possibly_confounded', change: 'removed', previous: 'Gems', current: null, region: 'top bar' }),
    ] }));
    expect(bullets(await entry('gemini')).at(-1)).toBe('Latest menu change: Week of October 19, 2026: Gems added to the top bar.');
  });

  it('lists every change of that week, joined like the timeline', async () => {
    t.db.prepare('UPDATE captures SET analysis_json = ? WHERE id = ?').run(JSON.stringify(analysis('chatgpt', W2, { previous: W1, changes: [
      change({ change: 'renamed', previous: 'More', current: 'Explore' }),
      change({ change: 'removed', previous: 'Upgrade', current: null, region: 'top bar' }),
    ] })), `chatgpt-${W2}`);
    expect(bullets(await entry('chatgpt'))[2]).toBe('Latest menu change: Week of October 12, 2026: More renamed to Explore; Upgrade removed from the top bar.');
  });
});

describe('color scheme', () => {
  // The color scheme follows the capture machine's system setting, not the product.
  it('is never shown, in the HTML, the Markdown or the JSON-LD', async () => {
    const color = /\b(?:dark|light)\b|color scheme|colour scheme|\bmode\b|theme/i;
    const page = await html();
    const visible = page.replace(/<style>[\s\S]*?<\/style>|<script(?! type="application\/ld\+json")[\s\S]*?<\/script>/g, '');
    expect(visible).not.toMatch(color);
    expect(JSON.stringify(jsonLd(page))).not.toMatch(color);
    expect(await html('/facts.md')).not.toMatch(color);
  });
});

describe('structured data', () => {
  it('has a WebPage dated by the latest week and an ItemList of the portals', async () => {
    const [ld] = jsonLd(await html());
    const graph = ld['@graph'];
    expect(graph[0]).toEqual({
      '@type': 'WebPage', '@id': `${ORIGIN}/facts`, url: `${ORIGIN}/facts`, name: 'Key facts about AI portal interfaces',
      description: expect.stringMatching(/^Key facts about ChatGPT/), dateModified: W3,
    });
    expect(graph[1]['@type']).toBe('ItemList');
    expect(graph[1].numberOfItems).toBe(4);
    expect(graph[1].itemListElement).toEqual(['chatgpt', 'claude', 'gemini', 'poe'].map((slug, i) => ({
      '@type': 'ListItem', position: i + 1, name: ['ChatGPT', 'Claude', 'Gemini', 'Poe'][i], url: `${ORIGIN}/portals/${slug}`,
    })));
  });
});

describe('/facts.md', () => {
  it('has the same facts', async () => {
    const res = await get('/facts.md');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('link')).toBe(`<${ORIGIN}/facts>; rel="canonical"`);
    const md = await res.text();
    expect(md).toContain(`# Key facts\n\nWhat each AI portal's interface looks like in its latest capture. Each portal is captured with one account, so details can differ by plan. [One account per portal](${ORIGIN}/how-we-analyze#one-account-per-portal)\n\nLast updated October 19, 2026.`);
    expect([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Poe']);
    expect(md).toContain([
      '## ChatGPT', '',
      '- Week of October 19, 2026',
      '- Layout: A sidebar, 4 menu items, message box in the middle third of the screen.',
      "- Start screen: 3 suggested prompts, a note about the AI's limits is shown.",
      `- Latest menu change: [Week of October 12, 2026: More renamed to Explore.](${ORIGIN}/portals/chatgpt/2026-10-12)`,
      `- Page: ${ORIGIN}/portals/chatgpt`,
      `- Compare with Claude: ${ORIGIN}/compare/chatgpt-vs-claude`,
    ].join('\n'));
    expect(md).toContain('## Poe\n\n- Menu changes: No menu changes recorded yet.\n');
  });
});

describe('sitemap and llms.txt', () => {
  it('lists /facts in the sitemap, dated by the latest week', async () => {
    const xml = await (await handleSitemap(t.env)).text();
    expect(xml).toContain(`<loc>${ORIGIN}/facts</loc>\n    <lastmod>${W3}</lastmod>`);
  });

  it('leaves /facts out of the sitemap until it has facts', async () => {
    const xml = await (await handleSitemap(makeEnv().env)).text();
    expect(xml).not.toContain('/facts');
  });

  it('lists /facts near the top of llms.txt, before the portals', async () => {
    const llms = await (await handleLlmsTxt(new Request(`${ORIGIN}/llms.txt`), t.env)).text();
    const sections = [...llms.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections[0]).toBe('Key facts');
    expect(llms).toContain(`- [Key facts](${ORIGIN}/facts): `);
    expect(llms).toContain(`([Markdown](${ORIGIN}/facts.md))`);
  });
});

describe('footer and top bar', () => {
  it('puts Key facts right after Changelog, in both footers', async () => {
    const portalLine = (await html()).match(/<div class="legal">([\s\S]*?)<\/div>/)![1];
    const homeLine = INDEX_HTML.match(/<span class="foot-legal">([\s\S]*?)<\/span>/)![1];
    const changelogLine = (await handleChangelog(new Request(`${ORIGIN}/changelog`)).text()).match(/<div class="legal">([\s\S]*?)<\/div>/)![1];
    for (const line of [portalLine, homeLine, changelogLine]) {
      expect(line).toBe(LEGAL_LINE);
      expect(line).toContain('<a href="/license">License</a> &middot; <a href="/changelog">Changelog</a> &middot; <a href="/facts">Key facts</a> &middot; <button type="button" class="linkbtn" data-dialog="disclaimer"');
    }
  });

  it('is not in the top nav or the phone menu', async () => {
    const homeNav = INDEX_HTML.match(/<nav class="topnav" id="site-nav"[\s\S]*?<\/nav>/)![0];
    const serverNav = (await html()).match(/<nav class="topnav" id="site-nav"[\s\S]*?<\/nav>/)![0];
    for (const nav of [homeNav, serverNav, siteHeader()]) {
      expect(nav).not.toContain('/facts');
      expect(nav).not.toContain('Key facts');
    }
    // The phone menu is the same nav behind the menu button; its script adds no links.
    expect(SITE_MENU_JS).not.toContain('facts');
  });
});

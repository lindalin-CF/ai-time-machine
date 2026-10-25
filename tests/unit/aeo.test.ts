import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleChanges, handleHowWeAnalyze, handleLicense, handlePortalPage, handleSitemap, hubTitle, hubDescription, PORTAL_ALIASES } from '../../src/portal-page';
import { handleLlmsTxt, handleLlmsFullTxt } from '../../src/aeo';
import { handleHomepage, homepageJsonLd } from '../../src/homepage';
import { navChangeSentence, navChangePhrase } from '../../src/nav-changes';
import { makeEnv } from './fake-env';
// @ts-expect-error -- plain browser module without type declarations
import { compareFindings } from '../../public/analytics-canvas.js';

const ORIGIN = 'https://ai-portal-library.dev';
const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const ROBOTS = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');

// Private text an analysis carries that must never leave the server.
const ICON_DESCRIPTION = 'clock-shaped icon with a tiny dot';
const N1_NOTE = 'Same clock icon at sidebar position 6.';
const GREETING = 'Good evening, Avery Quinn';

let t: ReturnType<typeof makeEnv>;

function analysis(slug: string, week: string, n1: unknown[], changes: unknown[], extra: Record<string, unknown> = {}) {
  return {
    guideline_version: '1.5.2', portal: slug, week, previous_week: '2026-09-28', variant: 'desktop', status: 'ok',
    context: { color_scheme: 'dark', notes: GREETING },
    metrics: [
      { id: 'N1', value: n1, sidebar: 'visible', note: N1_NOTE },
      { id: 'D7', value: GREETING },
    ],
    changes_vs_previous: changes,
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`,
    ...extra,
  };
}

function addCapture(slug: string, name: string, company: string, week: string, a: unknown, opts: { by?: string; published?: string | null } = {}) {
  t.db.exec(`INSERT OR IGNORE INTO portals (slug, name, company, url, brand) VALUES ('${slug}', '${name}', '${company}', 'https://example.com/', '#000000')`);
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  const summary = (a as { summary?: string } | null)?.summary ?? '';
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, r2_key_mobile, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at)
                VALUES (?, ?, ?, ?, ?, 'https://example.com/', '#000000', ?, ?, ?, ?, ?, ?, 'ok', ?)`)
    .run(`${slug}-${week}`, week, slug, name, company, `shots/${week}/${slug}.local.png`, `shots/${week}/${slug}.mobile.local.png`,
      summary, opts.by ?? 'guideline-v1.5.2', JSON.stringify(a), opts.published === undefined ? `${week}T20:00:00Z` : opts.published, `${week}T09:00:00Z`);
}

const item = (label: string | null, region: string, extra: Record<string, unknown> = {}) => ({ label, region, icon: ICON_DESCRIPTION, badge: null, ...extra });
const renamed = { id: 'N1', change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar', status: 'changed', note: N1_NOTE };
const sliderAdded = { id: 'N1', change: 'added', previous: null, current: 'slider icon', icon_only: true, region: 'input area', status: 'changed', note: N1_NOTE };

beforeEach(() => {
  t = makeEnv();
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0)`);
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('poe', 'Poe', 'Quora', 'https://poe.com/', '#5d5cde', 10)`);
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, active) VALUES ('retired', 'Retired', 'Gone Inc', 'https://x/', '#000000', 0)`);
  addCapture('chatgpt', 'ChatGPT', 'OpenAI', '2026-09-28', analysis('chatgpt', '2026-09-28', [item('Scheduled', 'sidebar')], [], { previous_week: '2026-09-21' }));
  addCapture('chatgpt', 'ChatGPT', 'OpenAI', '2026-10-05', analysis('chatgpt', '2026-10-05',
    [item('New chat', 'sidebar'), item('Tasks', 'sidebar'), item(null, 'sidebar', { icon_label: 'magnifier icon' }), item('Think', 'input area')],
    [renamed, { id: 'D7', previous: 'Hi', current: GREETING, status: 'possibly_confounded' }]));
  addCapture('poe', 'Poe', 'Quora', '2026-10-05', analysis('poe', '2026-10-05', [item(null, 'input area', { icon_label: 'slider icon' })], [sliderAdded]),
    { published: '2026-10-10T15:00:00Z' });
  // Not shown anywhere: a confounded change, an unpublished analysis, a retired portal, a system-test week.
  addCapture('claude', 'Claude', 'Anthropic', '2026-10-05', analysis('claude', '2026-10-05', [], [{ ...renamed, status: 'confounded' }]));
  addCapture('claude', 'Claude', 'Anthropic', '2026-09-28', analysis('claude', '2026-09-28', [], [{ ...renamed, previous: 'Old', current: 'Hidden' }], { previous_week: '2026-09-21' }), { by: 'pending' });
  addCapture('retired', 'Retired', 'Gone Inc', '2026-10-05', analysis('retired', '2026-10-05', [], [{ ...renamed, current: 'Retired item' }]));
  addCapture('chatgpt', 'ChatGPT', 'OpenAI', '2026-08-03', analysis('chatgpt', '2026-08-03', [], [{ ...renamed, current: 'Test week' }], { previous_week: '2026-07-27' }));
  (t.env as unknown as { ASSETS: unknown }).ASSETS = {
    async fetch() { return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }); },
  };
});

const get = (handler: (r: Request, e: any) => Promise<Response>, path: string) => handler(new Request(`https://x${path}`), t.env);
const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const LEAKS = [ICON_DESCRIPTION, N1_NOTE, GREETING, 'Avery', 'possibly_confounded', 'Hidden', 'Retired item', 'Test week'];

describe('/changes', () => {
  it('lists each recorded menu change as one sentence, newest week first, linked to its weekly page', async () => {
    const html = await (await get(handleChanges, '/changes')).text();
    const items = [...html.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g)].map((m) => [m[1], m[2]]);
    expect(items).toEqual([
      ['/portals/chatgpt/2026-10-05', 'Week of October 5, 2026 — ChatGPT: the sidebar item Scheduled is now labeled Tasks.'],
      ['/portals/poe/2026-10-05', 'Week of October 5, 2026 — Poe: an icon button (slider icon) now appears in the input area.'],
    ]);
    for (const leak of LEAKS) expect(html).not.toContain(leak);
  });

  it('explains the source and links to /how-we-analyze, with a canonical URL', async () => {
    const html = await (await get(handleChanges, '/changes')).text();
    expect(html).toContain('<a href="/how-we-analyze">How we analyze</a>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/changes" />`);
    expect(html).toContain('<h1>Menu changes</h1>');
  });

  it('describes the list as an ItemList', async () => {
    const [ld] = jsonLd(await (await get(handleChanges, '/changes')).text());
    expect(ld['@type']).toBe('ItemList');
    expect(ld.numberOfItems).toBe(2);
    expect(ld.itemListElement.map((i: any) => [i['@type'], i.position, i.url])).toEqual([
      ['ListItem', 1, `${ORIGIN}/portals/chatgpt/2026-10-05`],
      ['ListItem', 2, `${ORIGIN}/portals/poe/2026-10-05`],
    ]);
  });

  it('says so when nothing has changed yet, and is left out of the sitemap', async () => {
    t.db.exec(`DELETE FROM captures`);
    expect(await (await get(handleChanges, '/changes')).text()).toContain('No menu changes have been recorded yet.');
    expect(await (await handleSitemap(t.env)).text()).not.toContain('/changes');
  });

  it('is in the sitemap, dated by the newest listed change', async () => {
    const xml = await (await handleSitemap(t.env)).text();
    expect(xml).toMatch(new RegExp(`<loc>${ORIGIN}/changes</loc>\\s*<lastmod>2026-10-10T15:00:00Z</lastmod>`));
  });

  it('words each change the same way as the Analytics canvas', () => {
    const cases = [
      { change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar' },
      { change: 'added', previous: null, current: 'Codex', region: 'sidebar' },
      { change: 'removed', previous: 'Sora', current: null, region: 'top bar' },
      { change: 'added', previous: null, current: 'slider icon', region: 'input area', icon: true },
      { change: 'removed', previous: 'clock icon', current: null, region: 'sidebar', icon: true },
      { change: 'icon_changed', previous: 'bubble-clock icon', current: 'dashed bubble icon', region: 'top bar', icon: true },
      { change: 'icon_changed', previous: 'a icon', current: 'b icon', region: 'input area', icon: true },
    ];
    for (const c of cases) {
      const card = (week: string, nav: unknown) => ({ label: week, slug: 'x', week, metrics: { navItems: [], navChanges: nav } });
      const [line] = compareFindings(card('2026-09-28', null), card('2026-10-05', { previousWeek: '2026-09-28', items: [c] }));
      const s = navChangeSentence(c as any);
      expect(line).toBe(s[0].toUpperCase() + s.slice(1));
    }
  });
});

describe('/llms.txt', () => {
  it('follows the llmstxt.org layout: H1, blockquote, then linked sections', async () => {
    const res = await get(handleLlmsTxt, '/llms.txt');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const text = await res.text();
    const lines = text.split('\n');
    expect(lines[0]).toBe('# AI Interface Library');
    expect(lines[2]).toMatch(/^> Each week, AI Interface Library captures the first screen of 3 AI products/);
    expect(lines[2]).toContain('a person reviews every analysis before it is published');
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Portals', 'Weekly digests', 'Changes', 'Method', 'Feeds']);
    expect(text).toContain(`- [ChatGPT](${ORIGIN}/portals/chatgpt): OpenAI.`);
    expect(text).toContain(`([Markdown](${ORIGIN}/portals/chatgpt.md))`);
    expect(text).toContain(`- [Menu changes](${ORIGIN}/changes)`);
    expect(text).toContain(`- [How we analyze](${ORIGIN}/how-we-analyze)`);
    expect(text).toContain(`- [RSS feed](${ORIGIN}/feed.xml)`);
    expect(text).toContain(`- [Sitemap](${ORIGIN}/sitemap.xml)`);
    expect(text).not.toContain('Retired');
    // Every link line is a Markdown list item with an absolute link.
    for (const l of lines.filter((x) => x.startsWith('- '))) expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/ai-portal-library\.dev\/[^)]*\)/);
  });
});

describe('/llms-full.txt', () => {
  it("gives each active portal's latest published summary in full, with its menu facts", async () => {
    const text = await (await get(handleLlmsFullTxt, '/llms-full.txt')).text();
    expect(text).toContain('## ChatGPT (OpenAI): week of October 5, 2026');
    expect(text).toContain(`Page: ${ORIGIN}/portals/chatgpt/2026-10-05`);
    expect(text).toContain('This shows the desktop version of chatgpt for the week of 2026-10-05, before scrolling. The message box stands out most.');
    expect(text).toContain('Menu items: New chat (sidebar), Tasks (sidebar), an icon button (magnifier icon) (sidebar), Think (input area).');
    expect(text).toContain('Menu changes since the week of September 28, 2026: the sidebar item Scheduled is now labeled Tasks.');
    expect(text).toContain('## Poe (Quora): week of October 5, 2026');
    expect(text).toContain('## Claude (Anthropic): week of October 5, 2026'); // its 09-28 analysis is unpublished
    expect(text).not.toContain('week of September 28, 2026\n\nPage'); // only the latest week per portal
    for (const leak of LEAKS) expect(text).not.toContain(leak);
  });
});

describe('Markdown portal pages', () => {
  const md = (path: string) => get(handlePortalPage, path);

  it('/portals/<slug>/<week>.md: title, company, week, summary, menu items and changes, screenshot URLs', async () => {
    const res = await md('/portals/chatgpt/2026-10-05.md');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('link')).toBe(`<${ORIGIN}/portals/chatgpt/2026-10-05>; rel="canonical"`);
    const text = await res.text();
    expect(text).toBe([
      '# ChatGPT', '',
      '- Company: OpenAI',
      '- Week: week of October 5, 2026 (2026-10-05)',
      `- Page: ${ORIGIN}/portals/chatgpt/2026-10-05`,
      `- Compare week by week: ${ORIGIN}/#compare?view=canvas&mode=time&portal=chatgpt&weeks=2026-10-05,2026-09-28&device=desktop`, '',
      '## Key facts', '',
      'As of Oct 5, 2026, ChatGPT shows a sidebar with 3 menu items. It uses a dark color scheme. Most recent menu change (week of Oct 5, 2026): the sidebar item Scheduled is now labeled Tasks.', '',
      '## Design analysis', '',
      'This shows the desktop version of chatgpt for the week of 2026-10-05, before scrolling. The message box stands out most.', '',
      '## Menu items', '',
      '- Sidebar: New chat, Tasks, an icon button (magnifier icon)',
      '- Input area: Think', '',
      '## Menu changes', '',
      'Compared with the week of September 28, 2026:', '',
      '- The sidebar item Scheduled is now labeled Tasks.', '',
      '## Screenshots', '',
      `- Desktop: ${ORIGIN}/img/shots/2026-10-05/chatgpt.local.png?v=${Date.parse('2026-10-05T09:00:00Z')}`,
      `- Mobile: ${ORIGIN}/img/shots/2026-10-05/chatgpt.mobile.local.png?v=${Date.parse('2026-10-05T09:00:00Z')}`, '',
      '## Compare with other products', '',
      `- [Compare with Claude](${ORIGIN}/compare/chatgpt-vs-claude)`, '',
    ].join('\n'));
    for (const leak of LEAKS) expect(text).not.toContain(leak);
  });

  it('/portals/<slug>.md shows the latest week, canonical to the hub page', async () => {
    const res = await md('/portals/poe.md');
    expect(res.headers.get('link')).toBe(`<${ORIGIN}/portals/poe>; rel="canonical"`);
    const text = await res.text();
    expect(text).toContain('- Week: week of October 5, 2026 (2026-10-05)');
    expect(text).toContain('- Input area: an icon button (slider icon)');
    expect(text).toContain('- An icon button (slider icon) now appears in the input area.');
  });

  it('says when there is no menu data or comparison', async () => {
    const text = await (await md('/portals/chatgpt/2026-08-03.md')).text();
    expect(text).toContain('No menu item data for this week.');
    expect(text).toContain('No menu comparison for this week.'); // system-test week: no metrics
  });

  it('marks system-test weeks noindex and 404s unknown pages', async () => {
    expect((await md('/portals/chatgpt/2026-08-03.md')).headers.get('x-robots-tag')).toBe('noindex');
    expect((await md('/portals/chatgpt/2026-10-05.md')).headers.get('x-robots-tag')).toBeNull();
    expect((await md('/portals/nope.md')).status).toBe(404);
    expect((await md('/portals/chatgpt/2026-01-05.md')).status).toBe(404);
    expect((await md('/portals/retired.md')).status).toBe(404);
  });

  it('the HTML pages point to their Markdown version', async () => {
    const hub = await (await md('/portals/chatgpt')).text();
    const week = await (await md('/portals/chatgpt/2026-10-05')).text();
    expect(hub).toContain(`<link rel="alternate" type="text/markdown" href="${ORIGIN}/portals/chatgpt.md" />`);
    expect(week).toContain(`<link rel="alternate" type="text/markdown" href="${ORIGIN}/portals/chatgpt/2026-10-05.md" />`);
  });
});

describe('structured data', () => {
  it('portal pages: an Article about the product, dated by the analysis publish time', async () => {
    const [ld] = jsonLd(await (await get(handlePortalPage, '/portals/chatgpt/2026-10-05')).text());
    const article = ld['@graph'].find((n: any) => n['@type'] === 'Article');
    expect(article).toEqual({
      '@type': 'Article',
      headline: 'ChatGPT interface — week of October 5, 2026',
      datePublished: '2026-10-05T20:00:00Z',
      dateModified: '2026-10-05T20:00:00Z',
      image: `${ORIGIN}/img/shots/2026-10-05/chatgpt.local.png?v=${Date.parse('2026-10-05T09:00:00Z')}`,
      about: { '@type': 'SoftwareApplication', name: 'ChatGPT', publisher: { '@type': 'Organization', name: 'OpenAI' } },
    });
  });

  it('portal pages: no Article without a published analysis', async () => {
    const [ld] = jsonLd(await (await get(handlePortalPage, '/portals/claude/2026-09-28')).text());
    expect(ld['@graph'].some((n: any) => n['@type'] === 'Article')).toBe(false);
  });

  it('homepage: WebSite with description, publisher and language, and a Dataset covering the archived weeks', async () => {
    const html = await (await handleHomepage(new Request('https://x/'), t.env)).text();
    const blocks = jsonLd(html);
    expect(blocks).toHaveLength(1);
    const [site, dataset] = blocks[0]['@graph'];
    expect(site).toEqual({
      '@type': 'WebSite', name: 'AI Interface Library', url: `${ORIGIN}/`,
      description: 'Weekly screenshots of AI chatbot interfaces — ChatGPT, Claude, Gemini, Perplexity, Copilot and more — on desktop and mobile, with design analysis and UI changes week by week.',
      inLanguage: 'en', publisher: { '@type': 'Person', name: 'Linda' },
    });
    expect(dataset['@type']).toBe('Dataset');
    expect(dataset.temporalCoverage).toBe('2026-09-28/2026-10-05'); // the 2026-08-03 system-test week is left out
    expect(dataset.distribution).toEqual({ '@type': 'DataDownload', encodingFormat: 'application/rss+xml', contentUrl: `${ORIGIN}/feed.xml` });
    expect(dataset.license).toBe(`${ORIGIN}/license`);
    expect(Object.keys(dataset).sort()).toEqual(['@type', 'description', 'distribution', 'inLanguage', 'license', 'name', 'temporalCoverage', 'url']);
  });

  it('homepage: no temporalCoverage without archived weeks', () => {
    expect((homepageJsonLd(null) as any)['@graph'][1]).not.toHaveProperty('temporalCoverage');
  });
});

describe('/robots.txt', () => {
  it('allows everyone, names the AI crawlers, and points to /llms.txt', () => {
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended']) {
      expect(ROBOTS).toMatch(new RegExp(`^User-agent: ${bot}\\nAllow: /$`, 'm'));
    }
    expect(ROBOTS).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(ROBOTS).not.toMatch(/^Disallow:/m);
    expect(ROBOTS).toMatch(/^# .*https:\/\/ai-portal-library\.dev\/llms\.txt/m);
  });
});

describe('/license', () => {
  it('licenses the analyses and menu changes under CC BY 4.0 and excludes screenshots and trademarks', async () => {
    const res = handleLicense(new Request('https://x/license'));
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain('<h1>License</h1>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/license" />`);
    expect(html).toContain('<a href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0 International license (CC BY 4.0)</a>');
    expect(html).toContain('The design analysis text and the records of menu changes on this site are licensed under');
    expect(html).toContain('Name AI Interface Library and link to the page you used');
    expect(html).toContain('Screenshots, product names, logos and trademarks belong to their respective companies and are not covered by this license.');
    expect(html).toContain('not affiliated with any of these companies');
    expect(html).toContain('<a href="/license">License</a>'); // footer
  });

  it('is linked from /how-we-analyze and the homepage footer, and listed in the sitemap', async () => {
    expect(await handleHowWeAnalyze(new Request('https://x/how-we-analyze')).text()).toContain('<a href="/license">See the license</a>');
    expect(INDEX_HTML).toContain('&copy; 2026 AI Interface Library. Analyses licensed under CC BY 4.0 &middot; <a href="/license">License</a> &middot; ');
    expect(INDEX_HTML).not.toContain('All rights reserved');
    expect(await (await handleSitemap(t.env)).text()).toMatch(new RegExp(`<loc>${ORIGIN}/license</loc>\\s*<lastmod>2026-10-10</lastmod>`));
  });
});

describe('portal hub search wording', () => {
  const html = async (path: string) => (await get(handlePortalPage, path)).text();
  const title = (h: string) => h.match(/<title>([^<]*)<\/title>/)![1];
  const description = (h: string) => h.match(/<meta name="description" content="([^"]*)"/)![1];
  const addLeChat = () => {
    t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('mistral', 'Le Chat', 'Mistral AI', 'https://chat.mistral.ai/', '#fa520f', 5)`);
    addCapture('mistral', 'Le Chat', 'Mistral AI', '2026-10-05', analysis('mistral', '2026-10-05', [], []));
  };

  it('hub and weekly titles and the hub description say "UI"', async () => {
    const hub = await html('/portals/chatgpt');
    expect(title(hub)).toBe('ChatGPT UI screenshots &amp; interface changes, week by week | AI Interface Library');
    expect(description(hub)).toBe('Weekly ChatGPT UI screenshots, desktop and mobile, with interface design analysis and how the ChatGPT UI changed. Latest: week of October 5, 2026.');
    expect(title(await html('/portals/chatgpt/2026-10-05'))).toBe('ChatGPT UI — week of October 5, 2026 | AI Interface Library');
  });

  it('titles stay at 70 characters or fewer before the brand, and hub descriptions at 155 or fewer, for every portal', () => {
    const seed = readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8');
    const portals = [...seed.matchAll(/INSERT INTO portals \([^)]*\) VALUES \('([^']+)','([^']+)'/g)].map((m) => ({ slug: m[1], name: m[2] }));
    expect(portals.length).toBeGreaterThan(10);
    for (const { slug, name } of portals) {
      expect(hubTitle(name).length).toBeLessThanOrEqual(70);
      expect(`${name} UI — week of September 28, 2026`.length).toBeLessThanOrEqual(70);
      const d = hubDescription(name, PORTAL_ALIASES[slug] ?? [], true, '2026-09-28');
      expect(d.length).toBeLessThanOrEqual(155);
      for (const word of ['UI', 'interface', 'screenshots', 'desktop and mobile', `how the ${name} UI changed`]) expect(d).toContain(word);
    }
    // A name long enough to pass 70 drops "& interface changes".
    expect(hubTitle('A Very Long Portal Name For Testing')).toBe('A Very Long Portal Name For Testing UI screenshots, week by week');
  });

  it('aliases: at most 2 each, the first in the hub description and the subtitle, all in the product alternateName', async () => {
    for (const list of Object.values(PORTAL_ALIASES)) expect(list.length).toBeLessThanOrEqual(2);
    addLeChat();
    const hub = await html('/portals/mistral');
    expect(hub).toContain('<h1>Le Chat</h1>\n      <p class="meta">Le Chat by Mistral AI · also called LeChat &middot; captured week of October 5, 2026</p>');
    expect(description(hub)).toContain('Also called LeChat.');
    expect(title(hub)).not.toContain('LeChat');
    const about = jsonLd(hub)[0]['@graph'].find((n: any) => n['@type'] === 'Article').about;
    expect(about).toEqual({ '@type': 'SoftwareApplication', name: 'Le Chat', alternateName: ['LeChat', 'Mistral Le Chat'], publisher: { '@type': 'Organization', name: 'Mistral AI' } });
    // No alias: the meta line and the product are unchanged.
    expect(await html('/portals/chatgpt')).toContain('<p class="meta">OpenAI &middot; captured week of October 5, 2026</p>');
  });

  it('the hub timeline lists ChatGPT\'s Scheduled → Tasks change under the screenshots and links to that week', async () => {
    const hub = await html('/portals/chatgpt');
    expect(hub).toContain([
      '      <section class="timeline"><h2>How the ChatGPT UI changed</h2>',
      '        <ul>',
      '          <li><a href="/portals/chatgpt/2026-10-05">October 5, 2026</a> — Scheduled renamed to Tasks</li>',
      '        </ul>',
      '      </section>',
    ].join('\n'));
    expect(hub.indexOf('class="shots"')).toBeLessThan(hub.indexOf('class="timeline"'));
    expect(hub.indexOf('class="timeline"')).toBeLessThan(hub.indexOf('class="analysis"'));
    expect(hub).not.toContain('Test week'); // system-test week left out
    for (const leak of LEAKS) expect(hub).not.toContain(leak);
    expect(await html('/portals/chatgpt/2026-10-05')).not.toContain('class="timeline"'); // hub only
  });

  it('a portal without recorded changes says so, and its description leaves out "changed"', async () => {
    const hub = await html('/portals/claude');
    expect(hub).toContain('<h2>How the Claude UI changed</h2>\n        <p>No menu changes have been recorded for Claude yet.</p>');
    expect(description(hub)).not.toContain('changed');
  });

  it('the hub Markdown has the same timeline; weekly Markdown does not', async () => {
    const md = await (await get(handlePortalPage, '/portals/chatgpt.md')).text();
    expect(md).toContain(['## How the ChatGPT UI changed', '', `- [October 5, 2026](${ORIGIN}/portals/chatgpt/2026-10-05) — Scheduled renamed to Tasks`, '', '## Screenshots'].join('\n'));
    expect(await (await get(handlePortalPage, '/portals/claude.md')).text()).toContain('## How the Claude UI changed\n\nNo menu changes have been recorded for Claude yet.');
    expect(await (await get(handlePortalPage, '/portals/chatgpt/2026-10-05.md')).text()).not.toContain('UI changed');
  });

  it('words every kind of change as a short phrase', () => {
    const c = (change: string, previous: string | null, current: string | null, region = 'sidebar', icon?: true) => navChangePhrase({ change, previous, current, region, ...(icon ? { icon } : {}) } as any);
    expect(c('renamed', 'Scheduled', 'Tasks')).toBe('Scheduled renamed to Tasks');
    expect(c('added', null, 'Create')).toBe('Create added to the sidebar');
    expect(c('removed', 'Upgrade', null, 'top bar')).toBe('Upgrade removed from the top bar');
    expect(c('added', null, 'slider icon', 'input area', true)).toBe('Icon button (slider icon) added to the input area');
    expect(c('removed', 'clock icon', null, 'top bar', true)).toBe('Icon button (clock icon) removed from the top bar');
    expect(c('icon_changed', 'bubble-clock icon', 'dashed bubble icon', 'top bar')).toBe('Top bar button icon changed (bubble-clock icon → dashed bubble icon)');
  });
});

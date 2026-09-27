import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleHomepage } from '../../src/homepage';
import { handlePortalPage, handleSitemap } from '../../src/portal-page';
import { CACHE_VERSION } from '../../src/db';
import { makeEnv } from './fake-env';

const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const ORIGIN = 'https://ai-portal-library.dev';
const DESCRIPTION = 'A weekly archive of AI product interfaces, analysed for layout, hierarchy and colour as a UI/UX design system.';

let t: ReturnType<typeof makeEnv>;

function addCapture(slug: string, name: string, company: string, week: string, status = 'ok') {
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, status, captured_at)
             VALUES ('${slug}-${week}', '${week}', '${slug}', '${name}', '${company}', 'https://example.com/', '#000000',
                     'shots/${week}/${slug}.local.png', '', 'pending', '${status}', '${week}T09:00:00Z')`);
}

beforeEach(() => {
  t = makeEnv();
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('le-chat', 'Le Chat & Co', 'Mistral <AI>', 'https://chat.mistral.ai/', '#ff7000', 5)`);
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, active) VALUES ('retired', 'Retired', 'Gone Inc', 'https://x/', '#000000', 0)`);
  addCapture('claude', 'Claude', 'Anthropic', '2026-08-03'); // system-test week
  addCapture('claude', 'Claude', 'Anthropic', '2026-09-14');
  addCapture('claude', 'Claude', 'Anthropic', '2026-09-21');
  addCapture('le-chat', 'Le Chat & Co', 'Mistral <AI>', '2026-09-21', 'error');
  addCapture('le-chat', 'Le Chat & Co', 'Mistral <AI>', '2026-07-20'); // system-test week
  addCapture('retired', 'Retired', 'Gone Inc', '2026-09-21');
  (t.env as unknown as { ASSETS: unknown }).ASSETS = {
    async fetch() { return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"abc"' } }); },
  };
});

describe('server-rendered homepage', () => {
  const home = async (method = 'GET') => handleHomepage(new Request('https://x/', { method }), t.env);

  it('fills in the three stats with real numbers', async () => {
    const html = await (await home()).text();
    // 4 ok captures on active portals, 2 active portals, 4 weeks.
    expect(html).toContain('<dd data-stat="screenshots">4</dd>');
    expect(html).toContain('<dd data-stat="portals">2</dd>');
    expect(html).toContain('<dd data-stat="weeks">4</dd>');
    expect(html).not.toMatch(/data-stat="\w+">–/);
  });

  it('links every portal in the latest week, with name and company, and sets the heading', async () => {
    const html = await (await home()).text();
    const list = html.match(/<ul class="portal-index" id="portalIndex"[^>]*>([\s\S]*?)<\/ul>/)![1];
    const items = [...list.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a> <span>([^<]+)<\/span><\/li>/g)].map((m) => m.slice(1));
    expect(items).toEqual([
      ['/portals/le-chat', 'Le Chat &amp; Co', 'Mistral &lt;AI&gt;'], // sort_order 5, before the default 100
      ['/portals/claude', 'Claude', 'Anthropic'],
    ]);
    // Same text public/app.js writes, so there is no change once it runs.
    expect(html).toContain('<h2 id="weekHeading">Week of 2026-09-21 · 1 portals</h2>');
    expect(html).not.toContain('Loading…</h2>');
  });

  it('reads the stats and captures from the same KV cache as the API', async () => {
    t.kv.set(`${CACHE_VERSION}:cache:stats`, JSON.stringify({ screenshots: 99, portals: 7, weeks: 3 }));
    const html = await (await home()).text();
    expect(html).toContain('<dd data-stat="screenshots">99</dd>');
    expect(t.kv.has(`${CACHE_VERSION}:cache:captures:2026-09-21`)).toBe(true);
  });

  it('hides the link list once JavaScript runs, and keeps the static page otherwise', async () => {
    expect(INDEX_HTML).toContain('<script>document.documentElement.classList.add("js")</script>');
    expect(readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8')).toContain('.js .portal-index{display:none}');
    // Without the Worker the static file still has the placeholders and an empty list.
    expect(INDEX_HTML).toContain('<ul class="portal-index" id="portalIndex" aria-label="Portals this week"></ul>');
  });

  it('shows the empty state when nothing has been captured', async () => {
    t.db.exec('DELETE FROM captures; DELETE FROM weeks;');
    const html = await (await home()).text();
    expect(html).toContain('<h2 id="weekHeading">No captures yet</h2>');
    expect(html).toContain('<dd data-stat="screenshots">0</dd>');
    expect(html).toContain('<ul class="portal-index" id="portalIndex" aria-label="Portals this week"></ul>');
  });

  it('drops the static etag and sends no body for HEAD', async () => {
    const res = await home('HEAD');
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('');
  });

  it('has the new meta description and its canonical URL', () => {
    expect(INDEX_HTML).toContain(`<meta name="description" content="${DESCRIPTION}" />`);
    expect(INDEX_HTML).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
  });
});

describe('/sitemap.xml', () => {
  const locs = async () => [...(await (await handleSitemap(t.env)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it('lists the homepage, each portal and each captured week, without system-test weeks', async () => {
    expect(await locs()).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/how-we-analyze`,
      `${ORIGIN}/privacy`,
      `${ORIGIN}/portals/claude`,
      `${ORIGIN}/portals/claude/2026-09-21`,
      `${ORIGIN}/portals/claude/2026-09-14`,
    ]);
  });

  it('leaves out every system-test week', async () => {
    addCapture('claude', 'Claude', 'Anthropic', '2026-07-20');
    addCapture('claude', 'Claude', 'Anthropic', '2026-08-10'); // 2026-08-03 is already in beforeEach
    const all = (await locs()).join('\n');
    expect(all).not.toMatch(/2026-07-20|2026-08-03|2026-08-10/);
  });

  it('is XML and cached in KV like the other cached responses', async () => {
    const res = await handleSitemap(t.env);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(t.kv.has(`${CACHE_VERSION}:cache:sitemap`)).toBe(true);
    addCapture('claude', 'Claude', 'Anthropic', '2026-09-28');
    expect(await locs()).not.toContain(`${ORIGIN}/portals/claude/2026-09-28`); // served from cache
  });
});

describe('/robots.txt', () => {
  it('allows everything and points to the sitemap', () => {
    const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).not.toMatch(/^Disallow:/m);
    expect(robots).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, 'm'));
  });
});

describe('portal pages: noindex and canonical', () => {
  const page = async (path: string) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();
  const canonical = (html: string) => html.match(/<link rel="canonical" href="([^"]+)" \/>/)?.[1];
  const NOINDEX = '<meta name="robots" content="noindex" />';

  it('adds noindex to system-test weeks only', async () => {
    expect(await page('/portals/claude/2026-08-03')).toContain(NOINDEX);
    expect(await page('/portals/le-chat/2026-07-20')).toContain(NOINDEX);
    expect(await page('/portals/claude/2026-09-14')).not.toContain(NOINDEX);
    expect(await page('/portals/claude/2026-09-21')).not.toContain(NOINDEX);
    expect(await page('/portals/claude')).not.toContain(NOINDEX);
  });

  it('gives every page its own canonical URL, matching the sitemap', async () => {
    expect(canonical(await page('/portals/claude'))).toBe(`${ORIGIN}/portals/claude`);
    expect(canonical(await page('/portals/claude/'))).toBe(`${ORIGIN}/portals/claude`);
    expect(canonical(await page('/portals/claude/2026-09-21'))).toBe(`${ORIGIN}/portals/claude/2026-09-21`);
    expect(canonical(await page('/portals/claude/2026-09-14'))).toBe(`${ORIGIN}/portals/claude/2026-09-14`);
    expect(canonical(await page('/portals/claude/2026-09-14/'))).toBe(`${ORIGIN}/portals/claude/2026-09-14`);
    expect(canonical(await page('/portals/no-such-portal'))).toBeUndefined(); // 404, noindex
  });
});

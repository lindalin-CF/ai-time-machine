import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleChangelog, handleSitemap } from '../../src/portal-page';
import { handleLlmsTxt } from '../../src/aeo';
import { CHANGELOG, changelogDate, changelogDatetime, utcOffsetLabel } from '../../src/changelog';
import { makeEnv } from './fake-env';
import { LEGAL_LINE, expectFooterDialogs } from './footer-dialogs';

const ORIGIN = 'https://ai-portal-library.dev';
const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const WRANGLER = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
const INDEX_TS = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');

async function changelogHtml(path = '/changelog'): Promise<string> {
  const res = handleChangelog(new Request(`${ORIGIN}${path}`));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
  return await res.text();
}

/** Each rendered entry: its id and its <time datetime>, in page order. */
function renderedEntries(html: string): { id: string; datetime: string }[] {
  return [...html.matchAll(/<li class="cl-entry" id="([^"]+)">\s*<time class="cl-when" datetime="([^"]+)">/g)].map((m) => ({ id: m[1], datetime: m[2] }));
}

describe('/changelog', () => {
  it('returns 200 at /changelog and /changelog/, and is routed to the Worker', async () => {
    await changelogHtml('/changelog');
    await changelogHtml('/changelog/');
    expect(INDEX_TS).toContain('url.pathname === "/changelog" || url.pathname === "/changelog/") return handleChangelog(request)');
    expect(WRANGLER).toMatch(/"run_worker_first": \[[^\]]*"\/changelog", "\/changelog\/"/);
  });

  it('rejects other methods and sends no body for HEAD', async () => {
    expect(handleChangelog(new Request(`${ORIGIN}/changelog`, { method: 'POST' })).status).toBe(405);
    const head = handleChangelog(new Request(`${ORIGIN}/changelog`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('has a header, a canonical URL and every entry', async () => {
    const html = await changelogHtml();
    expect(html).toContain('<title>Changelog | AI Interface Library</title>');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/changelog" />`);
    expect(html).toContain('<h1>Changelog</h1>');
    expect(html).toContain('<p class="meta">Decisions and releases for AI Interface Library.</p>');
    expect(renderedEntries(html).map((e) => e.id)).toEqual(CHANGELOG.map((e) => e.slug));
  });

  it('lists entries newest first', () => {
    const at = (e: (typeof CHANGELOG)[number]) => `${e.date}T${e.time ?? ''}`;
    for (let i = 0; i < CHANGELOG.length; i++) {
      for (let j = i + 1; j < CHANGELOG.length; j++) {
        const [a, b] = [CHANGELOG[i], CHANGELOG[j]];
        expect(a.date >= b.date, `${a.slug} before ${b.slug}`).toBe(true);
        if (a.date === b.date && a.time && b.time) expect(at(a) >= at(b), `${a.slug} before ${b.slug}`).toBe(true);
      }
    }
  });

  it('gives every entry a unique id and a valid <time datetime>', async () => {
    const entries = renderedEntries(await changelogHtml());
    expect(entries).toHaveLength(CHANGELOG.length);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const e of entries) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.datetime).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}-05:00)?$/);
      expect(Number.isNaN(Date.parse(e.datetime)), e.datetime).toBe(false);
    }
    expect(changelogDatetime({ date: '2026-10-14', time: '23:18' })).toBe('2026-10-14T23:18-05:00');
  });

  it('renders the date, time, title, # link, subtitle, bullets and closing', async () => {
    const html = await changelogHtml();
    expect(changelogDate('2026-10-14')).toBe('Oct 14, 2026');
    expect(utcOffsetLabel()).toBe('UTC−5');
    expect(html).toContain('<span class="cl-date">Oct 14, 2026</span>');
    expect(html).toContain('<span class="cl-time">23:18 &middot; UTC−5</span>');
    expect(html).toContain('<h2>One Address per Page<a class="cl-anchor" href="/changelog#one-address" aria-label="Link to One Address per Page">#</a>');
    expect(html).toContain('<p class="cl-sub">Every page now lives at a single URL</p>');
    expect(html).toContain('<li><strong>No more www:</strong> www.ai-portal-library.dev redirects to ai-portal-library.dev, and query strings are kept.</li>');
    expect(html).toContain('<p>Search engines now see one version of each page instead of three.</p>');
    // An entry with no time shows only the date.
    const noTime = html.match(/<li class="cl-entry" id="dark-default">[\s\S]*?<\/time>/)![0];
    expect(noTime).toContain('datetime="2026-10-09"');
    expect(noTime).not.toContain('cl-time');
  });

  it('shows nothing private', async () => {
    const html = await changelogHtml();
    const text = html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
    expect(text).not.toMatch(/src\/|scripts\/|\.mjs|\.jsonc|wrangler|token|secret|private-terms|AI-Surface-Archive/i);
  });

  it('is in the sitemap and llms.txt', async () => {
    const t = makeEnv();
    const xml = await (await handleSitemap(t.env)).text();
    expect(xml).toContain(`<loc>${ORIGIN}/changelog</loc>\n    <lastmod>${CHANGELOG[0].date}</lastmod>`);
    const llms = await (await handleLlmsTxt(new Request(`${ORIGIN}/llms.txt`), t.env)).text();
    expect(llms).toContain(`- [Changelog](${ORIGIN}/changelog): `);
  });
});

describe('footer Changelog link', () => {
  it('comes right after License, identically on the homepage and the server-rendered pages', async () => {
    const html = await changelogHtml();
    const portalLine = html.match(/<div class="legal">([\s\S]*?)<\/div>/)![1];
    const homeLine = INDEX_HTML.match(/<span class="foot-legal">([\s\S]*?)<\/span>/)![1];
    expect(portalLine).toBe(homeLine);
    expect(portalLine).toBe(LEGAL_LINE);
    expect(portalLine).toContain('<a href="/license">License</a> &middot; <a href="/changelog">Changelog</a> &middot; ');
    expectFooterDialogs(html);
  });
});

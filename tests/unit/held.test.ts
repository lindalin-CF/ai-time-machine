import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleApi, handleImage } from '../../src/api';
import { storeCapture } from '../../src/capture';
import { getPortal } from '../../src/db';
import { handleHomepage } from '../../src/homepage';
import { handleFacts } from '../../src/facts-page';
import { handleChanges, handleFeed, handlePortalPage, handleSitemap } from '../../src/portal-page';
import { handleWeeks } from '../../src/week-page';
import { handleComparePage } from '../../src/compare-page';
import { handleLlmsFullTxt, handleLlmsTxt } from '../../src/aeo';
// @ts-expect-error -- plain .mjs script, no type declarations
import { heldStatus, plan as releasePlan, keyOf } from '../../scripts/local-capture/analysis/release-week.mjs';
// @ts-expect-error -- plain .mjs script, no type declarations
import { uploadWeek, sha1 } from '../../scripts/local-capture/analysis/upload-redacted.mjs';
import { makeEnv } from './fake-env';

// Held captures (migration 0011): local uploads stay off every public surface until POST /api/weeks/<week>/release.

const ORIGIN = 'https://ai-portal-library.dev';
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const MIGRATION = readFileSync(new URL('../../migrations/0011_capture_held.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const SCRIPT = (p: string) => readFileSync(new URL(`../../scripts/local-capture/${p}`, import.meta.url), 'utf8');

const OLD = '2026-10-19';
const NEW = '2026-10-26';
const HELD_DESKTOP = `shots/${NEW}/chatgpt.local.png`;
const HELD_MOBILE = `shots/${NEW}/chatgpt.mobile.local.png`;
const MARKER = 'HeldSummaryMarker';
const TOKEN = { authorization: 'Bearer test-token' };

let t: ReturnType<typeof makeEnv>;

function analysis(slug: string, week: string, summary: string) {
  return {
    guideline_version: '1.9.0', portal: slug, week, previous_week: null, variant: 'desktop', status: 'ok',
    metrics: [{ id: 'N1', sidebar: 'visible', value: [{ label: 'Home', region: 'sidebar', badge: null }] }],
    changes_vs_previous: [], summary,
  };
}
function addCapture(slug: string, week: string, o: { held?: number; key?: string; mobile?: string | null; summary?: string } = {}) {
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  const key = o.key ?? `shots/${week}/${slug}.local.png`;
  const summary = o.summary ?? `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`;
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, r2_key_mobile, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at, held)
                VALUES (?, ?, ?, ?, 'Co', 'https://example.com/', '#000000', ?, ?, ?, 'guideline-v1.9.0', ?, ?, 'ok', ?, ?)`)
    .run(`${slug}-${week}`, week, slug, slug === 'chatgpt' ? 'ChatGPT' : 'Grok', key, o.mobile ?? null, summary, JSON.stringify(analysis(slug, week, summary)), `${week}T20:00:00Z`, `${week}T09:00:00Z`, o.held ?? 0);
  t.r2.set(key, new Uint8Array(200).fill(7));
  if (o.mobile) t.r2.set(o.mobile, new Uint8Array(200).fill(8));
}

beforeEach(() => {
  t = makeEnv();
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES
    ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0),
    ('grok', 'Grok', 'xAI', 'https://grok.com/', '#000000', 6)`);
  (t.env as unknown as { ASSETS: unknown }).ASSETS = { async fetch() { return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html' } }); } };
  // A released week, then a new week: ChatGPT's local upload is held, Grok's cron capture (logged out) is not.
  addCapture('chatgpt', OLD);
  addCapture('grok', OLD);
  addCapture('chatgpt', NEW, { held: 1, mobile: HELD_MOBILE, summary: `This shows the desktop version of ChatGPT for the week of ${NEW}, before scrolling. ${MARKER} stands out most.` });
  addCapture('grok', NEW, { key: `shots/${NEW}/grok.png` });
});

const req = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, init);
const api = (path: string, init: RequestInit = {}) => handleApi(req(path, init), t.env, ctx);
const json = async (res: Response | Promise<Response>) => (await res).json() as Promise<any>;
const release = (q = '', headers: Record<string, string> = TOKEN) => api(`/api/weeks/${NEW}/release${q}`, { method: 'POST', headers });

/** Every public page and payload from the task list, as [name, Response]. */
async function publicSurfaces(): Promise<[string, Response][]> {
  const get = (h: (r: Request, e: typeof t.env) => Promise<Response>, path: string) => h(req(path), t.env);
  const pages: [string, Promise<Response>][] = [
    ['/api/captures', api('/api/captures')],
    [`/api/captures?week=${NEW}`, api(`/api/captures?week=${NEW}`)],
    ['/api/weeks', api('/api/weeks')],
    ['/api/stats', api('/api/stats')],
    ['/api/portals', api('/api/portals')],
    [`/api/collection.zip?week=${NEW}`, api(`/api/collection.zip?week=${NEW}`)],
    ['/', get(handleHomepage, '/')],
    ['/portals/chatgpt', get(handlePortalPage, '/portals/chatgpt')],
    ['/portals/chatgpt.md', get(handlePortalPage, '/portals/chatgpt.md')],
    [`/portals/chatgpt/${OLD}`, get(handlePortalPage, `/portals/chatgpt/${OLD}`)],
    ['/portals/grok', get(handlePortalPage, '/portals/grok')],
    ['/compare/chatgpt-vs-grok', get(handleComparePage, '/compare/chatgpt-vs-grok')],
    ['/compare/chatgpt-vs-grok.md', get(handleComparePage, '/compare/chatgpt-vs-grok.md')],
    ['/weeks', get(handleWeeks, '/weeks')],
    [`/weeks/${OLD}`, get(handleWeeks, `/weeks/${OLD}`)],
    ['/facts', get(handleFacts, '/facts')],
    ['/facts.md', get(handleFacts, '/facts.md')],
    ['/changes', get(handleChanges, '/changes')],
    ['/sitemap.xml', handleSitemap(t.env)],
    ['/feed.xml', handleFeed(t.env)],
    ['/llms.txt', get(handleLlmsTxt, '/llms.txt')],
    ['/llms-full.txt', get(handleLlmsFullTxt, '/llms-full.txt')],
  ];
  return Promise.all(pages.map(async ([n, r]) => [n, await r] as [string, Response]));
}

describe('held captures are hidden on every public surface', () => {
  it('no page, payload or OG image mentions the held capture, its images or its analysis', async () => {
    for (const [name, res] of await publicSurfaces()) {
      expect(res.status, name).toBe(200);
      const body = new TextDecoder('latin1').decode(await res.arrayBuffer());
      expect(body, name).not.toContain(HELD_DESKTOP);
      expect(body, name).not.toContain(HELD_MOBILE);
      expect(body, name).not.toContain(MARKER);
      if (name.includes('collection.zip')) expect(body, name).not.toContain('chatgpt.png'); // zip entry name
    }
  });

  it('the held week is not the latest, not listed, and not counted; the site keeps the previous week', async () => {
    expect((await json(api('/api/captures'))).week).toBe(OLD);
    expect((await json(api('/api/weeks'))).weeks.map((w: { week: string }) => w.week)).toEqual([OLD]);
    // ChatGPT and Grok on 10-19, plus Grok's public cron capture on 10-26; one released week.
    expect(await json(api('/api/stats'))).toEqual({ screenshots: 3, portals: 3, weeks: 1 });
    const home = await (await handleHomepage(req('/'), t.env)).text();
    expect(home).toContain('href="/weeks/2026-10-19"');
    expect(home).not.toContain(`/weeks/${NEW}`);
    expect((await handleWeeks(req(`/weeks/${NEW}`), t.env)).status).toBe(404);
    expect((await handlePortalPage(req(`/portals/chatgpt/${NEW}`), t.env)).status).toBe(404);
    expect((await handlePortalPage(req(`/portals/chatgpt/${NEW}.md`), t.env)).status).toBe(404);
    // The portal page's latest (and its og:image) is the released week.
    expect(await (await handlePortalPage(req('/portals/chatgpt'), t.env)).text()).toMatch(/<meta property="og:image" content="[^"]*shots\/2026-10-19\/chatgpt\.local\.png/);
    // Only the held capture is left out of its week: Grok's cron capture is public.
    const week = await json(api(`/api/captures?week=${NEW}`));
    expect(week.captures.map((c: { slug: string }) => c.slug)).toEqual(['grok']);
    expect(week.captures[0]).not.toHaveProperty('held');
  });

  it('/img/<key> answers 404 for a held desktop or mobile screenshot, and serves released ones', async () => {
    for (const key of [HELD_DESKTOP, HELD_MOBILE]) {
      const res = await handleImage(req(`/img/${key}?v=1`), t.env);
      expect(res.status, key).toBe(404);
      expect(await res.text()).toBe('not found');
      // A wrong token is the public view.
      expect((await handleImage(req(`/img/${key}`, { headers: { authorization: 'Bearer nope' } }), t.env)).status).toBe(404);
    }
    const ok = await handleImage(req(`/img/shots/${OLD}/chatgpt.local.png`), t.env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('public, max-age=86400');
  });
});

describe('the upload token sees held captures', () => {
  it('/api/captures?week=… lists them with held: true, uncached and private', async () => {
    const res = await api(`/api/captures?week=${NEW}`, { headers: TOKEN });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json() as any;
    expect(body.captures.map((c: { slug: string; held: boolean }) => [c.slug, c.held])).toEqual([['chatgpt', true], ['grok', false]]);
    const chatgpt = body.captures[0];
    expect(chatgpt.image).toMatch(new RegExp(`^/img/${HELD_DESKTOP}\\?v=`));
    expect(chatgpt.imageMobile).toMatch(new RegExp(`^/img/${HELD_MOBILE}\\?v=`));
    // Nothing from the token request leaks into the public cache.
    expect((await json(api(`/api/captures?week=${NEW}`))).captures.map((c: { slug: string }) => c.slug)).toEqual(['grok']);
    // Without ?week=, the token's latest week is the newest one, held or not.
    expect((await json(api('/api/captures', { headers: TOKEN }))).week).toBe(NEW);
    expect((await json(api('/api/weeks', { headers: TOKEN }))).weeks.map((w: { week: string }) => w.week)).toEqual([NEW, OLD]);
  });

  it('/img/<key> serves held screenshots, never cached', async () => {
    for (const key of [HELD_DESKTOP, HELD_MOBILE]) {
      const res = await handleImage(req(`/img/${key}`, { headers: TOKEN }), t.env);
      expect(res.status, key).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});

describe('POST /api/weeks/<week>/release', () => {
  it('needs the token', async () => {
    expect((await release('', {})).status).toBe(401);
    expect((await release('', { authorization: 'Bearer nope' })).status).toBe(401);
    expect((t.db.prepare(`SELECT held FROM captures WHERE id = 'chatgpt-${NEW}'`).get() as { held: number }).held).toBe(1);
  });

  it('makes the week public and clears the cached pages at once', async () => {
    // Warm every cache first: they must not keep serving the old view.
    await publicSurfaces();
    expect([...t.kv.keys()].length).toBeGreaterThan(5);
    const res = await release();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, week: NEW, slug: null, released: ['chatgpt'], stillHeld: [], latestWeek: NEW });
    for (const k of ['captures:2026-10-26', 'weeks', 'stats', 'sitemap', 'feed', 'changes', 'facts', 'llms', 'llms-full', 'week-digests', 'compare-pairs']) {
      expect([...t.kv.keys()].some((x) => x.endsWith(`:cache:${k}`)), k).toBe(false);
    }
    expect((await json(api('/api/captures'))).week).toBe(NEW);
    expect((await json(api('/api/captures'))).captures.map((c: { slug: string }) => c.slug)).toEqual(['chatgpt', 'grok']);
    expect(await json(api('/api/stats'))).toEqual({ screenshots: 4, portals: 3, weeks: 2 });
    expect(await (await handleHomepage(req('/'), t.env)).text()).toContain(`href="/weeks/${NEW}"`);
    expect((await handleImage(req(`/img/${HELD_DESKTOP}`), t.env)).status).toBe(200);
    expect((await handleImage(req(`/img/${HELD_MOBILE}`), t.env)).status).toBe(200);
    expect((await handlePortalPage(req(`/portals/chatgpt/${NEW}`), t.env)).status).toBe(200);
    expect(await (await handleSitemap(t.env)).text()).toContain(HELD_DESKTOP);
    expect(await (await handleFeed(t.env)).text()).toContain(MARKER);
    expect(await (await handleLlmsFullTxt(req('/llms-full.txt'), t.env)).text()).toContain(MARKER);
  });

  it('?slug= releases one portal; the week stays off the homepage until nothing in it is held', async () => {
    t.db.exec(`UPDATE captures SET held = 1, r2_key = 'shots/${NEW}/grok.local.png' WHERE id = 'grok-${NEW}'`);
    t.r2.set(`shots/${NEW}/grok.local.png`, new Uint8Array(200).fill(9));
    expect(await json(release('?slug=chatgpt'))).toMatchObject({ released: ['chatgpt'], stillHeld: ['grok'], latestWeek: OLD });
    expect((await handlePortalPage(req(`/portals/chatgpt/${NEW}`), t.env)).status).toBe(200);
    expect((await handlePortalPage(req(`/portals/grok/${NEW}`), t.env)).status).toBe(404);
    expect((await json(api('/api/captures'))).week).toBe(OLD);
    expect(await json(release('?slug=grok'))).toMatchObject({ released: ['grok'], stillHeld: [], latestWeek: NEW });
    expect((await json(api('/api/captures'))).week).toBe(NEW);
  });

  it('rejects a bad slug', async () => {
    expect((await release('?slug=../x')).status).toBe(400);
  });
});

describe('which captures are held', () => {
  const upload = (body: Record<string, unknown>) => api('/api/upload', {
    method: 'POST', headers: { 'content-type': 'application/json', ...TOKEN },
    body: JSON.stringify({ slug: 'grok', week: '2026-11-02', imageBase64: Buffer.alloc(200, 1).toString('base64'), ...body }),
  });
  const held = (id: string) => (t.db.prepare(`SELECT held FROM captures WHERE id = ?`).get(id) as { held: number } | undefined)?.held;

  it('POST /api/upload holds the desktop and mobile captures, and a replaced image stays held', async () => {
    expect((await upload({ variant: 'mobile' })).status).toBe(200);
    expect(held('grok-2026-11-02')).toBe(1);
    expect((await upload({})).status).toBe(200);
    expect((await upload({})).status).toBe(200);
    expect(held('grok-2026-11-02')).toBe(1);
    expect((await handleImage(req('/img/shots/2026-11-02/grok.local.png'), t.env)).status).toBe(404);
    expect((await handleImage(req('/img/shots/2026-11-02/grok.mobile.local.png'), t.env)).status).toBe(404);
  });

  it('a new upload over a released capture holds it again', async () => {
    expect((await upload({ week: OLD })).status).toBe(200);
    expect(held(`grok-${OLD}`)).toBe(1);
    // Both weeks now have a held capture, so neither is listed until a release.
    expect((await json(api('/api/captures'))).week).toBeNull();
    expect((await json(api(`/api/captures?week=${OLD}`))).captures.map((c: { slug: string }) => c.slug)).toEqual(['chatgpt']);
  });

  it('cron (cloud) captures are never held, and never release a held one', async () => {
    const grok = (await getPortal(t.env, 'grok'))!;
    await storeCapture(t.env, '2026-11-09', grok, new Uint8Array(200).fill(3), 'cloud');
    expect(held('grok-2026-11-09')).toBe(0);
    expect((await json(api('/api/captures'))).week).toBe('2026-11-09');
    // A cloud capture landing on a held row (for example a held mobile-only upload) keeps it held.
    await upload({ week: '2026-11-16', variant: 'mobile' });
    await storeCapture(t.env, '2026-11-16', grok, new Uint8Array(200).fill(4), 'cloud');
    expect(held('grok-2026-11-16')).toBe(1);
  });
});

describe('before migration 0011 (no held column)', () => {
  // A deploy that runs ahead of the migration shows every capture, as before, instead of failing.
  beforeEach(() => { t.db.exec('ALTER TABLE captures DROP COLUMN held'); });

  it('serves every public surface, with every capture public', async () => {
    for (const [name, res] of await publicSurfaces()) expect(res.status, name).toBe(200);
    expect((await json(api('/api/captures'))).week).toBe(NEW);
    expect((await handleImage(req(`/img/${HELD_DESKTOP}`), t.env)).status).toBe(200);
    expect((await json(api(`/api/captures?week=${NEW}`, { headers: TOKEN }))).captures.map((c: { held: boolean }) => c.held)).toEqual([false, false]);
  });

  it('stores uploads, and release says the migration is missing', async () => {
    const res = await api('/api/upload', {
      method: 'POST', headers: { 'content-type': 'application/json', ...TOKEN },
      body: JSON.stringify({ slug: 'grok', week: '2026-11-02', imageBase64: Buffer.alloc(200, 1).toString('base64') }),
    });
    expect(res.status).toBe(200);
    expect((await release()).status).toBe(409);
  });

  it('starts holding once the migration runs, without a redeploy', async () => {
    expect((await json(api('/api/captures'))).week).toBe(NEW);
    t.db.exec(MIGRATION);
    t.db.exec(`UPDATE captures SET held = 1 WHERE id = 'chatgpt-${NEW}'`);
    t.kv.clear();
    expect((await json(api('/api/captures'))).week).toBe(OLD);
    expect((await handleImage(req(`/img/${HELD_DESKTOP}`), t.env)).status).toBe(404);
  });
});

describe('migration 0011', () => {
  it('adds held, defaulting existing rows to 0 (public), and only that', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    db.exec('ALTER TABLE captures DROP COLUMN held');
    db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('grok', 'Grok', 'xAI', 'https://x/', '#000')`);
    db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${OLD}', 'w', 'w')`);
    db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, captured_at) VALUES ('grok-${OLD}', '${OLD}', 'grok', 'Grok', 'xAI', 'https://x/', '#000', 'now')`);
    db.exec(MIGRATION);
    expect(db.prepare('SELECT held FROM captures').all()).toEqual([{ held: 0 }]);
    const statements = MIGRATION.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual(['ALTER TABLE captures ADD COLUMN held INTEGER NOT NULL DEFAULT 0']);
    expect(SCHEMA).toContain('held         INTEGER NOT NULL DEFAULT 0');
  });
});

describe('local scripts', () => {
  it('prepare.mjs and publish.mjs send the token; capture.mjs points to the release step', () => {
    const prepare = SCRIPT('analysis/prepare.mjs');
    expect(prepare).toContain('const AUTH = UPLOAD_TOKEN ? { authorization: `Bearer ${UPLOAD_TOKEN}` } : {};');
    expect(prepare.match(/fetch\(`\$\{WORKER_URL\}\$\{path\}`, \{ headers: AUTH \}\)/g)).toHaveLength(2);
    expect(SCRIPT('analysis/publish.mjs')).toContain('/api/captures?week=${encodeURIComponent(week)}`, { headers: auth })');
    expect(SCRIPT('capture.mjs')).toContain('/release-week ${week}');
    // None of them prints the token.
    for (const f of ['capture.mjs', 'analysis/prepare.mjs', 'analysis/publish.mjs', 'analysis/upload-redacted.mjs', 'analysis/release-week.mjs']) {
      expect(SCRIPT(f), f).not.toMatch(/console\.\w+\([^;]*\$\{(UPLOAD_TOKEN|token|auth|AUTH)\b/);
    }
  });

  it('upload-redacted.mjs checks a held image through the site with the token on stdin, never in the arguments', () => {
    const week = '2026-10-26', key = `shots/${week}/pi.local.png`;
    const root = mkdtempSync(join(tmpdir(), 'held-root-')), archive = mkdtempSync(join(tmpdir(), 'held-archive-'));
    mkdirSync(join(root, 'w'));
    const original = Buffer.from('original'), redacted = Buffer.from('redacted');
    writeFileSync(join(root, 'w/red.png'), redacted);
    writeFileSync(join(archive, 'redaction-ledger.json'), JSON.stringify({ version: 1, images: [{
      r2_key: key, week, slug: 'pi', variant: 'desktop', original_sha1: sha1(original), redacted_sha1: sha1(redacted),
      redacted_file: join(root, 'w/red.png'), upload_status: 'pending review', archived_before_upload: [],
    }] }));
    const live: Record<string, Buffer> = { [key]: original };
    const calls: { line: string; input?: string }[] = [];
    const exec = (cmd: string, args: string[], opts: { input?: string }) => {
      const line = [cmd, ...args].join(' ');
      calls.push({ line, input: opts.input });
      const ok = (out: Buffer | string = '') => ({ status: 0, stdout: Buffer.from(out), stderr: '' });
      // The site only serves the held image with the token.
      if (cmd === 'curl') return opts.input === 'Authorization: Bearer secret-token\n' ? ok(live[key]) : { status: 22, stdout: Buffer.alloc(0), stderr: '404' };
      if (args[1] === 'r2' && args[3] === 'get') return ok(live[key]);
      if (args[1] === 'r2' && args[3] === 'put') { live[key] = redacted; return ok(); }
      if (args[1] === 'd1') return ok(JSON.stringify(args.at(-1)!.startsWith('SELECT') ? [{ results: [{ captured_at: '2026-10-26T09:00:00.000Z' }] }] : [{ meta: { changes: 1 } }]));
      return ok();
    };
    const logs: string[] = [];
    const run = (token?: string) => uploadWeek(week, { root, archiveDir: archive, site: 'https://site.test', exec, token, log: (s: string) => logs.push(s), config: { cacheVersion: 'v', kvId: 'k', cacheKeys: ['stats'] } });
    expect(run('secret-token')).toMatchObject([{ ok: true }]);
    const curl = calls.find((c) => c.line.startsWith('curl'))!;
    expect(curl.line).toMatch(/^curl -sf https:\/\/site\.test\/img\/shots\/2026-10-26\/pi\.local\.png\?cb=\d+ -H @-$/);
    expect(calls.every((c) => !c.line.includes('secret-token'))).toBe(true);
    expect(logs.join('\n')).not.toContain('secret-token');
  });

  it('release-week.mjs: an image is redacted only when the site serves its ledger SHA-1', async () => {
    const caps = [
      { slug: 'chatgpt', held: true, image: '/img/shots/w/chatgpt.local.png?v=1', imageMobile: '/img/shots/w/chatgpt.mobile.local.png?v=1' },
      { slug: 'grok', held: true, image: '/img/shots/w/grok.local.png?v=1', imageMobile: null },
      { slug: 'kimi', held: true, image: '/img/shots/w/kimi.local.png?v=1', imageMobile: null },
      { slug: 'pi', held: true, image: '/img/shots/w/pi.local.png?v=1', imageMobile: null },
      { slug: 'claude', held: false, image: '/img/shots/w/claude.local.png?v=1', imageMobile: null },
    ];
    const ledger = { images: [
      { r2_key: 'shots/w/chatgpt.local.png', upload_status: 'uploaded', redacted_sha1: 'r1', original_sha1: 'o1' },
      { r2_key: 'shots/w/chatgpt.mobile.local.png', upload_status: 'no change', redacted_sha1: null, original_sha1: 'o2' },
      { r2_key: 'shots/w/grok.local.png', upload_status: 'pending review', redacted_sha1: 'r3', original_sha1: 'o3' },
      { r2_key: 'shots/w/pi.local.png', upload_status: 'uploaded', redacted_sha1: 'r4', original_sha1: 'o4' },
    ] };
    const served: Record<string, string> = { 'shots/w/chatgpt.local.png': 'r1', 'shots/w/chatgpt.mobile.local.png': 'o2', 'shots/w/grok.local.png': 'o3', 'shots/w/kimi.local.png': 'x', 'shots/w/pi.local.png': 'new-capture' };
    const status = await heldStatus(caps, ledger, async (k: string) => served[k]);
    expect(status.map((s: { slug: string; redacted: boolean; images: { reason: string }[] }) => [s.slug, s.redacted, s.images.map((i) => i.reason)])).toEqual([
      ['chatgpt', true, ['uploaded', 'no change']],
      ['grok', false, ['ledger: pending review']],
      ['kimi', false, ['no ledger entry']],
      ['pi', false, ['live image differs from the ledger (replaced after redaction?)']],
    ]);
    // Unredacted captures are refused unless forced by name ("release anyway <slug>").
    expect(releasePlan(status)).toEqual({ release: ['chatgpt'], refused: ['grok', 'kimi', 'pi'], unknown: [] });
    expect(releasePlan(status, { slugs: ['grok'], force: ['grok'] })).toEqual({ release: ['grok'], refused: [], unknown: [] });
    expect(releasePlan(status, { slugs: ['nope'] })).toMatchObject({ unknown: ['nope'] });
    expect(keyOf('/img/shots/w/a%20b.png?v=3')).toBe('shots/w/a b.png');
  });
});

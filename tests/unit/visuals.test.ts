import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleApi, handleImage } from '../../src/api';
import { handleWeeks } from '../../src/week-page';
import { handlePortalPage } from '../../src/portal-page';
import { visualKey } from '../../src/visuals';
import { makeEnv } from './fake-env';

// Before/after visuals (src/visuals.ts, migration 0012): POST /api/visual, GET /img/visuals/…, and their place on
// /weeks/<week> and /portals/<slug>/<week>. A visual is refused, never served and never shown while either week's
// capture is held; without the visuals table nothing changes on any page.

const OLD = '2026-11-02', NEW = '2026-11-09';
const TOKEN = { authorization: 'Bearer test-token' };
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const ALT = 'The Chat and Cowork buttons no longer appear in the message box.';
const MIGRATION = readFileSync(new URL('../../migrations/0012_visuals.sql', import.meta.url), 'utf8');

/** A real 2 x 2 PNG with a different colour per call, so replacements differ byte for byte. */
function png(seed = 0): Uint8Array {
  // Minimal PNG: signature + IHDR (2 x 2, 8-bit RGBA) + the rest; only the header is parsed by the Worker.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0xb0, 0, 0, 1, 0x8a, 8, 6, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([...sig, ...ihdr, ...new Array(200).fill(seed)]);
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

let t: ReturnType<typeof makeEnv>;

function analysis(week: string, changes: unknown[]) {
  return {
    guideline_version: '1.10.1', portal: 'claude', week, previous_week: week === NEW ? OLD : null, variant: 'desktop', status: 'ok',
    context: { color_scheme: 'dark' },
    metrics: [{ id: 'N1', sidebar: 'visible', value: [{ label: week === NEW ? 'Project' : 'Chat', region: 'input area', badge: null }] }],
    changes_vs_previous: changes,
    summary: `This shows the desktop version of Claude for the week of ${week}, before scrolling. The message box stands out most.`,
  };
}
function addCapture(week: string, held = 0) {
  const a = analysis(week, week === NEW ? [{ id: 'N1', status: 'changed', change: 'removed', previous: 'Chat', current: null, region: 'input area' }] : []);
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at, held)
                VALUES (?, ?, 'claude', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757', ?, ?, 'guideline-v1.10.1', ?, ?, 'ok', ?, ?)`)
    .run(`claude-${week}`, week, `shots/${week}/claude.local.png`, a.summary, JSON.stringify(a), `${week}T20:00:00Z`, `${week}T09:00:00Z`, held);
  t.r2.set(`shots/${week}/claude.local.png`, new Uint8Array(200).fill(7));
}

const post = (body: unknown, headers: Record<string, string> = TOKEN) =>
  handleApi(new Request('https://x/api/visual', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), t.env, ctx);
const upload = (o: Record<string, unknown> = {}) => post({ slug: 'claude', week: NEW, previous_week: OLD, alt: ALT, imageBase64: b64(png(1)), ...o });
const img = (key: string, headers: Record<string, string> = {}) => handleImage(new Request(`https://x/img/${key}`, { headers }), t.env);
const weekPage = async (path = `/weeks/${NEW}`) => (await handleWeeks(new Request(`https://x${path}`), t.env)).text();
const portalPage = async (path = `/portals/claude/${NEW}`) => (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();
const setHeld = (week: string, held: number) => { t.db.exec(`UPDATE captures SET held = ${held} WHERE id = 'claude-${week}'`); t.kv.clear(); };
const KEY = visualKey('claude', NEW);

beforeEach(() => {
  t = makeEnv(); // has Claude
  addCapture(OLD);
  addCapture(NEW);
});

describe('migration 0012', () => {
  it('creates the visuals table idempotently, matching schema.sql', () => {
    t.db.exec('DROP TABLE visuals');
    t.db.exec(MIGRATION);
    t.db.exec(MIGRATION);
    const cols = (t.db.prepare('PRAGMA table_info(visuals)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'slug', 'week', 'previous_week', 'r2_key', 'alt', 'width', 'height', 'created_at']);
  });
});

describe('POST /api/visual', () => {
  it('needs the upload token', async () => {
    expect((await post({ slug: 'claude' }, {})).status).toBe(401);
    expect((await post({ slug: 'claude' }, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect(t.r2.has(KEY)).toBe(false);
  });

  it('stores the PNG at visuals/<week>/<slug>.png and records the visual', async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, key: KEY, archived: null, width: 688, height: 394 });
    expect(t.r2.get(KEY)).toEqual(png(1));
    expect(t.db.prepare('SELECT slug, week, previous_week, r2_key, alt FROM visuals').all()).toEqual([
      { slug: 'claude', week: NEW, previous_week: OLD, r2_key: KEY, alt: ALT },
    ]);
  });

  it('refuses a held capture in either week, and stores nothing', async () => {
    for (const week of [NEW, OLD]) {
      setHeld(week, 1);
      const res = await upload();
      expect(res.status).toBe(409);
      expect((await res.json() as { error: string }).error).toContain(`${week} is held`);
      setHeld(week, 0);
    }
    expect(t.r2.has(KEY)).toBe(false);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM visuals').get()).toEqual({ n: 0 });
  });

  it('refuses missing captures, bad input and non-PNG bytes', async () => {
    expect((await upload({ previous_week: '2026-10-26' })).status).toBe(404);
    expect((await upload({ previous_week: NEW })).status).toBe(400);
    expect((await upload({ alt: 'short' })).status).toBe(400);
    expect((await upload({ alt: `${ALT}\nsecond line` })).status).toBe(400);
    expect((await upload({ imageBase64: b64(new Uint8Array(300).fill(1)) })).status).toBe(400);
    expect(t.r2.has(KEY)).toBe(false);
  });

  it('archives a replaced visual first, byte for byte, and never serves the archive', async () => {
    await upload();
    const res = await upload({ imageBase64: b64(png(2)) });
    const { archived } = await res.json() as { archived: string };
    expect(archived).toMatch(new RegExp(`^archive/${KEY.replace(/[./]/g, '\\$&')}\\.\\d{8}T\\d{6}Z\\.png$`));
    expect(t.r2.get(archived)).toEqual(png(1));
    expect(t.r2.get(KEY)).toEqual(png(2));
    expect((await img(archived, TOKEN)).status).toBe(404);
  });

  it('answers 503 with the migration command when the table is missing', async () => {
    t.db.exec('DROP TABLE visuals');
    const res = await upload();
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('npm run db:migrate:visuals:remote');
    expect(t.r2.has(KEY)).toBe(false);
  });
});

describe('GET /img/visuals/…', () => {
  it('serves a recorded visual whose captures are public', async () => {
    await upload();
    const res = await img(KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it('never serves it while either capture is held, not even with the token', async () => {
    await upload();
    for (const week of [NEW, OLD]) {
      setHeld(week, 1);
      expect((await img(KEY)).status).toBe(404);
      expect((await img(KEY, TOKEN)).status).toBe(404);
      setHeld(week, 0);
    }
    expect((await img(KEY)).status).toBe(200);
  });

  it('never serves an unrecorded visuals/ object', async () => {
    t.r2.set('visuals/2026-11-09/stray.png', png(3));
    expect((await img('visuals/2026-11-09/stray.png', TOKEN)).status).toBe(404);
  });

  it('serves no visuals/ object without the table (deployed before the migration)', async () => {
    // The table is dropped before anything looks for it: a found table is remembered per database, as in production.
    t.db.exec('DROP TABLE visuals');
    t.r2.set(KEY, png(1));
    expect((await img(KEY)).status).toBe(404);
    expect((await img(KEY, TOKEN)).status).toBe(404);
  });
});

describe('/weeks/<week>', () => {
  it('shows the visual after the change list and before the links, half the text column on wider screens, opening the lightbox', async () => {
    await upload();
    const html = await weekPage();
    const section = html.match(/<section class="wk-portal" id="claude">[\s\S]*?<\/section>/)![0];
    const figure = section.match(/<figure class="wk-visual">[\s\S]*?<\/figure>/)![0];
    const order = ['<h2>Claude</h2>', 'Compared with the week of', '<ul>', '</ul>', figure, '<p class="wk-links">'].map((x) => section.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(figure).toContain(`alt="${ALT}"`);
    expect(figure).toMatch(new RegExp(`data-full="/img/${KEY}\\?v=\\d+"`));
    expect(figure).toContain('data-lb-group="visuals"');
    expect(html).toContain('.wk-portal .wk-visual{max-width:none');
    expect(html).toContain('@media (min-width:761px){.wk-portal .wk-visual{max-width:50%}}');
    expect(html).toContain('import { initLightbox } from "/lightbox.js"');
  });

  it('lists the visual in the Markdown version', async () => {
    await upload();
    const md = await weekPage(`/weeks/${NEW}.md`);
    expect(md).toMatch(new RegExp(`- Before and after \\(${ALT.replace(/\./g, '\\.')}\\): https://ai-portal-library\\.dev/img/${KEY}\\?v=\\d+`));
  });

  it('is unchanged without a visual: no figure, no lightbox', async () => {
    const html = await weekPage();
    expect(html).toContain('<section class="wk-portal" id="claude">');
    expect(html).not.toContain('wk-visual"');
    expect(html).not.toContain('/lightbox.js');
    expect(await weekPage(`/weeks/${NEW}.md`)).not.toContain('Before and after');
  });

  it('is unchanged without the visuals table (deployed before the migration)', async () => {
    t.db.exec('DROP TABLE visuals');
    t.r2.set(KEY, png(1));
    const res = await handleWeeks(new Request(`https://x/weeks/${NEW}`), t.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<section class="wk-portal" id="claude">');
    expect(html).not.toContain('wk-visual"');
  });

  it('hides the visual while the previous week is held again', async () => {
    await upload();
    setHeld(OLD, 1);
    expect(await weekPage()).not.toContain('wk-visual"');
  });

  it('skips a visual made against a different previous week', async () => {
    await upload();
    t.db.exec(`UPDATE visuals SET previous_week = '2026-10-26'`);
    addCapture('2026-10-26');
    t.kv.clear();
    expect(await weekPage()).not.toContain('wk-visual"');
  });
});

describe('/portals/<slug>/<week>', () => {
  it('shows the visual after the analysis text and before the method link, on the weekly page only', async () => {
    await upload();
    const html = await portalPage();
    const section = html.match(/<section class="analysis">[\s\S]*?<\/section>/)![0];
    const text = section.indexOf('The message box stands out most.</p>');
    const fig = section.indexOf('<figure class="visual">');
    const method = section.indexOf('<p class="method"><a href="/how-we-analyze">How this analysis is made</a>');
    expect(text).toBeGreaterThan(0);
    expect(fig).toBeGreaterThan(text);
    expect(method).toBeGreaterThan(fig);
    expect(section.slice(fig)).toContain(`alt="${ALT}"`);
    expect(html).toContain('@media (min-width:761px){.visual{max-width:50%}}');
    expect(await portalPage('/portals/claude')).not.toContain('<figure class="visual">');
    expect(await portalPage(`/portals/claude/${NEW}.md`)).toContain('- Before and after (');
  });

  it('shows nothing for a held week or an unpublished analysis', async () => {
    await upload();
    setHeld(OLD, 1);
    expect(await portalPage()).not.toContain('<figure class="visual">');
    setHeld(OLD, 0);
    t.db.exec(`UPDATE captures SET analysis_by = 'pending' WHERE id = 'claude-${NEW}'`);
    expect(await portalPage()).not.toContain('<figure class="visual">');
    t.db.exec(`UPDATE captures SET analysis_by = 'guideline-v1.10.1' WHERE id = 'claude-${NEW}'`);
    expect(await portalPage()).toContain('<figure class="visual">');
  });

  it('is unchanged without the visuals table (deployed before the migration)', async () => {
    t.db.exec('DROP TABLE visuals');
    t.r2.set(KEY, png(1));
    const res = await handlePortalPage(new Request(`https://x/portals/claude/${NEW}`), t.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h2>Design analysis</h2>');
    expect(html).not.toContain('<figure class="visual">');
  });
});

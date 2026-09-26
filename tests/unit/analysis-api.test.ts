import { beforeEach, describe, expect, it, vi } from 'vitest';

// capture.ts imports Browser Rendering, which only exists inside the Workers runtime.
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { readFileSync } from 'node:fs';
import { handleApi } from '../../src/api';
import { handlePortalPage } from '../../src/portal-page';
import { CACHE_VERSION } from '../../src/db';
import { makeEnv } from './fake-env';

const SLUG = 'claude';
const WEEK = '2026-09-21';
const ctx = {} as ExecutionContext;

const SENTENCES = [
  'This shows the desktop version of Claude for the week of 2026-09-21, before scrolling.',
  'A narrow sidebar sits on the left and the rest of the screen is open space.',
  'The message box is the largest item on the screen.',
  'The text is dark enough against the background to meet a common accessibility guideline.',
  'Four suggested prompts sit under the message box.',
  'A note under the message box says it can make mistakes.',
];

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    guideline_version: '1.3',
    portal: SLUG,
    week: WEEK,
    variant: 'desktop',
    viewport: '1280x800',
    status: 'ok',
    status_reason: null,
    metrics: [{ id: 'C2', value: '15.3:1', result: 'approx_pass', evidence: 'E1', samples: { foreground: '#1F1F1F', background: '#FFFFFF' } }],
    summary_sentences: SENTENCES.map((text) => ({ text, sources: ['L1'] })),
    summary: SENTENCES.join(' '),
    ...overrides,
  };
}

/** Fixture whose summary is built from the given sentences (keeps summary == joined sentences). */
function withSentences(sentences: string[]) {
  return fixture({ summary_sentences: sentences.map((text) => ({ text, sources: ['L1'] })), summary: sentences.join(' ') });
}

function post(env: unknown, body: unknown, token = 'test-token') {
  const req = new Request('https://x/api/analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return handleApi(req, env as never, ctx);
}

let t: ReturnType<typeof makeEnv>;

beforeEach(() => {
  t = makeEnv();
  t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${WEEK}', 'Week of Sep 21, 2026', '2026-09-21T00:00:00Z')`);
  t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
             VALUES ('${SLUG}-${WEEK}', '${WEEK}', '${SLUG}', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757',
                     'shots/${WEEK}/${SLUG}.local.png', '', 'pending', '2026-09-21T09:00:00Z')`);
});

const row = () => t.db.prepare(`SELECT analysis, analysis_by, analysis_json, analysis_version FROM captures WHERE id = ?`).get(`${SLUG}-${WEEK}`) as Record<string, string | null>;

describe('POST /api/analysis', () => {
  it('accepts a valid analysis, stores it and busts the week caches', async () => {
    t.kv.set(`${CACHE_VERSION}:cache:captures:${WEEK}`, '{}');
    const res = await post(t.env, { slug: SLUG, week: WEEK, analysis: fixture() });
    expect(res.status).toBe(200);
    const r = row();
    expect(r.analysis).toBe(SENTENCES.join(' '));
    expect(r.analysis_by).toBe('guideline-v1.3');
    expect(r.analysis_version).toBe('1.3');
    expect(JSON.parse(r.analysis_json!)).toEqual(fixture());
    expect(t.kv.has(`${CACHE_VERSION}:cache:captures:${WEEK}`)).toBe(false);
  });

  it('stores not_analyzable with an empty public analysis', async () => {
    const res = await post(t.env, { slug: SLUG, week: WEEK, analysis: fixture({ status: 'not_analyzable', status_reason: 'login page', summary: '', summary_sentences: [] }) });
    expect(res.status).toBe(200);
    expect(row().analysis).toBe('');
    expect(row().analysis_by).toBe('not_analyzable');
  });

  it('rejects a non-English summary', async () => {
    const res = await post(t.env, { slug: SLUG, week: WEEK, analysis: withSentences([...SENTENCES.slice(0, 5), 'The greeting says 你好 at the top.']) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/plain English/);
    expect(row().analysis_by).toBe('pending');
  });

  it('rejects metric IDs in the summary', async () => {
    const res = await post(t.env, { slug: SLUG, week: WEEK, analysis: withSentences([...SENTENCES.slice(0, 5), 'The contrast in C2 is high.']) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/metric ID/);
  });

  it('rejects a portal mismatch', async () => {
    const res = await post(t.env, { slug: SLUG, week: WEEK, analysis: fixture({ portal: 'chatgpt' }) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/does not match slug/);
  });

  it('returns 404 when no capture row exists', async () => {
    const res = await post(t.env, { slug: SLUG, week: '2026-09-14', analysis: fixture({ week: '2026-09-14' }) });
    expect(res.status).toBe(404);
  });

  it('rejects a bad token', async () => {
    const res = await post(t.env, { slug: SLUG, week: WEEK, analysis: fixture() }, 'wrong');
    expect(res.status).toBe(401);
    expect(row().analysis_by).toBe('pending');
  });
});

describe('analysis_json privacy and upload reset', () => {
  it('GET /api/analysis returns the stored JSON; /api/captures never exposes it', async () => {
    await post(t.env, { slug: SLUG, week: WEEK, analysis: fixture() });
    const get = await handleApi(new Request(`https://x/api/analysis?slug=${SLUG}&week=${WEEK}`, { headers: { authorization: 'Bearer test-token' } }), t.env, ctx);
    expect((await get.json() as { analysis: unknown }).analysis).toEqual(fixture());

    const pub = await (await handleApi(new Request(`https://x/api/captures?week=${WEEK}`), t.env, ctx)).text();
    expect(pub).not.toContain('analysis_json');
    expect(pub).not.toContain('approx_pass');
  });

  it('a desktop upload resets analysis to pending; a mobile upload leaves it alone', async () => {
    await post(t.env, { slug: SLUG, week: WEEK, analysis: fixture() });
    const upload = (variant: string) => handleApi(new Request('https://x/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ slug: SLUG, week: WEEK, variant, imageBase64: Buffer.alloc(200, 1).toString('base64') }),
    }), t.env, ctx);

    expect((await upload('mobile')).status).toBe(200);
    expect(row().analysis_by).toBe('guideline-v1.3');

    expect((await upload('desktop')).status).toBe(200);
    expect(row()).toEqual({ analysis: '', analysis_by: 'pending', analysis_json: null, analysis_version: null });
  });
});

describe('system-test weeks (migration 0007)', () => {
  const NOTE = 'This week was captured during early system testing. The screenshots may not show the real product, so there is no design analysis.';
  const TEST_WEEK = '2026-08-03';

  beforeEach(() => {
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${TEST_WEEK}', 'Week of Aug 3, 2026', '2026-08-03T00:00:00Z')`);
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
               VALUES ('${SLUG}-${TEST_WEEK}', '${TEST_WEEK}', '${SLUG}', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757',
                       'shots/${TEST_WEEK}/${SLUG}.local.png', 'Old free-text analysis.', 'workers-ai', '2026-08-03T09:00:00Z')`);
    t.db.exec(readFileSync(new URL('../../migrations/0007_mark_system_test_weeks.sql', import.meta.url), 'utf8'));
  });

  it('marks only the listed weeks and keeps their screenshots', () => {
    const marked = t.db.prepare(`SELECT analysis, analysis_by, r2_key FROM captures WHERE id = ?`).get(`${SLUG}-${TEST_WEEK}`) as Record<string, string>;
    expect(marked).toEqual({ analysis: NOTE, analysis_by: 'system-test', r2_key: `shots/${TEST_WEEK}/${SLUG}.local.png` });
    expect(row().analysis_by).toBe('pending'); // 2026-09-21 is untouched
  });

  it('shows the note on the portal page but leaves it out of the meta description', async () => {
    const res = await handlePortalPage(new Request(`https://x/portals/${SLUG}/${TEST_WEEK}`), t.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<h2>Design analysis</h2><p>${NOTE}</p>`);
    const meta = html.match(/<meta name="description" content="([^"]*)"/)![1];
    expect(meta).not.toContain('system testing');
    expect(meta).toBe('Claude by Anthropic: logged-in interface screenshots, desktop and mobile, captured the week of 2026-08-03, with design analysis.');
  });
});

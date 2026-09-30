import { beforeEach, describe, expect, it } from 'vitest';
import { handleSitemap, ORIGIN, HOW_WE_ANALYZE_UPDATED, PRIVACY_UPDATED_DATE, PRIVACY_UPDATED } from '../../src/portal-page';
import { handleApi } from '../../src/api';
import { makeEnv } from './fake-env';

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

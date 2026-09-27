import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { analyticsAllowed } from '../../src/consent';
import {
  QUESTION_LOG_CRON, QUESTION_LOG_HEADER, REMOVED,
  logQuestion, purgeOldQuestions, scrubQuestion, withQuestionLogPermission,
} from '../../src/question-log';
import { handlePrivacy } from '../../src/portal-page';
import { makeEnv } from './fake-env';
import { csvCell, parseWranglerJson, QUERY, toCsv } from '../../scripts/local-capture/export-questions.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');
const ROOM = '0b6f3c2e-8f1a-4c3d-9e2b-7a5d4c3b2a19';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = 24 * 60 * 60 * 1000;

/** The voice WebSocket request as the Worker receives it. `country` undefined means no cf.country. */
function voiceReq(o: { analytics?: string; country?: string; gpc?: boolean; headers?: Record<string, string> } = {}): Request {
  const url = new URL(`https://x/agents/portal-voice-agent/${ROOM}`);
  if (o.analytics !== undefined) url.searchParams.set('analytics', o.analytics);
  const headers = new Headers({ upgrade: 'websocket', ...o.headers });
  if (o.gpc) headers.set('sec-gpc', '1');
  const r = new Request(url, { headers });
  if (o.country !== undefined) Object.defineProperty(r, 'cf', { value: { country: o.country } });
  return r;
}

let t: ReturnType<typeof makeEnv>;
beforeEach(() => { t = makeEnv(); });
const rows = () => t.db.prepare('SELECT * FROM question_log ORDER BY question').all() as Record<string, unknown>[];

describe('permission: the same rules as Google Analytics and Clarity', () => {
  it.each([
    // [browser reports, country, GPC header, logged]
    ['accepted', 'US', false, true],   // stored Accept
    ['declined', 'US', false, false],  // a US visitor who declined
    ['default', 'US', false, true],    // no stored choice, outside the consent region: on by default
    ['accepted', 'DE', false, true],   // consent region, after Accept
    ['declined', 'DE', false, false],
    ['default', 'DE', false, false],   // consent region, not yet asked or never answered
    ['default', 'GB', false, false],
    ['default', 'CH', false, false],
    ['default', undefined, false, false], // country unknown: treated as a consent region
    ['default', 'XX', false, false],
    ['off', 'US', false, false],       // the browser has Global Privacy Control on
    ['accepted', 'US', true, false],   // Sec-GPC always wins, even over a stored Accept
    ['default', 'US', true, false],
    [undefined, 'US', false, false],   // no report at all (old page, consent.js missing)
    ['yes', 'US', false, false],       // anything unexpected
    ['ACCEPTED', 'US', false, false],
  ] as const)('browser says %s, country %s, GPC header %s -> logged: %s', (analytics, country, gpc, logged) => {
    expect(analyticsAllowed(voiceReq({ analytics, country, gpc }))).toBe(logged);
  });

  it('a client can only turn logging off: in a consent region only a stored Accept turns it on', () => {
    for (const analytics of ['default', 'declined', 'off', '', 'true', '1', 'granted']) {
      expect(analyticsAllowed(voiceReq({ analytics, country: 'DE' })), analytics).toBe(false);
    }
  });

  it('the Worker sets the header for the Durable Object itself and drops one sent by the client', () => {
    const spoofed = withQuestionLogPermission(voiceReq({ analytics: 'declined', country: 'US', headers: { [QUESTION_LOG_HEADER]: '1' } }));
    expect(spoofed.headers.get(QUESTION_LOG_HEADER)).toBeNull();
    const deDefault = withQuestionLogPermission(voiceReq({ analytics: 'default', country: 'DE', headers: { [QUESTION_LOG_HEADER]: '1' } }));
    expect(deDefault.headers.get(QUESTION_LOG_HEADER)).toBeNull();
    const ok = withQuestionLogPermission(voiceReq({ analytics: 'accepted', country: 'DE' }));
    expect(ok.headers.get(QUESTION_LOG_HEADER)).toBe('1');
    // The rest of the WebSocket request is untouched.
    expect(ok.url).toBe(voiceReq({ analytics: 'accepted' }).url);
    expect(ok.headers.get('upgrade')).toBe('websocket');
  });

  it('is wired: Worker -> Durable Object connection state -> logQuestion', () => {
    const index = read('src/index.ts');
    expect(index).toContain('await routeAgentRequest(withQuestionLogPermission(request), env)');
    const voice = read('src/voice.ts');
    expect(voice).toContain('connection.setState({ logQuestions: ctx.request.headers.get(QUESTION_LOG_HEADER) === "1" });');
    expect(voice).toContain('const allowed = (context.connection.state as { logQuestions?: boolean } | null)?.logQuestions === true;');
    // Questions only: one call, with the user's transcript; never the answer.
    expect(voice.match(/logQuestion\(/g)).toHaveLength(1);
    expect(voice).toContain('logQuestion(this.env, allowed, transcript, spoken ? "voice" : "typed")');
  });
});

describe('logQuestion', () => {
  it('stores nothing without permission', async () => {
    await logQuestion(t.env, false, 'Which portals do you track?', 'typed');
    await logQuestion(t.env, false, 'What about Claude?', 'voice');
    expect(rows()).toEqual([]);
  });

  it('stores only a random id, the date, the input type and the scrubbed question', async () => {
    const now = Date.UTC(2026, 8, 27, 23, 59, 30);
    await logQuestion(t.env, true, 'Email me at jane.doe@example.com about Claude', 'typed', now);
    await logQuestion(t.env, true, 'What colour is Gemini?', 'voice', now);
    const stored = rows();
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(Object.keys(row).sort()).toEqual(['day', 'id', 'input', 'question']);
      expect(row.id).toMatch(UUID);
      expect(row.day).toBe('2026-09-27');
    }
    expect(stored.map((r) => [r.input, r.question])).toEqual([
      ['typed', `Email me at ${REMOVED} about Claude`],
      ['voice', 'What colour is Gemini?'],
    ]);
    expect(stored[0].id).not.toBe(stored[1].id);
  });

  it('skips a question that is empty after scrubbing', async () => {
    await logQuestion(t.env, true, '   ', 'typed');
    expect(rows()).toEqual([]);
  });
});

describe('scrubbing', () => {
  it.each([
    ['write to jane.doe+ai@mail.example.co.uk please', `write to ${REMOVED} please`],
    ['JOHN_SMITH@EXAMPLE.ORG', REMOVED],
    ['call +1 (415) 555-0123 tomorrow', `call ${REMOVED} tomorrow`],
    ['my number is 0912-345-678', `my number is ${REMOVED}`],
    ['or 020 7946 0958', `or ${REMOVED}`],
    ['(02) 2345.6789', REMOVED],
    ['order 123456 and 9876543210', `order ${REMOVED} and ${REMOVED}`],
    ['card 4111111111111111', `card ${REMOVED}`],
    ['id12345678x', `id${REMOVED}x`],
  ])('%s', (input, output) => {
    expect(scrubQuestion(input)).toBe(output);
  });

  it('keeps ordinary numbers and text', () => {
    for (const q of [
      'Compare GPT-4o and Claude 3.5 in 2026',
      'What changed in the top 10 portals since week 12?',
      'Is #d97757 the Claude brand colour?',
      'Show 12345 results',
      'What does @anthropic post?',
    ]) expect(scrubQuestion(q)).toBe(q);
  });

  it('caps the question at 1,000 characters, after scrubbing', () => {
    expect(scrubQuestion('a'.repeat(5000))).toHaveLength(1000);
    const q = scrubQuestion(`${'b'.repeat(995)} 1234567890`);
    expect(q).toBe(`${'b'.repeat(995)} [rem`);
    expect(q).not.toMatch(/\d/);
  });
});

describe('table', () => {
  const columns = (sql: string) => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    return (db.prepare("SELECT name FROM pragma_table_info('question_log') ORDER BY cid").all() as { name: string }[]).map((c) => c.name);
  };

  it('has no identifying columns, in the migration and in schema.sql', () => {
    const migration = read('migrations/0008_question_log.sql');
    expect(columns(migration)).toEqual(['id', 'day', 'input', 'question']);
    expect(columns(read('schema.sql'))).toEqual(['id', 'day', 'input', 'question']);
    for (const sql of [migration, read('src/question-log.ts')]) {
      expect(sql).not.toMatch(/\b(room|ip|user_agent|country|session|created_at|timestamp|connection_id)\b\s+(TEXT|INTEGER)/i);
    }
  });

  it('accepts only "typed" or "voice"', () => {
    expect(() => t.db.exec(`INSERT INTO question_log (id, day, input, question) VALUES ('x', '2026-09-27', 'chat', 'q')`)).toThrow();
  });

  it('has a script to apply only this migration, and no public API reads it', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['db:migrate:question-log:remote']).toBe('wrangler d1 execute ai-portal-library --remote --file=./migrations/0008_question_log.sql');
    for (const f of ['src/api.ts', 'src/db.ts', 'src/homepage.ts', 'src/portal-page.ts']) expect(read(f), f).not.toContain('question_log');
  });
});

describe('retention cron', () => {
  const now = Date.UTC(2026, 8, 27, 3, 30);
  const insert = (id: string, daysAgo: number) =>
    t.db.exec(`INSERT INTO question_log (id, day, input, question) VALUES ('${id}', '${new Date(now - daysAgo * DAY).toISOString().slice(0, 10)}', 'typed', 'q')`);

  it('deletes only rows older than 360 days', async () => {
    for (const d of [0, 1, 359, 360, 361, 400]) insert(`d${d}`, d);
    await purgeOldQuestions(t.env, now);
    expect((t.db.prepare('SELECT id FROM question_log ORDER BY day DESC').all() as { id: string }[]).map((r) => r.id))
      .toEqual(['d0', 'd1', 'd359', 'd360']);
  });

  it('runs daily from wrangler.jsonc, alongside the weekly capture', () => {
    expect(QUESTION_LOG_CRON).toBe('30 3 * * *');
    for (const f of ['wrangler.jsonc', 'wrangler.dev.jsonc']) {
      expect(read(f).replace(/\s+/g, ''), f).toContain('"crons":["09**1","303***"]');
    }
    const index = read('src/index.ts');
    const branch = index.indexOf('if (event.cron === QUESTION_LOG_CRON) {\n      ctx.waitUntil(purgeOldQuestions(env));\n      return;\n    }');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(index.indexOf('env.CAPTURE_WORKFLOW.create'));
  });
});

describe('export script', () => {
  it('runs one fixed SELECT and writes into a gitignored folder', () => {
    expect(QUERY).toBe('SELECT day, input, question FROM question_log ORDER BY day, id');
    const src = read('scripts/local-capture/export-questions.mjs');
    expect(src).not.toMatch(/process\.argv\[2\]|\b(INSERT|UPDATE|DELETE|DROP)\b/);
    expect(src).toContain('{ flag: "wx" }');
    expect(read('scripts/local-capture/.gitignore').split('\n')).toContain('question-exports/');
  });

  it('writes safe CSV', () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsv(parseWranglerJson(JSON.stringify([{ success: true, results: [{ day: '2026-09-27', input: 'voice', question: 'a\nb' }] }]))))
      .toBe('day,input,question\r\n"2026-09-27","voice","a\nb"\r\n');
    expect(() => parseWranglerJson(JSON.stringify([{ success: false }]))).toThrow();
  });
});

describe('/privacy', () => {
  it('explains the question log and keeps the advice about personal information', async () => {
    const html = await (await handlePrivacy(voiceReq({ country: 'US' }))).text();
    const text = html.match(/<main class="howto">([\s\S]*?)<\/main>/)![1].replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
    expect(text).toContain('Last updated: September 27, 2026');
    expect(text).toContain('If analytics are allowed for you (see "When Google Analytics and Clarity load" above), the text of your questions, not the answers and not your voice, is also saved in a separate log that has no link to you or your conversation. Email addresses, phone numbers and long numbers are removed first. Only the date is kept, not the time. Entries are deleted after 360 days. The log is used only to improve the library.');
    expect(text).toContain("Please don't include personal information, such as your name, email address or phone number, in your questions.");
    expect(text).toContain('It is deleted 24 hours after your last message.');
  });
});

// ---- browser: what public/voice.js reports, and what the server then decides ----

describe('in the browser', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  type Opts = { country: string; gpc?: boolean; stored?: 'accepted' | 'declined' };
  const mode = (country: string) => (['DE', 'GB', 'CH'].includes(country) ? 'required' : 'not-required');

  async function visit(o: Opts): Promise<{ context: BrowserContext; page: import('playwright').Page; sockets: URL[] }> {
    const html = read('public/index.html').replace('<html lang="en"', `<html data-consent="${mode(o.country)}" lang="en"`);
    const context = await browser.newContext();
    if (o.gpc) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    if (o.stored) await context.addInitScript((v) => { if (!localStorage.getItem('analytics-consent')) localStorage.setItem('analytics-consent', v); }, o.stored);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== 'site.test') return route.fulfill({ contentType: 'text/javascript', body: '' }); // GA / Clarity stubs
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/app.js' || url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' });
      try { return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(new URL(`public${url.pathname}`, ROOT)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const sockets: URL[] = [];
    await context.routeWebSocket(/\/agents\//, (ws) => { sockets.push(new URL(ws.url())); });
    const page = await context.newPage();
    await page.goto('https://site.test/');
    await page.getByRole('button', { name: 'Talk to the library' }).click();
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    return { context, page, sockets };
  }

  /** The server's decision for a socket the browser opened, as a visitor from `country`. */
  const decide = (url: URL, o: Opts) => analyticsAllowed(voiceReq({ analytics: url.searchParams.get('analytics') ?? undefined, country: o.country, gpc: o.gpc }));

  it.each([
    [{ country: 'US' }, 'default', true],
    [{ country: 'US', stored: 'declined' }, 'declined', false],
    [{ country: 'US', stored: 'accepted' }, 'accepted', true],
    [{ country: 'DE' }, 'default', false],
    [{ country: 'DE', stored: 'accepted' }, 'accepted', true],
    [{ country: 'DE', stored: 'declined' }, 'declined', false],
    [{ country: 'US', gpc: true }, 'off', false],
    [{ country: 'US', gpc: true, stored: 'accepted' }, 'off', false],
  ] as const)('%o: reports %s, logged: %s', async (o, reported, logged) => {
    const { context, sockets } = await visit(o as Opts);
    expect(sockets[0].searchParams.get('analytics')).toBe(reported);
    expect(decide(sockets[0], o as Opts)).toBe(logged);
    await context.close();
  });

  it('in a consent region, logging starts only after Accept, on a new connection to the same room', async () => {
    const o = { country: 'DE' } as const;
    const { context, page, sockets } = await visit(o);
    expect(decide(sockets[0], o)).toBe(false);
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => sockets.length).toBe(2);
    expect(sockets[1].searchParams.get('analytics')).toBe('accepted');
    expect(sockets[1].pathname).toBe(sockets[0].pathname);
    expect(decide(sockets[1], o)).toBe(true);
    await context.close();
  });

  it('a US visitor who declines in Cookie preferences stops being logged', async () => {
    const o = { country: 'US' } as const;
    const { context, page, sockets } = await visit(o);
    expect(decide(sockets[0], o)).toBe(true);
    await page.locator('#vpClose').click();
    await page.locator('[data-consent-open]').first().click();
    await page.getByRole('button', { name: 'Decline' }).click();
    await expect.poll(() => sockets.length).toBe(2);
    expect(sockets[1].searchParams.get('analytics')).toBe('declined');
    expect(decide(sockets[1], o)).toBe(false);
    await context.close();
  });
});

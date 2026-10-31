import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../../src/api';
import { captureMetrics } from '../../src/capture-metrics';
import { publishedCaptures } from '../../src/db';
import { handleFacts } from '../../src/facts-page';
import { handleChanges, handleHowWeAnalyze, handlePortalPage, handleSitemap } from '../../src/portal-page';
import { handleWeeks } from '../../src/week-page';
import { handleComparePage } from '../../src/compare-page';
import { handleLlmsFullTxt } from '../../src/aeo';
import { PLAN_CHANGE_NOTE, planChange } from '../../src/plan';
import { PLAN_CHANGE_NOTE as CANVAS_NOTE, compareFindings, findingsCellHTML, planNote, tableFindings } from '../../public/analytics-canvas.js';
import { DEFAULT_PLAN, PLANS, PORTAL_PLANS, planFor } from '../../scripts/local-capture/config.mjs';
import { makeEnv } from './fake-env';

// The account plan of each capture (src/plan.ts, migration 0010) and plan changes as confounders.

const ORIGIN = 'https://ai-portal-library.dev';
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const MIGRATION = readFileSync(new URL('../../migrations/0010_capture_plan.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const CAPTURE_MJS = readFileSync(new URL('../../scripts/local-capture/capture.mjs', import.meta.url), 'utf8');
const PREPARE_MJS = readFileSync(new URL('../../scripts/local-capture/analysis/prepare.mjs', import.meta.url), 'utf8');
const SKILL = readFileSync(new URL('../../.claude/skills/portal-design-analysis/SKILL.md', import.meta.url), 'utf8');

describe('migration 0010: backfill', () => {
  it('adds the column and sets Claude Pro, Grok Pro from 2026-10-19, Copilot Enterprise from 2026-08-24, the rest Free', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    db.exec('ALTER TABLE captures DROP COLUMN plan'); // the schema before the migration
    for (const slug of ['claude', 'grok', 'copilot', 'chatgpt', 'kimi']) db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('${slug}', '${slug}', 'Co', 'https://x/', '#000')`);
    const weeks = ['2026-08-17', '2026-08-24', '2026-10-12', '2026-10-19', '2026-10-26'];
    for (const w of weeks) db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${w}', '${w}', '${w}')`);
    const insert = db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, analysis, analysis_by, captured_at) VALUES (?, ?, ?, ?, 'Co', 'https://x/', '#000', 'A summary.', 'guideline-v1.7.1', ?)`);
    for (const slug of ['claude', 'grok', 'copilot', 'chatgpt', 'kimi']) for (const w of weeks) insert.run(`${slug}-${w}`, w, slug, slug, w);
    db.exec(MIGRATION);
    const plan = (slug: string, week: string) => (db.prepare('SELECT plan FROM captures WHERE id = ?').get(`${slug}-${week}`) as { plan: string }).plan;
    const before = db.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number };
    expect(weeks.map((w) => plan('claude', w))).toEqual(['Pro', 'Pro', 'Pro', 'Pro', 'Pro']);
    expect(weeks.map((w) => plan('grok', w))).toEqual(['Free', 'Free', 'Free', 'Pro', 'Pro']);
    expect(weeks.map((w) => plan('copilot', w))).toEqual(['Free', 'Enterprise', 'Enterprise', 'Enterprise', 'Enterprise']);
    for (const slug of ['chatgpt', 'kimi']) expect(weeks.map((w) => plan(slug, w))).toEqual(Array(5).fill('Free'));
    // Only the plan is set: every other column is untouched.
    expect((db.prepare(`SELECT analysis, analysis_by, r2_key FROM captures WHERE id = 'grok-2026-10-19'`).get())).toEqual({ analysis: 'A summary.', analysis_by: 'guideline-v1.7.1', r2_key: null });
    expect(before.n).toBe(25);
  });

  it('only adds a column and updates plans', () => {
    const statements = MIGRATION.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements[0]).toBe('ALTER TABLE captures ADD COLUMN plan TEXT');
    for (const s of statements.slice(1)) expect(s).toMatch(/^UPDATE captures SET plan = /);
  });
});

describe('local capture config', () => {
  it('has the current plan per portal, Free by default', () => {
    expect(PLANS).toEqual(['Free', 'Pro', 'Enterprise']);
    expect(DEFAULT_PLAN).toBe('Free');
    expect(PORTAL_PLANS).toEqual({ claude: 'Pro', grok: 'Pro', copilot: 'Enterprise' });
    expect(['claude', 'grok', 'copilot', 'chatgpt', 'gemini', 'kimi', 'new-portal'].map(planFor)).toEqual(['Pro', 'Pro', 'Enterprise', 'Free', 'Free', 'Free', 'Free']);
  });

  it('sends the plan with every upload, and prepare.mjs passes both weeks\' plans to the analysis', () => {
    expect(CAPTURE_MJS).toContain('plan: planFor(slug)');
    expect(PREPARE_MJS).toContain('plan: current.plan ?? null, previous_plan: previous?.plan ?? null');
  });
});

let t: ReturnType<typeof makeEnv>;

const item = (label: string, region = 'sidebar') => ({ label, region, badge: null });
const change = (o: Record<string, unknown>) => ({ id: 'N1', status: 'changed', region: 'sidebar', ...o });
function analysis(slug: string, week: string, previous: string | null, changes: unknown[] = [], n1 = [item('Home')]) {
  return {
    guideline_version: '1.7.1', portal: slug, week, previous_week: previous, variant: 'desktop', status: 'ok',
    context: { color_scheme: 'dark' },
    metrics: [{ id: 'N1', sidebar: 'visible', value: n1 }, { id: 'L2', value: '20%' }],
    changes_vs_previous: changes,
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`,
  };
}
function addCapture(slug: string, week: string, plan: string | null, a: unknown) {
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at, plan)
                VALUES (?, ?, ?, ?, 'Co', 'https://example.com/', '#000000', ?, ?, 'guideline-v1.7.1', ?, ?, 'ok', ?, ?)`)
    .run(`${slug}-${week}`, week, slug, slug, `shots/${week}/${slug}.local.png`, (a as { summary: string }).summary, JSON.stringify(a), `${week}T20:00:00Z`, `${week}T09:00:00Z`, plan);
}

beforeEach(() => {
  t = makeEnv(); // has Claude
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES
    ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0),
    ('copilot', 'Microsoft Copilot', 'Microsoft', 'https://copilot.microsoft.com/', '#0078d4', 4),
    ('grok', 'Grok', 'xAI', 'https://grok.com/', '#000000', 6)`);
  // Copilot: Free on 08-17, Enterprise from 08-24 (its rename that week is not a product change), a real change on 08-31.
  addCapture('copilot', '2026-08-17', 'Free', analysis('copilot', '2026-08-17', null));
  addCapture('copilot', '2026-08-24', 'Enterprise', analysis('copilot', '2026-08-24', '2026-08-17', [change({ change: 'renamed', previous: 'Discover', current: 'Labs' })]));
  addCapture('copilot', '2026-08-31', 'Enterprise', analysis('copilot', '2026-08-31', '2026-08-24', [change({ change: 'added', previous: null, current: 'Pages' })]));
  // Grok: Free on 10-12, Pro from 10-19 (an added and a removed item recorded that week; its menu gains Imagine).
  addCapture('grok', '2026-10-12', 'Free', analysis('grok', '2026-10-12', null));
  addCapture('grok', '2026-10-19', 'Pro', analysis('grok', '2026-10-19', '2026-10-12', [
    change({ change: 'added', previous: null, current: 'SuperGrok' }),
    change({ change: 'removed', previous: 'Upgrade', current: null, region: 'top bar' }),
  ], [item('Home'), item('Imagine')]));
  // ChatGPT: Free both weeks, with a real change on 10-19.
  addCapture('chatgpt', '2026-10-12', 'Free', analysis('chatgpt', '2026-10-12', null));
  addCapture('chatgpt', '2026-10-19', 'Free', analysis('chatgpt', '2026-10-19', '2026-10-12', [change({ change: 'renamed', previous: 'More', current: 'Explore' })]));
});

const text = async (res: Response | Promise<Response>) => (await res).text();
const portal = (path: string) => text(handlePortalPage(new Request(`${ORIGIN}${path}`), t.env));

describe('plan changes (src/plan.ts)', () => {
  it('words the reason with both plans, and ignores unknown or equal plans', () => {
    expect(planChange('Free', 'Pro')).toEqual({ from: 'Free', to: 'Pro', status: 'possibly_confounded', reason: 'account plan changed (Free → Pro)' });
    expect(planChange('Pro', 'Pro')).toBeNull();
    expect(planChange(null, 'Pro')).toBeNull();
    expect(planChange('Free', 'Team')).toBeNull();
    expect(CANVAS_NOTE).toBe(PLAN_CHANGE_NOTE);
    expect(PLAN_CHANGE_NOTE).toBe("This week's differences may come from the account plan change, not a product update.");
  });

  it('captureMetrics marks Grok 10-19 and Copilot 08-24 possibly confounded and drops their menu changes', async () => {
    const rows = await publishedCaptures(t.env);
    const m = (slug: string, week: string) => captureMetrics(rows.find((r) => r.slug === slug && r.week === week)!)!;
    expect(m('grok', '2026-10-19').planChange?.reason).toBe('account plan changed (Free → Pro)');
    expect(m('grok', '2026-10-19').navChanges).toEqual({ previousWeek: '2026-10-12', items: [] });
    expect(m('grok', '2026-10-19').plan).toBe('Pro');
    expect(m('copilot', '2026-08-24').planChange?.reason).toBe('account plan changed (Free → Enterprise)');
    expect(m('copilot', '2026-08-24').navChanges?.items).toEqual([]);
    // Same plan as the week before: changes are kept.
    expect(m('copilot', '2026-08-31').planChange).toBeNull();
    expect(m('copilot', '2026-08-31').navChanges?.items).toHaveLength(1);
    expect(m('chatgpt', '2026-10-19').navChanges?.items).toHaveLength(1);
  });

  it('/api/captures returns each capture\'s plan and plan change', async () => {
    const body = JSON.parse(await text(handleApi(new Request(`${ORIGIN}/api/captures?week=2026-10-19`), t.env, ctx))) as { captures: { slug: string; plan: string; metrics: { plan: string; planChange: unknown } }[] };
    const grok = body.captures.find((c) => c.slug === 'grok')!;
    expect(grok.plan).toBe('Pro');
    expect(grok.metrics.plan).toBe('Pro');
    expect(grok.metrics.planChange).toMatchObject({ from: 'Free', to: 'Pro' });
    expect(body.captures.find((c) => c.slug === 'chatgpt')!.metrics.planChange).toBeNull();
  });
});

describe('surfaces', () => {
  it('portal timeline: a muted plan-change line, not the week\'s changes', async () => {
    const grok = await portal('/portals/grok');
    expect(grok).toContain(`<li class="plan-note"><a href="/portals/grok/2026-10-19">October 19, 2026</a> — ${PLAN_CHANGE_NOTE.replace(/'/g, '&#39;')}</li>`);
    expect(grok).not.toContain('SuperGrok');
    const copilot = await portal('/portals/copilot');
    expect(copilot).toContain('<a href="/portals/copilot/2026-08-31">August 31, 2026</a> — Pages added to the side menu</li>');
    expect(copilot).toContain('<li class="plan-note"><a href="/portals/copilot/2026-08-24">August 24, 2026</a>');
    expect(copilot).not.toContain('Labs');
    const md = await portal('/portals/grok.md');
    expect(md).toContain(`- [October 19, 2026](${ORIGIN}/portals/grok/2026-10-19) — ${PLAN_CHANGE_NOTE}`);
  });

  it('weekly portal page Markdown: the note instead of menu changes', async () => {
    const md = await portal('/portals/grok/2026-10-19.md');
    expect(md).toContain(`## Menu changes\n\nCompared with the week of October 12, 2026: ${PLAN_CHANGE_NOTE}`);
    expect(md).not.toContain('SuperGrok');
  });

  it('weekly digest: a muted note for the portal, its changes not counted', async () => {
    const page = await text(handleWeeks(new Request(`${ORIGIN}/weeks/2026-10-19`), t.env));
    expect(page).toContain(`<p class="wk-plan"><a href="/portals/grok/2026-10-19">Grok</a>: ${PLAN_CHANGE_NOTE.replace(/'/g, '&#39;')}</p>`);
    expect(page).not.toContain('SuperGrok');
    expect(page).toContain('1 of them had menu changes'); // ChatGPT only
    expect(page).not.toMatch(/No recorded menu changes:[^<]*<a href="\/portals\/grok/);
    const copilot = await text(handleWeeks(new Request(`${ORIGIN}/weeks/2026-08-24`), t.env));
    expect(copilot).toContain('<p class="wk-plan"><a href="/portals/copilot/2026-08-24">Microsoft Copilot</a>: ');
    expect(copilot).toContain('No menu changes were recorded');
    const md = await text(handleWeeks(new Request(`${ORIGIN}/weeks/2026-10-19.md`), t.env));
    expect(md).toContain(`Grok: ${PLAN_CHANGE_NOTE}`);
  });

  it('/changes: leaves out both plan-change weeks', async () => {
    const page = await text(handleChanges(new Request(`${ORIGIN}/changes`), t.env));
    expect(page).not.toContain('SuperGrok');
    expect(page).not.toContain('Labs');
    expect(page).toContain('Microsoft Copilot: a new Pages item appears in the side menu.');
    expect(page).toContain('ChatGPT: the More item in the side menu is now labeled Explore.');
  });

  it('/facts: no plan-change week as the latest menu change', async () => {
    const page = await text(handleFacts(new Request(`${ORIGIN}/facts`), t.env));
    const entry = (id: string) => page.match(new RegExp(`<li class="fx-entry" id="${id}">[\\s\\S]*?</li>(?=\\n      </?(?:li|ol))`))![0];
    expect(entry('grok')).toContain('<strong>Menu changes:</strong> No menu changes recorded yet.');
    expect(entry('copilot')).toContain('Week of August 31, 2026: Pages added to the side menu.');
  });

  it('/compare pages: their latest menu changes skip the plan-change weeks', async () => {
    const page = await text(handleComparePage(new Request(`${ORIGIN}/compare/copilot-vs-grok`), t.env));
    expect(page).toContain('No menu changes have been recorded for Grok yet.');
    expect(page).toContain('Week of <a href="/portals/copilot/2026-08-31">August 31, 2026</a>');
    expect(page).not.toContain('SuperGrok');
    expect(page).not.toContain('Labs');
  });

  it('llms-full.txt: the note instead of the menu changes', async () => {
    const txt = await text(handleLlmsFullTxt(new Request(`${ORIGIN}/llms-full.txt`), t.env));
    expect(txt).toContain(`Compared with the week of October 12, 2026: ${PLAN_CHANGE_NOTE}`);
    expect(txt).not.toContain('SuperGrok');
  });

  it('Compare table and canvas: the note with the differences of two weeks on different plans', async () => {
    const rows = await publishedCaptures(t.env);
    const card = (slug: string, week: string) => {
      const r = rows.find((x) => x.slug === slug && x.week === week)!;
      return { label: week, slug, week, metrics: captureMetrics(r) };
    };
    const [newer, older] = [card('grok', '2026-10-19'), card('grok', '2026-10-12')];
    // Grok's recorded changes are dropped, so the item lists are compared instead, with the note.
    expect(planNote(newer, older)).toBe(PLAN_CHANGE_NOTE);
    const f = tableFindings(newer, older)!;
    expect(f.note).toBe(PLAN_CHANGE_NOTE);
    // The menus are compared as lists, not as recorded product changes.
    expect(f.differences[0]).toBe('Only on Oct 19: Imagine (in the side menu).');
    expect(f.differences.join(' ')).not.toMatch(/SuperGrok|now appears|no longer appears/);
    const cell = findingsCellHTML(f, 'differences');
    expect(cell).toContain('<div class="an-cmp-note an-cmp-plan">This week&#39;s differences may come from the account plan change, not a product update.</div>');
    expect(findingsCellHTML(f, 'similarities')).not.toContain('an-cmp-plan');
    expect(compareFindings(newer, older).join(' ')).not.toMatch(/SuperGrok|now appears/);
    // Copilot 08-24 vs 08-17: the same note.
    expect(planNote(card('copilot', '2026-08-24'), card('copilot', '2026-08-17'))).toBe(PLAN_CHANGE_NOTE);
    // Same plan, or two different products: no note.
    expect(planNote(card('copilot', '2026-08-31'), card('copilot', '2026-08-24'))).toBe('');
    expect(planNote(card('chatgpt', '2026-10-19'), card('grok', '2026-10-19'))).toBe('');
    expect(tableFindings(card('chatgpt', '2026-10-19'), card('chatgpt', '2026-10-12'))!.note).toBe('');
  });
});

describe('/facts plan line', () => {
  it('shows "Captured on a <plan> account" under the week, in HTML, Markdown and JSON-LD', async () => {
    const page = await text(handleFacts(new Request(`${ORIGIN}/facts`), t.env));
    expect(page).toContain('<span class="fx-week">Week of Oct 19, 2026</span>\n          <span class="fx-plan">Captured on a Pro account</span>');
    expect(page).toContain('<span class="fx-plan">Captured on an Enterprise account</span>');
    expect(page).toContain('<span class="fx-plan">Captured on a Free account</span>');
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    const items = ld['@graph'][1].itemListElement as { name: string; description?: string }[];
    expect(items.find((i) => i.name === 'Grok')!.description).toBe('Captured on a Pro account.');
    expect(items.find((i) => i.name === 'Microsoft Copilot')!.description).toBe('Captured on an Enterprise account.');
    expect(items.find((i) => i.name === 'Claude')!.description).toBeUndefined(); // no published analysis
    const md = await text(handleFacts(new Request(`${ORIGIN}/facts.md`), t.env));
    expect(md).toContain('## Grok\n\n- Week of October 19, 2026\n- Captured on a Pro account\n');
    expect(md).toContain('## Microsoft Copilot\n\n- Week of August 31, 2026\n- Captured on an Enterprise account\n');
  });

  it('leaves the line out when the plan is unknown', async () => {
    t.db.exec(`UPDATE captures SET plan = NULL WHERE slug = 'chatgpt'`);
    const page = await text(handleFacts(new Request(`${ORIGIN}/facts`), t.env));
    const chatgpt = page.match(/<li class="fx-entry" id="chatgpt">[\s\S]*?<\/div>/)![0];
    expect(chatgpt).not.toContain('fx-plan');
  });

  it('is shown on /facts only, not on portal or compare pages', async () => {
    expect(await portal('/portals/grok')).not.toMatch(/Captured on an? (?:Free|Pro|Enterprise) account/);
    expect(await text(handleComparePage(new Request(`${ORIGIN}/compare/copilot-vs-grok`), t.env))).not.toMatch(/Captured on an? (?:Free|Pro|Enterprise) account/);
  });
});

describe('POST /api/upload stores the plan', () => {
  const upload = (body: Record<string, unknown>) => handleApi(new Request(`${ORIGIN}/api/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ slug: 'grok', week: '2026-10-26', imageBase64: Buffer.alloc(200, 1).toString('base64'), ...body }),
  }), t.env, ctx);
  const plan = () => (t.db.prepare(`SELECT plan FROM captures WHERE id = 'grok-2026-10-26'`).get() as { plan: string | null } | undefined)?.plan;

  it('stores a valid plan, and keeps it when a later upload sends none', async () => {
    expect((await upload({ plan: 'Pro' })).status).toBe(200);
    expect(plan()).toBe('Pro');
    expect((await upload({ variant: 'mobile' })).status).toBe(200);
    expect((await upload({})).status).toBe(200);
    expect(plan()).toBe('Pro');
  });

  it('rejects an unknown plan', async () => {
    const res = await upload({ plan: 'Team' });
    expect(res.status).toBe(400);
    expect(plan()).toBeUndefined();
  });
});

describe('before migration 0010 (no plan column)', () => {
  // A deploy that runs ahead of the migration treats every plan as unknown instead of failing.
  beforeEach(() => { t.db.exec('ALTER TABLE captures DROP COLUMN plan'); });
  const get = (path: string, handler: (r: Request, e: typeof t.env) => Promise<Response>) => handler(new Request(`${ORIGIN}${path}`), t.env);

  it('serves every page that reads plans, with no plan notes or plan lines', async () => {
    const pages: [string, Promise<Response>][] = [
      ['/portals/grok', get('/portals/grok', handlePortalPage)],
      ['/portals/grok/2026-10-19', get('/portals/grok/2026-10-19', handlePortalPage)],
      ['/portals/grok/2026-10-19.md', get('/portals/grok/2026-10-19.md', handlePortalPage)],
      ['/weeks/2026-10-19', get('/weeks/2026-10-19', handleWeeks)],
      ['/compare/copilot-vs-grok', get('/compare/copilot-vs-grok', handleComparePage)],
      ['/changes', get('/changes', handleChanges)],
      ['/facts', get('/facts', handleFacts)],
      ['/llms-full.txt', get('/llms-full.txt', handleLlmsFullTxt)],
      ['/sitemap.xml', handleSitemap(t.env)],
      ['/api/captures', handleApi(new Request(`${ORIGIN}/api/captures?week=2026-10-19`), t.env, ctx)],
    ];
    for (const [path, res] of pages) {
      const r = await res;
      expect(r.status, path).toBe(200);
      const body = await r.text();
      expect(body, path).not.toContain('account plan change');
      expect(body, path).not.toMatch(/Captured on an? (?:Free|Pro|Enterprise) account/);
    }
    // Plans unknown: Grok's 10-19 changes count as menu changes again.
    expect(await portal('/portals/grok')).toContain('SuperGrok');
    const rows = await publishedCaptures(t.env);
    expect(rows.every((r) => r.plan === null && r.previous_plan === null)).toBe(true);
    expect(captureMetrics(rows.find((r) => r.slug === 'grok' && r.week === '2026-10-19')!)!.planChange).toBeNull();
  });

  it('stores uploads without a plan', async () => {
    const res = await handleApi(new Request(`${ORIGIN}/api/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ slug: 'grok', week: '2026-10-26', imageBase64: Buffer.alloc(200, 1).toString('base64'), plan: 'Pro' }),
    }), t.env, ctx);
    expect(res.status).toBe(200);
    expect(t.db.prepare(`SELECT id FROM captures WHERE id = 'grok-2026-10-26'`).get()).toEqual({ id: 'grok-2026-10-26' });
  });

  it('picks up the plans once the migration runs, without a redeploy', async () => {
    expect(await text(get('/facts', handleFacts))).not.toContain('<span class="fx-plan">');
    t.db.exec(MIGRATION);
    t.kv.clear();
    expect(await text(get('/facts', handleFacts))).toContain('<span class="fx-plan">Captured on a Pro account</span>');
  });
});

describe('/how-we-analyze: One account per portal', () => {
  it('has the section with its id, and /facts links to it', async () => {
    const page = await text(handleHowWeAnalyze(new Request(`${ORIGIN}/how-we-analyze`)));
    expect(page).toContain('<h2 id="one-account-per-portal">One account per portal</h2>');
    expect(page).toMatch(/One account per portal<\/h2>\n      <p>Each portal is captured with one logged-in account, so a screenshot shows what that one account saw that week\. Features can differ by plan \(Free, Pro or Enterprise\), region, language and gradual rollouts/);
    expect(page).toContain('the week of a plan change is not counted as a product change.');
    const facts = await text(handleFacts(new Request(`${ORIGIN}/facts`), t.env));
    expect(facts).toContain('<a href="/how-we-analyze#one-account-per-portal">');
  });
});

describe('guideline (SKILL.md)', () => {
  it('has the plan-change rule (1.8.0) in §9.1 and N1', () => {
    expect(SKILL).toContain('7. 兩週擷取時的帳號方案：`input.json` 的 `plan` 與 `previous_plan`');
    expect(SKILL).toContain('**帳號方案變動**：');
    expect(SKILL).toContain('本週**所有**變動（包括 N1）一律標 `possibly_confounded`');
    expect(SKILL).toContain('`note` 寫 `"account plan changed (Free → Pro)"`');
    expect(SKILL).toContain('- `plan` 與 `previous_plan`（輸入第 7 項）不同時，N1 的所有變動標 `possibly_confounded`');
    expect(SKILL).toMatch(/- \*\*1\.8\.0\*\*：第 9\.1 節新增「帳號方案變動」/);
  });
});

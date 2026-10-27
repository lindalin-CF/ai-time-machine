import { beforeEach, describe, expect, it, vi } from 'vitest';

// api.ts (cached) imports capture.ts, which imports Browser Rendering (Workers runtime only).
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { listPortals, publishedCaptures } from '../../src/db';
import { buildVoiceContext, capPageLinks, fluxWithKeyterms, stripMarkdown, stripMarkdownText, voiceKeyterms, voiceSystemPrompt, FLUX_MODEL, VOICE_CONTEXT_MAX, VOICE_TERMS } from '../../src/voice-context';
import { makeEnv } from './fake-env';

// Private text an analysis carries that must never reach the prompt.
const ICON_DESCRIPTION = 'clock-shaped icon with a tiny dot';
const N1_NOTE = 'Same clock icon at sidebar position 6.';
const GREETING = 'Good evening, Avery Quinn';
const CONTEXT_NOTE = 'Captured on the work laptop';
const PROMPT_TEXT = 'Plan a trip to Lisbon';

let t: ReturnType<typeof makeEnv>;

function analysis(slug: string, week: string, previous: string, opts: { n1?: unknown[]; changes?: unknown[]; L2?: string; H2?: string; L3?: string; scheme?: string; prompts?: number; note?: boolean; clickable?: number; extra?: string[] } = {}) {
  return {
    guideline_version: '1.5.2', portal: slug, week, previous_week: previous, variant: 'desktop', status: 'ok',
    context: { color_scheme: opts.scheme ?? 'dark', notes: CONTEXT_NOTE },
    metrics: [
      { id: 'L2', value: opts.L2 ?? '20%' },
      { id: 'L3', value: { vertical_third: opts.L3 ?? 'middle' } },
      { id: 'L4', value: opts.clickable != null ? { sidebar: opts.clickable } : { sidebar: 10, main: 8 } },
      { id: 'H2', value: opts.H2 ?? '3.3%' },
      { id: 'H3', value: 4 },
      { id: 'D5', value: { placeholder: 'Ask anything', suggested_prompts: { count: opts.prompts ?? 3, texts: [PROMPT_TEXT] } } },
      { id: 'D6', value: { present: opts.note ?? false } },
      { id: 'D7', value: GREETING },
      { id: 'N1', value: opts.n1 ?? [], sidebar: 'visible', note: N1_NOTE },
    ],
    changes_vs_previous: opts.changes ?? [],
    summary_sentences: [
      { text: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling.`, sources: [] },
      { text: 'A sidebar takes up about a fifth of the screen width.', sources: ['L1', 'L2'] },
      { text: `The message box stands out most in ${slug} ${week}.`, sources: ['H1', 'H2'] },
      { text: 'Three large cards fill the top half.', sources: ['L1'] },
      { text: 'No note that it can make mistakes is visible.', sources: ['D6'] },
      ...(opts.extra ?? []).map((text) => ({ text, sources: ['D7'] })),
    ],
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. A sidebar takes up about a fifth of the screen width. The message box stands out most in ${slug} ${week}. Three large cards fill the top half. No note that it can make mistakes is visible.`,
  };
}

function add(slug: string, name: string, company: string, week: string, a: unknown, by = 'guideline-v1.5.2') {
  t.db.exec(`INSERT OR IGNORE INTO portals (slug, name, company, url, brand) VALUES ('${slug}', '${name}', '${company}', 'https://example.com/', '#000000')`);
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at)
                VALUES (?, ?, ?, ?, ?, 'https://example.com/', '#000000', ?, ?, ?, ?, 'ok', ?)`)
    .run(`${slug}-${week}`, week, slug, name, company, (a as { summary: string }).summary, by, JSON.stringify(a), `${week}T20:00:00Z`, `${week}T09:00:00Z`);
}

const item = (label: string | null, region: string, extra: Record<string, unknown> = {}) => ({ label, region, icon: ICON_DESCRIPTION, ...extra });
const renamed = { id: 'N1', change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar', status: 'changed', note: N1_NOTE };

beforeEach(() => {
  t = makeEnv(); // has Claude (Anthropic)
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0)`);
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('grok', 'Grok', 'xAI', 'https://grok.com/', '#000000', 6)`);
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, active) VALUES ('retired', 'Retired', 'Gone Inc', 'https://x/', '#000000', 0)`);
  add('chatgpt', 'ChatGPT', 'OpenAI', '2026-09-28', analysis('chatgpt', '2026-09-28', '2026-09-21', { n1: [item('Scheduled', 'sidebar')], L2: '21%', H2: '3.1%', note: true }));
  add('chatgpt', 'ChatGPT', 'OpenAI', '2026-10-05', analysis('chatgpt', '2026-10-05', '2026-09-28', {
    n1: [item('New chat', 'sidebar'), item('Tasks', 'sidebar'), item('Projects', 'sidebar'), item(null, 'sidebar', { icon_label: 'magnifier icon' }), item('Think', 'input area')],
    changes: [renamed, { id: 'D7', previous: 'Hi', current: GREETING, status: 'possibly_confounded' }],
  }));
  add('claude', 'Claude', 'Anthropic', '2026-10-05', analysis('claude', '2026-10-05', '2026-09-28', { scheme: 'light', H2: '6.5%', prompts: 0 }));
  add('chatgpt', 'ChatGPT', 'OpenAI', '2026-08-03', analysis('chatgpt', '2026-08-03', '2026-07-27', { changes: [{ ...renamed, current: 'TestWeekItem' }] })); // system-test week
  add('claude', 'Claude', 'Anthropic', '2026-09-28', analysis('claude', '2026-09-28', '2026-09-21', { changes: [{ ...renamed, current: 'UnpublishedItem' }] }), 'pending');
  add('grok', 'Grok', 'xAI', '2026-10-05', analysis('grok', '2026-10-05', '2026-09-28', { changes: [{ ...renamed, current: 'GrokItem' }] }), 'pending');
  add('retired', 'Retired', 'Gone Inc', '2026-10-05', analysis('retired', '2026-10-05', '2026-09-28', { changes: [{ ...renamed, current: 'RetiredItem' }] }));
});

const context = async (opts: Parameters<typeof buildVoiceContext>[2] = {}) =>
  buildVoiceContext(await listPortals(t.env), await publishedCaptures(t.env), opts);
const PRIVATE = [ICON_DESCRIPTION, N1_NOTE, GREETING, 'Avery', CONTEXT_NOTE, PROMPT_TEXT, 'Ask anything', 'possibly_confounded', 'TestWeekItem', 'UnpublishedItem', 'GrokItem', 'RetiredItem'];

describe('voice keyterms', () => {
  it('lists every active portal name and company from D1, plus the site terms', async () => {
    const terms = voiceKeyterms(await listPortals(t.env));
    expect(terms).toEqual(['ChatGPT', 'OpenAI', 'Grok', 'xAI', 'Claude', 'Anthropic', ...VOICE_TERMS]); // portal sort order
    expect(terms).not.toContain('Retired');
    expect(VOICE_TERMS).toEqual(['portal', 'sidebar', 'menu', 'message box', 'suggested prompts']);
  });

  it('follows the portals table, with no duplicates', async () => {
    t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('meta-ai', 'Meta AI', 'Meta', 'https://meta.ai/', '#0866ff'), ('muse', 'Muse', 'Meta', 'https://muse.ai/', '#0866ff')`);
    const terms = voiceKeyterms(await listPortals(t.env));
    expect(terms).toContain('Meta AI');
    expect(terms).toContain('Muse');
    expect(terms.filter((x) => x === 'Meta')).toHaveLength(1);
  });
});

describe('voice context', () => {
  it('names every tracked product with its company', async () => {
    expect(await context()).toContain('Products tracked (3): ChatGPT (OpenAI), Grok (xAI), Claude (Anthropic).');
  });

  it("gives each product's latest published summary and menu items, without the fixed opening or sentences the measures cover", async () => {
    const text = await context({ links: true });
    expect(text).toContain('- ChatGPT [/portals/chatgpt/2026-10-05]: The message box stands out most in chatgpt 2026-10-05. Three large cards fill the top half. '
      + 'Menu items, sidebar: New chat, Tasks, Projects and 1 icon button; input area: Think.');
    expect(text).toContain('- Claude [/portals/claude/2026-10-05]:');
    expect(text).not.toMatch(/This shows the desktop version of chatgpt/);
    expect(text).not.toContain('A sidebar takes up about a fifth'); // L1 + L2: the measures give the width
    expect(text).not.toContain('No note that it can make mistakes'); // D6: in the measures
    const spoken = await context();
    expect(spoken).toContain('- ChatGPT, week of 2026-10-05: The message box stands out most');
  });

  it('falls back to the summary text when there are no summary sentences', async () => {
    t.db.exec(`UPDATE captures SET analysis_json = json_remove(analysis_json, '$.summary_sentences') WHERE id = 'claude-2026-10-05'`);
    expect(await context()).toContain('- Claude, week of 2026-10-05: A sidebar takes up about a fifth of the screen width. The message box stands out most in claude 2026-10-05.');
  });

  it('lists every menu change with its week, from the same data as /changes', async () => {
    expect(await context({ links: true })).toContain(
      '- Week of October 5, 2026 (compared with September 28, 2026), ChatGPT: the sidebar item Scheduled is now labeled Tasks. [/portals/chatgpt/2026-10-05]');
  });

  it("has one history line per product with each week's measures, newest first", async () => {
    const text = await context();
    expect(text).toContain('- ChatGPT: 2026-10-05: 20, 3.3, middle, 18, 3, no; 2026-09-28: 21, 3.1, middle, 18, 3, yes');
    expect(text).toContain('- Claude: 2026-10-05: 20, 6.5, middle, 18, 0, no');
  });

  it('leaves out system-test weeks, unpublished analyses, retired portals and private text', async () => {
    const text = await context({ links: true });
    for (const p of PRIVATE) expect(text, p).not.toContain(p);
    expect(text).not.toContain('2026-08-03');
    expect(text).not.toContain('Claude: 2026-10-05: 20, 6.5, middle, 18, 0, no; 2026-09-28'); // unpublished week
  });

  it('includes Grok only once it has a published analysis', async () => {
    let text = await context();
    expect(text).not.toMatch(/- Grok, week of/);
    expect(text).toContain('Grok (xAI)'); // still named as tracked
    expect(text).not.toMatch(/- Grok: 2026/);
    t.db.exec(`UPDATE captures SET analysis_by = 'guideline-v1.4' WHERE slug = 'grok'`);
    text = await context();
    expect(text).toMatch(/- Grok, week of 2026-10-05: /);
    expect(text).toMatch(/- Grok: 2026-10-05: /);
  });

  it('has page paths only for typed questions', async () => {
    expect(await context({ links: true })).toContain('[/changes]');
    const spoken = await context({ links: false });
    expect(spoken).not.toMatch(/\[\/(portals|changes)/);
    expect(spoken).not.toContain('/portals/');
  });

  it(`stays within ${VOICE_CONTEXT_MAX} characters, dropping the oldest weeks first and logging it`, async () => {
    for (let i = 0; i < 40; i++) {
      const week = new Date(Date.UTC(2025, 0, 6 + 7 * i)).toISOString().slice(0, 10);
      add('chatgpt', 'ChatGPT', 'OpenAI', week, analysis('chatgpt', week, '2024-12-30', { changes: [{ ...renamed, previous: `Old${i}`, current: `New${i}` }] }));
    }
    const logs: string[] = [];
    const text = await context({ log: (m) => logs.push(m), max: 4000 });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('2026-10-05: 20'); // newest week kept
    expect(text).not.toContain('2025-01-06'); // oldest week dropped
    expect(text).not.toContain('New0'); // and its menu change
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^\[voice\] context over 4000 chars; history and menu changes before the week of \d{4}-\d{2}-\d{2} were left out/);
    // The default limit applies without options.
    expect((await context()).length).toBeLessThanOrEqual(VOICE_CONTEXT_MAX);
  });

  it('cuts hard, with a log line, when even the latest week alone is too long', async () => {
    const logs: string[] = [];
    const text = await context({ log: (m) => logs.push(m), max: 300 });
    expect(text.length).toBe(300);
    expect(logs[0]).toMatch(/only the latest week; cut to 300/);
  });

  it('says so when nothing is published', () => {
    expect(buildVoiceContext([{ slug: 'x', name: 'X', company: 'Y' }], [])).toContain('No published analyses yet.');
  });
});

describe('worked-out lists', () => {
  const chatgptWeeks = () => {
    t.db.exec(`DELETE FROM captures WHERE slug = 'chatgpt'`);
    const week = (w: string, prev: string, o: Parameters<typeof analysis>[3]) => add('chatgpt', 'ChatGPT', 'OpenAI', w, analysis('chatgpt', w, prev, o));
    week('2026-08-17', '2026-08-10', { scheme: 'light', clickable: 17, H2: '3.4%' });
    week('2026-08-24', '2026-08-17', { clickable: 23 });
    week('2026-09-07', '2026-08-24', { clickable: 24 }); // 1 more: under the threshold of 3
    week('2026-09-21', '2026-09-07', { clickable: 26 });
    week('2026-09-28', '2026-09-21', { clickable: 23, H2: '3.9%' }); // 0.6 points: under the threshold of 1
    week('2026-10-05', '2026-09-28', { clickable: 23, changes: [renamed, { id: 'D7', previous: 'a', current: 'b', status: 'possibly_confounded' }], extra: ['The question above the message box differs from the week of 2026-09-28.'] });
  };

  it('groups every product, with counts, from its latest analysis', async () => {
    const text = await context();
    expect(text).not.toContain('- Color (');
    // The color scheme follows the capture machine's setting: never in the context (history, groups or changes).
    chatgptWeeks();
    expect(await context()).not.toMatch(/\b(?:dark|light)\b|color scheme|theme/i);
    expect(text).toContain('- Note that the AI can make mistakes (latest analyses, week of Oct 5): Shown: none (0 of 2). Not shown: ChatGPT, Claude (2 of 2).');
    expect(text).toContain('- Sidebar (latest analyses, week of Oct 5): Has a sidebar: ChatGPT, Claude (2 of 2). No sidebar: none (0 of 2).');
    expect(text).toContain('- Message box position (latest analyses, week of Oct 5): Top third: none (0 of 2). Middle third: ChatGPT, Claude (2 of 2). Bottom third: none (0 of 2).');
  });

  it('names the week of a product whose latest analysis is older, and lists values it could not measure', async () => {
    add('pi', 'Pi', 'Inflection AI', '2026-09-28', analysis('pi', '2026-09-28', '2026-09-21', { note: true, L2: '0%', L3: 'bottom' }));
    t.db.exec(`UPDATE captures SET analysis_json = json_set(analysis_json, '$.context.color_scheme', 'unknown') WHERE id = 'claude-2026-10-05'`);
    const text = await context();
    expect(text).toContain('Shown: Pi (week of Sep 28) (1 of 3).');
    expect(text).toContain('No sidebar: Pi (week of Sep 28) (1 of 3).');
    expect(text).toContain('Bottom third: Pi (week of Sep 28) (1 of 3).');
  });

  it("works out ChatGPT's changes across its weeks with the guideline thresholds", async () => {
    chatgptWeeks();
    expect(await context()).toContain(
      '- ChatGPT changes (6 weeks, Aug 17 to Oct 5): clickable items 17 \u2192 23 (Aug 24) \u2192 26 (Sep 21) \u2192 23 (Sep 28); '
      + 'seen Oct 5: the sidebar item Scheduled is now labeled Tasks; seen Oct 5: The question above the message box differs from the week of Sep 28.');
  });

  it('says when a product has no changes, or only one week', async () => {
    add('claude', 'Claude', 'Anthropic', '2026-09-21', analysis('claude', '2026-09-21', '2026-09-14', { scheme: 'light', H2: '6.5%', prompts: 0 }));
    add('kimi', 'Kimi', 'Moonshot AI', '2026-10-05', analysis('kimi', '2026-10-05', '2026-09-28'));
    const text = await context();
    expect(text).toContain('- Claude: No changes recorded across 2 weeks (Sep 21 to Oct 5).'); // its 09-28 analysis is unpublished
    expect(text).toContain('- Kimi: Only one week analyzed (week of Oct 5), so there is nothing to compare yet.');
  });

  it('leaves out summary sentences that say nothing changed', async () => {
    t.db.exec(`DELETE FROM captures WHERE slug = 'claude'`);
    add('claude', 'Claude', 'Anthropic', '2026-09-28', analysis('claude', '2026-09-28', '2026-09-21'));
    add('claude', 'Claude', 'Anthropic', '2026-10-05', analysis('claude', '2026-10-05', '2026-09-28', { extra: ['The main screen looks the same as the week of 2026-09-28.', 'The layout is the same as the week of 2026-09-28.'] }));
    expect(await context()).toContain('- Claude: No changes recorded across 2 weeks (Sep 28 to Oct 5).');
  });

  it('keeps comparison sentences out of the product description', async () => {
    chatgptWeeks();
    const text = await context();
    expect(text).toContain('seen Oct 5: The question above the message box differs from the week of Sep 28');
    expect(text).not.toContain('The question above the message box differs from the week of 2026-09-28'); // not in the description
  });

  it("lists only this week's changes, against each product's previous analysed week", async () => {
    chatgptWeeks();
    t.db.exec(`UPDATE captures SET analysis_by = 'guideline-v1.4', week = '2026-09-28', id = 'grok-2026-09-28' WHERE slug = 'grok'`);
    t.db.exec(`UPDATE captures SET analysis_json = json_set(analysis_json, '$.week', '2026-09-28') WHERE slug = 'grok'`);
    add('kimi', 'Kimi', 'Moonshot AI', '2026-09-28', analysis('kimi', '2026-09-28', '2026-09-21'));
    add('kimi', 'Kimi', 'Moonshot AI', '2026-10-05', analysis('kimi', '2026-10-05', '2026-09-28'));
    const text = await context();
    const section = text.slice(text.indexOf("THIS WEEK'S CHANGES"), text.indexOf('CHANGES PER PRODUCT'));
    expect(section).toContain("THIS WEEK'S CHANGES, week of Oct 5: only changes first seen in the latest week");
    expect(section).toContain('- ChatGPT (compared with Sep 28): the sidebar item Scheduled is now labeled Tasks.');
    expect(section).toContain('also differs for: ChatGPT. These are not counted as changes.'); // the question: possibly_confounded
    expect(section).not.toMatch(/clickable items|light \u2192 dark|Sep 21/); // earlier changes stay out
    expect(section).toContain('- No changes this week: Kimi.');
    expect(section).toContain('- First analysed this week, nothing to compare yet: Claude.'); // its 09-28 analysis is unpublished
    expect(section).toContain("- Not analysed this week, so not part of this week's changes: Grok (latest analysis: week of Sep 28).");
  });

  it("this week: only 'changed' items count; 'possibly_confounded' ones are named on one line; 'confounded' ones are left out", async () => {
    t.db.exec(`DELETE FROM captures`);
    const st = (id: string, status: string) => ({ id, previous: 'a', current: 'b', status });
    const week = (slug: string, name: string, w: string, prev: string, o: Parameters<typeof analysis>[3]) => add(slug, name, 'Co', w, analysis(slug, w, prev, o));
    week('gemini', 'Gemini', '2026-09-28', '2026-09-21', { clickable: 11 });
    week('gemini', 'Gemini', '2026-10-05', '2026-09-28', { clickable: 15, changes: [st('D7', 'possibly_confounded'), st('L4', 'changed')],
      extra: ['The heading text differs from the week of 2026-09-28.'] });
    week('qwen', 'Qwen Chat', '2026-09-28', '2026-09-21', { clickable: 16 });
    week('qwen', 'Qwen Chat', '2026-10-05', '2026-09-28', { clickable: 22, changes: [st('L4', 'possibly_confounded'), st('L1', 'possibly_confounded')],
      extra: ['The bottom of the screen differs from the week of 2026-09-28 because a rating survey appears there.'] });
    week('grok', 'Grok', '2026-09-28', '2026-09-21', { clickable: 22 });
    week('grok', 'Grok', '2026-10-05', '2026-09-28', { clickable: 25, changes: [st('C1', 'confounded')], extra: ['The label on the Fast mode button is brighter than in the week of 2026-09-28.'] });
    week('copilot', 'Copilot', '2026-09-28', '2026-09-21', { clickable: 20 });
    week('copilot', 'Copilot', '2026-10-05', '2026-09-28', { clickable: 23, changes: [st('L1', 'changed')], extra: ['The message box is narrower than in the week of 2026-09-28.'] });
    const text = await context();
    const section = text.slice(text.indexOf("THIS WEEK'S CHANGES"), text.indexOf('CHANGES PER PRODUCT'));
    expect(section).toContain('- Gemini (compared with Sep 28): clickable items 11 \u2192 15.'); // L4 changed; the heading may rotate
    expect(section).toContain('- Copilot (compared with Sep 28): The message box is narrower than in the week of Sep 28.'); // 20 -> 23 has no L4 judgement
    expect(section).toContain('- No changes this week: Grok, Qwen Chat.');
    expect(section).toContain('- Text or content that may rotate between visits (greetings, headings, pop-ups, promotions) also differs for: Gemini, Qwen Chat. These are not counted as changes.');
    expect(section).not.toMatch(/heading text|rating survey|Fast mode|22 \u2192 25|20 \u2192 23/); // possibly confounded, confounded, or not judged a change
  });

  it('this week: a sentence citing changes_vs_previous itself takes the status of the analysis\'s own changes', async () => {
    t.db.exec(`DELETE FROM captures`);
    add('kimi', 'Kimi', 'Moonshot AI', '2026-09-28', analysis('kimi', '2026-09-28', '2026-09-21'));
    const a = analysis('kimi', '2026-10-05', '2026-09-28', { changes: [{ id: 'D5', previous: 'a', current: 'b', status: 'changed' }] });
    a.summary_sentences.push({ text: 'The explore inspiration link now sits below the footer, unlike the week of 2026-09-28.', sources: ['changes_vs_previous', 'D5'] });
    add('kimi', 'Kimi', 'Moonshot AI', '2026-10-05', a);
    expect(await context()).toContain('- Kimi (compared with Sep 28): The explore inspiration link now sits below the footer, unlike the week of Sep 28.');
  });

  it('tells the model "this week" means the latest week and its list', () => {
    const p = voiceSystemPrompt('', false);
    expect(p).toContain('"This week" means the latest week.');
    expect(p).toContain("answer only from THIS WEEK'S CHANGES");
    expect(p).toMatch(/Give the real changes first\. Then always add one short sentence naming the products whose text or content may\s+rotate between visits/);
  });

  it('tells the model to answer from these complete lists', () => {
    const p = voiceSystemPrompt('', false);
    expect(p).toContain('answer from PRODUCT GROUPS');
    expect(p).toContain('answer from CHANGES');
    expect(p).toMatch(/name every product or change they give, with the count, and never\s+pick only some/);
    expect(p).toMatch(/include every item on its line and every step\s+of each/);
  });
});

describe('voice system prompt', () => {
  const prompt = (spoken: boolean) => voiceSystemPrompt('LIBRARY DATA\n(test)', spoken);

  it('describes the site and what it can answer, and ends with the data', () => {
    const p = prompt(false);
    expect(p).toContain('captures the signed-in desktop home screen');
    expect(p).toContain('1280 by 800 pixels, before scrolling');
    expect(p).toContain('Kimi is captured signed out');
    expect(p).toContain('a person reviews every analysis before it is published');
    expect(p).toMatch(/menu items and how they changed week to week/);
    expect(p.endsWith('LIBRARY DATA\n(test)')).toBe(true);
  });

  it('asks for numbers, weeks, and no usability judgements or redesign claims', () => {
    const p = prompt(false);
    expect(p).toContain('give the specific numbers');
    expect(p).toContain('say which week it was seen in');
    expect(p).toMatch(/Do not judge usability/);
    expect(p).toMatch(/do not call a change a\s+redesign, launch or new feature/);
  });

  it('never states a color scheme, and says why when asked', async () => {
    const p = prompt(true);
    expect(p).not.toContain('dark theme"');
    expect(p).toContain('- Do not say whether a product uses a dark or light theme or mode. If asked, say the screenshots follow the color');
    expect(p).toContain('setting of the computer that took them, so the library does not record a product\'s color scheme.');
  });

  it('handles misheard, unclear and frustrated questions', () => {
    const p = prompt(true);
    expect(p).toContain('"potter" is probably "portal"');
    expect(p).toContain('"dark sea" is probably "DeepSeek"');
    expect(p).toContain("If you're asking about DeepSeek: ...");
    expect(p).toMatch(/only a product name .* Reply\s+with one question only/s);
    expect(p).toMatch(/frustrated .* give one example\s+question/s);
  });

  it('spoken answers are English and never read addresses; typed answers follow the question language and cite pages', () => {
    const spoken = prompt(true), typed = prompt(false);
    expect(spoken).toContain('Answer in English');
    expect(spoken).toContain('say at most three items, then ask "Want me to go through the rest?"');
    expect(spoken).toMatch(/This also applies to this-week, which-products and change answers: say how\s+many there are in total, give the first three with what changed for each/);
    expect(typed).not.toContain('Want me to go through the rest?');
    expect(spoken).toContain('Never read out web addresses or page paths.');
    expect(spoken).not.toContain('Pages:');
    expect(typed).toContain('Answer in the language of the question (for example Chinese for a Chinese question)');
    expect(typed).toContain('Traditional\n  Chinese for a Traditional Chinese question');
    expect(typed).toContain('end with a line "Pages:"');
    expect(typed).toContain('written without the brackets');
    expect(typed).toContain('Always write plain text. Never use Markdown');
    expect(typed).toContain('separate the items with commas');
    expect(typed).not.toContain('Answer in English');
  });
});

describe('Flux keyterms', () => {
  const recorder = () => {
    const calls: { model: string; input: Record<string, unknown> }[] = [];
    return { calls, ai: { async run(model: string, input: Record<string, unknown>) { calls.push({ model, input }); return 'ok'; } } };
  };

  it('adds every keyterm, as an array, to Flux sessions only', async () => {
    const { calls, ai } = recorder();
    const flux = fluxWithKeyterms(t.env, ai);
    expect(await flux.run(FLUX_MODEL, { encoding: 'linear16', sample_rate: '16000' }, { websocket: true })).toBe('ok');
    await flux.run('@cf/deepgram/aura-1', { text: 'hi' });
    expect(calls[0].input).toEqual({ encoding: 'linear16', sample_rate: '16000', keyterm: voiceKeyterms(await listPortals(t.env)) });
    expect(calls[0].input.keyterm).toContain('Grok');
    expect(calls[1].input).toEqual({ text: 'hi' });
  });

  it('still transcribes, without keyterms, when D1 cannot be read', async () => {
    const { calls, ai } = recorder();
    const env = { ...t.env, DB: { prepare() { throw new Error('D1 down'); } } } as unknown as typeof t.env;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fluxWithKeyterms(env, ai).run(FLUX_MODEL, { encoding: 'linear16' });
    expect(calls[0].input).toEqual({ encoding: 'linear16' });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('capPageLinks', () => {
  type Part = { type: string; text?: string; id?: string };
  async function* parts(...items: Part[]) { for (const p of items) yield p; }
  const delta = (text: string): Part => ({ type: 'text-delta', id: 't1', text });
  const run = async (...items: Part[]) => { const out: Part[] = []; for await (const p of capPageLinks(parts(...items))) out.push(p); return out; };
  const text = (out: Part[]) => out.filter((p) => p.type === 'text-delta').map((p) => p.text).join('');

  it('keeps at most three links on the Pages line, even when "Pages:" is split across chunks', async () => {
    const out = await run({ type: 'text-start' }, delta('Meta AI has the largest box. Pa'), delta('ges: /portals/a/2026-10-05 /portals/b/2026-10-05'),
      delta(' /portals/c/2026-10-05 /portals/d/2026-10-05 /portals/e/2026-10-05'), { type: 'text-end' }, { type: 'finish' });
    expect(text(out)).toBe('Meta AI has the largest box. Pages: /portals/a/2026-10-05 /portals/b/2026-10-05 /portals/c/2026-10-05');
    expect(out.map((p) => p.type).filter((x) => x !== 'text-delta')).toEqual(['text-start', 'text-end', 'finish']);
    expect(out.at(-1)!.type).toBe('finish');
  });

  it('streams the answer before "Pages:" as it arrives', async () => {
    const out = await run(delta('Meta AI '), delta('has the largest box.'), delta(' Pages: /changes'));
    expect(out[0].text).toBe('Meta AI ');
    expect(text(out)).toBe('Meta AI has the largest box. Pages: /changes');
  });

  it('leaves answers with three links or fewer, or none, unchanged', async () => {
    expect(text(await run(delta('Kimi and Pi.\nPages: /portals/kimi/2026-10-05 /portals/pi/2026-10-05')))).toBe('Kimi and Pi.\nPages: /portals/kimi/2026-10-05 /portals/pi/2026-10-05');
    expect(text(await run(delta('No pages here, P'), delta('lease ask again.')))).toBe('No pages here, Please ask again.');
  });

  it('keeps text after the Pages line', async () => {
    expect(text(await run(delta('A.\nPages: /a /b /c /d\nThanks.')))).toBe('A.\nPages: /a /b /c\nThanks.');
  });
});

describe('stripMarkdown', () => {
  type Part = { type: string; text?: string; id?: string };
  async function* parts(...items: Part[]) { for (const p of items) yield p; }
  const delta = (text: string): Part => ({ type: 'text-delta', id: 't1', text });
  const collect = async (gen: AsyncIterable<Part>) => { const out: Part[] = []; for await (const p of gen) out.push(p); return out; };
  const text = (out: Part[]) => out.filter((p) => p.type === 'text-delta').map((p) => p.text).join('');
  const run = async (...chunks: string[]) => text(await collect(stripMarkdown(parts(...chunks.map(delta)))));

  it('removes bold, italics, headings and backticks, even when ** is split across chunks', async () => {
    expect(await run('**Gr', 'ok** is *dark*.')).toBe('Grok is dark.');
    expect(await run('*', '*Grok*', '*')).toBe('Grok');
    expect(await run('## Answer\nUse `Tasks` in __the__ sidebar.')).toBe(' Answer\nUse Tasks in the sidebar.');
  });

  it('removes list markers at the start of a line, even when split across chunks', async () => {
    expect(await run('- ChatGPT\n- Cl', 'aude\n1', '. Gemini\n\u2022 Poe\n2. ', 'Kimi')).toBe('ChatGPT\nClaude\nGemini\nPoe\nKimi');
    expect(await run('Products:\n', '-', ' Grok')).toBe('Products:\nGrok');
  });

  it('keeps hyphens, numbers and dashes that are not list markers', async () => {
    expect(await run('2026 was a year.\n-based on data\nA - B and 3.3% of the screen')).toBe('2026 was a year.\n-based on data\nA - B and 3.3% of the screen');
    expect(await run('Meta AI is first.\n1')).toBe('Meta AI is first.\n1'); // a held "1" is flushed at the end
  });

  it('streams text that cannot be a list marker straight away, and keeps other parts in order', async () => {
    const out = await collect(stripMarkdown(parts({ type: 'text-start' }, delta('Meta AI '), delta('**9.8%**'), { type: 'text-end' }, { type: 'finish' })));
    expect(out.map((p) => p.type)).toEqual(['text-start', 'text-delta', 'text-delta', 'text-end', 'finish']);
    expect(out[1].text).toBe('Meta AI ');
    expect(text(out)).toBe('Meta AI 9.8%');
  });

  it('matches the whole-text cleanup', async () => {
    const answer = '**Dark theme:**\n- ChatGPT\n- Claude\n1. Poe\n## Done `ok` _yes_';
    expect(await run(...answer.match(/.{1,3}/gs)!)).toBe(stripMarkdownText(answer));
  });

  it('runs before the link cap, so a bold "Pages:" line is still capped', async () => {
    const out = await collect(capPageLinks(stripMarkdown(parts(delta('Kimi and Pi.\n**Pa'), delta('ges:** /a /b /c /d')))));
    expect(text(out)).toBe('Kimi and Pi.\nPages: /a /b /c');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error -- plain .mjs module, no type declarations
import { bannedPhrases, lintAnalysis, menuNames, belowThreshold, withLintSection, markdownReport, SKILL_PATH } from '../../scripts/local-capture/analysis/lint.mjs';

type Finding = { rule: string; message: string; where: string; sentence?: string };
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const banned = bannedPhrases(readFileSync(SKILL_PATH, 'utf8'));

/** A clean analysis that passes every rule. Each test changes one thing. */
function base(): Json {
  const sentences = [
    { text: 'This shows the desktop version of Example for the week of 2026-10-19, before scrolling.', sources: [] },
    { text: 'A sidebar takes up about a fifth of the screen width.', sources: ['L1', 'L2'] },
    { text: 'The message box is the largest item on the screen.', sources: ['H1', 'H2'] },
    { text: 'The main text is dark enough against the background to meet a common accessibility guideline.', sources: ['C2'] },
    { text: 'The outline of the message box is faint, but the hint text inside it is easy to read.', sources: ['C4'] },
    { text: 'Three suggested prompts sit below the message box.', sources: ['D5'] },
    { text: 'No note that it can make mistakes is visible.', sources: ['D6'] },
    { text: 'The main screen looks the same as the week of 2026-10-12.', sources: ['changes_vs_previous'] },
  ];
  return {
    guideline_version: '1.6.0', portal: 'example', week: '2026-10-19', previous_week: '2026-10-12', variant: 'desktop',
    viewport: '1280x800', scope: 'first screen only, single logged-in account', status: 'ok', status_reason: null, e1_available: true,
    context: {
      color_scheme: 'light', modal_present: 'none', account_type: 'personal', plan_tier_visible: 'unknown',
      personalized_content: { value: false, note: '' }, time_dependent_content: { value: false, note: '' },
      hover_or_focus_visible: { value: false, note: '' }, promotional_content: { value: false, note: '' },
      conversation_open: false, ui_language: 'en', privacy_flag: true, notes: '',
    },
    metrics: [
      { id: 'L1', value: [{ region: 'sidebar', location: [0, 0, 260, 800] }, { region: 'account-specific area (excluded)', location: [0, 700, 260, 100] }], evidence: 'E2', confidence: 'high', note: '' },
      { id: 'L2', value: '20%', evidence: 'E1', location: [0, 0, 260, 800], confidence: 'high', note: '' },
      { id: 'L3', value: { center: [770, 400], vertical_third: 'middle', horizontally_centered: true }, evidence: 'E2', confidence: 'high', note: '' },
      { id: 'L4', value: { sidebar: 8, main_content: 6, total: 14 }, evidence: 'E2', confidence: 'medium', note: '' },
      { id: 'L5', value: 'not_measured', evidence: 'E1', confidence: 'low', note: '' },
      { id: 'N1', value: [
        { label: 'New chat', region: 'sidebar', order: 1, icon: 'pencil icon', badge: null },
        { label: null, icon_label: 'magnifier icon', region: 'sidebar', order: 2, icon: 'magnifier-shaped icon', badge: null },
        { label: 'Tasks', region: 'sidebar', order: 3, icon: 'clock icon', badge: null },
        { label: 'model picker', role: 'model_picker', current: 'Fast', region: 'input area', order: 1, icon: null, badge: null },
      ], sidebar: 'visible', evidence: 'E2', confidence: 'high', note: '' },
      { id: 'H1', value: [{ rank: 1, element: 'prompt input', basis: '5%' }, { rank: 2, element: 'heading', basis: '24px' }, { rank: 3, element: 'chip', basis: 'x' }], evidence: 'E2', confidence: 'medium', note: '' },
      { id: 'H2', value: '5.0%', evidence: 'E1', confidence: 'high', note: '' },
      { id: 'H3', value: 3, evidence: 'E2', confidence: 'medium', note: '' },
      { id: 'C1', value: { main_background: '#FFFFFF', primary_text: '#1F1F1F' }, evidence: 'E1', confidence: 'high', note: '' },
      { id: 'C2', value: '15.3:1', result: 'approx_pass', evidence: 'E1', confidence: 'high', note: '' },
      { id: 'C3', value: '4.6:1', result: 'approx_pass', evidence: 'E1', confidence: 'high', note: '' },
      { id: 'C4', value: { prompt_input: { boundary: '1.2:1', other_cue: 'placeholder 7.8:1' } }, result: 'approx_unclear', evidence: 'E1', confidence: 'high', note: '' },
      { id: 'C5', value: { classification: 'sans-serif' }, evidence: 'E2', confidence: 'medium', note: '' },
      { id: 'D1', value: 'prompt input', evidence: 'E2', confidence: 'high', note: '' },
      { id: 'D2', value: 'Prompt input ranks 1st.', evidence: 'E2', confidence: 'high', note: '' },
      { id: 'D3', value: 0, evidence: 'E2', confidence: 'high', note: '' },
      { id: 'D4', value: [], evidence: 'E1', confidence: 'high', note: 'No send button visible in this state; it may appear after typing, which a screenshot cannot show.' },
      { id: 'D5', value: { placeholder: 'Ask anything', suggested_prompts: { count: 3, texts: ['A', 'B', 'C'] } }, evidence: 'E2', confidence: 'high', note: '' },
      { id: 'D6', value: 'none', evidence: 'E2', confidence: 'high', note: '' },
      { id: 'D7', value: 'Good morning, [name]', suggests_task: false, evidence: 'E2', confidence: 'high', note: '' },
    ],
    changes_vs_previous: [], excluded_region_changed: false, unmapped_changes: [],
    summary_sentences: sentences, summary: sentences.map((s) => s.text).join(' '),
  };
}

/** The previous week's analysis, same conditions. */
function prev(): Json {
  const p = base();
  p.week = '2026-10-12';
  p.previous_week = '2026-10-05';
  return p;
}

function metric(a: Json, id: string): Json { return a.metrics.find((m: Json) => m.id === id); }
function setSentence(a: Json, i: number, text: string, sources?: string[]) {
  a.summary_sentences[i] = { text, sources: sources ?? a.summary_sentences[i]?.sources ?? [] };
  a.summary = a.summary_sentences.map((s: Json) => s.text).join(' ');
}
function lint(a: Json, opts: Json = {}): Finding[] {
  return lintAnalysis(a, { banned, previous: { analysis: prev(), source: 'test' }, ...opts });
}
const rules = (f: Finding[], rule: string) => f.filter((x) => x.rule === rule);

describe('lint: clean analysis', () => {
  it('passes every rule', () => {
    expect(lint(base())).toEqual([]);
  });
  it('skips not_analyzable analyses', () => {
    expect(lint({ ...base(), status: 'not_analyzable', summary_sentences: [] })).toEqual([]);
  });
});

describe('lint: banned wording (read from SKILL.md)', () => {
  it('reads the guideline lists instead of a second hard-coded list', () => {
    const any = banned.anywhere.map((p: Json) => p.text);
    const summary = banned.summaryOnly.map((p: Json) => p.text);
    for (const p of ['launched', 'redesigned', 'introduced a new feature', 'user-friendly', 'intuitive', 'search bar', 'landing page']) expect(any).toContain(p);
    expect([...any, ...summary]).toContain('new feature');
    for (const p of ['viewport', 'prompt input', 'visual hierarchy', 'suggestion chips', 'send button', 'contrast ratio']) expect(summary).toContain(p);
  });

  it('flags the screen\'s color scheme as a product property (guideline 1.9.0), but not contrast wording', () => {
    const any = banned.anywhere.map((p: Json) => p.text);
    for (const p of ['dark screen', 'light screen', 'dark mode', 'light mode', 'dark theme', 'light theme']) expect(any).toContain(p);
    const a = base();
    setSentence(a, 2, 'The message box sits in the middle of a mostly empty dark screen.');
    expect(rules(lint(a), 'banned-wording').map((x) => x.message).join(' ')).toMatch(/dark screen/);
    const ok = base();
    setSentence(ok, 2, 'The text is dark enough against the background to meet a common guideline.');
    expect(rules(lint(ok), 'banned-wording')).toEqual([]);
  });

    it('flags a forbidden phrase in the summary and quotes the sentence', () => {
    const a = base();
    setSentence(a, 2, 'The portal launched a new feature in the message box.');
    const f = rules(lint(a), 'banned-wording');
    expect(f.map((x) => x.message).join(' ')).toMatch(/launched/);
    expect(f.map((x) => x.message).join(' ')).toMatch(/new feature/);
    expect(f[0].sentence).toBe('The portal launched a new feature in the message box.');
  });

  it('flags §8 wording in a note, but not quoted UI text or §10.2 terms there', () => {
    const a = base();
    metric(a, 'D2').note = 'The layout is clean and modern.';
    expect(rules(lint(a), 'banned-wording')).toHaveLength(1);
    const ok = base();
    metric(ok, 'D2').note = "A small 'Updated' badge; the prompt input covers 5% of the viewport. No send button visible.";
    expect(rules(lint(ok), 'banned-wording')).toEqual([]);
  });

  it('flags §10.2 terms in the summary only', () => {
    const a = base();
    setSentence(a, 2, 'The prompt input has the most visual weight.');
    expect(rules(lint(a), 'banned-wording').map((x) => x.message).join(' ')).toMatch(/prompt input.*visual weight|visual weight.*prompt input/s);
  });
});

describe('lint: metric ranges', () => {
  it('flags out-of-range values', () => {
    const a = base();
    metric(a, 'L2').value = '130%';
    metric(a, 'C2').value = '25.0:1';
    metric(a, 'D3').value = -1;
    metric(a, 'L3').value.vertical_third = 'upper';
    metric(a, 'H1').value.push({ rank: 4 });
    metric(a, 'D1').evidence = 'E3';
    const f = rules(lint(a), 'metric-range').map((x) => x.where);
    for (const id of ['L2', 'C2', 'D3', 'L3', 'H1', 'D1']) expect(f).toContain(`metrics.${id}`);
  });

  it('flags results that contradict the ratio, and a wrong L4 total', () => {
    const a = base();
    metric(a, 'C3').value = '2.1:1'; // approx_pass below 3:1
    metric(a, 'L4').value.total = 20;
    const f = rules(lint(a), 'metric-range').map((x) => x.message).join('\n');
    expect(f).toMatch(/2\.1:1 is marked approx_pass/);
    expect(f).toMatch(/total is 20 but the regions add up to 14/);
  });

  it('flags missing metrics', () => {
    const a = base();
    a.metrics = a.metrics.filter((m: Json) => m.id !== 'C5');
    expect(rules(lint(a), 'metric-range')[0].message).toMatch(/missing metrics: C5/);
  });
});

describe('lint: text vs metrics', () => {
  it('flags "no suggested prompts" when D5 counts some', () => {
    const a = base();
    setSentence(a, 5, 'There are no suggested prompts.');
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/no suggested prompts, but D5 counts 3/);
  });
  it('flags a suggested-prompt number that differs from D5', () => {
    const a = base();
    setSentence(a, 5, 'Five suggested prompts sit below the message box.');
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/names 5 suggested prompts, but D5 counts 3/);
  });
  it('flags a mistakes-note sentence that contradicts D6', () => {
    const a = base();
    metric(a, 'D6').value = { present: true, location: 'below input', type: 'mistakes', text: 'It can make mistakes.' };
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/no mistakes note is visible, but D6 records one/);
    const b = base();
    metric(b, 'D6').value = { present: true, location: 'below input', type: 'mistakes', text: 'x' };
    setSentence(b, 6, 'There are no suggested prompts, but a note below it says Example can make mistakes.', ['D6']);
    metric(b, 'D5').value.suggested_prompts = { count: 0, texts: [] };
    setSentence(b, 5, 'Nothing else sits below the box.', ['D1']);
    expect(rules(lint(b), 'text-vs-metrics')).toEqual([]);
  });
  it('flags "can make mistakes" for an ai_generated note', () => {
    const a = base();
    metric(a, 'D6').value = { present: true, location: 'footer', type: 'ai_generated', text: 'Content is AI-generated' };
    setSentence(a, 6, 'A note at the bottom says it can make mistakes.');
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/ai_generated/);
  });
  it('flags a contrast claim that contradicts C2', () => {
    const a = base();
    metric(a, 'C2').value = '3.9:1';
    metric(a, 'C2').result = 'approx_fail';
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/meets the guideline, but C2 is approx_fail/);
  });
  it('flags a sidebar fraction far from L2', () => {
    const a = base();
    metric(a, 'L2').value = '35%';
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/about 20% of the width, but L2 is 35%/);
  });
  it('checks the message box outline sentence against C4 for the box itself', () => {
    const a = base();
    metric(a, 'C4').result = 'approx_pass';
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/approx_unclear sentence/);
    const b = base(); // overall fail, but the box itself is unclear: fine
    metric(b, 'C4').value = { prompt_input: { result: 'approx_unclear' }, send_button: { result: 'approx_fail' } };
    metric(b, 'C4').result = 'approx_fail';
    expect(rules(lint(b), 'text-vs-metrics')).toEqual([]);
  });
  it('flags a missing "not measured" sentence when E1 is unavailable', () => {
    const a = base();
    a.e1_available = false;
    expect(rules(lint(a), 'text-vs-metrics')[0].message).toMatch(/colors were not measured/);
  });
});

describe('lint: menu items', () => {
  it('extracts names from the guideline sentence shapes', () => {
    expect(menuNames('The sidebar item Scheduled is now labeled Tasks.')).toEqual([{ role: 'previous', name: 'Scheduled' }, { role: 'current', name: 'Tasks' }]);
    expect(menuNames('A new Tasks item appears in the sidebar.')).toEqual([{ role: 'current', name: 'Tasks' }]);
    expect(menuNames('The Chat and Work items no longer appear in the top bar.')).toEqual([{ role: 'previous', name: 'Chat' }, { role: 'previous', name: 'Work' }]);
    expect(menuNames('An icon button (slider icon) now appears in the message box.')).toEqual([{ role: 'current', name: 'slider icon' }]);
  });

  it('passes a menu sentence whose names are in N1 and in the changes', () => {
    const a = base();
    const p = prev();
    metric(p, 'N1').value[2].label = 'Scheduled';
    a.changes_vs_previous = [{ id: 'N1', change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar', status: 'changed', note: '' }];
    setSentence(a, 7, 'The sidebar item Scheduled is now labeled Tasks.', ['N1']);
    expect(lint(a, { previous: { analysis: p, source: 'test' } })).toEqual([]);
  });

  it('flags a named menu item that is not in N1', () => {
    const a = base();
    a.changes_vs_previous = [{ id: 'N1', change: 'added', previous: null, current: 'Tasks', region: 'sidebar', status: 'changed', note: '' }];
    setSentence(a, 7, 'A new Library item appears in the sidebar.', ['N1']);
    expect(rules(lint(a), 'menu-items')[0].message).toMatch(/"Library" is named as a current menu item but isn't in N1/);
  });

  describe('possible reorder (§9.3, guideline 1.7.0)', () => {
    const renamed = (previous: string, current: string, change = 'renamed') =>
      ({ id: 'N1', change, previous, current, region: 'sidebar', status: 'changed', note: '', ...(change === 'icon_changed' ? { icon_only: true } : {}) });
    const reorderFindings = (a: Json, p: Json = prev()) =>
      rules(lint(a, { previous: { analysis: p, source: 'test' } }), 'menu-items').filter((f) => /reorder|move|position|icon differs/.test(f.message));

    it('passes one rename that keeps its icon and position', () => {
      const a = base();
      const p = prev();
      metric(p, 'N1').value[2].label = 'Scheduled';
      a.changes_vs_previous = [renamed('Scheduled', 'Tasks')];
      expect(reorderFindings(a, p)).toEqual([]);
    });

    it('flags several renamed / icon_changed entries in one region as a possible reorder', () => {
      const a = base();
      const p = prev();
      metric(p, 'N1').value[2].label = 'Scheduled';
      metric(p, 'N1').value[1].icon_label = 'puzzle icon';
      a.changes_vs_previous = [renamed('Scheduled', 'Tasks'), renamed('puzzle icon', 'magnifier icon', 'icon_changed')];
      expect(reorderFindings(a, p)[0].message).toMatch(/2 renamed\/icon_changed N1 entries this week \(2 in the sidebar\): possibly a reordered menu/);
    });

    it('flags a "rename" whose old name is still in the menu', () => {
      const a = base();
      a.changes_vs_previous = [renamed('New chat', 'Tasks')];
      expect(reorderFindings(a)[0].message).toMatch(/"New chat" is still in this week's sidebar, so this is a move/);
    });

    it('flags a rename whose icon differs', () => {
      const a = base();
      const p = prev();
      Object.assign(metric(p, 'N1').value[2], { label: 'Scheduled', icon: 'box icon' });
      a.changes_vs_previous = [renamed('Scheduled', 'Tasks')];
      expect(reorderFindings(a, p)[0].message).toMatch(/renamed but the icon differs/);
    });

    it('flags a rename whose position differs', () => {
      const a = base();
      const p = prev();
      Object.assign(metric(p, 'N1').value[0], { label: 'Scheduled', icon: 'clock icon' });
      Object.assign(metric(p, 'N1').value[2], { label: 'New chat', icon: 'pencil icon' });
      a.changes_vs_previous = [renamed('Scheduled', 'Tasks')];
      expect(reorderFindings(a, p).map((f) => f.message).join('\n')).toMatch(/position differs \(the items next to it changed\)/);
    });

    it('passes a rename whose order number shifted only because an item above it was removed', () => {
      const a = base();
      const p = prev();
      metric(p, 'N1').value.splice(1, 0, { label: 'Projects', region: 'sidebar', order: 2, icon: 'folder icon', badge: null });
      metric(p, 'N1').value.forEach((it: Json, i: number) => { if (it.region === 'sidebar') it.order = i + 1; });
      metric(p, 'N1').value[3].label = 'Scheduled'; // order 4 last week, order 3 now, same neighbours
      a.changes_vs_previous = [renamed('Scheduled', 'Tasks'), { id: 'N1', change: 'removed', previous: 'Projects', current: null, region: 'sidebar', status: 'changed', note: '' }];
      expect(reorderFindings(a, p)).toEqual([]);
    });

    it('matches icons only among items without a label', () => {
      const a = base();
      const p = prev();
      metric(p, 'N1').value[2].label = 'Scheduled';
      metric(p, 'N1').value[0].icon = 'clock icon'; // a labelled item with the same icon shape is not the icon-only item
      metric(a, 'N1').value[2] = { label: null, icon_label: 'clock icon', region: 'sidebar', order: 3, icon: 'clock icon', badge: null };
      a.changes_vs_previous = [renamed('Scheduled', 'clock icon')];
      expect(reorderFindings(a, p).filter((f) => /already in the previous week/.test(f.message))).toEqual([]);
    });
  });

  it('flags an N1 item without a label or icon_label', () => {
    const a = base();
    delete metric(a, 'N1').value[1].icon_label;
    expect(rules(lint(a), 'menu-items')[0].message).toMatch(/no label and no icon_label/);
  });
});

describe('lint: cross-week', () => {
  it('flags a change below the §9.3 threshold', () => {
    expect(belowThreshold({ id: 'L2', previous: '20%', current: '23%' })).toMatch(/threshold 5/);
    expect(belowThreshold({ id: 'L2', previous: '20%', current: '27%' })).toBeNull();
    expect(belowThreshold({ id: 'C3', previous: '4.4:1 approx_fail', current: '4.2:1 approx_fail' })).toMatch(/threshold 0.5/);
    expect(belowThreshold({ id: 'C1', previous: '#878580', current: '#7A7873' })).toMatch(/threshold 16/);
    expect(belowThreshold({ id: 'C1', previous: '#878580', current: '#696763' })).toBeNull();
  });

  it('passes a change that meets the threshold and is written in the summary', () => {
    const a = base();
    metric(a, 'L2').value = '27%';
    setSentence(a, 1, 'A sidebar takes up about a quarter of the screen width.');
    a.changes_vs_previous = [{ id: 'L2', previous: '20%', current: '27%', status: 'changed', note: '' }];
    setSentence(a, 7, 'The sidebar is wider than in the week of 2026-10-12.', ['L2']);
    expect(lint(a)).toEqual([]);
  });

  it('flags week-over-week claims when previous_week is missing', () => {
    const a = base();
    a.previous_week = null;
    const f = rules(lint(a, { previous: null }), 'cross-week');
    expect(f[0].message).toMatch(/previous_week is missing/);
    expect(f[0].sentence).toBe('The main screen looks the same as the week of 2026-10-12.');
  });

  it('flags a possibly_confounded change written as definite', () => {
    const a = base();
    a.changes_vs_previous = [{ id: 'D7', previous: 'Hi [name]', current: 'Hello [name]', status: 'possibly_confounded', note: '' }];
    setSentence(a, 7, 'The greeting now says hello.', ['D7']);
    expect(rules(lint(a), 'cross-week')[0].message).toMatch(/only possibly_confounded/);
  });

  it('flags a change that §9.1 says is confounded', () => {
    const a = base();
    a.context.promotional_content = { value: true, note: 'card' };
    a.changes_vs_previous = [{ id: 'L1', previous: 'no card', current: 'card [400, 500, 400, 100]', status: 'changed', note: '' }];
    setSentence(a, 7, 'A card below the message box differs from the week of 2026-10-12.', ['L1']);
    expect(rules(lint(a), 'cross-week')[0].message).toMatch(/promotional_content differs/);
  });

  it('treats a context field missing from an older previous analysis as unknown, not a difference', () => {
    const a = base();
    a.context.promotional_content = { value: true, note: 'card' };
    a.context.conversation_open = true;
    a.changes_vs_previous = [{ id: 'L1', previous: 'no card', current: 'card [400, 500, 400, 100]', status: 'changed', note: '' }];
    setSentence(a, 7, 'A card below the message box differs from the week of 2026-10-12.', ['L1']);
    const p = prev();
    delete p.context.promotional_content;
    delete p.context.conversation_open;
    expect(rules(lint(a, { previous: { analysis: p, source: 'v1.3' } }), 'cross-week')).toEqual([]);
  });

  describe('plan links are navigation (§6, guideline 1.7.1)', () => {
    const withUpgrade = () => {
      const p = prev();
      metric(p, 'N1').value.push({ label: 'Upgrade', region: 'top bar', order: 1, icon: 'four-pointed-star icon', badge: null });
      return p;
    };
    const removal = (status: string) => {
      const a = base();
      a.changes_vs_previous = [{ id: 'N1', change: 'removed', previous: 'Upgrade', current: null, region: 'top bar', status, note: '' }];
      setSentence(a, 7, 'The Upgrade item no longer appears in the top bar.', ['N1']);
      return a;
    };
    const planFindings = (a: Json, p: Json) => rules(lint(a, { previous: { analysis: p, source: 'test' } }), 'cross-week').filter((f) => /plan link/.test(f.message));

    it('passes the removal of a top-bar Upgrade link marked changed', () => {
      expect(planFindings(removal('changed'), withUpgrade())).toEqual([]);
    });
    it('flags the removal of a top-bar Upgrade link marked possibly_confounded', () => {
      expect(planFindings(removal('possibly_confounded'), withUpgrade())[0].message).toMatch(/"Upgrade" was a plan link in the top bar last week: that is a navigation item/);
    });
    it("doesn't flag it when the link wasn't in that region last week", () => {
      expect(planFindings(removal('possibly_confounded'), prev())).toEqual([]);
    });
  });

  it('flags "looks the same" when there are changes', () => {
    const a = base();
    a.changes_vs_previous = [{ id: 'N1', change: 'added', previous: null, current: 'Tasks', region: 'sidebar', status: 'changed', note: '' }];
    const f = rules(lint(a), 'cross-week').map((x) => x.message).join('\n');
    expect(f).toMatch(/looks the same, but changes_vs_previous has changed entries/);
  });
});

describe('lint: privacy', () => {
  it('flags emails, names in greetings and private terms without quoting them', () => {
    const a = base();
    metric(a, 'D7').value = 'Good morning, Alexandra';
    metric(a, 'D2').note = 'Contact alex@example.com';
    const f = rules(lint(a, { privateTerms: ['nothing-here', 'alexandra'] }), 'privacy');
    expect(f.map((x) => x.message).join('\n')).toMatch(/email-like/);
    expect(f.map((x) => x.message).join('\n')).toMatch(/may be a name/);
    expect(f.map((x) => x.message).join('\n')).toMatch(/line\(s\) 2/);
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/Alexandra|alex@example/i);
    expect(f.every((x) => x.sentence === undefined)).toBe(true);
  });

  it('flags a summary that mentions an excluded area, and privacy_flag false with excluded areas', () => {
    const a = base();
    setSentence(a, 2, 'The recent chats list fills the sidebar.', ['L1']);
    a.context.privacy_flag = false;
    const f = rules(lint(a), 'privacy').map((x) => x.message).join('\n');
    expect(f).toMatch(/excluded area/);
    expect(f).toMatch(/privacy_flag is false/);
  });

  it("doesn't flag avatars visible in screenshots before 2026-10-19 (CLAUDE.md: left as they are)", () => {
    const a = base();
    a.week = '2026-09-28';
    a.previous_week = null;
    setSentence(a, 0, 'This shows the desktop version of Example for the week of 2026-09-28, before scrolling.');
    a.summary_sentences.pop();
    a.summary = a.summary_sentences.map((s: Json) => s.text).join(' ');
    metric(a, 'L1').value.push({ region: 'account-specific area (excluded)', location: [10, 750, 40, 40] }); // the avatar spot
    metric(a, 'L1').note = 'An initials avatar is visible at the bottom left; it is part of the excluded area.';
    expect(rules(lint(a, { previous: null }), 'privacy')).toEqual([]);
  });

  it('passes [name] placeholders and recorded counts of personalized suggestions', () => {
    const a = base();
    metric(a, 'D5').value.suggested_prompts = { count: 3 };
    metric(a, 'D5').note = 'Suggestions are labeled as personalized; texts not recorded.';
    expect(rules(lint(a), 'privacy')).toEqual([]);
    metric(a, 'D5').value.suggested_prompts = { count: 3, texts: ['a', 'b', 'c'] };
    expect(rules(lint(a), 'privacy')[0].message).toMatch(/personalized/);
  });
});

describe('lint: review file section', () => {
  const results = [{ slug: 'example', status: 'ok', previousSource: null, findings: [{ rule: 'banned-wording', message: '"launched"', where: 'summary sentence 2', sentence: 'It launched.' }] }];
  it('inserts the section before the first portal heading, then replaces it on a re-run', () => {
    const review = '# Analysis review\n\n| table |\n\n## Example (example)\n\nbody\n';
    const once = withLintSection(review, markdownReport('2026-10-19', results));
    expect(once.indexOf('## Lint')).toBeLessThan(once.indexOf('## Example'));
    expect(once).toContain('> It launched.');
    const twice = withLintSection(once, markdownReport('2026-10-19', []));
    expect(twice.match(/## Lint/g)).toHaveLength(1);
    expect(twice).not.toContain('It launched.');
    expect(twice).toContain('## Example (example)');
  });
});

import { describe, expect, it } from 'vitest';
import { captureMetrics } from '../../src/capture-metrics';
import { isModelNameOnly, isModelPickerItem, looksLikeModelName, MODEL_PICKER_LABEL } from '../../src/model-picker';
import { changeEntries, navChangePhrase, navChangeSentence } from '../../src/nav-changes';
import { findingLists, tableFindings } from '../../public/analytics-canvas.js';

// The input area's model picker is one item, "model picker", whatever model it shows (src/model-picker.ts).
// Display-time only: these rows are built like published analyses, and captureMetrics() normalizes them.

type Item = Record<string, unknown>;
type Change = Record<string, unknown>;
const others = { colorScheme: 'dark' };

/** A published row with an N1 value and optional changes_vs_previous, as stored by POST /api/analysis. */
function row(slug: string, week: string, items: Item[], changes: Change[] = [], previousWeek: string | null = null) {
  const analysis = {
    status: 'ok', variant: 'desktop', portal: slug, week, previous_week: previousWeek, guideline_version: '1.5.3',
    context: { color_scheme: 'dark' },
    metrics: [{ id: 'N1', sidebar: 'visible', value: items }],
    changes_vs_previous: changes,
  };
  return {
    slug, week, name: slug[0].toUpperCase() + slug.slice(1), company: '', status: 'ok', analysis: 'Summary.',
    analysis_by: 'guideline-v1.5.3', analysis_json: JSON.stringify(analysis), captured_at: `${week}T00:00:00Z`, analysis_published_at: null,
  };
}
const card = (r: ReturnType<typeof row>, label: string) => ({ label, slug: r.slug, week: r.week, metrics: { ...others, ...captureMetrics(r) } });
const sidebar = (...labels: string[]) => labels.map((label, i) => ({ label, region: 'sidebar', order: i + 1 }));
const input = (...labels: string[]) => labels.map((label, i) => ({ label, region: 'input area', order: i + 1 }));
const top = (...labels: string[]) => labels.map((label, i) => ({ label, region: 'top bar', order: i + 1 }));

describe('looksLikeModelName', () => {
  it.each([
    'Opus 5.5 High', 'Sonnet 5.5 Medium', 'Flash Extended', 'Gemini Auto', 'Fast', 'Auto', 'Instant', 'K3.1 Pro',
    'GPT-6', 'o3', 'o4-mini', 'Thinking', 'Claude Haiku 4 Low', 'Grok 4', 'DeepSeek V3', 'Qwen3.7-Plus', 'Llama 4', 'Mistral Large', 'Model',
  ])('is a model or mode name: %s', (label) => {
    expect(looksLikeModelName(label)).toBe(true);
  });

  it.each([
    'New chat', 'Projects', 'Tasks', 'Library', 'Explore', 'Search', 'Images', 'Codex', 'Think', 'Deep research',
    'Chat', 'Cowork', 'Deep Think', 'Smart Search', 'Advanced', 'Select project', '3D Make', 'PPT', 'Upgrade',
  ])('is a normal item: %s', (label) => {
    expect(looksLikeModelName(label)).toBe(false);
  });
});

describe('captureMetrics collapses the model picker', () => {
  it('lists one "model picker" item in the input area, for older data and for role "model_picker"', () => {
    const old = captureMetrics(row('claude', '2026-10-12', [...sidebar('New chat'), ...input('Chat', 'Cowork', 'Opus 5.5 High')]));
    const v16 = captureMetrics(row('claude', '2026-10-26', [...sidebar('New chat'), ...input('Chat', 'Cowork'),
      { label: 'model picker', role: 'model_picker', current: 'Sonnet 5.5 Medium', region: 'input area', order: 3 }]));
    for (const m of [old, v16]) {
      expect(m?.navItems).toEqual([
        { label: 'New chat', region: 'sidebar' },
        { label: 'Chat', region: 'input area' },
        { label: 'Cowork', region: 'input area' },
        { label: MODEL_PICKER_LABEL, region: 'input area', picker: true },
      ]);
    }
    // The model it shows is never passed on.
    expect(JSON.stringify(v16)).not.toContain('Sonnet');
  });

  it("takes a top-bar label that is only a model name as the top bar's model picker", () => {
    const m = captureMetrics(row('qwen', '2026-10-19', [{ label: 'Qwen3.7-Plus', region: 'top bar', order: 1 }]));
    expect(m?.navItems).toEqual([{ label: MODEL_PICKER_LABEL, region: 'top bar', picker: true }]);
  });

  it('flags other model-like labels outside the input area, without collapsing them', () => {
    const m = captureMetrics(row('manus', '2026-10-19', [...top('Manus 2.0 Lite'), ...sidebar('Opus 5.5 notes')]));
    expect(m?.navItems).toEqual([
      { label: 'Manus 2.0 Lite', region: 'top bar', modelName: true },
      { label: 'Opus 5.5 notes', region: 'sidebar', modelName: true },
    ]);
  });
});

describe('isModelNameOnly (top bar)', () => {
  it.each(['Auto', '自動', 'GPT-6', 'Fast', 'Qwen3.7-Plus', 'Opus 5.5 High', 'o3', 'Gemini Auto', 'Thinking', 'Claude Haiku 4 Low'])(
    'is only a model or mode name: %s', (label) => {
      expect(isModelNameOnly(label)).toBe(true);
      expect(isModelPickerItem({ label, region: 'top bar' })).toBe(true);
    });

  it.each(['Upgrade to Pro', 'Try Pro', 'Pro', 'Plus', 'Get Plus', 'Upgrade', 'Free plan - Upgrade', 'Work IQ', 'Gemini', 'Grok',
    'Grok Bot', 'Manus 2.0 Lite', 'Get app', 'Log in', 'Download desktop app', 'Private'])('is not: %s', (label) => {
    expect(isModelNameOnly(label)).toBe(false);
    expect(isModelPickerItem({ label, region: 'top bar' })).toBe(false);
  });

  it('applies to the top bar only: a sidebar "Auto" is a normal item', () => {
    expect(isModelPickerItem({ label: 'Auto', region: 'sidebar' })).toBe(false);
  });
});

describe('Copilot, Oct 26 vs Oct 19: the top bar\'s "自動" selector recorded two ways', () => {
  const bar = (picker: Item) => [{ label: 'Work IQ', region: 'top bar', order: 1 }, { ...picker, region: 'top bar', order: 2 },
    { label: null, icon_label: 'shield icon', region: 'top bar', order: 3 }];
  const oct19 = row('copilot', '2026-10-19', [...sidebar('New chat'),
    ...bar({ label: 'Auto', translated_from: 'Chinese', original_text: '自動' })]);
  const oct26 = row('copilot', '2026-10-26', [...sidebar('New chat'),
    ...bar({ label: 'model picker', role: 'model_picker', current: 'Auto (translated from Chinese)', original_text: '自動' })]);

  it('lists one model picker in the top bar both weeks', () => {
    for (const r of [oct19, oct26]) {
      expect(captureMetrics(r)?.navItems).toContainEqual({ label: MODEL_PICKER_LABEL, region: 'top bar', picker: true });
      expect(JSON.stringify(captureMetrics(r))).not.toContain('Auto');
    }
  });

  it('has no menu difference in Compare, and a similarity about the picker', () => {
    const f = tableFindings(card(oct26, 'Oct 26'), card(oct19, 'Oct 19'))!;
    expect(f.differences.join(' ')).not.toMatch(/Auto|model picker|Only on|menu items/);
    expect(f.similarities).toContain('Both show the same menu items.');
    expect(f.similarities).toContain('Both show a model picker in the bar across the top.');
  });

  it('pairs a model picker with a label that reads as a model name in the same region (Manus 2.0 Lite)', () => {
    const older = row('manus', '2026-10-12', [...sidebar('New task'), ...top('Manus 2.0 Lite', 'Upgrade')]);
    const newer = row('manus', '2026-10-26', [...sidebar('New task'),
      { label: 'model picker', role: 'model_picker', current: 'Manus 2.0 Lite', region: 'top bar', order: 1 }, ...top('Upgrade')]);
    for (const [a, b] of [[newer, older], [older, newer]]) {
      const f = tableFindings(card(a, a.week), card(b, b.week))!;
      expect(f.differences.join(' ')).not.toMatch(/Manus 2\.0|model picker|Only on/);
      expect(f.similarities).toContain('Both show a model picker in the bar across the top.');
    }
  });

  it('does not pair across regions', () => {
    const older = row('manus', '2026-10-12', [...sidebar('Manus 2.0 Lite')]);
    const newer = row('manus', '2026-10-26', [{ label: 'model picker', role: 'model_picker', region: 'top bar', order: 1 }]);
    expect(tableFindings(card(newer, 'Oct 26'), card(older, 'Oct 12'))!.differences).toEqual([
      'Only on Oct 12: Manus 2.0 Lite (in the side menu).',
      'Only on Oct 26: a model picker (in the bar across the top).',
    ]);
  });
});

describe('an "Upgrade to Pro" top-bar link is not a model picker', () => {
  const oct19 = row('chatgpt', '2026-10-19', [...sidebar('New chat'), ...top('Upgrade to Pro')]);
  const oct26 = row('chatgpt', '2026-10-26', [...sidebar('New chat'),
    { label: 'model picker', role: 'model_picker', current: 'GPT-6', region: 'top bar', order: 1 }]);

  it('stays a normal item', () => {
    expect(captureMetrics(oct19)?.navItems).toContainEqual({ label: 'Upgrade to Pro', region: 'top bar' });
  });

  it('is never paired with the other week\'s picker', () => {
    expect(tableFindings(card(oct26, 'Oct 26'), card(oct19, 'Oct 19'))!.differences).toEqual([
      'Only on Oct 19: Upgrade to Pro (in the bar across the top).',
      'Only on Oct 26: a model picker (in the bar across the top).',
    ]);
  });

  it('nor in recorded changes', () => {
    const changed = row('chatgpt', '2026-10-26', [], [
      { id: 'N1', change: 'removed', previous: 'Upgrade to Pro', current: null, region: 'top bar', status: 'changed', note: '' },
      { id: 'N1', change: 'added', previous: null, current: 'model picker', region: 'top bar', status: 'changed', note: '' },
    ], '2026-10-19');
    expect(captureMetrics(changed)?.navChanges?.items.map(navChangePhrase)).toEqual([
      'Upgrade to Pro removed from the bar across the top', 'Model picker added to the bar across the top',
    ]);
  });
});

describe('recorded changes between the two ways of recording a top-bar picker', () => {
  it('drops a rename from a model name to "model picker", and a removed + added pair', () => {
    const renamed = row('copilot', '2026-10-26', [], [
      { id: 'N1', change: 'renamed', previous: 'Auto', current: 'model picker', region: 'top bar', status: 'changed', note: '' },
    ], '2026-10-19');
    const pair = row('manus', '2026-10-26', [], [
      { id: 'N1', change: 'removed', previous: 'Manus 2.0 Lite', current: null, region: 'top bar', status: 'changed', note: '' },
      { id: 'N1', change: 'added', previous: null, current: 'model picker', region: 'top bar', status: 'changed', note: '' },
    ], '2026-10-12');
    expect(captureMetrics(renamed)?.navChanges?.items).toEqual([]);
    expect(captureMetrics(pair)?.navChanges?.items).toEqual([]);
    expect(changeEntries([renamed, pair])).toEqual([]);
  });
});

describe('Claude, Oct 19 vs Oct 12 (Opus 5.5 High vs Sonnet 5.5 Medium)', () => {
  const oct12 = row('claude', '2026-10-12', [...sidebar('New', 'Search'), ...input('Chat', 'Cowork', 'Opus 5.5 High')]);
  const oct19 = row('claude', '2026-10-19', [...sidebar('New', 'Search'), ...input('Chat', 'Cowork', 'Sonnet 5.5 Medium')],
    [{ id: 'N1', change: 'renamed', previous: 'Opus 5.5 High', current: 'Sonnet 5.5 Medium', region: 'input area', status: 'possibly_confounded', note: '' }],
    '2026-10-12');

  it('has no difference about it, and Similarities mention the model picker', () => {
    const { differences, similarities } = findingLists(card(oct19, 'Oct 19'), card(oct12, 'Oct 12'));
    expect(differences.join(' ')).not.toMatch(/Opus|Sonnet|model picker|menu items/);
    expect(similarities).toContain('Both show a model picker in the message box.');
  });

  it('even when an analysis recorded the rename as changed', () => {
    const changed = row('claude', '2026-10-19', [...sidebar('New', 'Search'), ...input('Chat', 'Cowork', 'Sonnet 5.5 Medium')],
      [{ id: 'N1', change: 'renamed', previous: 'Opus 5.5 High', current: 'Sonnet 5.5 Medium', region: 'input area', status: 'changed', note: '' }],
      '2026-10-12');
    expect(captureMetrics(changed)?.navChanges).toEqual({ previousWeek: '2026-10-12', items: [] });
    expect(findingLists(card(changed, 'Oct 19'), card(oct12, 'Oct 12')).differences.join(' ')).not.toMatch(/Opus|Sonnet|model picker/);
  });
});

describe('Gemini, Flash Extended -> Gemini Auto', () => {
  const oct5 = row('gemini', '2026-10-05', [...sidebar('New chat'), ...input('Flash Extended')]);
  const oct12 = row('gemini', '2026-10-12', [...sidebar('New chat'), ...input('Gemini Auto')],
    [{ id: 'N1', change: 'renamed', previous: 'Flash Extended', current: 'Gemini Auto', region: 'input area', status: 'changed', note: '' }],
    '2026-10-05');

  it('has no rename line in the Table/Canvas findings', () => {
    for (const brief of [false, true]) {
      const { differences } = findingLists(card(oct12, 'Oct 12'), card(oct5, 'Oct 5'), { navChangeLines: Infinity, brief });
      expect(differences.join(' ')).not.toMatch(/Flash|Gemini Auto|labeled|model picker/);
    }
  });

  it('has no entry in the portal timeline or /changes', () => {
    expect(changeEntries([oct12, oct5])).toEqual([]);
  });

  it('drops a removed + added pair of model names too', () => {
    const pair = row('gemini', '2026-10-12', input('Gemini Auto'), [
      { id: 'N1', change: 'removed', previous: 'Flash Extended', current: null, region: 'input area', status: 'changed', note: '' },
      { id: 'N1', change: 'added', previous: null, current: 'Gemini Auto', region: 'input area', status: 'changed', note: '' },
    ], '2026-10-05');
    expect(captureMetrics(pair)?.navChanges?.items).toEqual([]);
  });
});

describe('a model picker in one week only', () => {
  const oct5 = row('grok', '2026-10-05', sidebar('Chat', 'Imagine'));
  const oct12 = row('grok', '2026-10-12', [...sidebar('Chat', 'Imagine'), ...input('Fast')],
    [{ id: 'N1', change: 'added', previous: null, current: 'Fast', region: 'input area', status: 'changed', note: '' }], '2026-10-05');

  it('is a recorded change: "A model picker now appears in the message box"', () => {
    const nc = captureMetrics(oct12)?.navChanges;
    expect(nc?.items).toEqual([{ change: 'added', previous: null, current: MODEL_PICKER_LABEL, region: 'input area', picker: true }]);
    expect(findingLists(card(oct12, 'Oct 12'), card(oct5, 'Oct 5')).differences).toContain('A model picker now appears in the message box.');
    expect(navChangeSentence(nc!.items[0])).toBe('a model picker now appears in the message box.');
    expect(changeEntries([oct12, oct5]).map((e) => e.phrase)).toEqual(['Model picker added to the message box']);
  });

  it('shows as a difference when items are compared without recorded changes', () => {
    const noChanges = row('grok', '2026-10-12', [...sidebar('Chat', 'Imagine'), ...input('Fast')]);
    expect(findingLists(card(noChanges, 'Oct 12'), card(oct5, 'Oct 5')).differences)
      .toContain('Only on Oct 12: a model picker (in the message box).');
  });

  it('disappearing is a change too', () => {
    const gone = row('grok', '2026-10-19', sidebar('Chat', 'Imagine'),
      [{ id: 'N1', change: 'removed', previous: 'Fast', current: null, region: 'input area', status: 'changed', note: '' }], '2026-10-12');
    const c = captureMetrics(gone)!.navChanges!.items[0];
    expect(navChangeSentence(c)).toBe('the model picker no longer appears in the message box.');
    expect(navChangePhrase(c)).toBe('Model picker removed from the message box');
  });
});

describe('real menu renames still show', () => {
  const oct5 = row('chatgpt', '2026-10-05', sidebar('New chat', 'Scheduled', 'More'));
  const oct12 = row('chatgpt', '2026-10-12', sidebar('New chat', 'Tasks', 'Explore'), [
    { id: 'N1', change: 'renamed', previous: 'Scheduled', current: 'Tasks', region: 'sidebar', status: 'changed', note: '' },
    { id: 'N1', change: 'renamed', previous: 'More', current: 'Explore', region: 'sidebar', status: 'changed', note: '' },
  ], '2026-10-05');

  it('in the Table/Canvas findings and the timeline', () => {
    expect(findingLists(card(oct12, 'Oct 12'), card(oct5, 'Oct 5')).differences.slice(0, 2)).toEqual([
      'The Scheduled item in the side menu is now labeled Tasks.', 'The More item in the side menu is now labeled Explore.',
    ]);
    expect(changeEntries([oct12, oct5]).map((e) => e.phrase)).toEqual(['Scheduled renamed to Tasks', 'More renamed to Explore']);
  });

  it('including a rename between a model name and a normal item, as a picker change plus an item change', () => {
    const r = row('meta-ai', '2026-10-12', input('Quick answer'),
      [{ id: 'N1', change: 'renamed', previous: 'Instant', current: 'Quick answer', region: 'input area', status: 'changed', note: '' }], '2026-10-05');
    expect(captureMetrics(r)?.navChanges?.items.map(navChangePhrase)).toEqual(['Quick answer added to the message box', 'Model picker removed from the message box']);
  });
});

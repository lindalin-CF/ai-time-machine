import { describe, expect, it } from 'vitest';
import { captureMetrics } from '../../src/capture-metrics';
import { looksLikeModelName, MODEL_PICKER_LABEL } from '../../src/model-picker';
import { changeEntries, navChangePhrase, navChangeSentence } from '../../src/nav-changes';
import { findingLists } from '../../public/analytics-canvas.js';

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

  it('leaves model-like labels outside the input area alone', () => {
    const m = captureMetrics(row('qwen', '2026-10-19', [{ label: 'Qwen3.7-Plus', region: 'top bar', order: 1 }]));
    expect(m?.navItems).toEqual([{ label: 'Qwen3.7-Plus', region: 'top bar' }]);
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
    expect(similarities).toContain('Both show a model picker in the input area.');
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

  it('is a recorded change: "A model picker now appears in the input area"', () => {
    const nc = captureMetrics(oct12)?.navChanges;
    expect(nc?.items).toEqual([{ change: 'added', previous: null, current: MODEL_PICKER_LABEL, region: 'input area', picker: true }]);
    expect(findingLists(card(oct12, 'Oct 12'), card(oct5, 'Oct 5')).differences).toContain('A model picker now appears in the input area.');
    expect(navChangeSentence(nc!.items[0])).toBe('a model picker now appears in the input area.');
    expect(changeEntries([oct12, oct5]).map((e) => e.phrase)).toEqual(['Model picker added to the input area']);
  });

  it('shows as a difference when items are compared without recorded changes', () => {
    const noChanges = row('grok', '2026-10-12', [...sidebar('Chat', 'Imagine'), ...input('Fast')]);
    expect(findingLists(card(noChanges, 'Oct 12'), card(oct5, 'Oct 5')).differences)
      .toContain('Oct 12 shows menu items that Oct 5 does not: a model picker (input area).');
  });

  it('disappearing is a change too', () => {
    const gone = row('grok', '2026-10-19', sidebar('Chat', 'Imagine'),
      [{ id: 'N1', change: 'removed', previous: 'Fast', current: null, region: 'input area', status: 'changed', note: '' }], '2026-10-12');
    const c = captureMetrics(gone)!.navChanges!.items[0];
    expect(navChangeSentence(c)).toBe('the model picker no longer appears in the input area.');
    expect(navChangePhrase(c)).toBe('Model picker removed from the input area');
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
      'The sidebar item Scheduled is now labeled Tasks.', 'The sidebar item More is now labeled Explore.',
    ]);
    expect(changeEntries([oct12, oct5]).map((e) => e.phrase)).toEqual(['Scheduled renamed to Tasks', 'More renamed to Explore']);
  });

  it('including a rename between a model name and a normal item, as a picker change plus an item change', () => {
    const r = row('meta-ai', '2026-10-12', input('Quick answer'),
      [{ id: 'N1', change: 'renamed', previous: 'Instant', current: 'Quick answer', region: 'input area', status: 'changed', note: '' }], '2026-10-05');
    expect(captureMetrics(r)?.navChanges?.items.map(navChangePhrase)).toEqual(['Quick answer added to the input area', 'Model picker removed from the input area']);
  });
});

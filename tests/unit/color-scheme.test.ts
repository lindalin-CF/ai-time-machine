import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleFacts } from '../../src/facts-page';
import { handleChanges, handlePortalPage } from '../../src/portal-page';
import { handleWeeks } from '../../src/week-page';
import { handleComparePage } from '../../src/compare-page';
import { handleLlmsFullTxt, handleLlmsTxt } from '../../src/aeo';
import { buildVoiceContext } from '../../src/voice-context';
import { captureMetrics } from '../../src/capture-metrics';
import { listPortals, publishedCaptures } from '../../src/db';
import { findingLists, tableFindings } from '../../public/analytics-canvas.js';
import { makeEnv } from './fake-env';

// The color scheme (dark / light) follows the capture machine's system setting, not the product: it stays in the
// stored data (captureMetrics().colorScheme) but never reaches visitor-facing text or a comparison.

const ORIGIN = 'https://ai-portal-library.dev';
const SKILL = readFileSync(new URL('../../.claude/skills/portal-design-analysis/SKILL.md', import.meta.url), 'utf8');
const COLOR = /\b(?:dark|light)\b|color scheme|colour scheme|captured in \w+ mode|\btheme\b/i;
const OLD = '2026-10-12', NEW = '2026-10-19';

let t: ReturnType<typeof makeEnv>;

function analysis(slug: string, week: string, scheme: string, previous: string | null) {
  return {
    guideline_version: '1.9.0', portal: slug, week, previous_week: previous, variant: 'desktop', status: 'ok',
    context: { color_scheme: scheme },
    metrics: [
      { id: 'N1', sidebar: 'visible', value: [{ label: 'New chat', region: 'sidebar' }] },
      { id: 'L2', value: '20%' }, { id: 'L3', value: { vertical_third: 'middle' } }, { id: 'H3', value: 4 },
      { id: 'D5', value: { suggested_prompts: 2 } }, { id: 'D6', value: 'none' },
    ],
    changes_vs_previous: previous ? [{ id: 'N1', status: 'changed', region: 'sidebar', change: 'added', previous: null, current: 'Projects' }] : [],
    summary: `This shows the desktop version of ${slug} for the week of ${week}, before scrolling. The message box stands out most.`,
  };
}
function addCapture(slug: string, week: string, scheme: string, previous: string | null) {
  const a = analysis(slug, week, scheme, previous);
  t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
  t.db.prepare(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, analysis_json, analysis_published_at, status, captured_at, plan)
                VALUES (?, ?, ?, ?, 'Co', 'https://example.com/', '#000000', ?, ?, 'guideline-v1.9.0', ?, ?, 'ok', ?, 'Free')`)
    .run(`${slug}-${week}`, week, slug, slug, `shots/${week}/${slug}.local.png`, a.summary, JSON.stringify(a), `${week}T20:00:00Z`, `${week}T09:00:00Z`);
}

beforeEach(() => {
  t = makeEnv(); // has Claude
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand, sort_order) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f', 0)`);
  // ChatGPT switches from light to dark; Claude stays dark. Both add a menu item in NEW.
  addCapture('chatgpt', OLD, 'light', null);
  addCapture('chatgpt', NEW, 'dark', OLD);
  addCapture('claude', OLD, 'dark', null);
  addCapture('claude', NEW, 'dark', OLD);
});

/** Page text a visitor or crawler reads: inline styles and scripts other than JSON-LD removed. */
const visible = (s: string) => s.replace(/<style>[\s\S]*?<\/style>|<script(?! type="application\/ld\+json")[\s\S]*?<\/script>/g, '');
const get = async (handler: (r: Request, e: typeof t.env) => Promise<Response>, path: string) => visible(await (await handler(new Request(`${ORIGIN}${path}`), t.env)).text());

describe('no color-scheme wording on any page', () => {
  it('keeps the field in the stored data', async () => {
    const rows = await publishedCaptures(t.env);
    expect(captureMetrics(rows.find((r) => r.slug === 'chatgpt' && r.week === NEW)!)!.colorScheme).toBe('dark');
  });

  const pages: [string, (r: Request, e: ReturnType<typeof makeEnv>['env']) => Promise<Response>][] = [
    ['/facts', handleFacts], ['/facts.md', handleFacts],
    ['/llms.txt', (r, e) => handleLlmsTxt(r, e)], ['/llms-full.txt', (r, e) => handleLlmsFullTxt(r, e)],
    [`/weeks/${NEW}`, handleWeeks], [`/weeks/${NEW}.md`, handleWeeks],
    ['/portals/chatgpt', handlePortalPage], ['/portals/chatgpt.md', handlePortalPage], [`/portals/chatgpt/${NEW}.md`, handlePortalPage],
    ['/compare/chatgpt-vs-claude', handleComparePage], ['/compare/chatgpt-vs-claude.md', handleComparePage],
    ['/changes', handleChanges],
  ];
  for (const [path, handler] of pages) {
    it(path, async () => {
      expect(await get(handler, path)).not.toMatch(COLOR);
    });
  }

  it('the voice guide context', async () => {
    const text = buildVoiceContext(await listPortals(t.env), await publishedCaptures(t.env), { links: true });
    expect(text).not.toMatch(COLOR);
  });
});

describe('no color scheme in comparison findings', () => {
  it('neither a difference (light vs dark) nor a similarity (both dark)', async () => {
    const rows = await publishedCaptures(t.env);
    const card = (slug: string, week: string) => ({ label: `${slug} ${week}`, slug, week, metrics: captureMetrics(rows.find((r) => r.slug === slug && r.week === week)!) });
    for (const [a, b] of [[card('chatgpt', NEW), card('chatgpt', OLD)], [card('chatgpt', NEW), card('claude', NEW)], [card('claude', NEW), card('claude', OLD)]]) {
      for (const brief of [false, true]) {
        const f = findingLists(a, b, { brief });
        expect([...f.differences, ...f.similarities, ...f.missing].join(' ')).not.toMatch(COLOR);
      }
      const tf = tableFindings(a, b)!;
      expect([...tf.differences, ...tf.similarities].join(' ')).not.toMatch(COLOR);
    }
  });
});

describe('guideline (SKILL.md)', () => {
  it('is version 1.9.0 and says the color scheme is the capture machine\'s setting, never in summaries or comparisons', () => {
    expect(SKILL).toMatch(/^---[\s\S]*?\nversion: 1\.9\.0\n/);
    expect(SKILL).toContain('"guideline_version": "1.9.0"');
    expect(SKILL).toContain('**只反映截圖那台電腦當時的系統外觀設定，不是產品的特性**');
    expect(SKILL).toContain('不得出現在摘要、`note` 的比較文字或任何跨 portal／跨週比較中');
    expect(SKILL).toContain('| 把深淺色外觀說成產品特性 | dark screen、light screen、dark mode、light mode、dark theme、light theme |');
    expect(SKILL).toMatch(/- \*\*1\.9\.0\*\*：`color_scheme` 只反映截圖電腦當時的系統外觀設定/);
  });
});

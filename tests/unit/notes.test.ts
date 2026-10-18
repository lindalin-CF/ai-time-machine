import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleApi } from '../../src/api';
import { makeEnv } from './fake-env';

// The Notes view was retired on 2026-10-18: the top bar links to /changelog instead, and #notes / #insights links
// redirect there. The notes data and its API stay (src/api.ts, scripts/local-capture/post-note.mjs).

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
const API_TS = readFileSync(new URL('../../src/api.ts', import.meta.url), 'utf8');

describe('Notes view (retired)', () => {
  it('the homepage has no Notes view, link or code', () => {
    expect(html).not.toContain('insightsView');
    expect(html).not.toContain('href="#notes"');
    expect(html).not.toMatch(/>\s*(Notes|Insights)\s*</);
    expect(appJs).not.toMatch(/loadInsights|renderInsightsList|#insightsList|\/api\/insights/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/insight|data-view="notes"/); // rules, not comments
  });

  it('#notes and #insights links go to /changelog from the <head> script and from route()', () => {
    const head = html.match(/<script>\(function\(h,i\)[\s\S]*?<\/script>/)![0];
    expect(head).toContain('if(h==="#notes"||h==="#insights"){document.documentElement.dataset.view="leaving";location.replace("/changelog");return}');
    expect(appJs).toContain('if (/^#(notes|insights)$/.test(hashRoute(location.hash))) { location.replace("/changelog"); return; }');
  });

  it('keeps the notes API, with a note that the view was retired', async () => {
    const t = makeEnv();
    t.db.exec(`INSERT INTO insights (id, title, description, images, created_at) VALUES ('n1', 'A note', 'Text', '[]', '2026-09-13T10:00:00Z')`);
    const res = await handleApi(new Request('https://x/api/insights'), t.env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect(res.status).toBe(200);
    const { insights } = await res.json() as { insights: { id: string; title: string }[] };
    expect(insights.map((n) => [n.id, n.title])).toEqual([['n1', 'A note']]);
    expect(API_TS).toContain('The site\'s Notes view was retired on 2026-10-18');
    expect(API_TS).toContain('if (path === "/api/insights/upload" && request.method === "POST")');
  });

  it('reads as a personal project, with no colleague, teammate or team wording', () => {
    for (const text of [html, appJs]) expect(text).not.toMatch(/colleague|teammate|\bteams?\b/i);
  });
});

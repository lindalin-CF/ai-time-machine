import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleHowWeAnalyze, handlePortalPage, handleSitemap } from '../../src/portal-page';
import { makeEnv } from './fake-env';
import { expectFooterDialogs } from './footer-dialogs';

const URL_ = 'https://ai-portal-library.dev/how-we-analyze';
const LINK = '<a href="/how-we-analyze">How this analysis is made</a>';

const get = (method = 'GET') => handleHowWeAnalyze(new Request('https://x/how-we-analyze', { method }));

describe('/how-we-analyze', () => {
  let html: string;
  beforeEach(async () => { html = await (await get()).text(); });

  it('has its own title, meta description and canonical URL', () => {
    expect(html).toContain('<title>How we analyze | AI Interface Library</title>');
    const description = html.match(/<meta name="description" content="([^"]+)" \/>/)![1];
    expect(description).toMatch(/^How AI Interface Library captures AI product screens each week/);
    expect(html).toContain(`<link rel="canonical" href="${URL_}" />`);
    expect(html).toContain(`<meta property="og:url" content="${URL_}" />`);
    expect(html).not.toContain('noindex');
  });

  it('uses the portal page template, header and footer', () => {
    expect(html).toContain('<header><a href="/">&larr; AI Interface Library</a></header>');
    expect(html).toContain('Independent personal project. Not affiliated with any of the companies featured.');
    expectFooterDialogs(html);
  });

  it('has the exact content, in order', () => {
    const text = html.match(/<main class="howto">([\s\S]*?)<\/main>/)![1]
      .replace(/<[^>]+>/g, '\n').replace(/&#39;/g, "'").split('\n').map((l) => l.trim()).filter(Boolean);
    expect(text).toEqual([
      'How we analyze',
      'Each week, this site captures the screen of each AI product right after signing in, on a desktop screen 1280 by 800 pixels, before scrolling. Each screenshot then gets a short design analysis.',
      'What we look at',
      'Layout: where the main areas sit, such as the sidebar and the message box, and how much of the screen they take.',
      'What stands out most: which items carry the most visual weight, based on their size and contrast.',
      'Text and color: whether text is light or dark enough against its background to meet common accessibility guidelines.',
      'Where you start: the message box, suggested prompts, and whether the product says it can make mistakes.',
      'How we measure',
      'Colors, contrast and sizes are measured from the screenshot pixels with a script, using the contrast formula from the Web Content Accessibility Guidelines (WCAG 2.2). Other observations, such as what stands out most, are made by an AI model following a fixed checklist. A person reviews every analysis before it is published.',
      "What we don't claim",
      'An analysis only describes what is visible in one screenshot. It does not judge whether a product is easy to use, predict what people will do, or certify that a product meets accessibility standards. Measurements taken from a screenshot are close estimates, not official test results. Mobile screenshots are shown but not analyzed.',
      'Week-to-week changes',
      "When the previous week's analysis exists, the two weeks are compared. Differences that could come from the account, the time of day or a rotating greeting are not reported as redesigns.",
      'Special cases',
      'Kimi is captured while signed out, because no account is used for it. Muse always opens on a conversation, so only the interface around it is analyzed.',
      'Privacy',
      'Screenshots come from real accounts. Names, conversation titles and other account details are left out of every analysis, and are covered in the screenshots where possible.',
      'Sources',
      'W3C, Web Content Accessibility Guidelines (WCAG) 2.2',
      'Nielsen Norman Group, visual hierarchy in UX',
      'Amershi et al., Guidelines for Human-AI Interaction (CHI 2019)',
    ]);
    const main = html.match(/<main class="howto">[\s\S]*?<\/main>/)![0];
    expect(main.match(/<h1>/g)).toHaveLength(1);
    expect(main.match(/<h2>/g)).toHaveLength(7);
  });

  it('links each source to its official page', () => {
    expect(html).toContain('<li><a href="https://www.w3.org/TR/WCAG22/">W3C, Web Content Accessibility Guidelines (WCAG) 2.2</a></li>');
    expect(html).toContain('<li><a href="https://www.nngroup.com/articles/visual-hierarchy-ux-definition/">Nielsen Norman Group, visual hierarchy in UX</a></li>');
    expect(html).toContain('<li><a href="https://doi.org/10.1145/3290605.3300233">Amershi et al., Guidelines for Human-AI Interaction (CHI 2019)</a></li>');
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    expect(await (await get('HEAD')).text()).toBe('');
    expect((await get('POST')).status).toBe(405);
  });

  it('is routed to the Worker', () => {
    const wrangler = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(wrangler).toMatch(/"run_worker_first": \[[^\]]*"\/how-we-analyze", "\/how-we-analyze\/"/);
  });
});

describe('links to /how-we-analyze', () => {
  let t: ReturnType<typeof makeEnv>;
  beforeEach(() => {
    t = makeEnv();
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('2026-09-21', 'Week of Sep 21, 2026', '2026-09-21T00:00:00Z')`);
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
               VALUES ('claude-2026-09-21', '2026-09-21', 'claude', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757',
                       'shots/2026-09-21/claude.local.png', '', 'pending', '2026-09-21T09:00:00Z')`);
  });

  it('sits under the Design analysis section on portal pages', async () => {
    for (const path of ['/portals/claude', '/portals/claude/2026-09-21']) {
      const html = await (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();
      const section = html.match(/<section class="analysis">[\s\S]*?<\/section>/)![0];
      expect(section).toMatch(new RegExp(`<h2>Design analysis</h2><p>[^<]*</p><p class="method">${LINK}</p></section>$`));
    }
  });

  it('sits under the Design analysis text on every homepage card', () => {
    const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
    const card = app.match(/function card\(c\) \{[\s\S]*?\n\}/)![0];
    expect(card).toContain(`<a class="analysis-method" href="/how-we-analyze">How this analysis is made</a>`);
    expect(card.indexOf('analysis-method')).toBeGreaterThan(card.indexOf('<div class="analysis-label">Design analysis</div>'));
  });

  it('ends the Disclaimer dialog on the homepage', () => {
    const index = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    expectFooterDialogs(index);
  });

  it('is in the sitemap', async () => {
    const xml = await (await handleSitemap(t.env)).text();
    expect(xml).toContain(`<loc>${URL_}</loc>`);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { handlePortalPage } from '../../src/portal-page';
import { makeEnv } from './fake-env';

const SLUG = 'claude';
const WEEK = '2026-09-21';

let t: ReturnType<typeof makeEnv>;

beforeEach(() => {
  t = makeEnv();
  t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${WEEK}', 'Week of Sep 21, 2026', '2026-09-21T00:00:00Z')`);
  t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
             VALUES ('${SLUG}-${WEEK}', '${WEEK}', '${SLUG}', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757',
                     'shots/${WEEK}/${SLUG}.local.png', '', 'pending', '2026-09-21T09:00:00Z')`);
});

const PAGES = [`/portals/${SLUG}`, `/portals/${SLUG}/${WEEK}`, '/portals/no-such-portal'];

describe.each(PAGES)('portal page %s', (path) => {
  let html: string;
  beforeEach(async () => {
    html = await (await handlePortalPage(new Request(`https://x${path}`), t.env)).text();
  });

  it('uses the new site name only', () => {
    expect(html).toContain('AI Interface Library');
    expect(html).not.toContain('AI Surface Library');
    expect(html).toContain('<header><a href="/">&larr; AI Interface Library</a></header>');
  });

  it('keeps the footer sentence and adds the copyright line', () => {
    expect(html).toContain('Independent personal project. Not affiliated with any of the companies featured.');
    expect(html).toContain('&copy; 2026 AI Interface Library. All rights reserved. &middot; <button type="button" class="linkbtn" data-open-disclaimer aria-haspopup="dialog">Disclaimer</button> &middot; <a class="linkbtn" href="mailto:contact@ai-portal-library.dev">Contact</a>');
  });

  it('has one Contact mailto link styled like the Disclaimer button', () => {
    expect(html.match(/<a [^>]*>Contact<\/a>/g)).toEqual(['<a class="linkbtn" href="mailto:contact@ai-portal-library.dev">Contact</a>']);
  });

  it('includes the Disclaimer dialog, closed by default', () => {
    const dialog = html.match(/<dialog\b[^>]*>[\s\S]*?<\/dialog>/)?.[0];
    expect(dialog).toBeDefined();
    const openTag = dialog!.match(/<dialog\b[^>]*>/)![0];
    expect(openTag).toContain('id="disclaimer"');
    expect(openTag).toContain('aria-labelledby="disclaimer-title"');
    expect(openTag).not.toMatch(/\sopen\b/);
    expect(dialog).toContain('<h2 id="disclaimer-title">Disclaimer</h2>');
    expect(dialog).toContain('<p>Product screenshots, logos, and trademarks belong to their respective owners. AI Interface Library is an independent project, unaffiliated with the brands featured.</p>');
    expect(dialog).toContain('<p>Content is for reference and research. Screenshots may differ from current interfaces.</p>');
    expect(dialog).toContain('<form method="dialog">');
    expect(dialog).toContain('aria-label="Close">&times;</button>');
    expect(dialog).toContain('>Close</button>');
    expect(html).toContain('<script src="/disclaimer.js" defer></script>');
    expect(html).not.toMatch(/showModal\(|\.show\(/); // nothing opens it on load
  });
});

it('uses the new name in the portal page title and og:site_name', async () => {
  const html = await (await handlePortalPage(new Request(`https://x/portals/${SLUG}`), t.env)).text();
  expect(html).toContain(`<title>Claude — logged-in UI screenshots | AI Interface Library</title>`);
  expect(html).toContain('<meta property="og:site_name" content="AI Interface Library" />');
});

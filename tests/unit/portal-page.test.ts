import { beforeEach, describe, expect, it } from 'vitest';
import { handlePortalPage } from '../../src/portal-page';
import { makeEnv } from './fake-env';
import { expectFooterDialogs, LEGAL_LINE } from './footer-dialogs';

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
    const sentence = html.indexOf('Independent personal project. Not affiliated with any of the companies featured.');
    expect(sentence).toBeGreaterThan(-1);
    expect(html.indexOf(LEGAL_LINE)).toBeGreaterThan(sentence);
  });

  it('has the Disclaimer and Contact dialogs, closed by default', () => {
    expectFooterDialogs(html);
  });
});

it('uses the new name in the portal page title and og:site_name', async () => {
  const html = await (await handlePortalPage(new Request(`https://x/portals/${SLUG}`), t.env)).text();
  expect(html).toContain(`<title>Claude interface screenshots — weekly UI history | AI Interface Library</title>`);
  expect(html).toContain('<meta property="og:site_name" content="AI Interface Library" />');
});

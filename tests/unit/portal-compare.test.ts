import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { compareWeeksHash, handlePortalPage } from '../../src/portal-page';
import { buildAnalyticsHash } from '../../public/analytics-share.js';
import { makeEnv } from './fake-env';
import { frames, openSite, probe } from './analytics-page';

// The Compare button on portal pages (src/portal-page.ts): it opens Compare in Single portal, Canvas, desktop, for the
// portal and two weeks: the shown week and the next newer one, or the previous one on the hub and the latest week.

const WEEKS = ['2026-10-12', '2026-10-05', '2026-09-28']; // newest first
const ORIGIN = 'https://ai-portal-library.dev';

function seed(t: ReturnType<typeof makeEnv>) {
  t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f')`);
  for (const week of WEEKS) {
    t.db.exec(`INSERT INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
    t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
               VALUES ('chatgpt-${week}', '${week}', 'chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/', '#10a37f',
                       'shots/${week}/chatgpt.local.png', '', 'pending', '${week}T09:00:00Z')`);
  }
  // Claude has one capture only.
  t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, captured_at)
             VALUES ('claude-${WEEKS[0]}', '${WEEKS[0]}', 'claude', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757',
                     'shots/${WEEKS[0]}/claude.local.png', '', 'pending', '${WEEKS[0]}T09:00:00Z')`);
}

const render = async (env: ReturnType<typeof makeEnv>['env'], path: string, origin = 'https://x') =>
  (await handlePortalPage(new Request(`${origin}${path}`), env)).text();
/** The Compare link's href as it appears in the HTML (& escaped). */
const href = (newer: string, older: string) =>
  `/#compare?view=canvas&amp;mode=time&amp;portal=chatgpt&amp;weeks=${newer},${older}&amp;device=desktop`;
const cta = (html: string) => html.match(/<a class="btn-secondary compare-cta"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? null;

describe('portal page Compare button', () => {
  let t: ReturnType<typeof makeEnv>;
  beforeEach(() => { t = makeEnv(); seed(t); });

  it('on the hub: latest and previous week, labelled for screen readers, at the end of the week links\' row', async () => {
    const html = await render(t.env, '/portals/chatgpt');
    expect(cta(html)).toBe(`<a class="btn-secondary compare-cta" href="${href(WEEKS[0], WEEKS[1])}" aria-label="Compare ChatGPT week by week">Compare <span class="arrow" aria-hidden="true">&rarr;</span></a>`);
    expect(html).toMatch(/<div class="weeknav-row">\s*<nav class="weeknav" aria-label="ChatGPT weekly captures">[\s\S]*?<\/nav>\s*<a class="btn-secondary compare-cta"[^>]*>[\s\S]*?<\/a>\s*<\/div>/);
    expect(html).toMatch(/<p class="meta">OpenAI &middot; captured week of [^<]+<\/p>\n/); // the meta line is back to itself
  });

  it('on the latest week\'s page: latest and previous week too', async () => {
    expect(cta(await render(t.env, `/portals/chatgpt/${WEEKS[0]}`))).toContain(`href="${href(WEEKS[0], WEEKS[1])}"`);
  });

  it('on an older week\'s page: the next week, then the shown week', async () => {
    expect(cta(await render(t.env, `/portals/chatgpt/${WEEKS[1]}`))).toContain(`href="${href(WEEKS[0], WEEKS[1])}"`);
    expect(cta(await render(t.env, `/portals/chatgpt/${WEEKS[2]}`))).toContain(`href="${href(WEEKS[1], WEEKS[2])}"`);
  });

  it('is not shown for a portal with one capture, or none', async () => {
    t.db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('empty', 'Empty', 'Nobody', 'https://x/', '#000000')`);
    for (const path of ['/portals/claude', `/portals/claude/${WEEKS[0]}`, '/portals/empty']) {
      const html = await render(t.env, path);
      expect(html, path).not.toContain('compare-cta');
      expect(html, path).not.toContain('weeknav-row');
    }
  });

  it('uses the Copy link format, so Compare opens it as a shared link', () => {
    expect(compareWeeksHash('chatgpt', [WEEKS[0], WEEKS[1]]))
      .toBe(buildAnalyticsHash({ view: 'canvas', mode: 'weeks', portal: 'chatgpt', weeks: [WEEKS[0], WEEKS[1]], device: 'desktop', canvas: null }));
  });

  it('escapes the portal name in the label', async () => {
    t.db.exec(`UPDATE portals SET name = 'Chat<GPT> & Co' WHERE slug = 'chatgpt'`);
    expect(cta(await render(t.env, '/portals/chatgpt'))).toContain('aria-label="Compare Chat&lt;GPT&gt; &amp; Co week by week"');
  });

  it('the Markdown version has the same link, as an absolute URL', async () => {
    const line = (md: string) => md.split('\n').find((l) => l.includes('Compare week by week'));
    expect(line(await render(t.env, '/portals/chatgpt.md')))
      .toBe(`- Compare week by week: ${ORIGIN}/#compare?view=canvas&mode=time&portal=chatgpt&weeks=${WEEKS[0]},${WEEKS[1]}&device=desktop`);
    expect(line(await render(t.env, `/portals/chatgpt/${WEEKS[2]}.md`)))
      .toBe(`- Compare week by week: ${ORIGIN}/#compare?view=canvas&mode=time&portal=chatgpt&weeks=${WEEKS[1]},${WEEKS[2]}&device=desktop`);
    expect(line(await render(t.env, '/portals/claude.md'))).toBeUndefined();
  });
});

describe('portal page Compare button (browser)', () => {
  let browser: Browser;
  let pages: Record<string, string>;
  beforeAll(async () => {
    browser = await chromium.launch();
    const t = makeEnv();
    seed(t);
    pages = {};
    for (const path of ['/portals/chatgpt', `/portals/chatgpt/${WEEKS[1]}`]) pages[path] = await render(t.env, path, 'https://site.test');
  });
  afterAll(async () => { await browser?.close(); });

  const open = (path: string, opts: { width?: number; probe?: boolean } = {}) =>
    openSite(browser, path.slice(1), { pages, weeks: WEEKS, width: opts.width, initScript: opts.probe ? probe('#analyticsView', 'compare') : undefined });

  /** What Compare shows. */
  const compare = (page: Page) => page.evaluate(() => ({
    mode: [...document.querySelectorAll('.an-mode .vt-btn[aria-pressed="true"]')].map((b) => b.textContent!.trim()),
    view: [...document.querySelectorAll('.an-view .vt-btn[aria-pressed="true"]')].map((b) => b.textContent!.trim()),
    device: [...document.querySelectorAll('.an-device .vt-btn[aria-pressed="true"]')].map((b) => b.textContent!.trim()),
    portals: [...document.querySelectorAll('#anPortals .chip[aria-selected="true"]')].map((c) => c.textContent),
    cards: [...document.querySelectorAll('.anc-card')].map((el) => (el as HTMLElement).dataset.id),
  }));

  it.each([
    ['/portals/chatgpt', [WEEKS[0], WEEKS[1]]],
    [`/portals/chatgpt/${WEEKS[1]}`, [WEEKS[0], WEEKS[1]]],
  ])('clicking Compare on %s opens Compare in Canvas, Single portal, ChatGPT, with its two weeks, without the homepage', async (path, weeks) => {
    const page = await open(path, { probe: true });
    await page.locator('.compare-cta').click();
    await page.locator('#anCanvasWrap .anc-card img').first().waitFor();
    expect(page.url()).toBe(`https://site.test/#compare?view=canvas&mode=time&portal=chatgpt&weeks=${weeks.join(',')}&device=desktop`);
    expect(await compare(page)).toEqual({ mode: ['Single portal'], view: ['Canvas'], device: ['Desktop'], portals: ['ChatGPT'], cards: weeks });
    const log = await frames(page);
    expect(log.length).toBeGreaterThan(5);
    expect(log.filter((f) => f.gallery)).toEqual([]);
    expect(log.filter((f) => !f.target || !f.navActive)).toEqual([]);
    await page.context().close();
  });

  const place = (page: Page) => page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const btn = r(document.querySelector('.compare-cta')!);
    const prev = r(document.querySelector('.weeknav a[rel="prev"]')!);
    const nav = r(document.querySelector('.weeknav')!);
    return { btn, prev, nav, main: r(document.querySelector('main')!), overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  const mid = (b: { top: number; bottom: number }) => (b.top + b.bottom) / 2;

  it.each(['/portals/chatgpt', `/portals/chatgpt/${WEEKS[1]}`])('at 1280px on %s sits at the right end of the week links\' row', async (path) => {
    const page = await open(path, { width: 1280 });
    const p = await place(page);
    expect(Math.abs(mid(p.btn) - mid(p.prev))).toBeLessThanOrEqual(4);
    expect(p.btn.left).toBeGreaterThan(p.nav.right);
    expect(Math.abs(p.btn.right - p.main.right)).toBeLessThan(1);
    expect(p.overflow).toBe(false);
    await page.context().close();
  });

  it('at 390px goes on its own line below the week links, left-aligned and fully visible', async () => {
    const page = await open(`/portals/chatgpt/${WEEKS[1]}`, { width: 390 }); // the page with the most week links
    const p = await place(page);
    expect(p.btn.top).toBeGreaterThanOrEqual(p.nav.bottom);
    expect(p.btn.top - p.nav.bottom).toBeLessThanOrEqual(12);
    expect(Math.abs(p.btn.left - p.main.left)).toBeLessThan(1);
    expect(p.btn.left).toBeGreaterThanOrEqual(0);
    expect(p.btn.right).toBeLessThanOrEqual(390);
    expect(p.overflow).toBe(false);
    await page.context().close();
  });

  it('looks like the Compare page\'s active Desktop/Mobile toggle, with hover and focus states', async () => {
    const page = await open('/portals/chatgpt');
    const look = () => page.locator('.compare-cta').evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        radius: cs.borderTopLeftRadius, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, bg: cs.backgroundColor, color: cs.color,
        font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0]}`, padding: cs.padding, shadow: cs.boxShadow, underline: cs.textDecorationLine,
        outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor} ${cs.outlineOffset}`,
      };
    });
    const base = {
      radius: '8px', border: '1px solid rgb(217, 206, 189)', bg: 'rgb(245, 241, 233)', color: 'rgb(159, 62, 23)',
      font: '600 12.5px "Space Grotesk"', padding: '6px 11px', shadow: 'rgba(66, 50, 23, 0.12) 0px 1px 3px 0px', underline: 'none', outline: 'none',
    };
    expect(await look()).toEqual(base);
    await page.locator('.compare-cta').hover();
    await page.locator('.compare-cta').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // 150ms fade
    expect(await look()).toEqual({ ...base, bg: 'rgb(222, 212, 198)' });
    await page.mouse.move(0, 0);
    await page.locator('.compare-cta').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('btn-secondary compare-cta');
    await page.locator('.compare-cta').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // hover fade-out
    expect(await look()).toEqual({ ...base, outline: '2px solid rgb(196, 76, 28) 2px' });
    await page.context().close();
  });
});

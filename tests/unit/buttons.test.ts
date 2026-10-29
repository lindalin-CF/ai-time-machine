import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { handlePortalPage } from '../../src/portal-page';
import { handleComparePage } from '../../src/compare-page';
import { makeEnv } from './fake-env';
import { openSite } from './analytics-page';

// The shared buttons (public/buttons.css): .btn-secondary and .btn-primary. Each button that had the look before the
// classes existed keeps the same computed style; the numbers below were measured before the switch.

const BUTTONS_CSS = readFileSync(new URL('../../public/buttons.css', import.meta.url), 'utf8');
const WEEKS = ['2026-10-12', '2026-10-05'];

function seed(t: ReturnType<typeof makeEnv>) {
  for (const [slug, name] of [['chatgpt', 'ChatGPT'], ['claude', 'Claude']]) {
    t.db.exec(`INSERT OR IGNORE INTO portals (slug, name, company, url, brand) VALUES ('${slug}', '${name}', 'Co', 'https://x/', '#10a37f')`);
    for (const week of WEEKS) {
      t.db.exec(`INSERT OR IGNORE INTO weeks (week, label, created_at) VALUES ('${week}', 'Week of ${week}', '${week}T00:00:00Z')`);
      t.db.exec(`INSERT INTO captures (id, week, slug, portal, company, url, brand, r2_key, analysis, analysis_by, status, captured_at)
                 VALUES ('${slug}-${week}', '${week}', '${slug}', '${name}', 'Co', 'https://x/', '#10a37f',
                         'shots/${week}/${slug}.local.png', '', 'pending', 'ok', '${week}T09:00:00Z')`);
    }
  }
}

/** What a button looks like at rest, hovered and keyboard-focused. */
async function look(page: Page, link: Locator, focusFrom?: Locator) {
  const style = () => link.evaluate((a) => {
    const cs = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, display: cs.display, align: cs.alignItems, gap: cs.columnGap,
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, color: cs.color, font: `${cs.fontFamily.split(',')[0]} ${cs.fontWeight} ${cs.fontSize} ${cs.lineHeight}`,
      underline: cs.textDecorationLine, shadow: cs.boxShadow, whiteSpace: cs.whiteSpace, cursor: cs.cursor };
  });
  const rest = await style();
  await link.hover();
  await page.waitForTimeout(250);
  const hoverBg = (await style()).bg;
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  if (focusFrom) await focusFrom.focus(); else await link.evaluate((a) => (a.previousElementSibling as HTMLElement | null)?.focus());
  await link.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab'); // keyboard focus, so :focus-visible applies
  const ring = await link.evaluate((a) => { const cs = getComputedStyle(a); return a === document.activeElement ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}` : 'not focused'; });
  // Pressed: the scale, read from the :active rule's transform while the mouse button is down.
  const box = (await link.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const pressed = await link.evaluate((a) => getComputedStyle(a).transform);
  await page.mouse.up();
  return { ...rest, hoverBg, ring, pressed };
}

const classes = (l: Locator) => l.evaluate((a) => [...a.classList]);

const SECONDARY = { display: 'inline-flex', align: 'center', gap: '6px', border: '1px solid rgb(217, 206, 189)', radius: '8px',
  bg: 'rgb(245, 241, 233)', color: 'rgb(159, 62, 23)', underline: 'none', whiteSpace: 'nowrap', hoverBg: 'rgb(222, 212, 198)',
  ring: 'solid 2px rgb(196, 76, 28) 2px', pressed: 'matrix(0.97, 0, 0, 0.97, 0, 0)' };
const SHADOW = 'rgba(66, 50, 23, 0.12) 0px 1px 3px 0px';

describe('shared button classes', () => {
  it('buttons.css defines .btn-secondary and .btn-primary from tokens, with a usage note at the top', () => {
    expect(BUTTONS_CSS.trimStart().startsWith('/*')).toBe(true);
    expect(BUTTONS_CSS.slice(0, BUTTONS_CSS.indexOf('*/'))).toMatch(/one primary/i);
    for (const cls of ['.btn-secondary', '.btn-primary']) {
      const rule = BUTTONS_CSS.match(new RegExp(`\\${cls}\\{([^}]*)\\}`))![1];
      for (const prop of ['padding', 'border-radius', 'font']) expect(rule, `${cls} ${prop}`).toMatch(new RegExp(`(^|[;\\s])${prop}:var\\(--btn-`));
      expect(rule).toContain(`var(--btn-${cls.slice(5)}-font-size)`);
    }
  });

  it('the homepage and every server-rendered page load buttons.css', async () => {
    expect(readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8')).toContain('<link rel="stylesheet" href="/buttons.css" />');
    const t = makeEnv(); seed(t);
    const html = await (await handlePortalPage(new Request('https://x/portals/chatgpt'), t.env)).text();
    expect(html).toContain('<link rel="stylesheet" href="/buttons.css" />');
  });

  it('the one dark fill is --ink-fill (the hero\'s #0b0b0c), documented at the top; nothing fills with --cf-text or #423217', () => {
    expect(BUTTONS_CSS).toMatch(/--ink-fill:#0b0b0c;/);
    expect(BUTTONS_CSS).toMatch(/--ink-fill-fg:#f5f1e9;/);
    expect(BUTTONS_CSS).toMatch(/--ink-fill-hover:color-mix\(in srgb,var\(--ink-fill\) 88%,#fff\);/);
    const note = BUTTONS_CSS.slice(0, BUTTONS_CSS.indexOf('*/'));
    for (const t of ['--ink-fill ', '--ink-fill-fg', '--ink-fill-hover']) expect(note).toContain(t);
    const styles = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('--selected-bg:var(--ink-fill);');
    const dir = (d: string, ext: RegExp) => readdirSync(new URL(`../../${d}/`, import.meta.url)).filter((f) => ext.test(f))
      .map((f) => [`${d}/${f}`, readFileSync(new URL(`../../${d}/${f}`, import.meta.url), 'utf8')] as const);
    for (const [file, text] of [...dir('public', /\.(css|js)$/), ...dir('src', /\.ts$/)]) {
      expect(text.match(/background(-color)?:\s*(var\(--cf-text\b[^)]*\)|#423217)/gi), file).toBeNull();
    }
  });
});

describe('shared button classes (browser)', () => {
  let browser: Browser;
  let portalHtml: string, pairHtml: string;
  beforeAll(async () => {
    browser = await chromium.launch();
    const t = makeEnv(); seed(t);
    portalHtml = await (await handlePortalPage(new Request('https://site.test/portals/chatgpt'), t.env)).text();
    pairHtml = await (await handleComparePage(new Request('https://site.test/compare/chatgpt-vs-claude'), t.env)).text();
  });
  afterAll(async () => { await browser?.close(); });

  it('portal page Compare is a secondary button with an unchanged look', async () => {
    const page = await openSite(browser, '', { pages: { '/portals/chatgpt': portalHtml } });
    await page.goto('https://site.test/portals/chatgpt');
    const link = page.locator('.compare-cta');
    expect(await classes(link)).toContain('btn-secondary');
    expect(await look(page, link)).toEqual({ ...SECONDARY, display: 'flex', w: 95.2, h: 29, pad: '6px 11px 6px 11px', font: '"Space Grotesk" 600 12.5px 15px', shadow: SHADOW, cursor: 'pointer' });
  });

  it('pair page Open in Compare is a secondary button with an unchanged look', async () => {
    const page = await openSite(browser, '', { pages: { '/compare/chatgpt-vs-claude': pairHtml } });
    await page.goto('https://site.test/compare/chatgpt-vs-claude');
    const link = page.locator('.cmp-open');
    expect(await classes(link)).toContain('btn-secondary');
    expect(await look(page, link)).toEqual({ ...SECONDARY, w: 143.8, h: 29, pad: '6px 11px 6px 11px', font: '"Space Grotesk" 600 12.5px 15px', shadow: SHADOW, cursor: 'pointer' });
  });

  it('gallery card Details is a secondary button with an unchanged look', async () => {
    const page = await openSite(browser, '');
    const link = page.locator('#grid .card .details-link').first();
    await link.waitFor();
    expect(await classes(link)).toContain('btn-secondary');
    expect(await look(page, link)).toEqual({ ...SECONDARY, display: 'flex', w: 83, h: 32, pad: '0px 11px 0px 11px', font: '"Space Grotesk" 600 12.5px 12.5px', shadow: SHADOW, cursor: 'pointer' });
  });

  it('Compare table PAGE links are secondary buttons with an unchanged look', async () => {
    const page = await openSite(browser, `#compare?view=table&mode=portals&week=2026-09-28&portals=chatgpt,claude&device=desktop`);
    const link = page.locator('#anTableWrap .an-page-link').first();
    await link.waitFor();
    expect(await classes(link)).toContain('btn-secondary');
    expect(await look(page, link)).toEqual({ ...SECONDARY, w: 179.7, h: 29, pad: '6px 11px 6px 11px', font: '"Space Grotesk" 600 12.5px 15px', shadow: 'none', cursor: 'pointer' });
  });

  it('the landing filter bar Compare is the primary button with an unchanged look', async () => {
    const page = await openSite(browser, '');
    const btn = page.locator('#compareBtn');
    await page.locator('#grid .card').first().waitFor();
    expect(await classes(btn)).toContain('btn-primary');
    expect(await look(page, btn, page.locator('.search-input'))).toEqual({ w: 107.8, h: 36, display: 'flex', align: 'center', gap: '6px',
      pad: '0px 16px 0px 16px', border: '1px solid rgb(196, 76, 28)', radius: '999px', bg: 'rgb(196, 76, 28)', color: 'rgb(255, 255, 255)',
      font: '"Space Grotesk" 700 13px 13px', underline: 'none', shadow: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
      hoverBg: 'color(srgb 0.66102 0.256314 0.0944314)' /* --brand-hover, mixed from --brand */, ring: 'solid 2px rgb(196, 76, 28) 2px', pressed: 'matrix(0.97, 0, 0, 0.97, 0, 0)' });
  });

  it('"This week\'s changes" is a secondary button with the same label and link, centred on the week heading, at the right', async () => {
    const page = await openSite(browser, '');
    const link = page.locator('#weekDigest');
    await page.locator('#grid .card').first().waitFor();
    expect(await classes(link)).toContain('btn-secondary');
    expect(await link.getAttribute('href')).toBe('/weeks/2026-09-28');
    expect((await link.textContent())!.replace(/\s+/g, ' ').trim()).toBe('This week\'s changes →');
    const geo = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const a = r('#weekDigest'), h = r('#weekHeading'), head = r('.section-head');
      return { centreDiff: Math.abs((a.top + a.bottom) / 2 - (h.top + h.bottom) / 2), rightGap: Math.round(head.right - a.right) };
    });
    expect(geo).toEqual({ centreDiff: 0, rightGap: 0 });
    // The same look as the portal page's Compare (a flex item, so it computes to flex).
    expect(await look(page, link)).toMatchObject({ ...SECONDARY, display: 'flex', h: 29, pad: '6px 11px 6px 11px', font: '"Space Grotesk" 600 12.5px 15px', shadow: SHADOW });
  });

  it.each([390, 1280])('at %ipx the week heading is just the week label, with "This week\'s changes" right-aligned on its row', async (width) => {
    const page = await openSite(browser, '', { width });
    await page.locator('#grid .card').first().waitFor();
    expect(await page.locator('#weekHeading').textContent()).toBe('Week of 2026-09-28');
    expect(await page.locator('.section-head:has(#weekHeading) > *').evaluateAll((els) => els.map((e) => e.id || e.tagName))).toEqual(['weekHeading', 'weekDigest']);
    const geo = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const a = r('#weekDigest'), h = r('#weekHeading'), head = r('.section-head');
      return { centreDiff: Math.abs((a.top + a.bottom) / 2 - (h.top + h.bottom) / 2), rightGap: Math.round(head.right - a.right), apart: a.left > h.right,
        noSideScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    });
    expect(geo).toEqual({ centreDiff: 0, rightGap: 0, apart: true, noSideScroll: true });
    await page.context().close();
  });
});

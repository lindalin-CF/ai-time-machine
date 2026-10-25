import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { handleChangelog } from '../../src/portal-page';
import { openSite } from './analytics-page';

// The site's one orange (public/buttons.css): --brand for fills, rings, the hero and the voice button; --brand-text,
// the same hue darkened, for small orange text. The old #eb622c / #cc501e oranges are gone from the code.

const CSS = readFileSync(new URL('../../public/buttons.css', import.meta.url), 'utf8');
const token = (name: string) => CSS.match(new RegExp(`--${name}:(#[0-9a-f]{6});`))![1];
const BRAND = token('brand'), BRAND_TEXT = token('brand-text');
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hsl = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(h * 60), l: (max + min) / 2 };
};

describe('brand tokens', () => {
  it('--brand is the primary button orange and --brand-text the same hue, darker', () => {
    expect(BRAND).toBe('#c44c1c');
    expect(BRAND_TEXT).toBe('#9f3e17');
    expect(hsl(BRAND_TEXT).h).toBe(hsl(BRAND).h);
    expect(hsl(BRAND_TEXT).l).toBeLessThan(hsl(BRAND).l);
  });

  it('white text on --brand (and on its hover mix) is at least 4.5:1', () => {
    expect(contrast('#ffffff', BRAND)).toBeGreaterThanOrEqual(4.5);
    expect(CSS).toContain('--brand-hover:color-mix(in srgb,var(--brand) 86%,#000);');
    const hover = '#' + [196, 76, 28].map((v) => Math.round(v * 0.86).toString(16).padStart(2, '0')).join('');
    expect(contrast('#ffffff', hover)).toBeGreaterThanOrEqual(4.5);
  });

  for (const [name, bg] of [['--cf-bg-100', '#f5f1e9'], ['--cf-bg-200', '#efe8dd'], ['--cf-bg-300', '#ded4c6'], ['the page', '#e7dfd4'], ['server pages', '#f4efe8']]) {
    it(`--brand-text on ${name} (${bg}) is at least 4.5:1`, () => expect(contrast(BRAND_TEXT, bg)).toBeGreaterThanOrEqual(4.5));
  }

  it('no old orange is left in the site code', () => {
    const OLD = /#(eb622c|cc501e|c84e1d|b8461a|a83f15|ff6633|d94f22)\b|rgba\((235, ?98, ?44|255, ?102, ?51|217, ?79, ?34)|--cf-orange/i;
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      if (statSync(p).isDirectory()) return f === 'vendor' || f === 'fonts' ? [] : files(p);
      return /\.(css|js|html|svg|ts)$/.test(f) && p !== 'src/changelog.ts' ? [p] : [];
    });
    const hits = [...files('public'), ...files('src')].filter((p) => OLD.test(readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('brand colours in the browser', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const color = (page: Page, sel: string, prop: string) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  it('homepage: primary button, voice button, nav item, links and the hero annotations use the tokens', async () => {
    const page = await openSite(browser, '', { width: 1440 });
    await page.locator('#grid .card').first().waitFor();
    await page.locator('.voice-fab').waitFor();
    await expect.poll(() => color(page, '#compareBtn', 'background-color')).toBe(rgb(BRAND));
    await expect.poll(() => color(page, '.voice-fab', 'background-color')).toBe(rgb(BRAND));
    await expect.poll(() => color(page, '.topnav-link.active', 'color')).toBe(rgb(BRAND_TEXT));
    await expect.poll(() => color(page, '#weekDigest', 'color')).toBe(rgb(BRAND_TEXT));
    await expect.poll(() => color(page, '#grid .details-link', 'color')).toBe(rgb(BRAND_TEXT));
    await expect.poll(() => color(page, '.wordmark-dot', 'background-color')).toBe(rgb(BRAND));

    // Hero annotations, at the end of their animation.
    await page.evaluate(() => document.querySelectorAll('.hero-sub *').forEach((el) => el.getAnimations().forEach((a) => a.finish())));
    await expect.poll(() => color(page, '.hero-sub .tag.orange', 'background-color')).toBe(rgb(BRAND));
    await expect.poll(() => color(page, '.hero-sub .box', 'border-top-color')).toBe(rgb(BRAND));
    await expect.poll(() => color(page, '.hero-sub .rule.o', 'background-color')).toBe(rgb(BRAND));
    await expect.poll(() => color(page, '.hero-sub .kw-colour .sw', 'background-color')).toBe(rgb(BRAND));
    // The colour tag names the colour it shows.
    expect((await page.locator('.hero-sub .kw-colour .tag').textContent())!.trim()).toBe(BRAND.toUpperCase());
    await page.context().close();
  });

  it('focus rings are --brand', async () => {
    const page = await openSite(browser, '');
    await page.locator('#searchInput').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => [document.activeElement!.id, getComputedStyle(document.activeElement!).outlineColor])).toEqual(['compareBtn', rgb(BRAND)]);
    await page.context().close();
  });

  it('server pages: the changelog dot, its anchors and the wordmark dot', async () => {
    const changelog = await handleChangelog(new Request('https://site.test/changelog')).text();
    const page = await openSite(browser, '', { pages: { '/changelog': changelog } });
    await page.goto('https://site.test/changelog');
    expect(await color(page, '.cl-anchor', 'color')).toBe(rgb(BRAND_TEXT));
    expect(await page.locator('.cl-entry').first().evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe(rgb(BRAND));
    expect(await color(page, '.wordmark-dot', 'background-color')).toBe(rgb(BRAND));
    await page.context().close();
  });
});

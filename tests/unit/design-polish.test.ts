import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { handleChangelog, handlePrivacy } from '../../src/portal-page';
import { openSite } from './analytics-page';

// Site-wide design rules (public/styles.css, public/voice.js, src/portal-page.ts): explicit transitions, hover lifts
// only for fine pointers, press feedback only without reduced motion, a visible focus ring, minimum text sizes,
// a 32px nav hit area, the homepage's fonts on server pages, and the changelog's type scale.

const STYLES = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
const ORIGIN = 'https://ai-portal-library.dev';
const html = async (res: Response) => res.text();

/** Every hover rule that moves or scales something, outside a (hover:hover) and (pointer:fine) block. */
const unguardedHoverTransforms = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  const walk = (rules: CSSRuleList, guarded: boolean) => {
    for (const r of rules) {
      if (r instanceof CSSMediaRule) walk(r.cssRules, guarded || (/hover:\s*hover/.test(r.conditionText) && /pointer:\s*fine/.test(r.conditionText)));
      else if (r instanceof CSSStyleRule && /:hover/.test(r.selectorText) && r.style.transform && r.style.transform !== 'none' && !guarded) out.push(r.selectorText);
    }
  };
  for (const s of document.styleSheets) { try { walk(s.cssRules, false); } catch { /* cross-origin */ } }
  return out;
});

/** Visible text smaller than 11px, or mono text smaller than 12px (the hero's animated annotation tags excepted). */
const smallText = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement) || el.closest('.hero-sub .ann, .sr-only, .stat-full')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!own || !el.checkVisibility()) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    const mono = /JetBrains Mono|monospace/.test(cs.fontFamily);
    if (size < (mono ? 12 : 11)) out.push(`${el.className || el.tagName} ${size}px${mono ? ' mono' : ''}`);
  }
  return out;
});

describe('design rules (source)', () => {
  it('names the properties every transition animates (no "transition: all")', () => {
    expect(STYLES).not.toMatch(/transition:\s*all/);
  });
});

describe('design rules (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  it('lifts and moves things on hover only where a fine pointer hovers', async () => {
    const page = await openSite(browser, '');
    expect(await unguardedHoverTransforms(page)).toEqual([]);
    await page.context().close();
  });

  it.each([[390], [1280]])('at %ipx no text is below 11px, or 12px for mono labels (homepage and Compare)', async (width) => {
    const page = await openSite(browser, '', { width });
    await page.locator('#grid .card').first().waitFor();
    expect(await smallText(page)).toEqual([]);
    await page.evaluate(() => { location.hash = '#compare'; });
    await page.locator('#anCanvasWrap .anc-card').first().waitFor();
    expect(await smallText(page)).toEqual([]);
    await page.context().close();
  });

  it('presses scale buttons to 97% over 160ms, but not with reduced motion', async () => {
    const pressed = async (reducedMotion: 'reduce' | 'no-preference') => {
      const page = await openSite(browser, '#compare', { reducedMotion });
      await page.locator('#anCanvasWrap .anc-card').first().waitFor();
      const share = page.locator('#anShare');
      const box = (await share.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(250);
      const r = await share.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { transform: cs.transform, duration: cs.transitionDuration.split(', ')[cs.transitionProperty.split(', ').indexOf('transform')] };
      });
      await page.mouse.up();
      await page.context().close();
      return r;
    };
    expect(await pressed('no-preference')).toEqual({ transform: 'matrix(0.97, 0, 0, 0.97, 0, 0)', duration: '0.16s' });
    expect((await pressed('reduce')).transform).toBe('none');
  });

  it('shows the 2px orange ring on a focused week option', async () => {
    const page = await openSite(browser, '');
    await page.locator('#grid .card').first().waitFor();
    await page.locator('.controls .week-menu-btn').focus();
    await page.keyboard.press('Enter'); // opens the list
    await page.keyboard.press('Tab'); // the newest week (selected)
    await page.keyboard.press('Tab'); // the next week
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { option: el.classList.contains('week-option'), outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` };
    });
    expect(ring).toEqual({ option: true, outline: '2px solid rgb(235, 98, 44)' });
    await page.context().close();
  });

  it('gives each desktop nav link a hit area at least 32px tall without changing the bar height', async () => {
    const page = await openSite(browser, '', { width: 1280 });
    const r = await page.evaluate(() => ({
      links: [...document.querySelectorAll('.topnav-link')].map((a) => a.getBoundingClientRect().height),
      bar: document.querySelector('.topbar')!.getBoundingClientRect().height,
    }));
    for (const h of r.links) expect(h).toBeGreaterThanOrEqual(32);
    expect(r.bar).toBeLessThan(60); // 18px padding twice, the wordmark line and the border, as before
    await page.context().close();
  });

  it('server pages use the homepage fonts, and the changelog title is larger than its entry titles', async () => {
    const pages = {
      '/changelog': await html(handleChangelog(new Request(`${ORIGIN}/changelog`))),
      '/privacy': await html(handlePrivacy(new Request(`${ORIGIN}/privacy`))),
    };
    const page = await openSite(browser, '', { pages });
    for (const path of Object.keys(pages)) {
      await page.goto(`https://site.test${path}`);
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => ({
        body: getComputedStyle(document.body).fontFamily.split(',')[0],
        h1: parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
        h2: document.querySelector('.cl-body h2') ? parseFloat(getComputedStyle(document.querySelector('.cl-body h2')!).fontSize) : null,
        gap: document.querySelector('.cl-entry') ? getComputedStyle(document.querySelector('.cl-entry')!).paddingBottom : null,
        loaded: document.fonts.check('16px "Space Grotesk"'),
      }));
      expect(r.body).toBe('"Space Grotesk"');
      expect(r.loaded).toBe(true);
      if (path === '/changelog') expect(r).toMatchObject({ h1: 48, h2: 32, gap: '64px' });
    }
    await page.context().close();
  });
});

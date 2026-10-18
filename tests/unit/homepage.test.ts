import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { expectFooterDialogs, LEGAL_LINE } from './footer-dialogs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

describe('homepage (public/index.html)', () => {
  it('uses the new site name only', () => {
    expect(html).toContain('<title>AI Interface Library — weekly UI screenshots of ChatGPT, Claude, Gemini &amp; more</title>');
    expect(html).toContain('<meta property="og:title" content="AI Interface Library — weekly UI screenshots of ChatGPT, Claude, Gemini &amp; more" />');
    expect(html).toContain('<meta property="og:site_name" content="AI Interface Library" />');
    expect(html).not.toContain('AI Surface Library');
    expect(html).not.toContain('AI Surface');
  });

  it('keeps the hero subtitle and uses the search description for meta, og and twitter', () => {
    const SUBTITLE = 'A weekly archive of AI product interfaces, analysed for layout, hierarchy and colour as a UI/UX design system.';
    const DESCRIPTION = 'Weekly screenshots of AI chatbot interfaces — ChatGPT, Claude, Gemini, Perplexity, Copilot and more — on desktop and mobile, with design analysis and UI changes week by week.';
    for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      expect(html).toContain(`<meta ${tag} content="${DESCRIPTION}" />`);
    }
    // The hero joins the last two words with &nbsp; so they never wrap apart (::first-line stops text-wrap:pretty working).
    const hero = html.match(/<p class="hero-sub">\s*([\s\S]*?)\s*<\/p>/)![1];
    expect(hero).toContain('design&nbsp;system.');
    // Screen readers get the sentence from .sr-only; the animated word spans are aria-hidden.
    expect(hero.match(/<span class="sr-only">([^<]*)<\/span>/)![1]).toBe(SUBTITLE);
    // The visible words, minus their keyword annotations, must spell the same sentence.
    const visible = hero
      .replace(/<span class="sr-only">[^<]*<\/span>/, '')
      .replace(/<span class="(?:bars|sw)">(?:<b><\/b>)*<\/span>/g, '')
      .replace(/<span class="ann[^"]*"[^>]*>[^<]*(?:<i><\/i>)*<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(visible).toBe(SUBTITLE);
    expect(html).not.toMatch(/visual\s+design\s+system/i);
    expect(html).not.toContain('A living reference');
  });

  it('has the footer sentence first and the copyright line below it', () => {
    const footer = html.match(/<footer class="sitefoot">[\s\S]*?<\/footer>/)![0];
    expect(footer).toContain('<span>Weekly UI reference for AI products</span>');
    expect(footer).not.toContain('served on Cloudflare');
    expect(footer).not.toContain('foot-stack'); // technology tag row removed
    expect(footer).not.toMatch(/<li>/);
    const sentence = footer.indexOf('Independent personal project. Not affiliated with any of the companies featured.');
    const legal = footer.indexOf(LEGAL_LINE);
    expect(sentence).toBeGreaterThan(-1);
    expect(legal).toBeGreaterThan(sentence);
  });

  it('has the Disclaimer and Contact dialogs, closed by default', () => {
    expectFooterDialogs(html);
  });
});

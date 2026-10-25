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

  it('has the new hero subtitle and keeps the search description for meta, og and twitter', () => {
    const SUBTITLE = 'Find UI references from AI products, updated weekly, and compare layout, hierarchy and colour for your next design.';
    const DESCRIPTION = 'Weekly screenshots of AI chatbot interfaces — ChatGPT, Claude, Gemini, Perplexity, Copilot and more — on desktop and mobile, with design analysis and UI changes week by week.';
    for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      expect(html).toContain(`<meta ${tag} content="${DESCRIPTION}" />`);
    }
    // The hero joins the last two words with &nbsp; so they never wrap apart (::first-line stops text-wrap:pretty working).
    const hero = html.match(/<p class="hero-sub">\s*([\s\S]*?)\s*<\/p>/)![1];
    expect(hero).toContain('next&nbsp;design.');
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
    // Each word's --c is its character offset in the sentence (the word-in delay is timed from it).
    const offsets = [...hero.matchAll(/<span class="w" style="--c:(\d+)">(.*?)<\/span>\s*(?=<span class="w"|<\/span>\s*$)/gs)]
      .map((m) => [Number(m[1]), m[2].replace(/<span class="ann[\s\S]*?<\/span><\/span>|<[^>]+>/g, '').replace(/&nbsp;/g, ' ')]);
    expect(offsets.length).toBe(17);
    for (const [c, word] of offsets) expect(SUBTITLE.slice(c as number, (c as number) + (word as string).length)).toBe(word);
    // The three annotated keywords, in order.
    expect([...hero.matchAll(/class="kw (kw-[a-z]+)">(\w+)/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(['kw-layout:layout', 'kw-hier:hierarchy', 'kw-colour:colour']);
    expect(hero).toContain('Layout · 4 × 3 grid');
    expect(hero).toContain('H1 92 · Body 28');
    expect(hero).toContain('#C44C1C');
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

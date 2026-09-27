import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

describe('homepage (public/index.html)', () => {
  it('uses the new site name only', () => {
    expect(html).toContain('<title>AI Interface Library</title>');
    expect(html).toContain('<meta property="og:site_name" content="AI Interface Library" />');
    expect(html).not.toContain('AI Surface Library');
    expect(html).not.toContain('AI Surface');
  });

  it('uses the same subtitle in the hero and the og/twitter descriptions', () => {
    const SUBTITLE = 'A weekly archive of AI product interfaces, analysed for layout, hierarchy and colour as a UI/UX design system.';
    expect(html).toContain(`<meta property="og:description" content="${SUBTITLE}" />`);
    expect(html).toContain(`<meta name="twitter:description" content="${SUBTITLE}" />`);
    // The hero joins the last two words with &nbsp; so they never wrap apart (::first-line stops text-wrap:pretty working).
    const hero = html.match(/<p class="hero-sub">\s*([\s\S]*?)\s*<\/p>/)![1];
    expect(hero).toContain('design&nbsp;system.');
    expect(hero.replace(/&nbsp;/g, ' ')).toBe(SUBTITLE);
    expect(html).not.toMatch(/visual\s+design\s+system/i);
    expect(html).not.toContain('A living reference');
  });

  it('has the footer sentence first and the copyright line below it', () => {
    const footer = html.match(/<footer class="sitefoot">[\s\S]*?<\/footer>/)![0];
    expect(footer).toContain('<span>Weekly UI reference for AI products</span>');
    expect(footer).not.toContain('served on Cloudflare');
    const sentence = footer.indexOf('Independent personal project. Not affiliated with any of the companies featured.');
    const legal = footer.indexOf('&copy; 2026 AI Interface Library. All rights reserved. &middot; <button type="button" class="linkbtn" data-open-disclaimer aria-haspopup="dialog">Disclaimer</button> &middot; <a class="linkbtn" href="mailto:contact@ai-portal-library.dev">Contact</a>');
    expect(sentence).toBeGreaterThan(-1);
    expect(legal).toBeGreaterThan(sentence);
    expect(footer.match(/<a [^>]*>Contact<\/a>/g)).toEqual(['<a class="linkbtn" href="mailto:contact@ai-portal-library.dev">Contact</a>']);
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
    expect(dialog).toContain('aria-label="Close">&times;</button>');
    expect(dialog).toContain('>Close</button>');
    expect(html).toContain('<script src="/disclaimer.js" defer></script>');
  });
});

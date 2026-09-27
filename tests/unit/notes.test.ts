import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const section = html.match(/<section id="insightsView"[\s\S]*?<\/section>/)![0];

describe('Notes section', () => {
  it('is called Notes in the nav and heading, at #notes', () => {
    expect(html).toContain('<a href="#notes" class="topnav-link" data-nav="insights">Notes</a>');
    expect(section).toContain('<h1 class="insights-title">Notes</h1>');
    expect(section).toContain('<p class="insights-sub">Short notes on what changed across AI product interfaces, written by hand.</p>');
    expect(html).not.toMatch(/>\s*Insights\s*</);
    expect(html).not.toContain('href="#insights"');
  });

  it('opens the notes view for both #notes and the old #insights links', () => {
    expect(appJs).toContain('hash === "#notes" || hash === "#insights" ? "insights"');
  });
});

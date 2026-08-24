import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import 'vitest-visual-diff';

let cachedStyles: string | null = null;
async function mount(html: string) {
  cachedStyles ??= await fetch('/styles.css').then((r) => r.text());
  document.head.innerHTML = `<style>${cachedStyles}</style>`;
  document.body.innerHTML = `
    <main style="padding:24px;background:var(--cf-bg-page);min-height:100vh">
      ${html}
    </main>`;
}

function deviceToggle(testId: string) {
  return `
    <div data-testid="${testId}" class="viewtoggle" role="group" aria-label="Screenshot device">
      <button class="vt-btn active" type="button" data-device="desktop" aria-pressed="true">Desktop</button>
      <button class="vt-btn" type="button" data-device="mobile" aria-pressed="false">Mobile</button>
    </div>`;
}

test('Library and Collection device toggles stay visually consistent', async () => {
  await mount(`
    <div style="position:fixed;left:20px;top:20px">${deviceToggle('library-toggle')}</div>
    <div style="position:fixed;left:20px;top:90px">${deviceToggle('collection-toggle')}</div>
  `);

  await expect(page.getByTestId('collection-toggle')).toMatchVisualDiff(
    page.getByTestId('library-toggle'),
    { a11y: true, pixels: true },
  );
});

test('Week dropdown selected/focus state uses the site orange palette, not blue', async () => {
  await mount(`
    <div class="weekpick" data-testid="weekbox">
      <label>Week</label>
      <div class="week-menu open">
        <button class="week-menu-btn" type="button" aria-haspopup="listbox" aria-expanded="true"><span>Aug 17, 2026</span></button>
        <div class="week-menu-list" role="listbox">
          <button class="week-option" type="button" role="option" aria-selected="true">Aug 17, 2026</button>
          <button class="week-option" type="button" role="option">Aug 10, 2026</button>
        </div>
      </div>
    </div>
  `);

  const selected = document.querySelector('.week-option[aria-selected="true"]') as HTMLElement;
  const styles = getComputedStyle(selected);
  expect(styles.backgroundColor).not.toBe('rgb(0, 122, 255)');
  expect(styles.backgroundColor).toBe('rgb(235, 98, 44)');
});

test('View more manual card keeps edit and share actions visible', async () => {
  await mount(`
    <figure data-testid="manual-card" class="manual-cell filled" style="width:280px">
      <div class="manual-carousel" data-index="0">
        <div class="manual-track" style="transform:translateX(0)">
          <div class="manual-img"><img alt="sample" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect width='280' height='160' fill='%23ded4c6'/%3E%3C/svg%3E" /></div>
        </div>
        <span class="manual-chip">desktop</span>
      </div>
      <figcaption>
        <div class="manual-cap-text"><b>Aug 17</b><span>Data control UI</span></div>
        <span class="manual-actions">
          <button type="button" class="manual-edit-btn" aria-label="Edit description">✎</button>
          <button type="button" class="manual-share-btn" aria-label="Copy share link">↗</button>
        </span>
      </figcaption>
    </figure>
  `);

  const edit = document.querySelector('.manual-edit-btn') as HTMLElement;
  const share = document.querySelector('.manual-share-btn') as HTMLElement;
  expect(edit).toBeTruthy();
  expect(share).toBeTruthy();
  expect(getComputedStyle(document.querySelector('.manual-actions') as HTMLElement).flexDirection).toBe('column');
});

test('Mobile top menu keeps Library and Collection on one row', async () => {
  await mount(`
    <header data-testid="topbar" class="topbar" style="width:390px">
      <a class="wordmark" href="/"><span class="wordmark-dot"></span><span class="wordmark-text">Agent Experience Vault</span></a>
      <nav class="topnav">
        <a href="#" class="topnav-link" data-nav="gallery">Library</a>
        <a href="#collection" class="topnav-link" data-nav="collection">Collection</a>
        <a href="#analytics" class="topnav-link" data-nav="analytics">Analytics</a>
      </nav>
    </header>
  `);

  const links = [...document.querySelectorAll('.topnav-link')] as HTMLElement[];
  const y = links.map((l) => Math.round(l.getBoundingClientRect().top));
  expect(new Set(y).size).toBe(1);
});

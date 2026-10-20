import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { openAnalytics, WEEKS } from './analytics-page';

// Analytics controls: the Compare toggle's wording and the week dropdown (public/analytics-weekpick.js),
// single select in Portal mode and multi select (max 4) in Week mode.

const LABELS = ['Sep 28, 2026', 'Sep 21, 2026', 'Sep 7, 2026', 'Aug 24, 2026', 'Aug 17, 2026', 'Aug 10, 2026'];

describe('analytics week dropdown (browser)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  const btn = (page: Page) => page.locator('#analyticsView .an-wp-btn');
  const isOpen = (page: Page) => page.locator('#analyticsView .an-wp').evaluate((el) => el.classList.contains('is-open'));
  const current = (page: Page) => page.locator('#analyticsView .an-wp-current').textContent();
  const active = (page: Page) => page.evaluate(() => document.activeElement?.textContent?.trim());
  /** Weeks shown in the comparison table, from its snapshot URLs. */
  const tableWeeks = (page: Page) => page.locator('#anTableWrap .an-shot img').evaluateAll((els) =>
    els.map((e) => /\/shots\/([\d-]+)\//.exec(e.getAttribute('src')!)![1]));
  const settle = (page: Page) => page.waitForFunction(() => !document.querySelector('#anTableWrap .an-loading'));

  describe('wording', () => {
    it('labels the mode toggle Across portals and Single portal; state values are unchanged', async () => {
      const page = await openAnalytics(browser);
      const group = page.getByRole('group', { name: 'Compare', exact: true });
      expect(await group.locator('.vt-btn').evaluateAll((els) => els.map((b) => `${b.getAttribute('data-mode')}=${b.textContent!.trim()}`)))
        .toEqual(['portals=Across portals', 'weeks=Single portal']);
      expect(new URL(page.url()).hash.split('?')[0]).toBe('#compare');
      await page.locator('[data-mode="weeks"]').click();
      expect(new URL(page.url()).hash.split('?')[0]).toBe('#compare');
    });
  });

  describe('Across portals (single select)', () => {
    it('is a listbox button showing the selected week', async () => {
      const page = await openAnalytics(browser);
      expect(await page.locator('#anWeek .chip').count()).toBe(0);
      expect(await current(page)).toBe('Sep 28, 2026');
      expect(await btn(page).getAttribute('aria-haspopup')).toBe('listbox');
      expect(await btn(page).getAttribute('aria-expanded')).toBe('false');
      expect(await page.getByRole('button', { name: 'Week Sep 28, 2026' }).count()).toBe(1);
    });

    it('lists weeks newest first in the date format; a click picks one and closes', async () => {
      const page = await openAnalytics(browser);
      await btn(page).click();
      expect(await isOpen(page)).toBe(true);
      expect(await btn(page).getAttribute('aria-expanded')).toBe('true');
      expect(await page.getByRole('listbox').getByRole('option').allTextContents()).toEqual(LABELS);
      expect(await page.locator('#analyticsView [role="option"][aria-selected="true"]').textContent()).toBe('Sep 28, 2026');
      await page.getByRole('option', { name: 'Sep 7, 2026' }).click();
      expect(await isOpen(page)).toBe(false);
      expect(await current(page)).toBe('Sep 7, 2026');
      await settle(page);
      expect(await tableWeeks(page)).toEqual(['2026-09-07', '2026-09-07']);
    });

    it('works from the keyboard: Enter opens, arrows move, Enter picks and returns focus', async () => {
      const page = await openAnalytics(browser);
      await btn(page).focus();
      await page.keyboard.press('Enter');
      expect(await isOpen(page)).toBe(true);
      expect(await active(page)).toBe('Sep 28, 2026');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      expect(await active(page)).toBe('Sep 7, 2026');
      await page.keyboard.press('ArrowUp');
      expect(await active(page)).toBe('Sep 21, 2026');
      await page.keyboard.press('End');
      expect(await active(page)).toBe('Aug 10, 2026');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      expect(await isOpen(page)).toBe(false);
      expect(await current(page)).toBe('Sep 21, 2026');
      expect(await page.evaluate(() => document.activeElement?.classList.contains('an-wp-btn'))).toBe(true);
    });

    it('Space and ArrowDown open it; Esc closes it and returns focus without changing the week', async () => {
      const page = await openAnalytics(browser);
      await btn(page).focus();
      await page.keyboard.press(' ');
      expect(await isOpen(page)).toBe(true);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      expect(await isOpen(page)).toBe(false);
      expect(await current(page)).toBe('Sep 28, 2026');
      expect(await page.evaluate(() => document.activeElement?.classList.contains('an-wp-btn'))).toBe(true);
      await page.keyboard.press('ArrowDown');
      expect(await isOpen(page)).toBe(true);
    });

    it('a click outside closes it', async () => {
      const page = await openAnalytics(browser);
      await btn(page).click();
      await page.locator('.analytics-title').click();
      expect(await isOpen(page)).toBe(false);
    });

    it('shows a focus ring on keyboard focus', async () => {
      const page = await openAnalytics(browser);
      await page.locator('#analyticsView [data-mode="weeks"]').focus();
      await page.locator('#analyticsView [data-mode="weeks"]').evaluate((el) => (el as HTMLElement).blur());
      // Row 2 reads Desktop, Mobile, then the dropdown: Tab from Mobile lands on it.
      await page.locator('#analyticsView [data-andevice="mobile"]').focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.classList.contains('an-wp-btn'))).toBe(true);
      expect(await btn(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    });

    it.each([[1280], [390]])('at %ipx: the open menu is not clipped and stays on screen', async (width) => {
      const page = await openAnalytics(browser, { width });
      await btn(page).click();
      const r = await page.evaluate(() => {
        const list = document.querySelector('#analyticsView .an-wp-list')!;
        const l = list.getBoundingClientRect();
        const items = [...list.querySelectorAll('.an-wp-item')];
        items.at(-1)!.scrollIntoView({ block: 'nearest' });
        const last = items.at(-1)!.getBoundingClientRect();
        const hit = document.elementFromPoint(last.left + 8, last.top + last.height / 2);
        return { left: l.left, right: l.right, vw: window.innerWidth, lastOnTop: hit === items.at(-1), overflow: document.documentElement.scrollWidth > window.innerWidth };
      });
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(r.vw);
      expect(r.lastOnTop).toBe(true);
      expect(r.overflow).toBe(false);
    });
  });

  describe('Over time (multi select, max 4)', () => {
    async function weekMode(page: Page) {
      await page.locator('[data-mode="weeks"]').click();
      await settle(page);
    }

    it('uses a menu of checkboxes with a summary, keeping the current selection rules', async () => {
      const page = await openAnalytics(browser);
      await weekMode(page);
      expect(await btn(page).getAttribute('aria-haspopup')).toBe('menu');
      expect(await current(page)).toBe('2 weeks');
      expect(await page.getByRole('button', { name: 'Weeks 2 weeks' }).count()).toBe(1);
      expect(await tableWeeks(page)).toEqual(WEEKS.slice(0, 2));
      await btn(page).click();
      expect(await page.getByRole('menu').getByRole('menuitemcheckbox').allTextContents()).toEqual(LABELS);
      expect(await page.locator('#analyticsView [role="menuitemcheckbox"][aria-checked="true"]').allTextContents()).toEqual(LABELS.slice(0, 2));
    });

    it('stays open while picking, disables the rest at 4, and re-enables them when one is unchecked', async () => {
      const page = await openAnalytics(browser);
      await weekMode(page);
      await btn(page).click();
      await page.getByRole('menuitemcheckbox', { name: 'Sep 7, 2026' }).click();
      expect(await isOpen(page)).toBe(true);
      expect(await current(page)).toBe('3 weeks');
      await page.getByRole('menuitemcheckbox', { name: 'Aug 17, 2026' }).click();
      expect(await isOpen(page)).toBe(true);
      expect(await current(page)).toBe('4 weeks');
      expect(await page.locator('#analyticsView [role="menuitemcheckbox"][aria-disabled="true"]').allTextContents()).toEqual(['Aug 24, 2026', 'Aug 10, 2026']);
      await settle(page);
      expect(await tableWeeks(page)).toEqual(['2026-09-28', '2026-09-21', '2026-09-07', '2026-08-17']);

      await page.getByRole('menuitemcheckbox', { name: 'Aug 10, 2026' }).click({ force: true });
      expect(await current(page)).toBe('4 weeks');
      expect(await page.locator('#analyticsView [role="menuitemcheckbox"][aria-checked="true"]').count()).toBe(4);

      await page.getByRole('menuitemcheckbox', { name: 'Sep 21, 2026' }).click();
      expect(await isOpen(page)).toBe(true);
      expect(await current(page)).toBe('3 weeks');
      expect(await page.locator('#analyticsView [role="menuitemcheckbox"][aria-disabled="true"]').count()).toBe(0);
    });

    it('toggles with the keyboard and closes with Esc, returning focus', async () => {
      const page = await openAnalytics(browser);
      await weekMode(page);
      await btn(page).focus();
      await page.keyboard.press('Enter');
      expect(await active(page)).toBe('Sep 28, 2026');
      await page.keyboard.press('End');
      await page.keyboard.press(' ');
      expect(await isOpen(page)).toBe(true);
      expect(await current(page)).toBe('3 weeks');
      expect(await active(page)).toBe('Aug 10, 2026');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      expect(await current(page)).toBe('4 weeks');
      // At the limit, an unchecked week cannot be added.
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      expect(await current(page)).toBe('4 weeks');
      await page.keyboard.press('Escape');
      expect(await isOpen(page)).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('an-wp-btn'))).toBe(true);
    });

    it('an empty selection shows a prompt and the existing empty message', async () => {
      const page = await openAnalytics(browser);
      await weekMode(page);
      await btn(page).click();
      for (const name of LABELS.slice(0, 2)) await page.getByRole('menuitemcheckbox', { name }).click();
      expect(await current(page)).toBe('Pick weeks');
      await settle(page);
      expect(await page.locator('#anTableWrap .an-empty').textContent()).toBe('Pick a portal and at least one week to compare.');
    });
  });
});

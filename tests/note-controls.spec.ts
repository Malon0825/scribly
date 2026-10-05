import { test, expect, type Page } from '@playwright/test';
import type { Workspace } from '../src/types';

const stamp = '2026-10-05T00:00:00Z';
async function open(page: Page, theme: 'light' | 'dark', large = false) {
  const workspace: Workspace = { schemaVersion: 5, theme, activeId: 'note', referenceId: null,
    appearance: { elementSize: large ? 'large' : 'medium', textScale: large ? 120 : 100, font: 'system' },
    folders: [], notes: [{ id: 'note', title: 'Pinned controls', folderId: null, archived: false,
      createdAt: stamp, updatedAt: stamp,
      content: Array.from({ length: 70 }, (_, index) => `<p>needle paragraph ${index}</p>`).join('') }] };
  await page.addInitScript(workspace => localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document: workspace, dataPath: 'Controls test' })), workspace);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) test(`${theme} strip remains opaque and toolbar fits desktop and narrow Large`, async ({ page }) => {
  await open(page, theme, true);
  for (const width of [1920, 850]) {
    await page.setViewportSize({ width, height: 920 });
    const toolbar = page.locator('.editor-toolbar');
    await expect.poll(() => toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const name of ['Undo', 'Redo', 'Bold', 'Italic', 'Find in note']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport();
    }
    await page.getByRole('button', { name: 'Find in note', exact: true }).click();
    await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('needle');
    await expect(page.locator('.find-count')).toHaveText(/of 70$/);
    await page.locator('.document-panel > .document-scroll').evaluate(el => el.scrollTop = 600);
    const bounds = await page.evaluate(() => {
      const strip = document.querySelector('.note-controls')!;
      const panel = document.querySelector<HTMLElement>('.document-panel')!;
      const box = panel.getBoundingClientRect();
      return { strip: strip.getBoundingClientRect().toJSON(), panel: { left: box.left + panel.clientLeft, width: panel.clientWidth, top: box.top + panel.clientTop }, opacity: getComputedStyle(strip).backgroundColor };
    });
    expect(Math.abs(bounds.strip.left - bounds.panel.left)).toBeLessThan(2);
    expect(Math.abs(bounds.strip.width - bounds.panel.width)).toBeLessThan(2);
    expect(Math.abs(bounds.strip.top - bounds.panel.top)).toBeLessThan(3);
    expect(bounds.opacity).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByRole('textbox', { name: 'Find text', exact: true })).toBeInViewport();
    await page.getByRole('textbox', { name: 'Find text', exact: true }).press('Escape');
  }
  await expect(page.locator('.item-backlinks')).toHaveCount(0);
  await page.getByRole('button', { name: 'More formatting tools', exact: true }).click();
  for (const name of ['Add images', 'Start highlighting', 'Start drawing']) {
    await expect(page.getByRole('button', { name, exact: true }).locator('svg')).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Start drawing', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Start drawing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop drawing', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('selected text shortcuts, unobscured match navigation, grouped replace Undo and Escape restoration', async ({ page }) => {
  await open(page, 'light');
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await editor.evaluate(el => {
    el.focus(); const node = el.querySelector('p')!.firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 6);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('textbox', { name: 'Find text', exact: true })).toHaveValue('needle');
  await expect(page.locator('.find-count')).toHaveText(/of 70$/);
  await page.keyboard.press('Control+h');
  await expect(page.getByRole('textbox', { name: 'Replace with', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous match', exact: true }).click();
  await expect(page.locator('.find-count')).toHaveText('70 of 70');
  const position = await page.evaluate(() => {
    const match = document.querySelector('.find-current')!.getBoundingClientRect();
    const strip = document.querySelector('.note-controls')!.getBoundingClientRect();
    const footer = document.querySelector('.document-footer')!.getBoundingClientRect();
    return { top: match.top, bottom: match.bottom, stripBottom: strip.bottom, footerTop: footer.top };
  });
  expect(position.top).toBeGreaterThanOrEqual(position.stripBottom);
  expect(position.bottom).toBeLessThanOrEqual(position.footerTop);
  await page.getByRole('textbox', { name: 'Replace with', exact: true }).fill('changed');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await expect(editor).not.toContainText('needle');
  await expect(page.locator('.replacement-status')).toContainText('Replaced 70');
  await page.locator('.replacement-status').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.find-match')).toHaveCount(70);
  await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('missing');
  await expect(page.locator('.find-count')).toHaveText('No results');
  await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('');
  await expect(page.locator('.find-count')).toHaveText('');
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await expect.poll(() => page.locator('.document-panel > .document-scroll').evaluate(el => el.scrollTop)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+h');
  expect(await page.locator('.find-disclosure').evaluate(el => getComputedStyle(el).transform)).toBe('none');
});

import { test, expect, type Page } from '@playwright/test';
import { emptyBoard } from '../src/boardData';
import type { Workspace } from '../src/types';

const element = { id: 'api', type: 'rectangle', x: 300, y: 160, width: 210, height: 100, angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 12, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, index: null };
const fixture = (theme: Workspace['theme'], note = false, large = false): Workspace => ({ schemaVersion: 2, theme, activeId: note ? 'note' : 'board', referenceId: 'note', folders: [{ id: 'work', name: 'Work' }],
  ...(large ? { appearance: { elementSize: 'large' as const, textScale: 150, font: 'system' } } : {}),
  notes: [{ id: 'note', title: 'Writing in focus', content: '<p>Preserve this selection while writing.</p>', folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' },
    { id: 'board', kind: 'board', title: 'Architecture in focus', content: '', board: { ...emptyBoard(), elements: [element] as never }, folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' }] });
async function open(page: Page, doc: Workspace) {
  await page.addInitScript(document => {
    localStorage.clear(); localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Focus test' }));
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if ((window as any).focusSaveFailure && key === 'still-notes-browser-v1') throw Error('Focus save failed'); return set.call(this, key, value); };
  }, doc);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: doc.activeId === 'board' ? 'Board title' : 'Note title', exact: true })).toBeVisible({ timeout: 30000 });
  if (doc.activeId === 'board') await expect(page.locator('.board-canvas canvas').first()).toBeVisible({ timeout: 30000 });
}
async function focused(page: Page) {
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.brand')).toBeHidden(); await expect(page.locator('.document-head')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Reference', exact: true })).toBeHidden();
  await expect(page.locator('.sidebar').first()).toHaveAttribute('inert', '');
  await expect(page.locator('.reference-panel')).toHaveAttribute('inert', '');
  await expect(page.locator('.save-state')).toBeVisible();
  await expect.poll(async () => (await page.locator('.workspace').boundingBox())!.width - (await page.locator('.document-panel').boundingBox())!.width).toBeLessThan(3);
  await expect(page.locator('.document-footer .word-count')).toBeHidden(); await expect(page.locator('.document-footer .export-shortcut')).toBeHidden();
}
for (const theme of ['light', 'dark'] as const) test(`board focus uses the full ${theme} workspace, keeps drawing tools and restores secondary commands`, async ({ page }) => {
  await open(page, fixture(theme));
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  const canvas = await page.locator('.board-canvas canvas').first().elementHandle();
  const before = (await page.locator('.board-canvas').boundingBox())!;
  await page.mouse.click(before.x + 410, before.y + 210);
  await expect(page.getByText('Stroke width', { exact: true })).toBeVisible();
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((n: any) => n.id === 'board').board);
  await page.getByRole('button', { name: 'Focus', exact: true }).click(); await focused(page);
  expect((await page.locator('.board-canvas').boundingBox())!.height).toBeGreaterThan(before.height);
  await expect(page.locator('[data-testid="toolbar-rectangle"]')).toBeVisible();
  await expect(page.getByText('Stroke width', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Architecture', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Copy for Miro', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mermaid', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Brand logos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeHidden();
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
  await page.screenshot({ path: `release/focus-board-${theme}.png` });
  const tools = page.getByRole('button', { name: 'Board actions', exact: true });
  await tools.click(); await expect(tools).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Mermaid', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Architecture', exact: true }).focus();
  await page.keyboard.press('Control+Shift+f');
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toBeVisible();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Focus', exact: true }).click(); await page.getByRole('button', { name: 'Focus', exact: true }).click(); }
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((n: any) => n.id === 'board').board);
  expect(after.elements[0].x).toBe(snapshot.elements[0].x); expect(after.elements[0].width).toBe(snapshot.elements[0].width);
});
test('minimum-window focus with large text and reduced motion keeps exit, actions and saving reachable', async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, fixture('dark', false, true));
  await page.getByRole('button', { name: 'Focus', exact: true }).click(); await focused(page);
  for (const locator of [page.getByRole('button', { name: 'Focus', exact: true }), page.getByRole('button', { name: 'Board actions', exact: true }), page.locator('.save-state')]) {
    const box = (await locator.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(850); expect(box.y + box.height).toBeLessThanOrEqual(600);
  }
  expect((await page.locator('.board-canvas').boundingBox())!.height).toBeGreaterThan(400);
  await page.evaluate(() => { document.documentElement.dataset.window = 'maximized'; });
  await expect(page.locator('.app')).toHaveCSS('border-top-left-radius', '0px');
  await page.getByRole('button', { name: 'Board actions', exact: true }).focus(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toBeVisible();
});
test('writing focus preserves the editor and selection; formatting, saving failure and retry stay available', async ({ page }) => {
  await open(page, fixture('light', true));
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  const original = await editor.elementHandle();
  await editor.evaluate(el => { el.focus(); const text = el.querySelector('p')!.firstChild!; const range = document.createRange(); range.setStart(text, 9); range.setEnd(text, 13); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await page.getByRole('button', { name: 'Focus', exact: true }).click(); await focused(page);
  await expect(editor).toBeFocused(); expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('this');
  await expect(page.locator('.editor-toolbar')).toBeHidden(); await expect(page.locator('.weekly-bar')).toBeHidden();
  await page.getByRole('button', { name: 'Formatting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bold', exact: true }).click(); await expect(editor.locator('strong')).toHaveText('this');
  await page.getByRole('button', { name: 'Formatting', exact: true }).click(); await expect(editor).toBeFocused();
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await page.evaluate(() => { (window as any).focusSaveFailure = true; });
  await editor.press('End'); await editor.pressSequentially(' New draft');
  await expect(page.locator('.save-state')).toContainText('Save failed', { timeout: 15000 }); await expect(page.getByRole('alert').filter({ hasText: 'Focus save failed' })).toBeVisible();
  await page.evaluate(() => { (window as any).focusSaveFailure = false; }); await page.locator('.save-state').click();
  await expect(page.locator('.save-state')).toContainText('Saved in browser');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  expect(await original!.evaluate(el => el.isConnected)).toBe(true); await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
});

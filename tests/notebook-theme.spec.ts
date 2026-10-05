import { test, expect, type Page } from '@playwright/test';
import { validateWorkspace } from '../src/workspaceValidation';
import { emptyBoard } from '../src/boardData';
import type { Workspace } from '../src/types';

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
}

const fixture: Workspace = {
  schemaVersion: 5, theme: 'light', activeId: 'note', referenceId: 'reference',
  folders: [{ id: 'work', name: 'Task Report' }],
  notes: [
    { id: 'note', title: 'Task Report · Oct 5, 2026', content: '<h2>Task Done:</h2><ul><li><p>Transfer alerts to the production channel</p></li><li><p>Finish monthly task logging</p></li></ul><h2>Target Today:</h2><p>Continue monitoring</p>', folderId: 'work', archived: false, createdAt: '2026-10-05', updatedAt: '2026-10-05' },
    { id: 'reference', title: 'Daily Task', content: '<p>Keep this reference visible.</p>', folderId: 'work', archived: false, createdAt: '2026-10-05', updatedAt: '2026-10-05' },
  ],
};

test('Notebook is accepted by the persistence boundary and unknown themes are rejected', () => {
  expect(() => validateWorkspace({ ...fixture, theme: 'notebook' })).not.toThrow();
  expect(() => validateWorkspace({ ...fixture, theme: 'unknown' })).toThrow();
});

test('Notebook saves its theme and editing survives reload, Reference, and Focus', async ({ page }) => {
  await page.addInitScript(document => {
    if (!localStorage.getItem('still-notes-browser-v1')) {
      localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Theme test' }));
    }
  }, fixture);
  await page.goto('/');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('dialog', { name: 'Appearance', exact: true }).getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'notebook');
  const density = page.getByRole('button', { name: 'Compact note rows', exact: true });
  await expect(density).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sidebar .note-preview')).toHaveCount(0);
  await density.click();
  await expect(density).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sidebar .note-preview').first()).toBeVisible();
  await density.click();
  const editor = page.locator('.document-editor .tiptap');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Saved notebook draft.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].content)).toContain('Saved notebook draft.');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'notebook');
  await expect(editor).toContainText('Saved notebook draft.');
  await settle(page);
  await page.screenshot({ path: test.info().outputPath('notebook-desktop.png') });
  const resize = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  const initialWidth = await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width);
  const grip = (await resize.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2);
  await page.mouse.up();
  await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(initialWidth + 40, 0);
  const seam = await page.locator('.workspace').evaluate(el => {
    const sidebar = el.querySelector('.sidebar')!.getBoundingClientRect();
    const document = el.querySelector('.document-panel')!.getBoundingClientRect();
    const binding = el.querySelector('.notebook-binding')!.getBoundingClientRect();
    return { gap: document.left - sidebar.right, straddles: binding.left < sidebar.right && binding.right > document.left };
  });
  expect(seam.gap).toBeCloseTo(6, 0);
  expect(seam.straddles).toBe(true);
  await resize.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(initialWidth + 30, 0);
  await resize.dblclick();
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.locator('.notebook-binding')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.locator('.notebook-binding')).toBeVisible();
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(page.locator('.reference-panel')).toBeVisible();
  await expect(page.locator('.reference-editor .tiptap')).toHaveAttribute('contenteditable', 'false');
  await settle(page);
  await page.screenshot({ path: test.info().outputPath('notebook-reference.png') });
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(editor).toContainText('Saved notebook draft.');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.setViewportSize({ width: 850, height: 600 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'notebook');
  await settle(page);
  await page.screenshot({ path: test.info().outputPath('notebook-narrow.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notebook', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(density).toHaveAttribute('aria-pressed', 'false');
});


test('Notebook board paper retains drawing data and authored background across theme changes', async ({ page }) => {
  const document: Workspace = { ...fixture, theme: 'notebook', activeId: 'board', referenceId: null,
    notes: [...fixture.notes, { ...fixture.notes[0], id: 'board', title: 'Notebook board', kind: 'board', content: '',
      board: { ...emptyBoard(), appState: { viewBackgroundColor: '#fafafa', gridSize: null } } }] };
  await page.addInitScript(document => {
    if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Board theme test' }));
  }, document);
  await page.goto('/');
  const canvas = page.locator('.board-canvas canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.notebook-binding')).toBeVisible();
  const alpha = () => canvas.evaluate(el => (el as HTMLCanvasElement).getContext('2d')!.getImageData(10, 10, 1, 1).data[3]);
  await expect.poll(alpha).toBe(0);
  const bounds = (await page.locator('.board-canvas').boundingBox())!;
  await page.mouse.click(bounds.x + 350, bounds.y + 250);
  await page.keyboard.press('r');
  await page.mouse.move(bounds.x + 350, bounds.y + 250); await page.mouse.down();
  await page.mouse.move(bounds.x + 520, bounds.y + 360, { steps: 8 }); await page.mouse.up();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note: { id: string }) => note.id === 'board').board);
  await expect.poll(async () => (await saved()).elements.length).toBe(1);
  expect((await saved()).appState.viewBackgroundColor).toBe('#fafafa');
  const drawing = (await saved()).elements;
  await settle(page);
  await page.screenshot({ path: test.info().outputPath('notebook-board.png') });
  const instance = await canvas.elementHandle();
  for (const theme of ['Light', 'Dark', 'Notebook']) {
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('dialog', { name: 'Appearance', exact: true }).getByRole('button', { name: theme, exact: true }).click();
    await expect.poll(alpha).toBe(theme === 'Notebook' ? 0 : 255);
    expect(await instance!.evaluate(el => el.isConnected)).toBe(true);
    expect((await saved()).appState.viewBackgroundColor).toBe('#fafafa');
    expect((await saved()).elements).toEqual(drawing);
  }
  await page.reload();
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect.poll(alpha).toBe(0);
  expect((await saved()).elements).toEqual(drawing);
});

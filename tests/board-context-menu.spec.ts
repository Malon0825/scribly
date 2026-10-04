import { test, expect, type Page } from '@playwright/test';
import { emptyBoard } from '../src/boardData';
import type { Workspace } from '../src/types';

const shape = { id: 'api', type: 'rectangle', x: 300, y: 160, width: 210, height: 100, angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 12, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, index: null };
const fixture = (theme: Workspace['theme'], large = false): Workspace => ({ schemaVersion: 2, theme, activeId: 'board', referenceId: null, folders: [{ id: 'work', name: 'Work' }],
  ...(large ? { appearance: { elementSize: 'large' as const, textScale: 150, font: 'system' } } : {}),
  notes: [{ id: 'board', kind: 'board', title: 'Context menu review', content: '', board: { ...emptyBoard(), elements: [shape] as never }, folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' }] });
async function open(page: Page, theme: Workspace['theme'], large = false) {
  await page.addInitScript(document => { localStorage.clear(); localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Context test' })); }, fixture(theme, large));
  await page.goto('/'); await expect(page.locator('.board-canvas canvas').first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect.poll(async () => (await page.locator('.workspace').boundingBox())!.width - (await page.locator('.document-panel').boundingBox())!.width).toBeLessThan(3);
}
async function menu(page: Page, edge = false) {
  const bounds = (await page.locator('.board-canvas').boundingBox())!;
  await page.mouse.click(bounds.x + 400, bounds.y + 210);
  await page.mouse.click(bounds.x + (edge ? bounds.width - 8 : 400), bounds.y + (edge ? bounds.height - 8 : 210), { button: 'right' });
  const popup = page.locator('.context-menu'); await expect(popup).toBeVisible(); return popup;
}
const count = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].board.elements.filter((e: any) => !e.isDeleted).length);

for (const theme of ['light', 'dark'] as const) test(`board context menu matches ${theme} surfaces, presses without early activation and keeps Undo`, async ({ page }) => {
  await open(page, theme); const canvas = await page.locator('.board-canvas canvas').first().elementHandle();
  const popup = await menu(page);
  const styling = await popup.evaluate(el => {
    const menu = getComputedStyle(el), panel = getComputedStyle(document.querySelector('.document-panel')!);
    return { background: menu.backgroundColor, panel: panel.backgroundColor, font: menu.fontFamily };
  });
  expect(styling.background).toBe(styling.panel); expect(styling.font).toContain('Segoe UI');
  const duplicate = popup.locator('[data-testid="duplicateSelection"] button');
  await expect(duplicate).toBeVisible(); await duplicate.hover();
  const hovered = await duplicate.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.mouse.down(); expect(await count(page)).toBe(1);
  expect(await duplicate.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await duplicate.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(hovered);
  await page.mouse.up(); await expect(popup).toHaveCount(0); await expect.poll(() => count(page)).toBe(2);
  await page.keyboard.press('Control+z'); await expect.poll(() => count(page)).toBe(1);
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
  await menu(page); await expect(popup).toHaveCSS('opacity', '1'); await page.screenshot({ path: `release/board-context-menu-${theme}.png` });
  const bounds = (await page.locator('.board-canvas').boundingBox())!;
  await page.mouse.click(bounds.x + 700, bounds.y + 200); await expect(popup).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('context menu supports arrow/Home/End navigation, Escape focus return and Tab exit without changing the drawing', async ({ page }) => {
  await open(page, 'dark'); const popup = await menu(page); const items = popup.locator('button');
  await page.keyboard.press('ArrowDown'); await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home'); await expect(items.first()).toBeFocused();
  await page.keyboard.press('End'); await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Escape'); await expect(popup).toHaveCount(0); await expect(page.locator('.board-canvas .excalidraw').first()).toBeFocused();
  await expect(page.getByRole('button', { name: 'Focus', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu(page); await page.keyboard.press('Tab'); await expect(popup).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await menu(page); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End');
  await page.keyboard.press('Enter'); await expect(popup).toHaveCount(0); await expect.poll(() => count(page)).toBe(0);
  await page.keyboard.press('Control+z'); await expect.poll(() => count(page)).toBe(1);
  await menu(page); await popup.locator('[data-testid="duplicateSelection"] button').focus();
  await page.keyboard.press('Space'); await expect(popup).toHaveCount(0); await expect.poll(() => count(page)).toBe(2);
});

test('large-text context menu fits a minimum window, scrolls to every command and responds to reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'dark', true); const popup = await menu(page, true);
  const scroller = popup.locator('..'); const bounds = (await scroller.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(850); expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
  await page.keyboard.press('End'); await expect(popup.locator('button').last()).toBeFocused();
  const last = (await popup.locator('button').last().boundingBox())!;
  expect(last.y).toBeGreaterThanOrEqual(bounds.y); expect(last.y + last.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  await expect(popup).toHaveCSS('transition-duration', '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0); await menu(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(popup).toHaveCSS('opacity', '1'); await expect(popup).toHaveCSS('transition-duration', '0s');
});

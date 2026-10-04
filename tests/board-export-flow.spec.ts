import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { emptyBoard, type BoardData } from '../src/boardData';
import { boardToMermaid } from '../src/boardMermaid';
import type { Workspace } from '../src/types';

const shape = (id: string, extra = {}) => ({ id, type: 'rectangle', x: 120, y: 110, width: 180, height: 80, angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 10, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, index: null, ...extra });
const label = (id: string, owner: string, text: string, x = 135) => shape(id, { type: 'text', text, originalText: text, containerId: owner, fontFamily: 2, fontSize: 20, lineHeight: 1.25, textAlign: 'center', verticalAlign: 'middle', autoResize: true, x, y: 132, width: 150, height: 30, backgroundColor: 'transparent' });
const board: BoardData = { ...emptyBoard(), elements: [shape('api', { boundElements: [{ id: 'api-label', type: 'text' }, { id: 'edge', type: 'arrow' }] }), label('api-label', 'api', 'API'), shape('db', { x: 460, boundElements: [{ id: 'db-label', type: 'text' }, { id: 'edge', type: 'arrow' }] }), label('db-label', 'db', 'Database', 475), shape('edge', { type: 'arrow', x: 300, y: 150, width: 160, height: 0, points: [[0, 0], [160, 0]], startBinding: { elementId: 'api', focus: 0, gap: 4 }, endBinding: { elementId: 'db', focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow', elbowed: false })] as never };
const fixture = (drawing = board, theme: Workspace['theme'] = 'light', large = false): Workspace => ({ schemaVersion: 2, theme, folders: [{ id: 'work', name: 'Work' }], activeId: 'board', referenceId: 'note', ...(large ? { appearance: { elementSize: 'large' as const, textScale: 150, font: 'system' } } : {}), notes: [{ id: 'note', title: 'Reference', content: '<p>Keep writing intact.</p>', folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' }, { id: 'board', kind: 'board', title: 'API architecture', content: '', board: drawing, folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' }] });
async function open(page: Page, doc = fixture()) {
  await page.addInitScript(document => {
    if (!sessionStorage.getItem('export-fixture')) { localStorage.clear(); localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Export flow test' })); sessionStorage.setItem('export-fixture', '1'); }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).exportCopies = [...((window as any).exportCopies || []), text]; } } });
  }, doc);
  await page.goto('/'); await expect(page.locator('.board-canvas canvas').first()).toBeVisible({ timeout: 30000 });
  // Restoring a legacy scene assigns engine indices/defaults asynchronously.
  // Assert export purity after that initial save, rather than racing it.
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('still-notes-browser-v1')!);
    return stored.document.notes.find((note: any) => note.kind === 'board').board.elements.every((element: any) => typeof element.index === 'string');
  })).toBe(true);
  await expect(page.getByRole('button', { name: 'Saved in browser', exact: true })).toBeVisible();
}
const copies = (page: Page) => page.evaluate(() => (window as any).exportCopies || []);
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export flowchart', exact: true });
async function inViewport(page: Page, locator: ReturnType<Page['getByRole']>, width = 850, height = 600) {
  await expect(locator).toBeVisible(); const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
}

for (const theme of ['light', 'dark'] as const) test(`one click copies the entire ${theme} board with defaults, including Focus`, async ({ page }) => {
  const errors: string[] = [], previews: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.url().includes('/mermaid.core-')) previews.push(r.url()); }); await open(page, fixture(board, theme));
  const canvas = await page.locator('.board-canvas canvas').first().elementHandle();
  await expect(page.getByRole('combobox', { name: 'Diagram direction' })).toHaveCount(0);
  const before = await page.evaluate(() => localStorage.getItem('still-notes-browser-v1'));
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  await expect.poll(() => copies(page)).toHaveLength(1); await expect(dialog(page)).toHaveCount(0);
  expect((await copies(page))[0]).toBe(boardToMermaid(board).code);
  await expect(page.getByRole('status').filter({ hasText: 'Copied Mermaid.' })).toBeVisible();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Architecture', exact: true })).toBeHidden();
  for (const name of ['Copy for Miro', 'Mermaid', 'Drawing', 'SVG', 'PNG']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect.poll(() => copies(page)).toHaveLength(2); await expect(dialog(page)).toHaveCount(0);
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('still-notes-browser-v1'))).toBe(before);
  expect(errors).toEqual([]); expect(previews).toEqual([]); await page.screenshot({ path: `release/export-flow-focus-${theme}.png` });
});

test('Mermaid preview, copy and download share code; direction is optional and remembered', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Copy code', exact: true })).toBeFocused();
  await expect(dialog(page).getByLabel('Mermaid preview').locator('svg')).toBeVisible({ timeout: 30000 });
  await expect(dialog(page).getByRole('combobox', { name: 'Diagram direction' })).toContainText('Left to right');
  await dialog(page).getByRole('combobox', { name: 'Diagram direction' }).click(); await page.getByRole('option', { name: 'Top to bottom', exact: true }).click();
  const code = await dialog(page).getByRole('textbox', { name: 'Mermaid code' }).inputValue(); expect(code).toMatch(/^flowchart TB\n/);
  await dialog(page).getByRole('button', { name: 'Copy code', exact: true }).click(); await expect.poll(() => copies(page)).toEqual([code]);
  const download = page.waitForEvent('download'); await dialog(page).getByRole('button', { name: 'Download Mermaid', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toBe('API architecture.mmd'); expect(await readFile((await file.path())!, 'utf8')).toBe(code);
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Mermaid', exact: true })).toBeFocused();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[1].board.exportDirection)).toBe('TB');
  await page.reload(); await expect(page.locator('.board-canvas canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click(); expect((await copies(page))[0]).toBe(code);
});

test('missing labels and simplified arrowheads copy immediately with a notice', async ({ page }) => {
  const draft = { ...board, elements: board.elements.filter(e => e.id !== 'api-label').map(e => e.id === 'edge' ? { ...e, endArrowhead: 'dot' } : e) } as BoardData;
  expect(boardToMermaid(draft).issues.every(issue => !issue.requiresReview)).toBe(true);
  await open(page, fixture(draft)); await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  await expect.poll(() => copies(page)).toHaveLength(1); await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Some labels or arrowheads were simplified' })).toBeVisible();
  await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await expect(dialog(page).getByText('Export notes', { exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0); await expect(dialog(page).getByRole('button', { name: 'Copy code', exact: true })).toBeEnabled();
});

test('missing connections require acknowledgement; Show shape reveals repair tools in Focus', async ({ page }) => {
  const draft = { ...board, elements: board.elements.map(e => e.id === 'edge' ? { ...e, endBinding: null } : e) } as BoardData;
  await open(page, fixture(draft)); await page.getByRole('button', { name: 'Focus', exact: true }).click(); await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  expect(await copies(page)).toEqual([]); await expect(dialog(page)).toBeVisible(); await expect(dialog(page).getByRole('button', { name: 'Copy code', exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Show shape', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); await expect(page.locator('.architecture-inspector')).toBeVisible(); await expect(page.locator('.excalidraw').first()).toBeFocused();
  await expect(page.getByRole('button', { name: 'Board actions', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: /Export this reviewed draft/ }).check(); await dialog(page).getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect.poll(() => copies(page)).toHaveLength(1); expect((await copies(page))[0]).not.toContain('-->');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Copy for Miro', exact: true })).toBeFocused();
});

test('structural omissions remain reviewable while harmless notices have defaults', () => {
  const parentLoss = { ...board, elements: board.elements.map(e => e.id === 'api' ? { ...e, customData: { notifyArchitecture: { version: 1, role: 'component', parentId: 'missing' } } } : e) } as BoardData;
  expect(boardToMermaid(parentLoss).issues.some(issue => issue.requiresReview)).toBe(true);
  const unsupported = { ...board, elements: [...board.elements, shape('unsupported', { type: 'line', points: [[0, 0], [100, 10]], customData: { notifyArchitecture: { version: 1, role: 'component' } } })] } as BoardData;
  expect(boardToMermaid(unsupported).issues.some(issue => issue.requiresReview)).toBe(true);
});

test('unavailable clipboard opens selected code and a usable download fallback', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await open(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  const code = dialog(page).getByRole('textbox', { name: 'Mermaid code' }); await expect(code).toBeFocused();
  await expect(dialog(page).getByText(/Clipboard unavailable/)).toBeVisible();
  expect(await code.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(boardToMermaid(board).code);
  const download = page.waitForEvent('download'); await dialog(page).getByRole('button', { name: 'Download Mermaid', exact: true }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(boardToMermaid(board).code);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Copy for Miro', exact: true })).toBeFocused(); expect(errors).toEqual([]);
});

test('closing during clipboard work suppresses late feedback and permits reopening', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise<void>(resolve => { (window as any).finishExportCopy = resolve; }); });
  await dialog(page).getByRole('button', { name: 'Copy code', exact: true }).click(); await expect(dialog(page).getByRole('button', { name: 'Copying…', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await page.evaluate(() => (window as any).finishExportCopy());
  await expect(page.getByText('Copied Mermaid. Paste onto your Miro board. Miro arranges the shapes; logos stay in this drawing.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mermaid', exact: true }).click(); await expect(dialog(page).getByRole('button', { name: 'Copy code', exact: true })).toBeEnabled();
});

test('download failure is visible inside the dialog; retry clears it and preserves the board', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await page.evaluate(() => { const original = URL.createObjectURL; URL.createObjectURL = () => { URL.createObjectURL = original; throw Error('Download was blocked in test'); }; });
  await dialog(page).getByRole('button', { name: 'Download Mermaid', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Download was blocked in test');
  const download = page.waitForEvent('download'); await dialog(page).getByRole('button', { name: 'Download Mermaid', exact: true }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(boardToMermaid(board).code);
  await expect(dialog(page).getByRole('alert')).toHaveCount(0); await expect(dialog(page).getByRole('status').filter({ hasText: 'Export saved.' })).toBeVisible();
});

test('quick copy includes the latest bound-label edit and leaves Undo available', async ({ page }) => {
  await open(page); await page.locator('.topbar').getByRole('button', { name: 'Reference', exact: true }).click();
  await expect.poll(async () => (await page.locator('.board-canvas').boundingBox())!.width).toBeGreaterThan(900);
  const bounds = (await page.locator('.board-canvas').boundingBox())!;
  // The right component stays outside the engine's contextual properties pane.
  await page.mouse.dblclick(bounds.x + 550, bounds.y + 145);
  const input = page.locator('textarea.excalidraw-wysiwyg'); await expect(input).toBeVisible();
  await input.fill('Gateway'); await input.press('Escape');
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  await expect.poll(() => copies(page)).toHaveLength(1); expect((await copies(page))[0]).toContain('["Gateway"]');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  await expect.poll(() => copies(page)).toHaveLength(2); expect((await copies(page))[1]).toContain('["Database"]');
});

for (const theme of ['light', 'dark'] as const) test(`large text at the minimum ${theme} window keeps export actions visible with reduced motion`, async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await open(page, fixture(board, theme, true));
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await inViewport(page, page.getByRole('button', { name: 'Copy for Miro', exact: true })); await inViewport(page, page.getByRole('button', { name: 'Mermaid', exact: true }));
  await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  for (const name of ['Close dialog', 'Close', 'Download Mermaid', 'Copy code']) await inViewport(page, dialog(page).getByRole('button', { name, exact: true }));
  await dialog(page).getByRole('button', { name: 'Copy code', exact: true }).focus(); await page.keyboard.press('Tab'); await expect(dialog(page).getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.screenshot({ path: `release/export-flow-dialog-${theme}-minimum.png` });
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Mermaid', exact: true })).toBeFocused();
});

test('empty and oversized preview states keep a clear next action', async ({ page }) => {
  await open(page, fixture(emptyBoard())); await page.getByRole('button', { name: 'Copy for Miro', exact: true }).click();
  await expect(dialog(page).getByText('Start your flowchart', { exact: true })).toBeVisible(); await expect(dialog(page).getByRole('button', { name: 'Copy code', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  const big = { ...board, elements: Array.from({ length: 301 }, (_, i) => shape(`node-${i}`, { x: i * 240 })) } as BoardData;
  await page.evaluate(doc => { localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 2, document: doc, dataPath: 'Large export' })); }, fixture(big));
  await page.reload(); await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await expect(dialog(page).getByLabel('Mermaid preview')).toContainText('Large diagram'); await expect(dialog(page).getByRole('button', { name: 'Copy code', exact: true })).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Copy code', exact: true }).click(); await expect.poll(() => copies(page)).toHaveLength(1);
});

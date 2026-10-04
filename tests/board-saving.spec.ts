import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";
import { emptyBoard } from "../src/boardData";
import { writeFile } from "node:fs/promises";

function fixture(image: boolean): Workspace {
  const dataURL = `data:image/png;base64,${Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=', 'base64'), Buffer.alloc(900_000)]).toString('base64')}`;
  const element = { id: 'resizable', type: image ? 'image' : 'rectangle', x: 300, y: 150, width: 260, height: 200,
    angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0,
    opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 12, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false, index: null,
    ...(image ? { fileId: 'pixel', status: 'saved', scale: [1, 1], crop: null } : {}),
  };
  return { theme: 'light', activeId: 'board', referenceId: null, schemaVersion: 2, folders: [{ id: 'work', name: 'Work' }],
    notes: [{ id: 'board', folderId: 'work', title: 'Resize board', content: '', kind: 'board', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03',
      board: { ...emptyBoard(), elements: [element] as never, files: image ? { pixel: { id: 'pixel', mimeType: 'image/png', created: 1, dataURL } } as never : {} } },
    { id: 'note', folderId: 'work', title: 'Other note', content: '<p>Writing</p>', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' }] };
}
async function open(page: Page, image: boolean) {
  await page.addInitScript(document => {
    if (!sessionStorage.getItem('resize-seeded')) {
      localStorage.clear(); localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Resize test' }));
      sessionStorage.setItem('resize-seeded', '1');
    }
    const writes: { key: string; bytes: number }[] = [];
    (window as any).resizeWrites = writes;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if ((window as any).failResizeRecovery && key.startsWith('still-notes-recovery')) throw Error('Simulated recovery quota');
      if (this === localStorage && (key.startsWith('still-notes-recovery') || key === 'still-notes-browser-v1')) writes.push({ key, bytes: value.length });
      return set.call(this, key, value);
    };
    const stringify = JSON.stringify;
    (window as any).boardSerializations = 0;
    JSON.stringify = function(value, ...args: any[]) {
      if (value?.engine === 'excalidraw') (window as any).boardSerializations++;
      return (stringify as any)(value, ...args);
    } as typeof JSON.stringify;
  }, fixture(image));
  await page.goto('/');
  await expect(page.locator('.board-canvas canvas').last()).toBeVisible({ timeout: 30_000 });
  if (await page.getByRole('button', { name: 'Reference', exact: true }).getAttribute('aria-pressed') === 'true') await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('Saved in browser', { timeout: 15_000 });
  // Allow responsive layout/initial engine normalization to settle before sampling.
  await page.waitForTimeout(700);
  await page.evaluate(() => { (window as any).resizeWrites.length = 0; (window as any).boardSerializations = 0; });
}
const savedBoard = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((n: any) => n.id === 'board').board);

for (const image of [false, true]) test(`${image ? 'image' : 'shape'} resizing defers recovery and autosave through pauses and the five-second interval`, async ({ page }) => {
  test.setTimeout(45_000);
  await open(page, image);
  const canvas = (await page.locator('.board-canvas canvas').last().boundingBox())!;
  await page.mouse.click(canvas.x + 420, canvas.y + 240);
  const before = await savedBoard(page);
  await page.mouse.move(canvas.x + 560, canvas.y + 350); await page.mouse.down();
  await page.mouse.move(canvas.x + 610, canvas.y + 390, { steps: 8 });
  await page.waitForTimeout(5500); // Covers both former max-wait and workspace periodic flush.
  expect(await page.evaluate(() => (window as any).resizeWrites)).toEqual([]);
  expect(await page.evaluate(() => (window as any).boardSerializations)).toBe(0);
  await page.mouse.move(canvas.x + 640, canvas.y + 410, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await savedBoard(page)).elements[0].width).toBeGreaterThan(before.elements[0].width + 20);
  await expect(page.locator('.save-state')).toContainText('Saved in browser');
  await expect(page.getByText('Notes are saved. Recovery storage could not be refreshed.', { exact: true })).toHaveCount(0);
  const writes = await page.evaluate(() => (window as any).resizeWrites as { key: string; bytes: number }[]);
  expect(writes.filter(w => w.key === 'still-notes-browser-v1')).toHaveLength(1);
  expect(writes.some(w => w.key.includes(':file:'))).toBe(false);
  expect(Math.max(...writes.filter(w => w.key.startsWith('still-notes-recovery')).map(w => w.bytes))).toBeLessThan(10_000);
  await writeFile(`release/board-resize-measurement-${image ? 'image' : 'shape'}.json`, JSON.stringify({
    scope: 'Isolated Chromium board; pointer-held resize paused for 5500 ms; browser storage, not native frame latency',
    embeddedImageCharacters: image ? fixture(true).notes[0].board!.files.pixel.dataURL.length : 0,
    duringHold: { storageWrites: 0, boardSerializations: 0 },
    afterRelease: { persistedSaves: writes.filter(w => w.key === 'still-notes-browser-v1').length,
      recoveryImageWrites: writes.filter(w => w.key.includes(':file:')).length,
      recoveryBytes: writes.filter(w => w.key.startsWith('still-notes-recovery')).reduce((sum, w) => sum + w.bytes, 0) },
  }, null, 2));
  const final = await savedBoard(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await savedBoard(page)).elements[0].width).toBe(before.elements[0].width);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await savedBoard(page)).elements[0].width).toBe(final.elements[0].width);
  await page.reload();
  await expect(page.locator('.board-canvas canvas').last()).toBeVisible({ timeout: 30_000 });
  expect((await savedBoard(page)).elements[0].width).toBe(final.elements[0].width);
  if (image) expect((await savedBoard(page)).files.pixel.dataURL).toBe(fixture(true).notes[0].board!.files.pixel.dataURL);
});

test('explicit save during a held resize captures an immutable snapshot and later release still saves', async ({ page }) => {
  await open(page, false);
  const canvas = (await page.locator('.board-canvas canvas').last().boundingBox())!;
  await page.mouse.click(canvas.x + 420, canvas.y + 240);
  await page.mouse.move(canvas.x + 560, canvas.y + 350); await page.mouse.down();
  await page.mouse.move(canvas.x + 610, canvas.y + 390, { steps: 5 });
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await savedBoard(page)).elements[0].width).toBeGreaterThan(280);
  const snapshot = await savedBoard(page);
  await page.mouse.move(canvas.x + 650, canvas.y + 410, { steps: 5 });
  expect((await savedBoard(page)).elements[0].width).toBe(snapshot.elements[0].width);
  await page.mouse.up();
  await expect.poll(async () => (await savedBoard(page)).elements[0].width).toBeGreaterThan(snapshot.elements[0].width);
});

test('retry refreshes failed recovery after the board is acknowledged without another database save', async ({ page }) => {
  await open(page, false);
  await page.evaluate(() => { (window as any).failResizeRecovery = true; });
  await page.getByRole('button', { name: 'Mermaid', exact: true }).click();
  await page.getByRole('combobox', { name: 'Diagram direction' }).click();
  await page.getByRole('option', { name: 'Top to bottom', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Notes are saved. Recovery storage could not be refreshed.', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect((await savedBoard(page)).exportDirection).toBe('TB');
  await page.evaluate(() => { (window as any).failResizeRecovery = false; (window as any).resizeWrites.length = 0; });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Notes are saved. Recovery storage could not be refreshed.', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-recovery-v2')!).dirty)).toBe(false);
  expect(await page.evaluate(() => (window as any).resizeWrites.filter((w: any) => w.key === 'still-notes-browser-v1'))).toEqual([]);
  await page.reload(); await expect(page.locator('.board-canvas canvas').last()).toBeVisible({ timeout: 30_000 });
  expect((await savedBoard(page)).exportDirection).toBe('TB');
});

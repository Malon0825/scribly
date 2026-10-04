import { test, expect } from "@playwright/test";
import type { Workspace } from "../src/types";

for (const theme of ['light', 'dark'] as const) for (const large of [false, true]) {
  test(`${theme} creation controls align without overlap${large ? ' at minimum width and large text' : ''}`, async ({ page }) => {
    const document: Workspace = { theme, activeId: 'writing', referenceId: null, folders: [{ id: 'work', name: 'Work' }],
      ...(large ? { appearance: { elementSize: 'large' as const, textScale: 150, font: 'system' } } : {}),
      notes: [{ id: 'writing', title: 'Writing', content: '<p>Keep writing.</p>', folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' }] };
    if (large) { await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
    await page.addInitScript(document => { localStorage.clear(); localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Create test' })); }, document);
    await page.goto('/');
    const group = page.getByRole('group', { name: 'Create in current folder' });
    const note = group.getByRole('button', { name: 'New note', exact: true }), board = group.getByRole('button', { name: 'New board', exact: true });
    await expect(note).toBeVisible(); await expect(board).toBeVisible();
    const a = (await note.boundingBox())!, b = (await board.boundingBox())!, search = (await page.locator('.search').boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(search.y).toBeGreaterThan(b.y + b.height);
    expect(b.x).toBeCloseTo(a.x); expect(b.width).toBeCloseTo(a.width); expect(b.height).toBeCloseTo(a.height);
    expect((await note.locator('span').boundingBox())!.x).toBeCloseTo((await board.locator('span').boundingBox())!.x);
    expect((await note.locator('svg').boundingBox())!.width).toBeCloseTo((await board.locator('svg').boundingBox())!.width);
    for (const button of [note, board]) expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('.save-state')).toBeVisible();
    if (!large) {
      const sidebar = (await page.locator('.sidebar').boundingBox())!;
      await page.screenshot({ path: `release/sidebar-create-${theme}.png`, clip: { x: sidebar.x, y: sidebar.y, width: sidebar.width, height: b.y + b.height - sidebar.y + 12 } });
    }
    await note.focus(); await expect(note).toBeFocused();
    await page.keyboard.press('Tab'); await expect(board).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(note).toBeFocused();
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.length)).toBe(2);
    await board.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Board title' })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.filter((n: any) => n.kind === 'board' && n.folderId === 'work').length)).toBe(1);
  });
}

import { test, expect, type Page } from '@playwright/test';
import { emptyBoard } from '../src/boardData';
import { orderNotes, matchesNote } from '../src/notebookNavigation';
import { backupStatus } from '../src/backupHistory';
import { chooseTheme } from './themeHelper';
import type { Workspace } from '../src/types';

const stamp = '2026-10-01T00:00:00Z';
const fixture: Workspace = { theme: 'light', activeId: 'note', referenceId: null, folders: [{ id: 'work', name: 'Notebook' }],
  notes: [
    { id: 'note', title: 'Zebra writing', folderId: 'work', content: '<p>Keep this selected passage. A readable paragraph for daily writing.</p>', createdAt: stamp, updatedAt: stamp, archived: false },
    { id: 'second', title: 'Alpha ideas', folderId: 'work', content: `<p>${'context '.repeat(20)}needle belongs in the search snippet</p>`, createdAt: stamp, updatedAt: '2026-10-02T00:00:00Z', archived: false },
    { id: 'board', title: 'System sketch', folderId: 'work', content: '', kind: 'board', board: emptyBoard(), createdAt: stamp, updatedAt: stamp, archived: false },
  ] };
async function open(page: Page, doc = fixture) {
  await page.addInitScript(document => {
    if (localStorage.getItem('still-notes-browser-v1')) return;
    localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'UX critique test' }));
  }, doc);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toBeVisible();
}
async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('ordering, filtering and snippets preserve the stored manual order', () => {
  expect(orderNotes(fixture.notes, 'title').map(n => n.id)).toEqual(['second', 'board', 'note']);
  expect(orderNotes(fixture.notes, 'updated')[0].id).toBe('second');
  expect(fixture.notes.map(n => n.id)).toEqual(['note', 'second', 'board']);
  expect(matchesNote(fixture.notes[2], '', 'notes')).toBe(false);
  expect(backupStatus(null)).toBe('No backup export recorded');
  expect(backupStatus({ at: 1000, downloaded: false }, 1000 + 12 * 86400000)).toBe('Last backup export: 12 days ago');
});

test('Reference starts closed, opens directly without changing the editor and supports shortcuts', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'Reference', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Unfiled notes', exact: true })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  const original = await editor.elementHandle();
  await editor.evaluate(el => {
    el.focus(); const range = document.createRange(); range.setStart(el.firstChild!.firstChild!, 10); range.setEnd(el.firstChild!.firstChild!, 23);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  const selection = await page.evaluate(() => window.getSelection()?.toString());
  await page.getByRole('button', { name: 'Show Alpha ideas as reference', exact: true }).click();
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Reference content', exact: true })).toContainText('needle');
  await page.keyboard.press('Control+Shift+r');
  await expect(page.locator('.reference-panel')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Ctrl Shift R');
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
});

test('large folders support persistent density, safe sorting, filters and relevant search snippets', async ({ page }) => {
  const doc = structuredClone(fixture);
  doc.notes.push(...Array.from({ length: 184 }, (_, i) => ({ ...doc.notes[0], id: `large-${i}`, title: `Entry ${i}` })));
  await open(page, doc);
  await page.getByRole('button', { name: 'Compact note rows', exact: true }).click();
  await expect(page.locator('.note-preview')).toHaveCount(0);
  await pick(page, 'Sort items', 'A–Z');
  await expect(page.locator('.note-name').first()).toHaveText('Alpha ideas');
  await expect(page.locator('.note-select').first()).toHaveAttribute('draggable', 'false');
  await pick(page, 'Filter items', 'Boards');
  await expect(page.locator('.note-name')).toHaveText(['System sketch']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Compact note rows', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.note-name')).toHaveText(['System sketch']);
  await pick(page, 'Filter items', 'All items');
  await page.getByRole('textbox', { name: 'Search notes' }).fill('needle');
  await expect(page.locator('.note-preview')).toContainText('needle belongs');
  await page.getByRole('textbox', { name: 'Search notes' }).fill('');
  await pick(page, 'Sort items', 'Manual');
  await expect(page.locator('.note-name').first()).toHaveText('Zebra writing');
});

test('Export labels formats; backup tracking records requests only after successful export', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Export note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export formats' })).toContainText('Plain text (.txt)');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Notebook backup (.json)' }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/Scribly-backup.*json/);
  await expect(page.getByRole('button', { name: 'Back up notebook', exact: true })).toHaveAttribute('title', /Backup download requested: today/);
  const before = await page.evaluate(() => localStorage.getItem('scribly-backup:UX critique test'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Backup & restore', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('does not confirm the file was saved');
  await page.evaluate(() => { HTMLAnchorElement.prototype.click = () => { throw Error('Export blocked'); }; });
  await page.getByRole('button', { name: 'Export notebook backup', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Export failed: Error: Export blocked' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('scribly-backup:UX critique test'))).toBe(before);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Back up notebook', exact: true })).toHaveAttribute('title', /Backup download requested: today/);
});

for (const theme of ['light', 'dark'] as const) test(`${theme} readability, one-row toolbar and reduced-motion controls at desktop and minimum size`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, { ...fixture, theme });
  for (const width of [1440, 850]) {
    await page.setViewportSize({ width, height: width === 850 ? 600 : 920 });
    const data = await page.locator('.editor-toolbar').evaluate(el => {
      const buttons = Array.from(el.querySelectorAll('button'));
      const centers = buttons.map(button => { const box = button.getBoundingClientRect(); return box.top + box.height / 2; });
      return { spread: Math.max(...centers) - Math.min(...centers),
        first: buttons[0].getAttribute('aria-label') };
    });
    expect(data.spread).toBeLessThan(1); expect(data.first).toBe('Undo');
    const contrast = await page.locator('html').evaluate(el => {
      const style = getComputedStyle(el);
      const luminance = (hex: string) => {
        const c = hex.trim().slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255)
          .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      };
      const ratio = (a: string, b: string) => {
        const values = [luminance(style.getPropertyValue(a)), luminance(style.getPropertyValue(b))].sort((a,b) => b-a);
        return (values[0] + .05) / (values[1] + .05);
      };
      return ['--panel', '--sidebar', '--chrome', '--active'].map(surface => ratio('--muted', surface)).concat(ratio('--accent', '--on-accent'));
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: 'Draw pen', exact: true }).click();
    await expect(page.locator('.pen-mode-status')).toContainText('Drawing · Freehand');
    await page.getByRole('button', { name: 'Return to writing Esc', exact: true }).click();
    await page.getByRole('button', { name: 'Reference', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Reference note or board' })).toHaveText('Choose a reference…');
    await page.getByRole('button', { name: 'Close reference', exact: true }).click();
    await page.screenshot({ path: `release/ux-critique-${theme}-${width}.png` });
  }
  await chooseTheme(page, 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

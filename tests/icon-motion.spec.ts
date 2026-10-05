import { test, expect, type Page, type Locator } from '@playwright/test';
import type { Workspace } from '../src/types';
const fixture: Workspace = { schemaVersion: 2, theme: 'light', activeId: 'writing', referenceId: 'other', folders: [{ id: 'work', name: 'Work' }], notes: [
  { id: 'writing', title: 'Writing', content: '<p>Preserve this selection.</p>', folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' },
  { id: 'other', title: 'Reference note', content: '<p>Read only.</p>', folderId: 'work', archived: false, createdAt: '2026-10-03', updatedAt: '2026-10-03' },
] };
async function open(page: Page, dark = false, workspace = fixture) {
  await page.addInitScript(document => {
    localStorage.clear(); localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document, dataPath: 'Motion test' }));
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>(); (window as any).iconFrames = { requested: 0, pending };
    window.requestAnimationFrame = callback => { (window as any).iconFrames.requested++; const id = request(time => { pending.delete(id); callback(time); }); pending.add(id); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  }, { ...workspace, theme: dark ? 'dark' : 'light' });
  await page.goto('/'); await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
}
const pending = (page: Page) => page.evaluate(() => (window as any).iconFrames.pending.size);
const pose = (page: Page, selector: string) => page.locator(selector).evaluate(el => [el, ...el.querySelectorAll('*')].map(node => {
  const style = getComputedStyle(node);
  return [style.transform, style.opacity, style.strokeDashoffset, style.strokeWidth, node.getAttribute('d')].join(':');
}).join('|'));
async function idle(page: Page) {
  await expect.poll(() => pending(page)).toBe(0);
  const before = await page.evaluate(() => (window as any).iconFrames.requested);
  await page.waitForTimeout(300); expect(await page.evaluate(() => (window as any).iconFrames.requested)).toBe(before);
}
for (const dark of [false, true]) test(`AnimateIcons runs once in ${dark ? 'dark' : 'light'} and has no idle frame loop or early action`, async ({ page }) => {
  await open(page, dark); const button = page.getByRole('button', { name: 'New note', exact: true }); const icon = '.new-note .animated-icon';
  await expect(page.locator(`${icon} svg`)).toBeVisible(); await idle(page);
  const initial = await pose(page, icon); await button.hover(); await expect.poll(() => pose(page, icon)).not.toBe(initial);
  await idle(page); await page.mouse.down();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.length)).toBe(2);
  await page.mouse.up(); await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.length)).toBe(3);
  await page.mouse.move(700, 550); await idle(page); await expect.poll(() => pose(page, icon)).toBe(initial);
  expect(await page.locator('.save-state .animated-icon, .danger-text .animated-icon, .window-controls .animated-icon').count()).toBe(0);
  await page.screenshot({ path: `release/animated-icons-${dark ? 'dark' : 'light'}.png` });
});
test('AnimateIcons cancels promptly and runtime reduced motion restores a static icon', async ({ page }) => {
  await open(page); const button = page.getByRole('button', { name: 'New board', exact: true }); const icon = '.new-board .animated-icon';
  await idle(page); const initial = await pose(page, icon);
  await button.hover(); await expect.poll(() => pose(page, icon)).not.toBe(initial);
  await page.mouse.move(700, 550); await idle(page); await expect.poll(() => pose(page, icon)).toBe(initial);
  await button.hover(); await expect.poll(() => pose(page, icon)).not.toBe(initial);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await idle(page);
  const staticPose = await pose(page, icon); await page.mouse.move(700, 550); await button.hover(); await idle(page);
  expect(await pose(page, icon)).toBe(staticPose);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await idle(page); await page.mouse.move(700, 550); await button.hover();
  await expect.poll(() => pose(page, icon)).not.toBe(initial);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await idle(page); await expect.poll(() => pose(page, icon)).toBe(initial);
});
test('keyboard icon animation keeps editor selection, instance and command semantics', async ({ page }) => {
  await open(page); const editor = page.getByRole('textbox', { name: 'Note content', exact: true }); const instance = await editor.elementHandle();
  await editor.evaluate(el => { el.focus(); const text = el.querySelector('p')!.firstChild!; const range = document.createRange(); range.setStart(text, 9); range.setEnd(text, 13); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await page.getByRole('button', { name: 'Reference', exact: true }).click(); await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('this'); expect(await instance!.evaluate(el => el.isConnected)).toBe(true);
  await page.mouse.move(700, 550); await idle(page); const icon = 'button[aria-label="Focus"] .animated-icon'; const initial = await pose(page, icon);
  await page.keyboard.press('Tab'); await page.getByRole('button', { name: 'Focus', exact: true }).focus();
  await expect.poll(() => pose(page, icon)).not.toBe(initial); await page.keyboard.press('Enter');
  await expect(page.locator('.sidebar').first()).toHaveAttribute('inert', '');
  await editor.focus(); await idle(page); expect(await instance!.evaluate(el => el.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
});

async function hoverAnimation(page: Page, owner: Locator, kind?: string) {
  const viewport = page.viewportSize()!;
  const leave = () => page.mouse.move(viewport.width - 5, viewport.height - 5);
  await leave();
  const icon = owner.locator(kind ? `.animated-icon[data-icon="${kind}"]` : '.animated-icon').first();
  await expect(icon).toBeVisible();
  const read = () => icon.evaluate(el => [el, ...el.querySelectorAll('*')].map(node => {
    const style = getComputedStyle(node);
    return [style.transform, style.opacity, style.strokeDashoffset, style.strokeWidth, node.getAttribute('d'), node.getAttribute('transform')].join(':');
  }).join('|'));
  const drawingCanvas = await page.locator('.board-canvas .excalidraw').count();
  // Excalidraw owns an independent frame loop while its canvas is mounted.
  if (!drawingCanvas) await expect.poll(() => pending(page)).toBe(0);
  const initial = await read();
  // Leaving an image hides its toolbar and disables its hit targets.
  // Re-enter the image before moving onto one of its toolbar controls.
  const imageBounds = await owner.evaluate(el => {
    const rect = el.closest('.image-block')?.getBoundingClientRect();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
  });
  if (imageBounds) await page.mouse.move(imageBounds.x, imageBounds.y);
  await owner.hover();
  await expect.poll(read, { intervals: [16, 32, 50] }).not.toBe(initial);
  await leave();
  if (!drawingCanvas) await expect.poll(() => pending(page)).toBe(0);
  await expect.poll(read).toBe(initial);
}

for (const dark of [false, true]) test(`remaining ${dark ? 'dark' : 'light'} sidebar and formatting icons animate without editing`, async ({ page }) => {
  await open(page, dark);
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  const content = await editor.innerHTML();
  const instance = await editor.elementHandle();
  await hoverAnimation(page, page.locator('.search'), 'search');
  await hoverAnimation(page, page.locator('.folder-toggle').first(), 'folder');
  await hoverAnimation(page, page.locator('.note-select').first(), 'note');
  await hoverAnimation(page, page.getByRole('button', { name: 'New folder', exact: true }));
  await hoverAnimation(page, page.getByRole('button', { name: 'New note in Work', exact: true }));
  await hoverAnimation(page, page.getByRole('button', { name: 'Options for Work', exact: true }));
  await hoverAnimation(page, page.getByRole('button', { name: 'Archive', exact: true }));
  for (const name of ['Bold', 'Italic', 'Code block', 'Bullet list', 'Checklist', 'Add images', 'Start highlighting', 'Start drawing']) {
    await hoverAnimation(page, page.getByRole('button', { name, exact: true }));
  }
  await hoverAnimation(page, page.getByRole('combobox', { name: 'Text style', exact: true }));
  expect(await editor.innerHTML()).toBe(content);
  expect(await instance!.evaluate(el => el.isConnected)).toBe(true);
  await idle(page);
});

test('formatting, keyboard Undo/Redo and palette hover preserve the selection', async ({ page }) => {
  await open(page);
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await editor.evaluate(el => { el.focus(); const range = document.createRange(); range.selectNodeContents(el.querySelector('p')!); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); });
  await hoverAnimation(page, page.getByRole('button', { name: 'Text and background color options', exact: true }));
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Preserve this selection.');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Preserve this selection.');
  await editor.focus(); await page.keyboard.press('Control+z');
  await expect(editor.locator('strong')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor.locator('strong')).toHaveText('Preserve this selection.');
  await page.getByRole('button', { name: 'Text and background color options', exact: true }).click();
  const colors = page.getByRole('dialog', { name: 'Selection colors', exact: true });
  await hoverAnimation(page, colors.getByRole('button', { name: 'Default text', exact: true }));
  await hoverAnimation(page, colors.getByRole('button', { name: 'More colors', exact: true }));
  await page.keyboard.press('Escape'); await idle(page);
});

test('menu, Reference, Settings and board command icons animate without running commands', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await hoverAnimation(page, page.getByRole('button', { name: 'Copy to current note', exact: true }));
  await hoverAnimation(page, page.getByRole('button', { name: 'Open note', exact: true }));
  await page.getByRole('button', { name: 'Note options', exact: true }).click();
  const actions = page.getByRole('dialog', { name: 'Note options', exact: true });
  await hoverAnimation(page, actions.getByRole('button', { name: 'Duplicate note', exact: true }));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  for (const name of ['Light', 'Dark', 'System']) await hoverAnimation(page, settings.getByRole('button', { name, exact: true }));
  await hoverAnimation(page, settings.getByRole('button', { name: 'Close dialog', exact: true }));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(page.locator('.board-canvas .excalidraw')).toBeVisible();
  for (const name of ['Insert', 'Architecture', 'Export']) await hoverAnimation(page, page.locator('.board-commands').getByRole('button', { name, exact: true }));
  // Excalidraw's independent frames are outside the icon idle assertion.
});

test('image and code action icons animate while preserving their content', async ({ page }) => {
  await open(page);
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await editor.locator('p').first().click();
  await page.getByRole('button', { name: 'Code block', exact: true }).click();
  const code = page.locator('.document-editor .code-block').first();
  await expect(code).toBeVisible();
  const content = await code.locator('code').textContent();
  await hoverAnimation(page, code.getByRole('button', { name: 'Copy code', exact: true }));
  await hoverAnimation(page, code.getByRole('button', { name: 'Wrap code lines', exact: true }));
  expect(await code.locator('code').textContent()).toBe(content);
  await page.getByRole('button', { name: 'Add images', exact: true }).click();
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 60; canvas.getContext('2d')!.fillRect(0, 0, 100, 60); return canvas.toDataURL().split(',')[1]; });
  await page.getByLabel('Image files', { exact: true }).setInputFiles({ name: 'motion.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const image = page.locator('.document-editor .image-block').first();
  await image.hover();
  await hoverAnimation(page, image.getByRole('button', { name: 'View image', exact: true }));
  await hoverAnimation(page, image.getByRole('button', { name: 'Image options', exact: true }));
  await image.hover();
  await image.getByRole('button', { name: 'Image options', exact: true }).click();
  const actions = page.getByRole('dialog', { name: 'Image actions', exact: true });
  for (const name of ['Download image', 'Align left', 'Align center', 'Align right', 'Move up', 'Move down']) await hoverAnimation(page, actions.getByRole('button', { name, exact: true }));
  await page.keyboard.press('Escape');
  await expect(image.locator('img')).toHaveCount(1);
  await idle(page);
});

test('a large sidebar stays frame-idle and filtering releases an animated row', async ({ page }) => {
  const notes = Array.from({ length: 250 }, (_, index) => ({ ...fixture.notes[0], id: `row-${index}`, title: `Document ${index}` }));
  await open(page, false, { ...fixture, notes, activeId: 'row-0', referenceId: null });
  await expect(page.locator('.note-select')).toHaveCount(250);
  await idle(page);
  await hoverAnimation(page, page.locator('.note-select').first(), 'note');
  const search = page.getByRole('textbox', { name: 'Search notes', exact: true });
  await search.fill('Document 249');
  await expect(page.locator('.note-select')).toHaveCount(1);
  await page.mouse.move(700, 550); await idle(page);
  await search.clear(); await expect(page.locator('.note-select')).toHaveCount(250);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await idle(page);
  await page.locator('.note-select').first().hover(); await idle(page);
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('Document 0');
});

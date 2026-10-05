import { test, expect, type Page } from "@playwright/test";
import { readInk } from "../src/inkData";
import { inkPath } from "../src/inkPath";
const stamp = "2026-10-03T00:00:00Z";
async function open(page: Page, theme = "light", content = "<p>Draw on this note</p><p></p>") {
  await page.addInitScript(doc => { if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ document: doc, revision: 1, dataPath: "Test" })); }, { theme, activeId: "n", referenceId: "n", folders: [{ id: "f", name: "Work" }], notes: [{ id: "n", folderId: "f", title: "Drawing", content, archived: false, createdAt: stamp, updatedAt: stamp }] });
  await page.goto("/"); await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
}
const layer = (page: Page) => page.locator('.document-editor').locator('..').locator('.note-ink-layer');
const strokes = (page: Page) => layer(page).locator('g path');
async function draw(page: Page, wheel = false) {
  const p = (await page.locator('.document-editor p').first().boundingBox())!;
  await page.mouse.move(p.x + 12, p.y + 12); await page.mouse.down();
  await page.mouse.move(p.x + 70, p.y + 45, { steps: 7 });
  if (wheel) { await page.mouse.wheel(0, 100); await expect(layer(page)).toHaveAttribute('data-mode', 'guided'); }
  await page.mouse.move(p.x + 160, p.y + 18, { steps: 7 }); await page.mouse.up();
}
test('Draw defaults to solid freehand; saves, reloads, Reference, Undo/Redo and separate marker clearing', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click();
  await expect(page.getByRole('button', { name: 'Drawing mode: Free', exact: true })).toBeVisible(); await draw(page);
  await expect(strokes(page)).toHaveCount(1); await expect(strokes(page)).toHaveCSS('opacity', '1'); await expect(strokes(page)).toHaveCSS('stroke-width', '3px');
  expect((await strokes(page).getAttribute('d'))!.match(/Q/g)!.length).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(strokes(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(strokes(page)).toHaveCount(1);
  await page.getByRole('button', { name: /^(Start|Stop) highlighting$/ }).click();
  await expect(page.getByRole('button', { name: /^(Start|Stop) drawing$/ })).toHaveAttribute('aria-pressed', 'false');
  await draw(page); await expect(strokes(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click(); await page.getByRole('button', { name: 'Clear drawing strokes', exact: true }).click();
  await expect(strokes(page)).toHaveCount(1); await expect(strokes(page)).toHaveCSS('opacity', '0.35');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(strokes(page)).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].content)).toContain('&quot;kind&quot;:&quot;draw&quot;');
  await page.reload(); await expect(strokes(page)).toHaveCount(2);
  await expect(page.locator('.reference-editor').locator('..').locator('g .ink-drawing')).toHaveCount(1);
  await expect(layer(page)).not.toHaveClass(/drawing/);
});
test('Drawing options retain color/mode per tool; wheel reverses and Escape cancels without touching prose', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await page.getByRole('button', { name: 'red pen', exact: true }).click(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click(); await draw(page, true);
  expect((await strokes(page).getAttribute('d'))!.match(/L/g)).toHaveLength(1);
  expect(JSON.parse((await page.locator('.document-editor p').first().getAttribute('data-note-ink'))!)[0].smooth).toBeUndefined();
  await page.getByRole('button', { name: /^(Start|Stop) highlighting$/ }).click();
  await expect(page.getByRole('button', { name: 'Highlighter mode: Guided', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click();
  await expect(page.getByRole('button', { name: 'Drawing mode: Guided', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'red pen', exact: true })).toHaveAttribute('aria-pressed', 'true'); await page.keyboard.press('Escape');
  const box = (await layer(page).boundingBox())!; await page.mouse.move(box.x + 12, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 50);
  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(strokes(page)).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Note content', exact: true }).focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Draw on this note');
});
test('validated drawing imports preserve pen kind and reject unknown tools or marker/pen color mismatches', async ({ page }) => {
  const ink = [{ kind: 'draw', color: 'accent', points: [[.1, 0], [.3, 1]] }];
  expect(readInk(ink)).toEqual(ink);
  for (const bad of [{ ...ink[0], kind: 'script' }, { ...ink[0], color: 'yellow' }, { ...ink[0], kind: undefined }]) expect(readInk([bad])).toEqual([]);
  await open(page); await page.getByRole('button', { name: 'Options for Work', exact: true }).click(); const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import files…', exact: true }).click();
  const html = `<p data-note-ink="${JSON.stringify(ink).replaceAll('"', '&quot;')}">Imported drawing</p>`;
  await (await chooser).setFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ theme: 'light', activeId: 'i', folders: [], notes: [{ id: 'i', folderId: null, title: 'Imported', content: html, archived: false, createdAt: stamp, updatedAt: stamp }] })) });
  await expect(strokes(page)).toHaveCount(1); await expect(strokes(page)).toHaveClass(/ink-drawing/);
});
for (const theme of ['light', 'dark']) test(`${theme} keyboard drawing controls fit narrow windows and reduced motion`, async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await open(page, theme);
  await page.getByRole('button', { name: 'Reference', exact: true }).click(); await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).focus(); await page.keyboard.press('Enter'); await draw(page);
  await expect(strokes(page)).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Drawing options', exact: true }).focus(); await page.keyboard.press('Enter');
  const popup = page.getByRole('dialog', { name: 'Drawing options', exact: true }), box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(9); expect(box.x + box.width).toBeLessThanOrEqual(841); expect(box.y + box.height).toBeLessThanOrEqual(591);
  await page.screenshot({ path: `release/draw-${theme}.png` });
});

for (const theme of ['light', 'dark']) test(`${theme} drawing reaches the bottom of the note surface without adding text`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1040 });
  await open(page, theme, '<p>Short note</p>');
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await page.evaluate(() => new Promise<void>(resolve => {
    let previous = '', stable = 0;
    const settled = () => {
      const rect = document.querySelector('.document-scroll')!.getBoundingClientRect(), value = [rect.x, rect.y, rect.width, rect.height].join(',');
      stable = value === previous ? stable + 1 : 0; previous = value;
      if (stable >= 8) resolve(); else requestAnimationFrame(settled);
    }; requestAnimationFrame(settled);
  })); // Panel resize cancels active strokes; start only after its geometry settles.
  const scroll = page.locator('.document-scroll'), box = (await scroll.boundingBox())!;
  const surface = (await layer(page).boundingBox())!;
  const bottom = surface.y + surface.height - 8;
  const paragraph = (await page.locator('.document-editor p').boundingBox())!;
  expect(bottom).toBeGreaterThan(paragraph.y + paragraph.height);
  expect(surface.y + surface.height).toBeLessThanOrEqual(box.y + box.height);
  await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click();
  await page.mouse.move(surface.x + 60, bottom - 70); await page.mouse.down();
  await page.mouse.move(surface.x + 190, bottom, { steps: 12 }); await page.mouse.up();
  await expect(strokes(page)).toHaveCount(1);
  const inkBox = await strokes(page).boundingBox();
  expect(Math.abs(inkBox!.y + inkBox!.height - bottom)).toBeLessThanOrEqual(2); // Rounded 3px pen cap.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].content)).toContain('draw');
  await page.reload(); await expect(layer(page)).toBeVisible(); await expect(strokes(page)).toHaveCount(1);
  const savedBox = await strokes(page).boundingBox(), savedSurface = (await layer(page).boundingBox())!;
  expect(savedBox!.y + savedBox!.height).toBeLessThanOrEqual(savedSurface.y + savedSurface.height);
  await expect(page.locator('.document-editor p')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveText('Short note');
  await page.setViewportSize({ width: 1000, height: 600 });
  await expect.poll(async () => {
    const stroke = await strokes(page).boundingBox(), area = await layer(page).boundingBox();
    return !!stroke && !!area && stroke.y + stroke.height <= area.y + area.height;
  }).toBe(true);
});

test('stroke sizes stay independent per tool and saved strokes keep widths through Undo, reload and Reference', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await page.getByRole('button', { name: 'Large 6px stroke', exact: true }).click(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click(); await draw(page);
  await expect(strokes(page).first()).toHaveCSS('stroke-width', '6px');
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await page.getByRole('button', { name: 'Small 1px stroke', exact: true }).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await draw(page);
  await expect(strokes(page).nth(1)).toHaveCSS('stroke-width', '1px');
  await expect(strokes(page).first()).toHaveCSS('stroke-width', '6px');
  await page.getByRole('button', { name: 'Highlighter options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Medium 16px stroke', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Large 24px stroke', exact: true }).click(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^(Start|Stop) highlighting$/ }).click(); await draw(page);
  await expect(strokes(page).nth(2)).toHaveCSS('stroke-width', '24px');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(strokes(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(strokes(page).nth(2)).toHaveCSS('stroke-width', '24px');
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Small 1px stroke', exact: true })).toHaveAttribute('aria-pressed', 'true'); await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].content)).toContain('&quot;width&quot;:24');
  await page.reload(); await expect(strokes(page)).toHaveCount(3);
  for (const [index, width] of [6, 1, 24].entries()) {
    await expect(strokes(page).nth(index)).toHaveCSS('stroke-width', `${width}px`);
    await expect(page.locator('.reference-editor').locator('..').locator('g path').nth(index)).toHaveCSS('stroke-width', `${width}px`);
  }
});
test('stroke widths survive safe imports, reject unsafe sizes and preserve legacy defaults', async ({ page }) => {
  const base = { kind: 'draw' as const, color: 'default', points: [[.1, 0], [.3, 1]] };
  expect(readInk([{ ...base, width: 6 }])[0].width).toBe(6);
  for (const width of [0, -1, 65, Infinity, NaN, '6', 'url(evil)']) expect(readInk([{ ...base, width }])).toEqual([]);
  const ink = [{ ...base, width: 6 }, base, { color: 'yellow', points: base.points }];
  await open(page); await page.getByRole('button', { name: 'Options for Work', exact: true }).click(); const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import files…', exact: true }).click();
  const html = `<p data-note-ink="${JSON.stringify(ink).replaceAll('"', '&quot;')}">Imported sizes</p>`;
  await (await chooser).setFiles({ name: 'stroke-sizes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ theme: 'light', activeId: 'i', folders: [], notes: [{ id: 'i', folderId: null, title: 'Imported', content: html, archived: false, createdAt: stamp, updatedAt: stamp }] })) });
  await expect(strokes(page)).toHaveCount(3);
  for (const [index, width] of [6, 3, 16].entries()) await expect(strokes(page).nth(index)).toHaveCSS('stroke-width', `${width}px`);
});

for (const theme of ['light', 'dark']) test(`${theme} stroke mode belongs to its active tool group and stays keyboard operable`, async ({ page }) => {
  await open(page, theme);
  const highlight = page.getByRole('group', { name: 'Highlight tool', exact: true }), drawing = page.getByRole('group', { name: 'Draw tool', exact: true });
  await drawing.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click();
  const mode = drawing.getByRole('button', { name: 'Drawing mode: Free', exact: true });
  await expect(mode).toBeVisible(); await expect(mode.locator('svg')).toHaveCount(0);
  await expect(highlight.locator('.highlighter-mode')).toHaveCount(0);
  await mode.focus(); await page.keyboard.press('Enter');
  await expect(drawing.getByRole('button', { name: 'Drawing mode: Guided', exact: true })).toBeVisible();
  await expect(drawing.getByRole('button', { name: /^(Start|Stop) drawing$/ })).toHaveAttribute('aria-pressed', 'true');
  const groupBox = (await drawing.boundingBox())!, modeBox = (await drawing.locator('.highlighter-mode').boundingBox())!;
  expect(modeBox.x).toBeGreaterThan(groupBox.x); expect(modeBox.x + modeBox.width).toBeLessThan(groupBox.x + groupBox.width);
  await page.locator('.editor-toolbar').screenshot({ path: `release/tool-group-${theme}.png` });
  await highlight.getByRole('button', { name: /^(Start|Stop) highlighting$/ }).click();
  await expect(highlight.getByRole('button', { name: 'Highlighter mode: Guided', exact: true })).toBeVisible();
  await expect(drawing.locator('.highlighter-mode')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.locator('.highlighter-mode')).toHaveCount(0);
});

test('assisted curves reduce hand jitter, keep endpoints and bound rounded corners and loops', async ({ page }) => {
  const noisy = Array.from({ length: 50 }, (_, i) => ({ x: 10 + i * 4, y: 80 + (i === 0 || i === 49 ? 0 : i % 2 ? 4 : -4) }));
  await page.goto('/');
  const result = await page.evaluate(({ raw, smooth }) => {
    const ns = 'http://www.w3.org/2000/svg', paths = [raw, smooth].map(d => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); return p; });
    return paths.map(p => {
      const length = p.getTotalLength(), ys = Array.from({ length: 200 }, (_, i) => p.getPointAtLength(length * i / 199).y);
      const start = p.getPointAtLength(0), end = p.getPointAtLength(length);
      return { wobble: Math.sqrt(ys.reduce((sum, y) => sum + (y - 80) ** 2, 0) / ys.length), start: [start.x, start.y], end: [end.x, end.y] };
    });
  }, { raw: inkPath(noisy), smooth: inkPath(noisy, true) });
  expect(result[1].wobble).toBeLessThan(result[0].wobble * .6);
  expect(result[1].start).toEqual([10, 80]); expect(result[1].end).toEqual([206, 80]);
  for (const points of [[], [{ x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 0 }]]) {
    const path = inkPath(points, true); expect(path).not.toMatch(/NaN|Infinity/);
    if (points.length > 1) {
      expect(path).toContain('Q');
      const geometry = await page.evaluate(d => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d);
        const length = p.getTotalLength(), samples = Array.from({ length: 200 }, (_, i) => p.getPointAtLength(length * i / 199));
        return { minX: Math.min(...samples.map(p => p.x)), maxX: Math.max(...samples.map(p => p.x)), minY: Math.min(...samples.map(p => p.y)), maxY: Math.max(...samples.map(p => p.y)), end: [samples.at(-1)!.x, samples.at(-1)!.y] };
      }, path);
      expect(geometry.minX).toBeGreaterThanOrEqual(Math.min(...points.map(p => p.x)) - .02);
      expect(geometry.maxX).toBeLessThanOrEqual(Math.max(...points.map(p => p.x)) + .02);
      expect(geometry.minY).toBeGreaterThanOrEqual(Math.min(...points.map(p => p.y)) - .02);
      expect(geometry.maxY).toBeLessThanOrEqual(Math.max(...points.map(p => p.y)) + .02);
      expect(geometry.end[0]).toBeCloseTo(points.at(-1)!.x, 2); expect(geometry.end[1]).toBeCloseTo(points.at(-1)!.y, 2);
    }
  }
});

test('Auto assist defaults on; preview agrees with saved curves, Undo, reload and Reference', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click();
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto assist', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const p = (await page.locator('.document-editor p').first().boundingBox())!;
  await page.mouse.move(p.x + 10, p.y + 40); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(p.x + 10 + i * 5, p.y + 40 + (i === 20 ? 0 : i % 2 ? 4 : -4));
  const preview = layer(page).locator(':scope > path'); await expect(preview).toHaveAttribute('d', /Q/);
  const tip = await preview.evaluate(el => { const path = el as SVGPathElement, pt = path.getPointAtLength(path.getTotalLength()), box = el.parentElement!.getBoundingClientRect(); return { x: pt.x + box.x, y: pt.y + box.y }; });
  expect(Math.abs(tip.x - (p.x + 110))).toBeLessThan(.1); expect(Math.abs(tip.y - (p.y + 40))).toBeLessThan(.1);
  await page.mouse.up(); await expect(strokes(page)).toHaveCount(1); await expect(strokes(page)).toHaveAttribute('d', /Q/);
  const ink = JSON.parse((await page.locator('.document-editor [data-note-ink]').first().getAttribute('data-note-ink'))!);
  expect(ink[0].smooth).toBe(true); expect(ink[0].points.length).toBeGreaterThan(15);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(strokes(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(strokes(page)).toHaveAttribute('d', /Q/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].content)).toContain('&quot;smooth&quot;:true');
  await page.reload(); await expect(strokes(page)).toHaveAttribute('d', /Q/);
  await expect(page.locator('.reference-editor').locator('..').locator('g path')).toHaveAttribute('d', /Q/);
});

test('Auto assist can be disabled by keyboard for corners; changing tools preserves the choice and previous strokes', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click(); await draw(page);
  const first = await strokes(page).first().getAttribute('d');
  await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  const assist = page.getByRole('button', { name: 'Auto assist', exact: true }); await assist.focus(); await page.keyboard.press('Enter');
  await expect(assist).toHaveAttribute('aria-pressed', 'false'); await page.keyboard.press('Escape'); await draw(page);
  await expect(strokes(page).nth(1)).toHaveAttribute('d', /L/); expect(await strokes(page).nth(1).getAttribute('d')).not.toContain('Q');
  expect(await strokes(page).first().getAttribute('d')).toBe(first);
  await page.getByRole('button', { name: /^(Start|Stop) highlighting$/ }).click();
  await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click(); await page.getByRole('button', { name: 'Drawing options', exact: true }).click();
  await expect(assist).toHaveAttribute('aria-pressed', 'false'); await assist.click(); await page.keyboard.press('Escape');
  expect(await strokes(page).nth(1).getAttribute('d')).not.toContain('Q'); await draw(page); await expect(strokes(page).nth(2)).toHaveAttribute('d', /Q/);
});

test('safe imports preserve assisted and legacy drawings and reject nonboolean assistance', async ({ page }) => {
  const points = [[.1, 0], [.2, 1], [.3, 0], [.4, 1]], raw = { kind: 'draw', color: 'default', points }, ink = [{ ...raw, smooth: true }, raw];
  expect(readInk(ink)).toEqual(ink);
  for (const smooth of ['true', 1, null, {}, 'url(evil)']) expect(readInk([{ ...raw, smooth }])).toEqual([]);
  expect(readInk([{ color: 'yellow', points, smooth: true }])).toEqual([]);
  await open(page); await page.getByRole('button', { name: 'Options for Work', exact: true }).click(); const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import files…', exact: true }).click();
  const html = `<p data-note-ink="${JSON.stringify(ink).replaceAll('"', '&quot;')}">Assisted import</p>`;
  await (await chooser).setFiles({ name: 'assisted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ theme: 'light', activeId: 'i', folders: [], notes: [{ id: 'i', folderId: null, title: 'Imported', content: html, archived: false, createdAt: stamp, updatedAt: stamp }] })) });
  await expect(strokes(page)).toHaveCount(2); await expect(strokes(page).first()).toHaveAttribute('d', /Q/);
  expect(await strokes(page).nth(1).getAttribute('d')).not.toContain('Q');
});

test('wheel reversal restores assisted freehand from guided preview without losing pointer samples', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: /^(Start|Stop) drawing$/ }).click();
  const p = (await page.locator('.document-editor p').first().boundingBox())!;
  await page.mouse.move(p.x + 12, p.y + 12); await page.mouse.down();
  await page.mouse.move(p.x + 70, p.y + 45, { steps: 7 });
  const preview = layer(page).locator(':scope > path'); await expect(preview).toHaveAttribute('d', /Q/);
  await page.mouse.wheel(0, 100); await expect(layer(page)).toHaveAttribute('data-mode', 'guided'); await expect(preview).not.toHaveAttribute('d', /Q/);
  await page.mouse.move(p.x + 130, p.y + 15, { steps: 7 });
  await page.waitForTimeout(140); // Separate intentional wheel gestures past the controller's debounce.
  await page.mouse.wheel(0, 100); await expect(layer(page)).toHaveAttribute('data-mode', 'free'); await expect(preview).toHaveAttribute('d', /Q/);
  await page.mouse.up(); await expect(strokes(page)).toHaveCount(1); await expect(strokes(page)).toHaveAttribute('d', /Q/);
  const ink = JSON.parse((await page.locator('.document-editor [data-note-ink]').first().getAttribute('data-note-ink'))!);
  expect(ink[0].points.length).toBeGreaterThan(10); expect(ink[0].smooth).toBe(true);
});

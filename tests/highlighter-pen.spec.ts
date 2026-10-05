import { test, expect, type Page } from "@playwright/test";
import { readInk } from "../src/inkData";
import type { Workspace } from "../src/types";
const stamp = "2026-10-03T00:00:00Z";
const fixture: Workspace = { theme: "light", activeId: "n", referenceId: "n", folders: [{ id: "f", name: "Work" }], notes: [{ id: "n", folderId: "f", title: "Marker", content: "<p>Mark this paragraph</p><p>Keep this second paragraph</p><p></p>", archived: false, createdAt: stamp, updatedAt: stamp }] };
async function open(page: Page, theme: "light" | "dark" = "light", content = fixture.notes[0].content) {
  await page.addInitScript(doc => { if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ document: doc, revision: 1, dataPath: "Test" })); }, { ...fixture, theme, notes: [{ ...fixture.notes[0], content }] });
  await page.goto("/"); await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
}
const layer = (page: Page) => page.locator(".document-editor").locator("..").locator(".note-ink-layer");
const strokes = (page: Page) => layer(page).locator("g path");
async function gesture(page: Page, wheel = false) {
  const p = await page.locator(".document-editor p").first().boundingBox();
  await page.mouse.move(p!.x + 12, p!.y + p!.height / 2); await page.mouse.down();
  await page.mouse.move(p!.x + 55, p!.y + 5, { steps: 5 });
  await page.mouse.move(p!.x + 100, p!.y + 24, { steps: 5 });
  if (wheel) { await page.mouse.wheel(0, 100); await expect(layer(page)).toHaveAttribute("data-mode", "free"); }
  await page.mouse.move(p!.x + 180, p!.y + 12, { steps: 5 });
  await page.mouse.up();
}
test("Guided draws one straight stroke at any angle; Undo/Redo and text selection remain intact", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click();
  await expect(page.getByRole("button", { name: "Highlighter mode: Guided", exact: true })).toBeVisible();
  await gesture(page); await expect(strokes(page)).toHaveCount(1);
  expect((await strokes(page).getAttribute("d"))!.match(/L/g)).toHaveLength(1);
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Mark this paragraph");
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(strokes(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click(); await expect(strokes(page)).toHaveCount(1);
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: /^(Start|Stop) highlighting$/ })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("textbox", { name: "Note content", exact: true }).focus(); await page.keyboard.press("Control+Home"); await page.keyboard.press("Shift+End");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Mark this paragraph");
});
test("wheel while held switches to Free without scrolling; Free follows the hand and saves", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click();
  const scroll = await page.locator(".document-scroll").evaluate(el => el.scrollTop);
  await gesture(page, true); await expect(strokes(page)).toHaveCount(1);
  expect((await strokes(page).getAttribute("d"))!.match(/L/g)!.length).toBeGreaterThan(5);
  expect(await page.locator(".document-scroll").evaluate(el => el.scrollTop)).toBe(scroll);
  await expect(page.locator(".reference-editor").locator("..").locator("g path")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content)).toContain("data-note-ink");
  await page.reload(); await expect(strokes(page)).toHaveCount(1); await expect(layer(page)).not.toHaveClass(/drawing/);
  await expect(page.locator(".reference-editor").locator("..").locator("g path")).toHaveCount(1);
});
test("Escape, lost capture, blur and short taps cancel without saving a stroke", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click();
  const rect = await layer(page).boundingBox();
  for (const reason of ["pointercancel", "lostpointercapture", "blur", "Escape"]) {
    await page.mouse.move(rect!.x + 10, rect!.y + 15); await page.mouse.down(); await page.mouse.move(rect!.x + 150, rect!.y + 15);
    if (reason === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else if (reason === "Escape") await page.keyboard.press("Escape");
    else await layer(page).dispatchEvent(reason);
    await page.mouse.up(); await expect(strokes(page)).toHaveCount(0);
  }
  await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click();
  await layer(page).click({ position: { x: 30, y: 30 } }); await expect(strokes(page)).toHaveCount(0);
});
test("options provide mode/color choices and clear supports Undo", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: "Highlighter options", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Highlighter options", exact: true });
  await popup.getByRole("button", { name: "Free Follow your hand", exact: true }).click();
  await popup.getByRole("button", { name: "pink marker", exact: true }).click(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click(); await gesture(page);
  await expect(strokes(page)).toHaveCSS("stroke", "rgb(220, 129, 185)");
  await page.getByRole("button", { name: "Highlighter options", exact: true }).click(); await popup.getByRole("button", { name: "Clear marker strokes", exact: true }).click();
  await expect(strokes(page)).toHaveCount(0); await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(strokes(page)).toHaveCount(1);
});
test("annotations follow their block when prose is inserted above, including after reload", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click(); await gesture(page); await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Note content", exact: true }).focus(); await page.keyboard.press("Control+Home"); await page.keyboard.press("Enter");
  const p = page.locator('.document-editor p[data-note-ink]'); await expect(p).toHaveText("Mark this paragraph");
  await expect(strokes(page)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content)).toMatch(/^<p><\/p><p data-note-ink=/);
  await page.reload(); await expect(strokes(page)).toHaveCount(1); await expect(p).toHaveText("Mark this paragraph");
});
test("annotation validation rejects unsafe coordinates, unknown colors and oversized data", () => {
  expect(readInk([{ color: "yellow", points: [[.1, 0], [.2, 1]] }])).toHaveLength(1);
  for (const bad of ["not json", [{ color: "url(evil)", points: [[0, 0], [1, 1]] }], [{ color: "yellow", points: [[0, 0], [Infinity, 1]] }], [{ color: "yellow", points: [[0, 0], [1, 900]] }], " ".repeat(2_000_001)]) expect(readInk(bad)).toEqual([]);
});
test("splitting a marked paragraph does not duplicate its stroke", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click(); await gesture(page); await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Note content", exact: true }).focus(); await page.keyboard.press("Control+Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter"); await expect(strokes(page)).toHaveCount(1);
  await expect(page.locator('.document-editor p[data-note-ink]')).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.locator('.document-editor p').first()).toHaveText("Mark this paragraph");
});
test("marker selection action is keyboard accessible and portable imports keep only safe ink", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.focus(); await page.keyboard.press("Control+Home"); await page.keyboard.press("Shift+End");
  await page.getByRole("button", { name: "Highlighter options", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Highlight selected text", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.locator('.document-editor [data-background-color="yellow"]')).toHaveText("Mark this paragraph");
  const safe = JSON.stringify([{ color: "green", points: [[.1, 0], [.4, 1]] }]).replaceAll('"', "&quot;");
  const content = `<p data-note-ink="${safe}">Imported marker</p><p data-note-ink="malformed" onclick="bad()">Plain</p>`;
  await page.getByRole("button", { name: "Options for Work", exact: true }).click(); const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import files…", exact: true }).click();
  await (await chooser).setFiles({ name: "ink-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] })) });
  await expect(strokes(page)).toHaveCount(1);
  await expect(page.locator('.document-editor p[data-note-ink]')).toHaveText("Imported marker");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes.length)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[1].content)).not.toMatch(/malformed|onclick/);
});
test("wheel can reverse Free to Guided during a stroke and stays native when idle", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click();
  await page.getByRole("button", { name: "Highlighter mode: Guided", exact: true }).click();
  const box = await layer(page).boundingBox();
  await page.mouse.move(box!.x + 20, box!.y + 15); await page.mouse.down(); await page.mouse.move(box!.x + 80, box!.y + 60, { steps: 6 });
  await page.mouse.wheel(0, -100); await expect(layer(page)).toHaveAttribute("data-mode", "guided");
  await page.mouse.move(box!.x + 150, box!.y + 45); await page.mouse.up();
  expect((await strokes(page).getAttribute("d"))!.match(/L/g)).toHaveLength(1);
  await page.mouse.wheel(0, 100); await expect(layer(page)).toHaveAttribute("data-mode", "guided");
});
test("holding the toolbar pen button and wheeling switches the selected mode", async ({ page }) => {
  await open(page); const button = page.getByRole("button", { name: /^(Start|Stop) highlighting$/ });
  const rect = await button.boundingBox();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2); await page.mouse.down();
  await page.mouse.wheel(0, 100); await expect(layer(page)).toHaveAttribute("data-mode", "free"); await page.mouse.up();
  await expect(page.getByRole("button", { name: "Highlighter mode: Free", exact: true })).toBeVisible();
  await page.mouse.wheel(0, 100); await expect(page.getByRole("button", { name: "Highlighter mode: Free", exact: true })).toBeVisible();
});
test("image marker strokes track image resizing, persist and display read-only", async ({ page }) => {
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=";
  await open(page, "light", `<figure data-notify-image="" data-width="60"><img src="${pixel}" alt="Marker target"></figure><p></p>`);
  const frame = page.locator('.document-editor .image-block-frame');
  await expect(page.locator('.document-editor .note-image')).toBeVisible();
  await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click(); const rect = await frame.boundingBox();
  await page.mouse.move(rect!.x + rect!.width * .2, rect!.y + rect!.height * .25); await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * .75, rect!.y + rect!.height * .3, { steps: 10 }); await page.mouse.up();
  await expect(strokes(page)).toHaveCount(1); const width = await strokes(page).evaluate(el => (el as SVGGraphicsElement).getBBox().width);
  await page.keyboard.press("Escape"); await frame.hover();
  await page.locator('.document-editor').getByRole("button", { name: "Resize image from right", exact: true }).focus(); await page.keyboard.press("Home");
  await expect.poll(() => strokes(page).evaluate(el => (el as SVGGraphicsElement).getBBox().width)).toBeLessThan(width * .6);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content)).toContain('data-note-ink');
  await page.reload(); await expect(strokes(page)).toHaveCount(1);
  await expect(page.locator('.reference-editor').locator('..').locator('g path')).toHaveCount(1);
});
for (const theme of ["light", "dark"] as const) test(`${theme} narrow/reduced-motion highlighter and options fit the window`, async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" }); await open(page, theme);
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toHaveAttribute("aria-pressed", "false"); await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await page.getByRole("button", { name: /^(Start|Stop) highlighting$/ }).click(); await gesture(page); await expect(strokes(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Highlighter options", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Highlighter options", exact: true }), bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(9); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(841); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(591);
  await page.screenshot({ path: `release/highlighter-${theme}.png` });
});

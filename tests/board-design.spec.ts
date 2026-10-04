import { test, expect, type Page } from "@playwright/test";
import { emptyBoard } from "../src/boardData";
import type { Workspace } from "../src/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

test.setTimeout(60_000);
const shape = { id: "component", type: "rectangle", x: 120, y: 110, width: 180, height: 80,
  angle: 0, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2,
  strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
  seed: 12, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1,
  link: null, locked: false, index: null } as ExcalidrawElement;
const fixture: Workspace = { schemaVersion: 2, theme: "light", folders: [{ id: "work", name: "Work" }],
  activeId: "board", referenceId: "board", notes: [
    { id: "note", title: "Writing", folderId: "work", content: "<p>Preserve this selection while writing.</p>", archived: false, createdAt: "2026-10-03", updatedAt: "2026-10-03" },
    { id: "board", title: "Architecture design review", folderId: "work", kind: "board", content: "", board: { ...emptyBoard(), elements: [shape] }, archived: false, createdAt: "2026-10-03", updatedAt: "2026-10-03" },
  ] };
async function open(page: Page, document = fixture) {
  await page.addInitScript((document) => {
    if (sessionStorage.getItem("design-fixture")) return;
    localStorage.clear(); localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Design test" }));
    sessionStorage.setItem("design-fixture", "1");
  }, document);
  await page.goto("/"); await expect(page.locator(".board-canvas canvas").first()).toBeVisible({ timeout: 30000 });
}
const appearance = (page: Page, selector: string) => page.locator(selector).first().evaluate((e) => {
  const c = getComputedStyle(e); return { font: c.fontFamily, background: c.backgroundColor, foreground: c.color, selection: c.getPropertyValue("--color-selection").trim() };
});

for (const theme of ["light", "dark", "system"] as const) test(`board chrome uses Notify's ${theme} theme and Windows typography`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await open(page, { ...fixture, theme });
  const ui = await appearance(page, ".excalidraw"); expect(ui.font.startsWith('"Segoe UI"')).toBe(true);
  const panel = await appearance(page, ".document-panel"), toolbar = await appearance(page, ".App-toolbar");
  expect(toolbar.background).toBe(panel.background); expect(ui.foreground).toBe(panel.foreground);
  const accent = await page.locator("html").evaluate((e) => getComputedStyle(e).getPropertyValue("--accent").trim());
  expect(ui.selection).toBe(accent);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.screenshot({ path: `release/board-design-${theme}.png` });
  // A UI theme switch must never recolor the authoritative scene.
  await page.getByRole("button", { name: theme === "light" ? "Use dark mode" : "Use light mode" }).click();
  await expect.poll(async () => await page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[1].board.elements[0].backgroundColor)).toBe("#a5d8ff");
});

test("board press responds before activation; rapid layout changes retain the canvas and selection", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: "Reference", exact: true }).click();
  const canvas = await page.locator(".board-canvas canvas").first().elementHandle();
  const bounds = await page.locator(".board-canvas").boundingBox(); await page.mouse.click(bounds!.x + 210, bounds!.y + 155);
  const button = page.getByRole("button", { name: "Architecture", exact: true }); await button.hover();
  const hovered = await button.evaluate((e) => getComputedStyle(e).backgroundColor); await page.mouse.down();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  expect(await button.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
  expect(await button.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(hovered);
  await page.mouse.up(); await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Component", exact: true })).toBeEnabled();
  // Repeated commands arrive during the existing shell layout transition.
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
  }
  expect(await canvas!.evaluate((e) => e.isConnected)).toBe(true);
  await expect(page.getByRole("button", { name: "Component", exact: true })).toBeEnabled();
});

test("large text and controls keep the canvas, save state and board dialogs reachable at 850x600", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { ...fixture, theme: "dark", appearance: { elementSize: "large", textScale: 150, font: "system" } });
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Architecture", exact: true }).hover(); await page.mouse.down();
  await expect(page.getByRole("button", { name: "Architecture", exact: true })).toHaveCSS("transform", "none"); await page.mouse.up();
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  const canvas = await page.locator(".board-canvas").boundingBox(), footer = await page.locator(".document-footer").boundingBox();
  expect(canvas!.height).toBeGreaterThan(100); expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(footer!.y + 1);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(600);
  await page.getByRole("combobox", { name: "Architecture boundary" }).evaluate((e) => e.scrollIntoView({ block: "nearest" }));
  await page.getByRole("button", { name: "Import Mermaid", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import Mermaid", exact: true });
  const hint = await dialog.locator(".mermaid-hint").evaluate((e) => parseFloat(getComputedStyle(e).fontSize)); expect(hint).toBe(18);
  const code = dialog.getByRole("textbox", { name: "Mermaid flowchart" }); expect(await code.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBe(18);
  await dialog.getByRole("button", { name: "Preview drawing" }).click(); await expect(dialog.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "Create board", exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.screenshot({ path: "release/board-design-large-dialog.png" });
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Import Mermaid", exact: true })).toBeFocused();
});

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`engine Help dialog stays visible and dismissible with ${reducedMotion} motion`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion }); await open(page);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.locator(".help-icon").click();
  const dialog = page.locator(".excalidraw .Modal__content"); await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1"); await expect(dialog).toHaveCSS("transform", "none");
  await expect(page.getByRole("dialog", { name: "Help", exact: true })).toBeVisible();
  if (reducedMotion === "no-preference") {
    await page.emulateMedia({ reducedMotion: "reduce" }); await expect(dialog).toHaveCSS("opacity", "1");
  }
  expect((await appearance(page, ".excalidraw .Modal__content")).font.startsWith('"Segoe UI"')).toBe(true);
  if (reducedMotion === "reduce") await page.screenshot({ path: "release/board-design-help-reduced.png" });
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.locator(".board-canvas canvas").first()).toBeVisible();
});

test("Reference close and keyboard Focus move focus before making preview controls inert", async ({ page }) => {
  await open(page); const reference = page.getByLabel("Reference panel");
  await expect(reference.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
  const scroll = reference.locator(".board-preview-scroll"); await scroll.focus(); await expect(scroll).toHaveCSS("outline-style", "solid");
  await reference.getByRole("button", { name: "Close reference" }).click();
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toBeFocused(); await expect(reference).toHaveAttribute("inert", "");
  await page.keyboard.press("Enter"); await scroll.focus(); await page.keyboard.press("Control+Shift+f");
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toBeFocused(); await expect(reference).toHaveAttribute("inert", "");
  await page.keyboard.press("Enter"); await expect(reference).not.toHaveAttribute("inert", "");
});

test("opening Reference preserves writing focus, text selection and editor instance", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByRole("button", { name: "Writing", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Note content", exact: true }); const element = await editor.elementHandle();
  await editor.evaluate((e) => { e.focus(); const range = document.createRange(); range.setStart(e.firstChild!.firstChild!, 9); range.setEnd(e.firstChild!.firstChild!, 13); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(range); });
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(editor).toBeFocused(); expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("this");
  expect(await element!.evaluate((e) => e.isConnected)).toBe(true);
  await page.keyboard.type("that"); await expect(editor).toContainText("Preserve that selection");
});

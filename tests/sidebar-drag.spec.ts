import { chooseTheme } from './themeHelper';
import { test, expect, type Page } from "@playwright/test";
import { applySidebarDrop } from "../src/sidebarOrder";
import type { Workspace } from "../src/types";

const stamp = "2026-10-02T00:00:00.000Z";
const fixture: Workspace = {
  theme: "light", activeId: "a1", referenceId: "b1",
  folders: [
    { id: "work", name: "Work logs" },
    { id: "data", name: "Data integration" },
    { id: "empty", name: "Empty folder" },
    { id: "closed", name: "Closed folder" },
  ],
  notes: [
    { id: "a1", folderId: "work", title: "First note", content: "<p>Keep this draft 日本語 ✓</p>", archived: false, createdAt: stamp, updatedAt: stamp },
    { id: "a2", folderId: "work", title: "Second note", content: "<p>Second</p>", archived: false, createdAt: stamp, updatedAt: stamp },
    { id: "a3", folderId: "work", title: "Third note", content: "<p>Third</p>", archived: false, createdAt: stamp, updatedAt: stamp },
    { id: "b1", folderId: "data", title: "Other note", content: "<p>Reference stays intact</p>", archived: false, createdAt: stamp, updatedAt: stamp },
    { id: "u1", folderId: null, title: "Loose note", content: "<p>Loose</p>", archived: false, createdAt: stamp, updatedAt: stamp },
    { id: "archived", folderId: "work", title: "Archived note", content: "<p>Archived</p>", archived: true, createdAt: stamp, updatedAt: stamp },
  ],
};

const control = (page: Page, kind: "folder" | "note", id: string) =>
  page.locator(`[data-sidebar-item="${kind}:${id}"]`);
async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document as Workspace);
}
async function drag(page: Page, kind: "folder" | "note", id: string, target: string, after = true) {
  const source = control(page, kind, id);
  const destination = page.locator(target);
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  const x = start!.x + 30;
  const y = start!.y + start!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Start native dragging before scrolling a distant destination. dragTo can
  // scroll after pointer-down and start the drag on a different row.
  await page.mouse.move(x, y + 12, { steps: 3 });
  await destination.scrollIntoViewIfNeeded();
  const rect = await destination.boundingBox();
  const targetX = rect!.x + 30;
  const targetY = rect!.y + (after ? rect!.height - 4 : 4);
  await page.mouse.move(targetX, targetY, { steps: 5 });
  // Native dragenter precedes dragover; send both at the hit-tested position.
  await page.mouse.move(targetX, targetY);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("still-notes-browser-v1"))
      localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, fixture);
  await page.goto("/");
  await expect(control(page, "note", "a1")).toBeVisible();
});

test("folder drag reorders the whole group and persists after reload", async ({ page }) => {
  await drag(page, "folder", "data", '.folder-group:has([data-sidebar-item="folder:work"])', false);
  await expect(page.locator(".folder-toggle")).toHaveText(["Data integration", "Work logs", "Empty folder", "Closed folder"]);
  await expect.poll(async () => (await saved(page)).folders.map((f) => f.id)).toEqual(["data", "work", "empty", "closed"]);
  await page.reload();
  await expect(page.locator(".folder-toggle")).toHaveText(["Data integration", "Work logs", "Empty folder", "Closed folder"]);
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Keep this draft 日本語 ✓");
});

test("notes reorder in both directions without changing content or identity", async ({ page }) => {
  await drag(page, "note", "a1", '.note-row:has([data-sidebar-item="note:a3"])');
  const notes = page.locator('.folder-group:has([data-sidebar-item="folder:work"]) .note-name');
  await expect(notes).toHaveText(["Second note", "Third note", "First note"]);
  await drag(page, "note", "a1", '.note-row:has([data-sidebar-item="note:a2"])', false);
  await expect(notes).toHaveText(["First note", "Second note", "Third note"]);
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.id === "a1")).toEqual(fixture.notes[0]);
});

test("drop between notes transfers into another folder at that position", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.fill("Live unsaved draft ✓");
  await drag(page, "note", "a1", '.note-row:has([data-sidebar-item="note:b1"])', false);
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:data"]) .note-name')).toHaveText(["First note", "Other note"]);
  await expect(editor).toContainText("Live unsaved draft ✓");
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.id === "a1")?.folderId).toBe("data");
  const document = await saved(page);
  expect(document.activeId).toBe("a1");
  expect(document.referenceId).toBe("b1");
  expect(document.notes).toHaveLength(fixture.notes.length);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Live unsaved draft ✓");
});

test("closed and empty folders accept notes and open after dropping", async ({ page }) => {
  await drag(page, "note", "a2", '.folder-row:has([data-sidebar-item="folder:closed"])');
  await expect(control(page, "folder", "closed")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:closed"]) .note-name')).toHaveText(["Second note"]);
  await control(page, "folder", "empty").click();
  await drag(page, "note", "a3", '.folder-group:has([data-sidebar-item="folder:empty"]) .empty-folder');
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:empty"]) .note-name')).toHaveText(["Third note"]);
});

test("notes can move into Unfiled and back into a folder", async ({ page }) => {
  await drag(page, "note", "a2", '.sidebar-bottom > button:first-child');
  await expect(page.locator(".loose-notes .note-name")).toHaveText(["Loose note", "Second note"]);
  await drag(page, "note", "a2", '.folder-row:has([data-sidebar-item="folder:data"])');
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:data"]) .note-name')).toHaveText(["Other note", "Second note"]);
});

test("Escape and dropping outside leave the workspace unchanged", async ({ page }) => {
  const start = await control(page, "note", "a1").boundingBox();
  const end = await control(page, "folder", "data").boundingBox();
  const x = start!.x + start!.width / 2;
  const y = start!.y + start!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 15, { steps: 3 });
  const endX = end!.x + end!.width / 2;
  const endY = end!.y + end!.height / 2;
  await page.mouse.move(endX, endY, { steps: 8 });
  // Native dragenter precedes dragover; repeat at the same target to send both.
  await page.mouse.move(endX, endY);
  await page.mouse.move(endX, endY);
  await expect(page.locator(".drop-folder")).toHaveCount(1);
  await page.locator(".sidebar").screenshot({ path: test.info().outputPath("sidebar-drop-light.png") });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".dragging, .drop-folder, .drop-before, .drop-after")).toHaveCount(0);
  await control(page, "note", "a1").dragTo(page.locator(".document-head"));
  expect(await saved(page)).toEqual(fixture);
});

test("keyboard reordering and transfers restore focus", async ({ page }) => {
  await control(page, "folder", "data").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator(".folder-toggle").first()).toHaveText("Data integration");
  await control(page, "note", "a2").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:work"]) .note-name')).toHaveText(["Second note", "First note", "Third note"]);
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(control(page, "note", "a2")).toBeFocused();
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:empty"]) .note-name')).toHaveText(["Second note"]);
});

test("search-result drags transfer without losing hidden notes", async ({ page }) => {
  await page.getByRole("textbox", { name: "Search notes" }).fill("note");
  await drag(page, "note", "a1", '.note-row:has([data-sidebar-item="note:b1"])');
  await expect(page.getByRole("textbox", { name: "Search notes" })).toHaveValue("");
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.id === "a1")?.folderId).toBe("data");
  expect((await saved(page)).notes).toHaveLength(6);
});

test("dark theme and reduced motion support the same drag outcomes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await chooseTheme(page, "dark");
  await drag(page, "note", "a2", '.folder-row:has([data-sidebar-item="folder:data"])');
  await expect(page.locator('.folder-group:has([data-sidebar-item="folder:data"]) .note-name')).toHaveText(["Other note", "Second note"]);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".sidebar").screenshot({ path: test.info().outputPath("sidebar-dark.png") });
});

test("dragging scrolls a long sidebar at the edge and cancellation stops it", async ({ page }) => {
  const document = {
    ...fixture,
    folders: [...fixture.folders, ...Array.from({ length: 35 }, (_, i) => ({ id: `extra-${i}`, name: `Extra folder ${i}` }))],
  };
  await page.evaluate((document) => {
    localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, document);
  await page.reload();
  const source = await control(page, "folder", "work").boundingBox();
  const bounds = await page.locator(".sidebar-scroll").boundingBox();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height - 8;
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x, y);
  await page.mouse.move(x, y);
  await expect.poll(() => page.locator(".sidebar-scroll").evaluate((el) => el.scrollTop)).toBeGreaterThan(60);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".dragging, .drop-before, .drop-after")).toHaveCount(0);
  expect((await saved(page)).folders).toEqual(document.folders);
});

test("archived notes cannot be dragged", async ({ page }) => {
  await page.locator(".sidebar-bottom").getByRole("button", { name: /Archive/ }).click();
  await expect(control(page, "note", "archived")).toHaveAttribute("draggable", "false");
});

test("invalid targets and self drops cannot lose or duplicate data", () => {
  expect(applySidebarDrop(fixture, { kind: "note", id: "a1" }, { kind: "note-order", id: "a1", after: true })).toBe(fixture);
  expect(applySidebarDrop(fixture, { kind: "note", id: "a1" }, { kind: "folder", id: "missing" })).toBe(fixture);
  expect(applySidebarDrop(fixture, { kind: "folder", id: "work" }, { kind: "folder-order", id: "missing", after: false })).toBe(fixture);
  expect(applySidebarDrop(fixture, { kind: "note", id: "archived" }, { kind: "folder", id: "data" })).toBe(fixture);
  expect(applySidebarDrop(fixture, { kind: "note", id: "a1" }, { kind: "note-order", id: "archived", after: false })).toBe(fixture);
});

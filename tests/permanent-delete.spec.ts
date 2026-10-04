import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const stamp = "2026-10-02T00:00:00.000Z";
const note = (id: string, title: string, folderId: string | null, archived = false) => ({
  id, title, folderId, archived, content: `<p>${title} content</p>`,
  createdAt: stamp, updatedAt: stamp,
});
const fixture: Workspace = {
  theme: "light", activeId: "first", referenceId: "first",
  folders: [{ id: "work", name: "Work" }, { id: "data", name: "Other folder" }],
  notes: [note("first", "First note", "work"), note("other", "Other note", "data"),
    note("second", "Second note", "work"), note("loose", "Loose note", null),
    note("old", "Archived note", "work", true)],
};
async function open(page: Page, workspace = fixture) {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("still-notes-browser-v1"))
      localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, workspace);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible({ timeout: 15_000 });
}
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
}
async function requestDelete(page: Page, title: string) {
  await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(`“${title}” will be permanently removed.`);
}
async function confirm(page: Page, id: string) {
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).notes.some((n) => n.id === id)).toBe(false);
}
const title = (page: Page) => page.getByRole("textbox", { name: "Note title", exact: true });
const archive = (page: Page) => page.locator(".sidebar-bottom button").filter({ hasText: /^Archive/ });

test("each live note has delete last in its menu; Cancel and Escape preserve all notes", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Actions for Second note", exact: true }).click();
  await expect(page.locator(".sidebar-note-dropdown button")).toHaveText([
    "Archive note", "Show as reference", "Delete permanently",
  ]);
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("“Second note”");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Delete permanently" })).not.toBeFocused();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await requestDelete(page, "First note");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(title(page)).toHaveValue("First note");
  await page.reload();
  expect((await saved(page)).notes).toEqual(fixture.notes);
});

test("deleting the open live note selects its folder sibling, clears Reference, and persists", async ({ page }) => {
  await open(page);
  await requestDelete(page, "First note");
  await confirm(page, "first");
  await expect(title(page)).toHaveValue("Second note");
  await expect(archive(page)).not.toHaveClass(/nav-active/);
  const document = await saved(page);
  expect(document.referenceId).toBeNull();
  expect(document.activeId).toBe("second");
  expect(document.notes).toEqual(fixture.notes.filter((n) => n.id !== "first"));
  await page.reload();
  await expect(title(page)).toHaveValue("Second note");
  await expect(page.getByRole("button", { name: "Actions for First note", exact: true })).toHaveCount(0);
});

test("deleting another note preserves the live editor, unsaved draft, query, and Reference", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.evaluate((el) => { (window as any).originalEditor = el; });
  await editor.fill("Draft just written");
  await page.getByRole("textbox", { name: "Search notes" }).fill("note");
  await requestDelete(page, "Second note");
  await confirm(page, "second");
  await expect(title(page)).toHaveValue("First note");
  await expect(editor).toHaveText("Draft just written");
  expect(await editor.evaluate((el) => el === (window as any).originalEditor)).toBe(true);
  await expect(page.getByRole("textbox", { name: "Search notes" })).toHaveValue("note");
  expect((await saved(page)).referenceId).toBe("first");
  await page.reload();
  await expect(editor).toHaveText("Draft just written");
});

test("the editor note-options menu can directly delete an unarchived note", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Note options", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await confirm(page, "first");
  await expect(title(page)).toHaveValue("Second note");
});

test("deleting the only search result keeps the query without opening a hidden note", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search notes" }).fill("First note");
  await requestDelete(page, "First note");
  await confirm(page, "first");
  await expect(page.getByRole("textbox", { name: "Search notes" })).toHaveValue("First note");
  await expect(title(page)).toHaveCount(0);
  expect((await saved(page)).activeId).toBe("");
});

test("deleting the last Unfiled note keeps the Unfiled view and clears the editor", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Unfiled notes/ }).click();
  await requestDelete(page, "Loose note");
  await confirm(page, "loose");
  await expect(page.getByRole("button", { name: /^Unfiled notes/ })).toHaveClass(/nav-active/);
  await expect(title(page)).toHaveCount(0);
  expect((await saved(page)).activeId).toBe("");
});

test("archived notes retain permanent deletion without selecting live notes afterward", async ({ page }) => {
  await open(page);
  await archive(page).click();
  await expect(title(page)).toHaveValue("Archived note");
  await page.getByRole("button", { name: "Actions for Archived note", exact: true }).click();
  await page.locator(".sidebar-note-dropdown").getByRole("button", { name: "Delete permanently" }).click();
  await confirm(page, "old");
  await expect(archive(page)).toHaveClass(/nav-active/);
  await expect(title(page)).toHaveCount(0);
  expect((await saved(page)).notes).toEqual(fixture.notes.filter((n) => n.id !== "old"));
});

test("right-click menu and confirmation remain usable in dark mode at minimum width with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { ...fixture, theme: "dark" });
  await page.locator(".note-select").filter({ hasText: "First note" }).click({ button: "right" });
  await expect(page.locator(".sidebar-note-dropdown").getByRole("button", { name: "Delete permanently" })).toBeVisible();
  // Visibility alone does not catch clipping by the sidebar's scrolling area.
  const deleteButton = page.locator(".sidebar-note-dropdown").getByRole("button", { name: "Delete permanently" });
  expect(await deleteButton.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await page.screenshot({ path: "release/preview-note-delete-menu.png" });
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await page.screenshot({ path: "release/preview-note-delete-confirmation.png" });
  await confirm(page, "first");
  await expect(title(page)).toHaveValue("Second note");
});

import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const stamp = "2026-10-02T00:00:00.000Z";
const note = (id: string, title: string, folderId: string | null) => ({
  id, title, folderId, content: `<p>${title} content</p>`,
  archived: false, createdAt: stamp, updatedAt: stamp,
});
const fixture: Workspace = {
  theme: "light", activeId: "first", referenceId: "other",
  folders: [{ id: "work", name: "Work" }, { id: "data", name: "Other folder" }],
  notes: [note("first", "First note", "work"), note("second", "Second note", "work"),
    note("other", "Other note", "data"), note("loose", "Loose note", null)],
};
async function open(page: Page, workspace = fixture) {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("still-notes-browser-v1"))
      localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, workspace);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
}
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
}
const archiveNav = (page: Page) => page.locator(".sidebar-bottom button").filter({ hasText: /^Archive/ });

test("archiving the open note keeps the notes view and selects another note in its folder", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Note options", exact: true }).click();
  await page.getByRole("button", { name: "Archive note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Second note");
  await expect(archiveNav(page)).not.toHaveClass(/nav-active/);
  await expect(page.locator(".archive-banner")).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.id === "first")?.archived).toBe(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Second note");
  await expect(archiveNav(page)).not.toHaveClass(/nav-active/);
  await archiveNav(page).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("First note");
  await page.locator(".archive-banner").getByRole("button", { name: "Restore note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("First note");
  await expect(page.locator(".archive-banner")).toHaveCount(0);
});

test("archiving another note preserves the open document and search", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search notes" }).fill("note");
  await page.getByRole("button", { name: "Actions for Second note", exact: true }).click();
  await page.getByRole("button", { name: "Archive note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("First note");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toHaveText("First note content");
  await expect(page.getByRole("textbox", { name: "Search notes" })).toHaveValue("note");
  await expect(archiveNav(page)).not.toHaveClass(/nav-active/);
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.id === "second")?.archived).toBe(true);
  expect((await saved(page)).activeId).toBe("first");
});

test("archiving the last unfiled note keeps Unfiled open and clears the editor", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Unfiled notes/ }).click();
  await page.getByRole("button", { name: "Note options", exact: true }).click();
  await page.getByRole("button", { name: "Archive note", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Unfiled notes/ })).toHaveClass(/nav-active/);
  await expect(archiveNav(page)).not.toHaveClass(/nav-active/);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).activeId).toBe("");
  expect((await saved(page)).notes.find((n) => n.id === "loose")?.archived).toBe(true);
});

test("archiving the only search result preserves the query without opening a hidden note", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search notes" }).fill("First note");
  await page.getByRole("button", { name: "Actions for First note", exact: true }).click();
  await page.getByRole("button", { name: "Archive note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search notes" })).toHaveValue("First note");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveCount(0);
  await expect(archiveNav(page)).not.toHaveClass(/nav-active/);
  await expect.poll(async () => (await saved(page)).activeId).toBe("");
});

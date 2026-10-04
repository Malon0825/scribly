import { test, expect, type Page } from "@playwright/test";
import { newNoteContent } from "../src/newNoteContent";
import { mergeBackup } from "../src/importBackup";
import type { Note, Workspace } from "../src/types";

const rich = '<h2>Daily checklist</h2><p><strong>Keep the formatting</strong> 日本語 ✓</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Completed task</p></li><li data-type="taskItem" data-checked="false"><p>Next task</p></li></ul>';
const note = (id: string, day: number, content: string, archived = false): Note => ({
  id, folderId: "work", title: id, content, archived,
  createdAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`,
  updatedAt: "2026-10-10T00:00:00Z",
});
const fixture: Workspace = {
  theme: "light", activeId: "latest", referenceId: null,
  folders: [{ id: "work", name: "Work logs" }, { id: "data", name: "Data integration" }],
  // Newest visible note comes first: dragging/order must not select the source.
  notes: [note("latest", 2, rich), note("older", 1, "<p>Older content</p>"), note("archived", 3, "<p>Archived content</p>", true)],
};
const enabled: Workspace = { ...fixture, folders: fixture.folders.map((f) => ({ ...f, copyLastNote: f.id === "work" })) };

test("copy is opt-in per folder, and selects creation time rather than sidebar order", () => {
  expect(newNoteContent(fixture, "work")).toBe("<p></p>");
  expect(newNoteContent(enabled, "work")).toBe(rich);
  expect(newNoteContent(enabled, "data")).toBe("<p></p>");
  expect(newNoteContent(enabled, null)).toBe("<p></p>");
  expect(newNoteContent({ ...enabled, notes: [...enabled.notes].reverse() }, "work")).toBe(rich);
});

test("empty folders and folders with only archived notes start blank", () => {
  expect(newNoteContent({ ...enabled, notes: [] }, "work")).toBe("<p></p>");
  expect(newNoteContent({ ...enabled, notes: enabled.notes.filter((n) => n.archived) }, "work")).toBe("<p></p>");
});

test("newly imported folders keep their option without overwriting existing preferences", () => {
  const fresh = mergeBackup({ ...fixture, folders: [], notes: [] }, enabled);
  expect(fresh.folders.find((f) => f.name === "Work logs")?.copyLastNote).toBe(true);
  const existing = mergeBackup(fixture, enabled);
  expect(existing.folders.find((f) => f.id === "work")?.copyLastNote).toBeUndefined();
});

async function saved(page: Page): Promise<Workspace> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
}
async function option(page: Page, name = "Work logs") {
  await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
  return page.getByRole("button", { name: "Copy last note", exact: true });
}

test.describe("folder copy UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-02T09:00:00Z"));
    await page.addInitScript((document) => {
      if (!localStorage.getItem("still-notes-browser-v1"))
        localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
    }, fixture);
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("latest");
  });

  test("off by default; enabling copies rich text and checklist states into an independent note", async ({ page }) => {
    const toggle = await option(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await page.getByRole("button", { name: "New note in Work logs", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 2, 2026");
    const editor = page.getByRole("textbox", { name: "Note content", exact: true });
    await expect(editor.locator("h2")).toHaveText("Daily checklist");
    await expect(editor.locator("strong")).toHaveText("Keep the formatting");
    await expect(editor.locator('input[type="checkbox"]').nth(0)).toBeChecked();
    await expect(editor.locator('input[type="checkbox"]').nth(1)).not.toBeChecked();
    await editor.fill("Changed only the new note");
    await expect.poll(async () => {
      const document = await saved(page);
      return document.notes.find((n) => n.id === document.activeId)?.content;
    }).toContain("Changed only the new note");
    const document = await saved(page);
    expect(document.notes.find((n) => n.id === "latest")?.content).toBe(rich);
    expect(document.notes.find((n) => n.id === document.activeId)?.content).toContain("Changed only the new note");
    const on = await option(page);
    await expect(on).toHaveAttribute("aria-pressed", "true");
    await page.locator(".sidebar").screenshot({ path: test.info().outputPath("copy-option-light.png") });
  });

  test("the setting survives reload; New note and Ctrl+N copy live edits; disabling starts blank", async ({ page }) => {
    await (await option(page)).click();
    await expect.poll(async () => (await saved(page)).folders[0].copyLastNote).toBe(true);
    await page.reload();
    const toggle = await option(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    const editor = page.getByRole("textbox", { name: "Note content", exact: true });
    await editor.fill("Latest unsaved edit ✓");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(editor).toHaveText("Latest unsaved edit ✓");
    await editor.fill("Next live draft");
    await page.keyboard.press("Control+n");
    await expect(editor).toHaveText("Next live draft");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 2, 2026 · Anubis");
    await (await option(page)).click();
    await page.keyboard.press("Control+n");
    await expect(editor).toHaveText("");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 2, 2026 · Baldur");
  });

  test("default off and other folders still create blank notes", async ({ page }) => {
    await page.getByRole("button", { name: "New note in Work logs", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toHaveText("");
    await (await option(page)).click();
    await page.getByRole("button", { name: "New note in Data integration", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toHaveText("");
    await (await option(page, "Data integration")).click();
    await page.getByRole("button", { name: "New note in Data integration", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toHaveText("");
  });

  test("explicit duplicate and weekly update content bypass the folder default", async ({ page }) => {
    await (await option(page)).click();
    await page.locator('[data-sidebar-item="note:older"]').click();
    await page.getByRole("button", { name: "Note options", exact: true }).click();
    await page.getByRole("button", { name: "Duplicate note", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toHaveText("Older content");
    await page.locator('[data-sidebar-item="note:latest"]').click();
    await page.getByRole("button", { name: "Add to weekly update", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Weekly update");
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Completed task");
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).not.toContainText("Next task");
  });

  test("the option is keyboard operable and fits the dark narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 700 });
    await page.getByRole("button", { name: "Use dark mode" }).click();
    const toggle = await option(page);
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator(".folder-dropdown")).toHaveCount(0);
    await expect.poll(async () => (await saved(page)).folders.find(f => f.id === "work")?.copyLastNote).toBe(true);
    const enabled = await option(page);
    await expect(enabled).toHaveAttribute("aria-pressed", "true");
    const menu = await page.locator(".folder-dropdown").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(10);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 10);
    await page.locator(".sidebar").screenshot({ path: test.info().outputPath("copy-option-dark.png") });
  });

  test("backup import retains the folder option, and malformed values are rejected", async ({ page }) => {
    const backup = {
      folders: [{ id: "imported", name: "Imported folder", copyLastNote: true }],
      notes: [{ ...fixture.notes[0], folderId: "imported" }],
    };
    await page.getByLabel("Import files", { exact: true }).setInputFiles({
      name: "copy-folder.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(page.getByRole("button", { name: "New note in Imported folder", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New note in Imported folder", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note content", exact: true }).locator("h2")).toHaveText("Daily checklist");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Imported folder · Oct 2, 2026");
    await expect.poll(async () => (await saved(page)).folders.find((f) => f.name === "Imported folder")?.copyLastNote).toBe(true);
    await page.getByLabel("Import files", { exact: true }).setInputFiles({
      name: "invalid.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ folders: [{ ...backup.folders[0], copyLastNote: "true" }], notes: [] })),
    });
    await expect(page.getByRole("dialog", { name: "Import results" })).toContainText("invalid.json: Invalid folder in backup");
  });
});

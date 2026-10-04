import { test, expect, type Page } from "@playwright/test";
import { defaultNoteTitle, noteTitleFact, mythologyNames } from "../src/noteNaming";
import { mergeBackup } from "../src/importBackup";
import type { Note, Workspace } from "../src/types";

test.use({ timezoneId: "Asia/Singapore" });
const now = new Date(2026, 9, 2, 0, 5);
const stamp = "2026-10-01T00:00:00.000Z";
const fixture: Workspace = {
  theme: "light", activeId: "old", referenceId: null,
  folders: [{ id: "work", name: "Work logs" }, { id: "data", name: "Data integration" }],
  notes: [
    { id: "old", folderId: "work", title: "Existing handwritten title", content: "<p>Existing content</p>", createdAt: stamp, updatedAt: stamp, archived: false },
    { id: "loose", folderId: null, title: "Loose note", content: "<p></p>", createdAt: stamp, updatedAt: stamp, archived: false },
  ],
};

function addDefault(workspace: Workspace, folderId: string | null = "work", date = now) {
  const note: Note = {
    id: `generated-${workspace.notes.length}`, folderId,
    ...defaultNoteTitle(workspace, folderId, date),
    content: "<p></p>", createdAt: date.toISOString(), updatedAt: date.toISOString(), archived: false,
  };
  return { workspace: { ...workspace, notes: [...workspace.notes, note] }, note };
}

async function saved(page: Page): Promise<Workspace> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
}

test("the sequence covers A-Z, then continues with numbered cycles", () => {
  let workspace = fixture;
  const titles: string[] = [];
  for (let i = 0; i < 29; i++) {
    const result = addDefault(workspace);
    workspace = result.workspace;
    titles.push(result.note.title);
  }
  expect(titles[0]).toBe("Work logs · Oct 2, 2026");
  expect(titles.slice(1, 27)).toEqual(mythologyNames.map((m) => `Work logs · Oct 2, 2026 · ${m.name}`));
  expect(titles.slice(27)).toEqual(["Work logs · Oct 2, 2026 · Anubis 2", "Work logs · Oct 2, 2026 · Baldur 2"]);
  expect(new Set(titles).size).toBe(29);
});

test("renaming, archiving, moving, and deleting an earlier note keep reserved positions", () => {
  let workspace = addDefault(fixture).workspace;
  const { note, workspace: second } = addDefault(workspace);
  workspace = { ...second, notes: second.notes.filter((n) => n.autoTitle?.ordinal !== 0).map((n) => n.id === note.id
    ? { ...n, title: "Custom title", archived: true, folderId: "data" } : n) };
  expect(addDefault(workspace).note.title).toBe("Work logs · Oct 2, 2026 · Baldur");
  expect(noteTitleFact(workspace.notes.find((n) => n.id === note.id))).toBeNull();
});

test("folder and day sequences are independent, including Unfiled notes", () => {
  const workspace = addDefault(addDefault(fixture).workspace).workspace;
  expect(addDefault(workspace, "data").note.title).toBe("Data integration · Oct 2, 2026");
  expect(addDefault(workspace, null).note.title).toBe("Unfiled notes · Oct 2, 2026");
  expect(addDefault(workspace, "work", new Date(2026, 9, 3)).note.title).toBe("Work logs · Oct 3, 2026");
});

test("backup merging remaps naming scope and preserves the next name", () => {
  const original = addDefault(addDefault(fixture).workspace).workspace;
  const merged = mergeBackup({ ...fixture, folders: [{ id: "new-work", name: "Work logs" }] }, original);
  expect(defaultNoteTitle(merged, "new-work", now).title).toBe("Work logs · Oct 2, 2026 · Baldur");
  const anubis = merged.notes.find((n) => n.title.endsWith(" · Anubis"))!;
  expect(noteTitleFact(anubis)).toBe("Egyptian god of the underworld.");
});

test("matching existing titles do not collide with generated names", () => {
  const workspace = { ...fixture, notes: [
    { ...fixture.notes[0], title: "Work logs · Oct 2, 2026" },
    { ...fixture.notes[0], id: "legacy-anubis", title: "Work logs · Oct 2, 2026 · Anubis" },
  ] };
  expect(defaultNoteTitle(workspace, "work", now).title).toBe("Work logs · Oct 2, 2026 · Baldur");
});

test.describe("new-note UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-01T16:05:00Z"));
    await page.addInitScript((document) => {
      if (!localStorage.getItem("still-notes-browser-v1"))
        localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
    }, fixture);
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Existing handwritten title");
  });

  test("first note uses the local date; repeated notes gain names and subtle facts", async ({ page }) => {
    const title = page.getByRole("textbox", { name: "Note title" });
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(title).toHaveValue("Work logs · Oct 2, 2026");
    await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeFocused();
    await expect(page.locator(".note-title-fact")).toHaveCount(0);
    await page.keyboard.press("Control+n");
    await expect(title).toHaveValue("Work logs · Oct 2, 2026 · Anubis");
    await expect(page.locator(".note-title-fact")).toHaveText("– Egyptian god of the underworld.");
    await page.keyboard.press("Control+n");
    await expect(title).toHaveValue("Work logs · Oct 2, 2026 · Baldur");
    await expect(page.locator(".note-title-fact")).toHaveText("– Norse god of light.");
    await expect.poll(async () => (await saved(page)).notes.length).toBe(5);
    await page.screenshot({ path: test.info().outputPath("default-titles-light.png") });
    await page.reload();
    await expect(title).toHaveValue("Work logs · Oct 2, 2026 · Baldur");
    await expect(page.locator(".note-title-fact")).toHaveText("– Norse god of light.");
    await page.keyboard.press("Control+n");
    await expect(title).toHaveValue("Work logs · Oct 2, 2026 · Cupid");
  });

  test("folder plus buttons and Unfiled use separate sequences", async ({ page }) => {
    await page.getByRole("button", { name: "New note in Data integration", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Data integration · Oct 2, 2026");
    await page.getByRole("button", { name: "New note in Work logs", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 2, 2026");
    await page.locator(".sidebar-bottom").getByRole("button", { name: /Unfiled notes/ }).click();
    await page.keyboard.press("Control+n");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Unfiled notes · Oct 2, 2026");
  });

  test("new boards share note naming across buttons, folders, shortcuts and reload", async ({ page }) => {
    const boardTitle = page.getByRole("textbox", { name: "Board title" });
    await page.getByRole("button", { name: "New board", exact: true }).click();
    await expect(boardTitle).toHaveValue("Work logs · Oct 2, 2026");
    await expect.poll(async () => (await saved(page)).notes.find((n) => n.kind === "board")?.autoTitle)
      .toEqual({ folderId: "work", day: "2026-10-02", ordinal: 0 });
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 2, 2026 · Anubis");
    await page.getByRole("button", { name: "Options for Work logs", exact: true }).click();
    await page.getByRole("dialog", { name: "Folder options" }).getByRole("button", { name: "New board", exact: true }).click();
    await expect(boardTitle).toHaveValue("Work logs · Oct 2, 2026 · Baldur");
    await expect(page.locator(".note-title-fact")).toHaveText("– Norse god of light.");
    await boardTitle.fill("Custom board");
    await expect(page.locator(".note-title-fact")).toHaveCount(0);
    await expect.poll(async () => (await saved(page)).notes.at(-1)?.title).toBe("Custom board");
    await page.reload();
    await expect(boardTitle).toHaveValue("Custom board");
    await page.keyboard.press("Control+Shift+n");
    await expect(boardTitle).toHaveValue("Work logs · Oct 2, 2026 · Cupid");
    await page.getByRole("button", { name: "Options for Data integration", exact: true }).click();
    await page.getByRole("dialog", { name: "Folder options" }).getByRole("button", { name: "New board", exact: true }).click();
    await expect(boardTitle).toHaveValue("Data integration · Oct 2, 2026");
    await page.locator(".sidebar-bottom").getByRole("button", { name: /Unfiled notes/ }).click();
    await page.keyboard.press("Control+Shift+n");
    await expect(boardTitle).toHaveValue("Unfiled notes · Oct 2, 2026");
    await page.clock.setFixedTime(new Date("2026-10-02T16:05:00Z"));
    await page.keyboard.press("Control+Shift+n");
    await expect(boardTitle).toHaveValue("Unfiled notes · Oct 3, 2026");
  });

  test("custom renaming keeps its sequence reservation and hides the unrelated fact", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await page.keyboard.press("Control+n");
    await page.getByRole("textbox", { name: "Note title" }).fill("My own title");
    await expect(page.locator(".note-title-fact")).toHaveCount(0);
    await page.keyboard.press("Control+n");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 2, 2026 · Baldur");
    await expect(page.locator(".note-name", { hasText: "My own title" })).toBeVisible();
  });

  test("the next local day restarts with the base title", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await page.keyboard.press("Control+n");
    await page.clock.setFixedTime(new Date("2026-10-02T16:05:00Z"));
    await page.keyboard.press("Control+n");
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Work logs · Oct 3, 2026");
    await expect(page.locator(".note-title-fact")).toHaveCount(0);
  });

  test("explicit duplicate titles retain their existing behavior", async ({ page }) => {
    await page.getByRole("button", { name: "Note options", exact: true }).click();
    await page.getByRole("button", { name: "Duplicate note", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Existing handwritten title (copy)");
    await expect(page.locator(".note-title-fact")).toHaveCount(0);
  });

  test("long titles wrap without clipping at narrow widths and in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 700 });
    await page.getByRole("button", { name: "Reference", exact: true }).click();
    await page.keyboard.press("Control+n");
    await page.keyboard.press("Control+n");
    const title = page.getByRole("textbox", { name: "Note title" });
    await title.fill("Daily Task Logs and Monitoring · Oct 2, 2026 · Quetzalcoatl");
    await expect.poll(() => title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await title.evaluate((el) => el.clientHeight)).toBeGreaterThan(50);
    // Return to the assigned name to inspect its fact in the dark theme.
    await title.fill("Work logs · Oct 2, 2026 · Anubis");
    await page.getByRole("button", { name: "Use dark mode" }).click();
    await expect(page.locator(".note-title-fact")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("default-titles-dark-narrow.png") });
    await page.setViewportSize({ width: 1440, height: 920 });
    await expect.poll(() => title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  });
});

import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

test.setTimeout(90_000);
const key = "still-notes-browser-v1";
const time = "2026-10-04T00:00:00.000Z";
const fixture: Workspace = {
  schemaVersion: 5, theme: "light", activeId: "main", referenceId: "reference",
  folders: [{ id: "work", name: "Work" }],
  notes: [
    { id: "main", folderId: "work", title: "Writing in progress", content: "<p>Original writing</p>", archived: false, createdAt: time, updatedAt: time },
    { id: "reference", folderId: "work", title: "Reference", content: "<p>Keep this reference</p>", archived: false, createdAt: time, updatedAt: time },
  ],
};
const capture = (page: Page) => page.getByRole("dialog", { name: "Quick capture", exact: true });
const mainTitle = (page: Page) => page.getByRole("textbox", { name: "Note title", exact: true }).first();
const mainEditor = (page: Page) => page.getByRole("textbox", { name: "Note content", exact: true });
const state = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document as Workspace, key);
async function seed(page: Page) {
  await page.addInitScript(({ key, document }) => {
    if (sessionStorage.getItem("quick-capture-seeded")) return;
    localStorage.setItem(key, JSON.stringify({ revision: 1, document, dataPath: "Quick capture test" }));
    sessionStorage.setItem("quick-capture-seeded", "1");
  }, { key, document: fixture });
  await page.goto("/");
  await expect(mainTitle(page)).toHaveValue("Writing in progress");
  await expect(page.getByText("Saved in browser", { exact: true })).toBeVisible();
}
async function openCapture(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  if (!await page.getByRole("button", { name: "Quick capture…", exact: true }).isVisible()) {
    await page.getByRole("tab", { name: "Startup", exact: true }).click();
  }
  await page.getByRole("button", { name: "Quick capture…", exact: true }).click();
  await expect(capture(page)).toBeVisible();
}
async function enterCapture(page: Page, title: string, text: string) {
  await capture(page).getByRole("textbox", { name: /^Note title/ }).fill(title);
  await capture(page).getByRole("textbox", { name: "Note text", exact: true }).fill(text);
}
async function blockNotebookWrites(page: Page) {
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as any).allowNotebookWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw Error("Quick capture test: disk write interrupted");
      return original.call(this, name, value);
    };
  }, key);
}
async function allowNotebookWrites(page: Page) {
  await page.evaluate(() => (window as any).allowNotebookWrites());
}

test("Save appends to Inbox while preserving newer unsaved writing, active note and Reference", async ({ page }) => {
  await seed(page);
  await blockNotebookWrites(page);
  await mainEditor(page).fill("Newer unsaved writing 日本語");
  await openCapture(page);
  await enterCapture(page, "Captured thought", "First line\nSecond line <keep literal>");
  await allowNotebookWrites(page);
  await capture(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(capture(page).getByRole("status")).toHaveText("Saved to Inbox.");
  await capture(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(mainTitle(page)).toHaveValue("Writing in progress");
  await expect(mainEditor(page)).toContainText("Newer unsaved writing 日本語");
  await expect.poll(async () => (await state(page)).notes.length).toBe(3);
  const document = await state(page), note = document.notes.find(note => note.title === "Captured thought")!;
  expect(document.folders.find(folder => folder.id === note.folderId)?.name).toBe("Inbox");
  expect(note.content).toContain("&lt;keep literal&gt;");
  expect(document.activeId).toBe("main");
  expect(document.referenceId).toBe("reference");
  expect(document.notes.find(note => note.id === "main")?.content).toContain("Newer unsaved writing 日本語");
  await page.reload();
  await expect(mainEditor(page)).toContainText("Newer unsaved writing 日本語");
});

test("Open in notebook persists the captured note before selecting it", async ({ page }) => {
  await seed(page); await openCapture(page);
  await enterCapture(page, "Open this capture", "A thought to expand");
  await capture(page).getByRole("button", { name: "Open in notebook", exact: true }).click();
  await expect(capture(page)).toHaveCount(0);
  await expect(mainTitle(page)).toHaveValue("Open this capture");
  await expect(mainEditor(page)).toContainText("A thought to expand");
  await expect.poll(async () => {
    const document = await state(page);
    return document.notes.find(note => note.id === document.activeId)?.title;
  }).toBe("Open this capture");
  await page.reload();
  await expect(mainTitle(page)).toHaveValue("Open this capture");
  expect((await state(page)).notes.filter(note => note.title === "Open this capture")).toHaveLength(1);
});

test("Escape and Close retain a draft across reopening and reload; Ctrl+Enter saves it", async ({ page }) => {
  await seed(page); await openCapture(page);
  await enterCapture(page, "Retained draft", "Unfinished capture 日本語");
  await page.keyboard.press("Escape");
  await expect(capture(page)).toHaveCount(0);
  await openCapture(page);
  await expect(capture(page).getByRole("textbox", { name: /^Note title/ })).toHaveValue("Retained draft");
  await capture(page).getByRole("button", { name: "Close", exact: true }).click();
  await page.reload(); await expect(mainTitle(page)).toBeVisible(); await openCapture(page);
  await expect(capture(page).getByRole("textbox", { name: "Note text", exact: true })).toHaveValue("Unfinished capture 日本語");
  expect((await state(page)).notes).toHaveLength(2);
  await capture(page).getByRole("textbox", { name: "Note text", exact: true }).focus();
  await page.keyboard.press("Control+Enter");
  await expect(capture(page).getByRole("status")).toHaveText("Saved to Inbox.");
  await expect.poll(async () => (await state(page)).notes.filter(note => note.title === "Retained draft").length).toBe(1);
});

test("a failed capture write retains its text and retries the same note without duplicates", async ({ page }) => {
  await seed(page); await openCapture(page);
  await enterCapture(page, "Retry once", "Do not lose or duplicate this thought");
  await blockNotebookWrites(page);
  await capture(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(capture(page)).toBeVisible();
  await expect(capture(page).getByRole("alert")).toBeVisible();
  await expect(capture(page).getByRole("textbox", { name: "Note text", exact: true })).toHaveValue("Do not lose or duplicate this thought");
  expect((await state(page)).notes.filter(note => note.title === "Retry once")).toHaveLength(0);
  await allowNotebookWrites(page);
  await capture(page).getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(capture(page).getByRole("status")).toHaveText("Saved to Inbox.");
  await expect.poll(async () => (await state(page)).notes.filter(note => note.title === "Retry once").length).toBe(1);
  const id = (await state(page)).notes.find(note => note.title === "Retry once")!.id;
  await page.reload(); await expect(mainTitle(page)).toBeVisible();
  await expect.poll(async () => (await state(page)).notes.filter(note => note.title === "Retry once").map(note => note.id)).toEqual([id]);
  await expect(mainTitle(page)).toHaveValue("Writing in progress");
});


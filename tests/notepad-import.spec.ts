import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";
import type { NotepadScan } from "../src/notepadImport";

const stamp = "2026-10-04T00:00:00.000Z";
const fixture: Workspace = { theme: "light", activeId: "draft", referenceId: "ref",
  folders: [{ id: "imports", name: "Notepad Imports", copyLastNote: true }, { id: "work", name: "Work" }],
  notes: [
    { id: "draft", title: "Original", folderId: "work", content: "<p>Keep this draft</p>", createdAt: stamp, updatedAt: stamp, archived: false },
    { id: "ref", title: "Reference", folderId: null, content: "<p>Keep this reference</p>", createdAt: stamp, updatedAt: stamp, archived: false },
  ] };
const scan: NotepadScan = { found: true, emptyTabs: 1, savedTabs: 2, skipped: ["One recovery tab could not be read. Scan again."], tabs: [
  { id: "one", title: "Daily tasks", text: "  First  line\r\n\r\n\t日本語 😀\r\n<script>literal</script>" },
  { id: "two", title: "Shopping", text: "Milk\nCoffee" },
] };
const saved = (page: Page): Promise<Workspace> => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
async function open(page: Page, document = fixture) {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, document);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Original");
}
async function mockRecovery(page: Page, result = scan, command = "scan_notepad_tabs") {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Native scan harness requires Vite module routing");
  // Exercise the real app merge/save/UI flow while mocking only Windows access.
  // Keep browser storage and ordinary window controls unchanged.
  await page.route("**/src/NotepadImportDialog.tsx*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const desktopImport = /import \{ desktop \} from "\/src\/storage\.ts(?:\?[^\"]*)?";/;
    expect(desktopImport.test(body)).toBe(true);
    await route.fulfill({ response, body: body.replace(desktopImport, "const desktop = true;") });
  });
  await page.addInitScript(({ result, command }) => {
    const w = window as any;
    w.notepadScan = result; w.scanCalls = 0; w.scanDelay = 0; w.scanError = "";
    w.scanArgs = []; w.pickerResult = result;
    w.__TAURI_INTERNALS__ = { invoke: async (requested: string, args: any) => {
      if (requested !== command) throw Error(`Unexpected native command ${requested}`);
      w.scanArgs.push(args);
      w.scanCalls++;
      await new Promise((resolve) => setTimeout(resolve, w.scanDelay));
      if (w.scanError) throw Error(w.scanError);
      return args?.chooseDirectory ? w.pickerResult : w.notepadScan;
    } };
  }, { result, command });
}
async function fromFolder(page: Page, name = "Notepad Imports") {
  await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Import from Windows Notepad…", exact: true }).click();
  return page.getByRole("dialog", { name: "Import from Windows Notepad", exact: true });
}

test("browser explains Windows access and offers file import without changing notes", async ({ page }) => {
  await open(page);
  const dialog = await fromFolder(page);
  await expect(dialog).toContainText("Direct import is available in the Scribly Windows app");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Import files…" }).click();
  await (await chooser).setFiles([{ name: "saved-tab.txt", mimeType: "text/plain", buffer: Buffer.from("Saved manually") }]);
  await expect.poll(async () => (await saved(page)).notes.length).toBe(3);
  expect((await saved(page)).notes.at(-1)?.folderId).toBe("imports");
});

test("imports all recoverable tabs to chosen folder, preserves whitespace and persists without duplicate copies", async ({ page }) => {
  await mockRecovery(page); await open(page);
  const dialog = await fromFolder(page);
  await expect(dialog.getByRole("button", { name: "Import 2 notes", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("combobox", { name: "Notepad import destination" })).toHaveText(/Notepad Imports/);
  await dialog.getByRole("button", { name: "Import 2 notes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
  const document = await saved(page);
  expect(document.notes.slice(0, 2)).toEqual(fixture.notes);
  expect(document.referenceId).toBe("ref");
  expect(document.notes.slice(2).map((note) => note.folderId)).toEqual(["imports", "imports"]);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Daily tasks");
  expect(await page.locator('.document-editor .note-content p').first().textContent()).toBe("  First  line");
  await expect(page.locator('.document-editor .note-content')).toContainText("日本語 😀");
  await expect(page.locator('.document-editor .note-content script')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Daily tasks");
  const repeated = await fromFolder(page);
  await expect(repeated.getByRole("checkbox", { name: "Import Daily tasks" })).toBeDisabled();
  await expect(repeated.getByRole("button", { name: "Import 0 notes" })).toBeDisabled();
  await repeated.getByRole("combobox", { name: "Notepad import destination" }).click();
  await page.getByRole("option", { name: "Work", exact: true }).click();
  await expect(repeated.getByRole("checkbox", { name: "Import Daily tasks" })).toBeEnabled();
  await repeated.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await saved(page)).notes.length).toBe(4);
  await expect(page.getByRole("button", { name: "Options for Notepad Imports", exact: true })).toBeFocused();
});

test("selection controls import a subset and Settings can create Notepad Imports", async ({ page }) => {
  await mockRecovery(page); await open(page, { ...fixture, folders: fixture.folders.filter((f) => f.id !== "imports") });
  await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button", { name: "Import from Windows Notepad…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import from Windows Notepad", exact: true });
  await expect(dialog.getByRole("combobox")).toHaveText(/Create Notepad Imports folder/);
  await dialog.getByRole("checkbox", { name: "Select all" }).uncheck();
  await expect(dialog.getByRole("button", { name: "Import 0 notes" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Import Shopping" }).check();
  await dialog.getByRole("button", { name: "Import 1 note", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes.length).toBe(3);
  const document = await saved(page);
  expect(document.folders.filter((f) => f.name === "Notepad Imports")).toHaveLength(1);
  expect(document.notes.at(-1)?.folderId).toBe(document.folders.at(-1)?.id);
  expect(document.notes.at(-1)?.title).toBe("Shopping");
});

test("archived matches are skipped while trashed copies can be imported again", async ({ page }) => {
  await mockRecovery(page);
  await open(page, { ...fixture, schemaVersion: 5, notes: [...fixture.notes,
    { id: "archived", title: "Old shopping", folderId: "imports", content: "<p>Milk</p><p>Coffee</p>", archived: true, createdAt: stamp, updatedAt: stamp },
    { id: "trashed", title: "Old tasks", folderId: "imports", content: "<p>  First  line</p><p></p><p>\t日本語 😀</p><p>&lt;script&gt;literal&lt;/script&gt;</p>", archived: false, deletedAt: stamp, createdAt: stamp, updatedAt: stamp },
  ] });
  const dialog = await fromFolder(page);
  await expect(dialog.getByRole("checkbox", { name: "Import Shopping" })).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: "Import Daily tasks" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Import 1 note", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes.length).toBe(5);
  expect((await saved(page)).notes.at(-1)?.deletedAt).toBeUndefined();
});

test("dismissal during scan never imports and retry reports fresh results", async ({ page }) => {
  await mockRecovery(page); await open(page);
  await page.evaluate(() => { (window as any).scanDelay = 300; });
  const dialog = await fromFolder(page);
  await expect(dialog).toContainText("Reading Notepad recovery data");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Options for Notepad Imports", exact: true })).toBeFocused();
  await page.evaluate(() => { (window as any).scanError = "Notepad recovery file is locked"; (window as any).scanDelay = 0; });
  const retry = await fromFolder(page);
  await expect(retry.getByRole("alert")).toContainText("locked");
  await page.evaluate(() => { (window as any).scanError = ""; (window as any).notepadScan = { ...((window as any).notepadScan), tabs: [] }; });
  await retry.getByRole("button", { name: "Scan again" }).click();
  await expect(retry).toContainText("No recoverable unsaved text found");
  expect((await saved(page)).notes).toEqual(fixture.notes);
});

test("save failure retains imported drafts, avoids a success toast and supports Retry", async ({ page }) => {
  await mockRecovery(page); await open(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) { if (key === "still-notes-browser-v1") throw Error("Disk full"); return original.call(this, key, value); };
  });
  const dialog = await fromFolder(page);
  await dialog.getByRole("button", { name: "Import 2 notes", exact: true }).click();
  await expect(page.locator(".storage-error")).toContainText("Disk full");
  await expect(page.locator(".toast")).toContainText("saving failed");
  expect((await saved(page)).notes.length).toBe(2);
  await page.evaluate(() => (window as any).restoreStorage());
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Daily tasks");
});

test("dialog fits narrow/dark/reduced-motion windows and uses keyboard selection", async ({ page }) => {
  await mockRecovery(page); await page.setViewportSize({ width: 560, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await open(page, { ...fixture, theme: "system" });
  const dialog = await fromFolder(page);
  await expect(dialog.getByRole("button", { name: "Import 2 notes" })).toBeEnabled();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(560);
  await dialog.getByRole("checkbox", { name: "Import Shopping" }).focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("button", { name: "Import 1 note", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

async function fromPlusFolder(page: Page, folder = "Work") {
  await page.getByRole("button", { name: `Options for ${folder}`, exact: true }).click();
  await page.getByRole("button", { name: "Import from Notepad++…", exact: true }).click();
  return page.getByRole("dialog", { name: "Import from Notepad++", exact: true });
}
test("Notepad++ imports a subset into an existing folder and skips repeated text after reload", async ({ page }) => {
  await mockRecovery(page, { ...scan, savedTabs: 0, sourceDirectory: "C:\\Users\\Test\\AppData\\Roaming\\Notepad++\\backup" }, "scan_notepad_plus_tabs");
  await open(page);
  const dialog = await fromPlusFolder(page);
  await expect(dialog).toContainText("Enable session snapshot and periodic backup");
  await expect(dialog.getByRole("combobox")).toHaveText("Work");
  await page.setViewportSize({ width: 560, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(560);
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await dialog.getByRole("checkbox", { name: "Import Shopping" }).focus();
  await page.keyboard.press("Space");
  await dialog.getByRole("button", { name: "Import 1 note", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes.length).toBe(3);
  expect((await saved(page)).notes.at(-1)?.folderId).toBe("work");
  await expect(page.locator(".toast")).toContainText("imported from Notepad++");
  await page.reload();
  const repeated = await fromPlusFolder(page);
  await expect(repeated.getByRole("checkbox", { name: "Import Daily tasks" })).toBeDisabled();
  await expect(repeated.getByRole("button", { name: "Import 1 note", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Options for Work", exact: true })).toBeFocused();
});
test("Notepad++ portable folder selection survives cancellation and rescan, and creates its own import folder", async ({ page }) => {
  await mockRecovery(page, { ...scan, tabs: [], skipped: [], found: false, sourceDirectory: "C:\\Default\\backup" }, "scan_notepad_plus_tabs");
  await open(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button", { name: "Import from Notepad++…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import from Notepad++", exact: true });
  await expect(dialog.getByRole("combobox")).toHaveText(/Create Notepad\+\+ Imports folder/);
  await expect(dialog).toContainText("No Notepad++ recovery data found");
  await page.evaluate((scan) => { (window as any).pickerResult = { ...scan, sourceDirectory: "D:\\Portable\\Notepad++\\backup" }; }, scan);
  await dialog.getByRole("button", { name: "Choose backup folder…" }).click();
  await expect(dialog.getByRole("button", { name: "Import 2 notes", exact: true })).toBeEnabled();
  await dialog.getByRole("checkbox", { name: "Import Shopping" }).uncheck();
  await page.evaluate(() => { (window as any).pickerResult = null; });
  await dialog.getByRole("button", { name: "Choose backup folder…" }).click();
  await expect(dialog.getByRole("button", { name: "Import 1 note", exact: true })).toBeEnabled();
  await expect(dialog).toContainText("D:\\Portable\\Notepad++\\backup");
  await page.evaluate((scan) => { (window as any).notepadScan = { ...scan, sourceDirectory: "D:\\Portable\\Notepad++\\backup" }; }, scan);
  await dialog.getByRole("button", { name: "Scan again" }).click();
  await expect(dialog.getByRole("button", { name: "Import 2 notes", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).scanArgs.at(-1))).toEqual({ directory: "D:\\Portable\\Notepad++\\backup", chooseDirectory: false });
  await dialog.getByRole("button", { name: "Import 2 notes", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
  const document = await saved(page), folder = document.folders.find((f) => f.name === "Notepad++ Imports");
  expect(folder).toBeDefined(); expect(document.notes.slice(2).every((n) => n.folderId === folder!.id)).toBe(true);
  expect(document.folders.filter((f) => f.name === "Notepad Imports")).toHaveLength(1);
});
test("Notepad++ browser fallback and narrow dark dialog retain file import and keyboard access", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await open(page, { ...fixture, theme: "system" });
  const dialog = await fromPlusFolder(page);
  await expect(dialog).toContainText("save your Notepad++ tabs as .txt files");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(560);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Import files…" }).click();
  await (await chooser).setFiles([{ name: "npp-tab.txt", mimeType: "text/plain", buffer: Buffer.from("Notepad++ saved text") }]);
  await expect.poll(async () => (await saved(page)).notes.length).toBe(3);
  expect((await saved(page)).notes.at(-1)?.folderId).toBe("work");
});

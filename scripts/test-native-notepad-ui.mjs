// Runs only against the isolated diagnostic app opened by the companion script.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 200)); }
}
if (!browser) throw Error("Isolated WebView2 debugging endpoint unavailable");
const page = browser.contexts()[0].pages()[0];
try {
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_workspace"));
  if (!before.dataPath.includes(process.argv[3])) throw Error("App is not using the isolated test database");
  const nativeScan = await page.evaluate(async () => {
    const result = await window.__TAURI_INTERNALS__.invoke("scan_notepad_tabs");
    // Never send real note contents to the test log or artifact.
    return { recovered: result.tabs.length, skipped: result.skipped.length, empty: result.emptyTabs, saved: result.savedTabs, found: result.found };
  });
  const sample = { found: true, emptyTabs: 0, savedTabs: 0, skipped: [], tabs: [
    { id: "native-test-a", title: "Notepad import test", text: "  First  line\n\n日本語 😀\n<script>literal</script>" },
    { id: "native-test-b", title: "Second test tab", text: "Checklist\n- First\n- Second" },
  ] };
  const plusDirectory = join(process.argv[3], "notepad-plus-fixture", "backup");
  await mkdir(plusDirectory, { recursive: true });
  const plusFile = join(plusDirectory, "Native Notepad++ test@2026-10-04_123456");
  const plusBytes = Buffer.from("  Notepad++  spacing\r\n\t日本語 😀\n<script>literal</script>");
  await writeFile(plusFile, plusBytes);
  const plusMtime = (await stat(plusFile)).mtimeMs;
  await writeFile(join(plusDirectory, "Second Notepad++ tab@2026-10-04_123457"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("UTF-16 draft\nSecond line", "utf16le")]));
  await writeFile(join(plusDirectory, "unrelated.bak"), "Never import this");
  // Tauri freezes its invoke implementation. Replace only this development
  // module's scan function; all save/load IPC still calls the genuine backend.
  let mocked = false;
  await page.route("**/src/notepadImport.ts*", async route => {
    const response = await route.fetch();
    const body = await response.text();
    const source = /const scanNotepadTabs = \(\) => invoke\("scan_notepad_tabs"\);/;
    if (!source.test(body)) throw Error("Development scan harness source did not match");
    mocked = true;
    if (!body.includes("directory: directory ?? null")) throw Error("Notepad++ directory harness source did not match");
    await route.fulfill({ response, body: body.replace(source, `const scanNotepadTabs = () => Promise.resolve(${JSON.stringify(sample)});`)
      .replace("directory: directory ?? null", `directory: directory ?? ${JSON.stringify(plusDirectory)}`) });
  });
  await page.reload();
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  if (!mocked) throw Error("Native UI test requires the development Vite server");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import from Windows Notepad…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import from Windows Notepad", exact: true });
  await dialog.getByRole("button", { name: "Import 2 notes", exact: true }).waitFor();
  await page.screenshot({ path: join(process.argv[3], "notepad-import-preview-webview.png") });
  await dialog.getByRole("button", { name: "Import 2 notes", exact: true }).click();
  await page.getByRole("textbox", { name: "Note title", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.note-title')?.value === "Notepad import test" || document.querySelector('[aria-label="Note title"]')?.value === "Notepad import test");
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  const loaded = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_workspace"));
  const imports = loaded.document.notes.filter(note => note.title === "Notepad import test" || note.title === "Second test tab");
  const folder = loaded.document.folders.find(folder => folder.name === "Notepad Imports");
  if (imports.length !== 2 || !folder || imports.some(note => note.folderId !== folder.id)) throw Error("Native import destination or persistence failed");
  const firstLine = await page.locator('.document-editor .note-content p').first().textContent();
  if (firstLine !== "  First  line") throw Error("Native editor lost source whitespace");
  await page.reload();
  await page.getByRole("textbox", { name: "Note title", exact: true }).waitFor();
  if (await page.getByRole("textbox", { name: "Note title", exact: true }).inputValue() !== "Notepad import test") throw Error("Imported notes did not survive native reload");
  await page.getByRole("button", { name: "Options for Notepad Imports", exact: true }).click();
  await page.getByRole("button", { name: "Import from Windows Notepad…", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.notepad-tab input[aria-label="Import Notepad import test"]')?.disabled);
  if (!(await dialog.getByRole("button", { name: "Import 0 notes" }).isDisabled())) throw Error("Repeat import does not skip matching notes");
  await page.screenshot({ path: join(process.argv[3], "notepad-import-webview.png") });
  await page.keyboard.press("Escape");
  const focusRestored = await page.getByRole("button", { name: "Options for Notepad Imports", exact: true }).evaluate(element => document.activeElement === element);
  if (!focusRestored) throw Error("Native dismissal did not restore folder trigger focus");
  // Real Notepad++ command reads synthetic snapshot files; real native saving
  // persists the copies. Only the default directory is redirected for this run.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import from Notepad++…", exact: true }).click();
  const plusDialog = page.getByRole("dialog", { name: "Import from Notepad++", exact: true });
  await expect(plusDialog.getByRole("button", { name: "Import 2 notes", exact: true })).toBeEnabled();
  await page.screenshot({ path: join(process.argv[3], "notepad-plus-import-preview-webview.png") });
  await plusDialog.getByRole("button", { name: "Import 2 notes", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Native Notepad++ test");
  await expect(page.locator('.document-editor .note-content p').first()).toHaveText("  Notepad++  spacing", { useInnerText: false });
  if (await page.locator('.document-editor .note-content p').first().textContent() !== "  Notepad++  spacing") throw Error("Notepad++ whitespace was not preserved");
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Native Notepad++ test");
  const plusSaved = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_workspace"));
  const plusFolder = plusSaved.document.folders.find(f => f.name === "Notepad++ Imports");
  const plusNotes = plusSaved.document.notes.filter(n => n.folderId === plusFolder?.id);
  if (plusNotes.length !== 2 || !plusNotes.some(n => n.content.includes("UTF-16 draft"))) throw Error("Notepad++ native save or UTF-16 import failed");
  await page.getByRole("button", { name: "Options for Notepad++ Imports", exact: true }).click();
  await page.getByRole("button", { name: "Import from Notepad++…", exact: true }).click();
  await expect(plusDialog.getByRole("button", { name: "Import 0 notes", exact: true })).toBeDisabled();
  await expect(plusDialog.getByRole("checkbox", { name: "Import Native Notepad++ test", exact: true })).toBeDisabled();
  if (!(await readFile(plusFile)).equals(plusBytes) || (await stat(plusFile)).mtimeMs !== plusMtime) throw Error("Original Notepad++ snapshot was modified");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Options for Notepad++ Imports", exact: true })).toBeFocused();
  const report = { ok: true, nativeScan, importedSyntheticNotes: imports.length, repeatImportSkipped: true, whitespacePreserved: true, focusRestored,
    notepadPlus: { imported: plusNotes.length, realSnapshotParser: true, utf16: true, originalsUnchanged: true, reloadAndDuplicateCheck: true },
    dataPath: loaded.dataPath, limits: "Isolated development WebView2/PostgreSQL run. Real Windows Notepad recovery scanned read-only; only synthetic notes imported. Notepad++ snapshot fixtures use its documented naming and encodings; the actual Notepad++ application is not installed." };
  await writeFile(join(process.argv[3], "notepad-import.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  await browser.close();
}

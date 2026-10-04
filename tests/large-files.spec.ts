import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test.setTimeout(120_000);
const fixture = { theme: "light", activeId: "n", referenceId: null, folders: [], notes: [{ id: "n", folderId: null, title: "Draft", content: "<p>Keep writing</p>", archived: false, createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z" }] };
async function open(page: Page) {
  await page.addInitScript(document => {
    if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
    const original = Blob.prototype.arrayBuffer;
    (window as any).sourceReadSizes = [];
    Blob.prototype.arrayBuffer = function () { (window as any).sourceReadSizes.push(this.size); return original.call(this); };
  }, fixture);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
}

test("24 MiB XML imports intact with bounded reads, section navigation, notes and restart", async ({ page }) => {
  await open(page);
  const content = Buffer.from(`<root>\n${"<item>日本語 &amp; data</item>\n".repeat(740_000)}</root>`);
  expect(content.length).toBeGreaterThan(20 * 1024 * 1024);
  const start = Date.now();
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "dataset.xml", mimeType: "application/xml", buffer: content });
  const block = page.locator(".document-editor .source-file-block");
  await expect(block.locator(".source-file-text")).toContainText("<root>");
  expect(await block.locator(".source-file-text").evaluate(el => el.textContent!.length)).toBeLessThan(66_000);
  const reads = await page.evaluate(() => (window as any).sourceReadSizes as number[]);
  expect(Math.max(...reads)).toBeLessThanOrEqual(1024 * 1024);
  await block.getByRole("button", { name: "Next file section", exact: true }).click();
  await expect(block.getByRole("spinbutton", { name: "File section" })).toHaveValue("2");
  await expect(block.locator(".source-file-text")).not.toContainText("<root>");
  await block.getByRole("spinbutton", { name: "File section" }).fill(String(Math.ceil(content.length / 65536)));
  await expect(block.locator(".source-file-text")).toContainText("</root>");
  const paragraph = page.locator(".document-editor .tiptap > p").last();
  await paragraph.click(); await page.keyboard.type("Review this dataset tomorrow.");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes.find((note: any) => note.title === "dataset")?.content)).toContain("Review this dataset tomorrow.");
  const download = page.waitForEvent("download");
  await block.getByRole("button", { name: "Download original", exact: true }).click();
  const original = await download;
  expect(original.suggestedFilename()).toBe("dataset.xml");
  const bytes = await readFile((await original.path())!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(createHash("sha256").update(content).digest("hex"));
  await page.reload();
  await expect(block.locator(".source-file-text")).toContainText("<root>");
  await expect(paragraph).toContainText("Review this dataset tomorrow.");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Use dark mode", exact: true }).click();
  await page.screenshot({ path: "test-results/large-source-dark.png" });
  await page.setViewportSize({ width: 850, height: 600 });
  await page.screenshot({ path: "test-results/large-source-narrow.png" });
  console.log(`Large XML import/navigation/download/reload: ${Date.now() - start} ms; ${content.length} bytes; largest read ${Math.max(...reads)} bytes.`);
});

test("file sections preserve UTF-8 code points and UTF-16 surrogate pairs", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Source module test harness");
  await open(page);
  const result = await page.evaluate(async () => {
    const { storeSource, sourcePage } = await import("/src/sourceFiles.ts");
    const utf8 = "x".repeat(65535) + "日😀" + "y".repeat(65536);
    const utf16 = "a".repeat(32766) + "😀" + "日本語" + "b".repeat(32768);
    const utf16Bytes = new Uint8Array(2 + utf16.length * 2), view = new DataView(utf16Bytes.buffer); view.setUint16(0, 0xfeff, true);
    for (let i = 0; i < utf16.length; i++) view.setUint16(2 + i * 2, utf16.charCodeAt(i), true);
    const a = await storeSource(new Blob([utf8]), "a.xml", "utf-8"), b = await storeSource(new Blob([utf16Bytes]), "b.xml", "utf-16le");
    async function all(source: any) { let value = ""; for (let page = 0; page < Math.ceil(source.size / 65536); page++) value += await sourcePage(source, page); return value; }
    return { utf8: await all(a) === utf8, utf16: await all(b) === utf16 };
  });
  expect(result).toEqual({ utf8: true, utf16: true });
});

test("Settings backup exports and restores a saved original through the import UI", async ({ page, browser }) => {
  await open(page);
  const content = Buffer.from(`<root>\n${"<item>日本語 &amp; backup</item>\n".repeat(15_000)}</root>`);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "backup-original.xml", mimeType: "application/xml", buffer: content });
  await expect(page.locator(".document-editor .source-file-text")).toContainText("<root>");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export notes & boards", exact: true }).click();
  const backup = await exported;
  expect(backup.suggestedFilename()).toMatch(/\.scribly$/);
  const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_PREVIEW === "1" ? "http://127.0.0.1:1421" : "http://127.0.0.1:1420" });
  try {
    const restored = await context.newPage();
    await open(restored);
    await restored.getByLabel("Import files", { exact: true }).setInputFiles({ name: backup.suggestedFilename(), mimeType: "application/zip", buffer: await readFile((await backup.path())!) });
    await restored.getByRole("button", { name: "backup-original", exact: true }).click();
    await expect(restored.locator(".document-editor .source-file-text")).toContainText("<root>");
    const original = restored.waitForEvent("download");
    await restored.getByRole("button", { name: "Download original", exact: true }).click();
    const download = await original;
    expect(download.suggestedFilename()).toBe("backup-original.xml");
    expect(await readFile((await download.path())!)).toEqual(content);
    await restored.reload();
    await expect(restored.locator(".document-editor .source-file-text")).toContainText("<root>");
  } finally { await context.close(); }
});

test("notebook beyond 20 MiB migrates to per-item IndexedDB and survives small edits and reload", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Storage module test harness");
  await open(page);
  const result = await page.evaluate(async () => {
    const { loadWorkspace, saveWorkspace } = await import("/src/storage.ts");
    const stored = await loadWorkspace(), document = stored.document!;
    const content = `<p>${"x".repeat(1024 * 1024)}</p>`;
    document.notes = [...document.notes, ...Array.from({ length: 24 }, (_, i) => ({ ...document.notes[0], id: `large-${i}`, title: `Inactive ${i}`, content }))];
    const first = await saveWorkspace(document, stored.revision);
    const changed = { ...document, notes: document.notes.map(note => note.id === "n" ? { ...note, content: "<p>A small saved edit</p>" } : note) };
    const second = await saveWorkspace(changed, first);
    const loaded = await loadWorkspace();
    return { count: loaded.document!.notes.length, content: loaded.document!.notes[0].content, revision: loaded.revision, second, raw: localStorage.getItem("still-notes-browser-v1"), bytes: loaded.document!.notes.reduce((size, note) => size + note.content.length, 0) };
  });
  expect(result.count).toBe(25); expect(result.bytes).toBeGreaterThan(20 * 1024 * 1024);
  expect(result.content).toContain("A small saved edit"); expect(result.revision).toBe(result.second); expect(result.raw).toBeNull();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("A small saved edit");
});

test("file backup round trip restores originals and rejects same-size corruption", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Backup module test harness");
  await open(page);
  const result = await page.evaluate(async document => {
    const { storeSource, sourceBytes } = await import("/src/sourceFiles.ts");
    const { sourceHtml, sourceFilesInHtml } = await import("/src/sourceFileData.ts");
    const { fileBackup, importFileBackup } = await import("/src/fileBackup.ts");
    const original = "<root>日本語</root>\n".repeat(40_000), source = await storeSource(new Blob([original]), "original.xml", "utf-8");
    const workspace: any = { ...document, schemaVersion: 4, notes: [{ ...document.notes[0], content: sourceHtml(source) }] };
    const blob = await fileBackup(workspace), restored = await importFileBackup(blob);
    const reference = sourceFilesInHtml(restored.notes[0].content)[0];
    let text = "";
    const decoder = new TextDecoder();
    for (let offset = 0; offset < reference.size; offset += 1024 * 1024) text += decoder.decode(await sourceBytes(reference, offset, 1024 * 1024), { stream: true });
    text += decoder.decode();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const marker = new TextEncoder().encode("<root>");
    let position = -1;
    for (let index = 0; index < bytes.length - marker.length; index++) if (marker.every((byte, at) => bytes[index + at] === byte)) { position = index; break; }
    if (position < 0) throw Error("Backup fixture marker missing");
    bytes[position + 1] = 115;
    let error = ""; try { await importFileBackup(new Blob([bytes])); } catch (reason) { error = String(reason); }
    return { same: original === text, newId: reference.id !== source.id, error, size: blob.size };
  }, fixture);
  expect(result.same).toBe(true); expect(result.newId).toBe(true); expect(result.error).toContain("checksum");
});

test("large dirty drafts promote recovery storage and restore after reopening the journal", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Recovery storage module harness");
  await open(page);
  const result = await page.evaluate(async document => {
    const { RecoveryStorage } = await import("/src/recoveryStorage.ts");
    const { RecoveryJournal } = await import("/src/recovery.ts");
    const content = `<p>${"draft".repeat(240_000)}</p>`;
    const large = { ...document, notes: Array.from({ length: 8 }, (_, i) => ({ ...document.notes[0], id: `draft-${i}`, content })) };
    const store = await RecoveryStorage.open(), journal = new RecoveryJournal(store);
    journal.write(large as any, 1, true); await store.flush();
    const localRecords = Object.keys(localStorage).filter(key => key.startsWith("still-notes-recovery-v2"));
    const reopened = await RecoveryStorage.open();
    const restored = new RecoveryJournal(reopened).restore(document as any, 1);
    return { count: restored.document!.notes.length, retained: restored.document!.notes.every(note => note.content === content), warning: restored.warning, localRecords };
  }, fixture);
  expect(result.count).toBe(8); expect(result.retained).toBe(true); expect(result.warning).toBe("");
  expect(result.localRecords).toEqual([]);
});

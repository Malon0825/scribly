import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 200)); }
}
if (!browser) throw Error("Isolated WebView2 endpoint unavailable");
const page = browser.contexts()[0].pages()[0], profile = process.argv[3];
const saved = () => page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
const load = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_workspace"));
const editor = () => page.getByRole("textbox", { name: "Note content", exact: true });
try {
  await saved();
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "retrieval-native.txt", mimeType: "text/plain", buffer: Buffer.from("Alpha alpha alphanumeric 日本語") });
  await expect(editor()).toContainText("Alpha alpha alphanumeric 日本語"); await saved();
  const first = (await load()).document.notes.find(note => note.title === "retrieval-native");
  await page.getByRole("button", { name: "Note options", exact: true }).click(); await page.getByRole("button", { name: "Pin item", exact: true }).click(); await saved();
  const pinned = (await load()).document.notes.find(note => note.id === first.id);
  if (!pinned.pinned || pinned.updatedAt !== first.updatedAt || pinned.content !== first.content) throw Error("Pin changed the note body or timestamp");
  await editor().focus(); await page.keyboard.press("Control+h"); await page.getByRole("textbox", { name: "Find text", exact: true }).fill("alpha");
  await page.getByLabel("Whole word", { exact: true }).check();
  await expect(page.locator(".find-count")).toHaveText(/of 2$/);
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("Beta"); await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor()).toContainText("Beta Beta alphanumeric 日本語");
  await page.getByRole("button", { name: "Close find", exact: true }).click(); await page.keyboard.press("Control+z"); await expect(editor()).toContainText("Alpha alpha alphanumeric 日本語");
  await page.keyboard.press("Control+Shift+z"); await expect(editor()).toContainText("Beta Beta alphanumeric 日本語"); await saved();
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("Beta");
  await expect(page.locator(".search-results mark")).toHaveText("Beta"); await page.locator(".search-results .note-select").click();
  await expect(page.locator(".find-current").first()).toHaveText("Beta");
  await page.getByRole("button", { name: "Close find", exact: true }).click(); await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.reload(); await saved();
  await expect(page.getByRole("region", { name: "Pinned items", exact: true }).getByRole("button", { name: "retrieval-native", exact: true })).toBeVisible();
  await expect(editor()).toContainText("Beta Beta alphanumeric 日本語");
  const reopened = await load();
  if (reopened.document.recentIds[0] !== first.id) throw Error("Recent order did not survive reload");
  const xml = Buffer.from(`<root>${"<item>alpha</item>\n".repeat(30_000)}</root>`);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "retrieval-original.xml", mimeType: "application/xml", buffer: xml });
  await expect(page.locator(".document-editor .source-file-text")).toContainText("<root>");
  await page.locator(".document-editor .tiptap > p").last().click(); await page.keyboard.type("alpha annotation"); await saved();
  await page.keyboard.press("Control+h"); await page.getByRole("textbox", { name: "Find text", exact: true }).fill("alpha");
  await expect(page.locator(".find-count")).toHaveText("1 of 1"); await expect(page.locator(".note-find")).toContainText("Original file contents are excluded");
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("updated"); await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(page.locator(".document-editor .tiptap > p").last()).toContainText("updated annotation"); await saved();
  const sourceState = await load(), source = sourceState.document.notes.find(note => note.title === "retrieval-original");
  const id = source.content.match(/data-source-id="([a-f0-9-]+)"/)?.[1];
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  if (!id || sha(await readFile(join(sourceState.dataPath, "sources", `${id}.source`))) !== sha(xml)) throw Error("Find/replace changed immutable original bytes");
  await page.screenshot({ path: join(profile, "retrieval-native.png") });
  const report = { ok: true, executable: "optimized release", schemaVersion: sourceState.document.schemaVersion, replaceUndoRedo: true, pinsAndRecentSurvivedReload: true, pinPreservedBodyAndTimestamp: true, notebookSearchNavigation: true, originalBytes: xml.length, originalSha256: sha(xml), originalExcludedFromReplacement: true, limitations: "Isolated Windows WebView2 profile; installer installation and native pickers not exercised. No sustained RAM/frame benchmark." };
  await writeFile(join(profile, "retrieval.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  await browser.close();
}

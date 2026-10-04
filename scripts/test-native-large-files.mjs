// Connect only to the isolated benchmark profile launched by the companion script.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 200)); }
}
if (!browser) throw Error("Isolated WebView2 debugging endpoint unavailable");
const page = browser.contexts()[0].pages()[0];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  const bytes = Buffer.from(`<root>\n${"<item>日本語 &amp; data</item>\n".repeat(740_000)}</root>`);
  const start = performance.now();
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "large-native.xml", mimeType: "application/xml", buffer: bytes });
  const preview = page.locator(".document-editor .source-file-text");
  await preview.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector(".document-editor .source-file-text")?.textContent?.startsWith("<root>"));
  const importMs = performance.now() - start;
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  const loaded = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_workspace"));
  const item = loaded.document.notes.find(note => note.title === "large-native");
  const id = item.content.match(/data-source-id="([a-f0-9-]+)"/)?.[1];
  if (!id || ![4,5].includes(loaded.document.schemaVersion)) throw Error("Native source reference or schema marker missing");
  if (hash(await readFile(join(loaded.dataPath, "sources", `${id}.source`))) !== hash(bytes)) throw Error("Native original bytes changed");
  if (item.content.length > 1024) throw Error("Original leaked into the rich-text document");
  const displayedLength = await preview.evaluate(element => element.textContent.length);
  if (displayedLength > 66_000) throw Error("Native viewport is not bounded");
  const next = performance.now();
  await page.getByRole("button", { name: "Next file section", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".document-editor .source-file-text")?.textContent?.length > 0 && !document.querySelector(".document-editor .source-file-text").textContent.startsWith("<root>"));
  const nextSectionMs = performance.now() - next;
  await page.locator(".document-editor .tiptap > p").last().click();
  await page.keyboard.type("Native annotation saved.");
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60_000 });
  await page.reload();
  await preview.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector(".document-editor .source-file-text")?.textContent?.startsWith("<root>"));
  if (!(await page.locator(".document-editor .tiptap > p").last().textContent()).includes("Native annotation saved.")) throw Error("Native annotation did not survive reload");
  await page.screenshot({ path: join(process.argv[3], "large-source-webview.png") });
  const report = { ok: true, bytes: bytes.length, originalSha256: hash(bytes), importMs: Math.round(importMs), nextSectionMs: Math.round(nextSectionMs), displayedCharacters: displayedLength, noteHtmlCharacters: item.content.length, schemaVersion: loaded.document.schemaVersion, dataPath: loaded.dataPath, limits: "Development WebView2 sample; no large-file editing, native dialog, RAM or sustained frame-rate claim." };
  await writeFile(join(process.argv[3], "large-files.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  await browser.close();
}

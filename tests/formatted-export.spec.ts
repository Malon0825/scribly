import { test, expect, type Download, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import type { Note, Workspace } from "../src/types";

const stamp = "2026-10-04T00:00:00.000Z";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5qkAAAAASUVORK5CYII=";
const image = `<figure data-notify-image data-width="60"><img src="${png}" alt="pixel"><figcaption>Shared image caption</figcaption></figure>`;
const note = (id: string, title: string, content: string): Note => ({ id, title, content, folderId: "work", archived: false, createdAt: stamp, updatedAt: stamp });
const rich = `<h2>Export heading</h2><p>Unicode 日本語 ✓</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Completed task</p></li><li data-type="taskItem" data-checked="false"><p>Pending task</p></li></ul><pre><code class="language-typescript">const literal = '&lt;script&gt;';</code></pre>${image}`;
function workspace(notes = [note("one", "Draft", rich)]): Workspace {
  return { schemaVersion: 4, theme: "light", activeId: "one", referenceId: null, folders: [{ id: "work", name: "Work" }], notes };
}
async function open(page: Page, document = workspace()) {
  await page.addInitScript(document => localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" })), document);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
}
// These accessible labels are shared with the export dialog rather than CSS geometry.
async function exportDialog(page: Page, folder = false) {
  if (folder) await page.getByRole("button", { name: "Options for Work", exact: true }).click();
  else await page.getByRole("button", { name: "Note options", exact: true }).click();
  await page.getByRole("button", { name: folder ? "Export notes…" : "Export formatted…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Export/ });
  await expect(dialog.getByRole("button", { name: "Export Markdown (.zip)", exact: true })).toBeEnabled();
  return dialog;
}
async function bytes(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}
async function download(page: Page, name: string) {
  const event = page.waitForEvent("download");
  await page.getByRole("dialog", { name: /Export/ }).getByRole("button", { name, exact: true }).click();
  return event;
}

test("Markdown downloads a portable ZIP from the current unsaved draft", async ({ page }) => {
  await open(page);
  const editor = page.locator(".document-editor [contenteditable=true]");
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill("Fresh 日本語 draft");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" Fresh unsaved tail");
  await exportDialog(page);
  const file = await download(page, "Export Markdown (.zip)");
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  await mkdir("release/phase5-export-evidence", { recursive: true });
  await file.saveAs("release/phase5-export-evidence/current-draft.zip");
  const entries = unzipSync(await bytes(file));
  const markdown = Object.entries(entries).filter(([name]) => name.endsWith(".md"));
  expect(markdown).toHaveLength(1);
  const body = strFromU8(markdown[0][1]);
  expect(body).toContain("Fresh unsaved tail");
  expect(body).toContain("日本語");
  expect(body).toContain("[x] Completed task");
  expect(body).toContain("[ ] Pending task");
  expect(body).toContain("```typescript");
  expect(body).toContain("Shared image caption");
  const assets = Object.keys(entries).filter(name => name.startsWith("assets/"));
  expect(assets).toHaveLength(1);
  expect(body).toContain(assets[0]);
});

test("folder ZIP uses unique Windows-safe names and shared image assets", async ({ page }) => {
  await open(page, workspace([note("one", "CON", rich), note("two", "con", image), { ...note("hidden", "Archived", "<p>Hidden</p>"), archived: true }]));
  await exportDialog(page, true);
  const entries = unzipSync(await bytes(await download(page, "Export Markdown (.zip)")));
  const names = Object.keys(entries).filter(name => name.endsWith(".md"));
  expect(names).toHaveLength(2);
  expect(new Set(names.map(name => name.toLowerCase())).size).toBe(2);
  for (const name of names) {
    expect(name).not.toMatch(/[<>:"\\|?*]/);
    expect(name).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i);
  }
  expect(Object.keys(entries).filter(name => name.startsWith("assets/"))).toHaveLength(1);
  expect(names.map(name => strFromU8(entries[name])).join("\n")).not.toContain("Hidden");
});

test("standalone HTML is safe and renders readable multi-page PDF output", async ({ page, context }) => {
  const unsafe = '<p onclick="window.exportAttack=1">Safe paragraph<a href="javascript:window.exportAttack=1">unsafe link</a></p><script>window.exportAttack=1</script>';
  const paragraphs = Array.from({ length: 90 }, (_, i) => `<p>Print paragraph ${i} contains readable content.</p>`).join("");
  await open(page, workspace([note("one", "Printable", rich + `<pre><code>${"long_code_segment_".repeat(80)}</code></pre>` + unsafe + paragraphs)]));
  // The direct module/abort harness is development-only; exercise the exported
  // HTML, sanitization and PDF rendering through the UI in both build modes.
  if (process.env.PLAYWRIGHT_PREVIEW !== "1") {
    const boundary = await page.evaluate(async raw => {
      const path = "/src/formattedExport.ts";
      const { prepareNoteExport } = await import(/* @vite-ignore */ path);
      const item = { id: "raw", title: "Raw", content: raw, archived: false, folderId: null, createdAt: "2026-10-04", updatedAt: "2026-10-04" };
      const output = await prepareNoteExport([item]);
      const controller = new AbortController(); controller.abort();
      let abortName = "";
      try { await prepareNoteExport([item], controller.signal); } catch (error) { abortName = (error as Error).name; }
      return { html: output.html, abortName };
    }, unsafe);
    expect(boundary.html).not.toMatch(/<script|onclick=|href="javascript:/i);
    expect(boundary.abortName).toBe("AbortError");
  }
  await exportDialog(page);
  const html = (await bytes(await download(page, "Save HTML"))).toString("utf8");
  await mkdir("release/phase5-export-evidence", { recursive: true });
  await writeFile("release/phase5-export-evidence/printable.html", html);
  const reader = await context.newPage();
  await reader.setContent(html);
  expect(await reader.evaluate(() => (window as Window & { exportAttack?: number }).exportAttack)).toBeUndefined();
  await expect(reader.locator("script,[onclick],a[href^='javascript:']")).toHaveCount(0);
  await expect(reader.getByText("Shared image caption", { exact: true })).toBeVisible();
  expect(await reader.locator("img").first().evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const pdf = await reader.pdf({ format: "A4", printBackground: true });
  await writeFile("release/phase5-export-evidence/printable.pdf", pdf);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const document = await loadingTask.promise;
  expect(document.numPages).toBeGreaterThan(1);
  let text = "";
  for (let i = 1; i <= document.numPages; i++) {
    const content = await (await document.getPage(i)).getTextContent();
    text += content.items.map(item => "str" in item ? item.str : "").join(" ");
  }
  expect(text).toContain("Export heading");
  expect(text).toContain("Print paragraph 89");
  expect(text).toContain("Shared image caption");
  await loadingTask.destroy();
  await reader.close();
});

test("dismissal preserves the editor and a failed download can be retried", async ({ page }) => {
  await open(page);
  const editor = page.locator(".document-editor [contenteditable=true]");
  const identity = await editor.elementHandle();
  await exportDialog(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Export/ })).toHaveCount(0);
  expect(await identity!.evaluate(node => node.isConnected)).toBe(true);
  await exportDialog(page);
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      HTMLAnchorElement.prototype.click = original;
      throw Error("Injected download failure");
    };
  });
  await page.getByRole("button", { name: "Save HTML", exact: true }).click();
  await expect(page.getByText(/Injected download failure/)).toBeVisible();
  await bytes(await download(page, "Save HTML"));
  expect(await identity!.evaluate(node => node.isConnected)).toBe(true);
});


test("export disclosures stay visible in narrow light and wide dark dialogs", async ({ page }) => {
  const ink = JSON.stringify([{ color: "yellow", points: [[0.1, 0.4], [0.5, 0.4]] }]).replaceAll('"', '&quot;');
  const source = '<div data-notify-source="" data-source-id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" data-source-name="original.txt" data-source-size="300000" data-source-encoding="utf-8"></div>';
  const document = workspace([note("one", "Format differences", `<p data-note-ink="${ink}"><span data-text-color="blue">Colored writing</span></p>${rich}${source}`)]);
  await page.setViewportSize({ width: 850, height: 600 });
  await open(page, document);
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toHaveAttribute("aria-pressed", "false");
  const dialog = await exportDialog(page);
  const warnings = dialog.getByLabel("Export format differences");
  await expect(warnings).toContainText(/ink/i);
  await expect(warnings).toContainText(/color/i);
  await expect(warnings).toContainText(/original|metadata/i);
  await page.screenshot({ path: ".impeccable/review/phase5-export-narrow-light.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await exportDialog(page);
  await page.screenshot({ path: ".impeccable/review/phase5-export-wide-dark.png" });
});






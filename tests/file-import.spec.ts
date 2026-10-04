import { test, expect, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import type { Workspace } from "../src/types";

const stamp = "2026-10-02T00:00:00.000Z";
const fixture: Workspace = {
  theme: "light", activeId: "old", referenceId: "ref",
  folders: [{ id: "work", name: "Personal", copyLastNote: true }, { id: "closed", name: "Closed folder" }],
  notes: [{ id: "old", folderId: "work", title: "Little ideas", content: "<p>Original draft</p>", archived: false, createdAt: stamp, updatedAt: stamp },
    { id: "ref", folderId: null, title: "Reference", content: "<p>Keep reference</p>", archived: false, createdAt: stamp, updatedAt: stamp }],
};
const input = (page: Page) => page.getByLabel("Import files", { exact: true });
const saved = (page: Page): Promise<Workspace> => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
async function open(page: Page, document = fixture) {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, document);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
}
async function chooseFolder(page: Page, name = "Personal") {
  await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import files…", exact: true }).click();
  return picker;
}
type Payload = { name: string; mimeType: string; buffer: Buffer };
async function fileDrop(page: Page, selector: string, files: Payload[], hover = false) {
  const dataTransfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, { type: file.mimeType }));
    return transfer;
  }, files.map((file) => ({ ...file, buffer: undefined, base64: file.buffer.toString("base64") })));
  await page.locator(selector).dispatchEvent("dragover", { dataTransfer, clientX: 100, clientY: 300 });
  if (!hover) await page.locator(selector).dispatchEvent("drop", { dataTransfer });
  return dataTransfer;
}
function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 40 150 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(content);
}
const word = Buffer.from(zipSync({ "word/document.xml": strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word notes 日本語</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table text &amp; detail</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>&lt;script&gt;literal&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>') }));

test("folder picker imports multiple documents into the chosen folder, bypasses copy-last-note, and persists", async ({ page }) => {
  await open(page);
  const chooser = await chooseFolder(page);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([{ name: "daily.txt", mimeType: "text/plain", buffer: Buffer.from("Hello 日本語\n<script>literal</script>") },
    { name: "report.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\nSecond file") }]);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("daily");
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
  const document = await saved(page);
  expect(document.notes.slice(2).map((n) => n.folderId)).toEqual(["work", "work"]);
  expect(document.notes.find((n) => n.id === "old")).toEqual(fixture.notes[0]);
  expect(document.referenceId).toBe("ref");
  expect(document.notes[2].content).toContain("&lt;script&gt;literal&lt;/script&gt;");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("daily");
});

test("Explorer-style file drop on a closed folder opens it and preserves JSON indentation as code", async ({ page }) => {
  await open(page);
  const source = '{\n  "name": "package",\n  "count": 2\n}';
  await fileDrop(page, '[data-file-folder="closed"]', [{ name: "package.json", mimeType: "application/json", buffer: Buffer.from(source) }]);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("package");
  await expect(page.locator(".document-editor pre code")).toHaveText(source);
  await expect(page.getByRole("button", { name: "Closed folder", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.title === "package")?.folderId).toBe("closed");
  expect((await saved(page)).notes.find((n) => n.title === "package")?.content).toContain('language-json');
});

test("dropping files into the document uses its folder; Unfiled uses its own explicit destination", async ({ page }) => {
  await open(page);
  await fileDrop(page, ".document-panel", [{ name: "helper.py", mimeType: "text/plain", buffer: Buffer.from("def hello():\n    return '<hello>'\n") }]);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("helper");
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.title === "helper")?.folderId).toBe("work");
  await page.getByRole("button", { name: "Notebook navigation", exact: true }).click(); await fileDrop(page, '.notebook-menu [data-file-folder=""]', [{ name: "loose.txt", mimeType: "text/plain", buffer: Buffer.from("Loose content") }]);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("loose");
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.title === "loose")?.folderId).toBeNull();
});

test("PDF and Word .docx extract text as notes using the actual parsers", async ({ page }) => {
  await open(page);
  const chooser = await chooseFolder(page);
  await chooser.setFiles([{ name: "report.pdf", mimeType: "application/pdf", buffer: pdf("PDF extracted text") },
    { name: "minutes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: word }]);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("report");
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
  expect((await saved(page)).notes.find((n) => n.title === "report")?.content).toContain("PDF extracted text");
  const content = (await saved(page)).notes.find((n) => n.title === "minutes")?.content;
  expect(content).toContain("Word notes 日本語"); expect(content).toContain("Table text &amp; detail");
  expect(content).toContain("&lt;script&gt;literal&lt;/script&gt;");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("report");
});

test("mixed batches keep successful imports and report every failed file without modifying originals", async ({ page }) => {
  await open(page);
  await input(page).setInputFiles([{ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") },
    { name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("legacy") },
    { name: "picture.png", mimeType: "image/png", buffer: Buffer.from([0, 137, 255, 3]) },
    { name: "valid.txt", mimeType: "text/plain", buffer: Buffer.from("Successful import") }]);
  const results = page.getByRole("dialog", { name: "Import results" });
  await expect(results).toContainText("1 note imported");
  await expect(results).toContainText("broken.pdf:"); await expect(results).toContainText("old.doc: Save this legacy Word file as .docx");
  await expect(results).toContainText("picture.png:");
  await results.getByRole("button", { name: "Done" }).click();
  await expect.poll(async () => (await saved(page)).notes.length).toBe(3);
  expect((await saved(page)).notes.slice(0, 2)).toEqual(fixture.notes);
  // Resetting the input allows selecting the same file again.
  await input(page).setInputFiles({ name: "valid.txt", mimeType: "text/plain", buffer: Buffer.from("Second independent import") });
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
});

test("backups retain their folder structure; ordinary or invalid JSON stays literal source", async ({ page }) => {
  await open(page);
  const chooser = await chooseFolder(page);
  await chooser.setFiles([{ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ folders: [{ id: "f", name: "Backup folder" }], notes: [{ ...fixture.notes[0], folderId: "f" }] })) },
    { name: "fragment.json", mimeType: "application/json", buffer: Buffer.from('{"incomplete":') }]);
  await expect.poll(async () => (await saved(page)).notes.length).toBe(4);
  const document = await saved(page);
  const restored = document.notes[2];
  expect(restored.id).not.toBe("old"); expect(document.folders.find((f) => f.id === restored.folderId)?.name).toBe("Backup folder");
  expect(document.notes[3].folderId).toBe("work"); expect(document.notes[3].content).toContain('{&quot;incomplete&quot;:');
});

test("file hover highlights the destination and clears on cancellation in dark/reduced-motion mode", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { ...fixture, theme: "dark" });
  await fileDrop(page, '[data-file-folder="closed"]', [{ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("Text") }], true);
  await expect(page.locator('[data-file-folder="closed"]')).toHaveClass(/drop-folder/);
  await expect(page.getByRole("status").filter({ hasText: "Drop files into Closed folder" })).toBeVisible();
  await page.screenshot({ path: "release/preview-file-drop.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".file-drop-hint")).toHaveCount(0);
  await expect(page.locator('[data-file-folder="closed"]')).not.toHaveClass(/drop-folder/);
  expect((await saved(page)).notes).toEqual(fixture.notes);
});

test("a file drop outside the app prevents navigation and leaves the notebook untouched", async ({ page }) => {
  await open(page);
  const prevented = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Outside drop"], "outside.txt", { type: "text/plain" }));
    const event = new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Little ideas");
  expect((await saved(page)).notes).toEqual(fixture.notes);
});

test("binary large files and batch limits are reported; UTF-16 text imports correctly", async ({ page }) => {
  await open(page);
  await input(page).setInputFiles({ name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  const results = page.getByRole("dialog", { name: "Import results" });
  await expect(results).toContainText("huge.txt: This file is not readable UTF-8 or UTF-16 text");
  expect((await saved(page)).notes).toEqual(fixture.notes);
  await results.getByRole("button", { name: "Close dialog", exact: true }).click();
  await input(page).setInputFiles({ name: "windows.txt", mimeType: "text/plain", buffer: Buffer.concat([Buffer.from([255, 254]), Buffer.from("Windows 日本語", "utf16le")]) });
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toHaveText("Windows 日本語");
  const tooMany = Array.from({ length: 26 }, (_, i) => ({ name: `file-${i}.txt`, mimeType: "text/plain", buffer: Buffer.from(String(i)) }));
  await input(page).setInputFiles(tooMany);
  await expect(page.getByRole("dialog", { name: "Import results" })).toContainText("file-25.txt: Import up to 25 files", { timeout: 20_000 });
  await expect.poll(async () => (await saved(page)).notes.length).toBe(28);
});

test("a notebook near the former total limit accepts another import", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Requires interception of the Vite source storage module.");
  // Model a large desktop notebook without putting its fixture in localStorage.
  await page.addInitScript((fixture) => {
    const document = { ...fixture, referenceId: null, notes: [...fixture.notes,
      { ...fixture.notes[0], id: "big", title: "Large inactive note", content: "" }] };
    const overhead = new TextEncoder().encode(JSON.stringify(document)).length;
    document.notes[2].content = "x".repeat(20 * 1024 * 1024 - overhead - 100);
    (window as any).nativeTestDocument = document;
  }, fixture);
  await page.route(/\/src\/storage\.ts(?:\?.*)?$/, (route) => route.fulfill({ contentType: "text/javascript", body: `
    export const desktop = false;
    export async function loadWorkspace() { return {revision:1,document:window.nativeTestDocument,dataPath:'Native-size test'}; }
    export async function saveWorkspace(document) { window.nativeTestDocument = document; return 2; }
    export function downloadFile() {}
    export async function exportArtifact() { return true; }
  ` }));
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Little ideas");
  await input(page).setInputFiles({ name: "over-limit.txt", mimeType: "text/plain", buffer: Buffer.from("This note exceeds capacity. ".repeat(100)) });
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("over-limit");
  await expect.poll(() => page.evaluate(() => (window as any).nativeTestDocument.notes.length)).toBe(4);
  await expect(page.getByRole("dialog", { name: "Import results" })).toHaveCount(0);
});

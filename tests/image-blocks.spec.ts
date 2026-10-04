import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const stamp = "2026-10-02T00:00:00Z";
const fixture: Workspace = { theme: "light", activeId: "first", referenceId: "first",
  folders: [{ id: "work", name: "Work" }, { id: "other", name: "Other" }],
  notes: [{ id: "first", title: "Daily task logs", folderId: "work", content: "<p>Before image</p><p>After image</p>", archived: false, createdAt: stamp, updatedAt: stamp }] };
const saved = (page: Page): Promise<Workspace> => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
async function open(page: Page, workspace = fixture) {
  await page.addInitScript((document) => { if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" })); }, workspace);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible({ timeout: 15000 });
}
async function image(page: Page, name = "board.png") {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 500;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e7eef8"; ctx.fillRect(0, 0, 900, 500);
    ctx.fillStyle = "white"; ctx.fillRect(20, 20, 860, 460);
    ctx.fillStyle = "#111827"; ctx.font = "bold 32px Segoe UI"; ctx.fillText("Daily Task Logs · Oct 2, 2026", 45, 80);
    ctx.fillStyle = "#0879ff"; ctx.fillRect(45, 130, 380, 6);
    ctx.fillStyle = "#52698a"; ctx.font = "20px Segoe UI"; ctx.fillText("A quiet place to keep your work.", 45, 190);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}
async function upload(page: Page, files?: Awaited<ReturnType<typeof image>>[]) {
  await page.locator('.document-editor [contenteditable="true"] p').first().click();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Add images", exact: true }).click();
  await page.getByLabel("Image files", { exact: true }).setInputFiles(files || [await image(page)]);
  await expect(page.locator(".document-editor .note-image")).toHaveCount((files || [0]).length);
}
async function options(page: Page) {
  await page.locator(".document-editor .image-block").first().hover();
  await page.locator(".document-editor").getByRole("button", { name: "Image options", exact: true }).first().click();
}
async function drop(page: Page, selector: string) {
  const file = await image(page);
  const transfer = await page.evaluateHandle(({ name, base64 }) => {
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type: "image/png" })); return dt;
  }, { name: file.name, base64: file.buffer.toString("base64") });
  const target = page.locator(selector);
  const rect = await target.boundingBox();
  const point = { clientX: rect!.x + 20, clientY: rect!.y + 20 };
  await target.dispatchEvent("dragover", { dataTransfer: transfer, ...point });
  await target.dispatchEvent("drop", { dataTransfer: transfer, ...point });
}

test("upload inserts independent image blocks, retains prose, persists and renders read-only Reference", async ({ page }) => {
  await open(page); await upload(page, [await image(page), await image(page, "second.png")]);
  await expect(page.locator(".document-editor")).toContainText("Before image");
  await expect(page.locator(".document-editor")).toContainText("After image");
  await expect.poll(async () => (await saved(page)).notes[0].content.match(/data-notify-image/g)?.length).toBe(2);
  expect((await saved(page)).notes.length).toBe(1);
  await page.reload();
  await expect(page.locator(".document-editor .note-image")).toHaveCount(2);
  await expect(page.locator(".reference-editor .note-image")).toHaveCount(2);
  await expect(page.locator(".reference-editor .image-resize-handle")).toHaveCount(0);
});

test("clipboard image paste inserts at the caret and Undo/Redo retain surrounding text", async ({ page }) => {
  await open(page);
  const file = await image(page);
  await page.locator('.document-editor [contenteditable="true"] p').first().click(); await page.keyboard.press("End");
  await page.locator('.document-editor [contenteditable="true"]').evaluate((el, base64) => {
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "clipboard.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, file.buffer.toString("base64"));
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".document-editor .note-image")).toHaveCount(0);
  await expect(page.locator(".document-editor")).toContainText("Before image");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
});

test("editor image drops insert into current note; folder image drops create image notes", async ({ page }) => {
  await open(page); await drop(page, '.document-editor [contenteditable="true"]');
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
  expect((await saved(page)).notes.length).toBe(1);
  await drop(page, '[data-file-folder="other"]');
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("board");
  await expect.poll(async () => (await saved(page)).notes.length).toBe(2);
  expect((await saved(page)).notes[1].folderId).toBe("other");
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
});

test("resize tracks pointer, Escape cancels, keyboard width and caption/alignment survive reload", async ({ page }) => {
  await open(page); await upload(page);
  const block = page.locator(".document-editor .image-block-frame");
  const right = page.locator(".document-editor").getByRole("button", { name: "Resize image from right" });
  await block.hover(); const initial = await block.boundingBox(); const handle = await right.boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2); await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 - 90, handle!.y + handle!.height / 2);
  expect((await block.boundingBox())!.width).toBeLessThan(initial!.width - 100);
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect((await block.boundingBox())!.width).toBeCloseTo(initial!.width, 0);
  await right.focus(); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  await options(page); await page.getByRole("button", { name: "Align right", exact: true }).click();
  await options(page); await page.getByRole("button", { name: "Edit caption", exact: true }).click();
  await page.getByRole("textbox", { name: "Image caption", exact: true }).fill("A subtle caption 日本語"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await saved(page)).notes[0].content.includes('data-width="90"')).toBe(true);
  await page.reload(); await expect(page.locator(".document-editor .image-block")).toHaveAttribute("data-align", "right");
  await expect(page.getByRole("textbox", { name: "Image caption", exact: true })).toHaveValue("A subtle caption 日本語");
});

test("image menu supports move, full-size preview, download, remove and Undo", async ({ page }) => {
  await open(page); await upload(page);
  await options(page); await page.getByRole("button", { name: "Move up", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes[0].content.startsWith("<figure")).toBe(true);
  await options(page); await page.getByRole("button", { name: "View full size", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Image preview", exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download image", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("board.png");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Image preview", exact: true })).toHaveCount(0);
  await options(page); await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(page.locator(".document-editor .note-image")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
});

test("backups preserve embedded images and strip external/SVG sources and executable attributes", async ({ page }) => {
  await open(page); await upload(page);
  await expect.poll(async () => (await saved(page)).notes[0].content.includes("data:image/png;base64")).toBe(true);
  const document = await saved(page);
  document.notes[0].content = document.notes[0].content.replace('<img ', '<img onerror="window.imageExploit=true" ') + '<img src="https://example.com/track.png"><img src="data:image/svg+xml;base64,PHN2Zz4=">';
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await expect.poll(async () => (await saved(page)).notes.length).toBe(2);
  const html = (await saved(page)).notes[1].content;
  expect(html).toContain("data:image/png;base64"); expect(html).not.toMatch(/onerror|example.com|svg\+xml/);
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
});

test("invalid and oversized images report errors, preserve good files and allow same-file selection again", async ({ page }) => {
  await open(page);
  await page.getByLabel("Image files", { exact: true }).setInputFiles([{ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("broken") }, await image(page)]);
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("bad.png");
  await page.getByLabel("Image files", { exact: true }).setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("exceeds 5 MB");
  await page.getByLabel("Image files", { exact: true }).setInputFiles(await image(page));
  await expect(page.locator(".document-editor .note-image")).toHaveCount(2);
});

test("dark narrow reduced-motion image blocks and actions stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { ...fixture, theme: "dark" });
  await page.getByRole("button", { name: "Close reference", exact: true }).click();
  await upload(page);
  await options(page); const popup = page.getByRole("dialog", { name: "Image actions", exact: true });
  await expect(popup).toBeVisible(); const bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(10); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(840);
  // offsetHeight rounds the popup's fractional CSS height to whole pixels.
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(591);
  expect(await popup.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  await page.screenshot({ path: "release/preview-image-block-dark.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("pointer resize commits on release and moving an image by its drag handle preserves one block", async ({ page }) => {
  await open(page); await upload(page);
  const frame = page.locator(".document-editor .image-block-frame"); await frame.hover();
  const handle = await page.locator(".document-editor").getByRole("button", { name: "Resize image from right" }).boundingBox();
  await page.mouse.move(handle!.x + 12, handle!.y + handle!.height / 2); await page.mouse.down();
  await page.mouse.move(handle!.x - 70, handle!.y + handle!.height / 2); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).notes[0].content.match(/data-width="([^"]+)"/)?.[1]).not.toBe("100");
  await page.locator(".document-editor .image-drag-handle").dragTo(page.locator('.document-editor [contenteditable="true"] > p').first(), { targetPosition: { x: 1, y: 1 } });
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
  await expect.poll(async () => (await saved(page)).notes[0].content.startsWith("<figure")).toBe(true);
});

test("image insertion succeeds when the notebook exceeds the former total quota", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Requires interception of the Vite source storage module.");
  await page.addInitScript((document) => {
    document.notes.push({ ...document.notes[0], id: "large", folderId: "other", title: "Capacity", content: "" });
    const overhead = new TextEncoder().encode(JSON.stringify(document)).length;
    document.notes[1].content = "x".repeat(20 * 1024 * 1024 - overhead - 100);
    (window as any).imageCapacityDocument = document;
  }, fixture);
  await page.route(/\/src\/storage\.ts(?:\?.*)?$/, (route) => route.fulfill({ contentType: "text/javascript", body: `
    export const desktop = false;
    export async function loadWorkspace() { return {revision:1,document:window.imageCapacityDocument,dataPath:'Native-size test'}; }
    export async function saveWorkspace(document) { window.imageCapacityDocument = document; return 2; }
    export function downloadFile() {}
    export async function exportArtifact() { return true; }
  ` }));
  await page.goto("/"); await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Image files", { exact: true }).setInputFiles(await image(page));
  await expect(page.locator(".document-editor .note-image")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).imageCapacityDocument.notes[0].content.includes("data-notify-image"))).toBe(true);
});

test("mixed image and text drops retain both files as independent notes", async ({ page }) => {
  await open(page);
  const file = await image(page);
  const transfer = await page.evaluateHandle((base64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "board.png", { type: "image/png" }));
    dt.items.add(new File(["Document accompanying the image"], "details.txt", { type: "text/plain" }));
    return dt;
  }, file.buffer.toString("base64"));
  await page.locator('.document-editor [contenteditable="true"]').dispatchEvent("drop", { dataTransfer: transfer });
  await expect.poll(async () => (await saved(page)).notes.length).toBe(3);
  const notes = (await saved(page)).notes;
  expect(notes[0].content).toBe(fixture.notes[0].content);
  expect(notes[1].content).toContain("data:image/png;base64");
  expect(notes[2].content).toContain("Document accompanying the image");
});

test("image backups above the ordinary text character limit still import", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Requires dynamic import of the Vite source import module.");
  await open(page);
  const file = await image(page);
  // Valid PNGs may include trailing application data; keep the header and
  // decoded picture valid while exercising a realistic backup byte size.
  const source = `data:image/png;base64,${Buffer.concat([file.buffer, Buffer.alloc(1_600_000)]).toString("base64")}`;
  const content = `<figure data-notify-image=""><img src="${source}" alt="Large embedded image"></figure>`;
  const backup = { ...fixture, notes: [{ ...fixture.notes[0], content }] };
  const result = await page.evaluate(async (backup) => {
    const { parseImportFile } = await import("/src/importFiles.ts");
    const parsed = await parseImportFile(new File([JSON.stringify(backup)], "images.json", { type: "application/json" }));
    return { kind: parsed.kind, length: parsed.kind === "backup" ? parsed.backup.notes[0].content.length : 0 };
  }, backup);
  expect(result.kind).toBe("backup"); expect(result.length).toBeGreaterThan(2_000_000);
});

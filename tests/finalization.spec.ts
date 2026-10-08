import { boardCommand } from './boardCommandHelper';
import { test, expect, type Page } from "@playwright/test";
import { emptyBoard, boardFromScene, validateBoard } from "../src/boardData";
import type { Workspace } from "../src/types";
import { readFile } from "node:fs/promises";
import { validateWorkspace } from "../src/workspaceValidation";

test.setTimeout(60_000);
const key = "still-notes-browser-v1";
const fixture: Workspace = { schemaVersion: 2, folders: [{ id: "work", name: "Work" }], theme: "light", activeId: "note", referenceId: null, notes: [
  { id: "note", folderId: "work", title: "Writing", content: "<p>Saved writing.</p>", archived: false, createdAt: "2026-10-01", updatedAt: "2026-10-01" },
  { id: "board", folderId: "work", title: "Architecture", content: "", kind: "board", board: emptyBoard(), archived: false, createdAt: "2026-10-01", updatedAt: "2026-10-01" },
] };
async function seed(page: Page, doc = fixture, legacy?: unknown) {
  await page.addInitScript(({ document, draft, key }) => {
    if (sessionStorage.getItem("finalization-fixture")) return;
    localStorage.clear(); localStorage.setItem(key, JSON.stringify({ revision: 1, document, dataPath: "Finalization fixture" }));
    if (draft) localStorage.setItem("still-notes-recovery-v1", JSON.stringify({ revision: 1, document: draft }));
    sessionStorage.setItem("finalization-fixture", "1");
  }, { document: doc, draft: legacy, key });
  await page.goto("/");
}

test("damaged legacy recovery leaves the valid saved notebook editable and retains the draft", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" });
  const document = { ...fixture, theme: "dark" as const };
  await seed(page, document, { ...document, folders: null });
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Saved writing.");
  await expect(page.locator(".storage-error")).toContainText(/draft|recovery/i);
  await expect(page.locator(".storage-error").getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  const retry = await page.locator(".storage-error").getByRole("button", { name: "Retry", exact: true }).boundingBox();
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".storage-error"),
    { x: retry!.x + retry!.width / 2, y: retry!.y + retry!.height / 2 })).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("still-notes-recovery-v1-conflict-")))).toBe(true);
  await page.screenshot({ path: "release/finalization-recovery-dark-1.1.2.png" });
});

test("deleting a board image frees saved file data while session Undo restores it", async ({ page }) => {
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=";
  const board = { ...emptyBoard(), files: { pixel: { id: "pixel", mimeType: "image/png", created: 1, dataURL: pixel } }, elements: [{
    id: "image", type: "image", x: 300, y: 260, width: 80, height: 80, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0,
    opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
    fileId: "pixel", status: "saved", scale: [1, 1], crop: null,
  }] };
  const doc = structuredClone(fixture); doc.activeId = "board";
  (doc.notes[1] as any).board = board;
  await seed(page, doc);
  await expect(page.locator(".board-canvas canvas").last()).toBeVisible();
  const canvas = await page.locator(".board-canvas canvas").last().boundingBox();
  await page.mouse.click(canvas!.x + 340, canvas!.y + 300); await page.keyboard.press("Delete");
  await expect.poll(() => page.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key)!).document.notes[1].board.files).length, key)).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.notes[1].board.files.pixel?.dataURL, key)).toBe(pixel);
});

test("unsupported recovery cannot overwrite the saved notebook on blur", async ({ page }) => {
  await seed(page, fixture, { ...fixture, schemaVersion: 99 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Saved writing.");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.schemaVersion, key)).toBe(2);
});

test("browser stale-save conflict retains both the saved copy and unsaved draft", async ({ page, context }) => {
  await seed(page); await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  await expect(page.locator(".save-state.saving")).toHaveCount(0);
  await expect(page.locator(".storage-error")).toHaveCount(0);
  const baselineRevision = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).revision, key);
  const other = await context.newPage(); await other.goto("/");
  await expect(other.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Note content", exact: true }).fill("First window saved.");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).revision, key)).toBe(baselineRevision + 1);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.notes[0].content, key)).toContain("First window saved.");
  await other.getByRole("textbox", { name: "Note content", exact: true }).fill("Second window draft.");
  await other.keyboard.press("Control+s");
  await expect(other.locator(".storage-error")).toContainText("changed elsewhere");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.notes[0].content, key)).toContain("First window saved.");
  expect(await other.evaluate(() => Object.values(localStorage).some((s) => s.includes("Second window draft.")))).toBe(true);
  await other.close();
});

test("missing clipboard provides Mermaid copy fallback without an uncaught error", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await seed(page, { ...fixture, activeId: "board" });
  await boardCommand(page, 'Import Mermaid\u2026');
  await page.getByRole("button", { name: "Preview drawing", exact: true }).click();
  await expect(page.locator(".board-preview-image svg")).toBeVisible();
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  await boardCommand(page, 'Mermaid\u2026');
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/Clipboard unavailable/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("Mermaid file reading cannot preview the previous source or create stale content", async ({ page }) => {
  await seed(page, { ...fixture, activeId: "board" });
  await boardCommand(page, 'Import Mermaid\u2026');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () { return new Promise((resolve, reject) => setTimeout(() => original.call(this).then(resolve, reject), 1500)); };
  });
  await page.locator('.board-create-dialog input[type="file"]').setInputFiles({ name: "Chosen.mmd", mimeType: "text/plain", buffer: Buffer.from('flowchart LR\n chosen["Chosen content"]') });
  await expect(page.getByRole("button", { name: "Preview drawing", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Mermaid flowchart")).toContainText("Chosen content");
  await expect(page.getByRole("button", { name: "Preview drawing", exact: true })).toBeEnabled();
});

test("failed board-dialog chunk keeps the current notebook available with a dismissible error", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Development route failure injection");
  await page.route("**/src/CreateBoardDialog.tsx*", (route) => route.abort("failed"));
  await seed(page, { ...fixture, activeId: "board" });
  await boardCommand(page, 'Import Mermaid\u2026');
  await expect(page.getByRole("dialog").getByText(/could not open/i)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".note-select").filter({ hasText: "Writing" }).click();
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Saved writing.");
});

test("failed canvas recovery reports export errors and retries a portable drawing", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Development route failure injection");
  await page.route("**/src/BoardEditor.tsx*", (route) => route.abort("failed"));
  await seed(page, { ...fixture, activeId: "board" });
  await expect(page.getByText("The drawing editor could not open. Your board is retained.")).toBeVisible();
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => { URL.createObjectURL = original; throw Error("Injected download failure"); };
  });
  await page.getByRole("button", { name: "Export board recovery" }).click();
  await expect(page.getByText(/Recovery export failed/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export board recovery" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Board-recovery.excalidraw");
  expect(boardFromScene(JSON.parse(await readFile((await file.path())!, "utf8")))).toEqual(emptyBoard());
  expect(errors).toEqual([]);
});

test("unsupported saved documents remain untouched after an automatic save trigger", async ({ page }) => {
  const unsupported = { ...fixture, schemaVersion: 99 } as unknown as Workspace;
  await seed(page, unsupported);
  await expect(page.getByText("Your notebook couldn’t open.")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document, key)).toEqual(unsupported);
});

test("failed move/delete mutations keep writing and confirmation until a successful retry", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Development hook fault injection");
  await page.route(/\/src\/useWorkspace\.ts(?:\?.*)?$/, (route) => route.request().url().includes("original=1") ? route.continue() : route.fulfill({ contentType: "text/javascript", body: `
    import { useWorkspace as original } from '/src/useWorkspace.ts?original=1';
    export function useWorkspace() {
      const result = original();
      return {...result, update(updater) {
        if (window.rejectMutation) throw Error('Injected mutation failure');
        return result.update(updater);
      }};
    }
  ` }));
  await seed(page); await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(() => { (window as any).rejectMutation = true; });
  await page.locator(".note-select").filter({ hasText: "Writing" }).focus(); await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByText("Move could not be applied. Resolve the notebook save error and retry.")).toBeAttached();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.notes[0].id, key)).toBe("note");
  await page.evaluate(() => { (window as any).rejectMutation = false; });
  await page.getByRole("button", { name: "Note options", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await page.evaluate(() => { (window as any).rejectMutation = true; });
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/Change could not be applied/)).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.notes.length, key)).toBe(2);
  await page.evaluate(() => { (window as any).rejectMutation = false; });
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).document.notes.length, key)).toBe(1);
  expect(errors).toEqual([]);
});

test("saved document and board label validation reject fields that crash renderers", () => {
  expect(() => validateWorkspace({ ...fixture, folders: null })).toThrow("structure");
  expect(() => validateWorkspace({ ...fixture, notes: [...fixture.notes, fixture.notes[0]] })).toThrow("item");
  const frame = { id: "frame", type: "frame", name: 42, x: 0, y: 0, width: 100, height: 100, isDeleted: false };
  expect(() => validateBoard({ ...emptyBoard(), elements: [frame] })).toThrow("label");
});

test("note capacity guard rejects an oversized transaction while preserving typing and undo", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Isolated development editor harness");
  await seed(page);
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // Use the actual transformed entry, independent of optimizer cache naming.
    const source = await (await fetch("/src/main.tsx")).text();
    const react = source.match(/["']([^"']+\/deps\/react\.js[^"']*)["']/)?.[1];
    const reactDOM = source.match(/["']([^"']+\/deps\/react-dom_client\.js[^"']*)["']/)?.[1];
    if (!react || !reactDOM) throw Error("Editor harness could not resolve the development runtime.");
    const { default: React } = await import(react);
    const { default: ReactDOM } = await import(reactDOM);
    const { NoteEditor } = await import("/src/NoteEditor.tsx");
    const host = document.createElement("section"); host.id = "capacity-harness"; document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(NoteEditor, { content: "<p>Kept</p>", validateContent: (html: string) => {
      if (html.length > 80) throw Error("Notebook capacity reached in test.");
    } }));
  });
  const host = page.locator("#capacity-harness");
  const editor = host.getByRole("textbox", { name: "Note content", exact: true });
  await editor.click(); await page.keyboard.press("End"); await page.keyboard.type(" safe");
  await expect(editor).toContainText("Kept safe");
  await page.evaluate(() => {
    const target = document.querySelector('#capacity-harness [contenteditable="true"]')!;
    const data = new DataTransfer(); data.setData("text/plain", "x".repeat(100));
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(host.getByRole("alert")).toContainText("Notebook capacity reached");
  await expect(editor).toHaveText("Kept safe");
  await page.keyboard.press("Control+z"); await expect(editor).toHaveText("Kept");
});

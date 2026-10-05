import { boardCommand } from './boardCommandHelper';
import { test, expect, type Page } from "@playwright/test";
import { emptyBoard, portableBoard, validateBoard, boardFromScene, type BoardData } from "../src/boardData";
import { boardToMermaid } from "../src/boardMermaid";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Workspace } from "../src/types";
import { RecoveryJournal } from "../src/recovery";
import { newNoteContent } from "../src/newNoteContent";
import { readFile, readdir } from "node:fs/promises";

const shape = (id: string, type = "rectangle", extra = {}): ExcalidrawElement => ({ id, type, x: 120, y: 110, width: 180, height: 80,
  angle: 0, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 0,
  opacity: 100, groupIds: [], frameId: null, roundness: null, seed: id.length * 3423, version: 1, versionNonce: 1, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false, index: null, ...extra }) as ExcalidrawElement;
const label = (id: string, owner: string, text: string, x = 135) => shape(id, "text", { text, originalText: text, containerId: owner, fontFamily: 2, fontSize: 20, lineHeight: 1.25, textAlign: "center", verticalAlign: "middle", autoResize: true, x, y: 132, width: 150, height: 30, backgroundColor: "transparent" });
const connection = (id: string, from: string | null, to: string | null, extra = {}) => shape(id, "arrow", { x: 300, y: 150, width: 160, height: 0, points: [[0, 0], [160, 0]], startBinding: from ? { elementId: from, focus: 0, gap: 4 } : null, endBinding: to ? { elementId: to, focus: 0, gap: 4 } : null, startArrowhead: null, endArrowhead: "arrow", elbowed: false, ...extra });
export const architectureFixture: BoardData = { ...emptyBoard(), elements: [
  shape("source", "rectangle", { boundElements: [{ id: "source-label", type: "text" }, { id: "edge", type: "arrow" }] }), label("source-label", "source", "Oracle 12c"),
  shape("target", "rectangle", { x: 460, boundElements: [{ id: "target-label", type: "text" }, { id: "edge", type: "arrow" }] }), label("target-label", "target", "SQL Server", 475), connection("edge", "source", "target"),
] };
const fixture: Workspace = { folders: [{ id: "work", name: "Work", copyLastNote: true }, { id: "data", name: "Data" }], activeId: "board", referenceId: "note", theme: "light", schemaVersion: 2, notes: [
  { id: "note", folderId: "work", title: "Reference guide", content: "<p>Existing writing remains here.</p>", archived: false, createdAt: "2026-10-01", updatedAt: "2026-10-01" },
  { id: "board", folderId: "work", title: "Replication architecture", content: "", kind: "board", board: architectureFixture, archived: false, createdAt: "2026-10-02", updatedAt: "2026-10-02" },
] };
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document as Workspace);
async function open(page: Page, doc = fixture) {
  await page.addInitScript((document) => { if (!sessionStorage.getItem("board-fixture")) { localStorage.clear(); localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Board test" })); sessionStorage.setItem("board-fixture", "1"); } }, doc);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".board-canvas canvas").first()).toBeVisible();
}

test("conversion keeps topology, stable identity, quoted labels and parallel/reverse edges", () => {
  const result = boardToMermaid({ ...architectureFixture, elements: [...architectureFixture.elements, connection("reverse", "source", "target", { startArrowhead: "arrow", endArrowhead: null }), connection("double", "source", "target", { startArrowhead: "arrow" })] });
  expect(result.nodes).toBe(2); expect(result.edges).toBe(3); expect(result.issues).toEqual([]);
  expect(result.code).toContain('<-->'); expect(result.code).toContain('["Oracle 12c"]');
  const renamed = { ...architectureFixture, elements: architectureFixture.elements.map((e) => e.type === "text" ? { ...e, text: '日本語 "end" | [data] & #' } : e) };
  const code = boardToMermaid(renamed).code;
  expect(code).toContain("#quot;end#quot;"); expect(code).toContain("#124;"); expect(code).toContain("#38;"); expect(code).toContain("#35;");
  expect(code.split("\n").at(-1)).toBe(boardToMermaid(architectureFixture).code.split("\n").at(-1));
});

test("boundaries are explicit; detached and deleted connections are diagnosed", () => {
  const boundary = shape("server", "rectangle", { x: 80, y: 50, width: 650, height: 260, customData: { notifyArchitecture: { version: 1, role: "boundary" } } });
  const board = { ...architectureFixture, elements: [...architectureFixture.elements.map((e) => e.id === "source" ? { ...e, customData: { notifyArchitecture: { version: 1, role: "component", parentId: "server" } } } : e), boundary, label("server-label", "server", "Server A"), connection("dangling", "source", null)] };
  const result = boardToMermaid(board);
  expect(result.nodes).toBe(2); expect(result.code).toContain("subgraph"); expect(result.omitted).toBe(1); expect(result.issues).toHaveLength(1);
  const deleted = { ...board, elements: board.elements.map((e) => e.id === "target" ? { ...e, isDeleted: true } : e) };
  expect(boardToMermaid(deleted).omitted).toBe(2);
});

test("board validation and portable export retain files and reject future or executable content", () => {
  expect(() => validateBoard(architectureFixture)).not.toThrow();
  expect(boardFromScene(portableBoard(architectureFixture))).toEqual(architectureFixture);
  expect(() => validateBoard({ ...architectureFixture, schemaVersion: 9 })).toThrow();
  expect(() => validateBoard({ ...architectureFixture, elements: [shape("unsafe", "embeddable")] })).toThrow();
  expect(() => validateBoard({ ...architectureFixture, elements: [shape("unsafe", "rectangle", { link: "javascript:alert(1)" })] })).toThrow();
  expect(newNoteContent(fixture, "work")).toBe(fixture.notes[0].content);
});

test("mixed boards and notes recover atomically with legacy format", () => {
  class Store { data = new Map<string, string>(); get length() { return this.data.size; } key(i: number) { return [...this.data.keys()][i] || null; } getItem(k: string) { return this.data.get(k) || null; } setItem(k: string, v: string) { this.data.set(k, v); } removeItem(k: string) { this.data.delete(k); } }
  const store = new Store(); new RecoveryJournal(store).write(fixture, 3, true);
  expect(new RecoveryJournal(store).restore(null, 3).document).toEqual(fixture);
});

test("board opens offline with its tools; Mermaid renders and copies without Markdown fences", async ({ page, context }) => {
  const external: string[] = []; page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().includes("127.0.0.1")) external.push(r.url()); });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await open(page);
  await page.evaluate(() => { const write = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (text) => { (window as unknown as { copied: string }).copied = text; return write(text); }; });
  await boardCommand(page, 'Mermaid\u2026');
  await expect(page.getByLabel("Mermaid preview").locator("svg")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("dialog").getByText("Copied Mermaid. Paste onto your Miro board. Miro arranges the shapes; logos stay in this drawing.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toMatch(/^flowchart LR\n/);
  expect(external).toEqual([]);
  await page.screenshot({ path: "test-results/boards-mermaid-light.png" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: "test-results/boards-editor-light.png" });
});

test("dark minimum-size board retains canvas across panel changes, exposes styling and exports PNG", async ({ page }) => {
  const doc = structuredClone(fixture); doc.theme = "dark";
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" }); await open(page, doc);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  const canvas = page.locator(".board-canvas canvas").last(); const original = await canvas.elementHandle();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  expect(await original!.evaluate((el) => el.isConnected)).toBe(true);
  // Reference overlays the editor at minimum width; dismiss it before editing.
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByText("Stroke width", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/boards-editor-dark-minimum.png" });
  const download = page.waitForEvent("download"); await boardCommand(page, 'PNG image');
  expect((await readFile((await (await download).path())!)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await boardCommand(page, 'Mermaid\u2026');
  await expect(page.getByLabel("Mermaid preview").locator("svg")).toBeVisible({ timeout: 30000 });
  const modal = await page.getByRole("dialog", { name: "Export flowchart" }).boundingBox(); expect(modal!.x).toBeGreaterThanOrEqual(0); expect(modal!.x + modal!.width).toBeLessThanOrEqual(850);
  await page.screenshot({ path: "test-results/boards-mermaid-dark-minimum.png" });
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Export flowchart" })).toHaveCount(0);
});

test("scene import preserves images and explicit boundaries through drawing export and Mermaid preview", async ({ page }) => {
  await open(page);
  const board = structuredClone(architectureFixture);
  board.files = { pixel: { id: "pixel", mimeType: "image/png", created: 1, dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=" } } as BoardData["files"];
  board.elements = [...board.elements.map((e) => e.id === "source" ? { ...e, customData: { notifyArchitecture: { version: 1, role: "component", parentId: "server" } } } : e),
    shape("server", "frame", { x: 80, y: 50, width: 300, height: 230, name: "Server A", customData: { notifyArchitecture: { version: 1, role: "boundary" } } }),
    shape("image", "image", { fileId: "pixel", status: "saved", scale: [1, 1], crop: null, x: 50, y: 350, width: 20, height: 20 })];
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Imported.excalidraw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(portableBoard(board))) });
  await expect(page.getByLabel("Board title")).toHaveValue("Imported");
  await boardCommand(page, 'Mermaid\u2026');
  await expect(page.getByLabel("Mermaid preview").locator("svg")).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("Mermaid code")).toContainText('subgraph n_73_65_72_76_65_72["Server A"]');
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const download = page.waitForEvent("download"); await boardCommand(page, 'Drawing (.excalidraw)');
  const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(exported.elements.find((e: ExcalidrawElement) => e.id === "source").customData.notifyArchitecture.parentId).toBe("server");
  expect(exported.files.pixel.dataURL).toBe(board.files.pixel.dataURL);
});

test("drawing edits survive immediate note switch, reload and backup", async ({ page }) => {
  await open(page);
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  const canvas = await page.locator(".board-canvas canvas").last().boundingBox(); expect(canvas).toBeTruthy();
  await page.mouse.move(canvas!.x + 360, canvas!.y + 280); await page.mouse.down(); await page.mouse.move(canvas!.x + 520, canvas!.y + 370, { steps: 5 }); await page.mouse.up();
  await page.locator(".note-select").filter({ hasText: "Reference guide" }).click();
  await expect(page.getByRole("textbox", { name: "Note content" })).toContainText("Existing writing remains here.");
  await expect.poll(async () => (await saved(page)).notes.find((n) => n.id === "board")?.board?.elements.length).toBeGreaterThan(5);
  await page.reload(); await expect(page.getByRole("textbox", { name: "Note content" })).toBeVisible();
  await page.locator(".note-select").filter({ hasText: "Replication architecture" }).click(); await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await boardCommand(page, 'Drawing (.excalidraw)');
  expect((await download).suggestedFilename()).toBe("Replication architecture.excalidraw");
});

test("new board, folder creation, duplicate, archive/restore and reference isolation", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00"));
  await open(page);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy to current note" })).toBeDisabled();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Work · Oct 2, 2026");
  await page.getByLabel("Board title").fill("New architecture");
  await page.getByRole("button", { name: "Board options", exact: true }).click(); await page.getByRole("button", { name: "Duplicate board" }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("New architecture (copy)");
  await page.getByRole("button", { name: "Board options", exact: true }).click(); await page.getByRole("button", { name: "Archive board", exact: true }).click();
  await page.locator(".sidebar-bottom button").filter({ hasText: "Archive" }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("New architecture (copy)");
  await page.getByRole("button", { name: "Restore board", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("New architecture (copy)");
});

test("conversion warns instead of inventing relationships; reviewed partial export is explicit", async ({ page }) => {
  const doc = structuredClone(fixture); doc.notes[1].board!.elements = [...architectureFixture.elements, connection("unbound", "source", null)];
  await open(page, doc); await boardCommand(page, 'Mermaid\u2026');
  await expect(page.getByRole("button", { name: "Copy code" })).toBeDisabled();
  await expect(page.getByText(/1 omitted connections/)).toBeVisible();
  await page.getByRole("checkbox", { name: /Export this reviewed draft/ }).check(); await expect(page.getByRole("button", { name: "Copy code" })).toBeEnabled();
});

test("architecture role and boundary controls persist; duplicated groups keep their own membership", async ({ page }) => {
  await open(page); await page.getByRole("button", { name: "Reference", exact: true }).click();
  const canvas = page.locator(".board-canvas canvas").last(); let bounds = await canvas.boundingBox();
  await page.mouse.click(bounds!.x + 200, bounds!.y + 150);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Boundary", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes[1].board!.elements.find((e) => e.id === "source")?.customData?.notifyArchitecture.role).toBe("boundary");
  bounds = await canvas.boundingBox(); await page.mouse.click(bounds!.x + 550, bounds!.y + 150);
  await page.getByRole("combobox", { name: "Architecture boundary" }).click();
  await page.getByRole("option", { name: "Oracle 12c", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes[1].board!.elements.find((e) => e.id === "target")?.customData?.notifyArchitecture.parentId).toBe("source");
  bounds = await canvas.boundingBox(); await page.mouse.click(bounds!.x + 550, bounds!.y + 150);
  await page.keyboard.press("Control+a"); await page.keyboard.press("Control+d");
  await expect.poll(async () => (await saved(page)).notes[1].board!.elements.filter((e) => !e.isDeleted).length).toBe(10);
  const elements = (await saved(page)).notes[1].board!.elements;
  const copy = elements.find((e) => e.id !== "target" && e.customData?.notifyArchitecture.role === "component")!;
  expect(copy.customData?.notifyArchitecture.parentId).not.toBe("source");
  expect(elements.find((e) => e.id === copy.customData?.notifyArchitecture.parentId)?.customData?.notifyArchitecture.role).toBe("boundary");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).notes[1].board!.elements.filter((e) => !e.isDeleted).length).toBe(5);
});

test("failed board persistence retains the draft and retry saves the drawing", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    (window as unknown as { boardSaveFailure: boolean }).boardSaveFailure = true;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if ((window as unknown as { boardSaveFailure: boolean }).boardSaveFailure && key === 'still-notes-browser-v1') throw Error('Simulated disk failure');
      return set.call(this, key, value);
    };
  });
  await boardCommand(page, 'Mermaid\u2026');
  await page.getByRole("combobox", { name: "Diagram direction" }).click(); await page.getByRole("option", { name: "Top to bottom", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".save-state")).toContainText("Save failed", { timeout: 10000 });
  await expect(page.getByText(/Simulated disk failure/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-recovery-v2")!).dirty)).toBe(true);
  await page.evaluate(() => { (window as unknown as { boardSaveFailure: boolean }).boardSaveFailure = false; });
  await page.locator(".save-state").click(); await expect(page.locator(".save-state")).toContainText("Saved in browser");
  expect((await saved(page)).notes[1].board!.exportDirection).toBe("TB");
});

test("production security policy permits local sketch-font SVG export without remote requests", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW !== "1", "Runs against production assets with the desktop CSP.");
  const policy = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8")).app.security.csp;
  await page.route("**/", async (route) => { const response = await route.fetch(); await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } }); });
  const errors: string[] = [], remote: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().includes("127.0.0.1")) remote.push(request.url()); });
  const doc = structuredClone(fixture); doc.notes[1].board!.elements = doc.notes[1].board!.elements.map((e) => e.type === "text" ? { ...e, fontFamily: 5 } : e);
  await open(page, doc);
  const download = page.waitForEvent("download"); await boardCommand(page, 'SVG image');
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain("@font-face"); expect(svg).toContain("data:font/woff2;base64,");
  expect(remote).toEqual([]); expect(errors).toEqual([]);
});

test("ordinary note startup defers the production drawing bundle until a board is opened", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW !== "1", "Checks production chunk requests.");
  // Shared lazy entry points may rename the engine chunk. Locate its actual
  // canvas surface rather than assuming Rollup's output filename.
  const engineAssets: string[] = [];
  for (const file of await readdir("dist/assets")) if (file.endsWith(".js") && (await readFile(`dist/assets/${file}`, "utf8")).includes("excalidraw__canvas")) engineAssets.push(`/assets/${file}`);
  expect(engineAssets.length).toBeGreaterThan(0);
  const requests: string[] = []; page.on("request", (request) => requests.push(request.url()));
  const doc = structuredClone(fixture); doc.activeId = "note";
  await page.addInitScript((document) => { localStorage.clear(); localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Lazy board test" })); }, doc);
  await page.goto("/"); await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Existing writing remains here.");
  expect(requests.filter((url) => engineAssets.some((asset) => url.endsWith(asset)))).toEqual([]);
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await expect(page.locator(".board-canvas canvas").first()).toBeVisible();
  expect(requests.some((url) => engineAssets.some((asset) => url.endsWith(asset)))).toBe(true);
});

import { boardCommand } from './boardCommandHelper';
import { test, expect, type Page } from "@playwright/test";
import { emptyBoard, boardFromScene, portableBoard, type BoardData } from "../src/boardData";
import { boardToMermaid, canAssignBoundary } from "../src/boardMermaid";
import { normalizeMermaidInput } from "../src/boardMermaidImport";
import { boardTemplates } from "../src/boardTemplates";
import type { Workspace } from "../src/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { readFile } from "node:fs/promises";
test.setTimeout(60_000);

const fixture: Workspace = { schemaVersion: 2, folders: [{ id: "work", name: "Work" }], activeId: "board", referenceId: null, theme: "light", notes: [
  { id: "note", title: "Writing", folderId: "work", content: "<p>Keep this text.</p>", createdAt: "2026-10-01", updatedAt: "2026-10-01", archived: false },
  { id: "board", title: "Original board", folderId: "work", content: "", kind: "board", board: { ...emptyBoard(), appState: { viewBackgroundColor: "#ffffff", gridSize: 20 } }, createdAt: "2026-10-01", updatedAt: "2026-10-01", archived: false },
] };
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document as Workspace);
async function open(page: Page, doc = fixture) {
  await page.addInitScript((document) => { if (!sessionStorage.getItem("extension-fixture")) { localStorage.clear(); localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Board extensions" })); sessionStorage.setItem("extension-fixture", "1"); } }, doc);
  await page.goto("/"); await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeVisible({ timeout: 30000 });
}
async function importCode(page: Page, code: string, title: string) {
  await boardCommand(page, 'Import Mermaid\u2026');
  const dialog = page.getByRole("dialog", { name: "Import Mermaid", exact: true });
  await dialog.getByRole("textbox", { name: "Board title" }).fill(title);
  await dialog.getByRole("textbox", { name: "Mermaid flowchart" }).fill(code);
  await dialog.getByRole("button", { name: "Preview drawing" }).click();
  await expect(dialog.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page.getByLabel("Board title", { exact: true })).toHaveValue(title);
  await expect.poll(async () => (await saved(page)).notes.length).toBeGreaterThan(2);
}

test("nested boundaries export hierarchically; cycles and missing parents have repair diagnostics", () => {
  const shape = (id: string, parentId?: string) => ({ id, type: "frame", isDeleted: false, name: id, customData: { notifyArchitecture: { version: 1, role: "boundary", parentId } } }) as ExcalidrawElement;
  const outer = shape("region"), inner = shape("cluster", "region");
  const board = { ...emptyBoard(), elements: [outer, inner] };
  expect(boardToMermaid(board).code).toMatch(/subgraph.*region.*\n\s{4}subgraph/s);
  expect(canAssignBoundary(board.elements, ["region"], "cluster")).toBe(false);
  expect(canAssignBoundary(board.elements, ["cluster"], "region")).toBe(true);
  const cycle = boardToMermaid({ ...board, elements: [shape("region", "cluster"), inner] });
  expect(cycle.issues.filter((i) => /cycle/.test(i.message))).toHaveLength(2);
  expect(cycle.code.match(/subgraph/g)).toHaveLength(2);
  expect(boardToMermaid({ ...board, elements: [shape("region", "missing"), inner] }).issues.some((i) => /missing parent/.test(i.message))).toBe(true);
});

test("Mermaid source validation accepts fences and rejects unsafe or unsupported content", () => {
  expect(normalizeMermaidInput('```mermaid\nflowchart LR\n A --> B\n```')).toBe("flowchart LR\n A --> B");
  for (const source of ["sequenceDiagram\nA->>B: hello", '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B', 'flowchart LR\nA["<img src=x>"]', "flowchart LR\nA-->B\nclick A callback", "flowchart LR\n" + "x".repeat(50001)]) expect(() => normalizeMermaidInput(source)).toThrow();
  expect(boardFromScene(portableBoard({ ...emptyBoard(), exportDirection: "BT" })).exportDirection).toBe("BT");
});

test("frames require an explicit boundary role before nesting and cannot form a cycle", async ({ page }) => {
  const doc = structuredClone(fixture);
  const frame = (id: string, name: string, x: number, y: number, width: number, height: number, boundary: boolean) => ({
    id, name, type: "frame", x, y, width, height, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 12, version: 1, versionNonce: 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false, index: null,
    ...(boundary ? { customData: { notifyArchitecture: { version: 1, role: "boundary", sourceId: id } } } : {}),
  }) as ExcalidrawElement;
  doc.notes[1].board!.elements = [frame("region", "Region", 30, 30, 400, 350, true), frame("server", "Server", 120, 110, 180, 200, false)];
  await open(page, doc); await page.getByRole("button", { name: "Reference", exact: true }).click();
  const canvas = page.locator(".board-canvas canvas").last(); const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds!.x + 120, bounds!.y + 160); await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Architecture boundary" })).toBeDisabled();
  await page.getByRole("button", { name: "Boundary", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Architecture boundary" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Architecture boundary" }).click(); await page.getByRole("option", { name: "Region", exact: true }).click();
  await expect.poll(async () => (await saved(page)).notes[1].board!.elements.find((e) => e.id === "server")?.customData?.notifyArchitecture.parentId).toBe("region");
  expect((await saved(page)).notes[1].board!.elements.find((e) => e.id === "server")?.customData?.notifyArchitecture.role).toBe("boundary");
  await page.mouse.click(bounds!.x + 30, bounds!.y + 160);
  await page.getByRole("combobox", { name: "Architecture boundary" }).click();
  await expect(page.getByRole("option", { name: "Server", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "No boundary", exact: true })).toBeVisible();
});

test("Mermaid import retains nested membership, parallel connections, direction and original documents", async ({ page }) => {
  await open(page);
  await importCode(page, `flowchart TB
subgraph region["Region"]
  subgraph cluster["Cluster"]
    api["API"]
    worker["Worker"]
  end
  db["Database"]
end
api -->|request| worker
api -->|retry| worker
worker --> db`, "Nested architecture");
  const doc = await saved(page), board = doc.notes.at(-1)!.board!;
  expect(doc.notes.slice(0, 2)).toEqual(fixture.notes);
  expect(board.exportDirection).toBe("TB");
  expect(board.elements.find((e) => e.id === "cluster")?.customData?.notifyArchitecture.parentId).toBe("region");
  expect(board.elements.find((e) => e.id === "api")?.customData?.notifyArchitecture.parentId).toBe("cluster");
  expect(boardToMermaid(board).nodes).toBe(3); expect(boardToMermaid(board).edges).toBe(3); expect(boardToMermaid(board).issues).toEqual([]);
  await page.reload(); await expect(page.getByLabel("Board title", { exact: true })).toHaveValue("Nested architecture");
  await boardCommand(page, 'Mermaid\u2026');
  await expect(page.getByLabel("Mermaid preview").locator("svg")).toBeVisible({ timeout: 30000 });
});

test("every packaged architecture template previews and creates an independent folder board", async ({ page }) => {
  await open(page);
  for (const template of boardTemplates) {
    await boardCommand(page, 'Templates\u2026');
    const dialog = page.getByRole("dialog", { name: "Architecture templates" });
    await dialog.getByRole("combobox", { name: "Architecture template" }).click();
    await page.getByRole("option", { name: template.title, exact: true }).click();
    await dialog.getByRole("button", { name: "Preview drawing" }).click();
    await expect(dialog.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
    await dialog.getByRole("button", { name: "Create board", exact: true }).click();
    await expect(page.getByLabel("Board title", { exact: true })).toHaveValue(template.title);
    await expect.poll(async () => (await saved(page)).notes.some((n) => n.title === template.title && n.folderId === "work")).toBe(true);
    const result = boardToMermaid((await saved(page)).notes.find((n) => n.title === template.title)!.board!);
    expect(result.nodes).toBeGreaterThan(2); expect(result.edges).toBeGreaterThan(2); expect(result.issues).toEqual([]);
  }
});

test("invalid source and changed previews cannot create a board; cancellation preserves focus and canvas", async ({ page }) => {
  await open(page); const canvas = await page.locator(".board-canvas canvas").first().elementHandle();
  await boardCommand(page, 'Import Mermaid\u2026');
  const dialog = page.getByRole("dialog", { name: "Import Mermaid", exact: true });
  await dialog.getByRole("textbox", { name: "Mermaid flowchart" }).fill("flowchart LR\nA[broken");
  await dialog.getByRole("button", { name: "Preview drawing" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(dialog.getByRole("button", { name: "Create board", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Mermaid flowchart" }).fill("flowchart LR\nA-->B");
  await dialog.getByRole("button", { name: "Preview drawing" }).click(); await expect(dialog.getByRole("button", { name: "Create board", exact: true })).toBeEnabled({ timeout: 30000 });
  await dialog.getByRole("textbox", { name: "Mermaid flowchart" }).fill("flowchart LR\nA-->C");
  await expect(dialog.getByRole("button", { name: "Create board", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeFocused(); expect((await saved(page)).notes).toEqual(fixture.notes);
});

test("board Reference stays read-only beside writing and persists selection", async ({ page }) => {
  await open(page); await importCode(page, "flowchart LR\nclient[Client]-->api[API]", "Reference architecture");
  const referenceId = (await saved(page)).activeId;
  await page.getByRole("button", { name: "Actions for Reference architecture" }).click(); await page.getByRole("button", { name: "Show as reference" }).click();
  await page.getByRole("button", { name: "Writing", exact: true }).click();
  const reference = page.getByLabel("Reference panel");
  await expect(reference.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
  await expect(reference.getByRole("button", { name: "Copy to current note" })).toHaveCount(0); await expect(reference.locator("canvas")).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "Note content", exact: true }); await editor.click(); await page.keyboard.press("End"); await page.keyboard.type(" More writing.");
  await reference.getByRole("button", { name: "Zoom in preview" }).click(); await expect(reference.locator(".board-preview-image")).toHaveAttribute("style", /150%/);
  await expect.poll(async () => (await saved(page)).notes[0].content).toContain("More writing.");
  await page.reload();
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(reference.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
  expect((await saved(page)).referenceId).toBe(referenceId); await expect(editor).toContainText("More writing.");
  await page.screenshot({ path: "release/boards-reference-light-1.1.1.png" });
});

test("template preview fits the dark minimum viewport, preserves keyboard access and cancels immediately", async ({ page }) => {
  const doc = structuredClone(fixture); doc.theme = "dark";
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" }); await open(page, doc);
  await boardCommand(page, 'Templates\u2026');
  const dialog = page.getByRole("dialog", { name: "Architecture templates" });
  await dialog.getByRole("button", { name: "Preview drawing" }).click();
  await expect(dialog.locator(".board-preview-image svg")).toBeVisible({ timeout: 30000 });
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(850); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await dialog.getByRole("button", { name: "Create board", exact: true }).focus(); await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await page.screenshot({ path: "release/boards-template-dark-1.1.1.png" });
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeFocused();
  expect((await saved(page)).notes).toHaveLength(2);
});

test("Mermaid import preserves cycles, self-loops, disconnected nodes and quoted Unicode labels", async ({ page }) => {
  await open(page);
  await importCode(page, 'flowchart RL\nA["日本語 #quot;api#quot; #124; [data]"]\nB{Decision}\nC((Offline))\nA -->|request| B\nB --> A\nA -->|retry| A', "Graph cases");
  const board = (await saved(page)).notes.at(-1)!.board!;
  expect(board.exportDirection).toBe("RL"); const result = boardToMermaid(board);
  expect(result.nodes).toBe(3); expect(result.edges).toBe(3); expect(result.issues).toEqual([]); expect(result.code).toContain("日本語"); expect(result.code).toContain("#quot;");
  await boardCommand(page, 'Mermaid\u2026');
  await expect(page.getByLabel("Mermaid preview").locator("svg")).toBeVisible({ timeout: 30000 });
});

test("Mermaid files import into the chosen folder and export retains semantic metadata", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Options for Work" }).click(); await page.getByRole("button", { name: "Import files…", exact: true }).click();
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Imported pipeline.mmd", mimeType: "text/plain", buffer: Buffer.from(boardTemplates[1].code) });
  await expect(page.getByLabel("Board title", { exact: true })).toHaveValue("Imported pipeline", { timeout: 30000 });
  const download = page.waitForEvent("download"); await boardCommand(page, 'Drawing (.excalidraw)');
  const board = boardFromScene(JSON.parse(await readFile((await (await download).path())!, "utf8")));
  expect(boardToMermaid(board).edges).toBe(3); expect(boardToMermaid(board).issues).toEqual([]);
  await expect.poll(async () => (await saved(page)).notes.at(-1)?.folderId).toBe("work");
});

test("import preview remains offline under the production security policy", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW !== "1", "Checks bundled production assets and desktop policy.");
  const policy = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8")).app.security.csp;
  await page.route("**/", async (route) => { const response = await route.fetch(); await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } }); });
  const errors: string[] = [], remote: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().includes("127.0.0.1")) remote.push(r.url()); });
  await open(page); await importCode(page, boardTemplates[3].code, "Offline deployment");
  expect(remote).toEqual([]); expect(errors).toEqual([]);
});

import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Development-only isolated native service harnesses");
  await page.goto("/"); await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    // Match the app's live module identity after Vite HMR; a bare URL would
    // create a second attachment registry alongside its timestamped import.
    const source = await (await fetch("/src/workspaceSize.ts")).text();
    const path = source.match(/["'](\/src\/attachments\.ts[^"']*)["']/)?.[1];
    if (!path) throw Error("Attachment harness could not resolve the live module.");
    (window as any).attachmentModule = await import(path);
  });
});
async function runtime(page: Page) {
  await page.evaluate(async () => {
    const source = await (await fetch("/src/main.tsx")).text();
    const react = source.match(/["']([^"']+\/deps\/react\.js[^"']*)["']/)?.[1];
    const dom = source.match(/["']([^"']+\/deps\/react-dom_client\.js[^"']*)["']/)?.[1];
    const w = window as any; w.React = (await import(react!)).default; w.ReactDOM = (await import(dom!)).default;
  });
}
async function startup(page: Page, failRead = false) {
  await runtime(page);
  await page.evaluate(async (failRead) => {
    const w = window as any, { StartupSettings } = await import("/src/StartupSettings.tsx");
    const host = document.createElement("section"); host.id = "startup-harness"; host.style.cssText = "position:fixed;z-index:5000;top:100px;left:100px;width:490px;padding:24px;background:var(--panel);color:var(--fg)"; document.body.append(host);
    w.readCount = 0; w.writeCount = 0; w.failWrite = false; w.failRead = failRead;
    const service = { read: async () => { w.readCount++; if (w.failRead) throw Error("Startup check failed"); return false; }, write: async (value: boolean) => { w.writeCount++; if (w.failWrite) throw Error("Registration failed"); if (w.holdWrite) return new Promise(resolve => w.releaseWrite = () => resolve(value)); return value; } };
    w.startupRoot = w.ReactDOM.createRoot(host); w.startupRoot.render(w.React.createElement(StartupSettings, { available: true, service }));
  }, failRead);
  if (!failRead) await expect(page.locator("#startup-harness").getByRole("switch")).toBeEnabled();
}
const geometry = (page: Page) => page.locator("#startup-harness .settings-switch").evaluate(el => {
  const b = el.getBoundingClientRect(), thumb = el.firstElementChild!.getBoundingClientRect();
  return { left: thumb.left - b.left, right: b.right - thumb.right, position: thumb.left, width: b.width };
});
test("startup thumb stays inside the track across reversal, scaling, keyboard and live reduced motion", async ({ page }) => {
  await startup(page); const button = page.locator("#startup-harness").getByRole("switch");
  const initial = await geometry(page); expect(initial.left).toBeGreaterThan(2); expect(initial.right).toBeGreaterThan(initial.left);
  await button.focus(); await page.keyboard.press("Space"); await expect(button).toHaveAttribute("aria-checked", "true");
  await button.click(); await expect(button).toHaveAttribute("aria-checked", "false");
  await button.click(); await expect(button).toHaveAttribute("aria-checked", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await geometry(page)).right).toBeLessThan(5);
  await page.evaluate(() => document.documentElement.style.setProperty("--element-scale", "1.1"));
  await expect.poll(async () => (await geometry(page)).width).toBeGreaterThan(45);
  const checked = await geometry(page); expect(checked.left).toBeGreaterThan(checked.right); expect(checked.right).toBeGreaterThan(2);
  await button.click(); await expect(button).toHaveAttribute("aria-checked", "false");
  const off = await geometry(page); expect(off.left).toBeGreaterThan(2); expect(off.right).toBeGreaterThan(off.left);
  await button.click(); await expect(button).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "release/startup-switch-fixed.png" });
  await page.getByRole("button", { name: "Use dark mode", exact: true }).click();
  const dark = await geometry(page); expect(dark.right).toBeGreaterThan(2); expect(dark.left).toBeGreaterThan(dark.right);
  await page.screenshot({ path: "release/startup-switch-fixed-dark.png" });
});
test("startup commands report write failures, ignore focus refresh during writes and clean up on unmount", async ({ page }) => {
  await startup(page); const host = page.locator("#startup-harness"), button = host.getByRole("switch");
  await page.evaluate(() => { (window as any).failWrite = true; }); await button.click();
  await expect(host.getByRole("alert")).toContainText("Registration failed"); await expect(button).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => { const w = window as any; w.failWrite = false; w.holdWrite = true; }); await button.click();
  await expect(host.getByRole("status")).toHaveText("Updating Windows startup…");
  const reads = await page.evaluate(() => (window as any).readCount); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => (window as any).readCount)).toBe(reads);
  await page.evaluate(() => (window as any).releaseWrite()); await expect(button).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => { (window as any).startupRoot.unmount(); window.dispatchEvent(new Event("focus")); });
  expect(await page.evaluate(() => (window as any).readCount)).toBe(reads);
});
test("failed initial startup check offers retry without allowing an unknown registration to be changed", async ({ page }) => {
  await startup(page, true); const host = page.locator("#startup-harness");
  await expect(host.getByRole("alert")).toContainText("Startup check failed"); await expect(host.getByRole("switch")).toBeDisabled();
  await page.evaluate(() => { (window as any).failRead = false; }); await host.getByRole("button", { name: "Retry startup check" }).click();
  await expect(host.getByRole("switch")).toBeEnabled(); await expect(host.getByRole("alert")).toHaveCount(0);
});
test("image migration uses raw bytes, deduplicated references and portable backup; failure preserves the original", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const w = window as any; w.isTauri = true;
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(pixel.split(",")[1]), c => c.charCodeAt(0));
    const id = "a".repeat(64) + ".png"; let uploads = 0, fail = false;
    w.__TAURI_INTERNALS__ = { invoke: async (cmd: string, payload: any) => {
      if (cmd === "store_attachment") { if (fail) throw Error("Disk full"); if (!(payload instanceof Uint8Array)) throw Error("Non-binary upload"); uploads++; return { id, size: bytes.length }; }
      if (cmd === "read_attachment") return bytes.buffer;
      throw Error(cmd);
    }, convertFileSrc: (path: string) => "http://asset.localhost/" + encodeURIComponent(path) };
    const a = w.attachmentModule, { workspaceBytes } = await import("/src/workspaceSize.ts"), { validateWorkspace } = await import("/src/workspaceValidation.ts");
    a.configureAttachments("C:/Notify");
    const original = { theme: "light", activeId: "n", referenceId: null, folders: [], notes: [{ id: "n", title: "Photo", folderId: null, archived: false, createdAt: "now", updatedAt: "now", content: `<figure data-notify-image="" data-width="65" data-align="right"><img src="${pixel}" alt="Photo"><figcaption>Caption</figcaption></figure>` }] };
    const compact = a.attachmentSchema(await a.compactImages(original)); validateWorkspace(compact); const budget = workspaceBytes(compact);
    const backup = JSON.parse(await a.portableBackup(compact));
    fail = true; let rejected = false; try { await a.compactImages(original); } catch { rejected = true; }
    const originalPreserved = original.notes[0].content.includes(pixel);
    a.configureAttachments("C:/Notify", {}); let missingRejected = false; try { validateWorkspace(compact); } catch { missingRejected = true; }
    w.isTauri = false;
    return { schema: compact.schemaVersion, html: compact.notes[0].content, portable: backup.notes[0].content, portableVersion: backup.schemaVersion, uploads, originalPreserved, rejected, missingRejected, budget, portableBudget: new TextEncoder().encode(JSON.stringify(backup)).length };
  });
  expect(result.schema).toBe(3); expect(result.html).toContain("data-notify-attachment"); expect(result.html).not.toContain("data:image");
  expect(result.portable).toContain("data:image/png;base64,"); expect(result.portable).toContain("Caption"); expect(result.portable).not.toContain("data-notify-attachment");
  expect(result.portableVersion).toBe(2); expect(result.originalPreserved && result.rejected && result.missingRejected).toBe(true); expect(result.uploads).toBe(1);
  expect(result.budget).toBe(result.portableBudget);
});
test("delta save omits unchanged boards and only advances its baseline after an acknowledgement", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const w = window as any; w.isTauri = true;
    const doc = { theme: "light", activeId: "note", referenceId: null, folders: [], notes: [{ id: "note", content: "old" }, { id: "board", board: { files: { pixel: { dataURL: "x".repeat(2_000_000) } } } }] };
    const calls: any[] = []; let reject = false;
    w.__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => {
      if (cmd === "load_workspace") return { revision: 1, document: doc, dataPath: "C:/Notify", attachments: {} };
      calls.push({ cmd, args }); if (reject) throw Error("Save failed"); return args.revision + 1;
    } };
    const storage = await import("/src/storage.ts?native-performance-harness");
    const loaded = await storage.loadWorkspace(); const before = loaded.document!;
    const after = { ...before, notes: [{ ...before.notes[0], content: "new" }, before.notes[1]] };
    const ack = await storage.saveWorkspace(after, 1);
    const later = { ...after, notes: [{ ...after.notes[0], content: "latest" }, after.notes[1]] };
    reject = true; try { await storage.saveWorkspace(later, ack); } catch { /* retained */ }
    reject = false; await storage.saveWorkspace(later, ack);
    w.isTauri = false;
    return { commands: calls.map(c => c.cmd), changed: calls.map(c => c.args.delta.changed.map((n: any) => n.id)), revisions: calls.map(c => c.args.revision), payloadBytes: new TextEncoder().encode(JSON.stringify(calls[0].args)).length, fullBytes: new TextEncoder().encode(JSON.stringify(after)).length };
  });
  expect(result.commands).toEqual(["save_workspace_delta", "save_workspace_delta", "save_workspace_delta"]);
  expect(result.changed).toEqual([["note"], ["note"], ["note"]]); expect(result.revisions).toEqual([1, 2, 2]);
  expect(result.payloadBytes).toBeLessThan(1000); expect(result.fullBytes).toBeGreaterThan(2_000_000);
  await writeFile("release/performance-delta-measurement.json", JSON.stringify(result, null, 2));
});
test("capacity checks cache unchanged image-rich boards while retaining exact serialized byte accounting", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { workspaceBytes } = await import("/src/workspaceSize.ts");
    const board = { id: "board", content: "", board: { files: { image: "x".repeat(2_000_000) } } };
    const note = { id: "note", content: "Writing" };
    const before = { theme: "light", activeId: "note", referenceId: null, folders: [], notes: [note, board] };
    const first = workspaceBytes(before), expected = new TextEncoder().encode(JSON.stringify(before)).length;
    const times: number[] = []; for (let i = 0; i < 100; i++) { const start = performance.now(); workspaceBytes({ ...before, notes: [{ ...note, content: `Typing ${i}` }, board] }); times.push(performance.now() - start); }
    times.sort((a,b) => a-b); return { first, expected, medianMs: times[50], p95Ms: times[95], iterations: times.length, unchangedBoardBytes: 2_000_000 };
  });
  expect(result.first).toBe(result.expected); expect(result.medianMs).toBeLessThan(10);
  await writeFile("release/performance-capacity-measurement.json", JSON.stringify(result, null, 2));
});
test("file-backed image nodes preserve resize, Reference, copy and Undo while serializing IDs", async ({ page }) => {
  await runtime(page);
  await page.evaluate(async () => {
    const w = window as any, { configureAttachments } = w.attachmentModule, { NoteEditor } = await import("/src/NoteEditor.tsx");
    const id = "b".repeat(64) + ".png";
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=";
    configureAttachments("C:/Notify", { [id]: 68 });
    w.__TAURI_INTERNALS__ = { convertFileSrc: () => pixel };
    const initial = `<p>Before</p><figure data-notify-image="" data-width="65" data-align="right"><img data-notify-attachment="${id}" alt="Stored photo"><figcaption>Caption</figcaption></figure><p>After</p>`;
    const host = document.createElement("section"); host.id = "image-harness"; host.style.cssText = "position:fixed;z-index:50;top:100px;left:100px;width:650px;height:650px;overflow:auto;padding:24px;background:var(--panel);color:var(--fg)"; document.body.append(host);
    function Harness() { const [content, setContent] = w.React.useState(initial); w.imageHtml = content;
      return w.React.createElement(w.React.Fragment, null, w.React.createElement(NoteEditor, { content, onChange: setContent, onAppendReady: (fn: any) => w.appendImage = fn }), w.React.createElement(NoteEditor, { content, readOnly: true })); }
    w.ReactDOM.createRoot(host).render(w.React.createElement(Harness));
  });
  const host = page.locator("#image-harness"); await expect(host.locator(".note-image")).toHaveCount(2);
  await expect.poll(() => host.locator(".note-image").first().evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(1);
  expect(await host.locator(".reference-editor .image-resize-handle").count()).toBe(0);
  const handle = host.getByRole("button", { name: "Resize image from right" }); await handle.focus(); await page.keyboard.press("Home");
  await expect.poll(() => page.evaluate(() => (window as any).imageHtml)).toContain('data-width="20"');
  await host.locator(".document-editor").getByRole("button", { name: "Image options" }).click(); await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(host.locator(".note-image")).toHaveCount(0); await host.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(host.locator(".note-image")).toHaveCount(2);
  await page.evaluate(() => (window as any).appendImage((window as any).imageHtml)); await expect(host.locator(".note-image")).toHaveCount(4);
  const html = await page.evaluate(() => (window as any).imageHtml); expect(html).not.toContain("data:image"); expect(html).toContain("data-notify-attachment");
});
test("repeated note switching keeps editor instances bounded and records collected browser heap", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const notes = page.locator(".note-select");
  for (let i = 0; i < 20; i++) await notes.nth(i % 2).click();
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.enable"); await session.send("HeapProfiler.collectGarbage");
  const before = await session.send("Runtime.getHeapUsage");
  for (let i = 0; i < 100; i++) await notes.nth(i % 2).click();
  await session.send("HeapProfiler.collectGarbage"); const after = await session.send("Runtime.getHeapUsage");
  await expect(page.locator(".document-editor [contenteditable=true]")).toHaveCount(1);
  await expect(page.locator(".reference-editor")).toHaveCount(1);
  expect(after.usedSize - before.usedSize).toBeLessThan(5 * 1024 * 1024);
  await writeFile("release/performance-note-switch-heap.json", JSON.stringify({ method: "Chromium browser preview, seed notebook, 20 warm switches, collected JS heap before/after 100 further switches; excludes native/decoded-image RAM and does not establish indefinite leak freedom", before, after, growthBytes: after.usedSize - before.usedSize, warmSwitches: 20, measuredSwitches: 100 }, null, 2));
  await session.detach();
});

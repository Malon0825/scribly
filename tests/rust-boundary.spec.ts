import { test, expect } from "@playwright/test";

test("desktop exports use binary IPC, preserve Unicode names, and surface cancellation and errors", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1", "Isolated native IPC harness requires Vite modules");
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const w = window as any; w.isTauri = true;
    const calls: { command: string; binary: boolean; name: string; bytes: number[] }[] = [];
    let mode = "save";
    w.__TAURI_INTERNALS__ = { invoke: async (command: string, payload: any, options: any) => {
      const binary = payload instanceof ArrayBuffer;
      calls.push({ command, binary, name: binary ? JSON.parse(options.headers["X-Scribly-Export-Name"]) : payload.fileName,
        bytes: binary ? [...new Uint8Array(payload)] : [] });
      if (mode === "fail") throw Error("Disk full; previous file retained");
      return mode === "cancel" ? null : "C:/export.png";
    } };
    const { exportArtifact } = await import("/src/storage.ts?rust-boundary-harness");
    const blob = new Blob([new Uint8Array([0, 255, 137, 80, 78, 71])], { type: "image/png" });
    const saved = await exportArtifact("日本語 😀.png", blob, blob.type);
    mode = "cancel"; const canceled = await exportArtifact("image.png", blob, blob.type);
    mode = "fail"; let error = ""; try { await exportArtifact("image.png", blob, blob.type); } catch (e) { error = String(e); }
    mode = "save"; await exportArtifact("diagram.mmd", "flowchart LR\n A --> B", "text/plain");
    const count = calls.length;
    let oversized = ""; try { await exportArtifact("large.png", new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), blob.type); } catch (e) { oversized = String(e); }
    return { saved, canceled, error, oversized, count, finalCount: calls.length, calls };
  });
  expect(result.saved).toBe(true); expect(result.canceled).toBe(false);
  expect(result.error).toContain("Disk full"); expect(result.oversized).toContain("20 MB");
  expect(result.finalCount).toBe(result.count);
  expect(result.calls[0]).toEqual({ command: "export_binary_file", binary: true, name: "日本語 😀.png", bytes: [0, 255, 137, 80, 78, 71] });
  expect(result.calls[3]).toEqual({ command: "export_file", binary: false, name: "diagram.mmd", bytes: [] });
});

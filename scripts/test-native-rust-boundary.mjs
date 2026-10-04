// Attach only to the isolated WebView2 launched by test-native-rust-boundary.ps1.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 200)); }
}
if (!browser) throw Error("Isolated WebView2 debugging endpoint unavailable");
try {
  const page = browser.contexts()[0].pages()[0];
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const report = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const checkFailure = async (command, payload, expected, options) => {
      try { await invoke(command, payload, options); throw Error("Command unexpectedly succeeded"); }
      catch (error) { if (!String(error).includes(expected)) throw error; return true; }
    };
    const before = await invoke("load_workspace");
    const missingHeader = await checkFailure("export_binary_file", new Uint8Array([0, 255]), "Missing export filename");
    const invalidHeader = await checkFailure("export_binary_file", new Uint8Array([0, 255]), "Invalid export filename", { headers: { "X-Scribly-Export-Name": "[]" } });
    const oversize = await checkFailure("store_attachment", new Uint8Array(5 * 1024 * 1024 + 1), "5 MB");
    const malformed = await checkFailure("save_workspace_delta", { revision: before.revision, delta: { metadata: {}, order: [], changed: [{ id: "absent" }] } }, "missing from the notebook order");
    const stale = await checkFailure("save_workspace", { revision: before.revision - 1, document: before.document }, "changed elsewhere");
    const guardedStartup = await checkFailure("set_startup", { enabled: true }, "diagnostic run");
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const stored = await invoke("store_attachment", bytes);
    const restored = new Uint8Array(await invoke("read_attachment", { id: stored.id }));
    if (stored.size !== bytes.length || restored.length !== bytes.length || restored.some((byte, i) => byte !== bytes[i])) throw Error("Binary image round trip failed");
    const after = await invoke("load_workspace");
    if (before.revision !== after.revision || JSON.stringify(before.document) !== JSON.stringify(after.document)) throw Error("Rejected commands modified the notebook");
    return { ok: true, realWebView2: true, rawBinaryTransport: missingHeader && invalidHeader, imageRoundTrip: true, oversizeRejected: oversize,
      malformedDeltaRejected: malformed, staleRevisionRejected: stale, diagnosticStartupGuard: guardedStartup, savedDocumentUnchanged: true };
  });
  await writeFile(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }

// Run only through the isolated-profile launcher after release packaging.
import { chromium, expect } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(done => setTimeout(done, 200)); }
}
if (!browser) throw Error("Isolated WebView2 debugging endpoint unavailable");
const page = browser.contexts()[0].pages()[0], profile = process.argv[3];
const load = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke("load_workspace"));
try {
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60000 });
  if (resolve((await load()).dataPath).toLowerCase() !== resolve(profile).toLowerCase()) throw Error("Refusing to mutate a non-isolated notebook");
  // Real native attachment storage/read; only the picker-bound write is captured.
  await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const state = await invoke("load_workspace");
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const image = await invoke("store_attachment", bytes);
    const note = state.document.notes.find(item => item.id === state.document.activeId);
    if (!note || note.kind === "board") throw Error("Diagnostic requires an active text note");
    note.title = "Native formatted 日本語";
    note.content = `<h2>Formatted export 日本語</h2><p><strong>Bold</strong> and <em>italic</em> text.</p><ul><li><p>First item</p></li></ul><pre><code class="language-rust">fn main() {\n  println!("日本語");\n}</code></pre><figure data-notify-image="" data-width="65" data-align="right"><img data-notify-attachment="${image.id}" alt="Native image"><figcaption>Image caption 日本語</figcaption></figure>`;
    await invoke("save_workspace", { document: state.document, revision: state.revision });
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Formatted export 日本語");
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60000 });
  const before = await load();
  console.log(JSON.stringify({ stage: "native-profile-and-attachment-ready", profile }));
  await page.evaluate(() => {
    const internals = window.__TAURI_INTERNALS__;
    const original = window.fetch.bind(window);
    window.__formattedOriginalFetch = original;
    const textUrl = internals.convertFileSrc("export_file", "ipc");
    const binaryUrl = internals.convertFileSrc("export_binary_file", "ipc");
    window.__formattedCaptures = []; window.__formattedCancel = false;
    window.__formattedIntercepted = 0;
    const captureFetch = async (input, options) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === textUrl || url === binaryUrl) {
        window.__formattedIntercepted++;
        const response = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } });
        if (window.__formattedCancel) return response(null);
        const payload = url === textUrl ? JSON.parse(String(options.body)) : null;
        const name = payload ? payload.fileName : JSON.parse(new Headers(options.headers).get("X-Scribly-Export-Name"));
        const bytes = payload ? new TextEncoder().encode(payload.data) : new Uint8Array(await new Response(options.body).arrayBuffer());
        let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
        window.__formattedCaptures.push({ name, base64: btoa(binary) });
        return response(name);
      }
      return original(input, options);
    };
    window.fetch = captureFetch;
    if (window.fetch !== captureFetch) throw Error("Isolated picker fetch capture was not installed");
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLIFrameElement && event.target.title === "Formatted note for printing") {
        event.target.contentWindow.addEventListener("beforeprint", () => console.log("formatted-native-beforeprint"), { once: true });
        event.target.contentWindow.addEventListener("afterprint", () => console.log("formatted-native-afterprint"), { once: true });
      }
    }, true);
  });
  await page.getByRole("button", { name: "Note options", exact: true }).click();
  await page.getByRole("dialog", { name: "Note options", exact: true }).getByRole("button", { name: "Export formatted…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export notes", exact: true });
  await expect(dialog.getByRole("button", { name: "Save HTML", exact: true })).toBeEnabled({ timeout: 60000 });
  await dialog.getByRole("button", { name: "Save HTML", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__formattedCaptures.length)).toBe(1);
  await dialog.getByRole("button", { name: "Export Markdown (.zip)", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__formattedCaptures.length)).toBe(2);
  const captures = await page.evaluate(() => window.__formattedCaptures);
  const html = Buffer.from(captures[0].base64, "base64").toString("utf8");
  if (!html.includes("Formatted export 日本語") || !html.includes("data:image/png;base64,") || !html.includes("Image caption 日本語")) throw Error("Native HTML lost text or embedded image");
  const zip = unzipSync(Buffer.from(captures[1].base64, "base64"));
  const markdown = Object.entries(zip).filter(([name]) => name.endsWith(".md")).map(([, bytes]) => strFromU8(bytes)).join("\n");
  if (!markdown.includes("日本語") || !markdown.includes("**Bold**") || !Object.keys(zip).some(name => /\.(png|jpeg|webp|gif)$/.test(name))) throw Error("Native Markdown ZIP lost formatting/assets");
  for (const capture of captures) await writeFile(join(profile, capture.name), Buffer.from(capture.base64, "base64"));
  console.log(JSON.stringify({ stage: "native-html-zip-captured", profile, bytes: captures.map(capture => Buffer.from(capture.base64, "base64").length) }));
  await page.evaluate(() => { window.__formattedCancel = true; });
  await dialog.getByRole("button", { name: "Save HTML", exact: true }).click();
  await expect(dialog.getByText("Save canceled.", { exact: true })).toBeVisible();
  if (await page.evaluate(() => window.__formattedIntercepted) !== 3) throw Error("Expected exactly HTML, ZIP, and cancellation transport captures");
  console.log(JSON.stringify({ stage: "native-captured-save-cancellation-confirmed", profile }));
  // Observe a real WebView2 print request; no saved-PDF assertion is possible.
  const requested = page.waitForEvent("console", { predicate: event => event.text() === "formatted-native-beforeprint", timeout: 90000 });
  const dismissed = page.waitForEvent("console", { predicate: event => event.text() === "formatted-native-afterprint", timeout: 90000 });
  console.log(JSON.stringify({ stage: "opening-native-print", profile }));
  const clicking = dialog.getByRole("button", { name: "Print / Save as PDF", exact: true }).click({ timeout: 90000 });
  // Each operation is awaited below; suppress secondary rejection if the first
  // event fails so the diagnostic reports its original failure cleanly.
  requested.catch(() => {}); dismissed.catch(() => {}); clicking.catch(() => {});
  await requested;
  console.log(JSON.stringify({ stage: "native-beforeprint-observed", profile }));
  // Root observes and cancels the OS dialog using the approved native UI tool.
  await dismissed;
  await clicking;
  await expect(page.locator('iframe[title="Formatted note for printing"]')).toHaveCount(0);
  await expect(dialog.getByText("Print dialog requested. Choose Save as PDF or a printer there; Scribly cannot confirm the result.", { exact: true })).toBeVisible({ timeout: 90000 });
  await expect(dialog.getByRole("button", { name: "Save HTML", exact: true })).toBeEnabled({ timeout: 90000 });
  console.log(JSON.stringify({ stage: "native-afterprint-cleanup-confirmed", profile }));
  await page.evaluate(() => { window.fetch = window.__formattedOriginalFetch; });
  const nativeSavePath = join(profile, "native-saved.html");
  console.log(JSON.stringify({ stage: "opening-native-html-save", profile, nativeSavePath }));
  await dialog.getByRole("button", { name: "Save HTML", exact: true }).click({ timeout: 90000 });
  const expectedHash = createHash("sha256").update(Buffer.from(captures[0].base64, "base64")).digest("hex");
  await expect.poll(async () => {
    try { return createHash("sha256").update(await readFile(nativeSavePath)).digest("hex"); }
    catch { return null; }
  }, { timeout: 300000 }).toBe(expectedHash);
  await expect(dialog.getByRole("button", { name: "Save HTML", exact: true })).toBeEnabled({ timeout: 90000 });
  console.log(JSON.stringify({ stage: "native-html-file-write-confirmed", profile, nativeSavePath, sha256: expectedHash }));
  const after = await load();
  if (before.revision !== after.revision || JSON.stringify(before.document) !== JSON.stringify(after.document)) throw Error("Formatted export modified the notebook");
  const report = { ok: true, realWebView2: true, nativeAssetRead: true, htmlEmbeddedImage: true, markdownZipFormattingAndImage: true, nativePrintBeforeAfterEvents: true, actualNativeHtmlSave: true, nativeHtmlSha256: expectedHash, saveCancelPreservedNotebook: true, savedDocumentUnchanged: true, limitations: "ZIP picker-bound write captured at exact IPC fetch boundary. HTML Save dialog completed via native UI and resulting bytes matched capture. Print dialog canceled using native UI; actual print/PDF saving is user-controlled and unconfirmed. Only isolated profile was modified." };
  await writeFile(join(profile, "formatted.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: join(profile, "formatted-failure.png"), timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await Promise.race([
    page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {}),
    new Promise(done => setTimeout(done, 10000)),
  ]);
  await browser.close();
}

// Run only through test-native-capture.ps1 after the release executable is built.
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const port = Number(process.argv[2]), profile = resolve(process.argv[3] || "");
const stage = process.argv[4], manualShortcut = process.argv.includes("--manual-shortcut");
if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^capture-webview-test-[a-f0-9]{32}$/.test(basename(profile)) || !["stage1", "stage2"].includes(stage)) {
  throw Error("Use the isolated native capture launcher; profile/stage/port guard failed.");
}
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
  catch { await new Promise(done => setTimeout(done, 200)); }
}
if (!browser) throw Error("Isolated WebView2 endpoint unavailable");
const context = browser.contexts()[0];
const page = context.pages().find(candidate => !new URL(candidate.url()).searchParams.has("capture"));
if (!page) throw Error("Main diagnostic webview unavailable");
const invoke = (target, command, args = {}) => target.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const load = () => invoke(page, "load_workspace");
const status = () => invoke(page, "quick_capture_status");
const saved = () => page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60000 });
const editor = () => page.getByRole("textbox", { name: "Note content", exact: true });
const visible = () => invoke(page, "plugin:window|is_visible", { label: "quick-capture" });
let capture;
const open = async () => {
  await invoke(page, "open_quick_capture");
  await expect.poll(() => context.pages().filter(candidate => new URL(candidate.url()).searchParams.get("capture") === "1").length, { timeout: 30000 }).toBe(1);
  capture = context.pages().find(candidate => new URL(candidate.url()).searchParams.get("capture") === "1");
  await capture.getByLabel("Note text", { exact: true }).waitFor();
  await expect.poll(visible, { timeout: 10000 }).toBe(true);
  return capture;
};
const fill = async (title, text) => {
  await capture.getByLabel(/Note title/).fill(title);
  await capture.getByLabel("Note text", { exact: true }).fill(text);
};
const waitCommit = async title => {
  await expect.poll(async () => {
    const state = await status();
    if (state.pending || !state.lastSavedId) return false;
    const workspace = (await load()).document;
    return workspace.notes.some(note => note.id === state.lastSavedId && note.title === title);
  }, { timeout: 60000 }).toBe(true);
  const state = await status(), workspace = (await load()).document;
  const notes = workspace.notes.filter(note => note.id === state.lastSavedId);
  if (notes.length !== 1 || notes[0].title !== title) throw Error("Capture commit/id/title mismatch or duplicate");
  const inbox = workspace.folders.find(folder => folder.id === notes[0].folderId);
  if (inbox?.name !== "Inbox") throw Error("Capture did not land in Inbox");
  return notes[0];
};
try {
  await saved();
  if (resolve((await load()).dataPath).toLowerCase() !== profile.toLowerCase()) throw Error("Refusing to mutate a non-isolated notebook");
  if (stage === "stage1") {
    // Give the existing notebook a writing note and a distinct reference, using
    // native persistence only within the verified diagnostic profile.
    const seed = await page.evaluate(async () => {
      const state = await window.__TAURI_INTERNALS__.invoke("load_workspace");
      const active = state.document.notes.find(note => note.id === state.document.activeId);
      if (!active || active.kind === "board") throw Error("Diagnostic needs an active text note");
      active.title = "Capture main writing note";
      active.content = "<p>Main writing baseline.</p>";
      const now = new Date().toISOString(), reference = { id: crypto.randomUUID(), folderId: null, title: "Capture reference", content: "<p>Reference stays unchanged.</p>", createdAt: now, updatedAt: now, archived: false };
      state.document.notes.push(reference); state.document.referenceId = reference.id;
      await window.__TAURI_INTERNALS__.invoke("save_workspace", { document: state.document, revision: state.revision });
      return { activeId: active.id, referenceId: reference.id };
    });
    await page.reload(); await saved(); await expect(editor()).toContainText("Main writing baseline.");
    let preference;
    const attempts = [];
    for (const shortcut of ["Ctrl+Alt+N", "Ctrl+Shift+Space", "Alt+Shift+N"]) {
      const next = await invoke(page, "set_quick_capture_preferences", { enabled: true, shortcut });
      attempts.push({ shortcut, registered: next.registered, warning: next.warning });
      if (next.enabled && next.registered && next.shortcut === shortcut) { preference = next; break; }
    }
    if (!preference) throw Error(`No test shortcut available: ${JSON.stringify(attempts)}`);
    const invalid = await invoke(page, "set_quick_capture_preferences", { enabled: true, shortcut: "Ctrl+Alt+Delete" }).then(() => false, () => true);
    if (!invalid || (await status()).shortcut !== preference.shortcut) throw Error("Invalid preference did not preserve registration");
    console.log(JSON.stringify({ stage: "native-capture-registration-ready", profile, shortcut: preference.shortcut, attempts }));

    await open();
    const denial = await invoke(capture, "load_workspace").then(() => "", error => String(error));
    if (!denial) throw Error("Capture webview could read the entire workspace");
    await expect(capture.getByLabel("Note text", { exact: true })).toBeFocused();
    const sameWindow = capture;
    await fill("", "Native capture 日本語\n<literal> & text");
    // Edit the main draft immediately before submission, before its ordinary
    // debounce has to run. The capture writer must fold into this live state.
    await editor().fill("Main writing baseline. Concurrent main draft preserved.");
    await capture.getByRole("button", { name: "Save", exact: true }).click();
    const first = await waitCommit("Native capture 日本語");
    await expect(capture.getByText("Saved to Inbox.", { exact: true })).toBeVisible();
    const after = (await load()).document;
    if (after.activeId !== seed.activeId || after.referenceId !== seed.referenceId || !after.notes.find(note => note.id === seed.activeId)?.content.includes("Concurrent main draft preserved.")) throw Error("Save capture changed selection/reference or overwrote the main live draft");
    if (!first.content.includes("&lt;literal&gt; &amp; text")) throw Error("Capture markup was not escaped");

    await fill("Retained draft", "Escape keeps this draft 日本語.");
    await capture.keyboard.press("Escape");
    await expect.poll(visible).toBe(false);
    await open();
    if (capture !== sameWindow) throw Error("Capture close destroyed/remounted its native webview");
    await expect(capture.getByLabel(/Note title/)).toHaveValue("Retained draft");
    await expect(capture.getByLabel("Note text", { exact: true })).toHaveValue("Escape keeps this draft 日本語.");
    await fill("Retained after Close", "Close drains the newest draft.");
    await capture.getByRole("button", { name: "Close", exact: true }).click();
    await expect.poll(visible).toBe(false); await open();
    await expect(capture.getByLabel("Note text", { exact: true })).toHaveValue("Close drains the newest draft.");
    await fill("Retained after native close", "Native title-bar close also retains draft.");
    await invoke(capture, "plugin:window|close", { label: "quick-capture" });
    await expect.poll(visible).toBe(false); await open();
    await expect(capture.getByLabel(/Note title/)).toHaveValue("Retained after native close");
    await fill("Native open capture", "Opened only after acknowledged saving.");
    await capture.getByRole("button", { name: "Open in notebook", exact: true }).click();
    const opened = await waitCommit("Native open capture");
    await expect(editor()).toContainText("Opened only after acknowledged saving.");
    await expect.poll(async () => (await load()).document.activeId).toBe(opened.id);
    if ((await load()).document.referenceId !== seed.referenceId) throw Error("Opening a capture changed Reference");

    if (manualShortcut) {
      await capture.getByRole("button", { name: "Close", exact: true }).click();
      await expect.poll(visible).toBe(false);
      console.log(JSON.stringify({ stage: "opening-shortcut-check", profile, shortcut: preference.shortcut, instructions: "Within 90 seconds, put another app in front and press this OS shortcut. Do not invoke open_quick_capture.", timeoutMs: 90000 }));
      await expect.poll(visible, { timeout: 90000, intervals: [250] }).toBe(true);
      await expect.poll(() => invoke(page, "plugin:window|is_focused", { label: "quick-capture" }), { timeout: 10000 }).toBe(true);
    }

    // Intercept only the two native workspace save URLs. Status/mailbox IPC
    // stays real; the pending file must survive an intentional app restart.
    await page.evaluate(() => {
      const internals = window.__TAURI_INTERNALS__, original = window.fetch.bind(window);
      const targets = new Set([internals.convertFileSrc("save_workspace_delta", "ipc"), internals.convertFileSrc("save_workspace", "ipc")]);
      window.__captureSaveFailures = 0;
      window.fetch = async (input, options) => {
        const url = input instanceof Request ? input.url : String(input);
        if (targets.has(url)) {
          window.__captureSaveFailures++;
          return new Response(JSON.stringify("Capture diagnostic injected workspace save failure"), { headers: { "Content-Type": "application/json", "Tauri-Response": "error" } });
        }
        return original(input, options);
      };
    });
    await open(); await fill("Native pending recovery", "One capture ID survives failed saving and restart.");
    await editor().fill("Newer main draft survives capture restart failure.");
    await capture.keyboard.press("Control+Enter");
    await expect.poll(async () => !!(await status()).pending && !!(await status()).warning, { timeout: 30000 }).toBe(true);
    const pending = (await status()).pending;
    if (await page.evaluate(() => window.__captureSaveFailures) < 1) throw Error("Workspace save IPC fault was not exercised");
    await expect(capture.getByLabel("Note text", { exact: true })).toHaveAttribute("readonly", "");
    await expect(capture.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(capture.getByRole("button", { name: "Close", exact: true })).toBeEnabled();
    await capture.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect.poll(async () => (await status()).pending?.id).toBe(pending.id);
    await expect.poll(async () => !!(await status()).warning, { timeout: 30000 }).toBe(true);
    const retained = JSON.parse(await readFile(join(profile, "quick-capture-queue.json"), "utf8"));
    if (retained.pending?.id !== pending.id || retained.pending.text !== pending.text) throw Error("Pending capture was not retained in its isolated native mailbox");
    if ((await load()).document.notes.some(note => note.id === pending.id)) throw Error("Injected save failure unexpectedly committed a capture");
    const fixture = { ...seed, firstId: first.id, openedId: opened.id, pending, shortcut: preference.shortcut, manualShortcut, failureDenial: denial };
    await writeFile(join(profile, "capture-restart-fixture.json"), JSON.stringify(fixture, null, 2));
    await capture.screenshot({ path: join(profile, "capture-native-pending.png") });
    console.log(JSON.stringify({ stage: "native-capture-pending-durable", profile, pendingId: pending.id, deliberateRestart: true }));
    // Bypass the normal main-window flush exclusively for this injected-failure
    // fixture. lib.rs still closes its database on main Destroyed/app Exit.
    await invoke(page, "plugin:window|destroy", { label: "main" }).catch(() => {});
  } else {
    const fixture = JSON.parse(await readFile(join(profile, "capture-restart-fixture.json"), "utf8"));
    await expect.poll(async () => (await status()).lastSavedId, { timeout: 60000 }).toBe(fixture.pending.id);
    const recovered = (await load()).document;
    if (recovered.notes.filter(note => note.id === fixture.pending.id).length !== 1 || (await status()).pending) throw Error("Restart did not commit precisely one retained capture");
    if (!recovered.notes.find(note => note.id === fixture.openedId)?.content.includes("Newer main draft survives capture restart failure.")) throw Error("Restart lost the newer main draft");
    if (recovered.referenceId !== fixture.referenceId) throw Error("Restart changed Reference");
    const pref = await status();
    if (!pref.enabled || !pref.registered || pref.shortcut !== fixture.shortcut) throw Error("Opt-in shortcut preference/registration did not survive restart");
    await open(); await expect(capture.getByLabel("Note text", { exact: true })).toHaveValue("");
    const notes = recovered.notes.filter(note => [fixture.firstId, fixture.openedId, fixture.pending.id].includes(note.id));
    if (notes.length !== 3 || notes.some(note => recovered.folders.find(folder => folder.id === note.folderId)?.name !== "Inbox")) throw Error("Restart capture count/destination mismatch");
    const disabled = await invoke(page, "set_quick_capture_preferences", { enabled: false, shortcut: fixture.shortcut });
    if (disabled.enabled || disabled.registered) throw Error("Disabling capture did not release temporary registration");
    const report = { ok: true, executable: "optimized release", isolatedProfile: profile, nativeCaptureWindow: true, captureWorkspaceReadDenied: true, mainLiveDraftPreserved: true, selectionAndReferencePreserved: true, escapedTextAndInbox: true, retainedEscapeCloseAndNativeClose: true, openAfterCommit: true, pendingRetryKeepsId: true, pendingRestartCommitsOnce: true, newerMainDraftRecovered: true, temporaryShortcutRegistrationAndRestart: true, temporaryShortcutReleased: true, actualForegroundShortcutObserved: fixture.manualShortcut, actualRegistrationConflict: "Not exercised by this harness; requires a second isolated app reserving a supported shortcut.", limitations: "Dedicated diagnostic profile. No production data, startup registration, pickers, or installer mutated. Foreground OS key needs -ManualShortcut and an external key press. Cross-process shortcut conflict remains a separate check." };
    await capture.screenshot({ path: join(profile, "capture-native.png") });
    await writeFile(join(profile, "capture.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    // Do not wait for the 250ms draft debounce: normal main shutdown must
    // request and acknowledge the capture webview's newest retained draft.
    await fill("Native main shutdown retained draft", "The newest capture text survives normal main-window shutdown. 日本語");
    await invoke(page, "plugin:window|close", { label: "main" }).catch(() => {});
  }
} catch (error) {
  await (capture || page).screenshot({ path: join(profile, `capture-${stage}-failure.png`) }).catch(() => {});
  throw error;
} finally { await browser.close(); }

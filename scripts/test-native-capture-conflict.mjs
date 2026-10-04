import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
const stage = process.argv[2], root = resolve(process.argv[3] || ""), ports = process.argv.slice(4).map(Number);
if (!/^capture-conflict-test-[a-f0-9]{32}$/.test(basename(root)) || !["first", "second"].includes(stage) || ports.length !== (stage === "first" ? 1 : 2) || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw Error("Use the isolated conflict launcher.");
const browsers = [], reportPath = join(root, "capture-conflict.json");
const deadline = setTimeout(async () => { await writeFile(reportPath, JSON.stringify({ ok: false, isolated: true, error: "Conflict stage exceeded 180 seconds" })).catch(() => {}); process.exit(1); }, 180000); deadline.unref();
const invoke = (page, command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
async function connect(port, name) {
  let browser;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; } catch { await new Promise(done => setTimeout(done, 200)); }
  }
  if (!browser) throw Error(`Isolated ${name} CDP endpoint unavailable`);
  browsers.push(browser);
  const page = browser.contexts()[0].pages().find(candidate => !new URL(candidate.url()).searchParams.has("capture"));
  if (!page) throw Error(`Isolated ${name} main window unavailable`);
  await page.getByText("Saved locally", { exact: true }).waitFor({ timeout: 60000 });
  if (resolve((await invoke(page, "load_workspace")).dataPath).toLowerCase() !== join(root, name).toLowerCase()) throw Error("Refusing a non-isolated notebook");
  return page;
}
let report = { ok: false, isolated: true };
try {
  const first = await connect(ports[0], "first");
  if (stage === "first") {
    report.attempts = [];
    for (const shortcut of ["Ctrl+Alt+N", "Ctrl+Shift+Space", "Alt+Shift+N"]) {
      const status = await invoke(first, "set_quick_capture_preferences", { enabled: true, shortcut });
      report.attempts.push({ shortcut, registered: status.registered, warning: status.warning });
      if (status.enabled && status.registered && status.shortcut === shortcut) { report.shortcut = shortcut; break; }
    }
    if (!report.shortcut) throw Error("No available shortcut for the conflict probe");
    await mkdir(join(root, "second"), { recursive: true });
    await writeFile(join(root, "second", "quick-capture-preferences.json"), JSON.stringify({ enabled: true, shortcut: report.shortcut }));
  } else {
    report = JSON.parse(await readFile(reportPath, "utf8"));
    const second = await connect(ports[1], "second");
    await expect.poll(async () => !!(await invoke(second, "quick_capture_status")).warning, { timeout: 15000 }).toBe(true);
    report.conflicted = await invoke(second, "quick_capture_status");
    if (!report.conflicted.enabled || report.conflicted.registered || report.conflicted.shortcut !== report.shortcut || !report.conflicted.warning.includes("Shortcut unavailable")) throw Error("Shortcut conflict was not truthfully reported");
    const persisted = JSON.parse(await readFile(join(root, "second", "quick-capture-preferences.json"), "utf8"));
    if (!persisted.enabled || persisted.shortcut !== report.shortcut) throw Error("Conflict changed persisted preferences");
    await invoke(first, "set_quick_capture_preferences", { enabled: false, shortcut: report.shortcut });
    report.releasedThenRegistered = await invoke(second, "set_quick_capture_preferences", { enabled: true, shortcut: report.shortcut });
    if (!report.releasedThenRegistered.registered || report.releasedThenRegistered.warning) throw Error("Released shortcut could not be retried");
    if ((await invoke(second, "set_quick_capture_preferences", { enabled: false, shortcut: report.shortcut })).registered) throw Error("Shortcut disable did not release registration");
    await invoke(first, "plugin:window|destroy", { label: "main" }).catch(() => {});
    await invoke(second, "plugin:window|destroy", { label: "main" }).catch(() => {});
    report.ok = true;
  }
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { await writeFile(reportPath, JSON.stringify(report, null, 2)); await Promise.all(browsers.map(browser => browser.close().catch(() => {}))); clearTimeout(deadline); }

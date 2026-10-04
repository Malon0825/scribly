// Driven by test-native-app-icon.ps1 against an isolated release WebView2.
import { chromium } from "@playwright/test";
import { createInterface } from "node:readline";
import { once } from "node:events";
const input = createInterface({ input: process.stdin });
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 200)); }
}
if (!browser) throw Error("Diagnostic WebView2 did not expose its debugging port");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("console", message => {
  if (message.text().includes("Could not update the window icon")) errors.push(message.text());
});
await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
async function sample(stage, dark) {
  await page.waitForFunction(dark => document.documentElement.dataset.theme === (dark ? "dark" : "light"), dark);
  // Sample the real hook after its resolved favicon and native update settle.
  await page.waitForFunction(dark => document.querySelector('link[rel="icon"]').getAttribute("href") === (dark ? "/scribly-icon-dark.png" : "/scribly-icon.png"), dark);
  await page.waitForTimeout(100);
  if (errors.length) throw Error(errors.join("\n"));
  process.stdout.write(JSON.stringify({ stage, dark }) + "\n");
  const [acknowledgment] = await once(input, "line");
  if (acknowledgment !== "ok") throw Error("Windows icon verification failed");
}
async function appearance(mode) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
}
await appearance("Light");
await sample("light", false);
await page.getByRole("button", { name: "Use dark mode" }).click();
await sample("dark", true);
await page.emulateMedia({ colorScheme: "light" });
await appearance("System");
await sample("system-light", false);
await page.emulateMedia({ colorScheme: "dark" });
await sample("system-dark", true);
await page.emulateMedia({ colorScheme: "light" });
for (let i = 0; i < 10; i++) {
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await page.getByRole("button", { name: "Use light mode" }).click();
}
await sample("rapid-light", false);
await page.getByRole("button", { name: "Use dark mode" }).click();
await sample("rapid-dark", true);
await page.getByText("Saved locally", { exact: true }).waitFor();
await page.reload();
await sample("restored-dark", true);
input.close();
await browser.close();

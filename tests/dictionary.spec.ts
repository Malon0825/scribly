import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";
import { readFileSync } from "node:fs";

const tauriConfig = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));

const stamp = "2026-10-05T00:00:00Z";
const fixture: Workspace = {
  theme: "light", activeId: "first", referenceId: "second", folders: [],
  notes: [
    { id: "first", title: "Words", folderId: null, archived: false, content: "<p>Bright calm words.</p>", createdAt: stamp, updatedAt: stamp },
    { id: "second", title: "Reference note", folderId: null, archived: false, content: "<p>Keep this thought.</p>", createdAt: stamp, updatedAt: stamp },
  ],
};
const entry = (word: string) => ({ word, entries: [{ language: { code: "en", name: "English" }, partOfSpeech: "adjective", pronunciations: [{ type: "ipa", text: "/test/" }], synonyms: ["radiant"], antonyms: ["dim"], senses: [{ definition: `Definition of ${word}.`, examples: [`A ${word} morning.`], synonyms: [], antonyms: [], subsenses: [] }] }], source: { url: `https://en.wiktionary.org/wiki/${word}`, license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } } });
async function open(page: Page, theme: "light" | "dark" | "notebook" = "light", bundled = false) {
  // Exercise the online fallback separately from the real bundled dataset.
  if (!bundled) await page.route(/\/dictionary\/[a-z_]{2}\.json$/, route => route.fulfill({ json: {} }));
  await page.addInitScript(workspace => localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document: workspace, dataPath: "Test" })), { ...fixture, theme });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
}
async function select(page: Page, word: "Bright" | "calm") {
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.click(); await page.keyboard.press("Control+Home");
  if (word === "calm") for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");
  for (const _ of word) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
}
const panel = (page: Page) => page.getByRole("complementary", { name: "Dictionary panel", exact: true });

for (const theme of ["light", "dark", "notebook"] as const) test(`word selection preserves writing and Reference in ${theme}`, async ({ page }) => {
  await page.route("https://freedictionaryapi.com/**", route => route.fulfill({ json: entry(route.request().url().split("/").pop()!) }));
  await open(page, theme);
  if (theme === "dark") {
    const text = page.getByRole("textbox", { name: "Note content", exact: true }).locator("p").first();
    await text.dblclick({ position: { x: 18, y: 10 } });
  } else await select(page, "Bright");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("Definition of bright.");
  await expect(panel(page).getByRole("button", { name: "radiant", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "dim", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe("Bright");
  await page.getByRole("button", { name: "Close dictionary", exact: true }).click();
  await expect(panel(page)).not.toBeVisible();
  await page.getByRole("button", { name: "Dictionary", exact: true }).click();
  await expect(panel(page)).toContainText("Definition of bright.");
  await panel(page).getByRole("button", { name: "radiant", exact: true }).click();
  await expect(panel(page)).toContainText("Definition of radiant.");
  await expect(page.locator(".document-editor")).toHaveText("Radiant calm words.");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Radiant");
  await panel(page).getByRole("button", { name: "dim", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".document-editor")).toHaveText("Dim calm words.");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".document-editor")).toHaveText("Radiant calm words.");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content)).toBe("<p>Radiant calm words.</p>");
  await panel(page).getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page.locator(".reference-editor")).toContainText("Keep this thought.");
  await expect(page.locator(".document-editor")).toHaveText("Radiant calm words.");
  await page.locator(".reference-modes").getByRole("button", { name: "Dictionary", exact: true }).click();
  await panel(page).getByRole("textbox", { name: "Dictionary word" }).focus(); await page.keyboard.press("Escape");
  await expect(panel(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Dictionary", exact: true })).toBeFocused();
});

test("dictionary replacement retains formatting and browsing never replaces a different selection", async ({ page }) => {
  await page.route("https://freedictionaryapi.com/**", route => route.fulfill({ json: entry(route.request().url().split("/").pop()!) }));
  await open(page); await select(page, "Bright");
  await page.keyboard.press("Control+b");
  await expect(panel(page)).toContainText("Definition of bright.");
  await panel(page).getByRole("button", { name: "radiant", exact: true }).click();
  await expect(page.locator(".document-editor strong")).toHaveText("Radiant");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content)).toBe("<p><strong>Radiant</strong> calm words.</p>");
  const input = panel(page).getByRole("textbox", { name: "Dictionary word" });
  await input.fill("calm"); await input.press("Enter");
  await expect(panel(page)).toContainText("Definition of calm.");
  await panel(page).getByRole("button", { name: "dim", exact: true }).click();
  await expect(panel(page)).toContainText("Definition of dim.");
  await expect(page.locator(".document-editor")).toHaveText("Radiant calm words.");
});

test("bundled WordNet works without external requests and keeps antonyms tied to senses", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://freedictionaryapi.com/**", route => { requests.push(route.request().url()); return route.abort(); });
  await open(page, "dark", true); await select(page, "Bright");
  await expect(panel(page)).toContainText("On-device lookup");
  await expect(panel(page)).toContainText("emitting or reflecting light readily or in large amounts");
  const input = panel(page).getByRole("textbox", { name: "Dictionary word" });
  await input.fill("happy"); await input.press("Enter");
  await expect(panel(page)).toContainText("enjoying or showing or marked by joy or pleasure");
  await expect(panel(page).getByRole("button", { name: "unhappy", exact: true }).first()).toBeVisible();
  await panel(page).getByRole("button", { name: "unhappy", exact: true }).first().click();
  await expect(input).toHaveValue("unhappy");
  await expect(panel(page)).toContainText("experiencing or marked by or causing sadness or sorrow or discontent");
  expect(requests).toEqual([]);
});

test("new lookups supersede old responses; missing, invalid, retry, cache and reduced motion", async ({ page }) => {
  let brightRequests = 0, calmRequests = 0;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://freedictionaryapi.com/**", async route => {
    const word = route.request().url().split("/").pop()!;
    if (word === "bright") { brightRequests++; await new Promise(resolve => setTimeout(resolve, 700)); }
    if (word === "calm" && ++calmRequests === 1) return route.fulfill({ status: 503, body: "Unavailable" });
    if (word === "awd") return route.fulfill({ json: { ...entry(word), entries: [] } });
    if (word === "unknown") return route.fulfill({ status: 404, json: { title: "No Definitions Found" } });
    await route.fulfill({ json: entry(word) }).catch(() => {});
  });
  await open(page); await select(page, "Bright");
  await expect(panel(page)).toContainText("Looking up");
  await select(page, "calm");
  await expect(panel(page)).toContainText("Dictionary lookup unavailable");
  await expect(panel(page)).not.toContainText("Check your connection");
  await panel(page).getByRole("button", { name: "Try again" }).click();
  await expect(panel(page)).toContainText("Definition of calm.");
  await expect(panel(page)).not.toContainText("Definition of bright.");
  const input = panel(page).getByRole("textbox", { name: "Dictionary word" });
  await input.fill("two words"); await input.press("Enter");
  await expect(panel(page)).toContainText("Enter one English word.");
  await input.fill("unknown"); await input.press("Enter");
  await expect(panel(page)).toContainText("No entry found");
  await input.fill("awd"); await input.press("Enter");
  await expect(panel(page)).toContainText("No entry found");
  await expect(panel(page).getByRole("alert")).not.toBeVisible();
  await input.fill("calm"); await input.press("Enter");
  await expect(panel(page)).toContainText("Definition of calm.");
  expect(calmRequests).toBe(2); expect(brightRequests).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(panel(page)).not.toBeVisible();
  await select(page, "Bright");
  await expect(panel(page)).not.toBeVisible();
});

test("online senses retain related words, examples and source attribution", async ({ page }) => {
  await page.route("https://freedictionaryapi.com/**", route => route.fulfill({ json: {
    ...entry("bright"), entries: [{ ...entry("bright").entries[0], senses: [{
      definition: "A clear light.", examples: ["A bright light."], synonyms: ["luminous"], antonyms: ["dull"],
      subsenses: [{ definition: "A clear thought.", examples: [], synonyms: ["clever"], antonyms: [], subsenses: [] }],
    }] }],
  } }));
  await open(page);
  await page.evaluate(csp => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy"; meta.content = csp;
    document.head.append(meta);
  }, tauriConfig.app.security.csp);
  await page.getByRole("button", { name: "Dictionary", exact: true }).click();
  const input = panel(page).getByRole("textbox", { name: "Dictionary word" });
  await input.fill("bright"); await input.press("Enter");
  await expect(panel(page)).toContainText("A clear light.");
  await expect(panel(page)).toContainText("A bright light.");
  await expect(panel(page)).toContainText("A clear thought.");
  await expect(panel(page).getByRole("button", { name: "luminous", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "dull", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "clever", exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("/test/");
  await expect(panel(page).getByRole("button", { name: "CC BY-SA 4.0" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Wiktionary", exact: false })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "FreeDictionaryAPI.com" })).toBeVisible();
});

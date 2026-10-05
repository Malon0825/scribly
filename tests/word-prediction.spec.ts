import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";
const stamp = "2026-10-05T00:00:00Z";
const fixture: Workspace = { theme: "light", activeId: "first", referenceId: "first", folders: [], notes: [{ id: "first", title: "Predictions", folderId: null, archived: false, content: "<p>We drink</p>", createdAt: stamp, updatedAt: stamp }] };
const editor = (page: Page) => page.getByRole("textbox", { name: "Note content", exact: true });
const ghost = (page: Page) => page.locator(".document-editor .prediction-ghost-text");
async function open(page: Page, content = "<p>We drink</p>", theme: "light" | "dark" = "light") {
  await page.addInitScript(workspace => { if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document: workspace, dataPath: "Test" })); }, { ...fixture, theme, notes: [{ ...fixture.notes[0], content }] });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(editor(page)).toBeVisible();
  await editor(page).click(); await page.keyboard.press("Control+End");
}
async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content as string);
}

for (const theme of ["light", "dark"] as const) test(`inline suggestion stays out of saving; Tab inserts once and Undo restores in ${theme}`, async ({ page }) => {
  const requests: URL[] = [];
  await page.route("https://api.datamuse.com/**", route => { requests.push(new URL(route.request().url())); return route.fulfill({ json: [{ word: "water", score: 900 }, { word: "wine", score: 800 }] }); });
  await open(page, undefined, theme); await page.keyboard.type(" ");
  await expect(ghost(page)).toHaveText("waterTab");
  expect(requests[0].searchParams.get("lc")).toBe("drink");
  expect(requests[0].searchParams.get("rel_bga")).toBe("drink");
  expect(requests[0].searchParams.get("ml")).toBe("drink");
  await expect.poll(() => saved(page)).toBe("<p>We drink </p>");
  expect(await editor(page).evaluate(element => element.textContent)).toContain("water");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toContainText("We drink water");
  await expect.poll(() => saved(page)).toBe("<p>We drink water </p>");
  await page.keyboard.press("Control+z");
  await expect.poll(() => saved(page)).toBe("<p>We drink </p>");
  await expect(editor(page)).toBeFocused();
});

test("cached results finish a typed prefix immediately, with no old text accepted", async ({ page }) => {
  let requests = 0;
  await page.route("https://api.datamuse.com/**", route => { requests++; return route.fulfill({ json: [{ word: "water" }, { word: "wine" }] }); });
  await open(page); await page.keyboard.type(" "); await expect(ghost(page)).toHaveText("waterTab");
  await page.keyboard.type("wa"); await expect(ghost(page)).toHaveText("terTab"); expect(requests).toBe(1);
  await page.keyboard.press("Control+e"); await expect(ghost(page)).toHaveCount(0);
  await page.keyboard.press("Control+e"); await page.keyboard.type("t"); await expect(ghost(page)).toHaveText("erTab");
  await page.keyboard.press("Tab"); await expect.poll(() => saved(page)).toBe("<p>We drink water </p>");
  await page.keyboard.press("ArrowLeft"); await expect(ghost(page)).toHaveCount(0);
});

test("semantic filtering failing at Datamuse falls back to the immediate context and follower constraint", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("https://api.datamuse.com/**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: url.searchParams.has("ml") ? { code: 500, message: "Unable to process semantic filter" } : [{ word: "water" }] });
  });
  await open(page); await page.keyboard.type(" ");
  await expect(ghost(page)).toHaveText("waterTab");
  expect(requests).toHaveLength(2);
  expect(requests[0].searchParams.get("ml")).toBe("drink");
  expect(requests[1].searchParams.get("rel_bga")).toBe("drink");
  expect(requests[1].searchParams.has("ml")).toBe(false);
});

test("headings predict the next word and fall back when semantic filtering has no matches", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("https://api.datamuse.com/**", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: url.searchParams.has("ml") ? [] : [{ word: "easy" }] });
  });
  await open(page, "<h2>Your notebook, your way. This is fast and</h2><p>Body</p>");
  await page.keyboard.press("Control+Home"); await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await expect(ghost(page)).toHaveText("easyTab");
  expect(requests).toHaveLength(2);
  expect(requests[0].searchParams.get("lc")).toBe("and");
  expect(requests[0].searchParams.get("ml")).toBe("fast");
  expect(requests[1].searchParams.has("ml")).toBe(false);
  await expect.poll(() => saved(page)).toBe("<h2>Your notebook, your way. This is fast and </h2><p>Body</p>");
  await page.keyboard.press("Tab");
  await expect.poll(() => saved(page)).toBe("<h2>Your notebook, your way. This is fast and easy </h2><p>Body</p>");
  await page.keyboard.press("Control+z");
  await expect.poll(() => saved(page)).toBe("<h2>Your notebook, your way. This is fast and </h2><p>Body</p>");
});

test("typing and selection cancel stale responses; Escape and disabled predictions retain normal Tab", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("https://api.datamuse.com/**", async route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.searchParams.get("lc") === "drink") await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: [{ word: url.searchParams.get("lc") === "drink" ? "water" : "bread" }] }).catch(() => {});
  });
  await open(page); await page.keyboard.type(" "); await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page.keyboard.press("Control+a"); await page.keyboard.type("We eat ");
  await expect(ghost(page)).toHaveText("breadTab");
  await page.keyboard.press("Escape"); await expect(ghost(page)).toHaveCount(0);
  await page.keyboard.press("Tab"); await expect(editor(page)).not.toBeFocused();
  await editor(page).click(); await page.keyboard.press("Control+End"); await page.keyboard.type("b");
  await expect(ghost(page)).toHaveText("readTab");
  // Focus mode reveals this toolbar control under More formatting tools if compact.
  const toggle = page.getByRole("button", { name: "Next word suggestions", exact: true });
  if (!(await toggle.isVisible())) await page.getByRole("button", { name: "More formatting tools" }).click();
  await toggle.click(); await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(ghost(page)).toHaveCount(0);
  await editor(page).click(); await page.keyboard.press("Control+End"); await page.keyboard.type("r");
  await expect(editor(page)).toHaveText("We eat br");
  await page.reload();
  const persisted = page.getByRole("button", { name: "Next word suggestions", exact: true });
  await expect(persisted).toHaveAttribute("aria-pressed", "false");
});

test("IME, code blocks, read-only Reference and network failures do not alter text", async ({ page }) => {
  let requests = 0;
  await page.route("https://api.datamuse.com/**", route => { requests++; return route.fulfill({ status: 503, body: "Unavailable" }); });
  await open(page); await page.keyboard.type(" ");
  await expect.poll(() => requests).toBe(1); await expect(ghost(page)).toHaveCount(0);
  await page.keyboard.type("wa"); await expect(editor(page)).toHaveText("We drink wa");
  await editor(page).evaluate(element => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await page.keyboard.type("t"); await expect(ghost(page)).toHaveCount(0);
  await editor(page).evaluate(element => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.getByRole("banner").getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page.locator(".reference-editor [contenteditable=false]")).toBeVisible();
  await expect(page.locator(".reference-editor .prediction-ghost")).toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: "Reference", exact: true }).click();
  await editor(page).click(); await page.keyboard.press("Control+End");
  const code = page.getByRole("button", { name: "Code block", exact: true });
  if (!(await code.isVisible())) await page.getByRole("button", { name: "More formatting tools" }).click();
  await code.click(); await page.keyboard.type("const value = ");
  await expect(page.locator(".document-editor .code-block")).toContainText("const value =");
  await expect(ghost(page)).toHaveCount(0);
});

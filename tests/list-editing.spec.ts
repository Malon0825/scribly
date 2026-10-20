import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const editor = (page: Page) => page.getByRole("textbox", { name: "Note content", exact: true });
const lists = [
  { name: "bullet", tag: "ul", attrs: "", itemAttrs: "" },
  { name: "ordered", tag: "ol", attrs: ' start="7"', itemAttrs: "" },
  { name: "task", tag: "ul", attrs: ' data-type="taskList"', itemAttrs: ' data-type="taskItem" data-checked="true"' },
] as const;

async function open(page: Page, content: string) {
  const stamp = "2026-10-16T00:00:00Z";
  const workspace: Workspace = { theme: "light", activeId: "one", referenceId: "one", folders: [], notes: [
    { id: "one", title: "List editing", folderId: null, archived: false, content, createdAt: stamp, updatedAt: stamp },
  ] };
  await page.addInitScript(document => {
    if (!localStorage.getItem("still-notes-browser-v1")) {
      localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
    }
    localStorage.setItem("scribly-word-predictions", "false");
  }, workspace);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(editor(page)).toBeVisible();
}

async function caret(page: Page, text: string) {
  await editor(page).evaluate(async (element, text) => {
    const paragraph = Array.from(element.querySelectorAll("p")).find(p => p.textContent === text)!;
    (element as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, text);
}

for (const list of lists) for (const nestedList of [true, false]) test(`Backspace removes an empty middle ${nestedList ? "nested" : "top-level"} ${list.name} item without promoting the following items`, async ({ page }) => {
  const items = ["Before", "", "After", "Last"].map(text => `<li${list.itemAttrs}><p>${text}</p></li>`).join("");
  const html = `<${list.tag}${list.attrs}>${items}</${list.tag}>`;
  await open(page, `${nestedList ? `<ul><li><p>Parent</p>${html}</li></ul>` : html}<p>Tail</p>`);
  const selector = nestedList ? `:scope > ul > li > ${list.tag}` : `:scope > ${list.tag}`;
  const nested = editor(page).locator(selector);
  await caret(page, "");
  await page.keyboard.press("Backspace");
  await expect(nested).toHaveCount(1);
  await expect(nested.locator(":scope > li")).toHaveCount(3);
  await expect(nested.locator("p")).toHaveText(["Before", "After", "Last"]);
  if (nestedList) await expect(editor(page).locator(":scope > ul > li")).toHaveCount(1);
  expect(await editor(page).evaluate(() => ({ text: window.getSelection()?.anchorNode?.textContent, offset: window.getSelection()?.anchorOffset })))
    .toEqual({ text: "Before", offset: 6 });
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(nested.locator(":scope > li")).toHaveCount(4);
  await page.keyboard.press("Control+y");
  await expect(nested.locator(":scope > li")).toHaveCount(3);
  if (list.name === "ordered") await expect(nested).toHaveAttribute("start", "7");
  if (list.name === "task") await expect(nested.locator(':scope > li[data-checked="true"]')).toHaveCount(3);
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(selector => {
    const html = document.createElement("div");
    html.innerHTML = JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content;
    return html.querySelector(selector)?.children.length;
  }, selector)).toBe(3);
  await page.reload();
  await expect(nested.locator(":scope > li")).toHaveCount(3);
  await expect(nested.locator("p")).toHaveText(["Before", "After", "Last"]);
});

test("deleting the middle item's text then its bullet keeps the lower nested bullets in place", async ({ page }) => {
  await open(page, '<ul><li><p>Parent</p><ul><li><p>Before</p></li><li><p>Remove</p></li><li><p>After</p></li><li><p>Last</p></li></ul></li></ul><p>Tail</p>');
  await caret(page, "Remove");
  for (let i = 0; i < "Remove".length; i++) await page.keyboard.press("Backspace");
  const list = editor(page).locator(":scope > ul > li > ul");
  await expect(list.locator(":scope > li")).toHaveCount(4);
  await expect(list.locator("p")).toHaveText(["Before", "", "After", "Last"]);
  await page.keyboard.press("Control+Backspace");
  await expect(list).toHaveCount(1);
  await expect(list.locator("p")).toHaveText(["Before", "After", "Last"]);
  await expect(editor(page).locator(":scope > ul > li")).toHaveCount(1);
});

for (const position of ["first", "last"] as const) test(`Backspace on an empty ${position} item still exits the list`, async ({ page }) => {
  const items = position === "first" ? '<li><p></p></li><li><p>Keep</p></li>' : '<li><p>Keep</p></li><li><p></p></li>';
  await open(page, `<ul>${items}</ul><p>Tail</p>`);
  await caret(page, "");
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator(":scope > ul > li")).toHaveCount(1);
  await expect(editor(page).locator(":scope > ul > li > p")).toHaveText("Keep");
  await expect(editor(page).locator(":scope > p")).toHaveText(["", "Tail"]);
});

test("an empty middle item with children retains its subtree; explicit outdent still works", async ({ page }) => {
  await open(page, '<ul><li><p>Before</p></li><li><p></p><ul><li><p>Child</p></li></ul></li><li><p>After</p></li></ul><p>Tail</p>');
  await caret(page, "");
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator("p")).toHaveText(["Before", "", "Child", "After", "Tail"]);
  await page.keyboard.press("Control+z");
  await expect(editor(page).locator(":scope > ul > li")).toHaveCount(3);
  await caret(page, "Child");
  await page.keyboard.press("Shift+Tab");
  await expect(editor(page).locator(":scope > ul > li")).toHaveCount(4);
  await expect(editor(page).locator("p")).toHaveText(["Before", "", "Child", "After", "Tail"]);
});

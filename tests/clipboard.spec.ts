import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const content = '<h1>Date: 10-05-2026</h1><h2>Daily task</h2><ul><li><p>Daily team meeting</p></li><li><p>Table mapping</p><ul><li><p>Nested item</p></li></ul></li></ul><h2>Checker</h2><ol start="7"><li><p>Primary keys</p></li><li><p>Checker service</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li><li data-type="taskItem" data-checked="false"><p>Pending</p></li></ul><p>First<br>Second</p><p></p><p><strong>Keep</strong> spacing</p><pre><code class="language-plaintext">one\n\n  two</code></pre><p>Tail</p>';
const plain = 'Date: 10-05-2026\n\nDaily task\n• Daily team meeting\n• Table mapping\n  • Nested item\n\nChecker\n7. Primary keys\n8. Checker service\n\n[x] Done\n[ ] Pending\n\nFirst\nSecond\n\nKeep spacing\n\none\n\n  two\n\nTail';

async function open(page: Page) {
  const stamp = "2026-10-05T00:00:00Z";
  const workspace: Workspace = { theme: "notebook", activeId: "one", referenceId: "two", folders: [], notes:
    ["one", "two"].map(id => ({ id, title: id, folderId: null, archived: false, content, createdAt: stamp, updatedAt: stamp })) };
  await page.addInitScript(document => localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" })), workspace);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
}

async function clipboard(page: Page, selector: string, operation: "copy" | "cut" = "copy", partial = false, targetSelector?: string) {
  const surface = page.locator(selector).locator(".tiptap");
  await surface.click();
  return surface.evaluate(async (element, { operation, partial, targetSelector }) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    const target = targetSelector ? element.querySelector(targetSelector)! : partial ? element.querySelector("strong")! : element;
    range.selectNodeContents(target);
    if (partial && targetSelector) range.setEnd(target.firstChild!, 5);
    selection.removeAllRanges(); selection.addRange(range);
    // Let the editor's selection observer consume the browser selection.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent(operation, { bubbles: true, cancelable: true, clipboardData: data }));
    return { text: data.getData("text/plain"), html: data.getData("text/html") };
  }, { operation, partial, targetSelector });
}

test("copy keeps lists compact and preserves intentional blank lines, code and HTML", async ({ page }) => {
  await open(page);
  const editor = page.locator(".document-editor");
  const before = await editor.textContent();
  const copied = await clipboard(page, ".document-editor");
  expect(copied.text).toBe(plain);
  expect(copied.html).toContain("<h1");
  expect(copied.html).toContain("<ul");
  expect(copied.html).toContain("<strong>Keep</strong>");
  expect(copied.html).toContain('data-type="taskItem"');
  expect(await editor.textContent()).toBe(before);
  const partial = await clipboard(page, ".document-editor", "copy", true);
  expect(partial.text).toBe("Keep");
  expect(partial.html).toContain("<strong>Keep</strong>");
  expect((await clipboard(page, ".document-editor", "copy", false, "ol > li:nth-child(2) > p")).text).toBe("8. Checker service");
  expect((await clipboard(page, ".document-editor", "copy", true, "ul > li > p")).text).toBe("Daily");
});

test("Reference copy uses compact text without modifying either note", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page.locator(".reference-editor")).toBeVisible();
  const before = await page.locator(".reference-editor").textContent();
  const copied = await clipboard(page, ".reference-editor");
  expect(copied.text).toBe(plain);
  expect(await page.locator(".reference-editor").textContent()).toBe(before);
  await expect(page.locator(".document-editor")).toContainText("Daily team meeting");
});

test("cut uses compact text and Undo restores the saved note", async ({ page }) => {
  await open(page);
  await page.locator(".document-editor").focus();
  const cut = await clipboard(page, ".document-editor", "cut");
  expect(cut.text).toBe(plain);
  await expect(page.locator(".document-editor")).toHaveText("");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".document-editor")).toContainText("Daily team meeting");
  expect((await clipboard(page, ".document-editor")).text).toBe(plain);
  await page.getByRole("button", { name: /Save now/ }).click();
  await page.reload();
  await expect(page.locator(".document-editor")).toContainText("Daily team meeting");
  expect((await clipboard(page, ".document-editor")).text).toBe(plain);
});

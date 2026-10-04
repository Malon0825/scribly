import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const stamp = "2026-10-03T00:00:00Z";
const fixture: Workspace = {
  theme: "light", activeId: "first", referenceId: "first", folders: [{ id: "work", name: "Work" }],
  notes: [{ id: "first", title: "Colors", folderId: "work", archived: false,
    content: "<p><strong>Selected words</strong> stay here</p><ul><li><p>List item</p></li></ul><pre><code>const code = true;</code></pre>", createdAt: stamp, updatedAt: stamp }],
};
async function open(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((document) => {
    if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
  }, { ...fixture, theme });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
}
async function select(page: Page) {
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.locator("p").first().click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < "Selected words".length; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Selected words");
  await expect(page.getByRole("button", { name: "Text and background color options", exact: true })).toBeEnabled();
}
const palette = (page: Page) => page.getByRole("dialog", { name: "Selection colors", exact: true });
async function context(page: Page) {
  const el = page.locator(".document-editor strong").first();
  // Native right-click over the existing selection must not collapse it.
  await el.click({ button: "right" });
  await expect(palette(page)).toBeVisible();
}
test("compact right-click palette formats only selected text and preserves bold/list/content", async ({ page }) => {
  await open(page); await select(page); await context(page);
  await expect(palette(page).getByRole("group", { name: "Text colors", exact: true }).getByRole("button")).toHaveCount(3);
  await expect(palette(page).getByRole("group", { name: "Background colors", exact: true }).getByRole("button")).toHaveCount(3);
  await palette(page).getByRole("button", { name: "Purple text", exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator('.document-editor [data-text-color="purple"]')).toHaveText("Selected words");
  await expect(page.locator('.document-editor strong')).toHaveText("Selected words");
  await expect(page.locator('.document-editor li')).toHaveText("List item");
  await expect(page.locator('.document-editor p').first()).toHaveText("Selected words stay here");
  await context(page);
  await palette(page).getByRole("button", { name: "Green background", exact: true }).click();
  await expect(page.locator('.document-editor [data-background-color="green"]')).toHaveText("Selected words");
  await context(page);
  await palette(page).getByRole("button", { name: "Default text", exact: true }).click();
  await expect(page.locator('.document-editor [data-text-color]')).toHaveCount(0);
  await expect(page.locator('.document-editor [data-background-color="green"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('.document-editor [data-text-color="purple"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('.document-editor [data-text-color]')).toHaveCount(0);
});
test("expanded palette is keyboard accessible; colors persist and Reference stays read-only", async ({ page }) => {
  await open(page); await select(page);
  await page.keyboard.press("Shift+F10");
  await expect(palette(page)).toBeVisible();
  await expect(palette(page).getByRole("button", { name: "Blue text", exact: true })).toBeFocused();
  await palette(page).getByRole("button", { name: "More colors", exact: true }).click();
  await expect(palette(page).getByRole("group", { name: "Text colors", exact: true }).getByRole("button")).toHaveCount(9);
  await expect(palette(page).getByRole("group", { name: "Background colors", exact: true }).getByRole("button")).toHaveCount(9);
  await palette(page).getByRole("button", { name: "Red text", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Text and background color options", exact: true }).click();
  await palette(page).getByRole("button", { name: "More colors", exact: true }).click();
  await palette(page).getByRole("button", { name: "Yellow background", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[0].content)).toContain('data-background-color="yellow"');
  await page.reload();
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page.locator('.document-editor [data-text-color="red"]')).toHaveText("Selected words");
  await expect(page.locator('.reference-editor [data-background-color="yellow"]')).toHaveText("Selected words");
  await page.locator('.reference-editor strong').click({ button: "right" });
  await expect(palette(page)).toHaveCount(0);
  // Reference retains the browser's native context menu; dismiss it before editing.
  await page.keyboard.press("Escape");
  await select(page); await context(page);
  await palette(page).getByRole("button", { name: "Default background", exact: true }).click();
  await expect(page.locator('.document-editor [data-background-color]')).toHaveCount(0);
  await expect(page.locator('.document-editor [data-text-color="red"]')).toHaveCount(1);
});
test("dismissal and menu replacement preserve editor identity; empty and code selections use native menu", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.evaluate(el => { (window as any).colorEditor = el; });
  await editor.locator("p").first().click({ button: "right" });
  await expect(palette(page)).toHaveCount(0);
  await select(page); await context(page);
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0); await expect(editor).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("button", { name: "Options for Work", exact: true }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Folder options", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await select(page); await context(page);
  await editor.locator("p").first().click(); await expect(palette(page)).toHaveCount(0);
  await editor.locator(".code-block code").click(); await page.keyboard.press("Home"); await page.keyboard.press("Shift+End");
  await expect(page.getByRole("button", { name: "Text and background color options", exact: true })).toBeDisabled();
  await editor.locator(".code-block code").click({ button: "right" }); await expect(palette(page)).toHaveCount(0);
  expect(await editor.evaluate(el => el === (window as any).colorEditor)).toBe(true);
});
for (const theme of ["light", "dark"] as const) test(`${theme} palette stays in a narrow viewport and respects reduced motion`, async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 600 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, theme);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await select(page);
  await page.getByRole("textbox", { name: "Note content", exact: true }).evaluate(el => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 842, clientY: 588 })));
  await expect(palette(page)).toBeVisible();
  await palette(page).getByRole("button", { name: "More colors", exact: true }).click();
  const box = await palette(page).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(9); expect(box!.y).toBeGreaterThanOrEqual(9);
  expect(box!.x + box!.width).toBeLessThanOrEqual(841); expect(box!.y + box!.height).toBeLessThanOrEqual(591);
  expect(await palette(page).evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  await page.screenshot({ path: `test-results/selection-colors-${theme}.png` });
});
for (const theme of ["light", "dark"] as const) test(`${theme} authored text colors remain readable with every background choice`, async ({ page }) => {
  await open(page, theme);
  const minimum = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const colors = ["blue", "purple", "green", "gray", "brown", "orange", "yellow", "pink", "red"];
    const luminance = (hex: string) => {
      const c = hex.trim().slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
    };
    const foregrounds = [css.getPropertyValue("--text"), ...colors.map(c => css.getPropertyValue(`--note-${c}`))];
    const backgrounds = [css.getPropertyValue("--panel"), ...colors.map(c => css.getPropertyValue(`--note-bg-${c}`))];
    return Math.min(...foregrounds.flatMap(fg => backgrounds.map(bg => {
      const f = luminance(fg), b = luminance(bg); return (Math.max(f, b) + .05) / (Math.min(f, b) + .05);
    })));
  });
  expect(minimum).toBeGreaterThanOrEqual(4.5);
});
test("portable backup imports keep validated color marks and strip arbitrary style/attributes", async ({ page }) => {
  await open(page);
  const content = '<p><span data-text-color="purple" data-background-color="yellow" style="color:red" onclick="alert(1)">Safe</span><span data-text-color="url(evil)" data-background-color="invalid">Plain</span></p>';
  await page.getByRole("button", { name: "Options for Work", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import files…", exact: true }).click();
  await (await chooser).setFiles({ name: "colors-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] })) });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes.length)).toBe(2);
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document.notes[1].content);
  expect(result).toContain('data-text-color="purple"'); expect(result).toContain('data-background-color="yellow"');
  expect(result).not.toMatch(/style=|onclick=|url\(evil\)|invalid/);
});

import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";

const stamp = "2026-10-02T00:00:00.000Z";
const fixture: Workspace = {
  theme: "light", activeId: "first", referenceId: null,
  folders: [{ id: "work", name: "Personal" }, { id: "data", name: "Work" }],
  notes: [{ id: "first", title: "Little ideas", folderId: "work", archived: false,
    content: "<p>Keep this draft</p>", createdAt: stamp, updatedAt: stamp }],
};
async function keyboardOpen(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).focus();
  await page.keyboard.press("Enter");
}
for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} menu ownership`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((document) => {
        localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Test" }));
      }, { ...fixture, theme });
      await page.goto("/");
      await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Little ideas");
    });

    test("folder and note ellipsis menus replace each other, toggle off, and keep the editor draft", async ({ page }) => {
      const editor = page.getByRole("textbox", { name: "Note content", exact: true });
      await editor.fill("Draft just written");
      await editor.evaluate((el) => { (window as any).originalEditor = el; });
      await page.getByRole("button", { name: "Options for Personal", exact: true }).click();
      await keyboardOpen(page, "Actions for Little ideas");
      await expect(page.locator(".folder-dropdown")).toHaveCount(0);
      await expect(page.locator(".sidebar-note-dropdown")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Actions for Little ideas", exact: true })).toHaveAttribute("aria-expanded", "true");
      await keyboardOpen(page, "Options for Personal");
      await expect(page.locator(".sidebar-note-dropdown")).toHaveCount(0);
      await expect(page.locator(".folder-dropdown")).toHaveCount(1);
      await keyboardOpen(page, "Options for Personal");
      await expect(page.locator(".dropdown")).toHaveCount(0);
      await keyboardOpen(page, "Actions for Little ideas");
      await keyboardOpen(page, "Actions for Little ideas");
      await expect(page.locator(".dropdown")).toHaveCount(0);
      await expect(editor).toHaveText("Draft just written");
      expect(await editor.evaluate((el) => el === (window as any).originalEditor)).toBe(true);
    });

    test("right-click replaces an open folder menu; Escape and outside click dismiss the active menu", async ({ page }) => {
      await page.getByRole("button", { name: "Options for Personal", exact: true }).click();
      // Exercise context-menu replacement independently of popup placement:
      // a floating menu can cover the first note at this viewport size.
      await page.locator(".note-select").dispatchEvent("contextmenu", { button: 2 });
      await expect(page.locator(".folder-dropdown")).toHaveCount(0);
      await expect(page.locator(".sidebar-note-dropdown")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".dropdown")).toHaveCount(0);
      await keyboardOpen(page, "Options for Personal");
      await keyboardOpen(page, "Actions for Little ideas");
      await page.getByRole("textbox", { name: "Note title", exact: true }).click();
      await expect(page.locator(".dropdown")).toHaveCount(0);
    });

    test("editor options and sidebar menus replace each other too", async ({ page }) => {
      await page.getByRole("button", { name: "Note options", exact: true }).click();
      await keyboardOpen(page, "Actions for Little ideas");
      await expect(page.locator(".note-dropdown")).toHaveCount(0);
      await expect(page.locator(".sidebar-note-dropdown")).toHaveCount(1);
      await page.getByRole("button", { name: "Note options", exact: true }).click();
      await expect(page.locator(".sidebar-note-dropdown")).toHaveCount(0);
      await expect(page.locator(".note-dropdown")).toHaveCount(1);
      await keyboardOpen(page, "Options for Personal");
      await expect(page.locator(".note-dropdown")).toHaveCount(0);
      await expect(page.locator(".folder-dropdown")).toHaveCount(1);
      await page.getByRole("button", { name: "Note options", exact: true }).click();
      await expect(page.locator(".folder-dropdown")).toHaveCount(0);
      await expect(page.locator(".note-dropdown")).toHaveCount(1);
    });
  });
}

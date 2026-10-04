import { test, expect } from "@playwright/test";

const key = "still-notes-browser-v1";

test("a fresh notebook opens Introduction, saves, and lets the user start writing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".folder-toggle")).toHaveText(["Introduction"]);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome to Scribly");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Your notebook, your way.");
  await expect.poll(() => page.evaluate(key => {
    const stored = localStorage.getItem(key);
    return stored && JSON.parse(stored).document.notes.length;
  }, key)).toBe(1);
  await page.reload();
  await expect(page.locator(".folder-toggle")).toHaveText(["Introduction"]);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome to Scribly");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Note title" });
  await expect(title).not.toHaveValue("Welcome to Scribly");
  await title.fill("My first note");
  await page.getByRole("textbox", { name: "Note content", exact: true }).fill("My own writing.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(key => {
    const stored = localStorage.getItem(key);
    return stored && JSON.parse(stored).document.notes.find((note: any) => note.title === "My first note")?.content;
  }, key)).toContain("My own writing.");
  await page.reload();
  await expect(title).toHaveValue("My first note");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("My own writing.");
  await expect(page.locator(".folder-toggle")).toHaveText(["Introduction"]);
});

test("an existing notebook keeps its folders and notes without adding the starter", async ({ page }) => {
  const document = {
    theme: "dark", activeId: "existing", referenceId: null,
    folders: [{ id: "custom", name: "My notebook" }],
    notes: [{ id: "existing", folderId: "custom", title: "Keep this note", content: "<p>Existing writing stays here.</p>",
      createdAt: "2026-10-01", updatedAt: "2026-10-01", archived: false }],
  };
  await page.addInitScript(({ key, document }) => {
    if (sessionStorage.getItem("existing-starter-test")) return;
    localStorage.setItem(key, JSON.stringify({ revision: 1, document, dataPath: "Existing notebook test" }));
    sessionStorage.setItem("existing-starter-test", "1");
  }, { key, document });
  await page.goto("/");
  await expect(page.locator(".folder-toggle")).toHaveText(["My notebook"]);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Keep this note");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toContainText("Existing writing stays here.");
  await page.reload();
  await expect(page.locator(".folder-toggle")).toHaveText(["My notebook"]);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document, key);
  expect(stored.folders).toEqual(document.folders);
  expect(stored.notes).toEqual(document.notes);
});

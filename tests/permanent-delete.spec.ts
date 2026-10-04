import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/types";
const stamp = "2026-10-02T00:00:00.000Z";
const note = (id: string,title: string,folderId: string | null,archived=false) => ({ id,title,folderId,archived,content:`<p>${title} content</p>`,createdAt:stamp,updatedAt:stamp });
const fixture: Workspace = { theme:"light",activeId:"first",referenceId:"first",folders:[{ id:"work",name:"Work" },{ id:"data",name:"Other folder" }],
  notes:[note("first","First note","work"),note("other","Other note","data"),note("second","Second note","work"),note("loose","Loose note",null),note("old","Archived note","work",true)] };
async function open(page: Page,workspace=fixture) {
  await page.addInitScript(document => { if (!localStorage.getItem("still-notes-browser-v1")) localStorage.setItem("still-notes-browser-v1",JSON.stringify({ revision:1,document,dataPath:"Test" })); },workspace);
  await page.goto("/"); await expect(title(page)).toBeVisible();
}
const title = (page: Page) => page.getByRole("textbox",{ name:"Note title",exact:true });
const saved = (page: Page): Promise<Workspace> => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document);
async function deleteItem(page: Page,title: string) {
  await page.getByRole("button",{ name:`Actions for ${title}`,exact:true }).click();
  await page.locator(".sidebar-note-dropdown").getByRole("button",{ name:"Delete permanently",exact:true }).click();
  await page.getByRole("dialog").getByRole("button",{ name:"Delete permanently",exact:true }).click();
  await expect.poll(async () => (await saved(page)).notes.some(note => note.title===title)).toBe(false);
}
test("live menu confirms permanent deletion; Cancel retains the note",async ({ page }) => {
  await open(page); await page.getByRole("button",{ name:"Actions for Second note",exact:true }).click();
  await page.locator(".sidebar-note-dropdown").getByRole("button",{ name:"Delete permanently",exact:true }).click();
  await expect(page.getByRole("dialog")).toContainText("Second note");
  await page.getByRole("dialog").getByRole("button",{ name:"Cancel",exact:true }).click();
  expect((await saved(page)).notes.some(note => note.id === "second")).toBe(true);
});
test("deleting the active note chooses a folder sibling and clears Reference across restart",async ({ page }) => {
  await open(page); await deleteItem(page,"First note");
  await expect(title(page)).toHaveValue("Second note"); expect((await saved(page)).referenceId).toBeNull(); await page.reload();
  await expect(title(page)).toHaveValue("Second note");
  await expect(page.getByRole("button",{ name:"Actions for First note",exact:true })).toHaveCount(0);
  expect((await saved(page)).notes.some(note => note.id==="first")).toBe(false);
});
test("deleting an inactive note preserves the editor instance, draft, query and Reference",async ({ page }) => {
  await open(page); const editor=page.getByRole("textbox",{ name:"Note content",exact:true });
  await editor.evaluate(element => { (window as any).originalEditor=element; }); await editor.fill("Draft just written");
  await page.getByRole("textbox",{ name:"Search notes" }).fill("note"); await deleteItem(page,"Second note");
  await expect(editor).toHaveText("Draft just written"); expect(await editor.evaluate(element => element===(window as any).originalEditor)).toBe(true);
  await expect(page.getByRole("textbox",{ name:"Search notes" })).toHaveValue("note"); expect((await saved(page)).referenceId).toBe("first");
  await page.reload(); await expect(editor).toHaveText("Draft just written");
});
test("only matching or Unfiled notes may replace the deleted active note",async ({ page }) => {
  await open(page); await page.getByRole("textbox",{ name:"Search notes" }).fill("First note"); await deleteItem(page,"First note");
  await expect(title(page)).toHaveCount(0); await expect(page.getByRole("textbox",{ name:"Search notes" })).toHaveValue("First note");
  await page.getByRole("button", { name: "Notebook navigation", exact: true }).click(); await page.getByRole("button",{ name:/^Unfiled notes/ }).click(); await deleteItem(page,"Loose note");
  await expect(title(page)).toHaveCount(0); await page.getByRole("button", { name: "Notebook navigation", exact: true }).click(); await expect(page.getByRole("button",{ name:/^Unfiled notes/ })).toHaveClass(/nav-active/); await page.keyboard.press("Escape");
});
test("archived notes support confirmed permanent deletion",async ({ page }) => {
  await open(page); await page.getByRole("button",{ name:/^Archive/ }).click(); await deleteItem(page,"Archived note");
  await expect(title(page)).toHaveCount(0); expect((await saved(page)).notes.some(note => note.id==="old")).toBe(false);
});
test("permanent deletion confirms from live notes; Cancel and Escape preserve content",async ({ page }) => {
  await page.setViewportSize({ width:850,height:600 }); await page.emulateMedia({ reducedMotion:"reduce" });
  await open(page,{ ...fixture,theme:"dark" });
  const request=async () => { await page.getByRole("button",{ name:"Actions for First note",exact:true }).click(); await page.locator(".sidebar-note-dropdown").getByRole("button",{ name:"Delete permanently",exact:true }).click(); };
  await request(); await expect(page.getByRole("dialog")).toContainText("“First note” will be permanently removed.");
  await expect(page.getByRole("dialog").getByRole("button",{ name:"Delete permanently",exact:true })).not.toBeFocused();
  await page.getByRole("dialog").getByRole("button",{ name:"Cancel",exact:true }).click(); await request(); await page.keyboard.press("Escape");
  expect((await saved(page)).notes.some(note => note.id==="first")).toBe(true);
  await request(); await page.screenshot({ path:"test-results-protection-visuals/protection-trash-confirmation-dark.png" });
  await page.getByRole("dialog").getByRole("button",{ name:"Delete permanently",exact:true }).click();
  await expect.poll(async () => (await saved(page)).notes.some(note => note.id==="first")).toBe(false);
  await page.reload(); await expect(page.getByRole("button",{ name:"Actions for First note",exact:true })).toHaveCount(0);
});

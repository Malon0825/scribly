import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { itemHref, itemIdFromHref, safeExternalHref } from "../src/itemLinks";
import { isTemplate, type Note, type Workspace } from "../src/types";
import { validateWorkspace } from "../src/workspaceValidation";
import { chooseTheme } from "./themeHelper";
import { boardCommand } from "./boardCommandHelper";
const time = "2026-10-04T00:00:00.000Z";
const note = (id: string,title: string,content = "<p>Write here.</p>"): Note => ({ id,title,content,folderId:"work",archived:false,createdAt:time,updatedAt:time });
const rich = '<h2>{{title}} · {{date}}</h2><p><strong>Keep formatting</strong> 日本語</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Completed task</p></li></ul><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=" alt="Template image">';
const template: Note = { ...note("t","Meeting template",rich),kind:"template",folderId:null,template:{ titlePattern:"{{title}} — {{date}}",resetChecklist:true } };
const fixture: Workspace = { schemaVersion:5,theme:"light",activeId:"a",referenceId:null,folders:[{ id:"work",name:"Work",copyLastNote:true }],notes:[note("a","Draft"),note("b","Project reference","<p>Reference stays read-only.</p>")],recentIds:["a"] };
async function seed(page: Page,document = fixture) {
  await page.addInitScript(document => { if (!sessionStorage.getItem("connected-seeded")) { localStorage.setItem("still-notes-browser-v1",JSON.stringify({ revision:1,document,dataPath:"Connected workflow test" })); sessionStorage.setItem("connected-seeded","1"); } },document);
  await page.goto("/"); await expect(page.getByRole("textbox",{ name:"Note title",exact:true })).toBeVisible();
}
const editor = (page: Page) => page.getByRole("textbox",{ name:"Note content",exact:true });
const saved = (page: Page) => expect(page.getByRole("button",{ name:"Saved in browser. Save now",exact:true })).toBeVisible();
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document as Workspace);
async function addLink(page: Page,title = "Project reference") {
  await editor(page).focus(); await page.keyboard.press("Control+End"); await page.keyboard.press("Control+l");
  const dialog=page.getByRole("dialog",{ name:"Link to an item",exact:true }); await expect(dialog).toBeVisible();
  await dialog.getByLabel("Search items").fill(title);
  await dialog.getByRole("group",{ name:"Link targets" }).getByRole("button").first().click();
  await dialog.getByRole("button",{ name:"Insert link",exact:true }).click();
}
async function saveTemplate(page: Page,name = "Meeting snapshot") {
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("button",{ name:"Save as template…",exact:true }).click();
  const dialog = page.getByRole("dialog",{ name:"Save note as template",exact:true });
  await dialog.getByLabel("Template name",{ exact:true }).fill(name); await dialog.getByLabel("Title pattern",{ exact:true }).fill("{{title}} — {{date}}");
  await dialog.getByLabel("Reset checklists in new notes").check(); await dialog.getByRole("button",{ name:"Save template",exact:true }).click(); await saved(page);
}

test("internal IDs encode Unicode and reject unsafe web schemes; template metadata stays bounded and valid", () => {
  for (const id of ["日本語", "a / b", "a", "uuid-123"]) expect(itemIdFromHref(itemHref(id))).toBe(id);
  for (const href of ["#scribly-item/", "#scribly-item/%zz", "#scribly-item/%00", "javascript:alert(1)", "file:///private"]) expect(itemIdFromHref(href)).toBeNull();
  expect(safeExternalHref("https://example.com/path?q=a&b=b")).toBe(true);
  for (const href of ["javascript:alert(1)","file:///private","data:text/html,test","https://example.com/\n"]) expect(safeExternalHref(href)).toBe(false);
  const document={ ...fixture,notes:[...fixture.notes,template],folders:[{ ...fixture.folders[0],templateId:"t" }] };
  expect(() => validateWorkspace(document)).not.toThrow();
  for (const templateId of ["missing","a",null]) expect(() => validateWorkspace({ ...document,folders:[{ ...fixture.folders[0],templateId }] })).toThrow();
  expect(() => validateWorkspace({ ...document,recentIds:["t"] })).toThrow();
  expect(() => validateWorkspace({ ...document,activeId:"t" })).toThrow();
});

test("note links preserve the editor and Undo, create derived backlinks, and follow rename/folder moves", async ({ page }) => {
  await seed(page); await addLink(page); const link=editor(page).locator('a[data-item-id="b"]'); await expect(link).toHaveText("Project reference");
  await editor(page).focus(); await page.keyboard.press("Control+z"); await expect(link).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z"); await expect(link).toHaveCount(1); await saved(page);
  await link.click({ modifiers:["Control"] }); await expect(page.getByRole("textbox",{ name:"Note title",exact:true })).toHaveValue("Project reference");
  await page.locator(".item-backlinks summary").click(); await expect(page.locator(".item-backlinks").getByRole("button",{ name:"Draft",exact:true })).toBeVisible();
  await page.getByRole("textbox",{ name:"Note title",exact:true }).fill("Renamed project"); await saved(page);
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("combobox",{ name:"Move note to folder",exact:true }).click(); await page.getByRole("option",{ name:"Unfiled notes",exact:true }).click();
  await page.locator(".item-backlinks").getByRole("button",{ name:"Draft",exact:true }).click(); await editor(page).locator('a[data-item-id="b"]').click({ modifiers:["Control"] });
  await expect(page.getByRole("textbox",{ name:"Note title",exact:true })).toHaveValue("Renamed project"); await saved(page); await page.reload();
  expect((await state(page)).notes.find(note => note.id==="a")!.content).toContain('data-item-id="b"');
});

test("cancel restores selection; linking selected text and opening Reference keep the main editor intact", async ({ page }) => {
  await seed(page); await editor(page).focus(); await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+l"); await page.getByRole("dialog",{ name:"Link to an item" }).getByRole("button",{ name:"Cancel",exact:true }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Write here.");
  await page.keyboard.press("Control+l"); const dialog=page.getByRole("dialog",{ name:"Link to an item" }); await dialog.getByLabel("Search items").fill("Project"); await dialog.getByRole("group",{ name:"Link targets" }).getByRole("button").click(); await dialog.getByRole("button",{ name:"Insert link",exact:true }).click();
  await expect(editor(page).locator('a[data-item-id="b"]')).toHaveText("Write here.");
  await editor(page).evaluate(element => { (window as any).connectedEditor=element; });
  await editor(page).locator("a").click({ modifiers:["Alt"] }); await page.getByRole("dialog",{ name:"Item link options" }).getByRole("button",{ name:"Open in Reference",exact:true }).click();
  await expect(page.getByRole("textbox",{ name:"Reference content",exact:true })).toContainText("Reference stays read-only.");
  expect(await editor(page).evaluate(element => element === (window as any).connectedEditor)).toBe(true); await expect(page.getByRole("textbox",{ name:"Note title",exact:true })).toHaveValue("Draft");
});

test("links to Archive and permanently deleted/missing targets stay retained with explicit actions; keyboard options work", async ({ page }) => {
  await seed(page,{ ...fixture,notes:[note("a","Draft",'<p><a data-item-id="b" href="#scribly-item/b">Saved target</a> <a data-item-id="missing" href="#scribly-item/missing">Missing target</a></p>'),{ ...fixture.notes[1],archived:true }] });
  const link=editor(page).locator('a[data-item-id="b"]'); await editor(page).focus(); await link.focus(); await expect(link).toBeFocused(); await page.keyboard.press("Enter");
  const options=page.getByRole("dialog",{ name:"Item link options" }); await expect(options).toContainText("Archived"); await expect(options.getByRole("button",{ name:"Open in Reference",exact:true })).toBeDisabled(); await options.getByRole("button",{ name:"Open",exact:true }).click();
  await expect(page.getByRole("textbox",{ name:"Reference content",exact:true })).toContainText("Reference stays read-only.");
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("dialog",{ name:"Note options",exact:true }).getByRole("button",{ name:"Delete permanently",exact:true }).click(); await page.getByRole("dialog").getByRole("button",{ name:"Delete permanently",exact:true }).click();
  await page.getByRole("button", { name: "Notebook navigation", exact: true }).click(); await page.getByRole("button",{ name:/^Unfiled notes/ }).click(); const folder=page.getByRole("button",{ name:"Work",exact:true }); await folder.click(); if (await folder.getAttribute("aria-expanded")==="false") await folder.click(); await page.locator('[data-sidebar-item="note:a"]').click(); await saved(page); await editor(page).locator('a[data-item-id="b"]').click({ modifiers:["Alt"] });
  await expect(page.getByRole("dialog",{ name:"Item link options" })).toContainText("link is retained"); await page.keyboard.press("Escape");
  await editor(page).locator('a[data-item-id="missing"]').click({ modifiers:["Alt"] }); const missing=page.getByRole("dialog",{ name:"Item link options" }); await expect(missing.getByRole("button",{ name:"Open",exact:true })).toBeDisabled(); await expect(missing).toContainText("link is retained");
});

test("templates snapshot formatting/images/checklists independently and instantiate title/date with optional reset", async ({ page }) => {
  await seed(page,{ ...fixture,notes:[note("a","Meeting source",rich),fixture.notes[1]] }); await saveTemplate(page);
  await editor(page).focus(); await page.keyboard.press("Control+End"); await page.keyboard.type("Changed source only"); await saved(page);
  await page.getByRole("button", { name: "New note options", exact: true }).click(); await page.getByRole("button",{ name:"New from template…",exact:true }).click(); const choose=page.getByRole("dialog",{ name:"New note from template",exact:true }); await expect(choose.getByLabel("Template preview")).not.toContainText("Changed source only"); await choose.getByLabel("Note title",{ exact:true }).fill("Planning"); await choose.getByRole("button",{ name:"Create note",exact:true }).click();
  await expect(page.getByRole("textbox",{ name:"Note title",exact:true })).toHaveValue(/^Planning — \d{4}-\d{2}-\d{2}$/); await expect(editor(page).locator("strong")).toHaveText("Keep formatting"); await expect(editor(page).locator("img")).toHaveCount(1); await expect(editor(page).getByRole("checkbox")).not.toBeChecked();
  await editor(page).focus(); await page.keyboard.press("Control+End"); await page.keyboard.type("Independent child"); await saved(page); await page.reload();
  const document=await state(page); expect(document.notes.filter(isTemplate)).toHaveLength(1); expect(document.notes.find(isTemplate)!.content).not.toContain("Independent child");
  await page.getByRole("button", { name: "New note options", exact: true }).click(); await page.getByRole("button",{ name:"New from template…",exact:true }).click(); const again=page.getByRole("dialog",{ name:"New note from template",exact:true }); await again.getByLabel("Reset checklists in new notes").uncheck(); await again.getByRole("button",{ name:"Create note",exact:true }).click(); await expect(editor(page).getByRole("checkbox")).toBeChecked();
});

test("folder templates take precedence over Copy last note; deleting defaults preserves existing notes", async ({ page }) => {
  await seed(page,{ ...fixture,notes:[...fixture.notes,template],folders:[{ ...fixture.folders[0],templateId:"t" }] });
  await page.getByRole("button",{ name:"New note",exact:true }).click(); await expect(editor(page)).toContainText("Keep formatting"); await saved(page); const child=(await state(page)).activeId;
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("button",{ name:"Manage note templates…",exact:true }).click(); const manage=page.getByRole("dialog",{ name:"Note templates",exact:true });
  await manage.getByLabel("Template name",{ exact:true }).fill("Updated meeting"); await manage.getByRole("button",{ name:"Save changes",exact:true }).click(); await saved(page);
  await manage.getByRole("button",{ name:"Delete template…",exact:true }).click(); await manage.getByRole("button",{ name:"Keep template",exact:true }).click(); await expect(manage.getByRole("button",{ name:"Delete template…",exact:true })).toBeVisible(); await manage.getByRole("button",{ name:"Delete template…",exact:true }).click(); await manage.getByRole("button",{ name:"Delete template permanently",exact:true }).click(); await manage.getByRole("button",{ name:"Close",exact:true }).click(); await saved(page);
  const document=await state(page); expect(document.folders[0].templateId).toBeUndefined(); expect(document.notes.find(note => note.id===child)!.content).toContain("Keep formatting"); expect(document.notes.some(isTemplate)).toBe(false);
  await page.getByRole("button",{ name:"New note",exact:true }).click(); await expect(editor(page)).toContainText("Keep formatting");
});

test("backup import remaps note/board/self links and template defaults without stealing existing folder settings", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1","source-module harness; UI backup round trip is separate"); await seed(page);
  const result=await page.evaluate(async ({ fixture,template }) => {
    const { mergeBackup,parseBackup }=await import("/src/importBackup.ts"); const { linkedIds,linkHtml }=await import("/src/itemLinks.ts"); const { instantiateTemplate }=await import("/src/noteTemplates.ts");
    const { emptyBoard }=await import("/src/boardData.ts");
    const board={ ...fixture.notes[0],id:"board",kind:"board",content:"",board:{ ...emptyBoard(),elements:[{id:"shape",type:"rectangle",x:0,y:0,width:100,height:100,isDeleted:false,link:"#scribly-item/b"}] } };
    const archive={ ...fixture,folders:[{ id:"work",name:"Imported work",templateId:"t" }],notes:[{ ...fixture.notes[0],content:`<p>${linkHtml("b","Other")}${linkHtml("a","Self")}</p>` },fixture.notes[1],{ ...template,content:`<p>${linkHtml("t","Self")}${linkHtml("b","Other")}</p>` },board] };
    const parsed=parseBackup(archive); const merged=mergeBackup(fixture,parsed), imported=merged.notes.slice(fixture.notes.length), folder=merged.folders.find((folder: any) => folder.name==="Imported work");
    const first=imported[0],second=imported[1],savedTemplate=imported[2], child=instantiateTemplate(savedTemplate,"new-child","Created");
    const matched=mergeBackup(fixture,parseBackup({ ...archive,folders:[{ ...archive.folders[0],name:"Work" }] }));
    return { ids:imported.map((note: any)=>note.id),links:[...linkedIds(first)],boardLinks:[...linkedIds(imported[3])],existingFolder:matched.folders[0],defaultId:folder.templateId,child:child.content,templateId:savedTemplate.id,otherId:second.id };
  },{ fixture,template });
  expect(result.ids).not.toContain("a"); expect(result.links).toEqual(expect.arrayContaining(result.ids.slice(0,2))); expect(result.defaultId).toBe(result.templateId); expect(result.child).toContain('data-item-id="new-child"'); expect(result.child).toContain(`data-item-id="${result.otherId}"`);
  expect(result.boardLinks).toEqual([result.otherId]); expect(result.existingFolder).toEqual(fixture.folders[0]);
});

test("duplicate remaps only self links; folder defaults can be configured through their own menu", async ({ page }) => {
  await seed(page,{ ...fixture,notes:[note("a","Draft",'<p><a data-item-id="a" href="#scribly-item/a">Self</a> <a data-item-id="b" href="#scribly-item/b">Other</a></p>'),fixture.notes[1],template] });
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("dialog",{ name:"Note options",exact:true }).getByRole("button",{ name:"Duplicate note",exact:true }).click(); await saved(page);
  const copied=await state(page); await expect(editor(page).locator('a').first()).toHaveAttribute("data-item-id",copied.activeId); await expect(editor(page).locator('a').last()).toHaveAttribute("data-item-id","b");
  await page.getByRole("button",{ name:"Options for Work",exact:true }).click(); await page.getByRole("combobox",{ name:"Default note template",exact:true }).click(); await page.getByRole("option",{ name:"Meeting template",exact:true }).click(); await saved(page); await page.reload();
  expect((await state(page)).folders[0].templateId).toBe("t"); await page.getByRole("button",{ name:"New note",exact:true }).click(); await expect(editor(page)).toContainText("Keep formatting");
});

test("templates survive source purge and a portable notebook backup round trip", async ({ page }) => {
  await seed(page,{ ...fixture,notes:[note("a","Meeting source",rich),fixture.notes[1]] }); await saveTemplate(page);
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("dialog",{ name:"Note options",exact:true }).getByRole("button",{ name:"Delete permanently",exact:true }).click(); await page.getByRole("dialog").getByRole("button",{ name:"Delete permanently",exact:true }).click(); await saved(page);
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click(); const downloadPromise=page.waitForEvent("download"); await page.getByRole("button",{ name:"Export notebook backup",exact:true }).click(); const download=await downloadPromise; const path=await download.path(); expect(path).toBeTruthy(); await page.getByRole("button",{ name:"Close dialog",exact:true }).click();
  await page.getByLabel("Import files",{ exact:true }).setInputFiles({ name:"template-backup.json",mimeType:"application/json",buffer:await readFile(path!) }); await saved(page);
  await page.getByRole("button", { name: "New note options", exact: true }).click(); await page.getByRole("button",{ name:"New from template…",exact:true }).click(); const choose=page.getByRole("dialog",{ name:"New note from template",exact:true }); await expect(choose.getByLabel("Template preview").locator("img")).toHaveCount(1); await choose.getByRole("button",{ name:"Create note",exact:true }).click(); await expect(editor(page).locator("img")).toHaveCount(1);
});

test("board links add a label, persist, participate in backlinks and undo as a single drawing edit", async ({ page }) => {
  await seed(page); await page.getByRole("button",{ name:"New board",exact:true }).click(); await expect(page.locator(".board-canvas canvas").first()).toBeVisible(); await boardCommand(page, "Link to item"); const dialog=page.getByRole("dialog",{ name:"Link to an item" }); await dialog.getByLabel("Search items").fill("Project"); await dialog.getByRole("group",{ name:"Link targets" }).getByRole("button").click(); await dialog.getByRole("button",{ name:"Insert link",exact:true }).click(); await expect(page.locator(".board-message")).toContainText("Item link added"); await saved(page);
  let document=await state(page); const board=document.notes.find(note => note.id===document.activeId)!; expect(board.kind).toBe("board"); if (board.kind!=="board") throw Error("Missing board"); expect(board.board.elements.some(element => element.link===itemHref("b"))).toBe(true);
  await page.locator(".board-canvas canvas.interactive").click({ position:{ x:20,y:200 } }); await page.keyboard.press("Control+z"); await saved(page); document=await state(page); const undone=document.notes.find(note => note.id===board.id)!; if (undone.kind!=="board") throw Error("Missing board"); expect(undone.board.elements.filter(element => !element.isDeleted && element.link===itemHref("b"))).toHaveLength(0);
  await page.keyboard.press("Control+Shift+z"); await saved(page); document=await state(page); const redone=document.notes.find(note => note.id===board.id)!; if (redone.kind!=="board") throw Error("Missing board"); expect(redone.board.elements.some(element => !element.isDeleted && element.link===itemHref("b"))).toBe(true);
  await page.getByRole("button",{ name:"Project reference",exact:true }).first().click(); await page.locator(".item-backlinks summary").click(); await expect(page.locator(".item-backlinks")).toContainText(board.title);
  await page.locator(".item-backlinks").getByRole("button",{ name:board.title,exact:true }).click(); await saved(page); await page.reload(); await expect(page.locator(".board-canvas canvas.interactive")).toBeVisible();
});

test("workflow dialogs fit narrow/light and wide/dark/reduced-motion viewports with keyboard cancellation", async ({ page }) => {
  await mkdir(".impeccable/review",{ recursive:true }); await page.setViewportSize({ width:850,height:600 }); await seed(page,{ ...fixture,notes:[...fixture.notes,template] }); await addLink(page);
  await editor(page).focus(); await page.keyboard.press("Control+l"); const picker=page.getByRole("dialog",{ name:"Link to an item" }); await picker.getByRole("group",{ name:"Link targets" }).getByRole("button").last().click(); await expect(picker.getByRole("button",{ name:"Cancel",exact:true })).toBeInViewport(); await page.screenshot({ path:".impeccable/review/phase4-links-narrow-light.png" }); await page.keyboard.press("Escape");
  await page.setViewportSize({ width:1440,height:920 }); await chooseTheme(page, "dark"); await page.emulateMedia({ reducedMotion:"reduce" }); await page.getByRole("button", { name: "New note options", exact: true }).click(); await page.getByRole("button",{ name:"New from template…",exact:true }).click(); const choose=page.getByRole("dialog",{ name:"New note from template" }); await expect(choose.getByRole("button",{ name:"Create note",exact:true })).toBeInViewport(); await page.screenshot({ path:".impeccable/review/phase4-template-wide-dark.png" }); await page.keyboard.press("Escape");
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("button",{ name:"Manage note templates…",exact:true }).click(); await page.setViewportSize({ width:850,height:600 }); const manage=page.getByRole("dialog",{ name:"Note templates",exact:true }); await manage.getByRole("button",{ name:"Delete template…",exact:true }).scrollIntoViewIfNeeded(); await manage.getByRole("button",{ name:"Delete template…",exact:true }).click(); await manage.getByRole("button",{ name:"Delete template permanently",exact:true }).scrollIntoViewIfNeeded(); await expect(manage.getByRole("button",{ name:"Delete template permanently",exact:true })).toBeInViewport(); await page.screenshot({ path:".impeccable/review/phase4-template-delete-narrow-dark.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth)).toBe(true); await page.keyboard.press("Escape");
});

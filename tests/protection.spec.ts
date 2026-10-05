import { chooseTheme } from "./themeHelper";
import { test, expect, type Page } from "@playwright/test";
import { emptyBoard } from "../src/boardData";
import type { Workspace } from "../src/types";
test.setTimeout(120_000);
const key = "still-notes-browser-v1";
const time = "2026-10-04T00:00:00.000Z";
const fixture: Workspace = { schemaVersion: 2, theme: "light", folders: [{ id: "f", name: "Work" }], activeId: "a", referenceId: "a", notes: [
  { id: "a", folderId: "f", title: "Important", content: "<p>Original writing 日本語</p>", archived: false, createdAt: time, updatedAt: time },
  { id: "b", folderId: null, title: "Another", content: "<p>Other writing</p>", archived: false, createdAt: time, updatedAt: time },
] };
async function seed(page: Page, document = fixture) {
  await page.addInitScript(({ document, key }) => { if (sessionStorage.getItem("protection-seeded")) return; localStorage.setItem(key,JSON.stringify({ revision: 1, document, dataPath: "Protection test" })); sessionStorage.setItem("protection-seeded","1"); }, { document, key });
  await page.goto("/"); await expect(page.getByRole("textbox",{ name: "Note title", exact: true })).toBeVisible();
}
async function saved(page: Page) { await expect(page.getByRole("button",{ name: "Saved in browser. Save now", exact: true })).toBeVisible(); }
const legacyFixture: Workspace = { ...fixture, schemaVersion: 5, activeId: "b", referenceId: null, notes: [{ ...fixture.notes[0], deletedAt: time }, fixture.notes[1]] };
async function openEarlierDeletions(page: Page) {
  await page.getByRole("button", { name: "Notebook navigation", exact: true }).click();
  await page.getByRole("button", { name: /^Earlier deletions/ }).click();
}

test("earlier deletions preserve bytes after reload and confirm purge",async ({ page }) => {
  await seed(page, legacyFixture); await page.reload();
  await openEarlierDeletions(page);
  await expect(page.locator(".document-panel .note-content")).toContainText("Original writing 日本語");
  await expect(page.getByRole("textbox",{ name: "Note title",exact:true })).toHaveAttribute("readonly","");
  await page.getByRole("button",{ name: "Delete permanently", exact:true }).first().click();
  await page.getByRole("dialog").getByRole("button",{ name: "Cancel",exact:true }).click();
  await expect(page.locator(".document-panel .note-content")).toContainText("Original writing");
  await page.getByRole("button",{ name: "Delete permanently", exact:true }).first().click();
  await page.getByRole("dialog").getByRole("button",{ name: "Delete permanently",exact:true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.notes.some((note: any) => note.id === "a"),key)).toBe(false);
});

test("earlier deletion restore falls back to Unfiled after folder removal; archive stays distinct",async ({ page }) => {
  await seed(page, legacyFixture);
  await page.getByRole("button",{ name: "Options for Work",exact:true }).click();
  await page.getByRole("button",{ name: "Remove folder",exact:true }).click();
  await page.getByRole("dialog").getByRole("button",{ name: "Remove folder",exact:true }).click();
  await openEarlierDeletions(page);
  await page.getByRole("button",{ name: "Restore item", exact:true }).first().click();
  await saved(page);
  await page.getByRole("textbox",{ name: "Note content",exact:true }).fill("Editable after Trash restore"); await saved(page);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.notes.find((note: any) => note.id === "a").folderId,key)).toBeNull();
  await page.getByRole("button",{ name: "Note options",exact:true }).click();
  await page.getByRole("button",{ name: "Archive note",exact:true }).click();
  await page.getByRole("button",{ name: /^Archive/ }).click();
  await expect(page.locator(".archive-banner")).toContainText("archived");
  await expect(page.locator(".document-panel [contenteditable=true]")).toHaveCount(0);
});

test("Version history survives restart and restoration preserves the newer content",async ({ page }) => {
  await seed(page);
  await page.getByRole("textbox",{ name: "Note content",exact:true }).fill("A later draft"); await saved(page);
  await page.reload();
  await page.getByRole("button",{ name: "Note options",exact:true }).click();
  await page.getByRole("button",{ name: "Version history",exact:true }).click();
  await expect(page.getByRole("dialog").locator(".history-preview")).toContainText("Original writing 日本語");
  await page.getByRole("button",{ name: "Restore this version",exact:true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await saved(page);
  await expect(page.getByRole("textbox",{ name: "Note content",exact:true })).toContainText("Original writing 日本語");
  await page.getByRole("button",{ name: "Note options",exact:true }).click();
  await page.getByRole("button",{ name: "Version history",exact:true }).click();
  await expect(page.getByRole("dialog").locator(".history-preview")).toContainText("A later draft");
  const picker = page.getByRole("combobox",{ name:"Saved version",exact:true });
  await picker.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button",{ name:"Close",exact:true }).click();
  await chooseTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("button",{ name:"Note options",exact:true }).click();
  await page.getByRole("button",{ name:"Version history",exact:true }).click();
  await expect(page.getByRole("dialog").locator(".history-preview")).toContainText("A later draft");
  await page.screenshot({ path: "test-results-protection-visuals/protection-history-wide.png" });
});

test("Backup now, preview replace, safety copy and cancel preserve the notebook",async ({ page }) => {
  await seed(page);
  await page.getByRole("button",{ name: "Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button",{ name: "Backup now",exact:true }).click();
  await expect(page.getByRole("button",{ name: "Preview restore",exact:true })).toHaveCount(1);
  await page.getByRole("button",{ name: "Done",exact:true }).click();
  await page.getByRole("textbox",{ name: "Note content",exact:true }).fill("Newer writing to protect"); await saved(page);
  await page.getByRole("button",{ name: "Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button",{ name: "Preview restore",exact:true }).click();
  await page.getByLabel("Replace this notebook",{ exact:true }).check();
  await expect(page.getByRole("button",{ name: "Replace notebook",exact:true })).toBeDisabled();
  await page.getByRole("button",{ name: "Cancel",exact:true }).click();
  await expect(page.getByRole("textbox",{ name: "Note content",exact:true })).toContainText("Newer writing");
  await page.getByRole("button",{ name: "Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button",{ name: "Preview restore",exact:true }).click();
  await page.getByLabel("Replace this notebook",{ exact:true }).check();
  await page.getByLabel("I understand this replaces the current notes and folders.").check();
  await page.getByRole("button",{ name: "Replace notebook",exact:true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await saved(page);
  await expect(page.getByRole("textbox",{ name: "Note content",exact:true })).toContainText("Original writing");
  await page.getByRole("button",{ name: "Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await expect(page.locator(".backup-list")).toContainText("Before replacement");
  await page.setViewportSize({ width: 850,height:600 });
  await page.locator(".toast").waitFor({ state: "hidden" });
  await page.locator(".protection-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results-protection-visuals/protection-settings-narrow.png" });
});

test("daily scheduling and rotation retain only configured copies, including Trash and originals",async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1","Source module harness"); await seed(page);
  const result = await page.evaluate(async fixture => {
    const { saveBackup, readBackup, backupDue } = await import("/src/backups.ts");
    const { importFileBackup } = await import("/src/fileBackup.ts");
    const { storeSource } = await import("/src/sourceFiles.ts");
    const { sourceHtml } = await import("/src/sourceFileData.ts");
    const source = await storeSource(new Blob(["<xml>original</xml>"]),"data.xml","utf-8");
    const document: any = { ...fixture,schemaVersion:5,notes:[{ ...fixture.notes[0],content:sourceHtml(source),deletedAt:new Date().toISOString() }] };
    let config: any;
    for (let i = 0; i < 9; i++) config = await saveBackup(document,i);
    for (let i = 0; i < 4; i++) config = await saveBackup(document,i,true);
    const backup = await importFileBackup(await readBackup(config.entries[0]));
    return { ordinary: config.entries.filter((entry: any) => !entry.protected).length, safety: config.entries.filter((entry: any) => entry.protected).length,
      trash: !!backup.notes[0].deletedAt, source: backup.notes[0].content.includes("data-notify-source"),
      unchanged: backupDue({ ...config, enabled:true },8,Date.now()+86400_001),changed:backupDue({ ...config, enabled:true },9,Date.now()+86400_001),early:backupDue({ ...config,enabled:true },9),off:backupDue({ ...config,enabled:false },9,Date.now()+86400_001) };
  },fixture);
  expect(result).toEqual({ ordinary:7,safety:3,trash:true,source:true,unchanged:false,changed:true,early:false,off:false });
});

test("history retention, board fidelity, failed revisions and permanent purge",async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1","Source module harness"); await seed(page);
  const result = await page.evaluate(async ({ fixture, board }) => {
    const { loadWorkspace, saveWorkspace } = await import("/src/storage.ts");
    const { checkpointHistory, listHistory, readHistory, historyRestoration } = await import("/src/history.ts");
    const { trashItem, purgeTrash } = await import("/src/trash.ts");
    let saved = await loadWorkspace();
    const note: any = { ...fixture.notes[0],kind:"board",content:"",board };
    let document: any = { ...fixture,notes:[note,fixture.notes[1]] };
    let revision = await saveWorkspace(document,saved.revision);
    for (let i = 0; i < 22; i++) {
      document = { ...document,notes:[{ ...note,title:`Version ${i}` },fixture.notes[1]] };
      revision = await saveWorkspace(document,revision);
      await checkpointHistory(document.notes[0],revision);
    }
    const versions = await listHistory(note.id);
    const recovered = await readHistory(versions[0].id);
    document = { ...document,notes:[{ ...document.notes[0],board:{ ...board,elements:[] } },fixture.notes[1]] };
    revision = await saveWorkspace(document,revision);
    const restored = historyRestoration(document,note.id,recovered);
    let conflict = false; try { await saveWorkspace(restored,revision-1); } catch { conflict=true; }
    let checkpointConflict = false; try { await checkpointHistory(note,revision-1); } catch { checkpointConflict=true; }
    revision = await saveWorkspace(restored,revision);
    document = (await loadWorkspace()).document;
    document = trashItem(document,note.id); revision = await saveWorkspace(document,revision);
    const retained = (await listHistory(note.id)).length;
    await saveWorkspace(purgeTrash(document,note.id),revision);
    return { count: versions.length,board:JSON.stringify(document.notes[0].board)===JSON.stringify(board),conflict,checkpointConflict,retained,purged:(await listHistory(note.id)).length };
  },{ fixture,board:{ ...emptyBoard(),elements:[{ id:"diagram",type:"rectangle",x:120,y:110,width:180,height:80,angle:0,strokeColor:"#1e1e1e",backgroundColor:"#a5d8ff",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:0,opacity:100,groupIds:[],frameId:null,roundness:null,seed:3423,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:1,link:null,locked:false,index:null } as any] } });
  expect(result).toEqual({ count:20,board:true,conflict:true,checkpointConflict:true,retained:20,purged:0 });
});

test("failed safety backup stops replacement and permits a successful retry",async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1","Development failure injection");
  await page.route(/\/src\/backups\.ts(?:\?.*)?$/,route => route.request().url().includes("original=1") ? route.continue() : route.fulfill({ contentType:"text/javascript",body:`
    export * from '/src/backups.ts?original=1';
    import { useBackups as original } from '/src/backups.ts?original=1';
    export function useBackups(...args) {
      const result = original(...args);
      return { ...result,run(protectedCopy) {
        if (protectedCopy && window.failSafetyCopy) return Promise.reject(Error('Backup drive unavailable'));
        return result.run(protectedCopy);
      } };
    }
  ` }));
  await seed(page); await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button",{ name:"Backup now",exact:true }).click();
  await expect(page.getByRole("button",{ name:"Preview restore",exact:true })).toHaveCount(1);
  await page.getByRole("button",{ name:"Done",exact:true }).click();
  await page.getByRole("textbox",{ name:"Note content",exact:true }).fill("Keep the current draft"); await saved(page);
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click();
  await page.getByRole("button",{ name:"Preview restore",exact:true }).click();
  await page.getByLabel("Replace this notebook",{ exact:true }).check();
  await page.getByLabel("I understand this replaces the current notes and folders.").check();
  await page.evaluate(() => { (window as any).failSafetyCopy=true; });
  await page.getByRole("button",{ name:"Replace notebook",exact:true }).click();
  await expect(page.getByRole("alert")).toContainText("Backup drive unavailable");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.notes.find((note: any) => note.id==="a").content,key)).toContain("Keep the current draft");
  await page.evaluate(() => { (window as any).failSafetyCopy=false; });
  await page.getByRole("button",{ name:"Replace notebook",exact:true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await saved(page);
  await expect(page.getByRole("textbox",{ name:"Note content",exact:true })).toContainText("Original writing");
});

test("failed history checkpoint leaves today's content intact before retry",async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === "1","Development failure injection");
  await page.route(/\/src\/history\.ts(?:\?.*)?$/,route => route.request().url().includes("original=1") ? route.continue() : route.fulfill({ contentType:"text/javascript",body:`
    export * from '/src/history.ts?original=1';
    import { checkpointHistory as original } from '/src/history.ts?original=1';
    export function checkpointHistory(...args) {
      if (window.failHistoryWrite) return Promise.reject(Error('History storage unavailable'));
      return original(...args);
    }
  ` }));
  await seed(page); await page.getByRole("textbox",{ name:"Note content",exact:true }).fill("Keep this newer version"); await saved(page);
  await page.getByRole("button",{ name:"Note options",exact:true }).click();
  await page.getByRole("button",{ name:"Version history",exact:true }).click();
  await expect(page.locator(".history-preview")).toContainText("Original writing");
  await page.evaluate(() => { (window as any).failHistoryWrite=true; });
  await page.getByRole("button",{ name:"Restore this version",exact:true }).click();
  await expect(page.getByRole("alert")).toContainText("History storage unavailable");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.notes.find((note: any) => note.id==="a").content,key)).toContain("Keep this newer version");
  await page.evaluate(() => { (window as any).failHistoryWrite=false; });
  await page.getByRole("button",{ name:"Restore this version",exact:true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await saved(page);
  await expect(page.getByRole("textbox",{ name:"Note content",exact:true })).toContainText("Original writing");
});

test("earlier deletion purge confirms removal of notes and boards together while preserving live notes",async ({ page }) => {
  const document: Workspace = { ...fixture,schemaVersion:5,referenceId:null,notes:[
    { ...fixture.notes[0],deletedAt:time },fixture.notes[1],
    { ...fixture.notes[0],id:"drawing",title:"Trashed board",kind:"board",content:"",board:emptyBoard(),deletedAt:time },
  ] };
  await seed(page,document); await openEarlierDeletions(page);
  await page.getByRole("button",{ name:"Delete all permanently…",exact:true }).click();
  await expect(page.getByRole("dialog")).toContainText("All earlier deleted items");
  await page.getByRole("dialog").getByRole("button",{ name:"Cancel",exact:true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.notes.length,key)).toBe(3);
  await page.getByRole("button",{ name:"Delete all permanently…",exact:true }).click();
  await page.getByRole("dialog").getByRole("button",{ name:"Delete all permanently",exact:true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.notes.map((note: any) => note.id),key)).toEqual(["b"]);
  await page.reload(); await expect(page.getByRole("textbox",{ name:"Note title",exact:true })).toHaveValue("Another");
  await page.getByRole("button", { name: "Notebook navigation", exact: true }).click(); await expect(page.getByRole("button", { name: /^Earlier deletions/ })).toHaveCount(0);
});

test("history restores rich text, an image and ink after reload; file backup imports into a fresh browser",async ({ page, browser }) => {
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=";
  const ink = JSON.stringify([{ color:"green",points:[[.1,0],[.4,1]] }]).replaceAll('"',"&quot;");
  const content = `<p data-note-ink="${ink}"><strong>Formatted 日本語</strong></p><figure data-notify-image="" data-width="50" data-align="left"><img src="${pixel}" alt="Retained image"><figcaption>Keep this caption</figcaption></figure>`;
  await seed(page,{ ...fixture,notes:[{ ...fixture.notes[0],content },fixture.notes[1]] });
  await page.getByRole("textbox",{ name:"Note content",exact:true }).fill("Changed content without an image"); await saved(page); await page.reload();
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("button",{ name:"Version history",exact:true }).click();
  await expect(page.locator(".history-preview strong")).toHaveText("Formatted 日本語");
  await expect(page.locator(".history-preview img[alt='Retained image']")).toBeVisible();
  await expect(page.locator(".history-preview .note-ink-layer g path")).toHaveCount(1);
  await page.getByRole("button",{ name:"Restore this version",exact:true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await saved(page); await page.reload();
  await expect(page.locator(".document-panel strong")).toHaveText("Formatted 日本語");
  await expect(page.locator(".document-panel .note-ink-layer g path")).toHaveCount(1);
  await expect(page.locator(".document-panel").getByRole("textbox",{ name:"Image caption",exact:true })).toHaveValue("Keep this caption");
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("tab", { name: "Backup & restore", exact: true }).click(); await page.getByRole("button",{ name:"Backup now",exact:true }).click();
  await expect(page.getByRole("button",{ name:"Preview restore",exact:true })).toHaveCount(1);
  const download = page.waitForEvent("download"); await page.locator(".backup-list").getByRole("button",{ name:"Download",exact:true }).click();
  const file = await download, path = test.info().outputPath("fresh-install-backup.scribly"); await file.saveAs(path);
  const fresh = await browser.newContext();
  try {
    const restored = await fresh.newPage(); await restored.goto(new URL("/",page.url()).href);
    await restored.getByRole("button",{ name:"Settings",exact:true }).click(); await restored.getByRole("tab", { name: "Backup & restore", exact: true }).click();
    await restored.getByLabel("Restore backup file",{ exact:true }).setInputFiles(path);
    await expect(restored.getByRole("dialog")).toContainText("2 notes");
    await restored.getByRole("button",{ name:"Import backup",exact:true }).click(); await expect(restored.getByRole("dialog")).toHaveCount(0); await saved(restored);
    await expect(restored.locator(".document-panel strong")).toHaveText("Formatted 日本語");
    await expect(restored.locator(".document-panel img[alt='Retained image']")).toBeVisible();
    await expect(restored.locator(".document-panel .note-ink-layer g path")).toHaveCount(1);
    await restored.reload(); await expect(restored.locator(".document-panel").getByRole("textbox",{ name:"Image caption",exact:true })).toHaveValue("Keep this caption");
  } finally { await fresh.close(); }
});

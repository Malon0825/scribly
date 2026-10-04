import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
let browser;
for (let attempt=0;attempt<100;attempt++) {
  try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve=>setTimeout(resolve,200)); }
}
if (!browser) throw Error("Isolated WebView2 endpoint unavailable");
const page=browser.contexts()[0].pages()[0], profile=process.argv[3];
const saved=()=>page.getByText("Saved locally",{ exact:true }).waitFor({ timeout:60000 });
const load=()=>page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("load_workspace"));
const editor=()=>page.getByRole("textbox",{ name:"Note content",exact:true });
const options=async action=> { await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("dialog",{ name:"Note options",exact:true }).getByRole("button",{ name:action,exact:true }).click(); };
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
try {
  await saved();
  if (resolve((await load()).dataPath).toLowerCase()!==resolve(profile).toLowerCase()) throw Error("Refusing to mutate a non-isolated notebook");
  await page.getByLabel("Import files",{ exact:true }).setInputFiles({ name:"Connected target.txt",mimeType:"text/plain",buffer:Buffer.from("Target stays read-only in Reference.") }); await saved();
  await expect(editor()).toContainText("Target stays read-only in Reference.");
  await expect.poll(async()=> (await load()).document.notes.some(note=>note.title==="Connected target"),{ timeout:60000 }).toBe(true); await saved();
  const target=(await load()).document.notes.find(note=>note.title==="Connected target");
  const xml=Buffer.from(`<root>${"<item>日本語</item>\n".repeat(18000)}</root>`);
  await page.getByLabel("Import files",{ exact:true }).setInputFiles({ name:"Template source.xml",mimeType:"application/xml",buffer:xml });
  await expect(page.locator(".document-editor .source-file-text")).toContainText("<root>");
  await page.locator(".document-editor .tiptap > p").last().click(); await page.keyboard.type("{{title}} on {{date}}");
  await page.keyboard.press("Control+l"); let dialog=page.getByRole("dialog",{ name:"Link to an item",exact:true }); await dialog.getByLabel("Search items").fill("Connected target"); await dialog.getByRole("group",{ name:"Link targets" }).getByRole("button").click(); await dialog.getByRole("button",{ name:"Insert link",exact:true }).click();
  await expect(editor().locator('a[data-item-id]')).toHaveAttribute("data-item-id",target.id); await saved();
  await editor().locator('a[data-item-id]').click({ modifiers:["Alt"] }); await page.getByRole("dialog",{ name:"Item link options",exact:true }).getByRole("button",{ name:"Open in Reference",exact:true }).click();
  await expect(page.locator(".reference-panel .tiptap")).toContainText("Target stays read-only"); await saved();
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=","base64");
  await page.getByLabel("Image files",{ exact:true }).setInputFiles({ name:"template-image.png",mimeType:"image/png",buffer:png }); await expect(editor().locator("img")).toHaveCount(1); await saved();
  await expect.poll(async()=> {
    const snapshot=await load(), note=snapshot.document.notes.find(note=>note.id===snapshot.document.activeId);
    return !!note?.content.match(/data-source-id="([a-f0-9-]+)"/) && !!note.content.match(/data-notify-attachment="([a-f0-9]{64}\.(?:png|jpeg|gif|webp))"/);
  },{ timeout:60000 }).toBe(true); await saved();
  const before=await load(), source=before.document.notes.find(note=>note.id===before.document.activeId);
  const sourceId=source.content.match(/data-source-id="([a-f0-9-]+)"/)?.[1], imageId=source.content.match(/data-notify-attachment="([a-f0-9]{64}\.(?:png|jpeg|gif|webp))"/)?.[1];
  if (!sourceId || !imageId) throw Error("Missing original/image references");
  await options("Save as template…"); dialog=page.getByRole("dialog",{ name:"Save note as template",exact:true }); await dialog.getByLabel("Template name",{ exact:true }).fill("Native snapshot"); await dialog.getByLabel("Title pattern",{ exact:true }).fill("{{title}} — {{date}}"); await dialog.getByRole("button",{ name:"Save template",exact:true }).click(); await saved();
  await expect.poll(async()=> (await load()).document.notes.some(note=>note.kind==="template" && note.title==="Native snapshot"),{ timeout:60000 }).toBe(true); await saved();
  const template=(await load()).document.notes.find(note=>note.kind==="template" && note.title==="Native snapshot"); if (!template) throw Error("Template not stored");
  await options("Move to Trash"); await page.getByRole("button",{ name:/^Trash \d/ }).click(); await options("Delete permanently"); await page.getByRole("dialog").getByRole("button",{ name:"Delete permanently",exact:true }).click();
  await expect.poll(async()=> (await load()).document.notes.some(note=>note.id===source.id),{ timeout:60000 }).toBe(false); await saved();
  await page.getByRole("button",{ name:"New from template…",exact:true }).click(); dialog=page.getByRole("dialog",{ name:"New note from template",exact:true }); await dialog.getByLabel("Note title",{ exact:true }).fill("Native child"); await dialog.getByRole("button",{ name:"Create note",exact:true }).click(); await saved();
  await expect(editor()).toContainText(/Native child on \d{4}-\d{2}-\d{2}/); await expect(editor().locator("img")).toHaveCount(1);
  await page.reload(); await saved(); const restarted=await load();
  if (restarted.document.notes.some(note=>note.id===source.id) || !restarted.document.notes.some(note=>note.id===template.id)) throw Error("Source purge/template restart failed");
  if (hash(await readFile(join(restarted.dataPath,"sources",`${sourceId}.source`)))!==hash(xml) || hash(await readFile(join(restarted.dataPath,"attachments",imageId)))!==hash(png)) throw Error("Template lost immutable attachment bytes");
  await editor().locator('a[data-item-id]').click({ modifiers:["Control"] }); await page.locator(".item-backlinks summary").click(); await expect(page.locator(".item-backlinks")).toContainText("Native child"); await saved();
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("button",{ name:"Backup now",exact:true }).click(); await expect(page.getByRole("button",{ name:"Preview restore",exact:true })).toHaveCount(1,{ timeout:60000 });
  const config=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("backup_status")); const bytes=await readFile(join(profile,"copies",`Scribly-backup-${config.entries[0].id}.scribly`));
  const archive=unzipSync(bytes), manifest=JSON.parse(strFromU8(archive["workspace.json"])), backedTemplate=manifest.notes.find(note=>note.id===template.id);
  if (!backedTemplate || !backedTemplate.content.includes(`data-item-id="${target.id}"`) || !backedTemplate.content.includes(png.toString("base64")) || hash(archive[`sources/${sourceId}`])!==hash(xml)) throw Error("Backup lost template links/images/originals");
  await page.getByRole("button",{ name:"Done",exact:true }).click();
  await page.getByLabel("Import files",{ exact:true }).setInputFiles({ name:"connected-backup.scribly",mimeType:"application/zip",buffer:bytes });
  await expect.poll(async()=> (await load()).document.notes.filter(note=>note.kind==="template").length,{ timeout:60000 }).toBe(2); await saved();
  const merged=await load(), importedTarget=merged.document.notes.filter(note=>note.title==="Connected target").find(note=>note.id!==target.id), importedTemplate=merged.document.notes.filter(note=>note.kind==="template").find(note=>note.id!==template.id);
  if (!importedTarget || !importedTemplate?.content.includes(`data-item-id="${importedTarget.id}"`)) throw Error("Import did not remap template connection");
  const importedSourceId=importedTemplate.content.match(/data-source-id="([a-f0-9-]+)"/)?.[1], importedImageId=importedTemplate.content.match(/data-notify-attachment="([a-f0-9]{64}\.(?:png|jpeg|gif|webp))"/)?.[1];
  if (!importedSourceId || !importedImageId || hash(await readFile(join(merged.dataPath,"sources",`${importedSourceId}.source`)))!==hash(xml) || hash(await readFile(join(merged.dataPath,"attachments",importedImageId)))!==hash(png)) throw Error("Import lost template original/image bytes");
  const report={ ok:true,executable:"optimized release",linksAndReference:true,derivedBacklinks:true,templateDeltaAndReload:true,sourcePurgeRetainedTemplate:true,templateOriginalSha256:hash(xml),templateImageSha256:hash(png),originalBytes:xml.length,backupBytes:bytes.length,backupIncludedTemplateAssets:true,importRemappedTemplateLinks:true,limitations:"Isolated Windows WebView2 profile. Folder preconfigured; native pickers, external browser launch and installer installation not exercised. No sustained RAM/frame benchmark." };
  await page.screenshot({ path:join(profile,"connected-native.png") }); await writeFile(join(profile,"connected.json"),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} catch (error) { await page.screenshot({ path:join(profile,"connected-failure.png") }).catch(()=>{}); throw error; }
finally { await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("plugin:window|close",{ label:"main" })).catch(()=>{}); await browser.close(); }

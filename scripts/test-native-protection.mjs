import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createHash } from "node:crypto";
let browser;
for (let attempt=0;attempt<100;attempt++) {
  try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.argv[2]}`); break; }
  catch { await new Promise(resolve=>setTimeout(resolve,200)); }
}
if (!browser) throw Error("Isolated WebView2 debugging endpoint unavailable");
const page=browser.contexts()[0].pages()[0], profile=process.argv[3];
const saved=()=>page.getByText("Saved locally",{ exact:true }).waitFor({ timeout:60000 });
try {
  await saved();
  const xml=Buffer.from(`<root>${"<item>日本語</item>\n".repeat(18000)}</root>`);
  await page.getByLabel("Import files",{ exact:true }).setInputFiles({ name:"protected-source.xml",mimeType:"application/xml",buffer:xml });
  await expect(page.locator(".document-panel .source-file-text")).toContainText("<root>"); await saved();
  await page.getByLabel("Import files",{ exact:true }).setInputFiles({ name:"phase2-native.txt",mimeType:"text/plain",buffer:Buffer.from("First revision 日本語") });
  await expect(page.getByRole("textbox",{ name:"Note content",exact:true })).toContainText("First revision"); await saved();
  await page.getByRole("textbox",{ name:"Note content",exact:true }).fill("Second revision"); await saved();
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("button",{ name:"Version history",exact:true }).click();
  await expect(page.locator(".history-preview")).toContainText("First revision 日本語");
  await page.getByRole("button",{ name:"Restore this version",exact:true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await saved();
  await expect(page.getByRole("textbox",{ name:"Note content",exact:true })).toContainText("First revision 日本語");
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("button",{ name:"Move to Trash",exact:true }).click(); await saved();
  await page.getByRole("button",{ name:/^Trash \d/ }).click(); await page.getByRole("button",{ name:"Settings",exact:true }).click();
  await page.getByRole("button",{ name:"Backup now",exact:true }).click(); await expect(page.getByRole("button",{ name:"Preview restore",exact:true })).toHaveCount(1,{ timeout:60000 });
  const config=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("backup_status"));
  const bytes=await readFile(join(profile,"copies",`Scribly-backup-${config.entries[0].id}.scribly`));
  const archive=unzipSync(bytes), manifest=JSON.parse(strFromU8(archive["workspace.json"]));
  if (manifest.schemaVersion!==5 || !manifest.notes.find(note=>note.title==="phase2-native")?.deletedAt) throw Error("Native backup lost Trash/schema state");
  const original=manifest.notes.find(note=>note.title==="protected-source");
  const sourceId=original.content.match(/data-source-id="([a-f0-9-]+)"/)?.[1];
  const hash=value=>createHash("sha256").update(value).digest("hex");
  if (!sourceId || hash(archive[`sources/${sourceId}`])!==hash(xml)) throw Error("Native backup original bytes changed");
  await page.getByRole("button",{ name:"Done",exact:true }).click();
  await page.getByRole("button",{ name:"Restore from Trash",exact:true }).first().click(); await saved(); await page.reload(); await saved();
  await expect(page.getByRole("textbox",{ name:"Note content",exact:true })).toContainText("First revision 日本語");
  await page.getByRole("button",{ name:"Note options",exact:true }).click(); await page.getByRole("button",{ name:"Version history",exact:true }).click();
  await expect(page.locator(".history-preview")).toContainText("Second revision");
  await page.screenshot({ path:join(profile,"native-history.png") });
  await page.getByRole("dialog").getByRole("button",{ name:"Close",exact:true }).click();
  await page.getByRole("button",{ name:"Settings",exact:true }).click(); await page.getByRole("button",{ name:"Preview restore",exact:true }).click();
  await page.getByLabel("Replace this notebook",{ exact:true }).check(); await page.getByLabel("I understand this replaces the current notes and folders.").check();
  await page.getByRole("button",{ name:"Replace notebook",exact:true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0,{ timeout:60000 }); await saved();
  const restored=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("load_workspace"));
  if (!restored.document.notes.find(note=>note.title==="phase2-native")?.deletedAt) throw Error("Native backup replacement lost Trash");
  const finalConfig=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("backup_status"));
  if (!finalConfig.entries.some(entry=>entry.protected)) throw Error("Native replacement did not preserve the current notebook first");
  const report={ ok:true,schemaVersion:restored.document.schemaVersion,historySurvivedReload:true,trashRestored:true,backupOriginalSha256:hash(xml),backupBytes:bytes.length,safetyCopies:finalConfig.entries.filter(entry=>entry.protected).length,
    limitations:"Isolated development WebView2 profile; folder preconfigured for the test, native folder chooser and real disk-full behavior untested." };
  await writeFile(join(profile,"protection.json"),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} finally {
  await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke("plugin:window|close",{ label:"main" })).catch(()=>{});
  await browser.close();
}

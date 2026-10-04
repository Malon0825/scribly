import { boardCommand } from './boardCommandHelper';
import { test, expect, type Page } from "@playwright/test";
import { emptyBoard, boardFromScene, type BoardData } from "../src/boardData";
import { boardToMermaid } from "../src/boardMermaid";
import type { Workspace } from "../src/types";
import { readFile } from "node:fs/promises";

const workspace: Workspace = { schemaVersion: 3, folders: [{ id: "work", name: "Work" }], notes: [{ id: "board", title: "Brand architecture", folderId: "work", kind: "board", board: emptyBoard(), content: "", archived: false, createdAt: "2026-10-03", updatedAt: "2026-10-03" }], activeId: "board", referenceId: null, theme: "light" };
async function open(page: Page, theme: "light" | "dark" = "light", archived = false, initialBoard?: BoardData) {
  const data = structuredClone(workspace); data.theme = theme; data.notes[0].archived = archived;
  if (initialBoard) data.notes[0].board = initialBoard;
  await page.addInitScript(data => { if (!sessionStorage.getItem("brand-test")) { localStorage.clear(); localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document: data, dataPath: "Brand test" })); sessionStorage.setItem("brand-test", "1"); } }, data);
  await page.goto("/"); await expect(page.locator(".board-canvas canvas").first()).toBeVisible({ timeout: 30000 });
}
const board = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document as Workspace).notes[0].board!);
async function pick(page: Page, query = "oracle") {
  if (!await page.getByRole("dialog", { name: "Brand logos", exact: true }).isVisible()) await boardCommand(page, 'Brand logos');
  const dialog = page.getByRole("dialog", { name: "Brand logos", exact: true });
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search brand logos" }).fill(query);
  if (query === "aws") for (let attempt = 0; attempt < 80 && !await dialog.locator('.brand-logo-choice[id="brand-aws"]').count(); attempt++) {
    const previous = await dialog.getByRole("option").first().getAttribute("aria-posinset");
    await dialog.getByRole("listbox").evaluate(el => el.scrollBy(0, el.clientHeight));
    await expect.poll(() => dialog.getByRole("option").first().getAttribute("aria-posinset")).not.toBe(previous);
  }
  if (query === "microsoft-azure") {
    await dialog.getByRole("option", { name: "Microsoft Azure", exact: true }).click();
    await dialog.getByLabel("Logo variant").click();
    await page.getByRole("option", { name: "Original · microsoft-azure", exact: true }).click();
  } else await dialog.locator(`.brand-logo-choice[id="brand-${query}"]`).click();
  return dialog;
}
for (const theme of ["light", "dark"] as const) test(`${theme}: local catalog searches, stays bounded and fits Focus/narrow/reduced motion`, async ({page}) => {
  const remote: string[] = [], catalog: string[] = [];
  page.on("request", request => { if (request.url().includes("brand-logos/catalog")) catalog.push(request.url()); if (/^https?:/.test(request.url()) && !request.url().includes("127.0.0.1")) remote.push(request.url()); });
  await open(page, theme); expect(catalog).toHaveLength(0);
  await page.getByRole("button", {name:"Focus",exact:true}).click();
  const canvas = await page.locator(".board-canvas canvas").first().elementHandle();
  await boardCommand(page, 'Brand logos');
  const dialog = page.getByRole("dialog", {name:"Brand logos",exact:true});
  await expect(dialog.getByRole("option").first()).toBeVisible();
  expect(await dialog.getByRole("option").count()).toBeLessThanOrEqual(48);
  await expect(dialog.getByRole("button", { name: "Popular", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("option", { selected: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "All brands", exact: true }).click();
  await dialog.getByRole("listbox").press("End");
  await expect(dialog.getByRole("option", { selected: true })).toBeVisible();
  await dialog.getByRole("textbox",{name:"Search brand logos"}).fill("microsoft sql");
  await expect(dialog.locator('.brand-logo-choice[id="brand-microsoft-sql-server"]')).toBeVisible();
  await dialog.getByRole("textbox",{name:"Search brand logos"}).fill("aws lambda");
  await dialog.locator('.brand-logo-choice[id="brand-aws-aws-lambda"]').click();
  await expect.poll(()=>dialog.locator('.brand-logo-preview img').evaluate((image:HTMLImageElement)=>image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({path:`release/brand-picker-${theme}-wide.png`});
  await dialog.getByRole("textbox",{name:"Search brand logos"}).fill("nonexistent-brand-test");
  await expect(dialog.getByRole("status").filter({hasText:"No brands found"})).toBeVisible();
  await page.setViewportSize({width:850,height:600}); await page.emulateMedia({reducedMotion:"reduce"});
  const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(850); expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  await page.screenshot({path:`release/brand-picker-${theme}.png`});
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Insert",exact:true})).toBeFocused();
  expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true); expect(remote).toEqual([]); expect((await board(page)).elements).toHaveLength(0);
});

test("inserting a brand creates one reversible component with offline image, Mermaid label and portable exports", async ({page}) => {
  await open(page); const dialog = await pick(page);
  await dialog.getByRole("button",{name:"Insert component"}).click();
  await expect(dialog.getByRole("status")).toContainText("1 component inserted");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(async()=> (await board(page)).elements.length).toBe(2);
  let saved = await board(page); const component = saved.elements.find(e=>e.type==="rectangle")!;
  expect(component.customData?.notifyBrand.slug).toBe("oracle"); expect(boardToMermaid(saved).code).toContain('["Oracle"]'); expect(boardToMermaid(saved).issues).toEqual([]);
  expect(saved.elements.some(e=>e.type==='text')).toBe(false);
  const image = saved.elements.find(e=>e.type==='image')!;
  expect(image.x - component.x).toBeGreaterThan(0);
  expect(image.x - component.x).toBeLessThanOrEqual(10);
  expect(image.y - component.y).toBeCloseTo(image.x - component.x);
  expect(component.width - image.width).toBeCloseTo(2 * (image.x - component.x));
  expect(component.height - image.height).toBeCloseTo(2 * (image.y - component.y));
  expect(Object.values(saved.files)[0].dataURL).toMatch(/^data:image\/png;base64,/);
  const drawing = page.waitForEvent("download"); await boardCommand(page, 'Drawing (.excalidraw)');
  const restored = boardFromScene(JSON.parse(await readFile((await (await drawing).path())!,"utf8"))); expect(boardToMermaid(restored).code).toContain('["Oracle"]'); expect(restored.files).toEqual(saved.files);
  const png = page.waitForEvent("download"); await boardCommand(page, 'PNG image'); expect((await readFile((await (await png).path())!)).subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");
  await page.getByRole("button",{name:"Undo",exact:true}).click(); await expect.poll(async()=> (await board(page)).elements.filter(e=>!e.isDeleted).length).toBe(0);
  await page.getByRole("button",{name:"Redo",exact:true}).click(); await expect.poll(async()=> (await board(page)).elements.filter(e=>!e.isDeleted).length).toBe(2);
  await page.reload(); await expect(page.getByRole("button",{name:"Insert",exact:true})).toBeVisible({timeout:30000});
  saved = await board(page); expect(boardToMermaid(saved).code).toContain('["Oracle"]');
  const github = await pick(page,"github"); await github.getByLabel("Logo variant").click(); await page.getByRole("option",{name:/^mono(?: \u00b7|$)/}).click(); await github.getByRole("button",{name:"Insert component"}).click();
  await expect.poll(async()=>Object.keys((await board(page)).files).length).toBe(2);
  const components = (await board(page)).elements.filter(e=>!e.isDeleted && e.type === "rectangle");
  expect(components[1].x).toBeGreaterThanOrEqual(components[0].x + components[0].width);
  await expect(github.getByRole("button", { name: "Insert component", exact: true })).toBeEnabled();
  const repeated = await pick(page); await repeated.getByRole("button",{name:"Insert component"}).click();
  await expect.poll(async()=> (await board(page)).elements.filter(e=>!e.isDeleted).length).toBe(6);
  expect(Object.keys((await board(page)).files)).toHaveLength(2);
  await expect(repeated.getByRole("button", { name: "Insert component", exact: true })).toBeEnabled();
  await repeated.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole('button', {name:'Reference',exact:true}).click();
  await expect.poll(async()=>(await page.locator('.board-canvas').boundingBox())!.width).toBeGreaterThan(900);
  const canvas = (await page.locator('.board-canvas').boundingBox())!;
  await page.locator('label:has([data-testid="toolbar-arrow"])').click();
  await page.mouse.move(canvas.x + components[0].x + components[0].width + 3, canvas.y + components[0].y + components[0].height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + components[1].x - 3, canvas.y + components[1].y + components[1].height / 2, {steps:8});
  await page.mouse.up();
  await expect.poll(async()=>boardToMermaid(await board(page)).edges).toBe(1);
  await page.screenshot({path:"release/brand-components-light.png"});
});

test("catalog and artwork failures are recoverable and closing during insertion cancels the command", async ({page}) => {
  await open(page);
  await page.route("**/brand-logos/catalog.json",route=>route.fulfill({status:503,body:"Unavailable"}));
  await boardCommand(page, 'Brand logos'); const dialog = page.getByRole("dialog",{name:"Brand logos",exact:true});
  await expect(dialog.getByRole("alert")).toContainText("could not be opened"); await page.unroute("**/brand-logos/catalog.json");
  await dialog.getByRole("button",{name:"Retry catalog"}).click(); await expect(dialog.getByRole("option").first()).toBeVisible();
  await dialog.getByRole("textbox",{name:"Search brand logos"}).fill("oracle"); await dialog.locator('.brand-logo-choice[id="brand-oracle"]').click();
  await page.route("**/brand-logos/oracle/default.svg",async route=>{if(route.request().resourceType()==="fetch") await route.fulfill({status:404,body:"Missing"}); else await route.continue();});
  await dialog.getByRole("button",{name:"Insert component"}).click(); await expect(dialog.getByRole("alert")).toContainText("could not be opened"); expect((await board(page)).elements).toHaveLength(0);
  await page.unroute("**/brand-logos/oracle/default.svg");
  await page.route("**/brand-logos/oracle/default.svg",async route=>{if(route.request().resourceType()==="fetch"){ await new Promise(resolve=>setTimeout(resolve,600)); await route.continue().catch(()=>{}); } else await route.continue();});
  await dialog.getByRole("button",{name:"Insert component"}).click(); await dialog.getByRole("button",{name:"Stop and close",exact:true}).click(); await page.waitForTimeout(800); expect((await board(page)).elements).toHaveLength(0);
});

for (const theme of ["light", "dark"] as const) test(`${theme}: AWS and Azure fit their artwork without bottom labels`, async ({ page }) => {
  await open(page, theme);
  await page.getByRole("button", { name: "Reference", exact: true }).click();
  for (const slug of ["aws", "microsoft-azure"]) {
    const dialog = await pick(page, slug);
    await dialog.getByRole("button", { name: "Insert component" }).click();
    await expect(dialog.getByRole("status")).toContainText("1 component inserted");
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
  }
  await expect.poll(async () => (await board(page)).elements.length).toBe(4);
  const saved = await board(page);
  expect(saved.elements.some(e => e.type === "text")).toBe(false);
  const components = saved.elements.filter(e => e.type === "rectangle");
  for (const component of components) {
    const image = saved.elements.find(e => e.type === "image" && e.groupIds[0] === component.groupIds[0])!;
    expect(component.width - image.width).toBeLessThanOrEqual(20);
    expect(component.height - image.height).toBeLessThanOrEqual(20);
    // Tightness includes transparent padding authored inside the SVG viewBox.
    const bounds = await page.evaluate(async dataURL => {
      const image = new Image(); image.src = dataURL; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const occupied = (x: number, y: number) => pixels[(y * canvas.width + x) * 4 + 3] > 0;
      return [Array.from({ length: canvas.width }, (_, x) => occupied(x, 0)).some(Boolean),
        Array.from({ length: canvas.width }, (_, x) => occupied(x, canvas.height - 1)).some(Boolean),
        Array.from({ length: canvas.height }, (_, y) => occupied(0, y)).some(Boolean),
        Array.from({ length: canvas.height }, (_, y) => occupied(canvas.width - 1, y)).some(Boolean)];
    }, saved.files[image.type === "image" ? image.fileId! : ""].dataURL);
    expect(bounds).toEqual([true, true, true, true]);
  }
  const canvas = (await page.locator(".board-canvas").boundingBox())!;
  await page.locator('label:has([data-testid="toolbar-arrow"])').click();
  await page.mouse.move(canvas.x + components[0].x + components[0].width + 3, canvas.y + components[0].y + components[0].height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + components[1].x - 3, canvas.y + components[1].y + components[1].height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => boardToMermaid(await board(page)).edges).toBe(1);
  expect(boardToMermaid(await board(page)).issues).toEqual([]);
  await page.screenshot({ path: test.info().outputPath(`compact-logos-${theme}.png`) });
});

test("archived boards cannot insert logos", async ({page}) => {
  await open(page,"light",true); await expect(page.getByRole("button",{name:"Insert",exact:true})).toHaveCount(0);
});

test("board capacity is checked before adding logo files or scene elements", async ({page}) => {
  const full = emptyBoard();
  full.elements = Array.from({length:2499},(_,index)=>({id:`limit-${index}`,type:'rectangle',x:2000+(index%50)*220,y:2000+Math.floor(index/50)*180,width:180,height:140,isDeleted:false})) as BoardData['elements'];
  await open(page,"light",false,full); const dialog = await pick(page);
  await dialog.getByRole('button',{name:'Insert component'}).click();
  await expect(dialog.getByRole('alert')).toContainText('2,500 element limit');
  expect((await board(page)).elements).toHaveLength(2499); expect(Object.keys((await board(page)).files)).toHaveLength(0);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
});

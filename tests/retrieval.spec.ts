import { test, expect, type Page } from "@playwright/test";
import { Schema } from "@tiptap/pm/model";
import { findTextMatches } from "../src/textSearch";
import { normalizeNavigation, recordOpened } from "../src/itemNavigation";
import { emptyBoard } from "../src/boardData";
import type { Workspace, Note } from "../src/types";
import { validateWorkspace } from "../src/workspaceValidation";
import { mkdir } from "node:fs/promises";

test.setTimeout(90_000);
const time = "2026-10-04T00:00:00.000Z";
const note = (id: string, title = id, content = "<p>Other content</p>"): Note => ({ id, title, content, folderId: "work", archived: false, createdAt: time, updatedAt: time });
const content = '<p>Alpha <strong>al</strong><em>pha</em> alphanumeric ALPHA 日本語</p><pre><code>alpha_beta alpha alpha</code></pre><p>End position</p>';
const fixture: Workspace = { schemaVersion: 5, theme: "light", activeId: "a", referenceId: "ref", folders: [{ id: "work", name: "Work" }], notes: [note("a", "Search draft", content), note("b", "Second draft"), note("ref", "Reference", "<p>Reference alpha stays unchanged</p>")] };
async function seed(page: Page, document = fixture) {
  await page.addInitScript(document => { if (!sessionStorage.getItem("retrieval-seeded")) { localStorage.setItem("still-notes-browser-v1", JSON.stringify({ revision: 1, document, dataPath: "Retrieval test" })); sessionStorage.setItem("retrieval-seeded", "1"); } }, document);
  await page.goto("/"); await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toBeVisible();
}
const editor = (page: Page) => page.getByRole("textbox", { name: "Note content", exact: true });
const find = (page: Page) => page.getByRole("region", { name: "Find in note", exact: true });
const saved = (page: Page) => expect(page.getByRole("button", { name: "Saved in browser", exact: true })).toBeVisible();
const documentState = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("still-notes-browser-v1")!).document as Workspace);
async function openFind(page: Page, query: string, replace = false) {
  await editor(page).focus(); await page.keyboard.press(replace ? "Control+h" : "Control+f");
  await expect(find(page)).toBeVisible(); await page.getByRole("textbox", { name: "Find text", exact: true }).fill(query);
  await expect(find(page).getByText("Searching…", { exact: true })).toHaveCount(0);
}

async function openNotebookSection(page: Page, name: "Pinned" | "Recently opened") {
  const navigation = page.getByRole("button", { name: "Notebook navigation", exact: true });
  if (await navigation.getAttribute("aria-expanded") !== "true") await navigation.click();
  const section = page.getByRole("button", { name, exact: true });
  if (await section.getAttribute("aria-expanded") !== "true") await section.click();
}

test("literal Unicode matching spans marks but never crosses blocks or inline atoms", () => {
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "inline*", group: "block" }, text: { group: "inline" }, image: { inline: true, group: "inline", atom: true } }, marks: { strong: {} } });
  const paragraph = (children: any[]) => schema.nodes.paragraph.create(null, children);
  const doc = schema.nodes.doc.create(null, [paragraph([schema.text("日本語 al"), schema.text("pha", [schema.marks.strong.create()]), schema.text(" alphabet alpha_beta ALPHA [a].")]), paragraph([schema.text("al"), schema.nodes.image.create(), schema.text("pha")]), paragraph([schema.text("alpha")])]);
  const search = (query: string, wholeWord = false, caseSensitive = false) => findTextMatches(doc, { query, wholeWord, caseSensitive });
  expect(search("alpha")).toHaveLength(5); expect(search("alpha", true)).toHaveLength(3); expect(search("alpha", true, true)).toHaveLength(2);
  const japanese = search("日本語", true); expect(japanese).toHaveLength(1); expect(doc.textBetween(japanese[0].from, japanese[0].to)).toBe("日本語");
  expect(search("[a].")).toHaveLength(1); expect(search("")).toEqual([]); expect(search("phaalpha")).toEqual([]);
});

test("recent navigation is unique, bounded, prunes unavailable items, and preserves note timestamps/order", () => {
  const document: Workspace = { ...fixture, notes: Array.from({ length: 15 }, (_, i) => note(String(i))), recentIds: [] };
  let next = document; for (const item of document.notes) next = recordOpened(next, item.id);
  expect(next.recentIds).toEqual(["14","13","12","11","10","9","8","7","6","5"]);
  next = recordOpened(next, "8"); expect(next.recentIds![0]).toBe("8"); expect(next.notes).toBe(document.notes);
  next = normalizeNavigation({ ...next, notes: next.notes.map(item => item.id === "8" ? { ...item, archived: true, pinned: true } : item) });
  expect(next.recentIds).not.toContain("8"); expect(next.notes.find(item => item.id === "8")?.pinned).toBe(true);
  expect(next.notes.map(item => item.id)).toEqual(document.notes.map(item => item.id));
});

test("navigation validators accept legacy metadata and reject malformed pins/recents", () => {
  expect(() => validateWorkspace(fixture)).not.toThrow();
  expect(() => validateWorkspace({ ...fixture, recentIds: ["a"], notes: fixture.notes.map(item => ({ ...item, pinned: true })) })).not.toThrow();
  for (const recentIds of [["missing"], ["a","a"], "a", [false], Array(11).fill("a")]) expect(() => validateWorkspace({ ...fixture, recentIds })).toThrow();
  expect(() => validateWorkspace({ ...fixture, notes: [{ ...fixture.notes[0], pinned: "true" }] })).toThrow();
});

test("Find counts across marks/code, navigates with keys, and Escape preserves caret, scroll and editor identity", async ({ page }) => {
  await seed(page); await saved(page);
  await editor(page).focus(); await page.keyboard.press("Control+End");
  await page.evaluate(() => { (window as any).retrievalEditor = document.querySelector(".document-editor .tiptap"); });
  await openFind(page, "alpha"); await expect(find(page).getByRole("status").first()).toHaveText(/of 7$/);
  await expect(page.locator(".document-editor .find-match")).toHaveCount(8); // a match spanning marks paints two spans
  await page.keyboard.press("Enter"); await expect(find(page).getByRole("status").first()).toHaveText("2 of 7");
  await expect(page.getByRole("textbox", { name: "Find text", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Enter"); await page.keyboard.press("Escape"); await expect(find(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("!"); await expect(editor(page)).toContainText("End position!");
  expect(await page.evaluate(() => (window as any).retrievalEditor === document.querySelector(".document-editor .tiptap"))).toBe(true);
  await saved(page); expect((await documentState(page)).notes[0].content).not.toContain("find-match");
});

test("Replace all uses case/Unicode word options, preserves surrounding formatting and Reference, and Undo/Redo is one step", async ({ page }) => {
  await seed(page); await openFind(page, "alpha", true);
  await page.getByLabel("Whole word", { exact: true }).check(); await expect(find(page).getByRole("status").first()).toHaveText(/of 5$/);
  await page.getByLabel("Match case", { exact: true }).check(); await expect(find(page).getByRole("status").first()).toHaveText(/of 3$/);
  await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("Z"); await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor(page)).toContainText("Alpha Z alphanumeric ALPHA 日本語"); await expect(editor(page)).toContainText("alpha_beta Z Z");
  await expect(page.locator(".reference-editor")).toContainText("Reference alpha stays unchanged");
  await page.getByRole("button", { name: "Close find", exact: true }).click(); await page.keyboard.press("Control+z");
  await expect(editor(page)).toContainText("alpha_beta alpha alpha"); await expect(editor(page).locator("strong")).toHaveText("al"); await expect(editor(page).locator("em")).toHaveText("pha");
  await page.keyboard.press("Control+Shift+z"); await expect(editor(page)).toContainText("alpha_beta Z Z"); await saved(page);
  await page.reload(); await expect(editor(page)).toContainText("alpha_beta Z Z");
});

test("single replacement advances, supports deletion, and empty/literal queries never mutate content", async ({ page }) => {
  await seed(page, { ...fixture, notes: [note("a", "Literal", "<p>[a]. [a]. [a].</p>")] , referenceId: null });
  await openFind(page, "[a].", true); await expect(find(page).getByRole("status").first()).toHaveText(/of 3$/);
  await page.getByRole("button", { name: "Replace next", exact: true }).click(); await expect(find(page).getByRole("status").first()).toHaveText(/of 2$/);
  await expect(editor(page)).toHaveText(" [a]. [a].");
  await page.getByRole("textbox", { name: "Find text", exact: true }).fill(""); await expect(find(page).getByRole("status").first()).toHaveText("Enter text");
  await expect(page.getByRole("button", { name: "Replace all", exact: true })).toBeDisabled();
});

for (const state of ["archived", "Trash"]) test(`${state} Find stays read-only even with Ctrl+H`, async ({ page }) => {
  await seed(page, { ...fixture, notes: [{ ...fixture.notes[0], ...(state === "archived" ? { archived: true } : { deletedAt: time }) }, fixture.notes[1]] });
  await page.keyboard.press("Control+h"); await page.getByRole("textbox", { name: "Find text", exact: true }).fill("alpha");
  await expect(find(page).getByRole("status").first()).toHaveText(/of 7$/); await expect(find(page)).toContainText("Read-only note");
  await expect(page.getByRole("textbox", { name: "Replace with", exact: true })).toHaveCount(0);
  await expect(page.locator(".document-panel [contenteditable=true]")).toHaveCount(0);
  await page.getByRole("button", { name: "Close find", exact: true }).click(); await saved(page);
  expect((await documentState(page)).notes[0].content).toBe(content);
});

test("notebook search shows matching excerpts, jumps to note match, and preserves query on navigation", async ({ page }) => {
  await seed(page); await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("alpha");
  await expect(page.locator(".search-results mark").first()).toHaveText(/alpha/i);
  await page.locator(".search-results .note-select").filter({ hasText: "Search draft" }).click();
  await expect(find(page)).toBeVisible(); await expect(page.locator(".document-editor .find-current").first()).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toMatch(/alpha/i);
  await expect(page.getByRole("textbox", { name: "Search notes", exact: true })).toHaveValue("alpha");
  await page.locator(".search-results .note-select").filter({ hasText: "Reference" }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Reference");
  await expect(page.getByRole("textbox", { name: "Search notes", exact: true })).toHaveValue("alpha");
});

test("pins/recent persist without changing folder order, timestamps, body or editor; archive/restore and purge keep entries safe", async ({ page }) => {
  await seed(page); await saved(page); const baseline = await documentState(page);
  await page.evaluate(() => { (window as any).retrievalEditor = document.querySelector(".document-editor .tiptap"); });
  await page.getByRole("button", { name: "Note options", exact: true }).click(); await page.getByRole("button", { name: "Pin item", exact: true }).click();
  await openNotebookSection(page, "Pinned"); await expect(page.getByLabel("Pinned items", { exact: true }).getByRole("button", { name: "Search draft", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).retrievalEditor === document.querySelector(".document-editor .tiptap"))).toBe(true);
  await saved(page); let state = await documentState(page); expect(state.notes[0].updatedAt).toBe(baseline.notes[0].updatedAt); expect(state.notes[0].content).toBe(baseline.notes[0].content);
  await page.keyboard.press("Escape"); await page.locator(".folder-notes .note-select").filter({ hasText: "Second draft" }).click(); await saved(page);
  await openNotebookSection(page, "Recently opened");
  await expect(page.getByLabel("Recently opened items", { exact: true }).locator(".shortcut-select").first()).toHaveText("Second draft");
  await page.getByLabel("Pinned items", { exact: true }).getByRole("button", { name: "Search draft", exact: true }).click(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Note options", exact: true }).click(); await page.getByRole("button", { name: "Archive note", exact: true }).click(); await saved(page);
  expect((await documentState(page)).recentIds).not.toContain("a"); expect((await documentState(page)).notes[0].pinned).toBe(true);
  await page.getByRole("button", { name: /^Archive/ }).click(); await page.getByRole("button", { name: "Restore note", exact: true }).first().click(); await saved(page);
  await openNotebookSection(page, "Pinned"); await expect(page.getByLabel("Pinned items", { exact: true }).getByRole("button", { name: "Search draft", exact: true })).toBeVisible();
  await page.reload(); await openNotebookSection(page, "Pinned"); await expect(page.getByLabel("Pinned items", { exact: true }).getByRole("button", { name: "Search draft", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); state = await documentState(page); expect(state.notes.map(item => item.id)).toEqual(baseline.notes.map(item => item.id));
  await page.getByRole("button", { name: "Note options", exact: true }).click(); await page.getByRole("button", { name: "Delete permanently", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Delete permanently", exact: true }).click(); await saved(page);
  await openNotebookSection(page, "Pinned"); await expect(page.getByLabel("Pinned items", { exact: true }).locator(".shortcut-select")).toHaveCount(0); expect((await documentState(page)).recentIds).not.toContain("a"); await page.keyboard.press("Escape");
  expect((await documentState(page)).recentIds).not.toContain("a");
});

test("large-note match counting/navigation stays complete with bounded highlighting and responsive typing", async ({ page }) => {
  await seed(page, { ...fixture, referenceId: null, notes: [note("a", "Large draft", `<p>${"needle other ".repeat(1800)}</p>`)] });
  await openFind(page, "needle"); await expect(find(page).getByRole("status").first()).toHaveText(/of 1800$/);
  expect(await page.locator(".find-match").count()).toBeLessThanOrEqual(1000);
  await page.getByRole("button", { name: "Previous match", exact: true }).click(); await expect(find(page).getByRole("status").first()).toHaveText("1800 of 1800");
  await page.getByRole("button", { name: "Close find", exact: true }).click(); await editor(page).focus(); await page.keyboard.press("Control+End");
  await page.keyboard.type("typed immediately"); await expect(editor(page)).toContainText("typed immediately");
});

test("light/narrow and dark/wide Find UI keeps controls accessible, keyboard dismissal and native scrolling", async ({ page }) => {
  await mkdir(".impeccable/review", { recursive: true });
  await page.setViewportSize({ width: 850, height: 600 }); await seed(page); await openFind(page, "alpha", true);
  await page.getByRole("textbox", { name: "Find text", exact: true }).fill("");
  const checkPlaceholders = async () => {
    for (const label of ["Find text", "Replace with"]) {
      const input = page.getByRole("textbox", { name: label, exact: true });
      await expect(input).toHaveValue("");
      expect(await input.evaluate(element => {
        const placeholder = getComputedStyle(element, "::placeholder");
        return placeholder.color === getComputedStyle(element).color && placeholder.opacity === "1";
      })).toBe(true);
    }
  };
  await checkPlaceholders();
  await expect(page.getByRole("button", { name: "Replace all", exact: true })).toBeInViewport();
  await expect(page.locator(".reference-panel")).toHaveAttribute("inert", "");
  await expect(page.locator('button[aria-label="Reference"]')).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: ".impeccable/review/phase3-narrow-light.png" });
  await page.setViewportSize({ width: 1440, height: 920 }); await page.locator('button[aria-label="Reference"]').click(); await page.getByRole("button", { name: "Use dark mode", exact: true }).click(); await page.emulateMedia({ reducedMotion: "reduce" });
  await checkPlaceholders();
  await page.screenshot({ path: ".impeccable/review/phase3-wide-dark.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("textbox", { name: "Find text", exact: true }).focus(); await page.keyboard.press("Escape"); await expect(find(page)).toHaveCount(0);
});

test("replacement preserves image files and block-anchored ink through Undo and reload", async ({ page }) => {
  const stroke = JSON.stringify([{ color: "yellow", points: [[0.05,0.5],[0.3,0.5]] }]).replace(/"/g, "&quot;");
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=";
  await seed(page, { ...fixture, referenceId: null, notes: [note("a", "Preserved media", `<p data-note-ink="${stroke}">alpha ink</p><img src="${image}" alt="kept image"><p>alpha after image</p>`)] });
  await expect(page.locator(".document-editor img")).toHaveCount(1); await expect(page.locator(".document-panel .note-ink-layer g path")).toHaveCount(1);
  await openFind(page, "alpha", true); await page.getByRole("textbox", { name: "Replace with", exact: true }).fill("updated"); await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(page.locator(".document-editor img")).toHaveCount(1); await expect(page.locator(".document-panel .note-ink-layer g path")).toHaveCount(1);
  await page.getByRole("button", { name: "Close find", exact: true }).click(); await page.keyboard.press("Control+z"); await expect(editor(page)).toContainText("alpha after image");
  await saved(page); await page.reload(); await expect(page.locator(".document-editor img")).toHaveCount(1); await expect(page.locator(".document-panel .note-ink-layer g path")).toHaveCount(1);
});

test("board text search reveals the matching shape without mutating drawing and board pins survive reload", async ({ page }) => {
  const element = { id: "far-text", type: "text", x: 6000, y: 3000, width: 230, height: 25, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, index: null, text: "Far needle label", originalText: "Far needle label", containerId: null, fontFamily: 2, fontSize: 20, lineHeight: 1.25, textAlign: "left", verticalAlign: "top", autoResize: true };
  const board: Note = { ...note("board", "Search canvas", ""), kind: "board", board: { ...emptyBoard(), elements: [element] as never } };
  await seed(page, { ...fixture, notes: [...fixture.notes, board] });
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("needle");
  await expect(page.locator(".search-results mark")).toHaveText("needle"); await page.locator(".search-results .note-select").click();
  await expect(page.locator(".board-canvas canvas").first()).toBeVisible(); await expect(page.locator(".board-message")).toContainText("Far needle label");
  await saved(page); const before = (await documentState(page)).notes.find(item => item.id === "board")!;
  await page.getByRole("button", { name: "Board options", exact: true }).click(); await page.getByRole("button", { name: "Pin item", exact: true }).click();
  await page.getByRole("button", { name: "Clear search", exact: true }).click(); await saved(page);
  const after = (await documentState(page)).notes.find(item => item.id === "board")!;
  expect(after.updatedAt).toBe(before.updatedAt); expect(after.board).toEqual(before.board);
  await page.screenshot({ path: ".impeccable/review/phase3-board-search.png" });
  await page.reload(); await openNotebookSection(page, "Pinned"); await expect(page.getByLabel("Pinned items", { exact: true }).getByRole("button", { name: "Search canvas", exact: true })).toBeVisible();
});

import { invoke } from "@tauri-apps/api/core";
import { paragraphs } from "./importFiles";
import { isBoard, textExport, type Note, type Workspace } from "./types";

export type NotepadTab = { id: string; title: string; text: string };
export type NotepadScan = { tabs: NotepadTab[]; skipped: string[]; emptyTabs: number; savedTabs: number; found: boolean; sourceDirectory?: string };
export type NotepadSource = "notepad" | "notepadPlus";
export const notepadSourceName = (source: NotepadSource) => source === "notepadPlus" ? "Notepad++" : "Windows Notepad";
export const notepadFolderName = (source: NotepadSource) => source === "notepadPlus" ? "Notepad++ Imports" : NOTEPAD_FOLDER_NAME;
export const NEW_NOTEPAD_FOLDER = "__new_notepad_imports__";
export const NOTEPAD_FOLDER_NAME = "Notepad Imports";
export const scanNotepadTabs = () => invoke<NotepadScan>("scan_notepad_tabs");
export const scanNotepadPlusTabs = (directory?: string, chooseDirectory = false) => invoke<NotepadScan | null>("scan_notepad_plus_tabs", { directory: directory ?? null, chooseDirectory });

// Tiptap may serialize empty paragraphs differently after editing. Compare
// actual text, preserving spaces/tabs and internal empty lines, rather than HTML.
const comparable = (text: string) => text.replace(/\r\n|\r/g, "\n").replace(/\n+$/, "");
export function existingNotepadTexts(workspace: Workspace, folderId: string | null) {
  return new Set(workspace.notes.filter((n) => !isBoard(n) && !n.deletedAt && n.folderId === folderId)
    .map((n) => comparable(textExport(n.content))));
}
export function notepadDuplicateIds(workspace: Workspace, tabs: NotepadTab[], destination: string, source: NotepadSource = "notepad") {
  const folder = destination === NEW_NOTEPAD_FOLDER
    ? workspace.folders.find((f) => !f.deletedAt && f.name === notepadFolderName(source))?.id ?? null : destination || null;
  const existing = destination === NEW_NOTEPAD_FOLDER && !folder ? new Set<string>() : existingNotepadTexts(workspace, folder);
  return new Set(tabs.filter((tab) => existing.has(comparable(tab.text))).map((tab) => tab.id));
}
export function mergeNotepadTabs(workspace: Workspace, tabs: NotepadTab[], destination: string, source: NotepadSource = "notepad") {
  let folderId = destination || null;
  let folders = workspace.folders;
  if (destination === NEW_NOTEPAD_FOLDER) {
    folderId = folders.find((f) => !f.deletedAt && f.name === notepadFolderName(source))?.id ?? crypto.randomUUID();
    if (!folders.some((f) => f.id === folderId)) folders = [...folders, { id: folderId, name: notepadFolderName(source) }];
  } else if (folderId && !folders.some((f) => f.id === folderId && !f.deletedAt)) {
    throw Error("The destination folder was removed. Choose another folder.");
  }
  const existing = existingNotepadTexts(workspace, folderId);
  const added: Note[] = [];
  const time = new Date().toISOString();
  for (const tab of tabs) {
    if (!tab.text.trim() || existing.has(comparable(tab.text))) continue;
    added.push({ id: crypto.randomUUID(), title: tab.title, content: paragraphs(tab.text), folderId,
      createdAt: time, updatedAt: time, archived: false });
    existing.add(comparable(tab.text));
  }
  return { workspace: added.length ? { ...workspace, folders, notes: [...workspace.notes, ...added], activeId: added[0].id } : workspace,
    imported: added.length, duplicates: tabs.length - added.length, folderId };
}

import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./storage";
import { browserDatabase, requestValue, transactionDone } from "./browserData";
import type { Note, Workspace } from "./types";
import { validateWorkspace } from "./workspaceValidation";

export type HistoryEntry = { id: string; itemId: string; time: string; title: string; kind: string; bytes: number };
export const HISTORY_BYTES = 64 * 1024 * 1024;
export function bodyChanged(a: Note, b: Note) {
  return a.title !== b.title || a.content !== b.content || a.kind !== b.kind || (a.board !== b.board && JSON.stringify(a.board) !== JSON.stringify(b.board));
}
export function checkedHistoryNote(note: Note) {
  validateWorkspace({ schemaVersion: 5, theme: "light", activeId: "", referenceId: null,
    folders: note.folderId ? [{ id: note.folderId, name: "History" }] : [], notes: [note] });
  return note;
}
export async function recordBrowserHistory(transaction: IDBTransaction, previous: Note[], next: Note[], force?: Note) {
  const store = transaction.objectStore("history");
  let records: HistoryEntry[] | undefined;
  const now = Date.now(), nextById = new Map(next.map(note => [note.id, note]));
  const candidates = force ? [force] : previous.filter(note => {
    const after = nextById.get(note.id);
    return after && bodyChanged(note, after);
  });
  const removed = new Set(previous.filter(note => !nextById.has(note.id)).map(note => note.id));
  if (!candidates.length && !removed.size) return;
  for (const note of candidates) {
    const itemRecords = records ? records.filter(record => record.itemId === note.id)
      : await requestValue<HistoryEntry[]>(store.index("itemId").getAll(note.id));
    const recent = itemRecords.sort((a, b) => b.time.localeCompare(a.time))[0];
    if (!force && recent && now - Date.parse(recent.time) < 5 * 60_000) continue;
    checkedHistoryNote(note);
    const bytes = new TextEncoder().encode(JSON.stringify(note)).length;
    if (bytes > HISTORY_BYTES) { if (force) throw Error("This current version exceeds the history budget. Export a notebook backup before changing it."); continue; }
    records ||= await requestValue<HistoryEntry[]>(store.getAll());
    const sequenceTime = Math.max(now,...records.map(record => Date.parse(record.time) + 1));
    const record: HistoryEntry = { id: crypto.randomUUID(), itemId: note.id, time: new Date(sequenceTime).toISOString(), title: note.title, kind: note.kind || "note", bytes };
    store.put(record, record.id); transaction.objectStore("historyBodies").put(note,record.id); records.push(record);
  }
  // Explicit permanent deletion removes associated history. Trash preserves it.
  if (!records && !removed.size) return;
  records ||= await requestValue<HistoryEntry[]>(store.getAll());
  const counts = new Map<string, number>(); let total = 0;
  for (const record of records.sort((a, b) => b.time.localeCompare(a.time))) {
    const count = (counts.get(record.itemId) || 0) + 1;
    counts.set(record.itemId, count);
    if (removed.has(record.itemId) || count > 20 || now - Date.parse(record.time) > 30 * 86400_000 || total + record.bytes > HISTORY_BYTES) { store.delete(record.id); transaction.objectStore("historyBodies").delete(record.id); }
    else total += record.bytes;
  }
}
export async function listHistory(itemId: string): Promise<HistoryEntry[]> {
  if (desktop) return invoke("list_history", { itemId });
  const db = await browserDatabase();
  const records = await requestValue<HistoryEntry[]>(db.transaction("history").objectStore("history").index("itemId").getAll(itemId));
  return records.filter(record => record.itemId === itemId).sort((a, b) => b.time.localeCompare(a.time));
}
export async function readHistory(id: string): Promise<Note> {
  const db = desktop ? null : await browserDatabase();
  const note = desktop ? await invoke<Note>("read_history", { id }) : await requestValue<Note | undefined>(db!.transaction("historyBodies").objectStore("historyBodies").get(id));
  if (!note) throw Error("This version is no longer retained.");
  return checkedHistoryNote(note);
}
export async function checkpointHistory(note: Note, revision: number) {
  if (desktop) return invoke("checkpoint_history", { itemId: note.id, revision });
  const persist = async () => {
    const db = await browserDatabase(), transaction = db.transaction(["workspace", "notes", "history", "historyBodies"], "readwrite"), done = transactionDone(transaction);
    try {
      const state = await requestValue<any>(transaction.objectStore("workspace").get("current"));
      const saved = state ? null : JSON.parse(localStorage.getItem("still-notes-browser-v1") || "null");
      if ((state?.revision ?? saved?.revision ?? 0) !== revision) throw Error("The notebook changed elsewhere. Reopen history before restoring.");
      const current: Note | undefined = state ? await requestValue(transaction.objectStore("notes").get(note.id))
        : saved?.document.notes.find((item: Note) => item.id === note.id);
      if (!current || current.deletedAt) throw Error("The item is no longer available for restoration.");
      await recordBrowserHistory(transaction, [current], [current], current); await done;
    }
    catch (error) { try { transaction.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
  };
  return navigator.locks ? navigator.locks.request("notify-browser-workspace", persist) : persist();
}
export function historyRestoration(workspace: Workspace, id: string, version: Note): Workspace {
  const current = workspace.notes.find(note => note.id === id && !note.deletedAt);
  if (!current || current.id !== version.id) throw Error("The item changed or moved to Trash. Reopen history before restoring.");
  // Preserve today's organization and archive state while restoring the body.
  const { kind: _kind, board: _board, ...base } = current;
  const restored = { ...base, title: version.title, content: version.content, updatedAt: new Date().toISOString(),
    ...(version.kind === "board" ? { kind: "board" as const, board: version.board } : {}) } as Note;
  return { ...workspace, notes: workspace.notes.map(note => note.id === id ? restored : note) };
}

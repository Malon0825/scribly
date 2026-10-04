import { invoke, isTauri } from "@tauri-apps/api/core";
import type { StoredWorkspace, Workspace } from "./types";
import { validateWorkspace } from "./workspaceValidation";
import { configureAttachments } from "./attachments";
import { workspaceDelta } from "./workspaceDelta";
import { browserDatabase, requestValue, transactionDone } from "./browserData";
import { exportLargeBlob } from "./sourceFiles";
import { recordBrowserHistory } from "./history";
let acknowledged: { document: Workspace; revision: number } | null = null;
const KEY = "still-notes-browser-v1";
const previewSizes = new WeakMap<Workspace["notes"][number], number>();
function previewSize(note: Workspace["notes"][number]) {
  let size = previewSizes.get(note);
  if (size === undefined) { size = note.content.length + (note.kind === "board" ? JSON.stringify(note.board).length : 0); previewSizes.set(note, size); }
  return size;
}
export const desktop = isTauri();
export async function loadWorkspace(): Promise<StoredWorkspace> {
  if (desktop) {
    const loaded = await invoke<StoredWorkspace>("load_workspace");
    configureAttachments(loaded.dataPath, loaded.attachments);
    acknowledged = loaded.document ? { document: loaded.document, revision: loaded.revision } : null;
    return loaded;
  }
  const db = await browserDatabase();
  const transaction = db.transaction(["workspace", "notes"]), done = transactionDone(transaction);
  const state = await requestValue<any>(transaction.objectStore("workspace").get("current"));
  if (state) {
    const notes = await Promise.all(state.order.map((id: string) => requestValue(transaction.objectStore("notes").get(id))));
    await done;
    const document = { ...state.metadata, notes } as Workspace;
    validateWorkspace(document);
    acknowledged = { document, revision: state.revision };
    return { revision: state.revision, document, dataPath: "Browser preview storage (IndexedDB)" };
  }
  await done;
  const raw = localStorage.getItem(KEY);
  if (!raw) return { revision: 0, document: null, dataPath: "Browser preview storage" };
  const stored = JSON.parse(raw) as StoredWorkspace;
  if (!stored || !Number.isSafeInteger(stored.revision) || stored.revision < 0 || typeof stored.dataPath !== "string") throw Error("Invalid saved notebook. Browser storage was retained.");
  acknowledged = stored.document ? { document: stored.document, revision: stored.revision } : null;
  return stored;
}
export async function saveWorkspace(
  document: Workspace,
  revision: number,
): Promise<number> {
  if (desktop) {
    const next = acknowledged && acknowledged.revision === revision
      ? await invoke<number>("save_workspace_delta", { delta: workspaceDelta(acknowledged.document, document), revision })
      : await invoke<number>("save_workspace", { document, revision });
    acknowledged = { document, revision: next };
    return next;
  }
  const persist = async () => {
    validateWorkspace(document);
    const db = await browserDatabase();
    const state = await requestValue<any>(db.transaction("workspace").objectStore("workspace").get("current"));
    const raw = localStorage.getItem(KEY);
    const savedRevision = state?.revision ?? (raw ? JSON.parse(raw).revision : 0);
    if (savedRevision !== revision) throw Error("This notebook changed elsewhere. Export your unsaved notes as a backup before restarting the app.");
    const next = revision + 1;
    // Keep existing small-preview storage compatible, but move larger notebooks
    // into async per-item storage. This is a routing threshold, not a quota.
    if (!state && document.notes.reduce((size, note) => size + previewSize(note), 0) < 2 * 1024 * 1024) {
      try {
        const journal = db.transaction(["history", "historyBodies"], "readwrite"), journalDone = transactionDone(journal);
        await recordBrowserHistory(journal, acknowledged?.document.notes || [], document.notes);
        await journalDone;
        localStorage.setItem(KEY, JSON.stringify({ revision: next, document, dataPath: "Browser preview storage" }));
        acknowledged = { document, revision: next };
        return next;
      } catch (error) { if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error; }
    }
    const transaction = db.transaction(["workspace", "notes", "history", "historyBodies"], "readwrite"), done = transactionDone(transaction);
    try {
      const current = await requestValue<any>(transaction.objectStore("workspace").get("current"));
      const previousRevision = current?.revision ?? (raw ? JSON.parse(raw).revision : 0);
      if (previousRevision !== revision) throw Error("This notebook changed elsewhere. Reload before saving.");
      const old = new Map(acknowledged?.revision === revision ? acknowledged.document.notes.map(note => [note.id, note]) : []);
      const ids = new Set(document.notes.map(note => note.id));
      const keys = await requestValue(transaction.objectStore("notes").getAllKeys());
      await recordBrowserHistory(transaction, acknowledged?.document.notes || [], document.notes);
      for (const key of keys) if (!ids.has(String(key))) transaction.objectStore("notes").delete(key);
      for (const note of document.notes) if (!current || old.get(note.id) !== note) transaction.objectStore("notes").put(note, note.id);
      const { notes, ...metadata } = document;
      transaction.objectStore("workspace").put({ revision: next, metadata, order: notes.map(note => note.id) }, "current");
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already completed or aborted. */ }
      await done.catch(() => {});
      throw error;
    }
    acknowledged = { document, revision: next };
    // Remove the old copy only after IndexedDB has acknowledged the migration.
    try { localStorage.removeItem(KEY); } catch { /* The durable database is authoritative. */ }
    return next;
  };
  // Serialize the revision check and write across browser tabs when supported.
  return navigator.locks ? navigator.locks.request("notify-browser-workspace", persist) : persist();
}
export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportArtifact(name: string, value: string | Blob, type: string): Promise<boolean> {
  if (desktop) {
    // Raw IPC avoids expanding images into number arrays and JSON. Encode only
    // the small filename as ASCII JSON so international names survive headers.
    if (value instanceof Blob && value.size > 8 * 1024 * 1024) return exportLargeBlob(value, name);
    if (typeof value === "string" && value.length > 8 * 1024 * 1024) return exportLargeBlob(new Blob([value], { type }), name);
    const path = value instanceof Blob
      ? await invoke<string | null>("export_binary_file", await value.arrayBuffer(), {
        headers: { "X-Scribly-Export-Name": JSON.stringify(name).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) },
      })
      : await invoke<string | null>("export_file", { fileName: name, data: value });
    return !!path;
  }
  const url = URL.createObjectURL(value instanceof Blob ? value : new Blob([value], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  try { anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return true;
}

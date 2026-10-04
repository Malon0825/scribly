import { invoke, isTauri } from "@tauri-apps/api/core";
import type { StoredWorkspace, Workspace } from "./types";
import { validateWorkspace } from "./workspaceValidation";
import { configureAttachments } from "./attachments";
import { workspaceDelta } from "./workspaceDelta";
let acknowledged: { document: Workspace; revision: number } | null = null;
const KEY = "still-notes-browser-v1";
export const desktop = isTauri();
export async function loadWorkspace(): Promise<StoredWorkspace> {
  if (desktop) {
    const loaded = await invoke<StoredWorkspace>("load_workspace");
    configureAttachments(loaded.dataPath, loaded.attachments);
    acknowledged = loaded.document ? { document: loaded.document, revision: loaded.revision } : null;
    return loaded;
  }
  const raw = localStorage.getItem(KEY);
  if (!raw) return { revision: 0, document: null, dataPath: "Browser preview storage" };
  const stored = JSON.parse(raw) as StoredWorkspace;
  if (!stored || !Number.isSafeInteger(stored.revision) || stored.revision < 0 || typeof stored.dataPath !== "string") throw Error("Invalid saved notebook. Browser storage was retained.");
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
  const persist = () => {
    validateWorkspace(document);
    const raw = localStorage.getItem(KEY);
    const savedRevision = raw ? JSON.parse(raw).revision : 0;
    if (savedRevision !== revision) throw Error("This notebook changed elsewhere. Export your unsaved notes as a backup before restarting the app.");
    const next = revision + 1;
    localStorage.setItem(
      KEY,
      JSON.stringify({ revision: next, document, dataPath: "Browser preview storage" }),
    );
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
    if (value instanceof Blob && value.size > 20 * 1024 * 1024) throw Error("Image export exceeds 20 MB.");
    const path = value instanceof Blob
      ? await invoke<string | null>("export_binary_file", await value.arrayBuffer(), {
        headers: { "X-Scribly-Export-Name": JSON.stringify(name).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) },
      })
      : await invoke<string | null>("export_file", { fileName: name, data: value });
    return !!path;
  }
  const url = URL.createObjectURL(value instanceof Blob ? value : new Blob([value], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

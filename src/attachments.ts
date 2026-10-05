import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { Workspace } from "./types";
import { safeInlineImageSource } from "./rasterImages";
import { browserDatabase, requestValue } from "./browserData";

export const ATTACHMENT_ID = /^[a-f0-9]{64}\.(png|jpeg|gif|webp)$/;
const prefix = "notify-attachment:";
let root = "";
const sizes = new Map<string, number>();
export function configureAttachments(path: string, metadata: Record<string, number> = {}) {
  root = path; sizes.clear();
  for (const [id, size] of Object.entries(metadata)) if (ATTACHMENT_ID.test(id) && Number.isSafeInteger(size) && size > 0) sizes.set(id, size);
}
export function attachmentId(source: unknown): string | null {
  return typeof source === "string" && source.startsWith(prefix) && ATTACHMENT_ID.test(source.slice(prefix.length)) ? source.slice(prefix.length) : null;
}
export function attachmentSource(id: string) { return `${prefix}${id}`; }
export function availableAttachment(source: unknown) { const id = attachmentId(source); return !!id && !!root && sizes.has(id); }
export function imageElementSource(el: Element | null) {
  const id = el?.getAttribute("data-notify-attachment");
  return id && ATTACHMENT_ID.test(id) ? attachmentSource(id) : el?.getAttribute("src") || "";
}
export function imageSourceAttributes(source: string) {
  const id = attachmentId(source);
  return id ? { "data-notify-attachment": id } : { src: source };
}
export function displayImageSource(source: string) {
  const id = attachmentId(source);
  return id && availableAttachment(source) ? convertFileSrc(`${root}/attachments/${id}`) : id ? "" : source;
}
export async function storeAttachment(bytes: Uint8Array): Promise<string> {
  const result = await invoke<{ id: string; size: number }>("store_attachment", bytes);
  if (!ATTACHMENT_ID.test(result.id) || result.size !== bytes.length || !root) throw Error("Image storage could not be verified. Try adding it again.");
  sizes.set(result.id, result.size);
  return attachmentSource(result.id);
}
export function attachmentIds(html: string): string[] {
  // IDs only; never cache image bytes. Supports serialized recovery records too.
  return [...html.matchAll(/<img\b[^>]*\bdata-notify-attachment=\\?["']([a-f0-9]{64}\.(?:png|jpeg|gif|webp))\\?["']/g)].map(match => match[1]);
}
export async function compactImages<T extends { notes: Workspace["notes"] }>(document: T): Promise<T> {
  if (!isTauri()) return document;
  let changed = false;
  const notes: Workspace["notes"] = [];
  for (const note of document.notes) {
    if (note.kind === "board" || !note.content.includes("data:image/")) { notes.push(note); continue; }
    const dom = window.document.createElement("template"); dom.innerHTML = note.content;
    let edited = false;
    for (const img of dom.content.querySelectorAll("img[src]")) {
      const source = img.getAttribute("src")!;
      if (!safeInlineImageSource(source)) continue;
      const bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), c => c.charCodeAt(0));
      const id = attachmentId(await storeAttachment(bytes))!;
      img.removeAttribute("src"); img.setAttribute("data-notify-attachment", id); edited = true;
    }
    changed ||= edited;
    notes.push(edited ? { ...note, content: dom.innerHTML } : note);
  }
  return changed ? { ...document, notes, schemaVersion: (document as { schemaVersion?: number }).schemaVersion === 5 ? 5 : (document as { schemaVersion?: number }).schemaVersion === 4 ? 4 : 3 } : document;
}
export function attachmentSchema(document: Workspace): Workspace {
  if (document.schemaVersion === 5 || document.notes.some(n => n.deletedAt)) return document.schemaVersion === 5 ? document : { ...document, schemaVersion: 5 };
  if (document.notes.some(n => n.content.includes("data-notify-source"))) return document.schemaVersion === 4 ? document : { ...document, schemaVersion: 4 };
  if (document.schemaVersion === 4) return document;
  return document.schemaVersion !== 3 && document.notes.some(n => attachmentIds(n.content).length > 0)
    ? { ...document, schemaVersion: 3 } : document;
}
export async function portableBackup(document: Workspace): Promise<string> {
  const data = new Map<string, string>();
  const notes: Workspace["notes"] = [];
  for (const note of document.notes) {
    if (!note.content.includes("data-notify-attachment=")) { notes.push(note); continue; }
    const dom = window.document.createElement("template"); dom.innerHTML = note.content;
    for (const img of dom.content.querySelectorAll("img[data-notify-attachment]")) {
      const id = img.getAttribute("data-notify-attachment")!;
      if (!ATTACHMENT_ID.test(id)) throw Error("Invalid image reference. Backup was not exported.");
      if (!data.has(id)) {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_attachment", { id }));
        // Chunk conversion avoids argument/stack limits on multi-MB images.
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        data.set(id, `data:image/${id.split(".")[1]};base64,${btoa(binary)}`);
      }
      img.setAttribute("src", data.get(id)!); img.removeAttribute("data-notify-attachment");
    }
    notes.push({ ...note, content: dom.innerHTML });
  }
  const originals = notes.some(note => note.content.includes("data-notify-source"));
  return JSON.stringify({ ...document, ...(!originals && document.schemaVersion !== 5 && (document.schemaVersion === 3 || document.schemaVersion === 4) ? { schemaVersion: 2 } : {}), notes });
}
export async function pruneAttachments(document: Workspace) {
  if (!isTauri()) return;
  // Retain all recoverable/conflicting drafts. On storage failure, skip cleanup.
  try {
    const keep = new Set(document.notes.flatMap(n => attachmentIds(n.content)));
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith("still-notes-recovery")) for (const id of (localStorage.getItem(key) || "").match(/[a-f0-9]{64}\.(?:png|jpeg|gif|webp)/g) || []) keep.add(id);
    }
    const db = await browserDatabase();
    for (const record of await requestValue<string[]>(db.transaction("recovery").objectStore("recovery").getAll())) {
      for (const id of record.match(/[a-f0-9]{64}\.(?:png|jpeg|gif|webp)/g) || []) keep.add(id);
    }
    await invoke("prune_attachments", { keep: [...keep] });
  } catch { /* Saving and recovery take priority over optional disk reclamation. */ }
}

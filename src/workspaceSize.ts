import type { Note, Workspace } from "./types";
import { attachmentBytes, attachmentIds } from "./attachments";
const encoder = new TextEncoder();
const cache = new WeakMap<Note, { bytes: number; ids: string[] }>();
// Serialize changed items only. Unchanged boards/images never cross this hot
// typing path again; metadata/order remains cheap and shared references matter.
export function workspaceBytes(workspace: Workspace) {
  const { notes, ...metadata } = workspace;
  let bytes = encoder.encode(JSON.stringify({ ...metadata, notes: [] })).length;
  const ids: string[] = [];
  for (const note of notes) {
    let record = cache.get(note);
    if (!record) { record = { bytes: encoder.encode(JSON.stringify(note)).length, ids: attachmentIds(note.content) }; cache.set(note, record); }
    bytes += record.bytes;
    for (const id of record.ids) ids.push(id);
  }
  bytes += Math.max(0, notes.length - 1);
  return Math.max(bytes, bytes + attachmentBytes(ids));
}

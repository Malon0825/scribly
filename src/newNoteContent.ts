import type { Workspace } from "./types";
import { isBoard, isTemplate } from "./types";

export function newNoteContent(workspace: Workspace, folderId: string | null): string {
  const folder = workspace.folders.find((f) => f.id === folderId);
  if (!folder?.copyLastNote) return "<p></p>";
  // Creation time is independent of sidebar order, edits, and drag operations.
  let latest: Workspace["notes"][number] | undefined;
  for (const note of workspace.notes) {
    if (note.folderId !== folderId || note.archived || note.deletedAt || isBoard(note) || isTemplate(note)) continue;
    if (!latest || Date.parse(note.createdAt) >= Date.parse(latest.createdAt))
      latest = note;
  }
  return latest?.content ?? "<p></p>";
}

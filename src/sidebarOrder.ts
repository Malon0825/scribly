import { isTemplate, type Workspace } from "./types";

export type SidebarItem = { kind: "folder" | "note"; id: string };
export type SidebarDrop =
  | { kind: "folder-order" | "note-order"; id: string; after: boolean }
  | { kind: "folder"; id: string | null };

// Array order is persisted with the notebook, including in backups.
export function applySidebarDrop(
  workspace: Workspace,
  item: SidebarItem,
  target: SidebarDrop,
): Workspace {
  if (item.kind === "folder") {
    if (target.kind !== "folder-order" || item.id === target.id) return workspace;
    const folder = workspace.folders.find((f) => f.id === item.id);
    const folders = workspace.folders.filter((f) => f.id !== item.id);
    const index = folders.findIndex((f) => f.id === target.id);
    if (!folder || index < 0) return workspace;
    folders.splice(index + Number(target.after), 0, folder);
    if (folders.every((f, i) => f === workspace.folders[i])) return workspace;
    return { ...workspace, folders };
  }

  if (target.kind === "folder-order") return workspace;
  const note = workspace.notes.find((n) => n.id === item.id);
  const anchor = target.kind === "note-order"
    ? workspace.notes.find((n) => n.id === target.id)
    : undefined;
  if (!note || isTemplate(note) || note.archived || note.deletedAt ||
      (target.kind === "note-order" && (!anchor || isTemplate(anchor) || anchor.archived || anchor.deletedAt || anchor.id === note.id)))
    return workspace;
  const folderId = target.kind === "folder" ? target.id : anchor!.folderId;
  if (folderId !== null && !workspace.folders.some((f) => f.id === folderId))
    return workspace;

  const notes = workspace.notes.filter((n) => n.id !== item.id);
  let index = notes.length;
  if (anchor) index = notes.findIndex((n) => n.id === anchor.id) + Number(target.kind === "note-order" && target.after);
  else {
    // Append after this folder's last visible note, leaving other groups in order.
    for (let i = notes.length - 1; i >= 0; i--) {
      if (notes[i].folderId === folderId && !isTemplate(notes[i]) && !notes[i].archived && !notes[i].deletedAt) { index = i + 1; break; }
    }
  }
  const moved = note.folderId === folderId
    ? note
    : { ...note, folderId, updatedAt: new Date().toISOString() };
  notes.splice(index, 0, moved);
  if (notes.every((n, i) => n === workspace.notes[i])) return workspace;
  return { ...workspace, notes };
}

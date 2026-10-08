import { isTemplate, isLiveItem, type Folder, type Workspace } from "./types";
import { orderNotes } from "./notebookNavigation";
import { trashFolder, trashItem } from "./trash";

export type SidebarItem = { kind: "folder" | "note"; id: string };
export type SidebarDrop =
  | { kind: "trash"; id: null }
  | { kind: "folder-order" | "note-order"; id: string; after: boolean }
  | { kind: "folder"; id: string | null };

export function orderFolders(folders: Folder[]): Folder[] {
  if (folders.some(folder => folder.sidebarManual)) return folders;
  // Legacy folders have no timestamp; their insertion order supplies the fallback.
  return [...folders].reverse().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Materialize the displayed group order before applying an insertion slot.
function orderedNotes(workspace: Workspace) {
  const groups = new Map<string | null, ReturnType<typeof orderNotes>>();
  for (const note of workspace.notes) {
    if (!isLiveItem(note)) continue;
    const group = groups.get(note.folderId) || [];
    group.push(note);
    groups.set(note.folderId, group);
  }
  const positions = new Map<string | null, number>();
  for (const [id, notes] of groups) groups.set(id, orderNotes(notes, 'manual'));
  return workspace.notes.map(note => {
    if (!isLiveItem(note)) return note;
    const index = positions.get(note.folderId) || 0;
    positions.set(note.folderId, index + 1);
    return groups.get(note.folderId)![index];
  });
}

// Array order and explicit manual overrides are persisted, including in backups.
export function applySidebarDrop(
  workspace: Workspace,
  item: SidebarItem,
  target: SidebarDrop,
): Workspace {
  if (target.kind === "trash") return item.kind === "folder" ? trashFolder(workspace, item.id) : trashItem(workspace, item.id);
  if (item.kind === "folder") {
    if (target.kind !== "folder-order" || item.id === target.id) return workspace;
    const folder = workspace.folders.find((f) => f.id === item.id && !f.deletedAt);
    const displayed = orderFolders(workspace.folders.filter(f => !f.deletedAt));
    const folders = displayed.filter((f) => f.id !== item.id);
    const index = folders.findIndex((f) => f.id === target.id);
    if (!folder || index < 0) return workspace;
    folders.splice(index + Number(target.after), 0, folder);
    if (folders.every((f, i) => f === displayed[i])) return workspace;
    return { ...workspace, folders: [...folders.map(f => ({ ...f, sidebarManual: true })), ...workspace.folders.filter(f => f.deletedAt)] };
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
  if (folderId !== null && !workspace.folders.some((f) => f.id === folderId && !f.deletedAt))
    return workspace;

  const displayed = orderedNotes(workspace);
  const notes = displayed.filter((n) => n.id !== item.id);
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
  if (notes.every((n, i) => n === displayed[i])) return workspace;
  return { ...workspace, notes: notes.map(n => isLiveItem(n) && n.folderId === folderId ? { ...n, sidebarManual: true } : n) };
}

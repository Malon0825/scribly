import { isLiveItem, type Workspace } from "./types";

export function trashItem(workspace: Workspace, id: string, time = new Date().toISOString()): Workspace {
  const item = workspace.notes.find(note => note.id === id && !note.deletedAt);
  if (!item) return workspace;
  const remaining = workspace.notes.filter(note => note.id !== id && isLiveItem(note));
  return { ...workspace, schemaVersion: 5,
    notes: workspace.notes.map(note => note.id === id ? { ...note, deletedAt: time, updatedAt: time } : note),
    activeId: workspace.activeId === id ? remaining.find(note => note.folderId === item.folderId)?.id || remaining[0]?.id || "" : workspace.activeId,
    referenceId: workspace.referenceId === id ? null : workspace.referenceId };
}
export function restoreTrashItem(workspace: Workspace, id: string): Workspace {
  return { ...workspace, notes: workspace.notes.map(note => {
    if (note.id !== id || !note.deletedAt) return note;
    const { deletedAt: _deleted, ...restored } = note;
    return { ...restored, folderId: workspace.folders.some(folder => folder.id === note.folderId) ? note.folderId : null, updatedAt: new Date().toISOString() };
  }), activeId: id };
}
export function purgeTrash(workspace: Workspace, id?: string): Workspace {
  const notes = workspace.notes.filter(note => !(note.deletedAt && (!id || note.id === id)));
  return { ...workspace, notes, activeId: notes.some(note => note.id === workspace.activeId) ? workspace.activeId : notes.find(isLiveItem)?.id || "",
    referenceId: notes.some(note => note.id === workspace.referenceId && !note.deletedAt) ? workspace.referenceId : null };
}

import { isLiveItem, type Workspace } from "./types";

// Preserve existing archived content when retiring Archive, including backups.
export function migrateArchiveToTrash(workspace: Workspace): Workspace {
  if (!workspace.notes.some(note => note.archived)) return workspace;
  return { ...workspace, schemaVersion: 5, referenceId: workspace.notes.some(note => note.id === workspace.referenceId && note.archived) ? null : workspace.referenceId,
    notes: workspace.notes.map(note => note.archived ? { ...note, archived: false, deletedAt: note.deletedAt || (Number.isFinite(Date.parse(note.updatedAt)) ? note.updatedAt : new Date().toISOString()) } : note) };
}

export function trashFolder(workspace: Workspace, id: string, time = new Date().toISOString()): Workspace {
  if (!workspace.folders.some(folder => folder.id === id && !folder.deletedAt)) return workspace;
  const notes = workspace.notes.map(note => note.folderId === id && !note.deletedAt ? { ...note, archived: false, deletedAt: time, updatedAt: time } : note);
  return { ...workspace, schemaVersion: 5, notes,
    folders: workspace.folders.map(folder => folder.id === id ? { ...folder, deletedAt: time } : folder),
    activeId: notes.some(note => note.id === workspace.activeId && note.folderId === id) ? notes.find(isLiveItem)?.id || "" : workspace.activeId,
    referenceId: notes.some(note => note.id === workspace.referenceId && note.folderId === id) ? null : workspace.referenceId };
}

export function restoreTrashFolder(workspace: Workspace, id: string): Workspace {
  const folder = workspace.folders.find(folder => folder.id === id && folder.deletedAt);
  if (!folder) return workspace;
  const { deletedAt, ...restored } = folder;
  const time = new Date().toISOString();
  const notes = workspace.notes.map(note => {
    if (note.folderId !== id || note.deletedAt !== deletedAt) return note;
    const { deletedAt: _deleted, ...item } = note;
    return { ...item, archived: false, updatedAt: time };
  });
  return { ...workspace, folders: workspace.folders.map(item => item.id === id ? restored : item), notes,
    activeId: notes.find(note => note.folderId === id && isLiveItem(note))?.id || notes.find(isLiveItem)?.id || "" };
}

export function trashItem(workspace: Workspace, id: string, time = new Date().toISOString()): Workspace {
  const item = workspace.notes.find(note => note.id === id && !note.deletedAt);
  if (!item) return workspace;
  const remaining = workspace.notes.filter(note => note.id !== id && isLiveItem(note));
  return { ...workspace, schemaVersion: 5,
    notes: workspace.notes.map(note => note.id === id ? { ...note, archived: false, deletedAt: time, updatedAt: time } : note),
    activeId: workspace.activeId === id ? remaining.find(note => note.folderId === item.folderId)?.id || remaining[0]?.id || "" : workspace.activeId,
    referenceId: workspace.referenceId === id ? null : workspace.referenceId };
}
export function restoreTrashItem(workspace: Workspace, id: string): Workspace {
  const parentId = workspace.notes.find(note => note.id === id)?.folderId;
  return { ...workspace, folders: workspace.folders.map(folder => {
    if (folder.id !== parentId || !folder.deletedAt) return folder;
    const { deletedAt: _deleted, ...restored } = folder;
    return restored;
  }), notes: workspace.notes.map(note => {
    if (note.id !== id || !note.deletedAt) return note;
    const { deletedAt: _deleted, ...restored } = note;
    return { ...restored, archived: false, folderId: workspace.folders.some(folder => folder.id === note.folderId) ? note.folderId : null, updatedAt: new Date().toISOString() };
  }), activeId: id };
}
export function purgeTrash(workspace: Workspace, id?: string): Workspace {
  const notes = workspace.notes.filter(note => !(note.deletedAt && (!id || note.id === id)));
  return { ...workspace, notes, folders: id ? workspace.folders : workspace.folders.filter(folder => !folder.deletedAt), activeId: notes.some(note => note.id === workspace.activeId) ? workspace.activeId : notes.find(isLiveItem)?.id || "",
    referenceId: notes.some(note => note.id === workspace.referenceId && !note.deletedAt) ? workspace.referenceId : null };
}

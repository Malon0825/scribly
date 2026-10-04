import { isLiveItem, type Workspace } from "./types";

export const RECENT_ITEMS_LIMIT = 10;
export function normalizeNavigation(workspace: Workspace): Workspace {
  const available = new Set(workspace.notes.filter(isLiveItem).map(note => note.id));
  const recentIds = [...new Set(workspace.recentIds || [])].filter(id => available.has(id)).slice(0, RECENT_ITEMS_LIMIT);
  return recentIds.length === (workspace.recentIds || []).length && recentIds.every((id, i) => id === workspace.recentIds?.[i])
    ? workspace : { ...workspace, recentIds };
}
export function recordOpened(workspace: Workspace, id = workspace.activeId): Workspace {
  const normalized = normalizeNavigation(workspace);
  if (!normalized.notes.some(note => note.id === id && isLiveItem(note))) return normalized;
  const recentIds = [id, ...(normalized.recentIds || []).filter(entry => entry !== id)].slice(0, RECENT_ITEMS_LIMIT);
  return recentIds.every((entry, i) => entry === normalized.recentIds?.[i]) && recentIds.length === normalized.recentIds?.length
    ? normalized : { ...normalized, recentIds };
}

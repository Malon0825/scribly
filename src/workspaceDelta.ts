import type { Workspace } from "./types";
export function workspaceDelta(before: Workspace, after: Workspace) {
  const previous = new Map(before.notes.map(n => [n.id, n]));
  const { notes, ...metadata } = after;
  return { metadata, order: notes.map(n => n.id), changed: notes.filter(n => previous.get(n.id) !== n) };
}

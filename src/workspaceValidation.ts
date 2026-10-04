import type { Workspace } from "./types";
import { MAX_WORKSPACE_BYTES, validateBoard } from "./boardData";
import { workspaceBytes } from "./workspaceSize";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function validateWorkspace(value: unknown): asserts value is Workspace {
  if (!object(value)) throw Error("Invalid notebook document.");
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2 && value.schemaVersion !== 3) throw Error("This notebook needs a newer Scribly version. Preserve a backup before changing it.");
  if (!Array.isArray(value.folders) || !Array.isArray(value.notes)
    || !["light", "dark", "system"].includes(String(value.theme)) || typeof value.activeId !== "string"
    || (value.referenceId !== null && typeof value.referenceId !== "string")) throw Error("Invalid notebook structure.");
  const folders = new Set<string>(), notes = new Set<string>();
  for (const f of value.folders) {
    if (!object(f) || typeof f.id !== "string" || !f.id || folders.has(f.id) || typeof f.name !== "string"
      || (f.copyLastNote !== undefined && typeof f.copyLastNote !== "boolean")) throw Error("Invalid or duplicate notebook folder.");
    folders.add(f.id);
  }
  for (const n of value.notes) {
    if (!object(n) || typeof n.id !== "string" || !n.id || notes.has(n.id)
      || ![n.title, n.content, n.createdAt, n.updatedAt].every((v) => typeof v === "string") || typeof n.archived !== "boolean"
      || (n.folderId !== null && (typeof n.folderId !== "string" || !folders.has(n.folderId)))) throw Error("Invalid notebook item or missing folder.");
    notes.add(n.id);
    if (n.kind !== undefined && n.kind !== "note" && n.kind !== "board") throw Error("Unsupported notebook item.");
    if (n.kind === "board") validateBoard(n.board);
    else if (n.board !== undefined) throw Error("A note cannot contain board data.");
    if (n.autoTitle !== undefined && (!object(n.autoTitle)
      || (n.autoTitle.folderId !== null && typeof n.autoTitle.folderId !== "string")
      || typeof n.autoTitle.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(n.autoTitle.day)
      || !Number.isSafeInteger(n.autoTitle.ordinal) || (n.autoTitle.ordinal as number) < 0)) throw Error("Invalid automatic note title.");
  }
  if (workspaceBytes(value as Workspace) > MAX_WORKSPACE_BYTES) throw Error("Notebook exceeds the 20 MB save limit. Preserve a backup before changing it.");
}

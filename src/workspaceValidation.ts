import type { Workspace } from "./types";
import { validateBoard } from "./boardData";
import { sourceFilesInHtml } from "./sourceFileData";
import { validateMeetingNote } from './meetingNotes';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function validateWorkspace(value: unknown): asserts value is Workspace {
  if (!object(value)) throw Error("Invalid notebook document.");
  if (value.schemaVersion !== undefined && ![2, 3, 4, 5].includes(Number(value.schemaVersion))) throw Error("This notebook needs a newer Scribly version. Preserve a backup before changing it.");
  if (!Array.isArray(value.folders) || !Array.isArray(value.notes)
    || !["light", "dark", "system", "notebook"].includes(String(value.theme)) || typeof value.activeId !== "string"
    || (value.referenceId !== null && typeof value.referenceId !== "string")) throw Error("Invalid notebook structure.");
  const folders = new Set<string>(), notes = new Set<string>(), templates = new Set<string>();
  for (const f of value.folders) {
    if (!object(f) || typeof f.id !== "string" || !f.id || folders.has(f.id) || typeof f.name !== "string"
      || (f.copyLastNote !== undefined && typeof f.copyLastNote !== "boolean")) throw Error("Invalid or duplicate notebook folder.");
    folders.add(f.id);
    if (f.deletedAt !== undefined && (value.schemaVersion !== 5 || typeof f.deletedAt !== "string" || !Number.isFinite(Date.parse(f.deletedAt)))) throw Error("Invalid Trash folder or notebook format.");
  }
  for (const n of value.notes) {
    if (!object(n) || typeof n.id !== "string" || !n.id || notes.has(n.id)
      || ![n.title, n.content, n.createdAt, n.updatedAt].every((v) => typeof v === "string") || typeof n.archived !== "boolean"
      || (n.folderId !== null && (typeof n.folderId !== "string" || !folders.has(n.folderId)))) throw Error("Invalid notebook item or missing folder.");
    notes.add(n.id);
    if (n.meeting !== undefined) { validateMeetingNote(n.meeting); if (n.kind === 'board' || n.kind === 'template') throw Error('Only notes can be linked to meetings.'); }
    if (n.pinned !== undefined && typeof n.pinned !== "boolean") throw Error("Invalid pinned item.");
    if (n.kind !== undefined && n.kind !== "note" && n.kind !== "board" && n.kind !== "template") throw Error("Unsupported notebook item.");
    if (n.kind === "template") {
      if (!object(n.template) || typeof n.template.titlePattern !== "string" || !n.template.titlePattern.trim() || n.template.titlePattern.length > 200 || typeof n.template.resetChecklist !== "boolean"
        || !(n.title as string).trim() || (n.title as string).length > 200 || n.folderId !== null || n.archived || n.deletedAt !== undefined || n.pinned || n.autoTitle !== undefined) throw Error("Invalid note template.");
      templates.add(n.id);
    } else if (n.template !== undefined) throw Error("Only templates can contain template settings.");
    if (n.kind === "board") validateBoard(n.board);
    else if (n.board !== undefined) throw Error("A note cannot contain board data.");
    if (sourceFilesInHtml(n.content as string).length && ![4, 5].includes(Number(value.schemaVersion))) throw Error("Source files require notebook format 4 or later.");
    if (n.deletedAt !== undefined && (value.schemaVersion !== 5 || typeof n.deletedAt !== "string" || !Number.isFinite(Date.parse(n.deletedAt)))) throw Error("Invalid Trash item or notebook format.");
    if (n.autoTitle !== undefined && (!object(n.autoTitle)
      || (n.autoTitle.folderId !== null && typeof n.autoTitle.folderId !== "string")
      || typeof n.autoTitle.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(n.autoTitle.day)
      || !Number.isSafeInteger(n.autoTitle.ordinal) || (n.autoTitle.ordinal as number) < 0)) throw Error("Invalid automatic note title.");
  }
  for (const folder of value.folders) if (folder.templateId !== undefined && (typeof folder.templateId !== "string" || !templates.has(folder.templateId))) throw Error("A folder refers to a missing note template.");
  if (templates.has(value.activeId as string) || templates.has(value.referenceId as string)) throw Error("Templates cannot be selected as live notebook items.");
  if (value.recentIds !== undefined && (!Array.isArray(value.recentIds) || value.recentIds.length > 10
    || !value.recentIds.every(id => typeof id === "string" && notes.has(id) && !templates.has(id))
    || new Set(value.recentIds).size !== value.recentIds.length)) throw Error("Invalid recently opened items.");
}

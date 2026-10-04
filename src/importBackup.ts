import type { Workspace, Note, Folder } from "./types";
import { safeImageSource } from "./imageFiles";
import { isBoard } from "./types";
import { validateBoard } from "./boardData";
import { attachmentSchema } from "./attachments";
import { validTextColor } from "./textColors";
import { inkAttributes } from "./inkData";
// Imported documents are limited to the formatting supported by our editor.
function cleanHtml(html: string): string {
  const doc = document.createElement("template"); doc.innerHTML = html;
  doc.content
    .querySelectorAll(
      "script,style,iframe,object,embed,link,meta,video,audio",
    )
    .forEach((el) => el.remove());
  const allowed = new Set([
    "P",
    "H1",
    "H2",
    "H3",
    "UL",
    "OL",
    "LI",
    "STRONG",
    "B",
    "EM",
    "I",
    "S",
    "BR",
    "BLOCKQUOTE",
    "PRE",
    "CODE",
    "HR",
    "A",
    "LABEL",
    "INPUT",
    "SPAN",
    "DIV",
    "FIGURE",
    "FIGCAPTION",
    "IMG",
  ]);
  for (const el of Array.from(doc.content.querySelectorAll("*"))) {
    if (el.tagName === "IMG" && (el.hasAttribute("data-notify-attachment") || el.getAttribute("src")?.startsWith("notify-attachment:"))) throw Error("This backup contains local image references. Export a portable backup from its original notebook first.");
    if (el.tagName === "IMG" && !safeImageSource(el.getAttribute("src"))) { el.remove(); continue; }
    if (!allowed.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "data-note-ink" && ["P", "H1", "H2", "H3", "UL", "OL", "BLOCKQUOTE", "PRE", "FIGURE"].includes(el.tagName)) {
        const value = inkAttributes(attr.value)["data-note-ink"];
        if (value) { el.setAttribute(attr.name, value); continue; }
      }
      if (el.tagName === "SPAN" && ["data-text-color", "data-background-color"].includes(attr.name) && validTextColor(attr.value)) continue;
      if (el.tagName === "IMG" && ["src", "alt", "title"].includes(attr.name)) {
        if (attr.name !== "src") el.setAttribute(attr.name, attr.value.slice(0, 300));
        continue;
      }
      if (el.tagName === "FIGURE") {
        if (attr.name === "data-notify-image") { el.setAttribute(attr.name, ""); continue; }
        if (attr.name === "data-width" && Number.isFinite(Number(attr.value)) && Number(attr.value) >= 20 && Number(attr.value) <= 100) continue;
        if (attr.name === "data-align" && ["left", "center", "right"].includes(attr.value)) continue;
      }
      if (el.tagName === "CODE" && el.parentElement?.tagName === "PRE" &&
          attr.name === "class" && /^language-[a-z0-9_+#-]{1,40}$/i.test(attr.value)) continue;
      if (
        (attr.name === "data-type" &&
          ["taskList", "taskItem"].includes(attr.value)) ||
        (attr.name === "data-checked" && ["true", "false"].includes(attr.value))
      )
        continue;
      if (
        el.tagName === "A" &&
        attr.name === "href" &&
        /^https?:\/\//i.test(attr.value)
      )
        continue;
      el.removeAttribute(attr.name);
    }
    if (el.tagName === "INPUT") el.setAttribute("type", "checkbox");
  }
  return doc.innerHTML;
}
export function parseBackup(
  value: unknown,
): Pick<Workspace, "notes" | "folders"> {
  if (!value || typeof value !== "object")
    throw Error("This is not a Scribly backup.");
  const v = value as Workspace;
  if (v.schemaVersion !== undefined && v.schemaVersion !== 2) throw Error("Unsupported backup version. Use a newer Scribly version.");
  if (!Array.isArray(v.notes) || !Array.isArray(v.folders))
    throw Error("This backup has no notebook.");
  const folderIds = new Set<string>(),
    noteIds = new Set<string>();
  const folders: Folder[] = v.folders.map((f) => {
    if (
      typeof f.id !== "string" ||
      typeof f.name !== "string" ||
      (f.copyLastNote !== undefined && typeof f.copyLastNote !== "boolean") ||
      folderIds.has(f.id)
    )
      throw Error("Invalid folder in backup.");
    folderIds.add(f.id);
    return { id: f.id, name: f.name,
      ...(f.copyLastNote !== undefined ? { copyLastNote: f.copyLastNote } : {}),
    };
  });
  const notes: Note[] = v.notes.map((n) => {
    if (
      typeof n.id !== "string" ||
      noteIds.has(n.id) ||
      typeof n.title !== "string" ||
      typeof n.content !== "string" ||
      typeof n.archived !== "boolean" ||
      !Number.isFinite(Date.parse(n.createdAt)) ||
      !Number.isFinite(Date.parse(n.updatedAt))
    )
      throw Error("Invalid note in backup.");
    noteIds.add(n.id);
    if (n.autoTitle !== undefined) {
      const naming = n.autoTitle;
      if (!naming || typeof naming !== "object" ||
          (naming.folderId !== null && typeof naming.folderId !== "string") ||
          typeof naming.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(naming.day) ||
          !Number.isSafeInteger(naming.ordinal) || naming.ordinal < 0)
        throw Error("Invalid automatic title in backup.");
    }
    if (
      n.folderId !== null &&
      (typeof n.folderId !== "string" || !folderIds.has(n.folderId))
    )
      throw Error("A backup note has a missing folder.");
    if (n.kind !== undefined && n.kind !== "note" && n.kind !== "board") throw Error("Unsupported backup item.");
    if (isBoard(n)) { validateBoard(n.board); return { ...n, content: "" }; }
    if (n.board !== undefined) throw Error("A note cannot contain a board payload.");
    return { ...n, content: cleanHtml(n.content) };
  });
  return { notes, folders };
}
export function mergeBackup(
  current: Workspace,
  backup: Pick<Workspace, "notes" | "folders">,
): Workspace {
  const folderMap = new Map<string, string>(),
    folders = [...current.folders];
  for (const f of backup.folders) {
    const existing = folders.find((e) => e.name === f.name);
    const id = existing?.id || crypto.randomUUID();
    folderMap.set(f.id, id);
    if (!existing) folders.push({ ...f, id });
  }
  const notes = backup.notes.map((n) => ({
    ...n,
    id: crypto.randomUUID(),
    folderId: n.folderId ? folderMap.get(n.folderId)! : null,
    ...(n.autoTitle ? {
      autoTitle: { ...n.autoTitle, folderId: n.autoTitle.folderId
        ? folderMap.get(n.autoTitle.folderId) || n.autoTitle.folderId : null },
    } : {}),
  }));
  return attachmentSchema({
    ...current,
    ...(backup.notes.some(isBoard) ? { schemaVersion: current.schemaVersion || 2 as const } : {}),
    folders,
    notes: [...current.notes, ...notes],
    activeId: notes.find((n) => !n.archived)?.id || current.activeId,
  });
}

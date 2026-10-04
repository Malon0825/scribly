import { isBoard, isTemplate, type Note } from "./types";

export const validItemId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200 && !/[\x00-\x1f\x7f]/.test(id);
export function itemHref(id: string) { return `#scribly-item/${encodeURIComponent(id)}`; }
export function itemIdFromHref(href: unknown): string | null {
  if (typeof href !== "string" || !href.startsWith("#scribly-item/")) return null;
  try { const id = decodeURIComponent(href.slice(14)); return validItemId(id) ? id : null; } catch { return null; }
}
export function safeExternalHref(href: unknown): href is string {
  if (typeof href !== "string" || /[\x00-\x20\x7f]/.test(href)) return false;
  try { return ["https:", "http:"].includes(new URL(href).protocol); } catch { return false; }
}
export function linkHtml(id: string, title: string) {
  const el = document.createElement("a"); el.dataset.itemId = id; el.setAttribute("href", itemHref(id)); el.textContent = title || "Untitled"; return el.outerHTML;
}
const targets = new WeakMap<Note, Set<string>>();
export function linkedIds(note: Note) {
  const cached = targets.get(note); if (cached) return cached;
  const ids = new Set<string>();
  if (isBoard(note)) for (const element of note.board.elements) { if (!element.isDeleted) { const id = itemIdFromHref(element.link); if (id) ids.add(id); } }
  else if (note.content.includes("data-item-id")) {
    const dom = document.createElement("template"); dom.innerHTML = note.content;
    for (const link of dom.content.querySelectorAll("a[data-item-id]")) { const id = link.getAttribute("data-item-id"); if (validItemId(id)) ids.add(id); }
  }
  targets.set(note, ids); return ids;
}
export function backlinks(notes: Note[], id: string) { return notes.filter(note => note.id !== id && !isTemplate(note) && !note.deletedAt && linkedIds(note).has(id)); }
export function remapItemLinks(note: Note, ids: Map<string, string>): Note {
  if (isBoard(note)) {
    let changed = false;
    const elements = note.board.elements.map(element => { const id = itemIdFromHref(element.link), mapped = id && ids.get(id); if (!mapped) return element; changed = true; return { ...element, link: itemHref(mapped) }; });
    return changed ? { ...note, board: { ...note.board, elements } } : note;
  }
  if (!note.content.includes("data-item-id")) return note;
  const dom = document.createElement("template"); dom.innerHTML = note.content; let changed = false;
  for (const link of dom.content.querySelectorAll("a[data-item-id]")) { const mapped = ids.get(link.getAttribute("data-item-id") || ""); if (mapped) { link.setAttribute("data-item-id", mapped); link.setAttribute("href", itemHref(mapped)); changed = true; } }
  return changed ? { ...note, content: dom.innerHTML } : note;
}

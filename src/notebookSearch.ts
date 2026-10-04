import { isBoard, type Note } from "./types";
import { noteSummary } from "./noteSummary";
import { literalPattern } from "./textSearch";

export function notebookMatches(note: Note, query: string) {
  return !query.trim() || literalPattern(query.trim()).test(note.title) || literalPattern(query.trim()).test(noteSummary(note).text);
}
export function matchingExcerpt(text: string, query: string) {
  const match = query.trim() ? literalPattern(query.trim()).exec(text) : null;
  if (!match) return { before: text.slice(0, 100), match: "", after: text.length > 100 ? "…" : "" };
  const start = Math.max(0, match.index - 35), end = Math.min(text.length, match.index + match[0].length + 60);
  return { before: `${start ? "…" : ""}${text.slice(start, match.index)}`, match: match[0], after: `${text.slice(match.index + match[0].length, end)}${end < text.length ? "…" : ""}` };
}
export function matchingBoardElement(note: Note, query: string) {
  if (!isBoard(note) || !query.trim()) return undefined;
  return note.board.elements.find(element => !element.isDeleted && literalPattern(query.trim()).test(
    element.type === "text" ? element.text : element.type === "frame" ? element.name || "" : ""));
}

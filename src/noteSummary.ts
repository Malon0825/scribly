import { isBoard, plainText, type Note } from "./types";

const summaries = new WeakMap<Note, { text: string; search: string; words: number }>();
export function noteSummary(note: Note) {
  let summary = summaries.get(note);
  if (!summary) {
    const text = isBoard(note) ? note.board.elements.filter((e) => !e.isDeleted).map((e) => e.type === "text" ? e.text : e.type === "frame" ? e.name : "").filter(Boolean).join(" ") : plainText(note.content);
    summary = { text, search: `${note.title} ${text}`.toLowerCase(), words: text.trim().split(/\s+/).filter(Boolean).length };
    summaries.set(note, summary);
  }
  return summary;
}

import { isBoard, plainText, type Note } from "./types";
import { sourceFilesInHtml } from "./sourceFileData";

const summaries = new WeakMap<Note, { text: string; preview: string; search: string; words: number }>();
export function noteSummary(note: Note) {
  let summary = summaries.get(note);
  if (!summary) {
    const text = isBoard(note) ? note.board.elements.filter((e) => !e.isDeleted).map((e) => e.type === "text" ? e.text : e.type === "frame" ? e.name : "").filter(Boolean).join(" ") : [plainText(note.content), ...sourceFilesInHtml(note.content).map(source => source.name)].filter(Boolean).join(" ");
    let preview = text;
    if (!isBoard(note)) {
      const body = document.createElement("div");
      body.innerHTML = note.content;
      body.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(heading => heading.remove());
      preview = [plainText(body.innerHTML), ...sourceFilesInHtml(note.content).map(source => source.name)].filter(Boolean).join(" ");
    }
    summary = { text, preview, search: `${note.title} ${text}`.toLowerCase(), words: text.trim().split(/\s+/).filter(Boolean).length };
    summaries.set(note, summary);
  }
  return summary;
}

import type { Appearance } from "./appearance";
import type { BoardData } from "./boardData";
type ItemBase = {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  autoTitle?: { folderId: string | null; day: string; ordinal: number };
};
// Keep the ordered `notes` collection and HTML field readable by legacy drafts.
// Boards have an empty content field; all drawing data lives in a typed payload.
export type Note = ItemBase & (
  | { kind?: "note"; board?: never }
  | { kind: "board"; board: BoardData }
);
export type Board = Extract<Note, { kind: "board" }>;
export const isBoard = (item: Note | undefined | null): item is Board => item?.kind === "board";
export type Folder = { id: string; name: string; copyLastNote?: boolean };
export type Workspace = {
  schemaVersion?: 2 | 3;
  folders: Folder[];
  notes: Note[];
  theme: "light" | "dark" | "system";
  activeId: string;
  referenceId: string | null;
  appearance?: Appearance;
};
export type StoredWorkspace = {
  revision: number;
  document: Workspace | null;
  dataPath: string;
  attachments?: Record<string, number>;
};
export const plainText = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("p,h1,h2,h3,li,pre").forEach((el) => el.append(" "));
  return (div.textContent || "").replace(/\s+/g, " ").trim();
};
export const textExport = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  div
    .querySelectorAll("li")
    .forEach((li) =>
      li.prepend(
        li.dataset.type === "taskItem"
          ? li.dataset.checked === "true"
            ? "[x] "
            : "[ ] "
          : "• ",
      ),
    );
  div.querySelectorAll("p,h1,h2,h3,li,pre").forEach((el) => el.append("\n"));
  return div.textContent || "";
};

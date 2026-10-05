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
  deletedAt?: string;
  pinned?: boolean;
  template?: { titlePattern: string; resetChecklist: boolean };
  autoTitle?: { folderId: string | null; day: string; ordinal: number };
};
// Keep the ordered `notes` collection and HTML field readable by legacy drafts.
// Boards have an empty content field; all drawing data lives in a typed payload.
export type Note = ItemBase & (
  | { kind?: "note" | "template"; board?: never }
  | { kind: "board"; board: BoardData }
);
export type Board = Extract<Note, { kind: "board" }>;
export const isBoard = (item: Note | undefined | null): item is Board => item?.kind === "board";
export const isTemplate = (item: Note | undefined | null) => item?.kind === "template";
export const isLiveItem = (item: Note) => !isTemplate(item) && !item.archived && !item.deletedAt;
export type Folder = { id: string; name: string; copyLastNote?: boolean; templateId?: string };
export type Workspace = {
  schemaVersion?: 2 | 3 | 4 | 5;
  folders: Folder[];
  notes: Note[];
  theme: "light" | "dark" | "system" | "notebook";
  activeId: string;
  referenceId: string | null;
  recentIds?: string[];
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
  div.querySelectorAll("a[data-item-id]").forEach(link => link.append(` (Scribly item: ${link.getAttribute("data-item-id")})`));
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

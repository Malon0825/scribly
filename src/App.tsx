import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Dialog } from "./Dialog";
import { IconContext, SidebarSimple, FileText, BookOpen, X, Check, UploadSimple, Trash, Minus, Square, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { NoteEditor } from "./NoteEditor";
import { SettingsContent, type SettingsSection } from "./SettingsContent";
import { AppSelect } from "./AppSelect";
import { ActionPopover } from "./ActionPopover";
import { AnimatedIcon } from "./AnimatedIcon";
import { normalizeAppearance, elementSizes, noteFonts } from "./appearance";
import { useWorkspace } from "./useWorkspace";
import { useAppIcon } from "./useAppIcon";
import { useSidebarDrag } from "./useSidebarDrag";
import { PanelResize } from "./PanelResize";
import { defaultNoteTitle, noteTitleFact } from "./noteNaming";
import { newNoteContent } from "./newNoteContent";
import { noteSummary } from "./noteSummary";
import { readNotebookView, orderNotes, matchesNote, searchSnippet, notePreview, type NotebookView } from './notebookNavigation';
import { readBackup, recordBackup, backupStatus, type BackupRecord } from './backupHistory';
import { mergeBackup } from "./importBackup";
import { parseImportFile, importAccept, MAX_IMPORT_FILES, MAX_IMPORT_FILE_SIZE } from "./importFiles";
import { portableBackup } from "./attachments";
import { workspaceBytes } from "./workspaceSize";
import { useFileDrop } from "./useFileDrop";
import { desktop, downloadFile } from "./storage";
import { isBoard, textExport, type Note, type Workspace } from "./types";
import { emptyBoard, portableBoard, validateBoard, type BoardData } from "./boardData";
import { BoardBoundary } from "./BoardBoundary";
const BoardEditor = lazy(() => import("./BoardEditor"));
const CreateBoardDialog = lazy(() => import("./CreateBoardDialog"));
const BoardPreview = lazy(() => import("./BoardPreview"));

type Modal =
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "shortcuts" }
  | { kind: "folder"; id?: string }
  | { kind: "delete"; id: string }
  | { kind: "removeFolder"; id: string }
  | { kind: "importResults"; imported: number; failures: string[] }
  | null;
function ShortcutList() {
  return <div className="shortcut-list">
    {[
      ['New note', 'Ctrl N'], ['New board', 'Ctrl Shift N'], ['Search notes & boards', 'Ctrl K'],
      ['Toggle Reference', 'Ctrl Shift R'], ['Show item as reference', 'Alt click'],
      ['Focus mode', 'Ctrl Shift F'], ['Save now', 'Ctrl S'], ['Keyboard shortcuts', 'Ctrl /'],
      ['Bold / Italic', 'Ctrl B / I'], ['Undo / Redo', 'Ctrl Z / Ctrl Shift Z'],
      ['Reorder folders or notes', 'Alt ↑ / ↓'], ['Move note to folder', 'Alt Shift ↑ / ↓'],
      ['Exit drawing / dismiss menu', 'Esc'],
    ].map(([label, keys]) => <span key={label}>{label}<kbd>{keys}</kbd></span>)}
  </div>;
}
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const safeFilename = (s: string) =>
  s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "Untitled";

export default function App() {
  const { workspace, update: mutate, status, error, dataPath, flush, reload, checkpoint, registerBoardDraft, boardChanged } =
    useWorkspace();
  const [sidebar, setSidebar] = useState(true),
    [reference, setReference] = useState(false),
    [focus, setFocus] = useState(false);
  const [focusTools, setFocusTools] = useState(false);
  const [boardControlsHost, setBoardControlsHost] = useState<HTMLDivElement | null>(null);
  const [notebookView, setNotebookView] = useState(readNotebookView);
  const [backup, setBackup] = useState<BackupRecord | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupInFlight = useRef(false);
  const [chromeMenu, setChromeMenu] = useState<'theme' | 'export' | null>(null);
  const themeAnchor = useRef<HTMLButtonElement>(null), exportAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => { setBackup(readBackup(dataPath)); }, [dataPath]);
  function changeNotebookView(next: Partial<NotebookView>) {
    const value = { ...notebookView, ...next };
    setNotebookView(value);
    try { localStorage.setItem('scribly-notebook-view', JSON.stringify(value)); } catch { /* Session preferences remain usable. */ }
  }
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["work", "data"]),
  );
  const [query, setQuery] = useState(""),
    [view, setView] = useState<"notes" | "unfiled" | "archive">("notes");
  const [modal, setModal] = useState<Modal>(null),
    [folderName, setFolderName] = useState("");
  const [menu, setMenu] = useState(false),
    [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const actionAnchor = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState(""),
    [closing, setClosing] = useState(false);
  const [sidebarAnnouncement, setSidebarAnnouncement] = useState("");
  const [importing, setImporting] = useState(false);
  const [importLabel, setImportLabel] = useState("Importing files…");
  const [boardCreation, setBoardCreation] = useState<"import" | "template" | null>(null);
  const importBusy = useRef(false);
  const importDestination = useRef<string | null>(null);
  const sidebarDrag = useSidebarDrag({
    workspace,
    update,
    reveal: (folderId) => {
      if (folderId) setExpanded((s) => new Set([...s, folderId]));
      setView(folderId === null ? "unfiled" : "notes");
      setQuery("");
    },
    announce: setSidebarAnnouncement,
    begin: () => {
      setFolderMenu(null);
      setNoteMenuId(null);
      setMenu(false);
      setSidebarAnnouncement("");
    },
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark =
    workspace?.theme === "dark" ||
    ((workspace?.theme || "system") === "system" && systemDark);
  const appearance = normalizeAppearance(workspace?.appearance);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--element-scale", String(elementSizes.find((size) => size.value === appearance.elementSize)!.scale));
    root.style.setProperty("--text-scale", String(appearance.textScale / 100));
    root.style.setProperty("--note-font", noteFonts.find((font) => font.id === appearance.font)!.family);
    root.style.setProperty("--note-weight", appearance.font === "roboto-light" ? "300" : "400");
    root.dataset.elementSize = appearance.elementSize;
  }, [appearance.elementSize, appearance.textScale, appearance.font]);
  const searchRef = useRef<HTMLInputElement>(null),
    importRef = useRef<HTMLInputElement>(null),
    titleRef = useRef<HTMLTextAreaElement>(null);
  const append = useRef<(html: string) => void>(() => {}),
    toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = workspace?.notes.find((n) => n.id === workspace.activeId);
  const insertImages = useRef<(files: File[], point?: { left: number; top: number }) => void>(() => {});
  const fileDrop = useFileDrop(view === "archive" ? null : active?.folderId || null,
    (files, folder) => { void importFiles(files, folder); },
    active && !isBoard(active) ? (files, point) => insertImages.current(files, point) : undefined);
  const referenceNote = workspace?.notes.find(
    (n) => n.id === workspace.referenceId && !n.archived,
  );
  const titleFact = noteTitleFact(active);
  const newNoteFocus = useRef<string | null>(null);
  const noteRef = useRef(active);
  noteRef.current = active;
  const wRef = useRef(workspace);
  wRef.current = workspace;
  const initialViewSet = useRef(false);
  useEffect(() => {
    if (workspace && !initialViewSet.current) {
      initialViewSet.current = true;
      if (active?.archived) setView("archive");
      if (active?.folderId) setExpanded(s => new Set([...s, active.folderId!]));
    }
  }, [workspace, active?.archived]);
  useEffect(() => {
    if (active && newNoteFocus.current === active.id) {
      newNoteFocus.current = null;
      const frame = requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.document-editor [contenteditable="true"]')?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (active?.title === "Untitled") titleRef.current?.select();
  }, [active?.id]);
  useLayoutEffect(() => {
    const title = titleRef.current;
    const container = title?.parentElement;
    if (!title || !container) return;
    const resize = () => {
      if (!title.getClientRects().length) return;
      title.style.height = "auto";
      title.style.height = `${title.scrollHeight}px`;
    };
    resize();
    let gone = false;
    void document.fonts.ready.then(() => { if (!gone) resize(); });
    let width = container.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - width) < 0.5) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(container);
    return () => { gone = true; observer.disconnect(); };
  }, [active?.id, active?.title, appearance.elementSize, appearance.textScale, appearance.font]);
  function notify(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }
  function chooseImport(folder: string | null) {
    importDestination.current = folder;
    setFolderMenu(null);
    setNoteMenuId(null);
    setMenu(false);
    importRef.current?.click();
  }
  function preserveDocumentFocus(event: MouseEvent<HTMLButtonElement>) {
    if (event.button === 0 && document.activeElement?.closest(".document-panel")) event.preventDefault();
  }
  function moveFocusFromPanels(selector: string, destination: string) {
    if (document.activeElement?.closest(selector)) document.querySelector<HTMLElement>(destination)?.focus({ preventScroll: true });
  }
  function toggleFocus() {
    moveFocusFromPanels('.sidebar, .reference-panel, .panel-resize, .brand, .theme-toggle, button[aria-label="Reference"], .document-head, .board-top-controls, .editor-toolbar, .weekly-bar, .export-shortcut, .focus-tools-toggle, .excalidraw .layer-ui__wrapper__top-right, .excalidraw .sidebar', 'button[aria-label="Focus"]');
    setMenu(false); setFolderMenu(null); setNoteMenuId(null);
    setFocusTools(false);
    setFocus((value) => !value);
  }
  function update(updater: (w: Workspace) => Workspace) {
    try { mutate(updater); return true; }
    catch (e) { notify(`Change could not be applied: ${String(e)}`); return false; }
  }
  async function windowAction(action: () => Promise<unknown>) {
    try { await action(); }
    catch (e) { notify(`Window command failed: ${String(e)}`); }
  }
  async function importFiles(files: File[], folder: string | null) {
    if (!files.length) return;
    if (importBusy.current) { notify("An import is already in progress. Please wait."); return; }
    importBusy.current = true;
    setImporting(true);
    setFolderMenu(null); setNoteMenuId(null); setMenu(false); setModal(null);
    const failures: string[] = [];
    let imported = 0;
    let firstId: string | null = null;
    try {
      for (const [index, file] of files.entries()) {
        if (index >= MAX_IMPORT_FILES) { failures.push(`${file.name}: Import up to 25 files at a time.`); continue; }
        setImportLabel(`Importing ${file.name} (${index + 1}/${Math.min(files.length, MAX_IMPORT_FILES)})…`);
        try {
          const parsed = await parseImportFile(file);
          let added = 0;
          let nextId: string | null = null;
          mutate((w) => {
            let next: Workspace;
            if (parsed.kind === "backup") {
              next = mergeBackup(w, parsed.backup);
              nextId = next.notes.slice(w.notes.length).find((n) => !n.archived)?.id || null;
              added = parsed.backup.notes.length;
              next = { ...next, activeId: w.activeId };
            } else {
              if (folder && !w.folders.some((f) => f.id === folder)) throw Error("The destination folder was removed. Choose a folder again.");
              const time = new Date().toISOString();
              nextId = crypto.randomUUID();
              const item = { id: nextId, title: parsed.title, content: parsed.kind === "board" ? "" : parsed.content,
                folderId: folder, createdAt: time, updatedAt: time, archived: false,
                ...(parsed.kind === "board" ? { kind: "board" as const, board: parsed.board } : {}) } as Note;
              next = { ...w, ...(parsed.kind === "board" ? { schemaVersion: w.schemaVersion || 2 as const } : {}), notes: [...w.notes, item] };
              added = 1;
            }
            if (workspaceBytes(next) > MAX_IMPORT_FILE_SIZE)
              throw Error("This import would exceed the notebook's 20 MB save limit. Export or remove large notes first.");
            return next;
          });
          imported += added;
          firstId ||= nextId;
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (firstId) {
        const selection: { note?: Note } = {};
        mutate((w) => {
          selection.note = w.notes.find((n) => n.id === firstId && !n.archived);
          if (!selection.note) return w;
          newNoteFocus.current = selection.note.id;
          return { ...w, activeId: selection.note.id };
        });
        const note = selection.note;
        if (note) {
          setView(note.folderId ? "notes" : "unfiled");
          setQuery("");
          if (note.folderId) setExpanded((s) => new Set([...s, note.folderId!]));
        }
      }
      if (failures.length) setModal({ kind: "importResults", imported, failures });
      else notify(`${imported} ${imported === 1 ? "note" : "notes"} imported.`);
    } catch (e) {
      setModal({ kind: "importResults", imported, failures: [...failures, String(e)] });
    } finally { importBusy.current = false; setImporting(false); }
  }
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const closeMenu = () => {
      setFolderMenu(null);
      setNoteMenuId(null);
    };
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemDark(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useAppIcon(dark);
  useEffect(() => {
    if (!desktop) return;
    const currentWindow = getCurrentWindow();
    let dispose: (() => void) | undefined;
    let gone = false;
    const syncWindowShape = async () => {
      const maximized = await currentWindow.isMaximized();
      if (!gone) {
        document.documentElement.dataset.window = maximized
          ? "maximized"
          : "windowed";
      }
    };
    void windowAction(syncWindowShape);
    void currentWindow
      .onResized(() => void windowAction(syncWindowShape))
      .then((unlisten) => {
        if (gone) unlisten();
        else dispose = unlisten;
      }).catch((e) => { if (!gone) notify(`Window updates unavailable: ${String(e)}`); });
    return () => {
      gone = true;
      dispose?.();
    };
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let gone = false;
    getCurrentWindow()
      .onCloseRequested(async (e) => {
        e.preventDefault();
        try {
          await flush();
          await getCurrentWindow().destroy();
        } catch {
          notify(
            "Save failed. Export a backup or retry saving before closing.",
          );
        }
      })
      .then((unlisten) => {
        if (gone) unlisten();
        else dispose = unlisten;
      }).catch((e) => { if (!gone) notify(`Close protection unavailable. Save or export before closing: ${String(e)}`); });
    return () => {
      gone = true;
      dispose?.();
    };
  }, [flush]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest?.('[role="dialog"], .select-popup')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (e.shiftKey) createBoard(noteRef.current?.folderId ?? null);
        else createNote(noteRef.current?.folderId ?? null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSidebar(true);
        setFocus(false);
        setTimeout(() => searchRef.current?.focus(), 30);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush().catch(() => {});
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault(); toggleReference();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault(); setModal({ kind: 'shortcuts' });
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        toggleFocus();
      }
      if (e.key === "Escape") {
        setMenu(false);
        setFolderMenu(null);
        setNoteMenuId(null);
        moveFocusFromPanels('.focus-tools-toggle', 'button[aria-label="Focus"]');
        setFocusTools(false); setFocus(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [update, flush]);
  function createNote(
    folderId: string | null,
    title?: string,
    content?: string,
  ) {
    const created = new Date();
    const now = created.toISOString();
    const id = crypto.randomUUID();
    newNoteFocus.current = id;
    if (!update((w) => {
      const naming = title === undefined ? defaultNoteTitle(w, folderId, created) : { title };
      const note: Note = {
        id, folderId, ...naming,
        content: content ?? (title === undefined ? newNoteContent(w, folderId) : "<p></p>"),
        createdAt: now, updatedAt: now, archived: false,
      };
      return { ...w, notes: [...w.notes, note], activeId: id };
    })) return;
    setView("notes");
    setQuery("");
    if (notebookView.filter === 'boards') changeNotebookView({ filter: 'all' });
    if (folderId) setExpanded((s) => new Set([...s, folderId]));
  }
  function patchNote(id: string, patch: Partial<Note>) {
    return update((w) => ({
      ...w,
      notes: w.notes.map((n) =>
        n.id === id
          ? { ...n, ...patch, updatedAt: new Date().toISOString() } as Note
          : n,
      ),
    }));
  }
  function createBoard(folderId: string | null, title?: string, board = emptyBoard(), strict = false) {
    validateBoard(board);
    const created = new Date();
    const now = created.toISOString(), id = crypto.randomUUID();
    if (!update((w) => {
      const naming = title === undefined ? defaultNoteTitle(w, folderId, created) : { title };
      return { ...w, schemaVersion: w.schemaVersion || 2, notes: [...w.notes, { id, folderId, kind: "board", board, ...naming, content: "", createdAt: now, updatedAt: now, archived: false }], activeId: id };
    })) {
      if (strict) throw Error("The board could not be added. Resolve the notebook save error before creating it.");
      return;
    }
    setView("notes"); setQuery(""); setFolderMenu(null); setMenu(false); setNoteMenuId(null);
    if (notebookView.filter === 'notes') changeNotebookView({ filter: 'all' });
    if (folderId) setExpanded((s) => new Set([...s, folderId]));
  }
  function duplicateItem(item: Note) {
    if (!isBoard(item)) { createNote(item.folderId, `${item.title} (copy)`, item.content); return; }
    let current: Note = item;
    try { current = checkpoint()?.notes.find((n) => n.id === item.id) || item; }
    catch (e) { notify(`Board could not be duplicated: ${String(e)}`); return; }
    if (!isBoard(current)) return;
    const copy: Note = { ...current, id: crypto.randomUUID(), title: `${current.title} (copy)`, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), board: JSON.parse(JSON.stringify(current.board)) };
    update((w) => ({ ...w, notes: [...w.notes, copy], activeId: copy.id }));
  }
  function selectNote(n: Note) {
    if (!update((w) => ({ ...w, activeId: n.id }))) return;
    if (n.folderId) setExpanded((s) => new Set([...s, n.folderId!]));
    setView(n.archived ? "archive" : "notes");
    if (!matchesNote(n, '', notebookView.filter)) changeNotebookView({ filter: 'all' });
    setMenu(false);
    setNoteMenuId(null);
  }
  function toggleReference() {
    moveFocusFromPanels('.reference-panel', 'button[aria-label="Reference"]');
    setReference(value => !value); setFocus(false);
  }
  function showReference(note: Note) {
    if (!update(w => ({ ...w, referenceId: note.id }))) return;
    setReference(true); setFocus(false); setNoteMenuId(null);
  }
  async function exportData(name: string, content: string | (() => string | Promise<string>), type: string): Promise<boolean> {
    try {
      const data = typeof content === "function" ? await content() : content;
      if (desktop) {
        const path = await invoke<string | null>("export_file", {
          fileName: name,
          data,
        });
        if (!path) return false;
        notify("Export saved.");
      } else {
        downloadFile(name, data, type);
        notify("Export downloaded.");
      }
      return true;
    } catch (e) {
      notify(`Export failed: ${String(e)}`);
      return false;
    }
  }
  async function exportBackup() {
    if (backupInFlight.current) return;
    backupInFlight.current = true; setBackupBusy(true);
    try {
      const exported = await exportData(`Scribly-backup-${new Date().toISOString().slice(0, 10)}.json`,
        () => portableBackup(checkpoint() || workspace!), 'application/json');
      if (exported) {
        const record = { at: Date.now(), downloaded: !desktop };
        setBackup(record);
        try { recordBackup(dataPath, record); }
        catch { notify('Backup exported, but its date could not be recorded.'); }
      }
    } finally { backupInFlight.current = false; setBackupBusy(false); }
  }
  function archiveNote(note: Note) {
    if (!update((w) => {
      const remaining = w.notes.filter((n) =>
        n.id !== note.id && !n.archived && matches(n) &&
        (view !== "unfiled" || n.folderId === null),
      );
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === note.id
            ? {
                ...n,
                archived: !note.archived,
                updatedAt: new Date().toISOString(),
              }
            : n,
        ),
        activeId: note.archived ? note.id : w.activeId !== note.id ? w.activeId :
          remaining.find((n) => n.folderId === note.folderId)?.id || remaining[0]?.id || "",
        referenceId:
          !note.archived && w.referenceId === note.id ? null : w.referenceId,
      };
    })) return;
    if (note.archived) {
      setView(note.folderId ? "notes" : "unfiled");
      setQuery("");
      if (note.folderId) setExpanded((s) => new Set([...s, note.folderId!]));
    }
    setMenu(false);
    setNoteMenuId(null);
    notify(
      note.archived
        ? `${isBoard(note) ? "Board" : "Note"} restored.`
        : `${isBoard(note) ? "Board" : "Note"} archived. You can restore it from Archive.`,
    );
  }
  function openArchive() {
    if (!update((w) => ({ ...w, activeId: w.notes.find((n) => n.archived)?.id || "" }))) return;
    setView("archive");
    setQuery("");
    setMenu(false);
    setNoteMenuId(null);
  }
  function confirmDelete(note: Note) {
    setModal({ kind: "delete", id: note.id });
    setMenu(false);
    setNoteMenuId(null);
  }
  function toggleFolder(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function editFolder(id?: string) {
    setFolderName(workspace?.folders.find((f) => f.id === id)?.name || "");
    setModal({ kind: "folder", id });
    setFolderMenu(null);
  }
  function submitFolder() {
    const name = folderName.trim();
    if (!name) return;
    const id = modal?.kind === "folder" ? modal.id : undefined;
    if (id) {
      if (!update((w) => ({
        ...w,
        folders: w.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      }))) return;
    } else {
      const next = crypto.randomUUID();
      if (!update((w) => ({ ...w, folders: [...w.folders, { id: next, name }] }))) return;
      setExpanded((s) => new Set([...s, next]));
    }
    setModal(null);
  }
  function weeklyUpdate() {
    if (!active || !workspace || isBoard(active)) return;
    const doc = document.createElement("div");
    doc.innerHTML = active.content;
    const items = Array.from(doc.querySelectorAll('li[data-checked="true"]'))
      .map((el) => el.textContent?.trim() || "")
      .filter(Boolean);
    const weekly = workspace.notes.find(
      (n) => n.title.toLowerCase() === "weekly update" && !n.archived && !isBoard(n),
    );
    const unique = items.filter(
      (item) => !weekly || !noteSummary(weekly).text.includes(item),
    );
    if (!unique.length) {
      notify("These completed items are already in the weekly update.");
      return;
    }
    const content = `<h3>${escapeHtml(active.title)}</h3><ul>${unique.map((i) => `<li><p>${escapeHtml(i)}</p></li>`).join("")}</ul>`;
    if (weekly) {
      if (!patchNote(weekly.id, { content: weekly.content + content })) return;
      update((w) => ({ ...w, referenceId: weekly.id }));
      setReference(true);
      notify(`${unique.length} items added to Weekly update.`);
    } else {
      createNote(active.folderId, "Weekly update", content);
      notify("Weekly update created.");
    }
  }
  const checkedCount = active
    ? (active.content.match(/data-checked="true"/g) || []).length
    : 0;
  const matches = (n: Note) => matchesNote(n, query, notebookView.filter);
  const visible = (n: Note) => !n.archived && matches(n);
  const renderNote = (n: Note) => (
    <div
      className={`note-row ${active?.id === n.id ? "active" : ""}${sidebarDrag.dragging?.kind === "note" && sidebarDrag.dragging.id === n.id ? " dragging" : ""}${sidebarDrag.dropClass("note-order", n.id)}`}
      key={n.id}
      {...(!n.archived && sidebarDrag.dragging?.kind !== "folder" ? sidebarDrag.dropProps({ kind: "note-order", id: n.id, after: false }) : {})}
      onContextMenu={(e) => {
        e.preventDefault();
        actionAnchor.current = e.currentTarget.querySelector('.pin-note');
        setFolderMenu(null);
        setMenu(false);
        setNoteMenuId(n.id);
      }}
    >
      <button
        className="note-select"
        {...sidebarDrag.dragProps({ kind: "note", id: n.id }, !n.archived && notebookView.sort === 'manual' && notebookView.filter === 'all')}
        title={`${n.title || 'Untitled'}${!n.archived ? ' · Alt+click to show as reference. Use manual order with All items to drag or reorder.' : ''}`}
        aria-current={active?.id === n.id ? "page" : undefined}
        aria-label={n.title || 'Untitled'}
        onMouseDown={event => { if (event.altKey) preserveDocumentFocus(event); }}
        onClick={(event) => event.altKey && !n.archived ? showReference(n) : selectNote(n)}
      >
        {isBoard(n) ? <AnimatedIcon kind="board" size={26} /> : <AnimatedIcon kind="note" size={26} />}
        <span>
          <span className="note-name">{n.title || "Untitled"}</span>
          {(query.trim() || notebookView.density === 'comfortable') && (
            <span className="note-preview">
              {(query.trim() ? searchSnippet(n, query) : notePreview(n)) || (isBoard(n) ? 'Board' : 'Start writing…')}
            </span>
          )}
        </span>
      </button>
      {!n.archived && <button className="reference-note" aria-label={`Show ${n.title || 'Untitled'} as reference`}
        title="Show as reference (Alt+click the item)" onMouseDown={preserveDocumentFocus} onClick={() => showReference(n)}>
        <AnimatedIcon kind="reference" size={18} />
      </button>}
      <button
        className="pin-note"
        aria-label={`Actions for ${n.title || "Untitled"}`}
        aria-expanded={noteMenuId === n.id}
        aria-haspopup="dialog"
        title="Note actions"
        onClick={(e) => {
          e.stopPropagation();
          actionAnchor.current = e.currentTarget;
          setFolderMenu(null);
          setMenu(false);
          setNoteMenuId(noteMenuId === n.id ? null : n.id);
        }}
      >
        <AnimatedIcon kind="options" size={20} />
      </button>
      {noteMenuId === n.id && (
        <ActionPopover anchor={actionAnchor.current} label="Note actions" className="sidebar-note-dropdown" onClose={() => setNoteMenuId(null)}>
          <button onClick={() => archiveNote(n)}>
            {n.archived ? (
              <AnimatedIcon kind="undo" size={18} />
            ) : (
              <AnimatedIcon kind="archive" size={18} />
            )}
            {n.archived ? `Restore ${isBoard(n) ? "board" : "note"}` : `Archive ${isBoard(n) ? "board" : "note"}`}
          </button>
          {!n.archived && (
            <button
              onClick={() => showReference(n)}
            >
              <AnimatedIcon kind="reference" size={18} />
              Show as reference
            </button>
          )}
          <button className="danger-text" onClick={() => confirmDelete(n)}>
            <Trash size={18} />
            Delete permanently
          </button>
        </ActionPopover>
      )}
    </div>
  );
  const count = (id: string | null) =>
    workspace?.notes.filter((n) => n.folderId === id && !n.archived).length ||
    0;
  if (!workspace)
    return (
      <div className="startup">
        <SidebarSimple size={45} />
        <h1>Scribly</h1>
        {status === "loading" ? (
          <>
            <SpinnerGap className="spin" size={24} />
            <p>Opening your notebook…</p>
            <span>Preparing your local database on first launch.</span>
          </>
        ) : (
          <>
            <WarningCircle size={28} />
            <p>Your notebook couldn’t open.</p>
            <pre>{error}</pre>
            <button className="primary" onClick={() => void reload()}>
              Try again
            </button>
          </>
        )}
      </div>
    );

  const saveControl = (<button
                    className={`save-state ${status === "error" ? "error" : status === "saving" ? "saving" : ""}`}
                    aria-label={status === "error" ? "Save failed. Retry saving" : status === "saving" ? "Saving…" : desktop ? "Saved locally. Save now" : "Saved in browser. Save now"}
                    onClick={() => void flush().catch(() => {})}
                    title={
                      status === "error"
                        ? "Click to retry saving"
                        : desktop
                          ? "Saved in the local PostgreSQL database"
                          : "Browser preview uses local storage"
                    }
                  >
                    {status === "saving" ? (
                      <SpinnerGap className="spin" size={15} />
                    ) : status === "error" ? (
                      <WarningCircle size={17} />
                    ) : (
                      <span className="status-dot" />
                    )}
                    <span>
                      {status === "saving"
                        ? "Saving…"
                        : status === "error"
                          ? "Save failed · Retry"
                          : desktop
                            ? "Saved locally"
                            : "Saved in browser"}
                    </span>
                  </button>);
  const backupDue = !backup || Date.now() - backup.at >= 7 * 86400000;

  return (
    <IconContext.Provider value={{ weight: "regular" }}>
      <div className={`app ${isBoard(active) ? 'board-mode' : ''} ${focus ? "focus-mode" : ""} ${focus && focusTools ? "focus-tools-visible" : ""}`} {...fileDrop.props}>
        <header className="topbar">
          <div className="brand">
            <button
              className="icon-button"
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
              aria-pressed={sidebar && !focus}
              onMouseDown={preserveDocumentFocus}
              onClick={() => {
                moveFocusFromPanels(".sidebar", 'button[aria-label="Toggle sidebar"]');
                setSidebar((s) => !s);
                setFocus(false);
              }}
            >
              <AnimatedIcon kind="sidebar" size={24} />
            </button>
            <span className="brand-divider" />
            <span className="brand-wordmark" role="img" aria-label="Scribly" />
          </div>
          <div
            className="breadcrumb"
            onMouseDown={(e) => {
              if (desktop && e.button === 0)
                void windowAction(() => getCurrentWindow().startDragging());
            }}
            onDoubleClick={() => {
              if (desktop) void windowAction(() => getCurrentWindow().toggleMaximize());
            }}
          >
            <span>
              {workspace.folders.find((f) => f.id === active?.folderId)?.name ||
                "Unfiled"}
            </span>
            <span className="slash">/</span>
            <span>{active?.title || "Your notebook"}</span>
          </div>
          <div className="board-command-host" ref={setBoardControlsHost} />
          {isBoard(active) && saveControl}
          <div className="top-actions">
            {focus && !isBoard(active) && <button className={`pill focus-tools-toggle ${focusTools ? 'selected' : ''}`} aria-pressed={focusTools} aria-expanded={focusTools} aria-controls={isBoard(active) ? 'board-secondary-controls' : 'note-formatting-controls'} onMouseDown={preserveDocumentFocus}
              onClick={() => {
                if (focusTools) moveFocusFromPanels('.board-top-controls, .editor-toolbar, .excalidraw .layer-ui__wrapper__top-right, .excalidraw .sidebar', '.focus-tools-toggle');
                setFocusTools(value => !value);
              }}><AnimatedIcon kind="tools" size={21} /><span>{isBoard(active) ? 'Board actions' : 'Formatting'}</span></button>}
            <button
              className={`pill ${reference && !focus ? "selected" : ""}`}
              aria-label="Reference"
              title="Reference (Ctrl+Shift+R)"
              aria-pressed={reference && !focus}
              onMouseDown={preserveDocumentFocus}
              onClick={toggleReference}
            >
              <AnimatedIcon kind="reference" size={21} />
              <span>Reference</span>
            </button>
            <button
              className={`pill ${focus ? "selected" : ""}`}
              aria-label="Focus"
              aria-pressed={focus}
              onMouseDown={preserveDocumentFocus}
              onClick={toggleFocus}
              title="Focus (Ctrl+Shift+F)"
            >
              <AnimatedIcon kind="focus" size={21} />
              <span>{focus ? "Exit focus" : "Focus"}</span>
            </button>
            <button
              ref={themeAnchor} className="icon-button theme-toggle"
              aria-label="Appearance" aria-haspopup="dialog" aria-expanded={chromeMenu === 'theme'}
              title={`Appearance: ${workspace.theme}`}
              onClick={() => setChromeMenu(value => value === 'theme' ? null : 'theme')}
            >
              <AnimatedIcon kind={workspace.theme === 'system' ? 'system' : dark ? 'moon' : 'sun'} size={21} />
            </button>
            {chromeMenu === 'theme' && <ActionPopover anchor={themeAnchor.current} label="Appearance" className="theme-dropdown" onClose={() => setChromeMenu(null)}>
              {(['light', 'dark', 'system'] as const).map(theme => <button key={theme} aria-pressed={workspace.theme === theme}
                onClick={() => { update(w => ({ ...w, theme })); setChromeMenu(null); }}>
                <AnimatedIcon kind={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'system'} size={18} />
                {theme[0].toUpperCase() + theme.slice(1)}{workspace.theme === theme && <Check size={16} />}
              </button>)}
            </ActionPopover>}
            {desktop && (
              <div className="window-controls">
                <button
                  aria-label="Minimize window"
                  onClick={() => void windowAction(() => getCurrentWindow().minimize())}
                >
                  <Minus size={17} />
                </button>
                <button
                  aria-label="Maximize window"
                  onClick={() => void windowAction(() => getCurrentWindow().toggleMaximize())}
                >
                  <Square size={14} />
                </button>
                <button
                  className="window-close"
                  aria-label="Close window"
                  disabled={closing}
                  onClick={async () => {
                    setClosing(true);
                    try {
                      await flush();
                      await getCurrentWindow().close();
                    } catch {
                      notify("Save failed. Retry saving before closing.");
                    } finally {
                      setClosing(false);
                    }
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            )}
          </div>
        </header>
        <div
          className={`workspace ${sidebar && !focus ? "with-sidebar" : ""} ${reference && !focus ? "with-reference" : ""}`}
        >
          {(fileDrop.target || importing) && (
            <div className="file-drop-hint" role="status" aria-live="polite">
              <UploadSimple size={22} />
              <span>{importing ? importLabel : fileDrop.target?.note ? "Drop images into this note" : `Drop files into ${workspace.folders.find((f) => f.id === fileDrop.target?.folder)?.name || "Unfiled notes"}`}
                <small>Images up to 5 MB · PDF, Word, text &amp; code up to 20 MB</small>
              </span>
            </div>
          )}
          <aside
            id="notes-sidebar"
            className={`sidebar panel density-${notebookView.density}`}
            aria-label="Notes navigation"
            inert={!sidebar || focus}
          >
            <div className="sidebar-create" role="group" aria-label="Create in current folder">
              <button
                className="primary new-note"
                title="New note (Ctrl+N)"
                onClick={() => createNote(active?.folderId ?? null)}
              >
                <AnimatedIcon kind="add" size={24} />
                <span>New note</span>
              </button>
              <button className="new-board" title="New board (Ctrl+Shift+N)" onClick={() => createBoard(active?.folderId ?? null)}><AnimatedIcon kind="board" size={24} /><span>New board</span></button>
            </div>
            <div className="search" data-icon-owner>
              <AnimatedIcon kind="search" size={22} />
              <input
                ref={searchRef}
                aria-label="Search notes"
                placeholder="Search notes & boards"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
              {query ? (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <AnimatedIcon kind="close" size={16} />
                </button>
              ) : (
                <kbd>Ctrl K</kbd>
              )}
            </div>
            <div className="notebook-controls">
              <AppSelect label="Filter items" value={notebookView.filter} onChange={filter => changeNotebookView({ filter: filter as NotebookView['filter'] })}
                options={[{ value: 'all', label: 'All items' }, { value: 'notes', label: 'Notes' }, { value: 'boards', label: 'Boards' }]} />
              <div className="sort-control"><span>Sort:</span><AppSelect label="Sort items" value={notebookView.sort} onChange={sort => changeNotebookView({ sort: sort as NotebookView['sort'] })}
                options={[{ value: 'manual', label: 'Manual' }, { value: 'updated', label: 'Modified' }, { value: 'title', label: 'A–Z' }]} /></div>
              <button aria-label="Compact note rows" aria-pressed={notebookView.density === 'compact'} title={notebookView.density === 'compact' ? 'Compact rows · switch to comfortable rows' : 'Comfortable rows · switch to compact rows'}
                onClick={() => changeNotebookView({ density: notebookView.density === 'compact' ? 'comfortable' : 'compact' })}>
                <AnimatedIcon kind="list" size={18} /><span>{notebookView.density === 'compact' ? 'Compact' : 'Roomy'}</span>
              </button>
            </div>
            {(notebookView.sort !== 'manual' || notebookView.filter !== 'all') && <p className="navigation-hint">Use All items and Manual order to reorder notes.</p>}
            <p id="sidebar-drag-help" className="sr-only">
              Drag folders to reorder. Drag notes between notes or onto a folder to move them.
              Use Alt plus Up or Down to reorder; on notes, Alt plus Shift plus Up or Down changes folder.
            </p>
            <div className="sr-only" role="status" aria-live="polite">{sidebarAnnouncement}</div>
            <div className="sidebar-scroll"
              onDragOverCapture={sidebarDrag.scrollOnDrag}
              onDragLeave={sidebarDrag.leaveScroll}
            >
              <div className="section-label">
                <span>
                  {view === "archive"
                    ? "Archived items"
                    : query
                      ? "Search results"
                      : "Folders"}
                </span>
                {view !== "archive" && (
                  <button
                    className="icon-button"
                    aria-label="New folder"
                    onClick={() => editFolder()}
                  >
                    <AnimatedIcon kind="folderAdd" size={25} />
                  </button>
                )}
              </div>
              {view === "archive" ? (
                <div className="loose-notes">
                  {orderNotes(workspace.notes
                    .filter((n) => n.archived && matches(n))
                    , notebookView.sort)
                    .map(renderNote)}
                  {!workspace.notes.some((n) => n.archived && matches(n)) && (
                    <p className="empty-search">
                      {query
                        ? "No archived notes match your search."
                        : "No archived notes yet."}
                    </p>
                  )}
                </div>
              ) : query ? (
                <div className="search-results">
                  {orderNotes(workspace.notes.filter(visible), notebookView.sort).map(renderNote)}
                  {!workspace.notes.some(visible) && (
                    <p className="empty-search">No notes match “{query}”.</p>
                  )}
                </div>
              ) : (
                workspace.folders.map((folder) => (
                  <div
                    data-file-folder={folder.id}
                    className={`folder-group${sidebarDrag.dropClass("folder-order", folder.id)}${sidebarDrag.dropClass("folder", folder.id)}${!fileDrop.target?.note && fileDrop.target?.folder === folder.id ? " drop-folder" : ""}`}
                    key={folder.id}
                    {...sidebarDrag.dropProps(sidebarDrag.dragging?.kind === "note"
                      ? { kind: "folder", id: folder.id }
                      : { kind: "folder-order", id: folder.id, after: false })}
                  >
                    <div
                      className={`folder-row${sidebarDrag.dragging?.kind === "folder" && sidebarDrag.dragging.id === folder.id ? " dragging" : ""}`}
                    >
                      <button
                        className="folder-toggle"
                        {...sidebarDrag.dragProps({ kind: "folder", id: folder.id })}
                        title="Drag to reorder folders. Alt+↑/↓ to reorder."
                        aria-expanded={expanded.has(folder.id)}
                        onClick={() => {
                          toggleFolder(folder.id);
                          setView("notes");
                        }}
                      >
                        {expanded.has(folder.id) ? (
                          <AnimatedIcon kind="down" size={16} />
                        ) : (
                          <AnimatedIcon kind="right" size={16} />
                        )}
                        <AnimatedIcon kind="folder" size={27} />
                        <span>{folder.name}</span>
                      </button>
                      {count(folder.id) > 0 && <span className="folder-count">{count(folder.id)}</span>}
                      <button
                        className="icon-button small"
                        aria-label={`New note in ${folder.name}`}
                        onClick={() => createNote(folder.id)}
                      >
                        <AnimatedIcon kind="add" size={19} />
                      </button>
                      <div className="folder-menu-anchor">
                        <button
                          className="icon-button small"
                          aria-label={`Options for ${folder.name}`}
                          aria-expanded={folderMenu === folder.id}
                          aria-haspopup="dialog"
                          onClick={(e) => {
                            e.stopPropagation();
                            actionAnchor.current = e.currentTarget;
                            setNoteMenuId(null);
                            setMenu(false);
                            setFolderMenu(
                              folderMenu === folder.id ? null : folder.id,
                            );
                          }}
                        >
                          <AnimatedIcon kind="options" size={21} />
                        </button>
                        {folderMenu === folder.id && (
                          <ActionPopover anchor={actionAnchor.current} label="Folder options" className="folder-dropdown" onClose={() => setFolderMenu(null)}>
                            <button onClick={() => editFolder(folder.id)}>
                              Rename folder
                            </button>
                            <button onClick={() => createBoard(folder.id)}><AnimatedIcon kind="board" size={18} />New board</button>
                            <button disabled={importing} onClick={() => chooseImport(folder.id)}>
                              <AnimatedIcon kind="upload" size={18} />
                              Import files…
                            </button>
                            <button
                              className="folder-copy-option"
                              aria-pressed={!!folder.copyLastNote}
                              aria-label="Copy last note"
                              title="New notes copy the most recently created non-archived note in this folder, including formatting and checklist states."
                              onClick={() => {
                                update((w) => ({
                                  ...w,
                                  folders: w.folders.map((f) => f.id === folder.id
                                    ? { ...f, copyLastNote: !f.copyLastNote } : f),
                                }));
                                setFolderMenu(null);
                              }}
                            >
                              <span className="folder-copy-check" aria-hidden="true">
                                {folder.copyLastNote && <Check size={13} />}
                              </span>
                              <span>
                                <span>Copy last note</span>
                                <small>Start new notes with its content</small>
                              </span>
                            </button>
                            <button
                              className="danger-text"
                              onClick={() => {
                                setModal({
                                  kind: "removeFolder",
                                  id: folder.id,
                                });
                                setFolderMenu(null);
                              }}
                            >
                              Remove folder
                            </button>
                          </ActionPopover>
                        )}
                      </div>
                    </div>
                    {expanded.has(folder.id) && (
                      <div className="folder-notes">
                        {orderNotes(workspace.notes
                          .filter((n) => n.folderId === folder.id && visible(n))
                          , notebookView.sort)
                          .map(renderNote)}
                        {count(folder.id) === 0 && (
                          <button
                            className="empty-folder"
                            onClick={() => createNote(folder.id)}
                          >
                            Add your first note
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
              {view !== 'archive' && !query.trim() && notebookView.filter !== 'all' && !workspace.notes.some(visible) &&
                <p className="empty-search">No {notebookView.filter} yet. Choose All items to see your notebook.</p>}
              {view === "unfiled" && !query && (
                <div className="loose-notes">
                  {orderNotes(workspace.notes
                    .filter((n) => !n.folderId && visible(n))
                    , notebookView.sort)
                    .map(renderNote)}
                  {!count(null) && (
                    <p className="empty-search">All your notes have a home.</p>
                  )}
                </div>
              )}
            </div>
            <nav className="sidebar-bottom">
              <button
                data-file-folder=""
                className={`${view === "unfiled" ? "nav-active" : ""}${sidebarDrag.dropClass("folder", null)}${!fileDrop.target?.note && fileDrop.target?.folder === null ? " drop-folder" : ""}`}
                {...sidebarDrag.dropProps({ kind: "folder", id: null })}
                onClick={() => {
                  setView("unfiled");
                  setQuery("");
                  const n = workspace.notes.find(
                    (n) => !n.folderId && !n.archived,
                  );
                  if (n) update((w) => ({ ...w, activeId: n.id }));
                }}
              >
                <AnimatedIcon kind="note" size={26} />
                <span>Unfiled notes</span>
                {count(null) > 0 && <span className="nav-count">{count(null)}</span>}
              </button>
              <button
                className={view === "archive" ? "nav-active" : ""}
                onClick={openArchive}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openArchive();
                }}
              >
                <AnimatedIcon kind="archive" size={25} />
                <span>Archive</span>
                {workspace.notes.some((n) => n.archived) && (
                  <span className="nav-count">
                    {workspace.notes.filter((n) => n.archived).length}
                  </span>
                )}
              </button>
              <button onClick={() => setModal({ kind: "settings" })}>
                <AnimatedIcon kind="settings" size={26} />
                <span>Settings</span>
              </button>
            </nav>
          </aside>
          <PanelResize panel="sidebar" visible={sidebar && !focus} layoutKey={`${reference && !focus}-${appearance.elementSize}`} />
          <main className={`document-panel panel ${isBoard(active) ? "board-document" : ""}`}>
            {active ? (
              <>
                <div className="document-scroll">
                  <div className="document-head">
                    <div>
                      <textarea
                        ref={titleRef}
                        className="note-title"
                        aria-label={isBoard(active) ? "Board title" : "Note title"}
                        aria-describedby={titleFact ? "note-title-fact" : undefined}
                        placeholder="Untitled"
                        rows={1}
                        value={active.title}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                        }}
                        onChange={(e) =>
                          patchNote(active.id, { title: e.target.value.replace(/[\r\n]+/g, " ") })
                        }
                      />
                      {titleFact && (
                        <p className="note-title-fact" id="note-title-fact">
                          <span aria-hidden="true">– </span>{titleFact}
                        </p>
                      )}
                      <p className="note-date" title={`Created: ${new Date(active.createdAt).toLocaleString()} · Modified: ${new Date(active.updatedAt).toLocaleString()}`}>
                        Created{' '}
                        {new Date(active.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                      </p>
                    </div>
                    <div className="note-menu-anchor">
                      <button
                        className="icon-button"
                        aria-label={isBoard(active) ? "Board options" : "Note options"}
                        aria-expanded={menu}
                        aria-haspopup="dialog"
                        onClick={(e) => {
                          actionAnchor.current = e.currentTarget;
                          setFolderMenu(null);
                          setNoteMenuId(null);
                          setMenu((m) => !m);
                        }}
                      >
                        <AnimatedIcon kind="options" size={27} />
                      </button>
                      {menu && (
                          <ActionPopover anchor={actionAnchor.current} label="Note options" className="note-dropdown" onClose={() => setMenu(false)}>
                            <span className="menu-label">MOVE TO FOLDER</span>
                            <AppSelect
                              label="Move note to folder" className="move-folder-picker"
                              value={active.folderId || ""}
                              onChange={(value) => {
                                patchNote(active.id, {
                                  folderId: value || null,
                                });
                                if (value)
                                  setExpanded(
                                    (s) => new Set([...s, value]),
                                  );
                                setMenu(false);
                              }}
                              onCloseFocus={() => (document.querySelector<HTMLElement>('.move-folder-picker') || actionAnchor.current)?.focus({ preventScroll: true })}
                              options={[{ value: "", label: "Unfiled notes" }, ...workspace.folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
                            <button
                              onClick={() => {
                                duplicateItem(active);
                                setMenu(false);
                              }}
                            >
                              <AnimatedIcon kind="copy" size={18} />
                              Duplicate {isBoard(active) ? "board" : "note"}
                            </button>
                            <button
                              onClick={() => {
                                void exportData(
                                  `${safeFilename(active.title)}.${isBoard(active) ? "excalidraw" : "txt"}`,
                                  () => isBoard(active) ? JSON.stringify(portableBoard((checkpoint()?.notes.find((n) => n.id === active.id) as typeof active).board), null, 2) : `${active.title}\n\n${textExport(active.content)}`,
                                  isBoard(active) ? "application/json" : "text/plain",
                                );
                                setMenu(false);
                              }}
                            >
                              <AnimatedIcon kind="download" size={18} />
                              Export {isBoard(active) ? "drawing" : "as text"}
                            </button>
                            <button onClick={() => archiveNote(active)}>
                              {active.archived ? (
                                <AnimatedIcon kind="undo" size={18} />
                              ) : (
                                <AnimatedIcon kind="archive" size={18} />
                              )}{" "}
                              {active.archived
                                ? `Restore ${isBoard(active) ? "board" : "note"}`
                                : `Archive ${isBoard(active) ? "board" : "note"}`}
                            </button>
                            <button
                              className="danger-text"
                              onClick={() => confirmDelete(active)}
                            >
                              <Trash size={18} />
                              Delete permanently
                            </button>
                          </ActionPopover>
                      )}
                    </div>
                  </div>
                  {active.archived && (
                    <div className="archive-banner">
                      <AnimatedIcon kind="archive" size={18} />
                      <span>This {isBoard(active) ? "board" : "note"} is archived.</span>
                      <button onClick={() => archiveNote(active)}>
                        <AnimatedIcon kind="undo" size={16} />
                        Restore {isBoard(active) ? "board" : "note"}
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => confirmDelete(active)}
                      >
                        <Trash size={16} />
                        Delete permanently
                      </button>
                    </div>
                  )}
                  {isBoard(active) ? <BoardBoundary key={active.id} board={active.board}><Suspense fallback={<div className="board-loading" role="status">Opening drawing tools…</div>}><BoardEditor id={active.id} title={active.title} board={active.board} dark={dark} readOnly={active.archived} focusMode={focus} controlsHost={boardControlsHost} checkpoint={checkpoint} registerDraft={registerBoardDraft} onDirty={boardChanged} onShowTools={() => setFocusTools(true)} onCreateBoard={(mode) => setBoardCreation(mode)} /></Suspense></BoardBoundary> : <NoteEditor
                    key={active.id}
                    content={active.content}
                    onChange={(html) => patchNote(active.id, { content: html })}
                    validateContent={(html) => {
                      const w = wRef.current;
                      if (!w) return;
                      const next = { ...w, notes: w.notes.map((n) => n.id === active.id ? { ...n, content: html } : n) };
                      if (workspaceBytes(next) > MAX_IMPORT_FILE_SIZE)
                        throw Error("This change would exceed the notebook's 20 MB save limit. Use smaller content or remove large notes first.");
                    }}
                    onImagesReady={(fn) => { insertImages.current = fn; }}
                    onAppendReady={(fn) => {
                      append.current = fn;
                    }}
                  />}
                  {checkedCount > 0 && (
                    <div className="weekly-bar">
                      <span>
                        {checkedCount} completed{" "}
                        {checkedCount === 1 ? "item" : "items"}
                      </span>
                      <span className="toolbar-divider" />
                      <button className="primary" onClick={weeklyUpdate}>
                        <AnimatedIcon kind="weekly" size={23} />
                        Add to weekly update
                      </button>
                    </div>
                  )}
                </div>
                {!isBoard(active) && <footer className="document-footer">
                  {saveControl}
                  <span className="word-count">
                    {noteSummary(active).words} words
                  </span>
                  <button className={`backup-shortcut ${backupDue ? 'backup-due' : ''}`} disabled={backupBusy} title={`${backupStatus(backup)}. Export a full notebook backup`} onClick={() => void exportBackup()}>
                    {backupBusy ? 'Exporting…' : 'Back up notebook'}
                  </button>
                  <button
                    ref={exportAnchor}
                    className="export-shortcut"
                    title="Export a copy" aria-haspopup="dialog" aria-expanded={chromeMenu === 'export'}
                    onClick={() => setChromeMenu(value => value === 'export' ? null : 'export')}
                  >
                    Export note
                    <AnimatedIcon kind="download" size={16} />
                  </button>
                  {chromeMenu === 'export' && <ActionPopover anchor={exportAnchor.current} label="Export formats" className="export-dropdown" onClose={() => setChromeMenu(null)}>
                    <button onClick={() => {
                      void exportData(`${safeFilename(active.title)}.txt`,
                        () => `${active.title}\n\n${textExport(active.content)}`, 'text/plain');
                      setChromeMenu(null);
                    }}>This note · Plain text (.txt)</button>
                    <button disabled={backupBusy} onClick={() => { void exportBackup(); setChromeMenu(null); }}>Notebook backup (.json)</button>
                  </ActionPopover>}
                </footer>}
              </>
            ) : (
              <div className="empty-document">
                <FileText size={46} />
                <h1>
                  {view === "archive"
                    ? "Your archive is empty."
                    : "A little space to think."}
                </h1>
                <p>
                  {view === "archive"
                    ? "Archived notes appear here. Restore them anytime or delete them permanently."
                    : "Create a note and make it your own."}
                </p>
                <button className="primary" onClick={() => createNote(null)}>
                  <AnimatedIcon kind="add" size={20} />
                  New note
                </button>
              </div>
            )}
            {error && (
              <div className="storage-error" role="alert">
                <WarningCircle size={18} />
                <span>{error}</span>
                <button onClick={() => void flush().catch(() => {})}>
                  Retry
                </button>
              </div>
            )}
          </main>
          <PanelResize panel="reference" visible={reference && !focus} layoutKey={`${sidebar && !focus}-${appearance.elementSize}`} />
          <aside
            id="reference-panel"
            className="reference-panel panel"
            aria-label="Reference panel"
            inert={!reference || focus}
          >
            <div className="reference-label">
              <span>Reference</span>
              <button
                className="icon-button"
                aria-label="Close reference"
                onClick={() => { moveFocusFromPanels(".reference-panel", 'button[aria-label="Reference"]'); setReference(false); }}
              >
                <AnimatedIcon kind="close" size={21} />
              </button>
            </div>
            <AppSelect
              className="reference-picker"
              label="Reference note or board"
              value={workspace.referenceId || ""}
              onChange={(value) =>
                update((w) => ({ ...w, referenceId: value || null }))
              }
              options={[{ value: "", label: "Choose a reference…" }, ...workspace.notes.filter((note) => !note.archived).map((note) => ({ value: note.id, label: `${isBoard(note) ? "Board · " : ""}${note.title || "Untitled"}` }))]} />
            {referenceNote ? (
              <>
                <div className="reference-meta">
                  <span className="read-only">Read only</span>
                  <button
                    className="link-button"
                    onClick={() => selectNote(referenceNote)}
                  >
                    <AnimatedIcon kind="open" size={19} />
                    Open {isBoard(referenceNote) ? "board" : "note"}
                  </button>
                </div>
                <div className="reference-body">
                  {isBoard(referenceNote) ? <BoardBoundary key={referenceNote.id} board={referenceNote.board}><Suspense fallback={<p role="status">Opening drawing preview…</p>}><BoardPreview board={referenceNote.board} dark={dark} /></Suspense></BoardBoundary> : <NoteEditor
                    key={referenceNote.id}
                    content={referenceNote.content}
                    readOnly
                  />}
                </div>
                {!isBoard(referenceNote) && <button
                  className="copy-reference"
                  disabled={!active || isBoard(active) || active.id === referenceNote.id}
                  onClick={() => {
                    append.current(referenceNote.content);
                    notify("Reference copied to the current note.");
                  }}
                >
                  <AnimatedIcon kind="copy" size={23} />
                  Copy to current note
                </button>}
                <p className="reference-hint">
                  Keep a thought in view while you write.
                </p>
              </>
            ) : (
              <div className="reference-empty">
                <BookOpen size={37} />
                <h3>Choose a reference</h3>
                <p>Recent notes & boards</p>
                <div className="reference-recents">
                  {workspace.notes.filter(note => !note.archived).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(note =>
                    <button key={note.id} onMouseDown={preserveDocumentFocus} onClick={() => showReference(note)}>
                      <AnimatedIcon kind={isBoard(note) ? 'board' : 'note'} size={20} /><span>{note.title || 'Untitled'}</span>
                    </button>)}
                  {!workspace.notes.some(note => !note.archived) && <p>Create a note or board to keep it here.</p>}
                </div>
              </div>
            )}
          </aside>
        </div>
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )}
        {boardCreation && <BoardBoundary onClose={() => setBoardCreation(null)}><Suspense fallback={<div role="status" className="toast">Opening board import…</div>}><CreateBoardDialog mode={boardCreation} dark={dark} returnFocus={() => document.getElementById('board-insert-trigger')} onClose={() => setBoardCreation(null)} onCreate={(title: string, board: BoardData) => createBoard(active?.folderId ?? null, title, board, true)} /></Suspense></BoardBoundary>}
        {modal && (
          <Dialog
            title={
              modal.kind === "settings"
                ? "Settings"
                : modal.kind === 'shortcuts' ? 'Keyboard shortcuts'
                : modal.kind === "folder"
                  ? modal.id
                    ? "Rename folder"
                    : "New folder"
                  : modal.kind === "importResults"
                    ? "Import results"
                  : modal.kind === "removeFolder"
                    ? "Remove folder?"
                    : "Delete this note permanently?"
            }
            className={modal.kind === 'settings' ? 'settings-dialog' : undefined}
            onClose={() => setModal(null)}
          >
            {modal.kind === 'shortcuts' ? <>
              <ShortcutList />
              <div className="dialog-actions"><button className="primary" onClick={() => setModal(null)}>Done</button></div>
            </> : modal.kind === "settings" ? (
              <SettingsContent theme={workspace.theme} appearance={appearance} backup={backup} backupBusy={backupBusy}
                importing={importing} dataPath={dataPath} initialSection={modal.section}
                onTheme={theme => update(w => ({ ...w, theme }))}
                onAppearance={appearance => update(w => ({ ...w, appearance }))}
                onExport={() => void exportBackup()} onImport={() => chooseImport(null)}
                onUpdates={() => {
                  if (desktop) void invoke('open_releases').catch(e => notify(`Release page could not open: ${String(e)}`));
                  else window.open('https://github.com/Malon0825/scribly/releases/latest', '_blank', 'noopener,noreferrer');
                }} onShortcuts={() => setModal({ kind: 'shortcuts' })} onDone={() => setModal(null)} />
            ) : modal.kind === "importResults" ? (
              <>
                <p className="modal-subtitle">{modal.imported} {modal.imported === 1 ? "note imported" : "notes imported"}. These files could not be imported:</p>
                <ul className="import-failures">{modal.failures.map((failure, i) => <li key={i}>{failure}</li>)}</ul>
                <div className="dialog-actions"><button className="primary" onClick={() => setModal(null)}>Done</button></div>
              </>
            ) : modal.kind === "folder" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitFolder();
                }}
              >
                <label className="field-label" htmlFor="folder-name">
                  Folder name
                </label>
                <input
                  id="folder-name"
                  className="form-input"
                  value={folderName}
                  maxLength={80}
                  onChange={(e) => setFolderName(e.target.value)}
                />
                <div className="dialog-actions">
                  <button onClick={() => setModal(null)} type="button">
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={!folderName.trim()}
                    type="submit"
                  >
                    {modal.id ? "Save name" : "Create folder"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="modal-subtitle">
                  {modal.kind === "removeFolder"
                    ? "Notes in this folder will move to Unfiled notes."
                    : `“${workspace.notes.find((n) => n.id === modal.id)?.title || "Untitled"}” will be permanently removed. This cannot be undone. You can export a backup first in Settings.`}
                </p>
                <div className="dialog-actions">
                  <button onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      if (modal.kind === "removeFolder") {
                        if (!update((w) => ({
                          ...w,
                          folders: w.folders.filter((f) => f.id !== modal.id),
                          notes: w.notes.map((n) =>
                            n.folderId === modal.id
                              ? { ...n, folderId: null }
                              : n,
                          ),
                        }))) return;
                        notify("Folder removed. Notes moved to Unfiled.");
                      } else if (modal.kind === "delete") {
                        if (!update((w) => {
                          const deleted = w.notes.find((n) => n.id === modal.id);
                          if (!deleted) return w;
                          const notes = w.notes.filter(
                            (n) => n.id !== modal.id,
                          );
                          const remaining = notes.filter((n) =>
                            matches(n) && (view === "archive" ? n.archived :
                              !n.archived && (view !== "unfiled" || n.folderId === null)),
                          );
                          return {
                            ...w,
                            notes,
                            activeId:
                              w.activeId === modal.id
                                ? remaining.find((n) => n.folderId === deleted.folderId)?.id || remaining[0]?.id || ""
                                : w.activeId,
                            referenceId:
                              w.referenceId === modal.id ? null : w.referenceId,
                          };
                        })) return;
                        notify("Note deleted.");
                      }
                      setModal(null);
                    }}
                  >
                    {modal.kind === "removeFolder"
                      ? "Remove folder"
                      : "Delete permanently"}
                  </button>
                </div>
              </>
            )}
          </Dialog>
        )}
        <input
          ref={importRef}
          type="file"
          aria-label="Import files"
          accept={importAccept}
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            await importFiles(files, importDestination.current);
          }}
        />
      </div>
    </IconContext.Provider>
  );
}

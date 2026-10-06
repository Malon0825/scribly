import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Dialog } from "./Dialog";
import { IconContext, SidebarSimple, FileText, BookOpen, X, Check, UploadSimple, Trash, Minus, Square, SpinnerGap, WarningCircle, PushPin, ClockCounterClockwise, CaretDown } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { NoteEditor } from "./NoteEditor";
import { DictionaryPanel } from "./DictionaryPanel";
import { SettingsContent, type SettingsSection } from "./SettingsContent";
import { QuickCaptureSettings } from "./QuickCaptureSettings";
import { QuickCapture } from "./QuickCapture";
import { useCaptureWriter } from "./useCaptureWriter";
import { drainCaptureForShutdown, openNativeCapture, subscribeCaptureOpen } from "./captureService";
import { AppSelect } from "./AppSelect";
import { ActionPopover } from "./ActionPopover";
import { AnimatedIcon } from "./AnimatedIcon";
import { TrashIcon } from "./TrashIcon";
import { normalizeAppearance, elementSizes, noteFonts } from "./appearance";
import { useWorkspace } from "./useWorkspace";
import { useAppIcon } from "./useAppIcon";
import { useSidebarDrag } from "./useSidebarDrag";
import { PanelResize } from "./PanelResize";
import { defaultNoteTitle, noteTitleFact } from "./noteNaming";
import { newNoteContent } from "./newNoteContent";
import { noteSummary } from "./noteSummary";
import { readNotebookView, orderNotes, matchesNote, notePreview, type NotebookView } from './notebookNavigation';
import { readBackup as readBackupHistory, recordBackup, backupStatus, type BackupRecord } from './backupHistory';
import { mergeBackup } from "./importBackup";
import { parseImportFile, importAccept, MAX_IMPORT_FILES } from "./importFiles";
import { portableBackup } from "./attachments";
import { useFileDrop } from "./useFileDrop";
import { desktop, downloadFile, exportArtifact } from "./storage";
import { sourceFilesInHtml } from "./sourceFileData";
import { isBoard, isTemplate, isLiveItem, plainText, textExport, type Note, type Workspace } from "./types";
import { ItemLinkPicker } from "./ItemLinkPicker";
import { TemplateDialog, type TemplateDraft } from "./TemplateDialog";
import { backlinks, remapItemLinks, safeExternalHref } from "./itemLinks";
import { instantiateTemplate, templateNote, removeTemplate } from "./noteTemplates";
import { emptyBoard, portableBoard, validateBoard, type BoardData } from "./boardData";
import { BoardBoundary } from "./BoardBoundary";
import { NotepadImportDialog } from "./NotepadImportDialog";
import { mergeNotepadTabs, notepadSourceName, type NotepadSource, type NotepadTab } from "./notepadImport";
import { trashItem, trashFolder, restoreTrashItem, restoreTrashFolder, purgeTrash } from "./trash";
import { checkpointHistory, historyRestoration } from "./history";
import { HistoryDialog } from "./HistoryDialog";
import { BackupSettings } from "./BackupSettings";
import { BackupRestoreDialog } from "./BackupRestoreDialog";
import { readBackup, useBackups, type BackupEntry } from "./backups";
import { recordOpened } from "./itemNavigation";
import { notebookMatches, matchingExcerpt, matchingBoardElement } from "./notebookSearch";
import { literalPattern } from "./textSearch";
import type { FindRequest } from "./NoteFind";
const BoardEditor = lazy(() => import("./BoardEditor"));
const CreateBoardDialog = lazy(() => import("./CreateBoardDialog"));
const BoardPreview = lazy(() => import("./BoardPreview"));
const ExportDialog = lazy(() => import("./ExportDialog").then(module => ({ default: module.ExportDialog })));

type Modal =
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "shortcuts" }
  | { kind: "folder"; id?: string }
  | { kind: "delete"; id: string }
  | { kind: "emptyTrash" }
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
  const { workspace, update: mutate, status, error, dataPath, flush, reload, checkpoint, registerBoardDraft, boardChanged, savedRevision } =
    useWorkspace();
  useCaptureWriter({ ready: !!workspace && status !== "loading", update: mutate, checkpoint, flush });
  const [captureOpen, setCaptureOpen] = useState(false);
  const captureReturnTo = useRef<HTMLElement | null>(null);
  const captureOpenHandler = useRef<(id: string) => void>(() => {});
  captureOpenHandler.current = id => {
    const note = checkpoint()?.notes.find(item => item.id === id);
    if (!note) { notify("The saved capture is not available in this notebook."); return; }
    setCaptureOpen(false); setModal(null); setQuery(""); selectNote(note, false);
  };
  useEffect(() => {
    let gone = false, off: (() => void) | undefined;
    void subscribeCaptureOpen(id => captureOpenHandler.current(id)).then(unsubscribe => { if (gone) unsubscribe(); else off = unsubscribe; })
      .catch(reason => notify(`Capture navigation is unavailable: ${String(reason)}`));
    return () => { gone = true; off?.(); };
  }, []);
  useEffect(() => { if (workspace) { try { localStorage.setItem("scribly-capture-theme", workspace.theme); } catch { /* Capture uses System if unavailable. */ } } }, [workspace?.theme]);
  function openCapture() {
    captureReturnTo.current = document.querySelector('button[aria-label="Settings"]');
    setModal(null); setMenu(false); setFolderMenu(null); setNoteMenuId(null);
    if (desktop) void openNativeCapture().catch(reason => notify(`Quick capture could not open: ${String(reason)}`));
    else setCaptureOpen(true);
  }
  const backups = useBackups(workspace,status,checkpoint,savedRevision);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [linkPicker,setLinkPicker] = useState<{ insert: (note: Note) => void; cancel: () => void } | null>(null);
  const [linkAction,setLinkAction] = useState<{ id: string; anchor: HTMLElement; restore: () => void } | null>(null);
  const [templatesDialog,setTemplatesDialog] = useState<{ mode: "save" | "manage" | "choose"; source?: Note; folderId: string | null } | null>(null);
  const [formattedExport, setFormattedExport] = useState<{ notes: Note[]; scope: string; returnTo: HTMLElement | null } | null>(null);
  const insertItemLink = useRef<() => void>(() => {});
  const [restorePreview, setRestorePreview] = useState<Pick<Workspace, "notes" | "folders"> | null>(null);
  const restoreGeneration = useRef(0), historyGeneration = useRef(0);
  const [sidebar, setSidebar] = useState(true),
    [reference, setReference] = useState(false),
    [focus, setFocus] = useState(false);
  const [dictionary, setDictionary] = useState(false);
  const [dictionaryTerm, setDictionaryTerm] = useState("");
  const replaceDictionaryWord = useRef<(word: string, expected: string) => boolean>(() => false);
  const [focusTools, setFocusTools] = useState(false);
  const [boardControlsHost, setBoardControlsHost] = useState<HTMLDivElement | null>(null);
  const [notebookView, setNotebookView] = useState(readNotebookView);
  const rowDensity = workspace?.theme === 'notebook' ? notebookView.notebookDensity || 'compact' : notebookView.density;
  const [backup, setBackup] = useState<BackupRecord | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupInFlight = useRef(false);
  const [chromeMenu, setChromeMenu] = useState<'theme' | 'export' | null>(null);
  const themeAnchor = useRef<HTMLButtonElement>(null), exportAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => { setBackup(readBackupHistory(dataPath)); }, [dataPath]);
  function changeNotebookView(next: Partial<NotebookView>) {
    const value = { ...notebookView, ...next };
    if (workspace?.theme === 'notebook' && next.density) {
      value.notebookDensity = next.density;
      value.density = notebookView.density;
    }
    setNotebookView(value);
    try { localStorage.setItem('scribly-notebook-view', JSON.stringify(value)); } catch { /* Session preferences remain usable. */ }
  }
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["work", "data"]),
  );
  const [query, setQuery] = useState(""),
    [view, setView] = useState<"notes" | "unfiled" | "trash">("notes");
  const [modal, setModal] = useState<Modal>(null),
    [folderName, setFolderName] = useState("");
  const [menu, setMenu] = useState(false),
    [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const [findFor, setFindFor] = useState<(FindRequest & { id: string }) | null>(null);
  const [boardSearch, setBoardSearch] = useState<{ id: string; elementId: string; serial: number } | null>(null);
  const findSerial = useRef(0);
  const [recentExpanded, setRecentExpanded] = useState(false), [pinsExpanded, setPinsExpanded] = useState(false);
  const [sidebarMenu, setSidebarMenu] = useState<"create" | "notebook" | null>(null);
  const createAnchor = useRef<HTMLButtonElement>(null), notebookAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!sidebar || focus) setSidebarMenu(null); }, [sidebar, focus]);
  const actionAnchor = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState(""),
    [closing, setClosing] = useState(false);
  const [sidebarAnnouncement, setSidebarAnnouncement] = useState("");
  const [importing, setImporting] = useState(false);
  const [importLabel, setImportLabel] = useState("Importing files…");
  const [notepadImport, setNotepadImport] = useState<{ folderId: string | null; source: NotepadSource; returnTo: HTMLElement | null } | null>(null);
  const [boardCreation, setBoardCreation] = useState<"import" | "template" | null>(null);
  const importBusy = useRef(false);
  const importDestination = useRef<string | null>(null);
  const sidebarDrag = useSidebarDrag({
    workspace,
    update,
    reorderNotes: notebookView.sort === 'manual' && notebookView.filter === 'all',
    reveal: (folderId) => {
      if (folderId) setExpanded((s) => new Set([...s, folderId]));
      setView(folderId === null ? "unfiled" : "notes");
      setQuery("");
    },
    announce: setSidebarAnnouncement,
    begin: () => {
      setSidebarMenu(null);
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
  const active = workspace?.notes.find((n) => n.id === workspace.activeId && !isTemplate(n));
  useEffect(() => {
    setFindFor(current => current?.id === active?.id ? current : null);
    setBoardSearch(current => current?.id === active?.id ? current : null);
  }, [active?.id]);
  const insertImages = useRef<(files: File[], point?: { left: number; top: number }) => void>(() => {});
  const fileDrop = useFileDrop(view === "trash" ? null : active?.folderId || null,
    (files, folder) => { void importFiles(files, folder); },
    active && isLiveItem(active) && !isBoard(active) ? (files, point) => insertImages.current(files, point) : undefined);
  const referenceNote = workspace?.notes.find(
    (n) => n.id === workspace.referenceId && isLiveItem(n),
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
      if (active?.deletedAt) setView("trash");
      if (active?.folderId) setExpanded(s => new Set([...s, active.folderId!]));
    }
  }, [workspace, active?.archived, active?.deletedAt]);
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
  function chooseNotepadImport(folderId: string | null, source: NotepadSource = "notepad") {
    if (importBusy.current) { notify("An import is already in progress. Please wait."); return; }
    setFolderMenu(null); setNoteMenuId(null); setMenu(false); setModal(null);
    setNotepadImport({ folderId, source, returnTo: folderId ? actionAnchor.current : document.querySelector('button[aria-label="Settings"]') });
  }
  async function importNotepadTabs(tabs: NotepadTab[], destination: string) {
    if (importBusy.current) throw Error("An import is already in progress. Please wait.");
    importBusy.current = true;
    const source = notepadImport?.source ?? "notepad", name = source === "notepad" ? "Notepad" : notepadSourceName(source);
    setImporting(true); setImportLabel(`Importing ${name} tabs…`);
    let imported = 0;
    let duplicates = 0;
    let folderId: string | null = null;
    try {
      mutate((w) => {
        const result = mergeNotepadTabs(w, tabs, destination, source);
        imported = result.imported; duplicates = result.duplicates; folderId = result.folderId;
        return result.workspace;
      });
      setNotepadImport(null);
      if (imported) {
        setView(folderId ? "notes" : "unfiled"); setQuery("");
        if (folderId) setExpanded((s) => new Set([...s, folderId!]));
        setImportLabel(`Saving imported ${name} notes…`);
        try { await flush(); }
        catch { notify(`${name} notes were added, but saving failed. Keep Scribly open and use Retry to save them.`); return; }
      }
      notify(`${imported} ${imported === 1 ? "note" : "notes"} imported from ${name}.${duplicates ? ` ${duplicates} matching notes skipped.` : ""}`);
    } finally { importBusy.current = false; setImporting(false); }
  }
  function preserveDocumentFocus(event: MouseEvent<HTMLButtonElement>) {
    if (event.button === 0 && document.activeElement?.closest(".document-panel")) event.preventDefault();
  }
  function moveFocusFromPanels(selector: string, destination: string) {
    if (document.activeElement?.closest(selector)) document.querySelector<HTMLElement>(destination)?.focus({ preventScroll: true });
  }
  function toggleFocus() {
    moveFocusFromPanels('.sidebar, .reference-panel, .panel-resize, .brand, .theme-toggle, button[aria-label="Reference"], button[aria-label="Dictionary"], .document-head, .board-top-controls, .editor-toolbar, .weekly-bar, .export-shortcut, .focus-tools-toggle, .excalidraw .layer-ui__wrapper__top-right, .excalidraw .sidebar', 'button[aria-label="Focus"]');
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
          const parsed = await parseImportFile(file, setImportLabel);
          let added = 0;
          let nextId: string | null = null;
          mutate((w) => {
            let next: Workspace;
            if (parsed.kind === "backup") {
              next = mergeBackup(w, parsed.backup);
              nextId = next.notes.slice(w.notes.length).find(isLiveItem)?.id || null;
              added = parsed.backup.notes.length;
              next = { ...next, activeId: w.activeId };
            } else {
              if (folder && !w.folders.some((f) => f.id === folder && !f.deletedAt)) throw Error("The destination folder was removed. Choose a folder again.");
              const time = new Date().toISOString();
              nextId = crypto.randomUUID();
              const item = { id: nextId, title: parsed.title, content: parsed.kind === "board" ? "" : parsed.content,
                folderId: folder, createdAt: time, updatedAt: time, archived: false,
                ...(parsed.kind === "board" ? { kind: "board" as const, board: parsed.board } : {}) } as Note;
              next = { ...w, ...(parsed.kind === "board" ? { schemaVersion: w.schemaVersion || 2 as const } : {}), notes: [...w.notes, item] };
              added = 1;
            }
            return next;
          });
          imported += added;
          firstId ||= nextId;
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (firstId) {
        const selection: { note?: Note } = {};
        mutate((w) => {
          selection.note = w.notes.find((n) => n.id === firstId && isLiveItem(n));
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
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemDark(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = workspace?.theme === "notebook" ? "notebook" : dark ? "dark" : "light";
  }, [dark, workspace?.theme]);
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
          await drainCaptureForShutdown();
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") { e.preventDefault(); insertItemLink.current(); }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && ["f", "h"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        const note = noteRef.current;
        if (note && !isBoard(note)) openFind(note, e.key.toLowerCase() === "h");
        else if (e.key.toLowerCase() === "f") {
          setSidebar(true); setFocus(false);
          setTimeout(() => searchRef.current?.focus(), 0);
          notify("Search boards by text and frame labels. Select a result to reveal its shape.");
        } else notify("Replace is available in text notes. Board labels are edited on the canvas.");
      }
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
    originId?: string,
    templateChoice?: { id: string; title: string; reset: boolean },
  ) {
    const created = new Date();
    const now = created.toISOString();
    const id = crypto.randomUUID();
    newNoteFocus.current = id;
    if (!update((w) => {
      if (folderId && !w.folders.some(folder => folder.id === folderId && !folder.deletedAt)) folderId = null;
      const naming = title === undefined ? defaultNoteTitle(w, folderId, created) : { title };
      const templateId = templateChoice?.id || (title === undefined && content === undefined ? w.folders.find(folder => folder.id === folderId)?.templateId : undefined);
      const template = templateId ? w.notes.find(note => note.id === templateId && isTemplate(note)) : undefined;
      if (templateChoice && !template) throw Error("This template was removed. Choose another template.");
      const seed = template ? instantiateTemplate(template,id,templateChoice?.title.trim() || naming.title,created,templateChoice?.reset ?? template.template?.resetChecklist) : undefined;
      let note: Note = {
        id, folderId, ...naming,
        content: content ?? (title === undefined ? newNoteContent(w, folderId) : "<p></p>"),
        createdAt: now, updatedAt: now, archived: false,
      };
      if (seed) { const { autoTitle: _, ...rest } = note; note = { ...rest, ...seed }; }
      if (originId) note = remapItemLinks(note,new Map([[originId,id]]));
      return { ...w, notes: [...w.notes, note], activeId: id };
    })) return;
    setView("notes");
    setQuery("");
    if (notebookView.filter === 'boards') changeNotebookView({ filter: 'all' });
    const createdFolder = folderId;
    if (createdFolder) setExpanded((s) => new Set([...s, createdFolder]));
  }
  function patchNote(id: string, patch: Partial<Note>) {
    return update((w) => ({
      ...w,
      notes: w.notes.map((n) =>
        n.id === id && !n.deletedAt
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
      if (folderId && !w.folders.some(folder => folder.id === folderId && !folder.deletedAt)) folderId = null;
      const naming = title === undefined ? defaultNoteTitle(w, folderId, created) : { title };
      return { ...w, schemaVersion: w.schemaVersion || 2, notes: [...w.notes, { id, folderId, kind: "board", board, ...naming, content: "", createdAt: now, updatedAt: now, archived: false }], activeId: id };
    })) {
      if (strict) throw Error("The board could not be added. Resolve the notebook save error before creating it.");
      return;
    }
    setView("notes"); setQuery(""); setFolderMenu(null); setMenu(false); setNoteMenuId(null);
    if (notebookView.filter === 'notes') changeNotebookView({ filter: 'all' });
    const createdFolder = folderId;
    if (createdFolder) setExpanded((s) => new Set([...s, createdFolder]));
  }
  function duplicateItem(item: Note) {
    if (!isBoard(item)) { createNote(item.folderId, `${item.title} (copy)`, item.content,item.id); return; }
    let current: Note = item;
    try { current = checkpoint()?.notes.find((n) => n.id === item.id) || item; }
    catch (e) { notify(`Board could not be duplicated: ${String(e)}`); return; }
    if (!isBoard(current)) return;
    const copy: Note = { ...current, id: crypto.randomUUID(), title: `${current.title} (copy)`, archived: false, pinned: false, deletedAt: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), board: JSON.parse(JSON.stringify(current.board)) };
    update((w) => ({ ...w, notes: [...w.notes, remapItemLinks({ ...copy, folderId: w.folders.some(folder => folder.id === copy.folderId && !folder.deletedAt) ? copy.folderId : null },new Map([[item.id,copy.id]]))], activeId: copy.id }));
  }
  function requestLink(insert: (note: Note) => void, cancel: () => void) {
    setMenu(false); setFolderMenu(null); setNoteMenuId(null); setLinkPicker({ insert,cancel });
  }
  function closeLinkPicker() { const pending = linkPicker; setLinkPicker(null); pending?.cancel(); }
  function openLinkedItem(id: string, inReference = false) {
    const target = wRef.current?.notes.find(note => note.id === id && !isTemplate(note));
    if (!target) { notify("This linked item is missing. Its link is retained for future restoration."); return; }
    if (inReference) {
      if (!isLiveItem(target)) { notify("Restore this item before opening it in Reference."); return; }
      update(w => ({ ...w,referenceId:id })); setDictionary(false); setReference(true);
    } else { setQuery(""); selectNote(target,false); }
  }
  function activateLink(id: string, anchor: HTMLElement, action: "open" | "reference" | "options", restore: () => void) {
    if (action === "options") setLinkAction({ id,anchor,restore });
    else { openLinkedItem(id,action === "reference"); if (action === "reference") restore(); }
  }
  function openExternalLink(href: string) {
    if (!safeExternalHref(href)) { notify("Only http and https web links can be opened."); return; }
    if (desktop) void invoke("open_external_link",{ url:href }).catch(reason => notify(`Link could not be opened: ${String(reason)}`));
    else window.open(href,"_blank","noopener,noreferrer");
  }
  function openTemplates(mode: "save" | "manage" | "choose", folderId = active?.folderId || null) {
    setSidebarMenu(null);
    setMenu(false); setNoteMenuId(null); setFolderMenu(null); setModal(null);
    setTemplatesDialog({ mode,folderId,...(mode === "save" && active ? { source:active } : {}) });
  }
  function saveTemplate(draft: TemplateDraft, id?: string) {
    if (!templatesDialog) return;
    if (!update(w => {
      if (id) return { ...w,notes:w.notes.map(note => note.id === id && isTemplate(note) ? { ...note,title:draft.name,template:{ titlePattern:draft.titlePattern,resetChecklist:draft.resetChecklist },updatedAt:new Date().toISOString() } : note) };
      const source = templatesDialog.source;
      if (!source || isBoard(source)) throw Error("Choose a text note to save as a template.");
      return { ...w,notes:[...w.notes,templateNote(source,draft.name,draft.titlePattern,draft.resetChecklist)] };
    })) return;
    if (!id) setTemplatesDialog(null); notify(id ? "Template updated. Existing notes are unchanged." : "Note template saved.");
  }
  function selectNote(n: Note, revealQuery = true) {
    if (!update((w) => recordOpened({ ...w, activeId: n.id }))) return;
    setSidebarMenu(null);
    if (n.folderId) setExpanded((s) => new Set([...s, n.folderId!]));
    setView(n.deletedAt ? "trash" : "notes");
    if (!matchesNote(n, '', notebookView.filter)) changeNotebookView({ filter: 'all' });
    setMenu(false);
    setNoteMenuId(null);
    if (revealQuery && query.trim()) {
      const element = matchingBoardElement(n, query);
      if (element) setBoardSearch({ id: n.id, elementId: element.id, serial: ++findSerial.current });
      else if (!isBoard(n) && literalPattern(query.trim()).test(plainText(n.content))) openFind(n, false, query.trim());
      else if (literalPattern(query.trim()).test(n.title)) {
        const match = literalPattern(query.trim()).exec(n.title)!;
        requestAnimationFrame(() => { titleRef.current?.focus(); titleRef.current?.setSelectionRange(match.index, match.index + match[0].length); });
      }
      else if (!isBoard(n)) requestAnimationFrame(() => { Array.from(document.querySelectorAll<HTMLElement>(".document-editor .source-file-block")).find(block => literalPattern(query.trim()).test(block.textContent || ""))?.scrollIntoView({ block: "nearest" }); });
    }
  }
  function openFind(note: Note, replace = false, text?: string) {
    setFindFor({ id: note.id, serial: ++findSerial.current, replace, ...(text !== undefined ? { query: text } : {}) });
    setMenu(false); setNoteMenuId(null);
  }
  function togglePin(note: Note) {
    update(w => ({ ...w, notes: w.notes.map(item => item.id === note.id ? { ...item, pinned: !item.pinned } : item) }));
    setMenu(false); setNoteMenuId(null);
    setSidebarAnnouncement(`${note.title || "Untitled"} ${note.pinned ? "unpinned" : "pinned"}.`);
  }
  useEffect(() => {
    if (!dictionary || !reference || focus) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest('[role="dialog"], .select-popup'))) return;
      event.preventDefault();
      closeDictionary();
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [dictionary, reference, focus]);
  function openDictionary(word?: string) {
    if (word) setDictionaryTerm(word);
    moveFocusFromPanels('.reference-panel', 'button[aria-label="Dictionary"]');
    setDictionary(true); setReference(true); setFocus(false);
  }
  function closeDictionary() {
    moveFocusFromPanels('.reference-panel', 'button[aria-label="Dictionary"]');
    setReference(false);
  }
  function toggleReference() {
    moveFocusFromPanels('.reference-panel', 'button[aria-label="Reference"]');
    setReference(value => dictionary || !value); setDictionary(false); setFocus(false);
  }
  function showReference(note: Note) {
    if (!update(w => ({ ...w, referenceId: note.id }))) return;
    setDictionary(false); setReference(true); setFocus(false); setNoteMenuId(null);
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
      const current = checkpoint() || workspace;
      if (!current) return;
      const stamp = new Date().toISOString().slice(0, 10);
      const originals = current.notes.some(note => sourceFilesInHtml(note.content).length);
      const value = originals ? await (await import("./fileBackup")).fileBackup(current) : await portableBackup(current);
      const saved = await exportArtifact(`Scribly-backup-${stamp}.${originals ? "scribly" : "json"}`, value, originals ? "application/zip" : "application/json");
      if (saved) {
        const record = { at: Date.now(), downloaded: !desktop };
        setBackup(record);
        try { recordBackup(dataPath, record); }
        catch { notify('Backup exported, but its date could not be recorded.'); }
        notify(desktop ? "Backup saved." : "Backup download requested.");
      }
    } catch (error) { notify(`Backup failed: ${String(error)}`); }
    finally { backupInFlight.current = false; setBackupBusy(false); }
  }
  function openFormattedExport(id: string, folder = false, returnTo = actionAnchor.current) {
    try {
      const current = checkpoint() || workspace;
      if (!current) return;
      const notes = current.notes.filter(note => !isBoard(note) && !isTemplate(note) &&
        (folder ? note.folderId === id && !note.archived && !note.deletedAt : note.id === id));
      if (!notes.length) { notify("This folder has no active text notes to export."); return; }
      const scope = folder ? current.folders.find(item => item.id === id)?.name || "Folder" : notes[0].title || "Untitled";
      // Text/title values are immutable strings; shallow item snapshots avoid
      // duplicating a large folder's bodies just to open the export dialog.
      setFormattedExport({ notes: notes.map(note => ({ ...note })), scope, returnTo });
      setMenu(false); setNoteMenuId(null); setFolderMenu(null);
    } catch (reason) { notify(`Export could not be opened: ${String(reason)}`); }
  }
  function moveToTrash(note: Note) {
    if (!update(w => trashItem(w, note.id))) return;
    setMenu(false); setNoteMenuId(null);
    notify("Moved to Trash. You can restore it anytime.");
  }
  function moveFolderToTrash(id: string) {
    if (!update(w => trashFolder(w, id))) return;
    setFolderMenu(null);
    notify("Folder and its contents moved to Trash.");
  }
  function restoreFolder(id: string) {
    if (!update(w => restoreTrashFolder(w, id))) return;
    setView("notes"); setQuery(""); setExpanded(values => new Set([...values, id]));
    notify("Folder restored.");
  }
  function confirmDelete(note: Note) {
    setModal({ kind: "delete", id: note.id });
    setSidebarMenu(null);
    setMenu(false);
    setNoteMenuId(null);
  }
  function restoreFromTrash(note: Note, previousReference?: string | null) {
    if (!update(w => {
      const next = restoreTrashItem(w,note.id);
      return previousReference === note.id && !note.archived ? { ...next, referenceId: note.id } : next;
    })) return;
    setView(note.folderId ? "notes" : "unfiled"); setQuery("");
    if (note.folderId) setExpanded(values => new Set([...values,note.folderId!]));
    setMenu(false); setNoteMenuId(null); notify("Item restored.");
  }
  function openTrash() {
    if (!update(w => ({ ...w, activeId: w.notes.find(note => note.deletedAt)?.id || "" }))) return;
    setSidebarMenu(null);
    setView("trash"); setQuery(""); setMenu(false); setNoteMenuId(null);
  }
  async function openHistory(note: Note) {
    const generation = ++historyGeneration.current;
    setMenu(false); setNoteMenuId(null);
    try { await flush(); if (generation === historyGeneration.current) setHistoryId(note.id); }
    catch (reason) { notify(`Save before opening history: ${String(reason)}`); }
  }
  async function previewBackup(input: File | BackupEntry) {
    const generation = ++restoreGeneration.current;
    try {
      notify("Checking notebook backup…");
      const file = input instanceof File ? input : new File([await readBackup(input)],"backup.scribly",{ type: "application/zip" });
      const parsed = await parseImportFile(file);
      if (parsed.kind !== "backup") throw Error("Choose a Scribly notebook backup, not an ordinary document.");
      if (generation === restoreGeneration.current) { setModal(null); setRestorePreview(parsed.backup); }
    } catch (reason) { notify(`Backup could not be opened: ${String(reason)}`); }
  }
  async function restoreNotebook(replace: boolean) {
    const generation = restoreGeneration.current, preview = restorePreview;
    const before = checkpoint();
    if (!preview || !before) throw Error("Open a backup preview first.");
    await flush();
    if (replace) await backups.run(true);
    if (generation !== restoreGeneration.current) return;
    if (checkpoint() !== before) throw Error("The notebook changed while preparing the restore. Reopen the backup preview.");
    const next = replace ? { ...before, schemaVersion: 5 as const, folders: preview.folders, notes: preview.notes, recentIds: [],
      activeId: preview.notes.find(isLiveItem)?.id || "", referenceId: null } : mergeBackup(before,preview);
    if (!update(() => next)) throw Error("The backup could not be adopted.");
    const adopted = checkpoint();
    try { await flush(); }
    catch (reason) { if (checkpoint() === adopted) update(() => before); throw Error(`Restore failed. The previous notebook remains available: ${String(reason)}`); }
    setRestorePreview(null); setView("notes"); setQuery(""); notify(replace ? "Notebook replaced. Its recovery copy is in Backups." : "Backup imported as new items.");
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
      (n) => n.title.toLowerCase() === "weekly update" && isLiveItem(n) && !isBoard(n),
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
      setDictionary(false); setReference(true);
      notify(`${unique.length} items added to Weekly update.`);
    } else {
      createNote(active.folderId, "Weekly update", content);
      notify("Weekly update created.");
    }
  }
  const checkedCount = active
    ? (active.content.match(/data-checked="true"/g) || []).length
    : 0;
  const matches = (n: Note) => !isTemplate(n) && matchesNote(n, '', notebookView.filter) && notebookMatches(n, query);
  const visible = (n: Note) => !n.archived && !n.deletedAt && matches(n);
  const renderNote = (n: Note) => (
    <div
      className={`note-row ${active?.id === n.id ? "active" : ""}${sidebarDrag.dragging?.kind === "note" && sidebarDrag.dragging.id === n.id ? " dragging" : ""}${sidebarDrag.dropClass("note-order", n.id)}`}
      key={n.id}
      {...(!n.archived && !n.deletedAt && sidebarDrag.dragging?.kind !== "folder" ? sidebarDrag.dropProps({ kind: "note-order", id: n.id, after: false }) : {})}
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
        {...sidebarDrag.dragProps({ kind: "note", id: n.id }, !n.archived && !n.deletedAt)}
        title={`${n.title || 'Untitled'}${isLiveItem(n) ? ' · Alt+click to show as reference. Drag to a folder or Trash. Use manual order with All items to reorder.' : ''}`}
        aria-current={active?.id === n.id ? "page" : undefined}
        aria-label={n.title || 'Untitled'}
        onMouseDown={event => { if (event.altKey) preserveDocumentFocus(event); }}
        onClick={(event) => event.altKey && isLiveItem(n) ? showReference(n) : selectNote(n)}
      >
        {isBoard(n) ? <AnimatedIcon kind="board" size={26} /> : <AnimatedIcon kind="note" size={26} />}
        <span>
          <span className="note-name">{n.pinned && <PushPin size={13} aria-label="Pinned" />} {n.title || "Untitled"}</span>
          {query.trim() ? <span className="note-preview search-excerpt">{(() => { const excerpt = matchingExcerpt(noteSummary(n).text, query); return <>{excerpt.before}<mark>{excerpt.match}</mark>{excerpt.after}</>; })()}</span> : rowDensity === 'comfortable' && (
            <span className="note-preview">
              {notePreview(n) || (isBoard(n) ? 'Board' : 'Start writing…')}
            </span>
          )}
        </span>
      </button>
      {isLiveItem(n) && <button className="reference-note" aria-label={`Show ${n.title || 'Untitled'} as reference`}
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
          {!n.archived && !n.deletedAt && <button onClick={() => togglePin(n)}><PushPin size={18} />{n.pinned ? "Unpin item" : "Pin item"}</button>}
          {!isBoard(n) && <button onClick={() => { selectNote(n); openFind(n); }}>Find in note</button>}
          {n.deletedAt && <button onClick={() => restoreFromTrash(n)}><AnimatedIcon kind="undo" size={18} />Restore item</button>}
          {!n.archived && !n.deletedAt && (
            <button
              onClick={() => showReference(n)}
            >
              <AnimatedIcon kind="reference" size={18} />
              Show as reference
            </button>
          )}
          {!n.deletedAt && <button onClick={() => void openHistory(n)}>Version history</button>}
          <button className="danger-text" onClick={() => n.deletedAt ? confirmDelete(n) : moveToTrash(n)}>
            <Trash size={18} />
            {n.deletedAt ? "Delete permanently" : "Move to Trash"}
          </button>
        </ActionPopover>
      )}
    </div>
  );
  const count = (id: string | null) =>
    workspace?.notes.filter((n) => n.folderId === id && isLiveItem(n)).length ||
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
            <button className={`pill dictionary-toggle ${dictionary && reference && !focus ? "selected" : ""}`}
              aria-label="Dictionary" aria-pressed={dictionary && reference && !focus} aria-controls="reference-panel"
              title="Dictionary · Select a word to look it up" onMouseDown={preserveDocumentFocus}
              onClick={() => dictionary && reference && !focus ? closeDictionary() : openDictionary()}>
              <BookOpen size={21} /><span>Dictionary</span>
            </button>
            <button
              className={`pill ${reference && !dictionary && !focus ? "selected" : ""}`}
              aria-label="Reference"
              title="Reference (Ctrl+Shift+R)"
              aria-pressed={reference && !dictionary && !focus}
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
              <AnimatedIcon kind={workspace.theme === 'notebook' ? 'reference' : workspace.theme === 'system' ? 'system' : dark ? 'moon' : 'sun'} size={21} />
            </button>
            {chromeMenu === 'theme' && <ActionPopover anchor={themeAnchor.current} label="Appearance" className="theme-dropdown" onClose={() => setChromeMenu(null)}>
              {(['light', 'dark', 'system', 'notebook'] as const).map(theme => <button key={theme} aria-pressed={workspace.theme === theme}
                onClick={() => { update(w => ({ ...w, theme })); setChromeMenu(null); }}>
                <AnimatedIcon kind={theme === 'notebook' ? 'reference' : theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'system'} size={18} />
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
          className={`workspace ${sidebar && !focus ? "with-sidebar" : ""} ${reference && !focus ? "with-reference" : ""} ${dictionary ? "dictionary-layout" : ""}`}
        >
          {(fileDrop.target || importing) && (
            <div className="file-drop-hint" role="status" aria-live="polite">
              <UploadSimple size={22} />
              <span>{importing ? importLabel : fileDrop.target?.note ? "Drop images into this note" : `Drop files into ${workspace.folders.find((f) => f.id === fileDrop.target?.folder)?.name || "Unfiled notes"}`}
                <small>Large text &amp; code use a section viewer · Images up to 5 MiB</small>
              </span>
            </div>
          )}
          <aside
            id="notes-sidebar"
            className={`sidebar panel density-${rowDensity}`}
            aria-label="Notes navigation"
            inert={!sidebar || focus}
          >
            <div className="sidebar-create" role="group" aria-label="Create in current folder">
              <div className="new-note-group">
              <button
                className="primary new-note"
                title="New note (Ctrl+N)"
                onClick={() => createNote(active?.folderId ?? null)}
              >
                <AnimatedIcon kind="add" size={24} />
                <span>New note</span>
              </button>
              <button ref={createAnchor} className="primary new-note-options" aria-label="New note options" title="New note options" aria-haspopup="dialog" aria-expanded={sidebarMenu === "create"} onClick={() => setSidebarMenu(value => value === "create" ? null : "create")}><CaretDown size={18} /></button>
              </div>
              {sidebarMenu === "create" && <ActionPopover anchor={createAnchor.current} label="New note options" className="folder-dropdown" onClose={() => setSidebarMenu(null)}>
                <button onClick={() => openTemplates("choose")}><FileText size={18} />New from template…</button>
                <button onClick={() => openTemplates("manage")}>Manage templates…</button>
              </ActionPopover>}
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
              <AppSelect className="sort-picker" label="Sort items" value={notebookView.sort} onChange={sort => changeNotebookView({ sort: sort as NotebookView['sort'] })}
                options={[{ value: 'manual', label: 'Manual' }, { value: 'updated', label: 'Modified' }, { value: 'title', label: 'A–Z' }]} />
              <button aria-label="Compact note rows" aria-pressed={rowDensity === 'compact'} title={rowDensity === 'compact' ? 'Compact rows · switch to comfortable rows' : 'Comfortable rows · switch to compact rows'}
                onClick={() => changeNotebookView({ density: rowDensity === 'compact' ? 'comfortable' : 'compact' })}>
                <AnimatedIcon kind="list" size={18} />
              </button>
            </div>
            {(notebookView.sort !== 'manual' || notebookView.filter !== 'all') && <p className="navigation-hint">Use All items and Manual order to reorder notes.</p>}
            <p id="sidebar-drag-help" className="sr-only">
              Drag folders to reorder. Drag notes between notes or onto a folder to move them. Drop a note or folder on Trash to keep it there until restored or cleared.
              Use Alt plus Up or Down to reorder; on notes, Alt plus Shift plus Up or Down changes folder.
            </p>
            <div className="sr-only" role="status" aria-live="polite">{sidebarAnnouncement}</div>
            <div className="sidebar-scroll"
              onDragOverCapture={sidebarDrag.scrollOnDrag}
              onDragLeave={sidebarDrag.leaveScroll}
            >
              <div className="section-label">
                <span>
                  {view === "trash" ? "Trash"
                    : query
                      ? "Search results"
                      : "Folders"}
                </span>
                <div className="section-actions">
                {view !== "trash" && (
                  <button
                    className="icon-button"
                    aria-label="New folder"
                    onClick={() => editFolder()}
                  >
                    <AnimatedIcon kind="folderAdd" size={25} />
                  </button>
                )}
                <button ref={notebookAnchor} className="icon-button" aria-label="Notebook navigation" title="Notebook navigation" aria-haspopup="dialog" aria-expanded={sidebarMenu === "notebook"} onClick={() => setSidebarMenu(value => value === "notebook" ? null : "notebook")}><AnimatedIcon kind="options" size={21} /></button>
                </div>
              </div>
              {sidebarMenu === "notebook" && <ActionPopover anchor={notebookAnchor.current} label="Notebook navigation" className="notebook-menu" onClose={() => setSidebarMenu(null)}>
                <button onClick={() => { setView("notes"); setQuery(""); setSidebarMenu(null); }}>All folders</button>
                <button data-file-folder="" className={`${view === "unfiled" ? "nav-active" : ""}${sidebarDrag.dropClass("folder", null)}`} {...sidebarDrag.dropProps({ kind: "folder", id: null })} onClick={() => {
                  setView("unfiled"); setQuery(""); setSidebarMenu(null);
                  const note = workspace.notes.find(note => !note.folderId && isLiveItem(note));
                  if (note) selectNote(note, false);
                  setView("unfiled");
                }}><FileText size={18} /><span>Unfiled notes</span>{count(null) > 0 && <span className="nav-count">{count(null)}</span>}</button>

                <button className="shortcut-heading" aria-expanded={pinsExpanded} onClick={() => setPinsExpanded(value => !value)}><PushPin size={18} /><span>Pinned</span><CaretDown size={14} className={pinsExpanded ? "" : "collapsed-caret"} /></button>
                {pinsExpanded && <div className="notebook-shortcuts" aria-label="Pinned items">
                  {workspace.notes.some(note => note.pinned && isLiveItem(note)) ? workspace.notes.filter(note => note.pinned && isLiveItem(note)).map(note => <button key={note.id} className="shortcut-select" aria-current={active?.id === note.id ? "page" : undefined} onClick={() => { setQuery(""); selectNote(note, false); }}>{isBoard(note) ? <AnimatedIcon kind="board" size={18} /> : <FileText size={18} />}<span>{note.title || "Untitled"}</span></button>) : <p className="shortcut-empty">Pin items from their options menu.</p>}
                </div>}
                <button className="shortcut-heading" aria-expanded={recentExpanded} onClick={() => setRecentExpanded(value => !value)}><ClockCounterClockwise size={18} /><span>Recently opened</span><CaretDown size={14} className={recentExpanded ? "" : "collapsed-caret"} /></button>
                {recentExpanded && <div className="notebook-shortcuts" aria-label="Recently opened items">
                  {(workspace.recentIds || []).map(id => workspace.notes.find(note => note.id === id && isLiveItem(note))).filter((note): note is Note => !!note).map(note => <button key={note.id} className="shortcut-select" aria-current={active?.id === note.id ? "page" : undefined} onClick={() => { setQuery(""); selectNote(note, false); }}>{isBoard(note) ? <AnimatedIcon kind="board" size={18} /> : <FileText size={18} />}<span>{note.title || "Untitled"}</span></button>)}
                  {!(workspace.recentIds || []).some(id => workspace.notes.some(note => note.id === id && isLiveItem(note))) && <p className="shortcut-empty">Open a note to find it here.</p>}
                </div>}
              </ActionPopover>}
              {(view === "unfiled" || view === "trash") && <div className="sidebar-location"><span>{view === "unfiled" ? "Unfiled notes" : "Trash"}</span><button onClick={() => { setView("notes"); setQuery(""); }}>All folders</button></div>}
              {view === "trash" ? (
                <div className="loose-notes">
                  <p className="empty-search">Restore items anytime, or clear Trash to delete them permanently.</p>
                  <button className="danger-text" disabled={!workspace.notes.some(note => note.deletedAt) && !workspace.folders.some(folder => folder.deletedAt)} onClick={() => setModal({ kind: "emptyTrash" })}>Clear Trash…</button>
                  {workspace.folders.filter(folder => folder.deletedAt).map(folder => <div className="trash-folder" key={folder.id}>
                    <div className="trash-folder-heading"><AnimatedIcon kind="folder" size={20} /><span>{folder.name}</span><button onClick={() => restoreFolder(folder.id)}>Restore folder</button></div>
                    {workspace.notes.filter(note => note.folderId === folder.id && note.deletedAt && matches(note)).map(renderNote)}
                  </div>)}
                  {workspace.notes.filter(note => note.deletedAt && !workspace.folders.some(folder => folder.id === note.folderId && folder.deletedAt) && matches(note)).map(renderNote)}
                  {!workspace.notes.some(note => note.deletedAt && matches(note)) && !workspace.folders.some(folder => folder.deletedAt) && <p className="empty-search">{query ? "No Trash items match your search." : "Trash is empty."}</p>}
                </div>
              ) : query ? (
                <div className="search-results">
                  {orderNotes(workspace.notes.filter(visible), notebookView.sort).map(renderNote)}
                  {!workspace.notes.some(visible) && (
                    <p className="empty-search">No notes match “{query}”.</p>
                  )}
                </div>
              ) : (
                workspace.folders.filter(folder => !folder.deletedAt).map((folder) => (
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
                            <button onClick={() => openTemplates("choose",folder.id)}>New note from template…</button>
                            <button onClick={() => openFormattedExport(folder.id,true)}><AnimatedIcon kind="download" size={18} />Export notes…</button>
                            <span className="menu-label">DEFAULT NOTE TEMPLATE</span>
                            <AppSelect label="Default note template" value={folder.templateId || ""} options={[{ value:"",label:"None" },...workspace.notes.filter(isTemplate).map(note => ({ value:note.id,label:note.title }))]} onChange={value => { update(w => ({ ...w,folders:w.folders.map(f => f.id === folder.id ? { ...f,templateId:value || undefined } : f) })); setFolderMenu(null); }} />
                            {folder.templateId && <span className="menu-label">Template takes priority over Copy last note.</span>}
                            <button disabled={importing} onClick={() => chooseImport(folder.id)}>
                              <AnimatedIcon kind="upload" size={18} />
                              Import files…
                            </button>
                            <button disabled={importing} onClick={() => chooseNotepadImport(folder.id)}>
                              <AnimatedIcon kind="upload" size={18} />Import from Windows Notepad…
                            </button>
                            <button disabled={importing} onClick={() => chooseNotepadImport(folder.id, "notepadPlus")}>
                              <AnimatedIcon kind="upload" size={18} />Import from Notepad++…
                            </button>
                            <button
                              className="folder-copy-option"
                              aria-pressed={!!folder.copyLastNote}
                              aria-label="Copy last note"
                              title="New notes copy the most recently created active note in this folder, including formatting and checklist states."
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
                            <button className="danger-text" onClick={() => moveFolderToTrash(folder.id)}><Trash size={18} />Move folder to Trash</button>
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
              {view !== 'trash' && !query.trim() && notebookView.filter !== 'all' && !workspace.notes.some(visible) &&
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
            {sidebarDrag.dragging?.kind === "note" && <div className="sidebar-location">
              <button data-file-folder="" className={sidebarDrag.dropClass("folder", null)} {...sidebarDrag.dropProps({ kind: "folder", id: null })} onClick={() => { setView("unfiled"); setQuery(""); }}><FileText size={18} />Unfiled notes</button>
            </div>}
            <nav className="sidebar-bottom">
              <button
                className={`trash-target${view === "trash" ? " nav-active" : ""}${sidebarDrag.dropClass("trash", null)}`}
                {...sidebarDrag.dropProps({ kind: "trash", id: null })}
                onClick={openTrash}
                title={sidebarDrag.dragging ? "Drop to move to Trash" : "Trash"}
                aria-label="Trash"
                onContextMenu={e => { e.preventDefault(); openTrash(); }}
              >
                <TrashIcon open={sidebarDrag.dragging !== null} />
                <span>{sidebarDrag.trashHovered ? "Drop into Trash" : "Trash"}</span>
                {(workspace.notes.filter(note => note.deletedAt).length + workspace.folders.filter(folder => folder.deletedAt).length) > 0 && <span className="nav-count">{workspace.notes.filter(note => note.deletedAt).length + workspace.folders.filter(folder => folder.deletedAt).length}</span>}
              </button>
              <button aria-label="Settings" onClick={() => setModal({ kind: "settings" })}>
                <AnimatedIcon kind="settings" size={26} />
                <span>Settings</span>
              </button>
            </nav>
          </aside>
          <PanelResize panel="sidebar" visible={sidebar && !focus} layoutKey={`${reference && !focus}-${appearance.elementSize}`} />
          {workspace.theme === 'notebook' && sidebar && !focus && <div className="notebook-binding" aria-hidden="true" />}
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
                        readOnly={!!active.deletedAt || active.archived}
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
                            {!active.archived && !active.deletedAt && <button onClick={() => togglePin(active)}><PushPin size={18} />{active.pinned ? "Unpin item" : "Pin item"}</button>}
                            {!isBoard(active) && <button onClick={() => openFind(active)}>Find in note</button>}
                            {!isBoard(active) && <button onClick={() => openFormattedExport(active.id)}><AnimatedIcon kind="download" size={18} />Export formatted…</button>}
                            {!isBoard(active) && !active.archived && !active.deletedAt && <button onClick={() => openTemplates("save")}>Save as template…</button>}
                            {!active.deletedAt && <><span className="menu-label">MOVE TO FOLDER</span>
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
                              options={[{ value: "", label: "Unfiled notes" }, ...workspace.folders.filter(folder => !folder.deletedAt).map((folder) => ({ value: folder.id, label: folder.name }))]} /></>}
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
                            {active.deletedAt && <button onClick={() => restoreFromTrash(active)}><AnimatedIcon kind="undo" size={18} />Restore item</button>}
                            <button className="danger-text" onClick={() => active.deletedAt ? confirmDelete(active) : moveToTrash(active)}><Trash size={18} />{active.deletedAt ? "Delete permanently" : "Move to Trash"}</button>
                            {!active.deletedAt && <button onClick={() => void openHistory(active)}>Version history</button>}
                          </ActionPopover>
                      )}
                    </div>
                  </div>
                  {(active.archived || active.deletedAt) && (
                    <div className="trash-banner">
                      <Trash size={18} />
                      <span>This {isBoard(active) ? "board" : "note"} is in Trash.</span>
                      <button onClick={() => restoreFromTrash(active)}>
                        <AnimatedIcon kind="undo" size={16} />
                        {active.deletedAt ? "Restore item" : `Restore ${isBoard(active) ? "board" : "note"}`}
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
                  {isBoard(active) ? <BoardBoundary key={active.id} board={active.board}><Suspense fallback={<div className="board-loading" role="status">Opening drawing tools…</div>}><BoardEditor id={active.id} title={active.title} board={active.board} dark={dark} notebook={workspace.theme === "notebook"} readOnly={active.archived || !!active.deletedAt} focusMode={focus} controlsHost={boardControlsHost} searchTarget={boardSearch?.id === active.id ? boardSearch : undefined} checkpoint={checkpoint} registerDraft={registerBoardDraft} onDirty={boardChanged} onShowTools={() => setFocusTools(true)} onCreateBoard={(mode) => setBoardCreation(mode)} onLinkRequest={requestLink} onLinkReady={fn => { insertItemLink.current = fn; }} onItemLink={openLinkedItem} onExternalLink={openExternalLink} /></Suspense></BoardBoundary> : <NoteEditor
                    key={active.id}
                    content={active.content}
                    onWordSelected={word => { if (!focus) openDictionary(word); }}
                    onDictionaryReplaceReady={replace => { replaceDictionaryWord.current = replace; }}
                    findRequest={findFor?.id === active.id ? findFor : undefined}
                    onFindOpen={() => { if (window.matchMedia("(max-width: 1050px)").matches) setReference(false); }}
                    onLinkRequest={requestLink}
                    onLinkReady={fn => { insertItemLink.current = fn; }}
                    onItemLink={activateLink} onExternalLink={openExternalLink}
                    readOnly={active.archived || !!active.deletedAt}
                    onChange={(html) => patchNote(active.id, { content: html })}
                    onImagesReady={(fn) => { insertImages.current = fn; }}
                    onAppendReady={(fn) => {
                      append.current = fn;
                    }}
                  />}
                  {backlinks(workspace.notes,active.id).length > 0 && <details className="item-backlinks"><summary>Backlinks ({backlinks(workspace.notes,active.id).length})</summary><div aria-label="Backlinks">{backlinks(workspace.notes,active.id).map(note => <div key={note.id}><button onClick={() => openLinkedItem(note.id)}>{note.title || "Untitled"}{note.deletedAt ? " · In Trash" : ""}</button><button disabled={!isLiveItem(note)} aria-label={`Open ${note.title} in Reference`} onClick={() => openLinkedItem(note.id,true)}><BookOpen size={17} /></button></div>)}{!backlinks(workspace.notes,active.id).length && <p>No other notes or boards link here yet.</p>}</div></details>}
                  {checkedCount > 0 && !active.deletedAt && !active.archived && (
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
                    <button onClick={() => { setChromeMenu(null); openFormattedExport(active.id, false, exportAnchor.current); }}>This note · PDF, HTML or Markdown…</button>
                    <button disabled={backupBusy} onClick={() => { void exportBackup(); setChromeMenu(null); }}>Full notebook backup</button>
                  </ActionPopover>}
                </footer>}
              </>
            ) : (
              <div className="empty-document">
                <FileText size={46} />
                <h1>
                  {view === "trash"
                    ? "Your Trash is empty."
                    : "A little space to think."}
                </h1>
                <p>
                  {view === "trash"
                    ? "Items in Trash can be restored anytime until you clear it."
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
            aria-label={dictionary ? "Dictionary panel" : "Reference panel"}
            onKeyDown={event => { if (dictionary && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDictionary(); } }}
            inert={!reference || focus}
          >
            <div className="reference-label">
              <div className="reference-modes"><button aria-pressed={!dictionary} onMouseDown={preserveDocumentFocus} onClick={() => setDictionary(false)}>Reference</button><button aria-pressed={dictionary} onMouseDown={preserveDocumentFocus} onClick={() => { setDictionary(true); }}>Dictionary</button></div>
              <button
                className="icon-button"
                aria-label={dictionary ? "Close dictionary" : "Close reference"}
                onClick={() => { if (dictionary) { closeDictionary(); return; } moveFocusFromPanels(".reference-panel", 'button[aria-label="Reference"]'); setReference(false); }}
              >
                <AnimatedIcon kind="close" size={21} />
              </button>
            </div>
            {dictionary ? <DictionaryPanel word={dictionaryTerm} onWord={word => setDictionaryTerm(word)} onRelatedWord={word => { replaceDictionaryWord.current(word, dictionaryTerm); setDictionaryTerm(word); }} onExternalLink={openExternalLink} /> : <>
            <AppSelect
              className="reference-picker"
              label="Reference note or board"
              value={workspace.referenceId || ""}
              onChange={(value) =>
                update((w) => ({ ...w, referenceId: value || null }))
              }
              options={[{ value: "", label: "Choose a reference…" }, ...workspace.notes.filter(isLiveItem).map((note) => ({ value: note.id, label: `${isBoard(note) ? "Board · " : ""}${note.title || "Untitled"}` }))]} />
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
                    onItemLink={activateLink} onExternalLink={openExternalLink}
                  />}
                </div>
                {!isBoard(referenceNote) && <button
                  className="copy-reference"
                  disabled={!active || active.archived || !!active.deletedAt || isBoard(active) || active.id === referenceNote.id}
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
                  {workspace.notes.filter(isLiveItem).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(note =>
                    <button key={note.id} onMouseDown={preserveDocumentFocus} onClick={() => showReference(note)}>
                      <AnimatedIcon kind={isBoard(note) ? 'board' : 'note'} size={20} /><span>{note.title || 'Untitled'}</span>
                    </button>)}
                  {!workspace.notes.some(isLiveItem) && <p>Create a note or board to keep it here.</p>}
                </div>
              </div>
            )}
            </>}
          </aside>
        </div>
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )}
        {boardCreation && <BoardBoundary onClose={() => setBoardCreation(null)}><Suspense fallback={<div role="status" className="toast">Opening board import…</div>}><CreateBoardDialog mode={boardCreation} dark={dark} returnFocus={() => document.getElementById('board-insert-trigger')} onClose={() => setBoardCreation(null)} onCreate={(title: string, board: BoardData) => createBoard(active?.folderId ?? null, title, board, true)} /></Suspense></BoardBoundary>}
        {notepadImport && <NotepadImportDialog workspace={workspace} folderId={notepadImport.folderId} source={notepadImport.source} onClose={() => setNotepadImport(null)} returnFocus={() => notepadImport.returnTo}
          onImport={importNotepadTabs} onImportFiles={() => { setNotepadImport(null); chooseImport(notepadImport.folderId); }} />}
        {historyId && workspace.notes.find(note => note.id === historyId) && <HistoryDialog item={workspace.notes.find(note => note.id === historyId)!} dark={dark} onClose={() => { historyGeneration.current++; setHistoryId(null); }} onRestore={async version => {
          const generation = historyGeneration.current; await flush();
          const before = checkpoint(), current = before?.notes.find(note => note.id === historyId);
          if (!current || current.deletedAt) throw Error("This item is no longer available for restoration.");
          await checkpointHistory(current,savedRevision());
          if (generation !== historyGeneration.current) return;
          if (checkpoint() !== before) throw Error("The notebook changed. Reopen history before restoring.");
          const next = historyRestoration(before!,historyId,version);
          if (!update(() => next)) throw Error("This version could not be adopted.");
          try { await flush(); } catch (reason) { if (checkpoint() === next) update(() => before!); throw reason; }
          setHistoryId(null); notify("Version restored. The previous content remains in history.");
        }} />}
        {restorePreview && <BackupRestoreDialog backup={restorePreview} onClose={() => { restoreGeneration.current++; setRestorePreview(null); }} onRestore={restoreNotebook} />}
        {linkPicker && <ItemLinkPicker notes={workspace.notes} onClose={closeLinkPicker} onInsert={note => { const pending = linkPicker; setLinkPicker(null); pending.insert(note); }} onOpen={(id,reference) => { closeLinkPicker(); openLinkedItem(id,reference); }} />}
        {linkAction && (() => { const target = workspace.notes.find(note => note.id === linkAction.id && !isTemplate(note)); const close = () => { const restore = linkAction.restore; setLinkAction(null); restore(); }; return <ActionPopover anchor={linkAction.anchor} label="Item link options" className="note-dropdown" onClose={close}><span className="menu-label">{target?.title || "Missing item"}{target?.deletedAt ? " · In Trash" : ""}</span><button disabled={!target} onClick={() => { const id = linkAction.id; setLinkAction(null); openLinkedItem(id); }}>Open</button><button disabled={!target || !isLiveItem(target)} onClick={() => { const id = linkAction.id; close(); openLinkedItem(id,true); }}>Open in Reference</button>{(!target || !isLiveItem(target)) && <span className="menu-label">{target ? "Restore before opening in Reference." : "Target unavailable. The link is retained."}</span>}</ActionPopover>; })()}
        {templatesDialog && <TemplateDialog mode={templatesDialog.mode} source={templatesDialog.source} notes={workspace.notes} onClose={() => setTemplatesDialog(null)} onSave={saveTemplate} onDelete={id => { update(w => removeTemplate(w,id)); notify("Template deleted. Existing notes are unchanged."); }} onCreate={(id,title,reset) => { createNote(templatesDialog.folderId,undefined,undefined,undefined,{ id,title,reset }); setTemplatesDialog(null); }} />}
        {formattedExport && <Suspense fallback={<div role="status" className="toast">Opening export…</div>}><ExportDialog notes={formattedExport.notes} scope={formattedExport.scope} returnFocus={() => formattedExport.returnTo} onClose={() => setFormattedExport(null)} onNotice={notify} /></Suspense>}
        {captureOpen && <Dialog title="Quick capture" className="workflow-dialog quick-capture-dialog" returnFocus={() => captureReturnTo.current}
          initialFocus={() => document.getElementById("capture-text")} onClose={() => window.dispatchEvent(new Event("quick-capture-close"))}>
          <QuickCapture browser onClose={() => setCaptureOpen(false)} onSaved={(id, openAfterSave) => { if (openAfterSave) captureOpenHandler.current(id); }} />
        </Dialog>}
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
                  : modal.kind === "emptyTrash" ? "Clear Trash permanently?"
                    : `Delete this ${isBoard(workspace.notes.find(note => note.id === modal.id)) ? "board" : "note"} permanently?`
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
                startupExtras={<QuickCaptureSettings onOpen={openCapture} />}
                appearanceExtras={<button className="notepad-settings-import" onClick={() => openTemplates("manage")}>Manage note templates…</button>}
                backupExtras={<>
                  <button className="notepad-settings-import" disabled={importing} onClick={() => chooseNotepadImport(null)}>
                    <AnimatedIcon kind="upload" size={21} />Import from Windows Notepad…
                  </button>
                  <button className="notepad-settings-import" disabled={importing} onClick={() => chooseNotepadImport(null, "notepadPlus")}>
                    <AnimatedIcon kind="upload" size={21} />Import from Notepad++…
                  </button>
                  <BackupSettings config={backups.config} busy={backups.busy} error={backups.error}
                    onEnable={enabled => { void backups.enable(enabled).catch(reason => notify(String(reason))); }}
                    onChoose={() => { void backups.choose().catch(reason => notify(String(reason))); }}
                    onBackup={() => { void backups.run().then(() => notify("Notebook backup saved.")).catch(reason => notify(String(reason))); }}
                    onPreview={entry => { void previewBackup(entry); }} onFile={file => { void previewBackup(file); }}
                    onDownload={entry => { void readBackup(entry).then(blob => exportArtifact(`Scribly-backup-${entry.time.slice(0,10)}.scribly`,blob,"application/zip")).catch(reason => notify(String(reason))); }} />
                </>}
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
                  {modal.kind === "emptyTrash" ? "All items and folders in Trash and their retained version history will be permanently removed. Recovery files and attachments are reclaimed conservatively. Existing portable backups remain available. This cannot be undone."
                    : `“${workspace.notes.find((n) => n.id === modal.id)?.title || "Untitled"}” will be permanently removed. This cannot be undone. You can export a backup first in Settings.`}
                </p>
                <div className="dialog-actions">
                  <button onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      if (modal.kind === "delete" || modal.kind === "emptyTrash") {
                        if (!update(w => {
                          if (modal.kind === "emptyTrash") return { ...purgeTrash(w), activeId: view === "trash" ? "" : w.activeId };
                          const item = w.notes.find(note => note.id === modal.id);
                          if (!item) return w;
                          const next = purgeTrash(trashItem(w, item.id), item.id);
                          if (w.activeId !== item.id) return next;
                          const eligible = next.notes.filter(note => matches(note) && (view === "trash" ? !!note.deletedAt : isLiveItem(note) && (view !== "unfiled" || note.folderId === null)));
                          return { ...next, activeId: eligible.find(note => note.folderId === item.folderId)?.id || eligible[0]?.id || "" };
                        })) return;
                        notify("Permanently deleted. Saving…");
                      }
                      setModal(null);
                    }}
                  >
                    {modal.kind === "emptyTrash" ? "Clear Trash"
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

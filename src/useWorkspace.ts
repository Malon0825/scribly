import { useCallback, useEffect, useRef, useState } from "react";
import { initialWorkspace } from "./seed";
import { loadWorkspace, saveWorkspace } from "./storage";
import { isBoard, type Note, type Workspace } from "./types";
import { validateBoard, type BoardData } from "./boardData";
import { RecoveryJournal, LEGACY_RECOVERY_KEY as DRAFT } from "./recovery";
import { RecoveryStorage } from "./recoveryStorage";
import { validateWorkspace } from "./workspaceValidation";
import { attachmentSchema, compactImages, pruneAttachments } from "./attachments";
import { normalizeNavigation, recordOpened } from "./itemNavigation";
import { migrateArchiveToTrash } from "./trash";
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const [error, setError] = useState("");
  const openingWarning = useRef("");
  const [dataPath, setDataPath] = useState("");
  const latest = useRef<Workspace | null>(null),
    persisted = useRef<Workspace | null>(null);
  const revision = useRef(0),
    queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const recoveryJournal = useRef<RecoveryJournal | null>(null);
  const recoveryStore = useRef<RecoveryStorage | null>(null);
  const canClearLegacy = useRef(true);
  const boardDrafts = useRef(new Map<string, (force?: boolean) => BoardData | null>());
  const pending = useRef(false);
  const checkpoint = useCallback((force = true) => {
    let next = latest.current;
    if (!next) return null;
    let captured = false;
    try {
      for (const [id, read] of boardDrafts.current) {
        const board = read(force);
        if (!board) continue;
        captured = true;
        const note: Note | undefined = next.notes.find((n) => n.id === id && isBoard(n));
        if (!note || note.board === board) continue;
        validateBoard(board);
        next = { ...next, schemaVersion: next.schemaVersion || 2, notes: next.notes.map((n) => n.id === id && isBoard(n)
          ? { ...n, board, updatedAt: new Date().toISOString() } : n) };
      }
      if (next !== latest.current) {
        latest.current = next;
        try { recoveryJournal.current?.write(next, revision.current, true); }
        catch { setError("Recovery storage is full. Keep this window open until the database save finishes."); }
        void recoveryStore.current?.flush().catch(() => { if (mounted.current) setError("Recovery storage could not be written. Keep this window open until saving finishes."); });
        setWorkspace(next);
      }
      if (captured) pending.current = false;
      return next;
    } catch (e) { setStatus("error"); setError(String(e)); throw e; }
  }, []);
  const registerBoardDraft = useCallback((id: string, read: (force?: boolean) => BoardData | null) => {
    boardDrafts.current.set(id, read);
    return () => { if (boardDrafts.current.get(id) === read) boardDrafts.current.delete(id); };
  }, []);
  const boardChanged = useCallback(() => { pending.current = true; setStatus("saving"); }, []);
  const flush = useCallback(async (force = true) => {
    checkpoint(force);
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        const snapshot = checkpoint(force);
        if (!snapshot) return;
        if (snapshot === persisted.current) {
          if (force && !pending.current) {
            try {
              recoveryJournal.current?.write(snapshot, revision.current, false);
              await recoveryStore.current?.flush();
              openingWarning.current = "";
              if (mounted.current) { setStatus("saved"); setError(""); }
            } catch {
              if (mounted.current) setError("Notes are saved. Recovery storage could not be refreshed.");
            }
          }
          return;
        }
        if (mounted.current) setStatus("saving");
        try {
          revision.current = await saveWorkspace(snapshot, revision.current);
          persisted.current = snapshot;
          // Rebase recovery after an acknowledged save, including edits made
          // while that save was in flight. A clean journal is a reusable cache.
          let recoveryWarning = "";
          try {
            if (latest.current) recoveryJournal.current?.write(latest.current, revision.current, latest.current !== snapshot);
            await recoveryStore.current?.flush();
            if (canClearLegacy.current) localStorage.removeItem(DRAFT);
          } catch {
            // The database acknowledgement is still valid. Keep recovery
            // artifacts intact and continue saving any newer edits.
            recoveryWarning = latest.current === snapshot
              ? "Notes are saved. Recovery storage could not be refreshed."
              : "Recovery storage could not be refreshed. Keep this window open until saving finishes.";
          }
          if (mounted.current) {
            setStatus(latest.current === snapshot && !pending.current ? "saved" : "saving");
            if (force) openingWarning.current = "";
            setError(recoveryWarning || openingWarning.current);
          }
        } catch (e) {
          if (mounted.current) {
            setStatus("error");
            setError(String(e));
          }
          throw e;
        }
      });
    queue.current = operation;
    return operation;
  }, [checkpoint]);
  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setStatus("loading");
    setError("");
    openingWarning.current = "";
    const warn = (message: string) => { openingWarning.current = message; setError(message); };
    try {
      const loaded = await loadWorkspace();
      if (!mounted.current || generation !== loadGeneration.current) return;
      if (!Number.isSafeInteger(loaded.revision) || loaded.revision < 0) throw Error("Invalid notebook revision.");
      if (loaded.document !== null) validateWorkspace(loaded.document);
      revision.current = loaded.revision;
      setDataPath(loaded.dataPath);
      let doc = loaded.document;
      persisted.current = doc;
      canClearLegacy.current = true;
      let recovery: string | null = null;
      try { recovery = localStorage.getItem(DRAFT); }
      catch { warn("Recovery storage is unavailable. The saved notebook is open."); }
      if (recovery) {
        try {
          const draft = JSON.parse(recovery);
          validateWorkspace(draft.document);
          if (draft.revision === loaded.revision) doc = draft.document;
          else if (draft.document) {
            localStorage.setItem(`${DRAFT}-conflict-${Date.now()}`, recovery);
            warn(
              "A previous draft is kept in recovery storage. The latest database copy is open.",
            );
          }
        } catch {
          try { localStorage.setItem(`${DRAFT}-conflict-${crypto.randomUUID()}`, recovery); }
          catch { canClearLegacy.current = false; }
          warn("A damaged or unsupported draft is kept in recovery storage. The saved notebook is open.");
        }
      }
      recoveryJournal.current = null;
      try {
        recoveryStore.current = await RecoveryStorage.open();
        recoveryJournal.current = new RecoveryJournal(recoveryStore.current);
        const restored = recoveryJournal.current.restore(doc, loaded.revision);
        doc = restored.document;
        if (restored.warning) warn(restored.warning);
      } catch {
        warn("A damaged draft is kept in recovery storage. The latest database copy is open.");
      }
      const restored = recordOpened(migrateArchiveToTrash(attachmentSchema(await compactImages(doc || initialWorkspace()))));
      validateWorkspace(restored);
      if (!mounted.current || generation !== loadGeneration.current) return;
      latest.current = restored;
      setWorkspace(latest.current);
      setStatus(restored === persisted.current ? "saved" : "saving");
      void pruneAttachments(restored);
    } catch (e) {
      if (!mounted.current || generation !== loadGeneration.current) return;
      setStatus("error");
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      loadGeneration.current++;
    };
  }, [reload]);
  const update = useCallback((updater: (w: Workspace) => Workspace) => {
    const current = checkpoint();
    if (!current) return;
    let next = normalizeNavigation(migrateArchiveToTrash(attachmentSchema(updater(current))));
    if (next.activeId !== current.activeId || !current.notes.some(note => note.id === next.activeId && !note.archived && !note.deletedAt)) next = recordOpened(next);
    if (next === latest.current) return;
    try {
      recoveryJournal.current?.write(next, revision.current, true);
    } catch {
      setError(
        "Recovery storage is full. Keep this window open until the database save finishes.",
      );
    }
    void recoveryStore.current?.flush().catch(() => { if (mounted.current) setError("Recovery storage could not be written. Keep this window open until saving finishes."); });
    latest.current = next;
    setWorkspace(next);
    setStatus("saving");
  }, [checkpoint]);
  useEffect(() => {
    if (!workspace) return;
    const timer = setTimeout(() => void flush(false).catch(() => {}), 450);
    return () => clearTimeout(timer);
  }, [workspace, flush]);
  useEffect(() => {
    const save = () => void flush().catch(() => {});
    const interval = setInterval(() => void flush(false).catch(() => {}), 5000);
    window.addEventListener("blur", save);
    const before = (e: BeforeUnloadEvent) => {
      try { checkpoint(); } catch { /* Keep the live draft and prevent close. */ }
      if (latest.current !== persisted.current || pending.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      clearInterval(interval);
      window.removeEventListener("blur", save);
      window.removeEventListener("beforeunload", before);
    };
  }, [flush, checkpoint]);
  return { workspace, update, status, error, dataPath, flush, reload, checkpoint, registerBoardDraft, boardChanged, savedRevision: () => revision.current };
}

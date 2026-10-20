import { useCallback, useEffect, useRef, useState } from "react";
import { initialWorkspace } from "./seed";
import { desktop, loadWorkspace, saveWorkspace } from "./storage";
import { consumeConversationImports } from './localAI';
import { isBoard, type Note, type Workspace } from "./types";
import { validateBoard, type BoardData } from "./boardData";
import { RecoveryJournal, LEGACY_RECOVERY_KEY as DRAFT } from "./recovery";
import { RecoveryStorage } from "./recoveryStorage";
import { validateWorkspace } from "./workspaceValidation";
import { attachmentSchema, compactImages, pruneAttachments } from "./attachments";
import { normalizeNavigation, recordOpened } from "./itemNavigation";
import { migrateArchiveToTrash } from "./trash";
import { invoke } from '@tauri-apps/api/core';
export type IntegrationPrepared = { workspace: Workspace; result: Record<string, unknown>; applyEditor?: () => void };
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
  const integrationReceiptIds = useRef<string[]>([]);
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
        try { recoveryJournal.current?.write(next, revision.current, true, integrationReceiptIds.current); }
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
  const saveNow = useCallback(async (force = true) => {
        const snapshot = checkpoint(force);
        if (!snapshot) return;
        if (snapshot === persisted.current && !integrationReceiptIds.current.length) {
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
          const receipts = [...integrationReceiptIds.current];
          revision.current = await saveWorkspace(snapshot, revision.current, receipts);
          integrationReceiptIds.current = integrationReceiptIds.current.filter(id => !receipts.includes(id));
          const saved=desktop ? consumeConversationImports(snapshot,snapshot) : snapshot;
          persisted.current = saved;
          if(desktop && latest.current) {
            const next=latest.current===snapshot ? saved : consumeConversationImports(latest.current,snapshot);
            if(next!==latest.current) { latest.current=next; if(mounted.current)setWorkspace(next); }
          }
          // Rebase recovery after an acknowledged save, including edits made
          // while that save was in flight. A clean journal is a reusable cache.
          let recoveryWarning = "";
          try {
            if (latest.current) recoveryJournal.current?.write(latest.current, revision.current, latest.current !== saved, integrationReceiptIds.current);
            await recoveryStore.current?.flush();
            if (canClearLegacy.current) localStorage.removeItem(DRAFT);
          } catch {
            // The database acknowledgement is still valid. Keep recovery
            // artifacts intact and continue saving any newer edits.
            recoveryWarning = latest.current === saved
              ? "Notes are saved. Recovery storage could not be refreshed."
              : "Recovery storage could not be refreshed. Keep this window open until saving finishes.";
          }
          if (mounted.current) {
            setStatus(latest.current === saved && !pending.current ? "saved" : "saving");
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
  }, [checkpoint]);
  const flush = useCallback(async (force = true) => {
    checkpoint(force);
    const operation = queue.current.catch(() => {}).then(() => saveNow(force));
    queue.current = operation;
    return operation;
  }, [checkpoint, saveNow]);
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
      integrationReceiptIds.current = [];
      try {
        recoveryStore.current = await RecoveryStorage.open();
        recoveryJournal.current = new RecoveryJournal(recoveryStore.current);
        const restored = recoveryJournal.current.restore(doc, loaded.revision);
        doc = restored.document;
        integrationReceiptIds.current = desktop ? restored.integrationReceiptIds || [] : [];
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
      recoveryJournal.current?.write(next, revision.current, true, integrationReceiptIds.current);
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
  const enqueueIntegration = useCallback((request: { id: string; generation: string; operation?: { clientId: string; requestId: string; payloadHash: string } | null }, prepare: (workspace: Workspace) => Promise<IntegrationPrepared>) => {
    const operation = queue.current.catch(() => {}).then(async () => {
      if (!desktop || !mounted.current) throw Error('APP_NOT_READY: Open the desktop notebook first.');
      const receiptId = request.operation ? `${request.operation.clientId}:${request.operation.requestId}` : '';
      if (receiptId) {
        const previous = await invoke<{ status: string; result: Record<string, unknown>; payloadHash: string } | null>('integration_operation_status', { receiptId });
        if (previous && previous.payloadHash !== request.operation?.payloadHash) throw Error('REQUEST_ID_REUSED: This request_id was used for different arguments.');
        if (previous?.status === 'committed') return previous.result;
      }
      if (receiptId && integrationReceiptIds.current.includes(receiptId)) {
        await saveNow();
        const previous = await invoke<{ status: string; result: Record<string, unknown> } | null>('integration_operation_status', { receiptId });
        if (previous?.status === 'committed') return previous.result;
        throw Error('OUTCOME_UNKNOWN: Check the operation status before retrying.');
      }
      const before = checkpoint();
      if (!before) throw Error('APP_NOT_READY: Notebook is loading.');
      const staged = await prepare(before);
      if (!mounted.current || checkpoint() !== before) throw Error('VERSION_CONFLICT: Notebook changed while preparing the edit. Read the target again.');
      validateWorkspace(staged.workspace);
      const id = await invoke<string>('integration_stage', { id: request.id, generation: request.generation, result: staged.result });
      if (!mounted.current || checkpoint() !== before) throw Error('VERSION_CONFLICT: Notebook changed before the edit was applied. Read the target again.');
      if (integrationReceiptIds.current.length >= 32) throw Error('BUSY: Save pending edits before adding another command.');
      // The receipt IDs and changed document share the recovery manifest. A recovered
      // draft therefore commits the same native ledger row instead of replaying text.
      integrationReceiptIds.current.push(id);
      try {
        staged.applyEditor?.();
        update(() => staged.workspace);
      } catch (error) {
        integrationReceiptIds.current = integrationReceiptIds.current.filter(receipt => receipt !== id);
        throw error;
      }
      await saveNow();
      const saved = await invoke<{ status: string; result: Record<string, unknown> } | null>('integration_operation_status', { receiptId: id });
      if (saved?.status !== 'committed') throw Error('OUTCOME_UNKNOWN: Check the operation status before retrying.');
      return saved.result;
    });
    queue.current = operation.then(() => {}, () => {});
    return operation;
  }, [checkpoint, saveNow, update]);
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
  return { workspace, update, status, error, dataPath, flush, reload, checkpoint, registerBoardDraft, boardChanged, savedRevision: () => revision.current, enqueueIntegration, isDirty: () => latest.current !== persisted.current };
}

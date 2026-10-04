import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { desktop } from "./storage";
import {
  getCaptureStatus, writeCaptureDraft, submitCapture, retryCapture,
  subscribeCaptureStatus, hideCapture, openCapturedNote, type CaptureStatus,
} from "./captureService";
import "./quick-capture.css";

type Draft = { title: string; text: string };
const sameDraft = (a: Draft, b: Draft) => a.title === b.title && a.text === b.text;

export function QuickCapture({ onClose, onSaved, browser = false }: {
  onClose?: () => void;
  onSaved?: (id: string, openAfterSave: boolean) => void;
  browser?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>({ title: "", text: "" });
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const desired = useRef<Draft>({ title: "", text: "" });
  const persisted = useRef<Draft>({ title: "", text: "" });
  const write = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const statusRef = useRef<CaptureStatus | null>(null);
  const expected = useRef<{ id: string; openAfterSave: boolean } | null>(null);
  const submitted = useRef<{ previousSavedId: string | null; openAfterSave: boolean } | null>(null);
  const refreshGeneration = useRef(0);
  const callbacks = useRef({ onClose, onSaved });
  callbacks.current = { onClose, onSaved };

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // Serialize writes and drain any edits made while an earlier write was in flight.
    while (!sameDraft(desired.current, persisted.current) || write.current) {
      if (!write.current) {
        const snapshot = { ...desired.current };
        const operation = writeCaptureDraft(snapshot.title, snapshot.text).then(() => {
          persisted.current = snapshot;
        });
        write.current = operation;
        void operation.finally(() => { if (write.current === operation) write.current = null; }).catch(() => {});
      }
      await write.current;
    }
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const next = await getCaptureStatus();
    if (!mounted.current || generation !== refreshGeneration.current) return;
    const previous = statusRef.current;
    statusRef.current = next;
    if (JSON.stringify(previous) !== JSON.stringify(next)) setStatus(next);
    if (!loaded.current) {
      loaded.current = true;
      const initial = next.pending ?? next.draft ?? { title: "", text: "" };
      desired.current = { title: initial.title, text: initial.text };
      persisted.current = { ...desired.current };
      setDraft({ ...desired.current });
      setReady(true);
      if (next.pending) expected.current = { id: next.pending.id, openAfterSave: next.pending.openAfterSave };
    }
    if (next.pending) {
      expected.current = { id: next.pending.id, openAfterSave: next.pending.openAfterSave };
    } else if (next.lastSavedId && ((expected.current && next.lastSavedId === expected.current.id)
      || (submitted.current && next.lastSavedId !== submitted.current.previousSavedId))) {
      const acknowledged = expected.current ?? { id: next.lastSavedId, openAfterSave: submitted.current!.openAfterSave };
      expected.current = null;
      submitted.current = null;
      desired.current = { title: "", text: "" };
      persisted.current = { ...desired.current };
      setDraft({ ...desired.current });
      setSavedId(acknowledged.id);
      setError("");
      if (callbacks.current.onSaved) callbacks.current.onSaved(acknowledged.id, acknowledged.openAfterSave);
      else if (acknowledged.openAfterSave) void openCapturedNote(acknowledged.id)
        .catch(e => { if (mounted.current) setError(`Saved, but could not open the notebook. ${String(e)}`); });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let refreshing = false;
    const check = () => {
      if (!active || refreshing) return;
      refreshing = true;
      void refresh().catch(e => { if (active) setError(`Could not check capture status: ${String(e)}`); })
        .finally(() => { refreshing = false; });
    };
    check();
    void subscribeCaptureStatus(check).then(stop => {
      if (active) unsubscribe = stop; else stop();
    }).catch(e => { if (active) setError(`Live updates are unavailable. Checking periodically. ${String(e)}`); });
    const poll = setInterval(() => {
      if (!loaded.current || statusRef.current?.pending || busy.current) check();
    }, 1000);
    window.addEventListener("focus", check);
    return () => {
      active = false; mounted.current = false;
      unsubscribe?.(); clearInterval(poll); window.removeEventListener("focus", check);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  useEffect(() => { if (ready && !status?.pending) textarea.current?.focus(); }, [ready, !!status?.pending]);

  const change = (next: Draft) => {
    desired.current = next; setDraft(next); setSavedId(null); setError("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(e => { if (mounted.current) setError(`Could not keep this draft. Try again before closing. ${String(e)}`); });
    }, 250);
  };

  const close = useCallback(async () => {
    try {
      // Pending capture already contains the retained text; do not replace it with a draft.
      if (!statusRef.current?.pending && loaded.current) await flush();
      await hideCapture();
      callbacks.current.onClose?.();
    } catch (e) {
      if (mounted.current) setError(`Could not close and retain this draft. Please retry. ${String(e)}`);
    }
  }, [flush]);

  useEffect(() => {
    if (!desktop) return;
    let gone = false, off: (() => void) | undefined;
    void listen<{ requestId: string }>("quick-capture-drain", async event => {
      let error: string | undefined;
      try { if (!statusRef.current?.pending && loaded.current) await flush(); }
      catch (reason) { error = String(reason); setError(`Could not retain this draft. Keep capture open. ${error}`); }
      await emitTo("main", "quick-capture-drained", { requestId: event.payload.requestId, error });
    }).then(unsubscribe => { if (gone) unsubscribe(); else off = unsubscribe; });
    return () => { gone = true; off?.(); };
  }, [flush]);

  const save = async (openAfterSave: boolean) => {
    if (busy.current || !ready || statusRef.current?.pending || (!desired.current.title.trim() && !desired.current.text.trim())) return;
    busy.current = true; setWorking(true); setError("");
    try {
      await flush();
      submitted.current = { previousSavedId: statusRef.current?.lastSavedId ?? null, openAfterSave };
      const result = await submitCapture(openAfterSave);
      if (submitted.current && result.pending) expected.current = { id: result.pending.id, openAfterSave: result.pending.openAfterSave };
      await refresh();
    } catch (e) {
      if (mounted.current) setError(`Could not save this note. Your text is still here. ${String(e)}`);
      // Submission may have reached the backend even when its response failed.
      try { await refresh(); } catch { /* Keep the original actionable error. */ }
    } finally { busy.current = false; if (mounted.current) setWorking(false); }
  };

  const retry = async () => {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError("");
    try { await retryCapture(); await refresh(); }
    catch (e) { if (mounted.current) setError(`Could not retry this capture. Please try again. ${String(e)}`); }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  };

  const closeHandler = useRef(close);
  closeHandler.current = close;
  const saveHandler = useRef(save);
  saveHandler.current = save;
  useEffect(() => {
    const requestClose = () => { void closeHandler.current(); };
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
      if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); void saveHandler.current(false); }
    };
    // Capture Escape before the parent Dialog can unmount an unpersisted draft.
    document.addEventListener("keydown", key, true);
    window.addEventListener("quick-capture-close", requestClose);
    let active = true;
    let stop: (() => void) | undefined;
    if (!browser && desktop) void getCurrentWindow().onCloseRequested(event => {
      event.preventDefault(); requestClose();
    }).then(unsubscribe => { if (active) stop = unsubscribe; else unsubscribe(); })
      .catch(e => { if (active) setError(`Window close handling is unavailable. Use Close below. ${String(e)}`); });
    return () => {
      active = false; stop?.(); document.removeEventListener("keydown", key, true);
      window.removeEventListener("quick-capture-close", requestClose);
    };
  }, [browser]);

  const pending = !!status?.pending;
  const locked = !ready || working || pending;
  const empty = !draft.title.trim() && !draft.text.trim();
  return <section className={`quick-capture${browser ? " quick-capture-browser" : ""}`} aria-label="Quick capture">
    {!browser && <h1>Quick capture</h1>}
    <form onSubmit={event => { event.preventDefault(); void save(false); }} aria-busy={working || pending}>
      <div className="quick-capture-field">
        <label htmlFor="capture-title">Note title <span>(optional)</span></label>
        <input id="capture-title" value={draft.title} readOnly={locked} maxLength={240} aria-describedby="capture-title-hint"
          onChange={event => change({ ...desired.current, title: event.target.value })} />
        <span id="capture-title-hint" className="quick-capture-hint">Up to 120 characters.</span>
      </div>
      <div className="quick-capture-field quick-capture-body">
        <label htmlFor="capture-text">Note text</label>
        <textarea ref={textarea} id="capture-text" autoFocus value={draft.text} readOnly={locked}
          aria-describedby="capture-hint" onChange={event => change({ ...desired.current, text: event.target.value })} />
      </div>
      <p id="capture-hint" className="quick-capture-hint">Destination: Inbox <span>Ctrl+Enter to save</span></p>
      <div className="quick-capture-feedback">
        {error && <p className="quick-capture-error" role="alert">{error}</p>}
        {status?.warning && status.warning !== error && <p className="quick-capture-error" role="alert">{status.warning}</p>}
        <p role="status" aria-live="polite">{!ready ? "Loading retained draft…" : working ? "Saving…" : pending
          ? "Waiting for the notebook to confirm this capture. You can close safely or retry."
          : savedId ? "Saved to Inbox." : ""}</p>
        {pending && <button type="button" disabled={working} onClick={() => void retry()}>Retry save</button>}
        {!ready && error && <button type="button" onClick={() => void refresh().catch(e => setError(String(e)))}>Retry loading</button>}
        {savedId && <button type="button" onClick={() => void openCapturedNote(savedId).catch(e => setError(`Could not open the note. ${String(e)}`))}>Open saved note</button>}
      </div>
      <div className="quick-capture-actions">
        <button type="button" onClick={() => void close()}>Close</button>
        <button type="button" disabled={locked || empty} onClick={() => void save(true)}>Open in notebook</button>
        <button className="primary" type="submit" disabled={locked || empty}>Save</button>
      </div>
    </form>
  </section>;
}

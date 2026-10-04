import { lazy, Suspense, useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";
import { NoteEditor } from "./NoteEditor";
import { BoardBoundary } from "./BoardBoundary";
import { listHistory, readHistory, type HistoryEntry } from "./history";
import { isBoard, type Note } from "./types";
const BoardPreview = lazy(() => import("./BoardPreview"));

export function HistoryDialog({ item, dark, onClose, onRestore }: { item: Note; dark: boolean; onClose: () => void; onRestore: (note: Note) => Promise<void> }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]), [selected, setSelected] = useState(""), [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [restoring, setRestoring] = useState(false);
  useEffect(() => { let cancelled = false; void listHistory(item.id).then(values => { if (!cancelled) { setEntries(values); setSelected(values[0]?.id || ""); setLoading(false); } }).catch(reason => { if (!cancelled) { setError(String(reason)); setLoading(false); } }); return () => { cancelled = true; }; },[item.id]);
  useEffect(() => {
    let cancelled = false; setNote(null);
    if (selected) void readHistory(selected).then(value => { if (!cancelled) setNote(value); }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  },[selected]);
  return <Dialog title={`Version history — ${item.title || "Untitled"}`} className="history-dialog" onClose={onClose}>
    <p className="modal-subtitle">Up to 20 versions per item for 30 days, within a shared 64 MiB history budget. Checkpoints are at least five minutes apart. The current version is preserved before restoring.</p>
    {error && <p role="alert" className="protection-error">{error}</p>}
    {loading ? <p role="status">Loading versions…</p> : !entries.length ? <p>No earlier versions yet. Saved content changes create checkpoints.</p> : <>
      <label className="field-label" htmlFor="history-version">Saved version</label>
      <AppSelect id="history-version" className="form-input" label="Saved version" value={selected}
        onChange={value => { setError(""); setSelected(value); }}
        options={entries.map(entry => ({ value:entry.id,label:`${new Date(entry.time).toLocaleString()} — ${entry.title || "Untitled"}` }))} />
      <div className="history-preview">{note ? isBoard(note) ? <BoardBoundary board={note.board}><Suspense fallback={<p role="status">Loading drawing…</p>}><BoardPreview board={note.board} dark={dark} /></Suspense></BoardBoundary> : <NoteEditor key={selected} content={note.content} onChange={() => {}} readOnly /> : <p role="status">Loading version…</p>}</div>
    </>}
    <div className="dialog-actions"><button onClick={onClose}>Close</button><button className="primary" disabled={!note || restoring || !!item.deletedAt} onClick={() => {
      if (!note) return; setRestoring(true);
      void onRestore(note).catch(reason => setError(String(reason))).finally(() => setRestoring(false));
    }}>{restoring ? "Restoring…" : "Restore this version"}</button></div>
  </Dialog>;
}

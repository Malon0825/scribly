import { useState } from "react";
import { Dialog } from "./Dialog";
import { isBoard, isTemplate, type Workspace } from "./types";

export function BackupRestoreDialog({ backup, onClose, onRestore }: { backup: Pick<Workspace, "notes" | "folders">; onClose: () => void; onRestore: (replace: boolean) => Promise<void> }) {
  const [replace, setReplace] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Dialog title="Restore notebook backup" className="backup-restore-dialog" onClose={onClose}>
    <p className="modal-subtitle">{backup.notes.filter(note => !isBoard(note) && !isTemplate(note)).length} notes, {backup.notes.filter(isBoard).length} boards, {backup.notes.filter(isTemplate).length} note templates, and {backup.folders.length} folders. Includes {backup.notes.filter(note => note.deletedAt).length} Trash items and {backup.notes.filter(note => note.archived && !note.deletedAt).length} archived items.</p>
    <fieldset className="restore-options"><legend>How to restore</legend><label><input type="radio" name="restore-mode" checked={!replace} onChange={() => { setReplace(false); setConfirmed(false); }} />Import as new items</label><label><input type="radio" name="restore-mode" checked={replace} onChange={() => setReplace(true)} />Replace this notebook</label></fieldset>
    <p>{replace ? "A complete copy of this notebook is saved before replacement. If that copy or the restore fails, replacement stops. Local history is not contained in the imported backup." : "Existing items stay in place. Imported items receive new IDs; Trash and archive states are preserved."}</p>
    {replace && <label className="protection-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand this replaces the current notes and folders.</label>}
    {error && <p role="alert" className="protection-error">{error}</p>}
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className={replace ? "danger-button" : "primary"} disabled={busy || (replace && !confirmed)} onClick={() => {
      setBusy(true); setError(""); void onRestore(replace).catch(reason => setError(String(reason))).finally(() => setBusy(false));
    }}>{busy ? "Restoring…" : replace ? "Replace notebook" : "Import backup"}</button></div>
  </Dialog>;
}

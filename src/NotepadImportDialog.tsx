import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";
import { ArrowClockwise } from "@phosphor-icons/react";
import { desktop } from "./storage";
import { NEW_NOTEPAD_FOLDER, notepadFolderName, notepadSourceName, notepadDuplicateIds, scanNotepadTabs, scanNotepadPlusTabs, type NotepadSource, type NotepadScan, type NotepadTab } from "./notepadImport";
import type { Workspace } from "./types";

export function NotepadImportDialog({ workspace, folderId, source = "notepad", onClose, onImport, onImportFiles, returnFocus }: {
  workspace: Workspace; folderId: string | null;
  source?: NotepadSource;
  onClose: () => void;
  onImport: (tabs: NotepadTab[], destination: string) => Promise<void>;
  onImportFiles: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const name = notepadSourceName(source), folderName = notepadFolderName(source), plus = source === "notepadPlus";
  const [destination, setDestination] = useState(folderId ?? workspace.folders.find((f) => f.name === folderName)?.id ?? NEW_NOTEPAD_FOLDER);
  const [scan, setScan] = useState<NotepadScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  async function refresh(chooseDirectory = false) {
    const token = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = plus ? await scanNotepadPlusTabs(scan?.sourceDirectory, chooseDirectory) : await scanNotepadTabs();
      if (generation.current !== token) return;
      if (result) { setScan(result); setSelected(new Set(result.tabs.map((tab) => tab.id))); }
    } catch (e) { if (generation.current === token) setError(String(e)); }
    finally { if (generation.current === token) setLoading(false); }
  }
  useEffect(() => {
    if (desktop) void refresh();
    return () => { generation.current++; };
  }, []);
  const duplicateIds = notepadDuplicateIds(workspace, scan?.tabs ?? [], destination, source);
  const available = scan?.tabs.filter((tab) => !duplicateIds.has(tab.id)) ?? [];
  const chosen = available.filter((tab) => selected.has(tab.id));
  const toggleAll = useRef<HTMLInputElement>(null);
  useEffect(() => { if (toggleAll.current) toggleAll.current.indeterminate = chosen.length > 0 && chosen.length < available.length; }, [chosen.length, available.length]);
  async function submit() {
    if (busy || loading || !chosen.length) return;
    setBusy(true); setError("");
    try { await onImport(chosen, destination); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <Dialog title={`Import from ${name}`} className="notepad-import-dialog" onClose={onClose} returnFocus={returnFocus} initialFocus={() => document.getElementById("notepad-import-destination")}>
    <p className="modal-subtitle">Copy unsaved tabs into your notebook. Your {name} tabs and files stay untouched. Text and line breaks are kept; formatting is imported as plain text.</p>
    {!desktop ? <>
      <p className="notepad-message" role="status">Direct import is available in the Scribly Windows app. In this browser preview, save your {name} tabs as .txt files and use Import files.</p>
      <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={onImportFiles}>Import files…</button></div>
    </> : <>
      <label className="field-label" htmlFor="notepad-import-destination">Import into</label>
      <AppSelect id="notepad-import-destination" label="Notepad import destination" disabled={busy} value={destination} onChange={setDestination} options={[
        ...(!workspace.folders.some((folder) => folder.name === folderName) ? [{ value: NEW_NOTEPAD_FOLDER, label: `Create ${folderName} folder` }] : []),
        ...workspace.folders.map((folder) => ({ value: folder.id, label: folder.name })),
        { value: "", label: "Unfiled notes" },
      ]} />
      <div className="notepad-scan-heading">
        <span role="status">{loading ? `Reading ${plus ? name : "Notepad"} recovery data…` : scan ? `${scan.tabs.length} ${scan.tabs.length === 1 ? "tab" : "tabs"} found` : `${name} recovery`}</span>
        <button className="link-button" disabled={loading || busy} onClick={() => void refresh()}><ArrowClockwise size={18} />Scan again</button>
      </div>
      {plus ? <>
        <p className="notepad-hint">In Notepad++ Settings → Preferences → Backup, enable “Remember current session for next launch” and “Enable session snapshot and periodic backup”. Wait for its backup interval, then scan again. Only tabs with unsaved backup text are available.</p>
        <button className="link-button" disabled={loading || busy} onClick={() => void refresh(true)}>Choose backup folder…</button>
        {scan?.sourceDirectory && <p className="notepad-hint notepad-source-path">Backup folder: {scan.sourceDirectory}</p>}
      </> : <p className="notepad-hint">For the latest text, close the Notepad window with its tabs kept for next time, then scan again. Tabs without recovery data need to be saved as .txt files.</p>}
      {error && <p className="notepad-message danger-text" role="alert">{error}</p>}
      {scan && !scan.tabs.length && <p className="notepad-message">{scan.found ? "No recoverable unsaved text found." : `No ${name} recovery data found.`} {plus && "For a portable installation, choose its profile or backup folder. "}Saved .txt files can be added with Import files.</p>}
      {!!scan?.tabs.length && <>
        <label className="notepad-select-all"><input ref={toggleAll} type="checkbox" checked={!!available.length && chosen.length === available.length} disabled={!available.length || busy}
          onChange={(event) => setSelected(event.target.checked ? new Set(available.map((tab) => tab.id)) : new Set())} />Select all <span>{chosen.length} selected</span></label>
        <div className="notepad-tabs" role="group" aria-label="Notepad tabs">
          {scan.tabs.map((tab) => <label key={tab.id} className={`notepad-tab${duplicateIds.has(tab.id) ? " is-duplicate" : ""}`}>
            <input type="checkbox" aria-label={`Import ${tab.title}`} checked={!duplicateIds.has(tab.id) && selected.has(tab.id)} disabled={duplicateIds.has(tab.id) || busy}
              onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(tab.id); else next.delete(tab.id); return next; })} />
            <span><strong>{tab.title}</strong><small>{duplicateIds.has(tab.id) ? "Already in this folder · skipped" : tab.text.slice(0, 160).replace(/\s+/g, " ")}</small></span>
          </label>)}
        </div>
      </>}
      {!!scan && (scan.emptyTabs > 0 || scan.savedTabs > 0) && <p className="notepad-hint">{plus ? `Skipped ${scan.emptyTabs} empty snapshots.` : `Skipped ${scan.emptyTabs} empty tabs and ${scan.savedTabs} saved tabs without a recovery text buffer.`}</p>}
      {!!scan?.skipped.length && <details className="notepad-skipped"><summary>{scan.skipped.length} tabs could not be read</summary><ul className="import-failures">{scan.skipped.map((reason, i) => <li key={i}>{reason}</li>)}</ul></details>}
      <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={loading || busy || !chosen.length} onClick={() => void submit()}>{busy ? "Importing…" : `Import ${chosen.length} ${chosen.length === 1 ? "note" : "notes"}`}</button></div>
    </>}
  </Dialog>;
}

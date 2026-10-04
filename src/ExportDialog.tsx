import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { desktop, exportArtifact } from "./storage";
import type { Note } from "./types";
import type { PreparedNoteExport } from "./formattedExport";

export function ExportDialog({ notes, scope, onClose, onNotice, returnFocus }: {
  notes: readonly Note[]; scope: string; onClose: () => void;
  onNotice: (message: string) => void; returnFocus: () => HTMLElement | null;
}) {
  const [prepared, setPrepared] = useState<PreparedNoteExport | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"prepare" | "markdown" | "html" | "print" | null>("prepare");
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const operation = new AbortController(); controller.current = operation;
    setBusy("prepare"); setError(""); setMessage(""); setPrepared(null);
    void import("./formattedExport").then(module => module.prepareNoteExport(notes, operation.signal))
      .then(value => { if (!operation.signal.aborted) setPrepared(value); })
      .catch(reason => { if (!operation.signal.aborted) setError(`Export could not be prepared: ${String(reason)}`); })
      .finally(() => { if (!operation.signal.aborted) setBusy(null); });
    return () => operation.abort();
  }, [notes, attempt]);
  const close = () => { controller.current?.abort(); onClose(); };
  async function run(format: "markdown" | "html" | "print") {
    if (!prepared || busy) return;
    const signal = controller.current!.signal;
    setBusy(format); setError(""); setMessage("");
    try {
      if (format === "print") {
        const { printNoteExport } = await import("./printNoteExport");
        await printNoteExport(prepared.html, signal);
        if (!signal.aborted) setMessage("Print dialog requested. Choose Save as PDF or a printer there; Scribly cannot confirm the result.");
      } else {
        const saved = await exportArtifact(format === "markdown" ? prepared.markdownName : prepared.htmlName,
          format === "markdown" ? prepared.markdown : prepared.html,
          format === "markdown" ? "application/zip" : "text/html;charset=utf-8");
        if (saved) onNotice(desktop ? "Formatted export saved." : "Formatted export downloaded.");
        else if (!signal.aborted) setMessage("Save canceled.");
      }
    } catch (reason) {
      if (!signal.aborted) setError(`Export failed: ${String(reason)}. Your notes are unchanged; try again or choose another format.`);
    } finally { if (!signal.aborted) setBusy(null); }
  }
  return <Dialog title="Export notes" onClose={close} className="workflow-dialog export-dialog" returnFocus={returnFocus}>
    <p className="modal-subtitle">{scope} · {notes.length} {notes.length === 1 ? "note" : "notes"}. This export uses the draft captured when you opened it.</p>
    <p className="workflow-hint">Markdown downloads as a ZIP with image files. Print uses a light reading layout; choose Save as PDF in the print dialog. HTML opens in any browser.</p>
    {busy === "prepare" && <p role="status">Preparing export… You can cancel while it is preparing.</p>}
    {prepared && <>
      {!!prepared.warnings.length && <div className="export-warnings" aria-label="Export format differences"><ul>{prepared.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      <iframe title="Export preview" className="export-preview" sandbox="" srcDoc={prepared.html} />
    </>}
    {error && <p role="alert" className="export-error">{error}</p>}
    {message && <p role="status" className="workflow-hint">{message}</p>}
    {error && !prepared && <button className="export-retry" onClick={() => setAttempt(value => value + 1)}>Retry preparation</button>}
    <div className="dialog-actions">
      <button onClick={close}>Cancel</button>
      <button disabled={!prepared || !!busy} onClick={() => void run("html")}>{busy === "html" ? "Saving HTML…" : "Save HTML"}</button>
      <button disabled={!prepared || !!busy} onClick={() => void run("print")}>{busy === "print" ? "Opening print…" : "Print / Save as PDF"}</button>
      <button className="primary" disabled={!prepared || !!busy} onClick={() => void run("markdown")}>{busy === "markdown" ? "Exporting Markdown…" : "Export Markdown (.zip)"}</button>
    </div>
  </Dialog>;
}

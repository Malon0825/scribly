import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";
import { boardTemplates } from "./boardTemplates";
import { importMermaidBoard } from "./boardMermaidImport";
import BoardPreview from "./BoardPreview";
import type { BoardData } from "./boardData";
import "./board.css";

export default function CreateBoardDialog({ mode, dark, onClose, onCreate, returnFocus }: {
  mode: "import" | "template"; dark: boolean; onClose: () => void; onCreate: (title: string, board: BoardData) => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const [template, setTemplate] = useState<string>(boardTemplates[0].id);
  const [title, setTitle] = useState(mode === "template" ? boardTemplates[0].title : "Imported architecture");
  const [code, setCode] = useState<string>(mode === "template" ? boardTemplates[0].code : "flowchart LR\n  client[\"Client\"] --> api[\"API\"]");
  const [preview, setPreview] = useState<BoardData | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(0), file = useRef<HTMLInputElement>(null);
  useEffect(() => () => { request.current++; }, []);
  const invalidate = () => { request.current++; setPreview(null); setBusy(false); setError(""); };
  const convert = async () => {
    const token = ++request.current; setBusy(true); setError(""); setPreview(null);
    try { const board = await importMermaidBoard(code); if (token === request.current) setPreview(board); }
    catch (e) { if (token === request.current) setError(String(e)); }
    finally { if (token === request.current) setBusy(false); }
  };
  return <Dialog title={mode === "template" ? "Architecture templates" : "Import Mermaid"} className="mermaid-dialog board-create-dialog" onClose={onClose} returnFocus={returnFocus}>
    <p className="modal-subtitle">Create an editable board in the current folder. Existing drawings stay intact. Preview the flowchart before creating it.</p>
    {mode === "template" && <AppSelect label="Architecture template" value={template} options={boardTemplates.map((t) => ({ value: t.id, label: t.title }))}
      onChange={(id) => { const next = boardTemplates.find((t) => t.id === id)!; invalidate(); setTemplate(id); setTitle(next.title); setCode(next.code); }} />}
    {mode === "template" && <p className="mermaid-hint">{boardTemplates.find((t) => t.id === template)?.description}</p>}
    <label className="board-title-field">Board title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
    <div className="mermaid-columns"><div className="board-source">
      <label htmlFor="board-source-code">Mermaid flowchart</label>
      <textarea id="board-source-code" value={code} spellCheck={false} onChange={(e) => { invalidate(); setCode(e.target.value); }} />
      <input ref={file} type="file" accept=".mmd,.mermaid,.txt" hidden onChange={(event) => {
        const selected = event.target.files?.[0]; event.target.value = ""; if (!selected) return;
        const token = ++request.current; setPreview(null); setBusy(false); setError("");
        if (selected.size > 200_000) { setError("Use a Mermaid file up to 200 KB (50,000 characters)."); return; }
        setBusy(true);
        void selected.text().then((text) => { if (token === request.current) { setCode(text); setTitle(selected.name.replace(/\.[^.]+$/, "").slice(0, 200)); } }, (e) => { if (token === request.current) setError(String(e)); })
          .finally(() => { if (token === request.current) setBusy(false); });
      }} />
      <button onClick={() => file.current?.click()}>Choose Mermaid file</button>
    </div><div className="board-import-preview" aria-label="Imported drawing preview">{preview ? <BoardPreview board={preview} dark={dark} /> : <p role="status">{busy ? "Converting flowchart…" : "Preview to check the editable drawing."}</p>}</div></div>
    <p className="mermaid-hint">Supports flowchart shapes, bound connections and nested subgraphs. Links, HTML and configuration directives are excluded. Conversion uses automatic layout.</p>
    {error && <p className="danger-text" role="alert">{error}</p>}
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button disabled={busy} onClick={() => void convert()}>Preview drawing</button>
      <button className="primary" disabled={!preview || busy || !title.trim()} onClick={() => { if (!preview) return; try { onCreate(title.trim(), preview); onClose(); } catch (e) { setError(String(e)); } }}>Create board</button></div>
  </Dialog>;
}

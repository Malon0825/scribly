import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { NoteEditor } from "./NoteEditor";
import { isTemplate, type Note } from "./types";
export type TemplateDraft = { name: string; titlePattern: string; resetChecklist: boolean };
export function TemplateDialog({ mode, source, notes, onClose, onSave, onDelete, onCreate }: {
  mode: "save" | "manage" | "choose"; source?: Note; notes: Note[];
  onClose: () => void; onSave: (draft: TemplateDraft, id?: string) => void;
  onDelete: (id: string) => void; onCreate: (id: string, title: string, reset: boolean) => void;
}) {
  const templates = notes.filter(isTemplate), [selected, setSelected] = useState(templates[0]?.id || "");
  const current = mode === "save" ? source : templates.find(note => note.id === selected);
  const [name,setName] = useState(source?.title || ""), [pattern,setPattern] = useState("{{title}}"), [reset,setReset] = useState(false), [title,setTitle] = useState(""), [confirm,setConfirm] = useState(false);
  useEffect(() => { setName(current?.title || ""); setPattern(current?.template?.titlePattern || "{{title}}"); setReset(current?.template?.resetChecklist || false); setConfirm(false); }, [current?.id]);
  return <Dialog title={mode === "save" ? "Save note as template" : mode === "choose" ? "New note from template" : "Note templates"} onClose={onClose} className="workflow-dialog">
    <p className="modal-subtitle">{mode === "save" ? "Keep an independent copy of this note, including its formatting, images and checklist." : "Templates are separate from your notes and board templates. Changes here affect only future notes."}</p>
    {mode !== "save" && <div className="workflow-list" role="group" aria-label="Note templates">{templates.map(note => <button key={note.id} aria-pressed={note.id === selected} onClick={() => setSelected(note.id)}>{note.title}</button>)}{!templates.length && <p className="workflow-hint">No note templates yet. Use Save as template in a note’s options.</p>}</div>}
    {current && <>
      {mode !== "choose" && <label className="workflow-field">Template name<input value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label>}
      {mode === "choose" ? <label className="workflow-field">Note title<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="Use automatic title" /></label> : <label className="workflow-field">Title pattern<input value={pattern} maxLength={200} onChange={event => setPattern(event.target.value)} /></label>}
      <p className="workflow-hint">Use {"{{title}}"} and {"{{date}}"} in the title pattern or note text. Date uses your local YYYY-MM-DD.</p>
      <label className="workflow-check"><input type="checkbox" checked={reset} onChange={event => setReset(event.target.checked)} />Reset checklists in new notes</label>
      <div className="template-preview" aria-label="Template preview"><NoteEditor key={current.id} content={current.content} readOnly /></div>
      {mode === "manage" && <>{confirm ? <div className="workflow-confirm" role="alert"><p>Delete this template permanently? Existing notes keep their contents. Its folder defaults will be cleared.</p><button onClick={() => setConfirm(false)}>Keep template</button><button className="danger-text" onClick={() => { onDelete(current.id); setSelected(templates.find(note => note.id !== current.id)?.id || ""); }}>Delete template permanently</button></div> : <button className="danger-text" onClick={() => setConfirm(true)}>Delete template…</button>}</>}
    </>}
    <div className="dialog-actions"><button onClick={onClose}>{mode === "manage" ? "Close" : "Cancel"}</button>{current && (mode === "choose" ? <button className="primary" onClick={() => onCreate(current.id,title,reset)}>Create note</button> : <button className="primary" disabled={!name.trim() || !pattern.trim()} onClick={() => onSave({ name:name.trim(),titlePattern:pattern,resetChecklist:reset }, mode === "manage" ? current.id : undefined)}>{mode === "save" ? "Save template" : "Save changes"}</button>)}</div>
  </Dialog>;
}

import { useState } from "react";
import { Dialog } from "./Dialog";
import { isBoard, isTemplate, type Note } from "./types";
export function ItemLinkPicker({ notes, onInsert, onOpen, onClose }: { notes: Note[]; onInsert: (note: Note) => void; onOpen: (id: string, reference: boolean) => void; onClose: () => void }) {
  const [query, setQuery] = useState(""), [selected, setSelected] = useState("");
  const available = notes.filter(note => !isTemplate(note) && !note.deletedAt && !note.archived && note.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const target = notes.find(note => note.id === selected && !isTemplate(note) && !note.archived && !note.deletedAt);
  return <Dialog title="Link to an item" onClose={onClose} className="workflow-dialog" returnFocus={() => document.querySelector<HTMLElement>('.document-editor .tiptap, .board-canvas .excalidraw')}>
    <p className="modal-subtitle">Choose a note or board. The connection follows it through renames and folder moves.</p>
    <label className="workflow-field">Search items<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles" /></label>
    <div className="workflow-list" role="group" aria-label="Link targets">
      {available.map(note => <button key={note.id} aria-pressed={selected === note.id} onClick={() => setSelected(note.id)}><strong>{note.title || "Untitled"}</strong><span>{isBoard(note) ? "Board" : "Note"}</span></button>)}
      {!available.length && <p className="workflow-hint">No live items match. Archived and Trash items can be restored before adding a new link.</p>}
    </div>
    <div className="workflow-actions"><button disabled={!target} onClick={() => target && onOpen(target.id,false)}>Open</button><button disabled={!target} onClick={() => target && onOpen(target.id,true)}>Open in Reference</button></div>
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!target} onClick={() => target && onInsert(target)}>Insert link</button></div>
  </Dialog>;
}

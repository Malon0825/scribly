import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { CaretUp, CaretDown, X } from "@phosphor-icons/react";
import { emptySearch, searchKey } from "./textSearch";

export type FindRequest = { serial: number; query?: string; replace: boolean };
export function NoteFind({ editor, request, readOnly, onClose }: { editor: Editor; request: FindRequest; readOnly: boolean; onClose: () => void }) {
  const [query, setQuery] = useState(request.query || ""), [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false), [wholeWord, setWholeWord] = useState(false);
  const [replace, setReplace] = useState(request.replace && !readOnly);
  const [state, setState] = useState(() => searchKey.getState(editor.state)!);
  const field = useRef<HTMLInputElement>(null), bookmark = useRef<SelectionBookmark>(editor.state.selection.getBookmark());
  const scroll = useRef(editor.view.dom.closest<HTMLElement>(".document-scroll"));
  const scrollTop = useRef(scroll.current?.scrollTop || 0);
  const [message, setMessage] = useState("");
  const hasOriginal = useMemo(() => { let found = false; editor.state.doc.descendants(node => { if (node.type.name === "sourceFile") found = true; }); return found; }, [editor.state.doc]);
  useEffect(() => {
    const transaction = ({ transaction }: { transaction: Transaction }) => {
      bookmark.current = bookmark.current.map(transaction.mapping);
      setState(searchKey.getState(editor.state)!);
    };
    editor.on("transaction", transaction);
    return () => { editor.off("transaction", transaction); if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, emptySearch)); };
  }, [editor]);
  useEffect(() => {
    setReplace(request.replace && !readOnly);
    if (request.query !== undefined) setQuery(request.query);
    field.current?.focus({ preventScroll: true }); field.current?.select();
  }, [request.serial, readOnly]);
  useEffect(() => {
    const timer = setTimeout(() => {
      editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, caseSensitive, wholeWord, near: editor.state.selection.from }));
      if (request.query !== undefined) navigate(0);
    }, 100);
    return () => clearTimeout(timer);
  }, [editor, query, caseSensitive, wholeWord]);
  function navigate(delta: number) {
    const current = searchKey.getState(editor.state)!;
    if (!current.matches.length) return;
    const index = (current.index + delta + current.matches.length) % current.matches.length, match = current.matches[index];
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).setMeta(searchKey, { index }).scrollIntoView());
  }
  function dismiss() {
    editor.view.dispatch(editor.state.tr.setSelection(bookmark.current.resolve(editor.state.doc)).setMeta(searchKey, emptySearch));
    editor.view.focus(); if (scroll.current) scroll.current.scrollTop = scrollTop.current;
    onClose();
  }
  function replaceMatches(all: boolean) {
    if (readOnly || !editor.isEditable) return;
    const current = searchKey.getState(editor.state)!;
    if (current.query !== query || current.caseSensitive !== caseSensitive || current.wholeWord !== wholeWord) return;
    const match = current.matches[current.index]; if (!match) return;
    const targets = all ? current.matches : [match];
    const transaction = closeHistory(editor.state.tr);
    for (const target of [...targets].reverse()) {
      const marks = editor.state.doc.resolve(target.from).nodeAfter?.marks || [];
      if (replacement) transaction.replaceWith(target.from, target.to, editor.schema.text(replacement, marks));
      else transaction.delete(target.from, target.to);
    }
    transaction.setMeta(searchKey, { near: all ? 0 : transaction.mapping.map(match.to, 1) });
    editor.view.dispatch(transaction);
    // Isolate each replace operation from both earlier typing and the next edit.
    editor.view.dispatch(closeHistory(editor.state.tr));
    setMessage(`${targets.length} ${targets.length === 1 ? "match" : "matches"} replaced.`);
  }
  const pending = state.query !== query || state.caseSensitive !== caseSensitive || state.wholeWord !== wholeWord;
  return <section className="note-find" aria-label="Find in note" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
    if (event.key === "Enter" && event.target === field.current) { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
  }}>
    <div className="find-row">
      <input ref={field} aria-label="Find text" placeholder="Find in note" value={query} onChange={event => { setQuery(event.target.value); setMessage(""); }} />
      <span className="find-count" role="status">{pending ? "Searching…" : !query ? "Enter text" : state.matches.length ? `${state.index + 1} of ${state.matches.length}` : "No matches"}</span>
      <button aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={pending || !state.matches.length} onClick={() => navigate(-1)}><CaretUp size={18} /></button>
      <button aria-label="Next match" title="Next match (Enter)" disabled={pending || !state.matches.length} onClick={() => navigate(1)}><CaretDown size={18} /></button>
      <button aria-label="Close find" title="Close find (Escape)" onClick={dismiss}><X size={18} /></button>
    </div>
    <div className="find-options">
      <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />Match case</label>
      <label><input type="checkbox" checked={wholeWord} onChange={event => setWholeWord(event.target.checked)} />Whole word</label>
      {!readOnly && <button aria-expanded={replace} onClick={() => setReplace(value => !value)}>Replace</button>}
      {readOnly && <span>Read-only note</span>}
    </div>
    {replace && !readOnly && <div className="find-row replace-row">
      <input aria-label="Replace with" placeholder="Replace with" value={replacement} onChange={event => setReplacement(event.target.value)} />
      <button disabled={pending || !state.matches.length} onClick={() => replaceMatches(false)}>Replace next</button>
      <button disabled={pending || !state.matches.length} onClick={() => replaceMatches(true)}>Replace all</button>
    </div>}
    {hasOriginal && <p className="find-hint">Original file contents are excluded. Find searches this note’s text and annotations.</p>}
    {message && <p className="find-hint" role="status">{message}</p>}
  </section>;
}

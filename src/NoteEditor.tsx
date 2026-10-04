import { AnimatedIcon } from "./AnimatedIcon";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { NotifyCodeBlock } from "./CodeBlock";
import { AppSelect } from "./AppSelect";
import { NoteTextColor, NoteBackgroundColor } from "./textColors";
import { SelectionColors, canColorSelection } from "./SelectionColors";
import { NoteInk } from "./NoteInk";
import { InkLayer, type PenSettings } from "./InkLayer";
import { HighlighterTools } from "./HighlighterTools";
import { reportEditorReady } from "./startupTiming";
import { NotifyImage } from "./ImageBlock";
import { readImage, isImageFile, IMAGE_ACCEPT } from "./imageFiles";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { DOMSerializer, DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
export function NoteEditor({
  content,
  readOnly = false,
  onChange,
  onAppendReady,
  onImagesReady,
  validateContent,
}: {
  content: string;
  readOnly?: boolean;
  onChange?: (html: string) => void;
  onAppendReady?: (append: (html: string) => void) => void;
  onImagesReady?: (insert: (files: File[], point?: { left: number; top: number }) => void) => void;
  validateContent?: (html: string) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [pen, setPen] = useState<PenSettings>({ active: false, tool: "highlight", mode: "guided", color: "yellow", width: 16, smooth: true });
  const changePen = useCallback((next: Partial<PenSettings>) => setPen(current => ({ ...current, ...next })), []);
  const togglePenMode = useCallback(() => setPen(current => ({ ...current, mode: current.mode === "guided" ? "free" : "guided" })), []);
  const exitPen = useCallback(() => setPen(current => ({ ...current, active: false })), []);
  const requestImage = useCallback(() => imageInput.current?.click(), []);
  const openColors = useRef<() => void>(() => {});
  const requestColors = useCallback(() => openColors.current(), []);
  const registerColors = useCallback((fn: () => void) => { openColors.current = fn; }, []);
  const lastEmittedHtml = useRef<string | null>(null);
  const insertImagesRef = useRef<(files: File[], point?: { left: number; top: number }) => void>(() => {});
  const validator = useRef(validateContent); validator.current = validateContent;
  const imageBusy = useRef(false);
  const [imageStatus, setImageStatus] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      Extension.create({
        name: "notebookCapacity",
        addProseMirrorPlugins() {
          return [new Plugin({ filterTransaction: (transaction) => {
            if (!transaction.docChanged || !validator.current) return true;
            try {
              const html = document.createElement("div");
              html.append(DOMSerializer.fromSchema(transaction.doc.type.schema).serializeFragment(transaction.doc.content));
              validator.current(html.innerHTML);
              return true;
            } catch (error) { setImageStatus(error instanceof Error ? error.message : String(error)); return false; }
          } })];
        },
      }),
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false },
        underline: false,
        codeBlock: false,
      }),
      NotifyCodeBlock,
      NotifyImage,
      NoteTextColor,
      NoteBackgroundColor,
      NoteInk,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Start writing. This space is yours…",
      }),
    ],
    content,
    editable: !readOnly,
    editorProps: {
      handlePaste: (view, event) => {
        if (readOnly) return false;
        const files = Array.from(event.clipboardData?.files || []).filter(isImageFile);
        if (files.length) { event.preventDefault(); insertImagesRef.current(files); return true; }
        const html = event.clipboardData?.getData("text/html");
        if (!html?.includes("<img")) return false;
        // Embedded images from another note share the same notebook-size guard.
        event.preventDefault();
        const source = document.createElement("div"); source.innerHTML = html;
        const tr = view.state.tr.replaceSelection(ProseMirrorParser.fromSchema(view.state.schema).parseSlice(source));
        const output = document.createElement("div"); output.append(DOMSerializer.fromSchema(view.state.schema).serializeFragment(tr.doc.content));
        try { validator.current?.(output.innerHTML); view.dispatch(closeHistory(tr).scrollIntoView()); }
        catch (error) { setImageStatus(error instanceof Error ? error.message : String(error)); }
        return true;
      },
      attributes: {
        class: "note-content",
        role: "textbox",
        "aria-label": readOnly ? "Reference content" : "Note content",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmittedHtml.current = html;
      onChange?.(html);
    },
  });
  useEffect(() => { if (editor && !readOnly) reportEditorReady(); }, [editor, readOnly]);
  insertImagesRef.current = (files, point) => { void (async () => {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    if (imageBusy.current) { setImageStatus("Images are still being added. Please wait."); return; }
    imageBusy.current = true; setImageLoading(true); setImageStatus("Adding images…");
    const pos = point ? editor.view.posAtCoords(point)?.pos ?? editor.state.selection.to : editor.state.selection.to;
    let bookmark = TextSelection.near(editor.state.doc.resolve(pos)).getBookmark();
    const map = ({ transaction }: { transaction: Transaction }) => { bookmark = bookmark.map(transaction.mapping); };
    editor.on("transaction", map);
    const failures: string[] = [];
    let added = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (index >= 25) { failures.push(`${file.name}: Add up to 25 images at a time.`); continue; }
        try {
          const attrs = await readImage(file);
          if (editor.isDestroyed) return;
          const tr = editor.state.tr.setSelection(bookmark.resolve(editor.state.doc));
          tr.replaceSelectionWith(editor.schema.nodes.image.create(attrs));
          // Keep a paragraph after the image so typing can continue immediately.
          const end = tr.selection.to;
          if (tr.doc.resolve(end).parent.type.name === "doc") {
            tr.insert(end, editor.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)));
          }
          const html = document.createElement("div");
          html.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(tr.doc.content));
          validator.current?.(html.innerHTML);
          editor.view.dispatch(closeHistory(tr).scrollIntoView());
          bookmark = editor.state.selection.getBookmark();
          added++;
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!editor.isDestroyed) {
        setImageStatus(failures.length ? `${added} ${added === 1 ? "image" : "images"} added. ${failures.join(" ")}` : "");
        editor.commands.focus();
      }
    } finally { editor.off("transaction", map); imageBusy.current = false; if (!editor.isDestroyed) setImageLoading(false); }
  })(); };
  useEffect(() => {
    if (!editor || !onImagesReady) return;
    onImagesReady((files, point) => insertImagesRef.current(files, point));
    return () => onImagesReady(() => {});
  }, [editor, onImagesReady]);
  useEffect(() => {
    if (!editor || content === lastEmittedHtml.current) return;
    if (editor.getHTML() !== content) editor.commands.setContent(content, { emitUpdate: false });
    lastEmittedHtml.current = content;
  }, [content, editor]);
  useEffect(() => {
    if (editor && onAppendReady)
      onAppendReady((html) => {
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.doc.content.size, html)
          .run();
      });
    return () => onAppendReady?.(() => {});
  }, [editor, onAppendReady]);
  if (!editor) return null;
  return (
    <>
      {!readOnly && (
        <EditorToolbar editor={editor} imageLoading={imageLoading} onImageRequest={requestImage} onColorsRequest={requestColors} pen={pen} changePen={changePen} />
      )}
      {!readOnly && <>
        {pen.active && <div className="pen-mode-status" role="status">
          {pen.tool === 'draw' ? 'Drawing' : 'Highlighting'} · {pen.mode === 'guided' ? 'Guided' : 'Freehand'}
          <button onClick={() => { exitPen(); editor.commands.focus(); }}>Return to writing <kbd>Esc</kbd></button>
        </div>}
        <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="Image files" onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; insertImagesRef.current(files);
        }} />
        {imageStatus && <div className="image-insert-status" role={imageLoading ? "status" : "alert"}>{imageStatus}
          {!imageLoading && <button onClick={() => setImageStatus("")}>Dismiss</button>}</div>}
      </>}
      <div ref={surface} className="note-editor-surface">
      <EditorContent
        editor={editor}
        className={readOnly ? "reference-editor" : "document-editor"}
      />
      <InkLayer editor={editor} surface={surface} settings={readOnly ? { ...pen, active: false } : pen} toggleMode={togglePenMode} exit={exitPen} onStatus={readOnly ? undefined : setImageStatus} />
      </div>
      {!readOnly && <SelectionColors editor={editor} onOpenReady={registerColors} />}
    </>
  );
}

// Selection transactions update only controls whose state actually changed.
// ProseMirror still owns the live document and selection.
const EditorToolbar = memo(function EditorToolbar({ editor, imageLoading, onImageRequest, onColorsRequest, pen, changePen }: {
  editor: Editor; imageLoading: boolean; onImageRequest: () => void; onColorsRequest: () => void; pen: PenSettings; changePen: (next: Partial<PenSettings>) => void;
}) {
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    heading: editor.isActive("heading", { level: 1 }) ? "1"
      : editor.isActive("heading", { level: 2 }) ? "2"
      : editor.isActive("heading", { level: 3 }) ? "3" : "0",
    bold: editor.isActive("bold"), italic: editor.isActive("italic"),
    codeBlock: editor.isActive("codeBlock"), bulletList: editor.isActive("bulletList"),
    taskList: editor.isActive("taskList"), undo: editor.can().undo(), redo: editor.can().redo(),
    canColor: canColorSelection(editor),
  }) });
  return (
        <div className="editor-toolbar" id="note-formatting-controls" aria-label="Text formatting">
          <button title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!state.undo}
            onClick={() => editor.chain().focus().undo().run()}><AnimatedIcon kind="undo" size={20} /></button>
          <button title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!state.redo}
            onClick={() => editor.chain().focus().redo().run()}><AnimatedIcon kind="redo" size={20} /></button>
          <span className="toolbar-divider" />
          <AppSelect
            label="Text style" className="text-style-picker"
            value={state.heading}
            onChange={(value) => {
              const n = Number(value);
              if (n === 0) editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: n as 1 | 2 | 3 })
                  .run();
            }}
            onCloseFocus={() => editor.commands.focus()}
            options={[{ value: "0", label: "Text" }, { value: "1", label: "Heading 1" }, { value: "2", label: "Heading 2" }, { value: "3", label: "Heading 3" }]} />
          <span className="toolbar-divider" />
          <button
            title="Bold (Ctrl+B)"
            aria-label="Bold"
            aria-pressed={state.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <AnimatedIcon kind="bold" size={23} />
          </button>
          <button
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            aria-pressed={state.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <AnimatedIcon kind="italic" size={23} />
          </button>
          <span className="toolbar-divider" />
          <button className="checklist-button" aria-label="Code block" title="Code block (Ctrl+Alt+C)"
            aria-pressed={state.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            <AnimatedIcon kind="code" size={23} /><span>Code</span>
          </button>
          <button
            title="Bullet list (Ctrl+Shift+8)"
            aria-label="Bullet list"
            aria-pressed={state.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <AnimatedIcon kind="list" size={24} />
          </button>
          <button
            className="checklist-button"
            aria-label="Checklist"
            title="Checklist (Ctrl+Shift+9)"
            aria-pressed={state.taskList}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <AnimatedIcon kind="checklist" size={23} />
            <span>Checklist</span>
          </button>
          <button className="checklist-button" aria-label="Add images" title="Add images" disabled={imageLoading}
            onClick={onImageRequest}><AnimatedIcon kind="image" size={23} /><span>Image</span></button>
          <HighlighterTools editor={editor} settings={pen} change={changePen} />
          <button aria-label="Text and background color options" title="Text and background color options (select text, then Shift+F10)" disabled={!state.canColor}
            onClick={onColorsRequest}><AnimatedIcon kind="palette" size={23} /></button>
        </div>
  );
});

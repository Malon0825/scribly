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
import { HighlighterTools, usePenSettings } from "./HighlighterTools";
import { reportEditorReady } from "./startupTiming";
import { NotifyImage } from "./ImageBlock";
import { NotifySourceFile } from "./SourceFileBlock";
import { readImage, isImageFile, IMAGE_ACCEPT } from "./imageFiles";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { DOMSerializer, DOMParser as ProseMirrorParser } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { NoteSearch } from "./textSearch";
import { NoteFind, type FindRequest } from "./NoteFind";
import { ItemLink } from "./ItemLink";
import { NoteControls } from "./NoteControls";
import { Link as LinkIcon, DotsThree } from "@phosphor-icons/react";
import type { Note } from "./types";
export function NoteEditor({
  content,
  readOnly = false,
  onChange,
  onAppendReady,
  onImagesReady,
  validateContent,
  findRequest,
  onFindOpen,
  onLinkRequest, onItemLink, onExternalLink, onLinkReady,
}: {
  content: string;
  readOnly?: boolean;
  onChange?: (html: string) => void;
  onAppendReady?: (append: (html: string) => void) => void;
  onImagesReady?: (insert: (files: File[], point?: { left: number; top: number }) => void) => void;
  validateContent?: (html: string) => void;
  findRequest?: FindRequest;
  onFindOpen?: () => void;
  onLinkRequest?: (insert: (note: Note) => void, cancel: () => void) => void;
  onItemLink?: (id: string, anchor: HTMLElement, action: "open" | "reference" | "options", restoreFocus: () => void) => void;
  onExternalLink?: (href: string) => void;
  onLinkReady?: (request: () => void) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const linkHandlers = useRef({ onLinkRequest, onItemLink, onExternalLink, readOnly });
  linkHandlers.current = { onLinkRequest, onItemLink, onExternalLink, readOnly };
  const pendingLink = useRef<(() => void) | null>(null);
  const linkReady = useRef(onLinkReady); linkReady.current = onLinkReady;
  const surface = useRef<HTMLDivElement>(null);
  const [pen, changePen] = usePenSettings();
  const togglePenMode = useCallback(() => changePen({ mode: pen.mode === "guided" ? "free" : "guided" }), [changePen, pen.mode]);
  const exitPen = useCallback(() => changePen({ active: false }), [changePen]);
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
  const [find, setFind] = useState<FindRequest | null>(null);
  const [findVisible, setFindVisible] = useState(false);
  const findOpen = useRef(onFindOpen); findOpen.current = onFindOpen;
  useEffect(() => {
    if (!findVisible) return;
    const reveal = () => findOpen.current?.();
    reveal(); window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [findVisible]);

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
      NotifySourceFile,
      NoteSearch,
      ItemLink.configure({
        readOnly: () => linkHandlers.current.readOnly,
        activate: (id, anchor, action) => linkHandlers.current.onItemLink?.(id,anchor,action,() => editor?.commands.focus()),
        external: href => linkHandlers.current.onExternalLink?.(href),
      }),
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
    parseOptions: { preserveWhitespace: "full" },
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
  useEffect(() => { editor?.setEditable(!readOnly,false); }, [editor,readOnly]);
  useEffect(() => {
    if (!editor || readOnly) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      const pressed = event.key.toLowerCase();
      if (pressed !== 'd' && pressed !== 'g') return;
      const target = event.target;
      const panel = surface.current?.closest('.document-panel');
      if (!(target instanceof HTMLElement) || !panel?.contains(target) || target.closest('input, textarea, select, [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const tool = pressed === 'd' ? 'draw' : 'highlight';
      changePen({ tool, active: !(pen.active && pen.tool === tool) });
      document.dispatchEvent(new CustomEvent('notify:action-open', { detail: editor.view.dom }));
      editor.view.dom.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [editor, readOnly, changePen, pen.active, pen.tool]);
  const openFind = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setFind({ serial: Date.now(), query: editor.state.doc.textBetween(from, to, " "), replace: false });
    setFindVisible(true);
  };
  useEffect(() => {
    if (!findRequest || !editor) return;
    const { from, to } = editor.state.selection;
    setFind({ ...findRequest, query: findRequest.query ?? editor.state.doc.textBetween(from, to, " ") });
    setFindVisible(true);
  }, [findRequest, editor]);
  function requestItemLink() {
    if (!editor || !editor.isEditable || !linkHandlers.current.onLinkRequest) return;
    pendingLink.current?.();
    let bookmark = editor.state.selection.getBookmark();
    const map = ({ transaction }: { transaction: Transaction }) => { bookmark = bookmark.map(transaction.mapping); };
    editor.on("transaction",map);
    const release = () => { editor.off("transaction",map); pendingLink.current = null; };
    pendingLink.current = release;
    const cancel = () => { release(); if (!editor.isDestroyed) { editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc))); editor.commands.focus(); } };
    linkHandlers.current.onLinkRequest(note => {
      if (editor.isDestroyed || !editor.isEditable) { release(); return; }
      const tr = closeHistory(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
      const mark = editor.schema.marks.itemLink.create({ targetId:note.id });
      if (tr.selection.empty) tr.replaceSelectionWith(editor.schema.text(note.title || "Untitled",[mark]),false);
      else tr.addMark(tr.selection.from,tr.selection.to,mark);
      release(); editor.view.dispatch(tr.scrollIntoView()); editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.focus();
    },cancel);
  }
  useEffect(() => { linkReady.current?.(requestItemLink); return () => { pendingLink.current?.(); linkReady.current?.(() => {}); }; }, [editor]);
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
    if (editor.getHTML() !== content) editor.commands.setContent(content, { emitUpdate: false, parseOptions: { preserveWhitespace: "full" } });
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
      {(!readOnly || findVisible) && <NoteControls>
      {!readOnly && <EditorToolbar editor={editor} imageLoading={imageLoading} onImageRequest={requestImage} onColorsRequest={requestColors} onFindRequest={openFind} onLinkRequest={onLinkRequest ? requestItemLink : undefined} pen={pen} changePen={changePen} />}
      {find && <NoteFind editor={editor} request={find} open={findVisible} readOnly={readOnly} onClose={() => setFindVisible(false)} />}
      </NoteControls>}
      {!readOnly && <>
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
const EditorToolbar = memo(function EditorToolbar({ editor, imageLoading, onImageRequest, onColorsRequest, onFindRequest, onLinkRequest, pen, changePen }: {
  editor: Editor; imageLoading: boolean; onImageRequest: () => void; onColorsRequest: () => void; onFindRequest: () => void; pen: PenSettings; changePen: (next: Partial<PenSettings>) => void;
  onLinkRequest?: () => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [more, setMore] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const extra = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const tools = extra.current;
    if (!tools) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(element).gap) || 0;
      const extraGap = parseFloat(getComputedStyle(tools).gap) || 0;
      const primary = Array.from(element.children).filter(child => !child.matches('.toolbar-extra, .toolbar-spacer, .toolbar-more'));
      const secondary = Array.from(tools.children);
      const width = (items: Element[]) => items.reduce((total, child) => {
        const style = getComputedStyle(child);
        return total + child.getBoundingClientRect().width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
      }, 0);
      const required = width(primary) + width(secondary) + Math.max(0, secondary.length - 1) * extraGap + primary.length * gap;
      setCompact(element.clientWidth + 1 < required);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element); resize.observe(tools);
    for (const child of tools.children) resize.observe(child);
    measure();
    return () => resize.disconnect();
  }, [compact, pen.active]);
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    heading: editor.isActive("heading", { level: 1 }) ? "1"
      : editor.isActive("heading", { level: 2 }) ? "2"
      : editor.isActive("heading", { level: 3 }) ? "3" : "0",
    bold: editor.isActive("bold"), italic: editor.isActive("italic"),
    codeBlock: editor.isActive("codeBlock"), bulletList: editor.isActive("bulletList"),
    taskList: editor.isActive("taskList"),
    canColor: canColorSelection(editor),
  }) });
  const extraTools = <div ref={extra} className="toolbar-extra">
          <button className="checklist-button" aria-label="Code block" title="Code block (Ctrl+Alt+C)"
            aria-pressed={state.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            <AnimatedIcon kind="code" size={20} /><span>Code</span>
          </button>
          <button
            title="Bullet list (Ctrl+Shift+8)"
            aria-label="Bullet list"
            aria-pressed={state.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <AnimatedIcon kind="list" size={20} />
          </button>
          <button
            className="checklist-button"
            aria-label="Checklist"
            title="Checklist (Ctrl+Shift+9)"
            aria-pressed={state.taskList}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <AnimatedIcon kind="checklist" size={20} />
            <span>Checklist</span>
          </button>
          <button className="checklist-button" aria-label="Add images" title="Add images (Enter to choose a file)" disabled={imageLoading}
            onClick={onImageRequest}><AnimatedIcon kind="image" size={20} /><span>Image</span></button>
          <HighlighterTools editor={editor} settings={pen} change={changePen} />
          {onLinkRequest && <button aria-label="Link to item" title="Link to a note or board (Ctrl+L)" onClick={onLinkRequest}><LinkIcon size={20} /></button>}
          <button aria-label="Text and background color options" title="Text and background color options (select text, then Shift+F10)" disabled={!state.canColor}
            onClick={onColorsRequest}><AnimatedIcon kind="palette" size={20} /></button>
  </div>;
  return (
      <>
        <div ref={toolbar} className={`editor-toolbar${compact ? " is-compact" : ""}`} id="note-formatting-controls" aria-label="Text formatting">
          <AppSelect
            label="Text style" title="Text style (Ctrl+Alt+1/2/3)" className="text-style-picker"
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
            <AnimatedIcon kind="bold" size={20} />
          </button>
          <button
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            aria-pressed={state.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <AnimatedIcon kind="italic" size={20} />
          </button>
          {!compact && extraTools}
          {compact && <button ref={moreButton} className="toolbar-more" title="More formatting tools (Enter to expand)" aria-label="More formatting tools" aria-expanded={more} aria-controls="extra-formatting-tools" onClick={() => setMore(value => !value)}><DotsThree size={20} /></button>}
          <div className="toolbar-spacer" />
          <button aria-label="Find in note" title="Find in note (Ctrl+F)" onClick={onFindRequest}><AnimatedIcon kind="search" size={20} /></button>
        </div>
        {compact && <div className={`quiet-disclosure${more ? ' is-open' : ''}`} inert={!more} aria-hidden={!more} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMore(false); moreButton.current?.focus(); } }}><div><div id="extra-formatting-tools" className="toolbar-more-row">{extraTools}</div></div></div>}
      </>
  );
});

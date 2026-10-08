import { AnimatedIcon } from "./AnimatedIcon";
import { useSurfaceMotion } from './useSurfaceMotion';
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Trash, DotsSixVertical } from "@phosphor-icons/react";
import { ActionPopover } from "./ActionPopover";
import { downloadImage, safeImageSource } from "./imageFiles";
import { imageAlign, imageWidth } from "./ImageBlock";
import { displayImageSource } from "./attachments";

function ImagePreview({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useSurfaceMotion(backdrop, 'dialog', 'image-preview');
  const [actualSize, setActualSize] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current!;
    el.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === "Tab") {
        const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button"));
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); if (previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [onClose]);
  return createPortal(<div ref={backdrop} className="modal-backdrop image-preview-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Image preview" className="image-preview">
      <div className="image-preview-actions"><span>{alt || "Image"}</span>
        <button aria-label="Actual image size" aria-pressed={actualSize} title={actualSize ? "Fit image to window" : "View at actual size"} onClick={() => setActualSize((value) => !value)}><AnimatedIcon kind="zoom" size={20} /></button>
        <button aria-label="Download image" onClick={() => void downloadImage(src, alt).catch(e => setDownloadError(String(e)))}><AnimatedIcon kind="download" size={20} /></button>
        <button aria-label="Close image preview" onClick={onClose}><AnimatedIcon kind="close" size={22} /></button>
      </div>
      {downloadError && <p className="startup-setting-error" role="alert">Image download failed: {downloadError}</p>}
      <div className="image-preview-scroll"><img data-actual-size={actualSize || undefined} src={displayImageSource(src)} alt={alt} decoding="async" /></div>
    </div>
  </div>, document.body);
}

export function ImageBlockView({ node, editor, selected, updateAttributes, deleteNode, getPos }: ReactNodeViewProps) {
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false), [preview, setPreview] = useState(false), [captioning, setCaptioning] = useState(false), [failed, setFailed] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const width = imageWidth(node.attrs.width), align = imageAlign(node.attrs.align);
  const sourceValid = safeImageSource(node.attrs.src);
  useEffect(() => { setFailed(false); }, [node.attrs.src]);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => { if (captioning) captionRef.current?.focus(); }, [captioning]);
  function select() {
    const pos = getPos();
    if (editor.isEditable && typeof pos === "number") editor.commands.setNodeSelection(pos);
  }
  function resize(event: PointerEvent<HTMLButtonElement>, side: number) {
    if (event.button !== 0) return;
    event.preventDefault(); select(); dragCleanup.current?.();
    const el = frame.current!, handle = event.currentTarget;
    const container = el.parentElement!;
    const available = container.getBoundingClientRect().width;
    const initial = el.getBoundingClientRect().width;
    const start = event.clientX;
    const factor = side * (align === "center" ? 2 : 1);
    let next = width, finished = false;
    handle.setPointerCapture(event.pointerId);
    el.dataset.resizing = "true";
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      next = Math.max(20, Math.min(100, (initial + (e.clientX - start) * factor) / available * 100));
      el.style.width = `${next}%`;
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel); handle.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel); document.removeEventListener("keydown", key, true);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      delete el.dataset.resizing;
      el.style.width = `${commit ? next : width}%`;
      dragCleanup.current = null;
      if (commit && !editor.isDestroyed) updateAttributes({ width: Math.round(next * 10) / 10 });
    };
    const up = (e: globalThis.PointerEvent) => { if (e.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel); handle.addEventListener("lostpointercapture", cancel);
    window.addEventListener("blur", cancel); window.addEventListener("resize", cancel); document.addEventListener("keydown", key, true);
    dragCleanup.current = cancel;
  }
  function moveBlock(direction: number) {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const $pos = editor.state.doc.resolve(pos), index = $pos.index();
    const neighbor = $pos.parent.maybeChild(index + direction);
    if (!neighbor) return;
    const target = direction < 0 ? pos - neighbor.nodeSize : pos + neighbor.nodeSize;
    const tr = editor.state.tr.delete(pos, pos + node.nodeSize).insert(target, node);
    tr.setSelection(NodeSelection.create(tr.doc, target));
    editor.view.dispatch(tr.scrollIntoView()); editor.commands.focus(); setMenu(false);
  }
  return <NodeViewWrapper className="image-block" data-align={align} data-selected={selected || undefined} contentEditable={false}>
    <div className="image-block-frame" ref={frame} style={{ width: `${width}%` }}>
      {sourceValid && !failed ? <img className="note-image" src={displayImageSource(node.attrs.src)} alt={node.attrs.alt} draggable={false} decoding="async"
        onError={() => setFailed(true)} onClick={select} onDoubleClick={() => setPreview(true)} />
        : <div className="image-unavailable">Image unavailable</div>}
      <div className="image-block-tools">
        {editor.isEditable && <span className="image-drag-handle" data-drag-handle title="Drag to move image"><DotsSixVertical size={19} /></span>}
        {sourceValid && !failed && <button aria-label="View image" title="View full-size image" onClick={() => setPreview(true)}><AnimatedIcon kind="zoom" size={18} /></button>}
        <button ref={anchor} aria-label="Image options" aria-expanded={menu} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); select(); setMenu((open) => !open); }}><AnimatedIcon kind="options" size={22} /></button>
      </div>
      {editor.isEditable && [-1, 1].map((side) => <button key={side} className={`image-resize-handle ${side < 0 ? "left" : "right"}`} aria-label={side < 0 ? "Resize image from left" : "Resize image from right"}
        title="Drag to resize; arrow keys adjust width" onPointerDown={(e) => resize(e, side)} onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault(); e.stopPropagation();
            updateAttributes({ width: e.key === "Home" ? 20 : e.key === "End" ? 100 : Math.max(20, Math.min(100, width + (e.key === "ArrowRight" ? 5 : -5))) });
          }
        }}><span /></button>)}
      {(node.attrs.caption || captioning) && (editor.isEditable ? <input ref={captionRef} className="image-caption" aria-label="Image caption" placeholder="Add a caption…" maxLength={2000} value={node.attrs.caption}
        onChange={(e) => updateAttributes({ caption: e.target.value })} onBlur={() => setCaptioning(false)} onKeyDown={(e) => {
          e.stopPropagation(); if (["Enter", "Escape"].includes(e.key)) { e.preventDefault(); setCaptioning(false); editor.commands.focus(); }
        }} /> : <div className="image-caption">{node.attrs.caption}</div>)}
    </div>
    {downloadError && <p className="startup-setting-error" role="alert">Image download failed: {downloadError}</p>}
    {menu && <ActionPopover anchor={anchor.current} label="Image actions" className="image-actions" onClose={() => setMenu(false)}>
      {sourceValid && !failed && <button onClick={() => { setMenu(false); setPreview(true); }}><AnimatedIcon kind="zoom" size={18} />View full size</button>}
      {sourceValid && <button onClick={() => { void downloadImage(node.attrs.src, node.attrs.title || node.attrs.alt).catch(e => setDownloadError(String(e))); setMenu(false); }}><AnimatedIcon kind="download" size={18} />Download image</button>}
      {editor.isEditable && <>
        <button onClick={() => { setMenu(false); setCaptioning(true); }}>Edit caption</button>
        {(["left", "center", "right"] as const).map(value => {
          return <button key={String(value)} aria-pressed={align === value} onClick={() => { updateAttributes({ align: value }); setMenu(false); }}><AnimatedIcon kind={value === "left" ? "alignLeft" : value === "center" ? "alignCenter" : "alignRight"} size={18} />Align {String(value)}</button>;
        })}
        <button onClick={() => { updateAttributes({ width: 100 }); setMenu(false); }}>Full width</button>
        <button onClick={() => moveBlock(-1)}><AnimatedIcon kind="moveUp" size={18} />Move up</button>
        <button onClick={() => moveBlock(1)}><AnimatedIcon kind="moveDown" size={18} />Move down</button>
        <button className="danger-text" onClick={() => { setMenu(false); deleteNode(); editor.commands.focus(); }}><Trash size={18} />Remove image</button>
      </>}
    </ActionPopover>}
    {preview && sourceValid && <ImagePreview src={node.attrs.src} alt={node.attrs.alt} onClose={() => setPreview(false)} />}
  </NodeViewWrapper>;
}

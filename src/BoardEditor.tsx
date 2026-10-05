import { AnimatedIcon } from "./AnimatedIcon";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Excalidraw, CaptureUpdateAction, restoreElements, getNonDeletedElements, exportToBlob, exportToSvg, newElementWith, convertToExcalidrawElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { DataURL } from "@excalidraw/excalidraw/types";
import { Selection, WarningCircle } from "@phosphor-icons/react";
import { AppSelect } from "./AppSelect";
import { ActionPopover } from "./ActionPopover";
import { Dialog } from "./Dialog";
import { BoardBoundary } from "./BoardBoundary";
import { architectureTag, activeBoardFiles, portableBoard, validateBoard, MAX_BOARD_ELEMENTS, type BoardData, type ArchitectureRole } from "./boardData";
import { BrandLogoPicker } from "./BrandLogoPicker";
import { renderBrandLogo, type BrandLogo } from "./brandLogos";
import type { Workspace } from "./types";
import { boardToMermaid, elementLabel, isNodeShape, canAssignBoundary, type MermaidConversion } from "./boardMermaid";
import { renderMermaid } from "./boardMermaidRuntime";
import { exportArtifact } from "./storage";
import { readImage } from "./imageFiles";
import { itemHref, itemIdFromHref } from "./itemLinks";
import type { Note } from "./types";
import "@excalidraw/excalidraw/index.css";
import "./board.css";

export type BoardEditorProps = {
  id: string; title: string; board: BoardData; dark: boolean; readOnly: boolean;
  notebook?: boolean;
  focusMode?: boolean;
  controlsHost?: HTMLElement | null;
  searchTarget?: { elementId: string; serial: number };
  checkpoint: () => Workspace | null;
  registerDraft: (id: string, reader: (force?: boolean) => BoardData | null) => () => void;
  onDirty: () => void;
  onCreateBoard: (mode: "import" | "template") => void;
  onShowTools: () => void;
  onLinkRequest?: (insert: (note: Note) => void, cancel: () => void) => void;
  onLinkReady?: (request: () => void) => void;
  onItemLink?: (id: string, reference: boolean) => void;
  onExternalLink?: (href: string) => void;
};
const filename = (title: string) => title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "Board";
const fileSignatures = new WeakMap<object, { dataURL: string; hash: number }>();
const fileSignature = (file: BinaryFiles[string]) => {
  const cached = fileSignatures.get(file);
  if (cached?.dataURL === file.dataURL) return cached.hash;
  let hash = 2166136261;
  for (let i = 0; i < file.dataURL.length; i++) hash = Math.imul(hash ^ file.dataURL.charCodeAt(i), 16777619);
  fileSignatures.set(file, { dataURL: file.dataURL, hash }); return hash;
};
const fingerprint = (elements: readonly ExcalidrawElement[], state: BoardData["appState"], files: BinaryFiles) =>
  `${elements.map((e) => `${e.id}:${e.version}:${e.versionNonce}:${e.isDeleted}:${e.index}`).join("|")}/${state.viewBackgroundColor}/${state.gridSize}/${Object.keys(files).sort().map((id) => `${id}:${fileSignature(files[id])}`).join("|")}`;

export default function BoardEditor({ id, title, board, dark, readOnly, notebook = false, focusMode = false, controlsHost, searchTarget, checkpoint, registerDraft, onDirty, onCreateBoard, onShowTools, onLinkRequest, onLinkReady, onItemLink, onExternalLink }: BoardEditorProps) {
  const initial = useRef(board), live = useRef(board);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [engine, setEngine] = useState<ExcalidrawImperativeAPI | null>(null);
  // Paper is presentation only; keep the authored background for saving/export.
  useEffect(() => {
    engine?.updateScene({ appState: { viewBackgroundColor: notebook ? "transparent" : live.current.appState.viewBackgroundColor ?? "#ffffff" }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [engine, notebook]);
  const linkHandlers = useRef({ onLinkRequest,onLinkReady,readOnly }); linkHandlers.current = { onLinkRequest,onLinkReady,readOnly };
  function requestItemLink() {
    const instance = api.current; if (!instance || linkHandlers.current.readOnly) return;
    const selected = new Set(Object.keys(instance.getAppState().selectedElementIds));
    linkHandlers.current.onLinkRequest?.(note => {
      if (api.current !== instance || linkHandlers.current.readOnly) return;
      let elements = instance.getSceneElements();
      const matches = elements.filter(element => selected.has(element.id) && !element.isDeleted);
      if (matches.length) elements = elements.map(element => selected.has(element.id) && !element.isDeleted ? newElementWith(element,{ link:itemHref(note.id) }) : element);
      else {
        const state = instance.getAppState();
        const point = viewportCoordsToSceneCoords({ clientX:state.offsetLeft + state.width/2,clientY:state.offsetTop + state.height/2 },state);
        const added = convertToExcalidrawElements([{ type:"text",x:point.x,y:point.y,text:note.title || "Untitled",fontSize:20 }]).map(element => newElementWith(element,{ link:itemHref(note.id) }));
        elements = [...elements,...added];
      }
      instance.updateScene({ elements,captureUpdate:CaptureUpdateAction.IMMEDIATELY });
      setMessage("Item link added. Use its canvas link control to open the target.");
    },() => {});
  }
  useEffect(() => { linkHandlers.current.onLinkReady?.(requestItemLink); return () => linkHandlers.current.onLinkReady?.(() => {}); }, [engine]);
  const revealedSearch = useRef<number | null>(null), searchFrame = useRef<number | undefined>(undefined);
  function revealSearch(engine: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[] = engine.getSceneElements()) {
    if (!searchTarget || revealedSearch.current === searchTarget.serial) return;
    const target = elements.find(element => element.id === searchTarget.elementId && !element.isDeleted);
    if (!target) return;
    revealedSearch.current = searchTarget.serial;
    const id = target.type === "text" && target.containerId ? target.containerId : target.id;
    const element = engine.getSceneElements().find(entry => entry.id === id) || target;
    engine.updateScene({ appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
    engine.scrollToContent([element], { animate: false });
    setMessage(`Matched ${target.type === "frame" ? "frame" : "text"}: ${(target.type === "text" ? target.text : target.type === "frame" ? target.name || "" : "").slice(0, 100)}`);
  }
  useEffect(() => {
    if (engine) revealSearch(engine);
  }, [engine, searchTarget?.serial]);
  useEffect(() => () => { if (searchFrame.current !== undefined) cancelAnimationFrame(searchFrame.current); }, []);
  const canvasOwner = useRef<HTMLElement | null>(null);
  const insertTrigger = useRef<HTMLButtonElement | null>(null);
  const exportTrigger = useRef<HTMLButtonElement | null>(null), codeField = useRef<HTMLTextAreaElement | null>(null), copyButton = useRef<HTMLButtonElement | null>(null);
  const copyAttempt = useRef(0), copying = useRef(false);
  const returnToCanvas = useRef(false);
  const dirty = useRef(false), signature = useRef(fingerprint(board.elements, board.appState, board.files));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointers = useRef(new Set<number>());
  const snapshot = useRef<{ source: BoardData; value: BoardData } | null>(null);
  const [selection, setSelection] = useState<string[]>([]), selectionKey = useRef("");
  const [inspector, setInspector] = useState(false), [exporting, setExporting] = useState(false);
  const [brandPicker, setBrandPicker] = useState(false);
  const [commandMenu, setCommandMenu] = useState<"insert" | "export" | null>(null);
  const [snap, setSnap] = useState(true);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [direction, setDirection] = useState(board.exportDirection);
  const [conversion, setConversion] = useState(() => boardToMermaid(board));
  const [, refreshInspector] = useState(0);
  const [svg, setSvg] = useState(""), [previewError, setPreviewError] = useState(""), [partial, setPartial] = useState(false);
  const [manualCopy, setManualCopy] = useState(false), [copyBusy, setCopyBusy] = useState(false);
  const needsReview = conversion.issues.some(issue => issue.requiresReview);
  useEffect(() => () => { copyAttempt.current++; }, []);
  const safeCheckpoint = () => { try { checkpoint(); setError(""); } catch (e) { setError(String(e)); } };
  const contextMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const popover = target.closest('.popover');
    const menu = popover?.querySelector('.context-menu');
    if (!menu) return;
    if ((event.key === 'Enter' || event.key === ' ') && target.closest('.context-menu-item')) {
      // Keep native button activation; the canvas otherwise consumes Enter
      // to start editing a shape label (and Space to pan the drawing).
      event.stopPropagation(); return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      // The engine's generic Popover traps Tab. This nonmodal action menu
      // should dismiss and return keyboard ownership to its live canvas.
      event.stopPropagation();
      if (event.key === 'Escape') event.preventDefault();
      api.current?.updateScene({ appState: { contextMenu: null }, captureUpdate: CaptureUpdateAction.NEVER });
      target.closest<HTMLElement>('.excalidraw')?.focus({ preventScroll: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView({ block: 'nearest' });
  };
  useEffect(() => {
    if (focusMode) api.current?.updateScene({ appState: { openSidebar: null }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [focusMode]);
  useEffect(() => registerDraft(id, (force = true) => {
    if (!dirty.current || (!force && pointers.current.size)) return null;
    if (snapshot.current?.source !== live.current) {
      // Excalidraw mutates element objects during gestures. Detach geometry at
      // the boundary; immutable dataURL strings can stay shared without a
      // stringify/parse round trip through megabytes of image data.
      snapshot.current = { source: live.current, value: { ...live.current,
        elements: structuredClone(live.current.elements),
        files: Object.fromEntries(Object.entries(live.current.files).map(([key, file]) => [key, { ...file }])),
      } };
    }
    return snapshot.current.value;
  }), [id, registerDraft]);
  useEffect(() => {
    // Acknowledge a checkpoint without pushing saved echoes into canvas history.
    if (fingerprint(board.elements, board.appState, board.files) === signature.current && board.exportDirection === live.current.exportDirection) dirty.current = false;
  }, [board]);
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId) || pointers.current.size || !dirty.current) return;
      clearTimeout(timer.current);
      // Let the engine finish its pointer-up/cancel transaction first.
      timer.current = setTimeout(safeCheckpoint, 350);
    };
    const blur = () => { pointers.current.clear(); };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", blur);
    return () => {
      clearTimeout(timer.current); pointers.current.clear();
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const pending = () => {
    dirty.current = true; onDirty(); clearTimeout(timer.current);
    if (!pointers.current.size) timer.current = setTimeout(safeCheckpoint, 350);
  };
  const capture = (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    setSnap(state.objectsSnapModeEnabled);
    if (api.current && searchTarget && revealedSearch.current !== searchTarget.serial) {
      if (searchFrame.current !== undefined) cancelAnimationFrame(searchFrame.current);
      const currentEngine = api.current;
      searchFrame.current = requestAnimationFrame(() => { if (api.current === currentEngine) revealSearch(currentEngine, elements); });
    }
    const selected = Object.keys(state.selectedElementIds).filter((key) => state.selectedElementIds[key]);
    const key = selected.join("|");
    if (key !== selectionKey.current) { selectionKey.current = key; setSelection(selected); }
    const settings = { viewBackgroundColor: notebook || state.viewBackgroundColor === "transparent"
      ? live.current.appState.viewBackgroundColor : state.viewBackgroundColor, gridSize: state.gridSize };
    // The canvas keeps deleted image data for session Undo. Persist only live
    // images so removing one actually frees notebook capacity.
    files = activeBoardFiles(elements, files);
    const next = fingerprint(elements, settings, files);
    if (signature.current === next || readOnly) return;
    signature.current = next; live.current = { ...live.current, elements, files, appState: settings }; pending();
  };
  const selectedElements = api.current?.getSceneElements().filter((e) => selection.includes(e.id)) || [];
  const editableSelection = selectedElements.filter((e) => isNodeShape(e) || e.type === "frame" || e.type === "arrow" || e.type === "line");
  const canChooseParent = !!editableSelection.length && editableSelection.every((e) => isNodeShape(e) || (e.type === "frame" && architectureTag(e)?.role === "boundary"));
  const boundaries = live.current.elements.filter((e) => !e.isDeleted && architectureTag(e)?.role === "boundary");
  const tag = editableSelection.length === 1 ? architectureTag(editableSelection[0]) : undefined;
  const changeTag = (role: ArchitectureRole | null, parentId?: string) => {
    if (!api.current || readOnly) return;
    const ids = new Set(editableSelection.map((e) => e.id));
    api.current.updateScene({ elements: api.current.getSceneElementsIncludingDeleted().map((e) => ids.has(e.id)
      ? newElementWith(e, { customData: { ...e.customData, notifyArchitecture: { version: 1, role: role || (architectureTag(e)?.role === "boundary" ? "boundary" : "component"), sourceId: e.id, ...(parentId ? { parentId } : {}) } } }) : e), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    capture(api.current.getSceneElementsIncludingDeleted(), api.current.getAppState(), api.current.getFiles());
    refreshInspector((n) => n + 1); safeCheckpoint();
  };
  const openExport = (result = boardToMermaid(live.current), fallback = false) => {
    safeCheckpoint(); returnToCanvas.current = false; setConversion(result); setPartial(false); setManualCopy(fallback); setMessage(""); setExporting(true);
  };
  const closeExport = () => { copyAttempt.current++; setExporting(false); setManualCopy(false); setCopyBusy(false); copying.current = false; };
  const copyMermaid = async (result: MermaidConversion, reviewed = false) => {
    if (copying.current) return;
    if (!result.nodes || (result.issues.some(issue => issue.requiresReview) && !reviewed)) { openExport(result); return; }
    copying.current = true; setCopyBusy(true); setError(""); setMessage(""); const attempt = ++copyAttempt.current;
    try {
      await navigator.clipboard.writeText(result.code);
      if (attempt === copyAttempt.current) setMessage(`Copied Mermaid. Paste onto your Miro board. Miro arranges the shapes; logos stay in this drawing.${result.issues.length ? " Some labels or arrowheads were simplified." : ""}`);
    } catch {
      if (attempt === copyAttempt.current) {
        if (!exporting) openExport(result, true);
        else setManualCopy(true);
        setMessage("Clipboard unavailable. The code is selected: press Ctrl+C, or download Mermaid.");
      }
    } finally { if (attempt === copyAttempt.current) { copying.current = false; setCopyBusy(false); } }
  };
  useEffect(() => {
    // Initial focus belongs to Dialog, including StrictMode remounts. Only a
    // clipboard failure inside an already open dialog changes that target.
    if (exporting && manualCopy) { codeField.current?.focus(); codeField.current?.select(); }
  }, [exporting, manualCopy]);
  useEffect(() => {
    if (!exporting) return;
    let canceled = false; setSvg(""); setPreviewError("");
    if (!conversion.nodes) { setPreviewError("Your flowchart preview will appear here once you add shapes."); return; }
    const render = async () => {
      if (conversion.nodes > 300 || conversion.code.length > 100_000) throw Error("Large diagram: download Mermaid code to preview in your diagram tool.");
      const result = await renderMermaid(conversion.code, dark);
      if (!canceled) setSvg(result);
    };
    void render().catch((e) => { if (!canceled) setPreviewError(String(e)); });
    return () => { canceled = true; };
  }, [exporting, conversion, dark]);
  const save = async (extension: string, value: string | Blob, mime: string) => {
    setError(""); setMessage("");
    try { if (await exportArtifact(`${filename(title)}.${extension}`, value, mime)) setMessage("Export saved."); }
    catch (e) { setError(String(e)); }
  };
  const exportScene = () => { safeCheckpoint(); void save("excalidraw", JSON.stringify(portableBoard(live.current), null, 2), "application/json"); };
  const insertBrand = async (icon: BrandLogo, variant: string, darkBackground: boolean, signal: AbortSignal) => {
    const rendered = await renderBrandLogo(icon, variant, signal);
    signal.throwIfAborted();
    const engine = api.current;
    if (!engine || readOnly) throw Error("This board is no longer editable.");
    const current = engine.getSceneElementsIncludingDeleted();
    if (current.filter(e => !e.isDeleted).length + 2 > MAX_BOARD_ELEMENTS) throw Error("This board has reached its 2,500 element limit. Remove some elements before inserting a logo.");
    const state = engine.getAppState();
    const center = viewportCoordsToSceneCoords({ clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 }, state);
    const width = Math.min(112, 64 * rendered.ratio), height = width / rendered.ratio;
    const padding = 8, componentWidth = width + padding * 2, componentHeight = height + padding * 2;
    let x = center.x - componentWidth / 2, y = center.y - componentHeight / 2;
    // Place neighboring components with a gap, rather than stacking logos.
    const occupied = current.filter(e => !e.isDeleted && isNodeShape(e) && architectureTag(e)?.role !== "boundary");
    for (let slot = 0; slot < 60; slot++) {
      const column = [0, 1, -1][slot % 3], row = Math.ceil(Math.floor(slot / 3) / 2) * (Math.floor(slot / 3) % 2 ? 1 : -1);
      x = center.x - componentWidth / 2 + column * (componentWidth + 40); y = center.y - componentHeight / 2 + row * (componentHeight + 40);
      if (!occupied.some(e => x < e.x + e.width + 16 && x + componentWidth + 16 > e.x && y < e.y + e.height + 16 && y + componentHeight + 16 > e.y)) break;
    }
    const group = crypto.randomUUID(), component = crypto.randomUUID();
    const fileId = `brand-${icon.slug}-${variant}-v3.3.12-trimmed` as FileId;
    const elements = convertToExcalidrawElements([
      { type: "rectangle", id: component, x, y, width: componentWidth, height: componentHeight, strokeColor: "#64748b", backgroundColor: darkBackground ? "#1e293b" : "#ffffff", fillStyle: "solid", roughness: 0, strokeWidth: 1, groupIds: [group], customData: { notifyArchitecture: { version: 1, role: "component", sourceId: component }, notifyBrand: { source: "theSVG", version: "3.3.12", slug: icon.slug, variant, title: icon.title, license: icon.license, url: icon.url } } },
      { type: "image", x: x + padding, y: y + padding, width, height, fileId, status: "saved", scale: [1, 1], groupIds: [group] },
    ], { regenerateIds: false });
    const file = { id: fileId, dataURL: rendered.dataURL as DataURL, mimeType: "image/png" as const, created: Date.now() };
    const candidate = { ...live.current, elements: [...current, ...elements], files: { ...activeBoardFiles(current, engine.getFiles()), [fileId]: file } };
    validateBoard(candidate);
    const workspace = checkpoint();
    if (!workspace) throw Error("Open the notebook before inserting a logo.");
    signal.throwIfAborted();
    // Preflight first, then one immediate scene transaction for Undo/autosave.
    engine.addFiles([file]);
    engine.updateScene({ elements: candidate.elements, appState: { selectedElementIds: Object.fromEntries(elements.map(e => [e.id, true])), selectedGroupIds: { [group]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    engine.setActiveTool({ type: "selection" });
    capture(engine.getSceneElementsIncludingDeleted(), engine.getAppState(), engine.getFiles());
  };
  const exportImage = async (type: "svg" | "png") => {
    try {
      safeCheckpoint(); const elements = getNonDeletedElements(live.current.elements);
      if (!elements.length) throw Error("Draw something before exporting an image.");
      const options = { elements, appState: { ...live.current.appState, exportWithDarkMode: dark, exportBackground: true }, files: live.current.files, maxWidthOrHeight: 4096 };
      if (type === "svg") await save("svg", (await exportToSvg(options)).outerHTML, "image/svg+xml");
      else await save("png", await exportToBlob(options), "image/png");
    } catch (e) { setError(String(e)); }
  };
  // Defaults affect newly drawn elements only; existing scene styles stay intact.
  const initialData = useMemo(() => ({ ...initial.current, elements: restoreElements(initial.current.elements, null, { repairBindings: true }).map((e) => architectureTag(e) ? { ...e, customData: { ...e.customData, notifyArchitecture: { ...architectureTag(e), sourceId: e.id } } } : e), appState: { ...initial.current.appState, viewBackgroundColor: notebook ? "transparent" : initial.current.appState.viewBackgroundColor, currentItemRoughness: 0, currentItemArrowType: "elbow" as const, objectsSnapModeEnabled: true, activeTool: { type: "selection" as const, customType: null, locked: false, lastActiveTool: null }, scrollX: 0, scrollY: 0 } }), []);
  const duplicate = (next: readonly ExcalidrawElement[], prev: readonly ExcalidrawElement[]) => {
    const oldIds = new Set(prev.map((e) => e.id)), remap = new Map<string, string>();
    for (const copy of next.filter((e) => !oldIds.has(e.id))) {
      const sourceId = architectureTag(copy)?.sourceId;
      if (sourceId) remap.set(sourceId, copy.id);
    }
    return next.map((e) => {
      const tag = architectureTag(e), parent = tag?.parentId;
      return !oldIds.has(e.id) && tag ? newElementWith(e, { customData: { ...e.customData, notifyArchitecture: { ...tag, sourceId: e.id, ...(parent && remap.has(parent) ? { parentId: remap.get(parent) } : {}) } } }) : e;
    });
  };
  const commands = <div className="board-commands" role="group" aria-label="Board commands">
    {!readOnly && <button id="board-insert-trigger" ref={insertTrigger} aria-haspopup="dialog" aria-expanded={commandMenu === "insert"} onClick={() => setCommandMenu(commandMenu === "insert" ? null : "insert")} title="Insert logos, templates, Mermaid or library shapes"><AnimatedIcon kind="add" size={18} />Insert<AnimatedIcon kind="down" size={14} /></button>}
    <button aria-pressed={inspector} aria-expanded={inspector} aria-controls="architecture-inspector" onClick={() => { setCommandMenu(null); onShowTools(); setInspector(!inspector); }} title="Architecture roles, boundaries and snapping"><AnimatedIcon kind="board" size={18} /><span>Architecture</span></button>
    <button ref={exportTrigger} aria-haspopup="dialog" aria-expanded={commandMenu === "export"} onClick={() => setCommandMenu(commandMenu === "export" ? null : "export")} title="Export this board"><AnimatedIcon kind="download" size={18} />Export<AnimatedIcon kind="down" size={14} /></button>
  </div>;
  return <section ref={canvasOwner} className="board-editor" aria-label="Architecture board">
    {controlsHost && createPortal(commands, controlsHost)}
    <div className="board-top-controls" id="board-secondary-controls" role="group" aria-label="Board commands and architecture properties">
    {!controlsHost && commands}
    {inspector && <div className="architecture-inspector" id="architecture-inspector">
      <span><Selection size={18} />{editableSelection.length ? `${editableSelection.length} selected` : "Select a shape or connection"}</span>
      <div className="architecture-roles" role="group" aria-label="Architecture role">
        {(["component", "boundary", "annotation"] as const).map((role) => <button key={role} disabled={readOnly || !editableSelection.length || (role !== "annotation" && editableSelection.some((e) => !isNodeShape(e) && !(role === "boundary" && e.type === "frame")))} aria-pressed={tag?.role === role || (role === "component" && !tag && editableSelection.length === 1 && isNodeShape(editableSelection[0]))} onClick={() => changeTag(role)}>{role[0].toUpperCase() + role.slice(1)}</button>)}
      </div>
      <AppSelect label="Architecture boundary" className="boundary-picker" value={tag?.parentId || ""} disabled={readOnly || !canChooseParent}
        options={[{ value: "", label: "No boundary" }, ...boundaries.filter((e) => canAssignBoundary(live.current.elements, selection, e.id)).map((e) => ({ value: e.id, label: elementLabel(e, live.current.elements) || "Untitled boundary" }))]} onChange={(value) => changeTag(null, value || undefined)} />
      <button disabled={readOnly} aria-pressed={snap} onClick={() => api.current?.updateScene({ appState: { objectsSnapModeEnabled: !snap, gridModeEnabled: false }, captureUpdate: CaptureUpdateAction.NEVER })}>Snap to objects</button>
      <small>Boundaries become Mermaid subgraphs. Annotations stay in the drawing. Select multiple shapes to align them with the canvas controls.</small>
    </div>}
    </div>
    <div className="board-canvas" onKeyDownCapture={contextMenuKey} onPointerDownCapture={(e) => {
      if (readOnly || e.button !== 0) return;
      pointers.current.add(e.pointerId); clearTimeout(timer.current);
    }} onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}>
      <BoardBoundary board={board} recovery={() => live.current}>
      <Excalidraw name={title} theme={dark ? "dark" : "light"} initialData={initialData} excalidrawAPI={(value) => { api.current = value; setEngine(value); }} handleKeyboardGlobally={false} viewModeEnabled={readOnly} aiEnabled={false} validateEmbeddable={false}
        onLinkOpen={(element,event) => { event.preventDefault(); const target = itemIdFromHref(element.link); if (target) onItemLink?.(target,event.detail.nativeEvent.altKey); else if (element.link) onExternalLink?.(element.link); }}
        onChange={capture} onDuplicate={duplicate}
        generateIdForFile={async (file) => { await readImage(file); return crypto.randomUUID(); }}
        onPaste={async (_data, event) => { for (const file of Array.from(event?.clipboardData?.files || [])) { try { await readImage(file); } catch (e) { setError(String(e)); return false; } } return true; }}
        UIOptions={{ canvasActions: { changeViewBackgroundColor: !notebook, loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }} />
      </BoardBoundary>
    </div>
    {commandMenu && <ActionPopover anchor={commandMenu === "insert" ? insertTrigger.current : exportTrigger.current} label={commandMenu === "insert" ? "Insert into board" : "Export this board"} className="board-command-menu" onClose={() => setCommandMenu(null)}>
      {commandMenu === "insert" ? <>
        <button onClick={() => { setCommandMenu(null); setBrandPicker(true); }}><AnimatedIcon kind="search" size={18} />Brand logos</button>
        {onLinkRequest && <button onClick={() => { setCommandMenu(null); requestItemLink(); }} title="Link selected shapes, or add a linked label (Ctrl+L)">Link to item</button>}
        <button onClick={() => { setCommandMenu(null); onCreateBoard("template"); }}><AnimatedIcon kind="board" size={18} />Templates…</button>
        <button onClick={() => { setCommandMenu(null); onCreateBoard("import"); }}><AnimatedIcon kind="code" size={18} />Import Mermaid…</button>
        <button onClick={() => { setCommandMenu(null); onShowTools(); api.current?.toggleSidebar({ name: "library", force: true }); }}><AnimatedIcon kind="reference" size={18} />Shape library</button>
      </> : <>
        <button onClick={() => { setCommandMenu(null); exportScene(); }}><AnimatedIcon kind="board" size={18} />Drawing (.excalidraw)</button>
        <button onClick={() => { setCommandMenu(null); void exportImage("svg"); }}><AnimatedIcon kind="image" size={18} />SVG image</button>
        <button onClick={() => { setCommandMenu(null); void exportImage("png"); }}><AnimatedIcon kind="image" size={18} />PNG image</button>
        <button onClick={() => { setCommandMenu(null); openExport(); }}><AnimatedIcon kind="code" size={18} />Mermaid…</button>
        <button disabled={copyBusy} onClick={() => { setCommandMenu(null); safeCheckpoint(); void copyMermaid(boardToMermaid(live.current)); }}><AnimatedIcon kind="copy" size={18} />{copyBusy ? "Copying…" : "Copy for Miro"}</button>
      </>}
    </ActionPopover>}
    {brandPicker && !readOnly && <BrandLogoPicker onClose={() => setBrandPicker(false)} onInsert={insertBrand} returnFocus={() => insertTrigger.current} />}
    {!exporting && (error || message) && <div className={`board-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}><span>{error || message}</span><button onClick={() => { setError(""); setMessage(""); }}>Dismiss</button></div>}
    {exporting && <Dialog title="Export flowchart" className="mermaid-dialog" onClose={closeExport}
      initialFocus={() => manualCopy ? codeField.current : !needsReview && conversion.nodes ? copyButton.current : null}
      returnFocus={() => returnToCanvas.current ? canvasOwner.current?.querySelector<HTMLElement>(".excalidraw") || null : exportTrigger.current}>
      <p className="modal-subtitle">Copy the Mermaid code, then paste onto your Miro board. You can also use it in other Mermaid tools.</p>
      <div className="mermaid-summary"><span>{conversion.nodes} component{conversion.nodes !== 1 ? "s" : ""} · {conversion.edges} connection{conversion.edges !== 1 ? "s" : ""} · Entire board</span>
        <AppSelect label="Diagram direction" value={direction} disabled={readOnly || copyBusy} className="board-direction" options={["LR", "TB", "RL", "BT"].map((value) => ({ value, label: ({ LR: "Left to right", TB: "Top to bottom", RL: "Right to left", BT: "Bottom to top" } as Record<string, string>)[value] }))}
          onChange={(value) => { live.current = { ...live.current, exportDirection: value as BoardData["exportDirection"] }; setDirection(value as BoardData["exportDirection"]); setConversion(boardToMermaid(live.current)); pending(); }} />
      </div>
      <div className="mermaid-export-content">
      {!!conversion.issues.length && <div className="conversion-issues" role="status"><strong><WarningCircle size={18} />{needsReview ? "Some parts will be left out or regrouped" : conversion.nodes ? "Export notes" : "Start your flowchart"}</strong>
        <ul>{conversion.issues.map((issue, i) => <li key={i}><span>{issue.message}</span>{issue.elementId && <button onClick={() => { returnToCanvas.current = true; closeExport(); onShowTools(); setInspector(true); const element = api.current?.getSceneElements().find((e) => e.id === issue.elementId); if (element) { api.current?.updateScene({ appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER }); api.current?.scrollToContent([element], { animate: false }); } }}>Show shape</button>}</li>)}</ul>
        {needsReview && <label><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />Export this reviewed draft with these limitations{conversion.omitted ? ` (${conversion.omitted} omitted connections)` : ""}</label>}
      </div>}
      <div className="mermaid-columns">
        <div className="mermaid-preview" aria-label="Mermaid preview">{svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <p role="status">{previewError || "Rendering diagram…"}</p>}</div>
        <textarea ref={codeField} aria-label="Mermaid code" value={conversion.code} readOnly spellCheck={false} onFocus={(e) => e.target.select()} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="mermaid-hint">Names, shapes and connections transfer. Miro arranges them automatically; logos, colors and exact positions stay in your drawing. To keep their appearance, use SVG or PNG.</p>
      </div>
      <div className="dialog-actions"><span role="status">{message}</span><button onClick={closeExport}>Close</button>
        <button disabled={!conversion.nodes || (needsReview && !partial)} onClick={() => void save("mmd", conversion.code, "text/plain")}><AnimatedIcon kind="download" size={18} />Download Mermaid</button>
        <button ref={copyButton} className="primary" disabled={copyBusy || !conversion.nodes || (needsReview && !partial)} onClick={() => void copyMermaid(conversion, partial)}><AnimatedIcon kind="copy" size={18} />{copyBusy ? "Copying…" : "Copy code"}</button>
      </div>
    </Dialog>}
  </section>;
}

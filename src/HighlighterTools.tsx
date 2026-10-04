import { AnimatedIcon } from "./AnimatedIcon";
import { useEffect, useRef, useState } from "react";
import { Check, LineSegment, Scribble } from "@phosphor-icons/react";
import { ActionPopover } from "./ActionPopover";
import type { PenSettings } from "./InkLayer";
import { drawingColors, inkColors, readInk } from "./inkData";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { canColorSelection } from "./SelectionColors";

type Tool = PenSettings["tool"];
type Choice = Pick<PenSettings, "mode" | "color" | "width" | "smooth">;
export function HighlighterTools({ editor, settings, change }: { editor: Editor; settings: PenSettings; change: (next: Partial<PenSettings>) => void }) {
  const [open, setOpen] = useState<Tool | null>(null);
  const markerTrigger = useRef<HTMLButtonElement>(null), drawTrigger = useRef<HTMLButtonElement>(null);
  const penButton = useRef<HTMLButtonElement>(null), drawButton = useRef<HTMLButtonElement>(null), lastWheel = useRef(0);
  const current = useRef(settings); current.current = settings;
  const choices = useRef<Record<Tool, Choice>>({ highlight: { mode: "guided", color: "yellow", width: 16, smooth: true }, draw: { mode: "free", color: "default", width: 3, smooth: true } });
  choices.current[settings.tool] = { mode: settings.mode, color: settings.color, width: settings.width, smooth: settings.smooth };
  const choose = (tool: Tool, active = settings.active && settings.tool === tool) => change({ tool, active, ...choices.current[tool] });
  useEffect(() => {
    const buttons = [penButton.current, drawButton.current].filter((button): button is HTMLButtonElement => !!button);
    let held: { pointer: number; button: HTMLButtonElement } | null = null;
    const down = (event: PointerEvent) => { if (event.button === 0 && event.isPrimary) held = { pointer: event.pointerId, button: event.currentTarget as HTMLButtonElement }; };
    const up = (event: PointerEvent) => { if (event.pointerId === held?.pointer) held = null; };
    const cancel = () => { held = null; };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const wheel = (event: WheelEvent) => {
      // Chromium wheel events can report buttons=0 even while a pointer is held.
      if (!held || held.button !== event.currentTarget || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      if (performance.now() - lastWheel.current < 120) return;
      lastWheel.current = performance.now();
      const tool: Tool = held.button === drawButton.current ? "draw" : "highlight", choice = choices.current[tool];
      change({ tool, active: current.current.active && current.current.tool === tool, ...choice, mode: choice.mode === "guided" ? "free" : "guided" });
    };
    for (const button of buttons) { button.addEventListener("pointerdown", down); button.addEventListener("wheel", wheel, { passive: false }); }
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    window.addEventListener("blur", cancel); window.addEventListener("keydown", key);
    return () => {
      for (const button of buttons) { button.removeEventListener("pointerdown", down); button.removeEventListener("wheel", wheel); }
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key);
    };
  }, [change]);
  const drawing = settings.tool === "draw", label = drawing ? "Drawing" : "Highlighter";
  const colors = drawing ? drawingColors : inkColors;
  const toggle = () => change({ mode: settings.mode === "guided" ? "free" : "guided" });
  const modeControl = <button className="highlighter-mode" aria-label={`${label} mode: ${settings.mode === "guided" ? "Guided" : "Free"}`}
    title={`Switch ${drawing ? "Draw" : "Highlight"} mode · also scroll the wheel while drawing`} onClick={toggle}>
    <span aria-live="polite">{settings.mode === "guided" ? "Guided" : "Free"}</span></button>;
  const options = (tool: Tool) => { choose(tool); setOpen(value => value === tool ? null : tool); };
  return <div className="highlighter-tools">
    <div className={`pen-tool-group${settings.active && !drawing ? " active" : ""}`} role="group" aria-label="Highlight tool">
    <button ref={penButton} className="checklist-button" aria-label="Highlighter pen" aria-pressed={settings.active && !drawing}
      title="Highlighter pen · drag over the note · Escape returns to writing"
      onClick={() => choose("highlight", !(settings.active && !drawing))}><AnimatedIcon kind="highlight" size={23} /><span>Highlight</span></button>
    {settings.active && !drawing && modeControl}
    <button ref={markerTrigger} aria-label="Highlighter options" aria-expanded={open === "highlight"} title="Highlighter options" onClick={() => options("highlight")}><AnimatedIcon kind="down" size={14} /></button>
    </div>
    <div className={`pen-tool-group${settings.active && drawing ? " active" : ""}`} role="group" aria-label="Draw tool">
    <button ref={drawButton} className="checklist-button" aria-label="Draw pen" aria-pressed={settings.active && drawing}
      title="Draw · drag on the note · Escape returns to writing"
      onClick={() => choose("draw", !(settings.active && drawing))}><AnimatedIcon kind="draw" size={23} /><span>Draw</span></button>
    {settings.active && drawing && modeControl}
    <button ref={drawTrigger} aria-label="Drawing options" aria-expanded={open === "draw"} title="Drawing options" onClick={() => options("draw")}><AnimatedIcon kind="down" size={14} /></button>
    </div>
    {open && <ActionPopover anchor={open === "draw" ? drawTrigger.current : markerTrigger.current} label={`${label} options`} className="highlighter-options" onClose={() => setOpen(null)}>
      <div className="color-section-heading">Stroke mode</div>
      <button aria-pressed={settings.mode === "guided"} onClick={() => change({ mode: "guided" })}><LineSegment size={18} /><span>Guided<small>Straight line at any angle</small></span>{settings.mode === "guided" && <Check size={16} />}</button>
      <button aria-pressed={settings.mode === "free"} onClick={() => change({ mode: "free" })}><Scribble size={18} /><span>Free<small>Follow your hand</small></span>{settings.mode === "free" && <Check size={16} />}</button>
      {drawing && <><div className="color-section-heading">Freehand assistance</div>
      <button aria-label="Auto assist" aria-pressed={settings.smooth} onClick={() => change({ smooth: !settings.smooth })}>
        <span>Auto assist<small>Soften wobbles and corners</small></span>{settings.smooth && <Check size={16} />}</button></>}
      <div className="color-section-heading">Stroke size</div>
      <div className="stroke-sizes" role="group" aria-label={`${label} stroke size`}>
        {(drawing ? [1, 3, 6] : [8, 16, 24]).map((width, index) => <button key={width}
          aria-label={`${["Small", "Medium", "Large"][index]} ${width}px stroke`} aria-pressed={settings.width === width}
          onClick={() => change({ width })}><span>{["Small", "Medium", "Large"][index]}</span><small>{width}px</small></button>)}
      </div>
      <div className="color-section-heading">{drawing ? "Pen color" : "Marker color"}</div>
      <div className="color-options" role="group" aria-label={drawing ? "Pen colors" : "Marker colors"}>{colors.map(color => <button key={color} aria-label={`${color} ${drawing ? "pen" : "marker"}`} aria-pressed={settings.color === color}
        onClick={() => change({ color })}><span className="color-swatch" style={{ background: color === "default" ? "var(--fg)" : color === "accent" ? "var(--accent)" : color === "red" ? "var(--danger)" : `var(--ink-${color})` }} />{settings.color === color && <Check size={12} className="color-check" />}</button>)}</div>
      <div className="highlighter-help">Wheel while drawing switches modes. Escape returns to writing. Undo removes a stroke.</div>
      {!drawing && <button disabled={!canColorSelection(editor)} onClick={() => {
        const { from, to } = editor.state.selection;
        editor.view.dispatch(closeHistory(editor.state.tr.addMark(from, to, editor.schema.marks.noteBackgroundColor.create({ tone: settings.color }))));
        setOpen(null); change({ active: false }); editor.view.dom.focus({ preventScroll: true });
      }}>Highlight selected text</button>}
      <button onClick={() => {
        const tr = closeHistory(editor.state.tr);
        editor.state.doc.descendants((node, pos) => {
          const ink = readInk(node.attrs.ink), keep = ink.filter(stroke => drawing ? stroke.kind !== "draw" : stroke.kind === "draw");
          if (keep.length !== ink.length) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ink: keep.length ? keep : null });
        });
        if (tr.docChanged) editor.view.dispatch(tr);
        setOpen(null); change({ active: false }); editor.view.dom.focus({ preventScroll: true });
      }}>{drawing ? "Clear drawing strokes" : "Clear marker strokes"}</button>
    </ActionPopover>}
  </div>;
}

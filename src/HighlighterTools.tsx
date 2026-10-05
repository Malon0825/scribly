import { AnimatedIcon } from "./AnimatedIcon";
import { useCallback, useEffect, useRef, useState } from "react";
import { CaretDown, LineSegment, Trash } from "@phosphor-icons/react";
import { ActionPopover } from "./ActionPopover";
import type { PenSettings } from "./InkLayer";
import { drawingColors, inkColors, readInk } from "./inkData";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";

type Tool = PenSettings["tool"];
type Choice = Pick<PenSettings, "mode" | "color" | "width" | "smooth">;
type Choices = Record<Tool, Choice>;
const preferenceKey = 'scribly-pen-choices-v1';
const defaults: Choices = {
  highlight: { mode: "guided", color: "yellow", width: 16, smooth: true },
  draw: { mode: "free", color: "default", width: 3, smooth: true },
};
function readChoice(value: unknown, tool: Tool): Choice {
  if (!value || typeof value !== 'object') return defaults[tool];
  const colors = tool === 'draw' ? drawingColors : inkColors;
  const widths = tool === 'draw' ? [1, 3, 6] : [8, 16, 24];
  return {
    mode: 'mode' in value && (value.mode === 'guided' || value.mode === 'free') ? value.mode : defaults[tool].mode,
    color: 'color' in value ? colors.find(color => color === value.color) ?? defaults[tool].color : defaults[tool].color,
    width: 'width' in value && typeof value.width === 'number' && widths.includes(value.width) ? value.width : defaults[tool].width,
    smooth: true,
  };
}
function readChoices(): Choices {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
    if (value && typeof value === 'object') return {
      highlight: readChoice('highlight' in value ? value.highlight : null, 'highlight'),
      draw: readChoice('draw' in value ? value.draw : null, 'draw'),
    };
  } catch { /* Keep the controls usable when preferences cannot be read. */ }
  return defaults;
}

// The editor owns preferences, so toolbar collapse cannot reset either tool.
export function usePenSettings() {
  const [state, setState] = useState(() => ({ tool: 'highlight' as Tool, active: false, choices: readChoices() }));
  const change = useCallback((next: Partial<PenSettings>) => setState(current => {
    const tool = next.tool ?? current.tool;
    const previous = current.choices[tool];
    const choice: Choice = { mode: next.mode ?? previous.mode, color: next.color ?? previous.color, width: next.width ?? previous.width, smooth: true };
    return { tool, active: next.active ?? current.active, choices: { ...current.choices, [tool]: choice } };
  }), []);
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(state.choices)); }
    catch { /* Session choices remain available when storage is unavailable. */ }
  }, [state.choices]);
  const settings: PenSettings = { ...state.choices[state.tool], tool: state.tool, active: state.active };
  return [settings, change] as const;
}

export function HighlighterTools({ editor, settings, change }: { editor: Editor; settings: PenSettings; change: (next: Partial<PenSettings>) => void }) {
  const [open, setOpen] = useState<Tool | null>(null);
  const drawButton = useRef<HTMLButtonElement>(null), highlightButton = useRef<HTMLButtonElement>(null);
  const choose = (tool: Tool) => {
    const active = !(settings.active && settings.tool === tool);
    change({ tool, active }); setOpen(null);
  };
  const openOptions = (tool: Tool) => {
    change({ tool }); setOpen(current => current === tool ? null : tool);
  };
  const tool = open ?? settings.tool;
  const drawing = tool === 'draw';
  const label = drawing ? 'Pen' : 'Highlighter';
  const colors = drawing ? drawingColors : inkColors;
  const sizes = drawing ? [1, 3, 6] : [8, 16, 24];
  function clear() {
    const transaction = closeHistory(editor.state.tr);
    editor.state.doc.descendants((node, pos) => {
      const ink = readInk(node.attrs.ink), keep = ink.filter(stroke => drawing ? stroke.kind !== 'draw' : stroke.kind === 'draw');
      if (keep.length !== ink.length) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, ink: keep.length ? keep : null });
    });
    if (transaction.docChanged) {
      editor.view.dispatch(transaction);
      editor.view.dispatch(closeHistory(editor.state.tr));
    }
    setOpen(null); change({ active: false }); editor.view.dom.focus({ preventScroll: true });
  }
  return <div className="highlighter-tools" role="group" aria-label="Drawing tools">
    <div className="pen-split-control">
      <button aria-label={settings.active && settings.tool === 'draw' ? 'Stop drawing' : 'Start drawing'} aria-pressed={settings.active && settings.tool === 'draw'}
        aria-keyshortcuts="Control+D" title="Pen (Ctrl+D) · Esc returns to writing · Ctrl+Z undoes a stroke" onClick={() => choose('draw')}><AnimatedIcon kind="draw" size={20} /></button>
      <button ref={drawButton} className="pen-options-trigger" aria-label="Pen options" title="Pen options" aria-haspopup="dialog" aria-expanded={open === 'draw'} onClick={() => openOptions('draw')}><CaretDown size={12} /></button>
    </div>
    <div className="pen-split-control">
      <button aria-label={settings.active && settings.tool === 'highlight' ? 'Stop highlighting' : 'Start highlighting'} aria-pressed={settings.active && settings.tool === 'highlight'}
        aria-keyshortcuts="Control+G" title="Highlighter (Ctrl+G) · Esc returns to writing · Ctrl+Z undoes a stroke" onClick={() => choose('highlight')}><AnimatedIcon kind="highlight" size={20} /></button>
      <button ref={highlightButton} className="pen-options-trigger" aria-label="Highlighter options" title="Highlighter options" aria-haspopup="dialog" aria-expanded={open === 'highlight'} onClick={() => openOptions('highlight')}><CaretDown size={12} /></button>
    </div>
    {open && <ActionPopover anchor={drawing ? drawButton.current : highlightButton.current} label={`${label} options`} className="highlighter-options compact-pen-options" onClose={() => setOpen(null)}>
      <div className="pen-options-label">Size</div>
      <div className="pen-options-row" role="group" aria-label={`${label} size`}>
        {sizes.map((width, index) => <button key={width} aria-label={`${['Small', 'Medium', 'Large'][index]} ${label.toLowerCase()} stroke`} title={['Small', 'Medium', 'Large'][index]} aria-pressed={settings.width === width} onClick={() => change({ tool, width })}>
          <span className="pen-size-dot" style={{ width: [5, 10, 16][index], height: [5, 10, 16][index] }} />
        </button>)}
        <button aria-label="Straight line" title="Straight line (Space to toggle)" aria-pressed={settings.mode === 'guided'} onClick={() => change({ tool, mode: settings.mode === 'guided' ? 'free' : 'guided' })}><LineSegment size={20} /></button>
      </div>
      <div className="pen-options-label pen-options-divider">Color</div>
      <div className="pen-options-row" role="group" aria-label={`${label} color`}>
        {colors.map(color => <button key={color} aria-label={`${color} ${label.toLowerCase()}`} title={color === 'default' ? 'Text color' : color === 'accent' ? 'Theme accent' : color} aria-pressed={settings.color === color} onClick={() => change({ tool, color })}>
          <span className="pen-color-dot" style={{ background: color === 'default' ? 'var(--fg)' : color === 'accent' ? 'var(--accent)' : color === 'red' ? 'var(--danger)' : `var(--ink-${color})` }} />
        </button>)}
        <button className="pen-clear" aria-label={`Clear ${drawing ? 'drawing' : 'marker'} strokes`} title="Clear strokes · Ctrl+Z to undo" onClick={clear}><Trash size={18} /></button>
      </div>
    </ActionPopover>}
  </div>;
}

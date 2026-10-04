import { AnimatedIcon } from "./AnimatedIcon";
import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { Check } from "@phosphor-icons/react";
import { ActionPopover } from "./ActionPopover";
import { textColors, type TextColor } from "./textColors";

export function canColorSelection(editor: Editor) {
  const { selection, doc } = editor.state;
  if (!editor.isEditable || !(selection instanceof TextSelection) || selection.empty || !doc.textBetween(selection.from, selection.to).trim()) return false;
  let code = false;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.type.name === "codeBlock" || node.marks.some((mark) => mark.type.name === "code")) code = true;
  });
  return !code;
}
type Popup = { from: number; to: number; point: { x: number; y: number } };
export function SelectionColors({ editor, onOpenReady }: { editor: Editor; onOpenReady: (open: () => void) => void }) {
  const [popup, setPopup] = useState<Popup | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null), [background, setBackground] = useState<string | null>(null);
  const open = useCallback((point?: { x: number; y: number }) => {
    if (!canColorSelection(editor)) return false;
    const { from, to } = editor.state.selection;
    const coords = editor.view.coordsAtPos(to);
    setText(editor.getAttributes("noteTextColor").tone || null);
    setBackground(editor.getAttributes("noteBackgroundColor").tone || null);
    setExpanded(false);
    const origin = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : { x: coords.left, y: coords.bottom };
    setPopup({ from, to, point: origin });
    return true;
  }, [editor]);
  useEffect(() => {
    onOpenReady(() => { open(); });
    const context = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('.image-block, .code-block, input, button')) return;
      if (open({ x: event.clientX, y: event.clientY })) { event.preventDefault(); event.stopPropagation(); }
    };
    const key = (event: KeyboardEvent) => {
      if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
        if (open()) { event.preventDefault(); event.stopPropagation(); }
      }
    };
    const el = editor.view.dom;
    el.addEventListener("contextmenu", context);
    el.addEventListener("keydown", key);
    return () => { el.removeEventListener("contextmenu", context); el.removeEventListener("keydown", key); onOpenReady(() => {}); };
  }, [editor, open, onOpenReady]);
  useEffect(() => {
    if (!popup) return;
    const changed = () => {
      const selection = editor.state.selection;
      if (selection.from !== popup.from || selection.to !== popup.to) setPopup(null);
    };
    const edited = () => setPopup(null);
    editor.on("selectionUpdate", changed); editor.on("update", edited);
    return () => { editor.off("selectionUpdate", changed); editor.off("update", edited); };
  }, [editor, popup]);
  function apply(kind: "noteTextColor" | "noteBackgroundColor", tone: TextColor | null) {
    if (!popup || editor.isDestroyed) return;
    const { from, to } = popup;
    const mark = editor.schema.marks[kind];
    const tr = closeHistory(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    tr.removeMark(from, to, mark);
    if (tone) tr.addMark(from, to, mark.create({ tone }));
    // Keep the selected range and other formatting intact.
    editor.view.dispatch(tr);
    setPopup(null); editor.commands.focus();
  }
  if (!popup) return null;
  const choices = expanded ? textColors : textColors.slice(0, 3);
  const label = (color: string) => color[0].toUpperCase() + color.slice(1);
  return <ActionPopover anchor={editor.view.dom} point={popup.point} label="Selection colors" className="selection-colors" onClose={() => setPopup(null)}>
    <div className="color-section-heading">Text color</div>
    <div className="color-options" role="group" aria-label="Text colors">
      {choices.map((color) => <button key={color} aria-label={`${label(color)} text`} title={`${label(color)} text`} aria-pressed={text === color}
        onClick={() => apply("noteTextColor", color)}><span className="color-swatch color-letter" data-text-color={color} aria-hidden="true">A</span>{text === color && <Check size={12} className="color-check" />}</button>)}
    </div>
    <button className="color-reset" onClick={() => apply("noteTextColor", null)}><AnimatedIcon kind="undo" size={15} />Default text</button>
    <div className="color-section-heading">Background color</div>
    <div className="color-options" role="group" aria-label="Background colors">
      {choices.map((color) => <button key={color} aria-label={`${label(color)} background`} title={`${label(color)} background`} aria-pressed={background === color}
        onClick={() => apply("noteBackgroundColor", color)}><span className="color-swatch" data-background-color={color} aria-hidden="true" />{background === color && <Check size={12} className="color-check" />}</button>)}
    </div>
    <button className="color-reset" onClick={() => apply("noteBackgroundColor", null)}><AnimatedIcon kind="undo" size={15} />Default background</button>
    <button className="color-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? <AnimatedIcon kind="up" size={16} /> : <AnimatedIcon kind="down" size={16} />}{expanded ? "Fewer colors" : "More colors"}</button>
  </ActionPopover>;
}

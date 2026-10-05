import { useEffect, useRef, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { inkNodes, inkWidth, readInk, type StrokeColor, type InkPoint } from "./inkData";
import { inkPath } from "./inkPath";

const svgNS = "http://www.w3.org/2000/svg";
type Point = { x: number; y: number };
type Stroke = { pointerId: number; start: Point; points: Point[]; pos: number; anchor: HTMLElement; moved: boolean };
export type PenSettings = { active: boolean; tool: "highlight" | "draw"; mode: "guided" | "free"; color: StrokeColor; width: number; smooth: boolean };
export function InkLayer({ editor, surface, settings, toggleMode, exit, onStatus }: {
  editor: Editor; surface: RefObject<HTMLDivElement | null>; settings: PenSettings; toggleMode: () => void; exit: () => void; onStatus?: (message: string) => void;
}) {
  const layer = useRef<SVGSVGElement>(null);
  const redraw = useRef<() => void>(() => {});
  const live = useRef(settings); live.current = settings;
  const callbacks = useRef({ toggleMode, exit, onStatus }); callbacks.current = { toggleMode, exit, onStatus };
  useEffect(() => {
    const svg = layer.current, wrapper = surface.current;
    if (!svg || !wrapper) return;
    const scroll = wrapper.closest<HTMLElement>('.document-scroll');
    const saved = document.createElementNS(svgNS, "g"), preview = document.createElementNS(svgNS, "path");
    preview.classList.add("ink-stroke"); preview.setAttribute("fill", "none"); svg.replaceChildren(saved, preview);
    let session: Stroke | null = null, frame = 0, wheel = 0, lastWheel = 0;
    const observed = new Set<HTMLElement>();
    const geometry = (el: HTMLElement, type: string) => type === "image" ? el.querySelector<HTMLElement>(".image-block-frame") || el : el;
    function path(points: Point[], color: StrokeColor, element: SVGPathElement, drawing = false, width = drawing ? 3 : 16, smooth = false) {
      element.setAttribute("d", inkPath(points, smooth));
      element.classList.toggle("ink-drawing", drawing);
      element.style.setProperty("--ink-width", `${width}px`);
      element.style.stroke = color === "default" ? "var(--fg)" : color === "accent" ? "var(--accent)" : color === "red" ? "var(--danger)" : `var(--ink-${color})`;
    }
    function selectedPoints() {
      if (!session) return [];
      return live.current.mode === "guided" ? [session.start, session.points.at(-1)!] : session.points;
    }
    function draw() {
      frame = 0;
      const bounds = svg!.getBoundingClientRect();
      svg!.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      if (session) path(selectedPoints().map(p => ({ x: p.x - bounds.left, y: p.y - bounds.top })), live.current.color, preview, live.current.tool === "draw", live.current.width, live.current.tool === "draw" && live.current.mode === "free" && live.current.smooth);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
    redraw.current = schedule;
    function refresh() {
      saved.replaceChildren();
      const surfaceBounds = wrapper!.getBoundingClientRect();
      const scrollBounds = scroll?.getBoundingClientRect();
      const elementScale = parseFloat(getComputedStyle(wrapper!).getPropertyValue('--element-scale')) || 1;
      // Leave paper margins for annotations without changing the text measure.
      const margin = scrollBounds ? Math.max(0, Math.min(32 * elementScale,
        surfaceBounds.left - scrollBounds.left - 8,
        scrollBounds.right - surfaceBounds.right - 8)) : 0;
      svg!.style.setProperty('--ink-margin', `${margin}px`);
      const bounds = svg!.getBoundingClientRect(), font = parseFloat(getComputedStyle(editor.view.dom).fontSize) || 17;
      const targets = new Set<HTMLElement>();
      let inkBottom = 0;
      const scale = parseFloat(getComputedStyle(editor.view.dom).getPropertyValue("--text-scale")) || 1;
      svg!.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
      editor.state.doc.forEach((node, pos) => {
        const ink = readInk(node.attrs.ink); if (!ink.length) return;
        const el = editor.view.nodeDOM(pos);
        if (!(el instanceof HTMLElement)) return;
        const target = geometry(el, node.type.name); targets.add(target);
        const rect = target.getBoundingClientRect();
        for (const stroke of ink) {
          const element = document.createElementNS(svgNS, "path"); element.classList.add("ink-stroke"); element.setAttribute("fill", "none");
          path(stroke.points.map(([x, y]) => ({ x: rect.left - bounds.left + x * rect.width, y: rect.top - bounds.top + y * font })), stroke.color, element, stroke.kind === "draw", inkWidth(stroke), stroke.smooth === true);
          for (const [, y] of stroke.points) inkBottom = Math.max(inkBottom, rect.top - bounds.top + y * font + (inkWidth(stroke) / 2 + 1) * scale);
          saved.append(element);
        }
      });
      for (const target of observed) if (!targets.has(target)) { observer.unobserve(target); observed.delete(target); }
      for (const target of targets) if (!observed.has(target)) { observer.observe(target); observed.add(target); }
      // Keep saved ink in empty space visible even when text or the window shrinks.
      const minimum = inkBottom > 0 ? `${Math.ceil(inkBottom)}px` : "";
      if (wrapper!.style.minHeight !== minimum) wrapper!.style.minHeight = minimum;
      schedule();
    }
    function cancel() {
      const id = session?.pointerId; session = null; preview.removeAttribute("d"); wheel = 0;
      if (id !== undefined && svg!.hasPointerCapture(id)) svg!.releasePointerCapture(id);
    }
    function anchor(point: Point) {
      let nearest: { pos: number; el: HTMLElement; distance: number } | null = null;
      editor.state.doc.forEach((node, pos) => {
        if (!inkNodes.includes(node.type.name)) return;
        const el = editor.view.nodeDOM(pos); if (!(el instanceof HTMLElement)) return;
        const target = geometry(el, node.type.name), rect = target.getBoundingClientRect();
        const distance = Math.max(rect.top - point.y, point.y - rect.bottom, 0);
        if (!nearest || distance < nearest.distance) nearest = { pos, el: target, distance };
      });
      return nearest as { pos: number; el: HTMLElement; distance: number } | null;
    }
    function down(event: PointerEvent) {
      if (!live.current.active || !editor.isEditable || event.button !== 0 || session) return;
      const point = { x: event.clientX, y: event.clientY }, target = anchor(point);
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      editor.view.dom.focus({ preventScroll: true });
      document.dispatchEvent(new CustomEvent("notify:action-open", { detail: svg }));
      session = { pointerId: event.pointerId, start: point, points: [point], pos: target.pos, anchor: target.el, moved: false };
      // Capture also covers pointer-up before the recognition threshold.
      svg!.setPointerCapture(event.pointerId); schedule();
    }
    function move(event: PointerEvent) {
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() || [event];
      for (const sample of samples.length ? samples : [event]) {
        const point = { x: sample.clientX, y: sample.clientY };
        if (!session.moved && Math.hypot(point.x - session.start.x, point.y - session.start.y) < 10) continue;
        session.moved = true;
        const previous = session.points.at(-1)!;
        if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) session.points.push(point);
        // Bound storage while retaining the path and newest sample.
        if (session.points.length > 512) session.points = session.points.filter((_, i) => i % 2 === 0 || i === session!.points.length - 1);
      }
      schedule();
    }
    function up(event: PointerEvent) {
      if (!session || event.pointerId !== session.pointerId) return;
      event.preventDefault(); move(event);
      const drawing = session, points = selectedPoints();
      const node = editor.state.doc.nodeAt(drawing.pos);
      if (drawing.moved && node && drawing.anchor.isConnected) {
        const rect = drawing.anchor.getBoundingClientRect(), font = parseFloat(getComputedStyle(editor.view.dom).fontSize) || 17;
        const normalized: InkPoint[] = points.map(p => [Number(((p.x - rect.left) / Math.max(rect.width, 1)).toFixed(5)), Number(((p.y - rect.top) / font).toFixed(5))]);
        const ink = [...readInk(node.attrs.ink), { color: live.current.color, width: live.current.width, points: normalized, ...(live.current.tool === "draw" ? { kind: "draw" as const, ...(live.current.mode === "free" && live.current.smooth ? { smooth: true } : {}) } : {}) }];
        if (readInk(ink).length) editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(drawing.pos, undefined, { ...node.attrs, ink })));
        else callbacks.current.onStatus?.("This stroke could not be added. Clear strokes or try a shorter stroke in another paragraph.");
      }
      cancel(); refresh();
    }
    function onWheel(event: WheelEvent) {
      if (!session || event.ctrlKey) return; // Idle wheel retains native scrolling/zoom.
      event.preventDefault(); event.stopPropagation();
      const now = performance.now(); if (now - lastWheel > 250) wheel = 0;
      wheel += Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      if (wheel >= 40 && now - lastWheel >= 120) { wheel = 0; lastWheel = now; callbacks.current.toggleMode(); schedule(); }
    }
    function key(event: KeyboardEvent) {
      if (!live.current.active) return;
      if (event.key === "Escape") { event.preventDefault(); cancel(); callbacks.current.exit(); editor.commands.focus(); }
      else if (session) cancel();
    }
    const edited = ({ transaction }: { transaction: Transaction }) => { if (transaction.docChanged) { if (session) cancel(); refresh(); } };
    const scrolled = () => { if (session) cancel(); };
    svg.addEventListener("pointerdown", down); svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", cancel); svg.addEventListener("lostpointercapture", cancel); svg.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("blur", cancel); document.addEventListener("keydown", key); document.addEventListener("scroll", scrolled, true);
    editor.on("transaction", edited);
    const observer = new ResizeObserver(() => { if (session) cancel(); refresh(); }); observer.observe(wrapper); observer.observe(editor.view.dom);
    if (scroll) observer.observe(scroll);
    refresh();
    return () => { redraw.current = () => {}; cancel(); cancelAnimationFrame(frame); observer.disconnect(); editor.off("transaction", edited);
      svg.removeEventListener("pointerdown", down); svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", cancel); svg.removeEventListener("lostpointercapture", cancel); svg.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", cancel); document.removeEventListener("keydown", key); document.removeEventListener("scroll", scrolled, true);
    };
  }, [editor, surface]);
  // Wheel input can schedule a frame before React commits the changed settings.
  // Request another frame after that commit, even when the pointer is stationary.
  useEffect(() => { redraw.current(); }, [settings.mode, settings.tool, settings.color, settings.width, settings.smooth]);
  useEffect(() => { if (!settings.active) layer.current?.dispatchEvent(new Event("pointercancel")); }, [settings.active]);
  return <svg ref={layer} className={`note-ink-layer${settings.active ? " drawing" : ""}`} aria-hidden="true" data-mode={settings.mode} />;
}

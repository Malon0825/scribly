import { useLayoutEffect, useRef } from "react";

export function PanelResize({ panel, visible, layoutKey }: { panel: "sidebar" | "reference"; visible: boolean; layoutKey: string }) {
  const storageKey = `notify-${panel}-width`;
  const direction = panel === "sidebar" ? 1 : -1;
  const handleRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const handle = handleRef.current;
    const workspace = handle?.parentElement;
    const surface = workspace?.querySelector<HTMLElement>(panel === "sidebar" ? ".sidebar" : ".reference-panel");
    const other = workspace?.querySelector<HTMLElement>(panel === "sidebar" ? ".reference-panel" : ".sidebar");
    if (!handle || !workspace || !surface) return;
    if (!visible && document.activeElement === handle) {
      document.querySelector<HTMLButtonElement>(panel === "sidebar" ? 'button[aria-label="Toggle sidebar"]' : 'button[aria-label="Reference"]')?.focus();
    }
    let preferred: number | null = null;
    try {
      const value = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(value) && value >= 180 && value <= 1000) preferred = value;
    } catch { /* Width remains usable when preference storage is unavailable. */ }
    let frame = 0;
    let pending = 0;
    let gesture: { id: number; x: number; width: number; previous: number | null; captured: boolean } | null = null;
    let bounds = { min: 220, max: 480 };

    function measure() {
      const styles = getComputedStyle(workspace!);
      const scale = Number(styles.getPropertyValue("--element-scale")) || 1;
      const otherVisible = workspace!.classList.contains(panel === "sidebar" ? "with-reference" : "with-sidebar");
      const reserved = otherVisible && other && getComputedStyle(other).position !== "absolute"
        ? other.getBoundingClientRect().width : 0;
      const overlay = getComputedStyle(surface!).position === "absolute";
      const available = overlay ? workspace!.clientWidth - 32 * scale :
        workspace!.clientWidth - reserved - 2 * parseFloat(styles.columnGap || "0") - 360 * scale;
      const min = Math.min((panel === "sidebar" ? 220 : 260) * scale, workspace!.clientWidth - 32 * scale);
      bounds = { min, max: Math.max(min, Math.min((panel === "sidebar" ? 480 : 600) * scale, available)) };
    }
    function apply(width: number) {
      const clamped = Math.min(bounds.max, Math.max(bounds.min, width));
      workspace!.style.setProperty(`--${panel}-width`, `${clamped}px`);
      handle!.setAttribute("aria-valuenow", String(Math.round(clamped)));
      handle!.setAttribute("aria-valuetext", `${Math.round(clamped)} pixels`);
      return clamped;
    }
    function sync() {
      if (gesture) return;
      measure();
      if (preferred === null) workspace!.style.removeProperty(`--${panel}-width`);
      else apply(preferred);
      handle!.setAttribute("aria-valuemin", String(Math.round(bounds.min)));
      handle!.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
      if (preferred === null) {
        const width = Math.round(surface!.getBoundingClientRect().width);
        handle!.setAttribute("aria-valuenow", String(width));
        handle!.setAttribute("aria-valuetext", `${width} pixels`);
      }
    }
    function persist() {
      try {
        if (preferred === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, String(preferred));
      } catch { /* A blocked preference store must not interrupt writing. */ }
    }
    function finish(cancel: boolean) {
      const current = gesture;
      if (!current) return;
      gesture = null;
      cancelAnimationFrame(frame);
      if (cancel) {
        preferred = current.previous;
        sync();
      } else if (current.captured) {
        preferred = apply(pending);
        persist();
      }
      workspace!.removeAttribute(`data-${panel}-resizing`);
      handle!.removeAttribute("data-pressed");
      if (handle!.hasPointerCapture(current.id)) handle!.releasePointerCapture(current.id);
    }
    const down = (event: PointerEvent) => {
      if (!visible || event.button !== 0 || !event.isPrimary || gesture) return;
      event.preventDefault(); // Preserve the editor's caret and focus for pointer resizing.
      measure();
      gesture = { id: event.pointerId, x: event.clientX, width: surface.getBoundingClientRect().width,
        previous: preferred, captured: false };
      handle.dataset.pressed = "true";
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const displacement = event.clientX - gesture.x;
      if (!gesture.captured && Math.abs(displacement) < 10) return;
      if (!gesture.captured) {
        gesture.captured = true;
        handle.setPointerCapture(gesture.id);
        workspace.setAttribute(`data-${panel}-resizing`, "true");
      }
      pending = gesture.width + direction * displacement;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(pending));
    };
    const up = (event: PointerEvent) => {
      if (gesture?.id === event.pointerId) {
        pending = gesture.width + direction * (event.clientX - gesture.x);
        finish(false);
      }
    };
    const cancel = () => finish(true);
    const pointerCancel = (event: PointerEvent) => {
      if (gesture?.id === event.pointerId) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture) {
        event.stopPropagation();
        event.preventDefault();
        cancel();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      cancel();
      measure();
      workspace.setAttribute(`data-${panel}-resizing`, "true");
      const width = surface.getBoundingClientRect().width;
      preferred = apply(event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max :
        width + direction * (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 40 : 10));
      persist();
      workspace.removeAttribute(`data-${panel}-resizing`);
    };
    const reset = () => { cancel(); preferred = null; persist(); sync(); };
    const observer = new ResizeObserver(sync);
    sync();
    observer.observe(workspace);
    observer.observe(surface);
    if (other) observer.observe(other);
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("lostpointercapture", pointerCancel);
    handle.addEventListener("keydown", key);
    handle.addEventListener("dblclick", reset);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => {
      cancel();
      cancelAnimationFrame(frame);
      observer.disconnect();
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("lostpointercapture", pointerCancel);
      handle.removeEventListener("keydown", key);
      handle.removeEventListener("dblclick", reset);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape, true);
    };
  }, [panel, storageKey, direction, visible, layoutKey]);
  return <div ref={handleRef} className={`panel-resize ${panel}-resize`} role="separator"
    aria-label={`Resize ${panel}`} aria-orientation="vertical" aria-controls={panel === "sidebar" ? "notes-sidebar" : "reference-panel"}
    tabIndex={visible ? 0 : -1} hidden={!visible}
    title={`Drag to resize ${panel}. Arrow keys resize; Home/End set limits. Double-click to reset.`} />;
}

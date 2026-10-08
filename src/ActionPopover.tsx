import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSurfaceMotion } from './useSurfaceMotion';

export function ActionPopover({ anchor, children, label, className, onClose, point }: {
  anchor: HTMLElement | null; children: ReactNode; label: string; className: string; onClose: () => void;
  point?: { x: number; y: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup || !anchor) return;
    const place = () => {
      const rect = point ? { top: point.y, bottom: point.y, right: point.x } : anchor.getBoundingClientRect();
      popup.style.maxHeight = `${window.innerHeight - 20}px`;
      popup.style.maxWidth = `${window.innerWidth - 20}px`;
      const width = popup.offsetWidth, height = popup.offsetHeight;
      const above = rect.bottom + height + 6 > window.innerHeight - 10 && rect.top > window.innerHeight - rect.bottom;
      popup.dataset.side = above ? "top" : "bottom";
      popup.style.left = `${Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10))}px`;
      popup.style.top = `${Math.max(10, Math.min(above ? rect.top - height - 6 : rect.bottom + 6, window.innerHeight - height - 10))}px`;
    };
    place();
    // Keep a single action owner, including editor selection and image menus.
    const opened = (event: Event) => { if ((event as CustomEvent).detail !== popup) close.current(); };
    document.dispatchEvent(new CustomEvent("notify:action-open", { detail: popup }));
    document.addEventListener("notify:action-open", opened);
    const observer = new ResizeObserver(place);
    observer.observe(popup); observer.observe(anchor);
    window.addEventListener("resize", place);
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!popup.contains(target) && (point || !anchor.contains(target)) && !target.closest('[data-notify-select-content]')) close.current();
    };
    // A trigger may have just scrolled into view. Its queued scroll event can
    // arrive after this listener mounts; only dismiss for a new displacement.
    const scrollPositions = new Map<EventTarget, { top: number; left: number }>();
    for (let element: HTMLElement | null = anchor; element; element = element.parentElement)
      scrollPositions.set(element, { top: element.scrollTop, left: element.scrollLeft });
    scrollPositions.set(document, { top: window.scrollY, left: window.scrollX });
    const scroll = (event: Event) => {
      const target = event.target as HTMLElement;
      const position = event.target === document
        ? { top: window.scrollY, left: window.scrollX } : { top: target.scrollTop, left: target.scrollLeft };
      const previous = scrollPositions.get(target);
      if (previous && previous.top === position.top && previous.left === position.left) return;
      if (!popup.contains(target) && !target.closest?.('[data-notify-select-content]')) close.current();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    popup.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      observer.disconnect(); window.removeEventListener("resize", place);
      document.removeEventListener("notify:action-open", opened);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("scroll", scroll, true);
      if (popup.contains(document.activeElement) && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, point]);
  useSurfaceMotion(ref, 'menu', label);
  return createPortal(<div ref={ref} role="dialog" aria-label={label} className={`dropdown action-popover ${className}`}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); anchor?.focus({ preventScroll: true }); onClose(); return; }
      if (event.key === "Tab") { anchor?.focus({ preventScroll: true }); onClose(); return; }
      if ((event.target as HTMLElement).closest('[role="combobox"]')) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
    }}>
    {children}
  </div>, document.body);
}

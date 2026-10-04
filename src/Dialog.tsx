import { AnimatedIcon } from "./AnimatedIcon";
import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({
  title,
  children,
  onClose,
  className = "",
  returnFocus,
  initialFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  returnFocus?: () => HTMLElement | null;
  initialFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const focusOwner = useRef(returnFocus);
  const initialOwner = useRef(initialFocus);
  close.current = onClose;
  focusOwner.current = returnFocus;
  initialOwner.current = initialFocus;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const first =
      initialOwner.current?.() || el?.querySelector<HTMLElement>('input:not([type="range"])') ||
      el?.querySelector<HTMLElement>('button,select,[tabindex="0"]');
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab" && el) {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        );
        const a = items[0],
          b = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b?.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      const owner = focusOwner.current?.() || previous;
      if (owner?.isConnected) owner.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <AnimatedIcon kind="close" size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

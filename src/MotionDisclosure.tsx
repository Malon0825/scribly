import { useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEventHandler } from 'react';
import { runSpring, spring } from './motion';

export function MotionDisclosure({ open, children, className = '', onKeyDown, onOpened, keepMounted = false, reveal = false, frequency = 20 }: {
  open: boolean; children: ReactNode; className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>; onOpened?: () => void; keepMounted?: boolean; reveal?: boolean; frequency?: number;
}) {
  const [present, setPresent] = useState(open);
  const ref = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const pose = useRef(spring(0));
  const visibility = useRef(spring(0));
  const opened = useRef(onOpened);
  opened.current = onOpened;
  useLayoutEffect(() => { if (open) setPresent(true); }, [open]);
  useLayoutEffect(() => {
    const element = ref.current, content = inner.current;
    if (!element || !content) return;
    if (!open && element.contains(document.activeElement)) {
      element.parentElement?.querySelector<HTMLElement>('.folder-toggle, button[aria-expanded]')?.focus({ preventScroll: true });
    }
    let stop = () => {};
    const target = () => {
      stop();
      // scrollHeight rounds to an integer; handing that height back to auto
      // otherwise produces a final subpixel jump in the document below.
      const height = content.getBoundingClientRect().height;
      pose.current.target = open ? height : 0;
      visibility.current.target = open ? 1 : 0;
      if (reveal) element.style.overflow = 'clip';
      const paint = () => {
        element.style.height = `${Math.max(0, pose.current.value)}px`;
        element.style.opacity = reveal ? String(visibility.current.value) : open ? '1' : String(Math.min(1, pose.current.value / Math.max(1, height)));
        if (reveal) content.style.translate = `0 ${-4 * (1 - visibility.current.value)}px`;
      };
      paint();
      stop = runSpring(reveal ? [pose.current, visibility.current] : [pose.current], paint, () => {
        if (open) { element.style.height = 'auto'; if (reveal) element.style.overflow = 'visible'; opened.current?.(); }
        else setPresent(false);
      }, frequency);
    };
    target();
    const observer = new ResizeObserver(() => {
      if (open && Math.abs(content.getBoundingClientRect().height - pose.current.target) > .5) target();
    });
    observer.observe(content);
    return () => { stop(); observer.disconnect(); };
  }, [open, present, keepMounted, reveal, frequency]);
  return <div ref={ref} className={`motion-disclosure ${className}`} inert={!open} aria-hidden={!open} onKeyDown={onKeyDown}>
    {(present || open || keepMounted) && <div ref={inner}>{children}</div>}
  </div>;
}

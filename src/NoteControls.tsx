import { useEffect, useRef, type ReactNode } from "react";

export function NoteControls({ children }: { children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = strip.current;
    const sentinel = marker.current;
    const scroll = element?.closest<HTMLElement>('.document-scroll');
    if (!element || !sentinel || !scroll) return;
    const panel = scroll.closest<HTMLElement>('.document-panel');
    const footer = panel?.querySelector<HTMLElement>('.document-footer');
    const measure = () => {
      const style = getComputedStyle(scroll);
      element.style.setProperty('--strip-inset', style.paddingLeft);
      element.style.setProperty('--strip-top', style.paddingTop);
      scroll.style.scrollPaddingTop = `${element.offsetHeight + 12}px`;
      if (footer) panel?.style.setProperty('--note-footer-height', `${footer.offsetHeight}px`);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(scroll); resize.observe(element); if (footer) resize.observe(footer); measure();
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.rootBounds) element.classList.toggle('is-pinned', entry.boundingClientRect.top < entry.rootBounds.top);
    }, { root: scroll, threshold: 0 });
    observer.observe(sentinel);
    return () => { resize.disconnect(); observer.disconnect(); scroll.style.removeProperty('scroll-padding-top'); panel?.style.removeProperty('--note-footer-height'); };
  }, []);
  return <><span ref={marker} className="toolbar-sticky-marker" aria-hidden="true" /><div ref={strip} className="note-controls">{children}</div></>;
}

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { runSpring, spring } from './motion';

const selector = '.brand, .breadcrumb, .top-actions, .board-command-host, .topbar > .save-state';

// Flex owns the destination layout. Reveal chrome as groups instead of moving
// individual buttons through one another or handing absolute widths back to flex.
export function useTopbarMotion(ref: RefObject<HTMLElement | null>, ready: boolean, focus: boolean, layoutKey: string) {
  const update = useRef<(() => void) | null>(null);
  const currentFocus = useRef(focus);
  currentFocus.current = focus;
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    const height = spring(header.offsetHeight), opacity = spring(1);
    let stop = () => {}, previousFocus = currentFocus.current, running = false;
    let groups: HTMLElement[] = [];
    header.dataset.topbarMotion = '';
    const clear = () => {
      header.style.removeProperty('height'); header.style.removeProperty('min-height');
      for (const group of groups) group.style.removeProperty('opacity');
    };
    const measure = () => {
      stop(); clear();
      const changedMode = previousFocus !== currentFocus.current;
      previousFocus = currentFocus.current;
      height.target = header.offsetHeight;
      groups = Array.from(header.querySelectorAll<HTMLElement>(selector));
      if (!changedMode && !running) {
        height.value = height.target; height.velocity = 0;
        return;
      }
      // Reversal keeps the current reveal and velocity. Only a settled view
      // starts a new destination reveal; controls remain usable throughout.
      if (changedMode && !running) { opacity.value = 0; opacity.velocity = 0; }
      opacity.target = 1;
      running = true;
      const paint = () => {
        header.style.minHeight = '0'; header.style.height = `${Math.max(0, height.value)}px`;
        for (const group of groups) group.style.opacity = String(Math.max(0, Math.min(1, opacity.value)));
      };
      paint();
      stop = runSpring([height, opacity], paint, () => { running = false; clear(); }, Math.sqrt(300));
    };
    update.current = measure;
    measure();
    let width = header.clientWidth;
    const resize = new ResizeObserver(() => {
      if (width !== header.clientWidth) { width = header.clientWidth; measure(); }
    });
    resize.observe(header);
    const changes = new MutationObserver(measure);
    changes.observe(header, { childList: true, characterData: true, subtree: true });
    return () => {
      stop(); resize.disconnect(); changes.disconnect(); update.current = null;
      clear(); header.removeAttribute('data-topbar-motion');
    };
  }, [ref, ready]);
  useLayoutEffect(() => { update.current?.(); }, [focus, layoutKey]);
}

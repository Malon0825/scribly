import { useLayoutEffect, useRef, type RefObject } from 'react';
import { runSpring, spring } from './motion';

export function useWorkspaceMotion(ref: RefObject<HTMLDivElement | null>, ready: boolean, sidebar: boolean, reference: boolean, layoutKey: string) {
  const update = useRef<(() => void) | null>(null);
  const visible = useRef({ sidebar, reference });
  visible.current = { sidebar, reference };
  useLayoutEffect(() => {
    const workspace = ref.current;
    if (!workspace) return;
    const left = workspace.querySelector<HTMLElement>('.sidebar')!;
    const right = workspace.querySelector<HTMLElement>('.reference-panel')!;
    const binding = workspace.querySelector<HTMLElement>('.notebook-binding');
    const columns = [spring(0), spring(0)], gap = spring(0);
    const reveals = [spring(visible.current.sidebar ? 1 : 0), spring(visible.current.reference ? 1 : 0)];
    let stop = () => {}, initialized = false;
    let held: { element: HTMLElement; width: string; maxWidth: string }[] = [];
    let scroll: HTMLElement | null = null, anchor = '';
    const releaseMeasure = () => {
      for (const item of held) {
        item.element.style.width = item.width;
        item.element.style.maxWidth = item.maxWidth;
      }
      held = [];
      if (scroll) { scroll.style.overflowAnchor = anchor; scroll.removeAttribute('data-reading-motion'); }
      scroll = null;
    };
    workspace.dataset.motionLayout = '';
    const measure = () => {
      stop();
      releaseMeasure();
      workspace.style.removeProperty('grid-template-columns');
      workspace.style.removeProperty('column-gap');
      const styles = getComputedStyle(workspace);
      const tracks = styles.gridTemplateColumns.split(/\s+/).map(Number.parseFloat);
      const widths = [left.offsetWidth, right.offsetWidth];
      const overlay = [getComputedStyle(left).position === 'absolute', getComputedStyle(right).position === 'absolute'];
      const flags = [visible.current.sidebar, visible.current.reference];
      // Measure the final reading surfaces once. Their widths stay constant as
      // the shell resizes, so lines, toolbars and disclosure heights don't reflow
      // at every spring frame. Native scrolling and the paper background stay put.
      scroll = workspace.querySelector<HTMLElement>('.document-panel:not(.board-document) > .document-scroll');
      const surfaces = scroll ? Array.from(scroll.children).filter((element): element is HTMLElement =>
        element instanceof HTMLElement && element.matches('.document-heading-disclosure, .note-controls, .note-editor-surface, .item-backlinks, .trash-banner')) : [];
      const measured = surfaces.map(element => ({ element, width: element.getBoundingClientRect().width }));
      held = measured.map(({ element }) => ({ element, width: element.style.width, maxWidth: element.style.maxWidth }));
      if (scroll) { anchor = scroll.style.overflowAnchor; scroll.style.overflowAnchor = 'none'; scroll.dataset.readingMotion = ''; }
      for (const item of measured) { item.element.style.width = `${item.width}px`; item.element.style.maxWidth = 'none'; }
      columns[0].target = tracks[0] || 0;
      columns[1].target = tracks[2] || 0;
      gap.target = Number.parseFloat(styles.columnGap) || 0;
      reveals.forEach((state, i) => { state.target = flags[i] ? 1 : 0; });
      if (!initialized || workspace.matches('[data-sidebar-resizing], [data-reference-resizing]')) {
        for (const state of [...columns, gap, ...reveals]) { state.value = state.target; state.velocity = 0; }
        initialized = true;
      }
      const paint = () => {
        workspace.style.gridTemplateColumns = `${Math.max(0, columns[0].value)}px minmax(0, 1fr) ${Math.max(0, columns[1].value)}px`;
        workspace.style.columnGap = `${Math.max(0, gap.value)}px`;
        workspace.style.setProperty('--motion-sidebar-column', `${Math.max(0, columns[0].value)}px`);
        workspace.style.setProperty('--motion-reference-column', `${Math.max(0, columns[1].value)}px`);
        workspace.style.setProperty('--motion-sidebar-reveal', String(Math.max(0, Math.min(1, reveals[0].value))));
        [left, right].forEach((panel, i) => {
          const progress = Math.max(0, Math.min(1, reveals[i].value));
          panel.style.opacity = String(Math.min(1, progress * 2));
          panel.style.visibility = progress === 0 ? 'hidden' : 'visible';
          panel.style.pointerEvents = flags[i] ? '' : 'none';
          panel.style.transform = `translateX(${(i === 0 ? -1 : 1) * 12 * (1 - progress)}px)`;
          const clipped = overlay[i] ? 0 : Math.max(0, widths[i] - columns[i].value);
          panel.style.clipPath = i === 0 ? `inset(0 ${clipped}px 0 0)` : `inset(0 0 0 ${clipped}px)`;
        });
        if (binding) { binding.style.opacity = String(reveals[0].value); binding.style.visibility = reveals[0].value <= 0 ? 'hidden' : 'visible'; }
      };
      paint();
      stop = runSpring([...columns, gap, ...reveals], paint, releaseMeasure, Math.sqrt(300));
    };
    update.current = measure;
    measure();
    let width = workspace.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === workspace.clientWidth) return;
      width = workspace.clientWidth; measure();
    });
    observer.observe(workspace);
    workspace.addEventListener('notify:panel-size', measure);
    return () => {
      stop(); observer.disconnect(); workspace.removeEventListener('notify:panel-size', measure);
      releaseMeasure();
      update.current = null;
      workspace.removeAttribute('data-motion-layout');
      workspace.style.removeProperty('grid-template-columns'); workspace.style.removeProperty('column-gap');
      workspace.style.removeProperty('--motion-sidebar-column'); workspace.style.removeProperty('--motion-reference-column');
      workspace.style.removeProperty('--motion-sidebar-reveal');
      for (const panel of [left, right]) for (const property of ['opacity', 'visibility', 'pointer-events', 'transform', 'clip-path']) panel.style.removeProperty(property);
    };
  }, [ref, ready]);
  useLayoutEffect(() => { update.current?.(); }, [sidebar, reference, layoutKey]);
}

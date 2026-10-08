import { useLayoutEffect, useRef, type RefObject } from 'react';
import { runSpring, spring } from './motion';

export function useSettingsMotion(tabs: RefObject<HTMLDivElement | null>, pages: RefObject<HTMLDivElement | null>, section: string, index: number) {
  const highlight = useRef({ x: spring(0), y: spring(0), width: spring(0), height: spring(0), initialized: false });
  const content = useRef({ x: spring(0), opacity: spring(1), previous: index });
  useLayoutEffect(() => {
    const list = tabs.current;
    const marker = list?.querySelector<HTMLElement>('.settings-tab-highlight');
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    const viewport = pages.current;
    const page = viewport?.querySelector<HTMLElement>('.settings-page:not([hidden])');
    if (!list || !marker || !selected || !viewport || !page) return;
    const position = highlight.current;
    const pose = content.current;
    let stopHighlight = () => {};
    const measure = () => {
      stopHighlight();
      position.x.target = selected.offsetLeft;
      position.y.target = selected.offsetTop;
      position.width.target = selected.offsetWidth;
      position.height.target = selected.offsetHeight;
      const states = [position.x, position.y, position.width, position.height];
      if (!position.initialized) {
        for (const state of states) { state.value = state.target; state.velocity = 0; }
        position.initialized = true;
      }
      const paint = () => {
        marker.style.transform = `translate(${position.x.value}px, ${position.y.value}px)`;
        marker.style.width = `${Math.max(0, position.width.value)}px`;
        marker.style.height = `${Math.max(0, position.height.value)}px`;
      };
      paint();
      marker.hidden = false;
      list.dataset.settingsMotion = '';
      stopHighlight = runSpring(states, paint);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list); observer.observe(selected);
    if (pose.previous !== index) {
      // A new page starts from a small directional offset. Rapid switches keep
      // the already displayed value and velocity instead of replaying entry.
      if (pose.x.value === 0 && pose.x.velocity === 0) pose.x.value = Math.sign(index - pose.previous) * 12;
      if (pose.opacity.value === 1) pose.opacity.value = .35;
      viewport.scrollTop = 0;
    }
    pose.previous = index;
    pose.x.target = 0;
    pose.opacity.target = 1;
    const paintPage = () => {
      page.style.translate = `${pose.x.value}px 0`;
      page.style.opacity = String(Math.max(.35, Math.min(1, pose.opacity.value)));
    };
    paintPage();
    const stopPage = runSpring([pose.x, pose.opacity], paintPage, undefined, 22);
    return () => {
      stopHighlight(); stopPage(); observer.disconnect();
      page.style.removeProperty('translate'); page.style.removeProperty('opacity');
    };
  }, [tabs, pages, section, index]);
}

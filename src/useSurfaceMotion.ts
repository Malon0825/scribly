import { useLayoutEffect, useRef, type RefObject } from 'react';
import { runSpring, spring, type Spring } from './motion';

type Kind = 'dialog' | 'menu' | 'toast' | 'window';
const exits = new Map<string, { pose: Spring; stop: () => void; host: HTMLElement }>();
function paint(element: HTMLElement, kind: Kind, value: number) {
  const surface = kind === 'dialog' ? element.querySelector<HTMLElement>('.modal, .image-preview') : element;
  element.style.opacity = String(Math.min(1, Math.max(0, value * 2)));
  if (kind === 'window') return;
  if (!surface) return;
  const sign = kind === 'menu' && element.dataset.side === 'top' ? -1 : 1;
  surface.style.translate = `0 ${sign * (kind === 'menu' ? 4 : 8) * (1 - value)}px`;
  surface.style.scale = kind === 'toast' ? '1' : String(.98 + .02 * value);
}

// React removes semantic state immediately. Only an inert visual snapshot lasts
// through exit; focus handlers and data mutations never wait for its animation.
export function useSurfaceMotion(ref: RefObject<HTMLElement | null>, kind: Kind, identity: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const key = `${kind}:${identity}`;
    const exiting = exits.get(key);
    const pose = exiting ? { ...exiting.pose, target: 1 } : spring(0);
    if (exiting) { exiting.stop(); exiting.host.remove(); exits.delete(key); }
    pose.target = 1;
    element.dataset.motionSurface = kind;
    paint(element, kind, pose.value);
    const stop = runSpring([pose], () => paint(element, kind, pose.value));
    return () => {
      stop();
      // Window startup is an entrance only. Never duplicate an editor or canvas.
      if (kind === 'window' || matchMedia('(prefers-reduced-motion: reduce)').matches || !element.isConnected) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const host = document.createElement('div');
      host.className = 'motion-exit-host';
      host.inert = true;
      host.setAttribute('aria-hidden', 'true');
      const styles = getComputedStyle(element);
      const width = element.offsetWidth, height = element.offsetHeight;
      const translateY = Number.parseFloat(styles.translate.split(/\s+/)[1]) || 0;
      const left = kind === 'menu' ? rect.right - width : rect.left;
      const top = kind === 'menu' && element.dataset.side === 'top' ? rect.bottom - height - translateY : rect.top - translateY;
      Object.assign(host.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, zIndex: styles.zIndex === 'auto' ? '100' : styles.zIndex });
      const clone = element.cloneNode(true) as HTMLElement;
      for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('[id]')]) node.removeAttribute('id');
      // Independent translate/scale are recreated from the live spring below.
      Object.assign(clone.style, { position: 'relative', inset: 'auto', margin: '0', width: '100%', height: kind === 'dialog' ? '100%' : 'auto', maxWidth: 'none', maxHeight: 'none', transform: 'none' });
      host.append(clone);
      document.body.append(host);
      const old = exits.get(key);
      old?.stop(); old?.host.remove();
      pose.target = 0;
      let exitStop = () => {};
      const finish = () => { exitStop(); host.remove(); if (exits.get(key)?.host === host) exits.delete(key); };
      exitStop = runSpring([pose], () => paint(clone, kind, pose.value), finish, 30);
      exits.set(key, { pose, stop: exitStop, host });
    };
  }, [ref, kind, identity]);
}

// Content swaps fade the incoming view, without remounting or scaling it.
export function useContentMotion(ref: RefObject<HTMLElement | null>, identity: string) {
  const pose = useRef(spring(1));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (pose.current.value === 1) pose.current.value = .65;
    pose.current.target = 1;
    element.dataset.motionContent = '';
    const paint = () => { element.style.opacity = String(Math.max(.65, Math.min(1, pose.current.value))); };
    paint();
    return runSpring([pose.current], paint, undefined, 25);
  }, [ref, identity]);
}

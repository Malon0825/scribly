import { useLayoutEffect, useRef, type ButtonHTMLAttributes } from 'react';
import { CaretRight, type Icon } from '@phosphor-icons/react';
import { runSpring, spring } from './motion';
import './folder-options.css';

export function MenuAction({ icon: Glyph, children, next, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon; next?: boolean }) {
  const button = useRef<HTMLButtonElement>(null), icon = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const owner = button.current, glyph = icon.current;
    if (!owner || !glyph) return;
    const position = spring(0);
    let hovered = false, focused = false, stop = () => {};
    const retarget = () => {
      stop();
      position.target = !owner.disabled && (hovered || focused) ? 2 : 0;
      stop = runSpring([position], () => { glyph.style.translate = `${position.value}px 0`; }, undefined, 25);
    };
    const enter = (event: PointerEvent) => { if (event.pointerType !== 'touch') { hovered = true; retarget(); } };
    const leave = () => { hovered = false; retarget(); };
    const focus = () => { focused = owner.matches(':focus-visible'); retarget(); };
    const blur = () => { focused = false; retarget(); };
    const reset = () => { hovered = false; focused = false; retarget(); };
    owner.addEventListener('pointerenter', enter); owner.addEventListener('pointerleave', leave);
    owner.addEventListener('focus', focus); owner.addEventListener('blur', blur);
    window.addEventListener('blur', reset);
    return () => {
      stop(); owner.removeEventListener('pointerenter', enter); owner.removeEventListener('pointerleave', leave);
      owner.removeEventListener('focus', focus); owner.removeEventListener('blur', blur); window.removeEventListener('blur', reset);
    };
  }, []);
  return <button {...props} ref={button} className={`folder-action ${props.className || ''}`}>
    <span ref={icon} className="folder-action-icon" aria-hidden="true"><Glyph size={20} weight="regular" /></span>
    <span className="folder-action-label">{children}</span>
    {next && <CaretRight size={15} className="folder-action-end" aria-hidden="true" />}
  </button>;
}

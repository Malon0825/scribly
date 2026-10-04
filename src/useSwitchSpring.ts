import { useLayoutEffect, useRef } from "react";

// One transform owner; exact overdamped solution (mass 1, stiffness 500,
// damping 45). Retarget the displayed position and velocity, in CSS px/s.
export function useSwitchSpring(enabled: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const target = useRef(enabled);
  const retarget = useRef<(() => void) | null>(null);
  target.current = enabled;
  useLayoutEffect(() => {
    const button = ref.current!, thumb = button.firstElementChild as HTMLElement;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let x = 0, velocity = 0, end = 0, travel = 0, frame = 0, previous = 0;
    const paint = () => thumb.style.setProperty("--switch-offset", `${x}px`);
    const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; };
    const tick = (time: number) => {
      const dt = previous ? (time - previous) / 1000 : 1 / 60;
      previous = time;
      const displacement = x - end;
      const a = (velocity + 25 * displacement) / 5, b = (-velocity - 20 * displacement) / 5;
      const fast = Math.exp(-25 * dt), slow = Math.exp(-20 * dt);
      x = end + a * slow + b * fast;
      velocity = -20 * a * slow - 25 * b * fast;
      if (x < 0 || x > travel) { x = Math.max(0, Math.min(travel, x)); velocity = 0; }
      if (Math.abs(x - end) < .01 && Math.abs(velocity) < .05) { x = end; velocity = 0; stop(); }
      else frame = requestAnimationFrame(tick);
      paint();
    };
    const update = () => {
      end = target.current ? travel : 0;
      if (preference.matches) { stop(); x = end; velocity = 0; paint(); }
      else if (!frame && (x !== end || velocity)) frame = requestAnimationFrame(tick);
    };
    const measure = () => {
      const style = getComputedStyle(button);
      travel = Math.max(0, button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - thumb.offsetWidth);
      update();
    };
    measure(); stop(); x = end; paint();
    const observer = new ResizeObserver(measure); observer.observe(button); observer.observe(thumb);
    preference.addEventListener("change", update);
    retarget.current = update;
    return () => { stop(); observer.disconnect(); preference.removeEventListener("change", update); retarget.current = null; };
  }, []);
  useLayoutEffect(() => { retarget.current?.(); }, [enabled]);
  return ref;
}

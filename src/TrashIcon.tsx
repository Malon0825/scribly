import { useLayoutEffect, useRef } from "react";

// One critically damped spring owns the lid, retaining its pose and velocity
// when the native drag enters/leaves the destination in quick succession.
export function TrashIcon({ open, size = 25 }: { open: boolean; size?: number }) {
  const lid = useRef<SVGGElement>(null);
  const motion = useRef({ position: 0, velocity: 0 });
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, previous = performance.now();
    const target = open ? 1 : 0;
    const paint = () => lid.current?.setAttribute("transform", `translate(0 ${-3 * motion.current.position}) rotate(${-24 * motion.current.position} 5 7)`);
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.064);
      previous = now;
      // mass 1, stiffness 400, damping 40; velocity in pose units/s.
      const offset = motion.current.position - target;
      const coefficient = motion.current.velocity + 20 * offset;
      const decay = Math.exp(-20 * dt);
      motion.current.position = target + (offset + coefficient * dt) * decay;
      motion.current.velocity = (motion.current.velocity - 20 * coefficient * dt) * decay;
      if (Math.abs(motion.current.position - target) < 0.001 && Math.abs(motion.current.velocity) < 0.01) {
        motion.current = { position: target, velocity: 0 };
        paint();
        frame = 0;
      } else { paint(); frame = requestAnimationFrame(tick); }
    };
    const start = () => {
      cancelAnimationFrame(frame);
      if (media.matches) { motion.current = { position: target, velocity: 0 }; paint(); }
      else { previous = performance.now(); frame = requestAnimationFrame(tick); }
    };
    start();
    media.addEventListener("change", start);
    return () => { cancelAnimationFrame(frame); media.removeEventListener("change", start); };
  }, [open]);
  return <svg className="trash-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g ref={lid}><path d="M3 7h18M9 7V4h6v3" /></g>
    <path d="m5 7 1 14h12l1-14M10 11v6M14 11v6" />
  </svg>;
}

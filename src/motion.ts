// Exact critically damped integration. Position is in the caller's units;
// velocity is those units per second, retained when a target changes.
export type Spring = { value: number; velocity: number; target: number };
export const spring = (value: number): Spring => ({ value, velocity: 0, target: value });
export function advance(state: Spring, seconds: number, frequency = 20) {
  const offset = state.value - state.target;
  const coefficient = state.velocity + frequency * offset;
  const decay = Math.exp(-frequency * seconds);
  state.value = state.target + (offset + coefficient * seconds) * decay;
  state.velocity = (state.velocity - frequency * coefficient * seconds) * decay;
  const settled = Math.abs(state.value - state.target) < .001 && Math.abs(state.velocity) < .01;
  if (settled) { state.value = state.target; state.velocity = 0; }
  return settled;
}

export function runSpring(states: Spring[], paint: () => void, complete?: () => void, frequency = 20) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, previous: number | undefined, stopped = false, finished = false;
  const tick = (now: number) => {
    // RAF timestamps mark the start of the rendering frame, which can precede
    // performance.now() when a spring starts during that frame. Integrating a
    // negative step runs the spring backwards and amplifies its displacement.
    // Use only successive RAF timestamps, including after preference changes.
    const dt = previous === undefined ? 0 : Math.max(0, Math.min((now - previous) / 1000, .064));
    previous = now;
    const settled = states.map(state => advance(state, dt, frequency)).every(Boolean);
    paint();
    if (settled) { frame = 0; finished = true; complete?.(); }
    else frame = requestAnimationFrame(tick);
  };
  const start = () => {
    cancelAnimationFrame(frame);
    if (stopped || finished) return;
    if (media.matches) {
      for (const state of states) { state.value = state.target; state.velocity = 0; }
      paint(); finished = true; complete?.();
    } else { previous = undefined; frame = requestAnimationFrame(tick); }
  };
  start();
  media.addEventListener('change', start);
  return () => { stopped = true; cancelAnimationFrame(frame); media.removeEventListener('change', start); };
}

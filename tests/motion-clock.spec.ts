import { test, expect } from '@playwright/test';
import { runSpring, spring } from '../src/motion';

// The first RAF can carry a timestamp from before the synchronous work that
// started/retargeted a spring. Reproduce that ordering without wall-clock waits.
test('spring startup and reversal use frame time without integrating backwards', () => {
  const names = ['requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia'] as const;
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const media = new EventTarget();
  Object.assign(media, { matches: false });
  Object.defineProperties(globalThis, {
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; } },
    cancelAnimationFrame: { configurable: true, value: (frame: number) => { frames.delete(frame); } },
    matchMedia: { configurable: true, value: () => media },
  });
  const tick = (time: number) => {
    const next = frames.entries().next().value;
    expect(next).toBeDefined();
    if (!next) return;
    frames.delete(next[0]);
    next[1](time);
  };
  let stop = () => {};
  try {
    const state = spring(0);
    state.target = 320;
    stop = runSpring([state], () => {});
    const time = performance.now() - 190;
    tick(time);
    expect(state.value).toBe(0);
    expect(state.velocity).toBe(0);
    tick(time + 16);
    expect(state.value).toBeGreaterThan(0);
    expect(state.value).toBeLessThan(320);

    stop();
    state.target = 0;
    const live = { ...state };
    stop = runSpring([state], () => {});
    tick(time + 16); // A retarget in the same rendering frame.
    expect(state).toEqual(live);
    tick(time + 32);
    expect(state.value).toBeGreaterThanOrEqual(0);
    expect(state.value).toBeLessThan(320);
    stop();
    expect(frames.size).toBe(0);

    stop = runSpring([state], () => {});
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
    expect(state.value).toBe(0);
    expect(state.velocity).toBe(0);
    expect(frames.size).toBe(0);
  } finally {
    stop();
    names.forEach((name, index) => {
      const descriptor = original[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});

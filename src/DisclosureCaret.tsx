import { useLayoutEffect, useRef } from 'react';
import { AnimatedIcon } from './AnimatedIcon';
import { runSpring, spring } from './motion';

export function DisclosureCaret({ open, size = 16 }: { open: boolean; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const pose = useRef(spring(open ? 0 : -90));
  useLayoutEffect(() => {
    pose.current.target = open ? 0 : -90;
    return runSpring([pose.current], () => { if (ref.current) ref.current.style.rotate = `${pose.current.value}deg`; }, undefined, Math.sqrt(300));
  }, [open]);
  return <span ref={ref} className="motion-caret" aria-hidden="true"><AnimatedIcon kind="down" size={size} /></span>;
}

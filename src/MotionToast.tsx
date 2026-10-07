import { useRef, type ReactNode } from 'react';
import { useSurfaceMotion } from './useSurfaceMotion';
export function MotionToast({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSurfaceMotion(ref, 'toast', 'notice');
  return <div ref={ref} className="toast" role="status">{children}</div>;
}

import { useEffect, useRef } from "react";
import { useSurfaceMotion } from './useSurfaceMotion';
import { QuickCapture } from "./QuickCapture";

export function QuickCaptureWindow() {
  const ref = useRef<HTMLDivElement>(null);
  useSurfaceMotion(ref, 'window', 'quick-capture');
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      let theme = "system";
      try { theme = localStorage.getItem("scribly-capture-theme") || theme; } catch { /* System remains available. */ }
      document.documentElement.dataset.theme = theme === "notebook" ? "notebook" : theme === "dark" || (theme === "system" && media.matches) ? "dark" : "light";
    };
    apply(); media.addEventListener("change", apply); window.addEventListener("focus", apply); window.addEventListener("storage", apply);
    return () => { media.removeEventListener("change", apply); window.removeEventListener("focus", apply); window.removeEventListener("storage", apply); };
  }, []);
  return <div ref={ref} style={{ height: '100%' }}><QuickCapture /></div>;
}

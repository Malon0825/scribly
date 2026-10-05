import { useEffect } from "react";
import { QuickCapture } from "./QuickCapture";

export function QuickCaptureWindow() {
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
  return <QuickCapture />;
}

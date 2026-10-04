import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./storage";

let reported = false;
// Report only after the real editable document is mounted and a frame can paint.
// Minimized sign-in launches do not block on a throttled animation frame.
export function reportEditorReady() {
  if (!desktop || reported) return;
  reported = true;
  let done = false;
  const report = () => {
    if (done) return;
    done = true;
    void invoke("frontend_ready", { frontendMs: performance.now() }).catch(() => {});
  };
  const fallback = window.setTimeout(report, 1000);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.clearTimeout(fallback); report(); }));
}

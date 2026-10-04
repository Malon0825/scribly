import { useEffect, useRef } from "react";
import { appendCapture, finishCapture, getCaptureStatus, reportCaptureError, subscribeCapturePending } from "./captureService";
import type { Workspace } from "./types";

// The capture webview never writes notebook snapshots. Every capture is folded
// into this window's live draft and acknowledged through its existing queue.
export function useCaptureWriter(writer: {
  ready: boolean; checkpoint: () => Workspace | null;
  update: (updater: (workspace: Workspace) => Workspace) => void;
  flush: () => Promise<void>;
}) {
  const current = useRef(writer); current.current = writer;
  const running = useRef(false), mounted = useRef(false), retry = useRef(false), failed = useRef<string | null>(null);
  const pump = useRef<(force?: boolean) => Promise<void>>(async () => {});
  pump.current = async (force = false) => {
    if (!mounted.current || !current.current.ready) return;
    if (force) failed.current = null;
    if (running.current) { if (force) retry.current = true; return; }
    running.current = true;
    let id: string | null = null;
    try {
      const { pending } = await getCaptureStatus();
      if (!mounted.current || !pending || failed.current === pending.id) return;
      id = pending.id;
      current.current.update(workspace => appendCapture(workspace, pending));
      await current.current.flush();
      await finishCapture(id);
    } catch (error) {
      if (id) { failed.current = id; await reportCaptureError(id, String(error)).catch(() => {}); }
    } finally {
      running.current = false;
      if (retry.current) { retry.current = false; void pump.current(true); }
    }
  };
  useEffect(() => {
    mounted.current = true;
    let disposed = false, off: (() => void) | undefined;
    void subscribeCapturePending(() => { void pump.current(true); }).then(unsubscribe => { if (disposed) unsubscribe(); else off = unsubscribe; });
    const timer = setInterval(() => { void pump.current(); }, 3000);
    void pump.current();
    return () => { mounted.current = false; disposed = true; off?.(); clearInterval(timer); };
  }, []);
  useEffect(() => { if (writer.ready) void pump.current(); }, [writer.ready]);
}

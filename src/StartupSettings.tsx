import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./storage";
import { useSwitchSpring } from "./useSwitchSpring";

const nativeStartup = {
  read: () => invoke<boolean>("startup_enabled"),
  write: (enabled: boolean) => invoke<boolean>("set_startup", { enabled }),
};

export function StartupSettings({ available = desktop, service = nativeStartup }: {
  available?: boolean; service?: typeof nativeStartup;
} = {}) {
  const [enabled, setEnabled] = useState(false);
  const [known, setKnown] = useState(!available);
  const [operation, setOperation] = useState<"checking" | "updating" | null>(available ? "checking" : null);
  const [error, setError] = useState("");
  const generation = useRef(0), mounted = useRef(false), writing = useRef(false);
  const retry = useRef(() => {});
  const switchRef = useSwitchSpring(enabled);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      if (!available || writing.current) return;
      const id = ++generation.current;
      setOperation("checking");
      void service.read().then((value) => {
        if (mounted.current && id === generation.current) { setEnabled(value); setKnown(true); setError(""); }
      }).catch((e) => { if (mounted.current && id === generation.current) setError(String(e)); })
        .finally(() => { if (mounted.current && id === generation.current) setOperation(null); });
    };
    retry.current = refresh;
    refresh();
    window.addEventListener("focus", refresh);
    return () => { mounted.current = false; generation.current++; retry.current = () => {}; window.removeEventListener("focus", refresh); };
  }, [available, service]);
  const toggle = async () => {
    if (writing.current || !available) return;
    const id = ++generation.current;
    writing.current = true; setOperation("updating"); setError("");
    try { const value = await service.write(!enabled); if (mounted.current && id === generation.current) setEnabled(value); }
    catch (e) { if (mounted.current && id === generation.current) setError(String(e)); }
    finally { writing.current = false; if (mounted.current && id === generation.current) setOperation(null); }
  };
  return <section className="startup-settings" aria-labelledby="startup-label">
    <span className="settings-label" id="startup-label">STARTUP</span>
    <div className="startup-setting-row">
      <div><strong id="startup-toggle-label">Start Scribly when I sign in</strong>
        <p className="setting-hint" id="startup-description">{available
          ? "Opens minimized in the taskbar. You can also manage it in Windows Settings → Apps → Startup."
          : "Available in the installed Windows app."}</p></div>
      <button ref={switchRef} type="button" className="settings-switch" role="switch"
        aria-checked={enabled} aria-labelledby="startup-toggle-label"
        aria-describedby="startup-description" aria-busy={!!operation} disabled={!available || !known || !!operation}
        onClick={() => void toggle()}><span /></button>
    </div>
    {operation && <p className="setting-hint" role="status">{operation === "checking" ? "Checking Windows startup…" : "Updating Windows startup…"}</p>}
    {error && <p className="startup-setting-error" role="alert">{error}</p>}
    {available && !known && !operation && <button type="button" onClick={() => retry.current()}>Retry startup check</button>}
  </section>;
}

import { useEffect, useState } from "react";
import { desktop } from "./storage";
import { AppSelect } from "./AppSelect";
import { getCaptureStatus, setCapturePreferences, type CaptureStatus } from "./captureService";

export function QuickCaptureSettings({ onOpen }: { onOpen: () => void }) {
  const [value, setValue] = useState<CaptureStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getCaptureStatus().then(status => { if (active) setValue(status); }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  const change = async (enabled: boolean, shortcut: string) => {
    setBusy(true); setError("");
    try { setValue(await setCapturePreferences(enabled, shortcut)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  return <section className="startup-settings" aria-labelledby="capture-settings-label">
    <h3 id="capture-settings-label">Quick capture</h3>
    <p className="setting-hint">{desktop ? "Capture into Inbox while Scribly is running. Windows startup remains a separate setting." : "Use quick capture here. The global shortcut is available in the Windows app."}</p>
    {desktop && <>
      <label className="capture-shortcut-enable"><input type="checkbox" checked={value?.enabled ?? false} disabled={!value || busy} onChange={event => void change(event.target.checked, value!.shortcut)} /> Enable global capture shortcut</label>
      <AppSelect label="Capture shortcut" value={value?.shortcut ?? "Ctrl+Alt+N"} disabled={!value || busy}
        options={["Ctrl+Alt+N", "Ctrl+Shift+Space", "Alt+Shift+N"].map(shortcut => ({ value: shortcut, label: shortcut }))}
        onChange={shortcut => void change(value!.enabled, shortcut)} />
      {value && <p className="setting-hint" role="status">{busy ? "Updating shortcut…" : value.registered ? `Shortcut active: ${value.shortcut}` : "Global shortcut is off."}</p>}
    </>}
    {(error || value?.warning) && <p role="alert" className="startup-setting-error">{error || value?.warning}</p>}
    <button className="notepad-settings-import" onClick={onOpen}>Quick capture…</button>
  </section>;
}

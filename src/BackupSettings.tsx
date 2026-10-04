import { useRef } from "react";
import type { BackupConfig, BackupEntry } from "./backups";
import { desktop } from "./storage";

export function BackupSettings({ config, busy, error, onEnable, onChoose, onBackup, onPreview, onFile, onDownload }: {
  config: BackupConfig; busy: boolean; error: string;
  onEnable: (enabled: boolean) => void; onChoose: () => void; onBackup: () => void;
  onPreview: (entry: BackupEntry) => void; onFile: (file: File) => void; onDownload: (entry: BackupEntry) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <section className="protection-settings" aria-label="Backups and recovery">
    <h3>Backups and recovery</h3>
    <p>Daily backups run while Scribly is open, after the notebook changes. Keep seven notebook backups and three copies made before replacement.</p>
    <p>Backups include notes, boards, images, originals, Archive, and Trash. Version history stays in this installation.</p>
    <label className="protection-checkbox"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => onEnable(event.target.checked)} />Automatic daily backups</label>
    <p className="backup-destination">{config.directory || (desktop ? "Choose a folder on this computer or a backup drive." : "Browser backups stay in this browser's storage. Download a copy to protect against cleared browser data.")}</p>
    <div className="protection-actions">{desktop && <button onClick={onChoose} disabled={busy}>Choose backup folder</button>}<button onClick={onBackup} disabled={busy}>{busy ? "Creating backup…" : "Backup now"}</button><button onClick={() => input.current?.click()} disabled={busy}>Restore from file…</button></div>
    <p>Last successful notebook backup: {config.lastAt ? new Date(config.lastAt).toLocaleString() : "None yet"}</p>
    {error && <p role="alert" className="protection-error">{error}</p>}
    <ul className="backup-list">{config.entries.map(entry => <li key={entry.id}><span>{new Date(entry.time).toLocaleString()}{entry.protected ? " · Before replacement" : ""}</span><div><button disabled={busy} onClick={() => onPreview(entry)}>Preview restore</button><button disabled={busy} onClick={() => onDownload(entry)}>Download</button></div></li>)}</ul>
    <input ref={input} type="file" hidden accept=".json,.scribly" aria-label="Restore backup file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
  </section>;
}

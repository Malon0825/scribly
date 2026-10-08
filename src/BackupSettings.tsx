import { useRef } from "react";
import type { BackupConfig, BackupEntry } from "./backups";
import { desktop } from "./storage";
import { AnimatedIcon } from './AnimatedIcon';

export function BackupSettings({ config, busy, error, onEnable, onChoose, onBackup, onPreview, onFile, onDownload }: {
  config: BackupConfig; busy: boolean; error: string;
  onEnable: (enabled: boolean) => void; onChoose: () => void; onBackup: () => void;
  onPreview: (entry: BackupEntry) => void; onFile: (file: File) => void; onDownload: (entry: BackupEntry) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <section className="protection-settings" aria-label="Backups and recovery">
    <h3>Automatic backups</h3>
    <label className="protection-checkbox"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => onEnable(event.target.checked)} />Automatic daily backups</label>
    <p className="backup-destination">{config.directory || (desktop ? "Choose where to save your backups." : "Stored in this browser. Download a copy to keep it safe.")}</p>
    <div className="protection-actions">{desktop && <button onClick={onChoose} disabled={busy}><AnimatedIcon kind="folder" size={18} />Choose folder</button>}<button onClick={onBackup} disabled={busy}><AnimatedIcon kind="download" size={18} />{busy ? "Creating backup…" : "Back up now"}</button><button onClick={() => input.current?.click()} disabled={busy}><AnimatedIcon kind="upload" size={18} />Restore file…</button></div>
    <p>Last backup: {config.lastAt ? new Date(config.lastAt).toLocaleString() : "None yet"}</p>
    <details className="settings-details"><summary>What’s included?</summary>
      <p>Notes, boards, images, originals, Archive, and Trash. Version history stays on this device.</p>
      <p>Daily backups run after changes while Scribly is open. Keeps seven daily copies and three before replacement.</p>
      <p>Recordings and transcripts need a separate backup from Meetings. Text added to notes is included here.</p>
      <p>Export before updates. Local saving is not a separate backup; copying the live database folder is not supported.</p>
    </details>
    {error && <p role="alert" className="protection-error">{error}</p>}
    <ul className="backup-list">{config.entries.map(entry => <li key={entry.id}><span>{new Date(entry.time).toLocaleString()}{entry.protected ? " · Before replacement" : ""}</span><div><button disabled={busy} onClick={() => onPreview(entry)}>Preview restore</button><button disabled={busy} onClick={() => onDownload(entry)}>Download</button></div></li>)}</ul>
    <input ref={input} type="file" hidden accept=".json,.scribly" aria-label="Restore backup file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
  </section>;
}

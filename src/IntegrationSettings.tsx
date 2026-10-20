import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';
import type { Folder } from './types';
import type { IntegrationPolicy } from './integration';

type IntegrationStatus = { enabled: boolean; port: number; policy: IntegrationPolicy; clients: { id: string; name: string }[]; listening: boolean; ready: boolean; error: string | null; url: string };
export function IntegrationSettings({ folders }: { folders: Folder[] }) {
  const [value, setValue] = useState<IntegrationStatus | null>(null);
  const [port, setPort] = useState('14327'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    let current = true;
    if (desktop) void invoke<IntegrationStatus>('integration_status').then(status => { if (current) { setValue(status); setPort(String(status.port)); } }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; live.current = false; };
  }, [folders]);
  async function run(label: string, operation: () => Promise<IntegrationStatus>, success = '') {
    setBusy(label); setError(''); setMessage('');
    try { const status = await operation(); if (live.current) { setValue(status); setPort(String(status.port)); setMessage(success); } }
    catch (reason) { if (live.current) setError(String(reason)); }
    finally { if (live.current) setBusy(''); }
  }
  function change(patch: Partial<Pick<IntegrationStatus, 'enabled' | 'port' | 'policy'>>) {
    if (!value) return;
    const config = { enabled: value.enabled, port: value.port, policy: value.policy, ...patch };
    void run('Updating connection', () => invoke('integration_set_config', config));
  }
  const disabled = !desktop || !value || !!busy;
  return <section className="integration-settings settings-group" aria-labelledby="codex-integration-title">
    <h3 id="codex-integration-title">Codex integration</h3>
    <p className="setting-hint">{desktop ? 'Let Codex work with selected folders while Scribly is running. Text returned to Codex is available to its model.' : 'Available in the installed Windows app. Browser notes are separate from the desktop notebook.'}</p>
    <div className="integration-permissions">
      <label className="integration-permission"><input type="checkbox" aria-labelledby="integration-enable-label" aria-describedby="integration-enable-hint" checked={value?.enabled ?? false} disabled={disabled} onChange={event => change({ enabled: event.target.checked })} /><span><span id="integration-enable-label">Enable local Codex connection</span><span id="integration-enable-hint" className="setting-hint">Available while Scribly is running.</span></span></label>
    </div>
    <details className="settings-disclosure"><summary tabIndex={0}><span>Permissions & shared folders<span className="setting-hint">Control which notes Codex can read or edit</span></span></summary>
    <div className="settings-disclosure-content">
    <label className="integration-permission"><input type="checkbox" aria-labelledby="integration-edit-label" aria-describedby="integration-edit-hint" checked={value ? !value.policy.readOnly : false} disabled={disabled} onChange={event => value && change({ policy: { ...value.policy, readOnly: !event.target.checked } })} /><span><span id="integration-edit-label">Allow creating and editing notes</span><span id="integration-edit-hint" className="setting-hint">When off, Codex can only read your shared notes.</span></span></label>
    <fieldset className="integration-folders" disabled={disabled}>
      <legend>Shared folders</legend>
      <p className="setting-hint">Choose which folders Codex can access.</p>
      <div className="integration-folder-list">
        <label className="integration-folder"><input type="checkbox" checked={value?.policy.allowUnfiled ?? false} onChange={event => value && change({ policy: { ...value.policy, allowUnfiled: event.target.checked } })} /><span>Unfiled notes</span></label>
        {folders.filter(folder => !folder.deletedAt).map(folder => <label className="integration-folder" key={folder.id}><input type="checkbox" checked={value?.policy.allowedFolderIds.includes(folder.id) ?? false} onChange={event => value && change({ policy: { ...value.policy, allowedFolderIds: event.target.checked ? [...value.policy.allowedFolderIds, folder.id] : value.policy.allowedFolderIds.filter(id => id !== folder.id) } })} /><span>{folder.name}</span></label>)}
      </div>
    </fieldset>
    <p className="setting-hint">Meeting transcripts and summaries are readable in shared folders. Meeting edits, recordings, permanent deletion, boards, and attachments are unavailable through this connection.</p>
    </div>
    </details>
    <details className="settings-disclosure integration-address"><summary tabIndex={0}><span>Codex connection setup<span className="setting-hint">Plugin installation, local port & paired access</span></span></summary>
    <div className="settings-disclosure-content">
      <div className="integration-port">
        <label className="meeting-field">Local port<input type="number" min={1024} max={65535} value={port} disabled={disabled} onChange={event => setPort(event.target.value)} /></label>
        <button disabled={disabled || !Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535 || Number(port) === value?.port} onClick={() => change({ port: Number(port) })}>Save port</button>
      </div>
      {value && <p className="setting-hint">{value.url}. Reinstall the connection after changing its port.</p>}
    <div className="settings-actions integration-actions"><button className="primary" disabled={disabled} onClick={() => void run('Preparing Codex plugin', async () => {
      const result = await invoke<{ status: IntegrationStatus; message: string }>('integration_install_plugin');
      if (live.current) setMessage(result.message);
      return result.status;
    }, 'Paired plugin prepared. Refresh or restart Codex, install Scribly from the local plugin source, then start a new chat.')}>Install Codex plugin</button>
      <button disabled={disabled || !value?.clients.length} onClick={() => void run('Removing connection', () => invoke('integration_remove_plugin'), 'Paired access revoked and local source removed. Remove any cached Scribly plugin in Codex.')}>Remove Codex connection</button></div>
    {value?.clients.map(client => <div className="integration-client" key={client.id}><span>{client.name}</span><button disabled={disabled} onClick={() => void run('Revoking access', () => invoke('integration_revoke', { clientId: client.id }), 'Access revoked, including any cached credential copies.')}>Revoke access</button></div>)}
    </div>
    </details>
    {value && <p className="setting-hint" role="status">{busy ? `${busy}…` : value.listening ? (value.clients.length ? 'Local server ready. Codex can use the folders selected above.' : 'Local server ready. Install the plugin to pair Codex.') : value.enabled ? 'Connection is enabled but unavailable. Check its address or retry enabling it.' : 'Codex connection is off.'}</p>}
    {message && <p className="setting-hint" role="status">{message}</p>}
    {(error || value?.error) && <p role="alert" className="meeting-error">{error || value?.error}</p>}
  </section>;
}

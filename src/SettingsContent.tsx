import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from '@phosphor-icons/react';
import { AnimatedIcon } from './AnimatedIcon';
import { AppearanceSettings } from './AppearanceSettings';
import { StartupSettings } from './StartupSettings';
import type { Appearance } from './appearance';
import type { Workspace } from './types';
import { backupStatus, type BackupRecord } from './backupHistory';
import { desktop } from './storage';
import { version } from '../package.json';

export type SettingsSection = 'appearance' | 'startup' | 'backup' | 'meetings' | 'about';
const sections: { id: SettingsSection; label: string }[] = [
  { id: 'appearance', label: 'Appearance' }, { id: 'startup', label: 'Startup' },
  { id: 'backup', label: 'Backup & restore' }, { id: 'meetings', label: 'Accounts & Advanced' }, { id: 'about', label: 'About' },
];
export function SettingsContent({ theme, appearance, backup, backupBusy, importing, dataPath,
  initialSection = 'appearance', startupExtras, appearanceExtras, backupExtras, meetingExtras, onTheme, onAppearance, onExport, onImport, onUpdates, onShortcuts, onDone }: {
  startupExtras?: ReactNode; appearanceExtras?: ReactNode; backupExtras?: ReactNode; meetingExtras?: ReactNode;
  theme: Workspace['theme']; appearance: Appearance; backup: BackupRecord | null;
  backupBusy: boolean; importing: boolean; dataPath: string; initialSection?: SettingsSection;
  onTheme: (value: Workspace['theme']) => void; onAppearance: (value: Appearance) => void;
  onExport: () => void; onImport: () => void; onUpdates: () => void; onShortcuts: () => void; onDone: () => void;
}) {
  const [section, setSection] = useState(initialSection);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
    setSection(sections[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
  return <>
    <p className="settings-intro">Make yourself at home.</p>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {sections.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`} role="tab"
        aria-selected={section === item.id} aria-controls={`settings-page-${item.id}`} tabIndex={section === item.id ? 0 : -1}
        onClick={() => setSection(item.id)} onKeyDown={event => navigate(event, index)}>{item.label}</button>)}
    </div>
    <div className="settings-pages">
      <section className="settings-page" role="tabpanel" id="settings-page-appearance" aria-labelledby="settings-tab-appearance" hidden={section !== 'appearance'}>
        <span className="field-label">Theme</span>
        <div className="theme-options">
          {([{ value: 'light', label: 'Light', kind: 'sun' }, { value: 'dark', label: 'Dark', kind: 'moon' },
            { value: 'system', label: 'System', kind: 'system' }, { value: 'notebook', label: 'Notebook', kind: 'reference' }] as const).map(item => <button key={item.value}
            aria-pressed={theme === item.value} onClick={() => onTheme(item.value)}>
            <AnimatedIcon kind={item.kind} size={22} /><span>{item.label}</span>{theme === item.value && <Check size={16} />}
          </button>)}
        </div>
        <AppearanceSettings value={appearance} onChange={onAppearance} />
        {appearanceExtras}
      </section>
      <section className="settings-page" role="tabpanel" id="settings-page-startup" aria-labelledby="settings-tab-startup" hidden={section !== 'startup'}>
        <StartupSettings />
        {startupExtras}
      </section>
      <section className="settings-page" role="tabpanel" id="settings-page-backup" aria-labelledby="settings-tab-backup" hidden={section !== 'backup'}>
        <h3>Keep a separate copy</h3>
        <p className="setting-hint">Export your notebook regularly and before updates. Local saving does not create a backup; copying the live database folder is not supported.</p>
        <div className="backup-summary"><strong>{backupStatus(backup)}</strong>
          {backup?.downloaded && <p className="setting-hint">Check Downloads to confirm the file was saved.</p>}
          {(!backup || Date.now() - backup.at >= 7 * 86400000) && <p className="backup-reminder">{backup ? 'Your last export was at least a week ago.' : 'Your first backup is ready to export.'}</p>}
        </div>
        <div className="settings-actions">
          <button className="primary" disabled={backupBusy} onClick={onExport}><AnimatedIcon kind="download" size={20} />{backupBusy ? 'Exporting backup…' : 'Export notebook backup'}</button>
          <button disabled={importing} onClick={onImport}><AnimatedIcon kind="upload" size={20} />Import notes & backup</button>
        </div>
        {backupExtras}
      </section>
      <section className="settings-page" role="tabpanel" id="settings-page-meetings" aria-labelledby="settings-tab-meetings" hidden={section !== 'meetings'}>{meetingExtras}</section>
      <section className="settings-page" role="tabpanel" id="settings-page-about" aria-labelledby="settings-tab-about" hidden={section !== 'about'}>
        <h3>Scribly <span className="about-version">{version}</span></h3>
        <p className="setting-hint">A personal notebook for writing and drawing. No cloud sync or account required.</p>
        <div className="about-actions">
          <button className="link-button" onClick={onShortcuts}>Keyboard shortcuts <kbd>Ctrl /</kbd></button>
          <button className="link-button" onClick={onUpdates}>Check for updates <AnimatedIcon kind="open" size={17} /></button>
          <p className="setting-hint">Opens the release page. Export a backup before installing an update manually.</p>
        </div>
        <details className="about-storage"><summary>{desktop ? 'Notebook storage' : 'Browser preview details'}</summary>
          <p className="setting-hint">{desktop ? 'Your notebook is stored in a local PostgreSQL database.' : 'This preview uses browser storage. The installed Windows app uses PostgreSQL.'}</p>
          <p className="storage-path">{dataPath}</p>
        </details>
      </section>
    </div>
    <div className="settings-footer"><span>Changes save automatically</span><button onClick={onDone}>Done</button></div>
  </>;
}

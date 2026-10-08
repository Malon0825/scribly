import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSettingsMotion } from './useSettingsMotion';
import { Check, Heart, Keyboard, Scan, User } from '@phosphor-icons/react';
import { AnimatedIcon } from './AnimatedIcon';
import { AppearanceSettings } from './AppearanceSettings';
import { StartupSettings } from './StartupSettings';
import type { Appearance } from './appearance';
import type { Workspace } from './types';
import { backupStatus, type BackupRecord } from './backupHistory';
import { desktop } from './storage';
import { version } from '../package.json';
const coffeeQr = new URL('./assets/coffee-qr-code.png', import.meta.url).href;

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
  const pages = useRef<HTMLDivElement>(null), tabs = useRef<HTMLDivElement>(null);
  useSettingsMotion(tabs, pages, section, sections.findIndex(item => item.id === section));
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
    <div ref={tabs} className="settings-tabs" role="tablist" aria-label="Settings sections">
      <span className="settings-tab-highlight" aria-hidden="true" hidden />
      {sections.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`} role="tab"
        aria-selected={section === item.id} aria-controls={`settings-page-${item.id}`} tabIndex={section === item.id ? 0 : -1}
        onClick={() => setSection(item.id)} onKeyDown={event => navigate(event, index)}>{item.label}</button>)}
    </div>
    <div ref={pages} className="settings-pages">
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
        <h3>Your notebook, backed up</h3>
        <p className="setting-hint">Save a separate copy before updates or moving devices.</p>
        <div className="backup-summary"><strong>{backupStatus(backup)}</strong>
          {backup?.downloaded && <p className="setting-hint">Check Downloads to confirm the file was saved.</p>}
          {(!backup || Date.now() - backup.at >= 7 * 86400000) && <p className="backup-reminder">{backup ? 'Your last export was at least a week ago.' : 'Your first backup is ready to export.'}</p>}
        </div>
        <div className="settings-actions">
          <button className="primary" disabled={backupBusy} onClick={onExport}><AnimatedIcon kind="download" size={20} />{backupBusy ? 'Exporting…' : 'Export backup'}</button>
          <button disabled={importing} onClick={onImport}><AnimatedIcon kind="upload" size={20} />Import notes or backup</button>
        </div>
        {backupExtras}
      </section>
      <section className="settings-page" role="tabpanel" id="settings-page-meetings" aria-labelledby="settings-tab-meetings" hidden={section !== 'meetings'}>{meetingExtras}</section>
      <section className="settings-page" role="tabpanel" id="settings-page-about" aria-labelledby="settings-tab-about" hidden={section !== 'about'}>
        <h3>Scribly <span className="about-version">{version}</span></h3>
        <p className="setting-hint">A little space to write, draw, and think.</p>
        <div className="about-actions">
          <button className="link-button" onClick={onShortcuts}><Keyboard size={18} aria-hidden="true" />Shortcuts <kbd>Ctrl /</kbd></button>
          <button className="link-button" onClick={onUpdates}>Check for updates <AnimatedIcon kind="open" size={17} /></button>
        </div>
        <section className="about-support" aria-labelledby="coffee-heading" data-icon-owner>
          <div className="coffee-message">
            <div className="coffee-invitation">
              <span className="coffee-emblem"><AnimatedIcon kind="coffee" size={48} /></span>
              <div className="coffee-copy">
                <span className="coffee-support-label"><Heart size={15} weight="regular" aria-hidden="true" />Support Scribly</span>
                <h4 id="coffee-heading">Buy me a coffee</h4>
                <p className="setting-hint">If Scribly makes your day a little easier, a coffee helps keep it growing.</p>
              </div>
            </div>
            <div className="coffee-payee"><span className="coffee-payee-icon" aria-hidden="true"><User size={22} weight="regular" /></span><p>Mark Malon Catunao<span>MariBank · ending 8886</span></p></div>
          </div>
          <figure className="coffee-code"><img src={coffeeQr} width={648} height={648} loading="lazy" alt="MariBank InstaPay QR code for Mark Malon Catunao, account ending in 8886" /><figcaption><Scan size={16} weight="regular" aria-hidden="true" /><span>Scan with your banking app · InstaPay</span></figcaption></figure>
        </section>
        <details className="about-storage"><summary>{desktop ? 'Notebook storage' : 'Browser preview details'}</summary>
          <p className="setting-hint">{desktop ? 'Your notebook is stored in a local PostgreSQL database.' : 'This preview uses browser storage. The installed Windows app uses PostgreSQL.'}</p>
          <p className="storage-path">{dataPath}</p>
        </details>
      </section>
    </div>
    <div className="settings-footer"><span>Changes save automatically</span><button onClick={onDone}>Done</button></div>
  </>;
}

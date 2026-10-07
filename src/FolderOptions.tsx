import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, DownloadSimple, FilePlus, Files, Microphone, PencilSimple, SlidersHorizontal, SquaresFour, Trash, UploadSimple } from '@phosphor-icons/react';
import { AppSelect } from './AppSelect';
import { MenuAction } from './MenuAction';
import { useContentMotion } from './useSurfaceMotion';
import type { Folder } from './types';
import './folder-options.css';

const Action = MenuAction;

type Page = 'main' | 'defaults';
export function FolderOptions({ folder, templates, importing, recording, onNewNote, onNewBoard, onMeeting, onTemplate, onRename, onExport, onImport, onDefaultTemplate, onCopyLast, onTrash }: {
  folder: Folder; templates: { value: string; label: string }[]; importing: boolean; recording: boolean;
  onNewNote: () => void; onNewBoard: () => void; onMeeting: () => void; onTemplate: () => void;
  onRename: () => void; onExport: () => void; onImport: () => void;
  onDefaultTemplate: (value: string) => void; onCopyLast: () => void; onTrash: () => void;
}) {
  const [page, setPage] = useState<Page>('main');
  const content = useRef<HTMLDivElement>(null), previousPage = useRef<Page>('main');
  useContentMotion(content, page);
  useLayoutEffect(() => {
    if (page !== 'main') content.current?.querySelector<HTMLButtonElement>('.folder-options-back')?.focus({ preventScroll: true });
    else if (previousPage.current !== 'main') content.current?.querySelector<HTMLButtonElement>(`[data-folder-view="${previousPage.current}"]`)?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page]);
  return <div ref={content} className="folder-options-content" onKeyDown={event => {
    if (page !== 'main' && !(event.target as HTMLElement).closest('[role="combobox"]') && ['Escape', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); setPage('main');
    }
  }}>
    {page === 'main' ? <>
      <div className="folder-action-group" role="group" aria-label="Create in folder">
        <Action icon={FilePlus} onClick={onNewNote}>New note</Action>
        <Action icon={SquaresFour} onClick={onNewBoard}>New board</Action>
        <Action icon={Microphone} disabled={recording} onClick={onMeeting}>Start meeting</Action>
        <Action icon={Files} onClick={onTemplate}>New from template…</Action>
      </div>
      <div className="folder-action-group" role="group" aria-label="Import and export">
        <Action icon={UploadSimple} disabled={importing} onClick={onImport}>Import files…</Action>
        <Action icon={DownloadSimple} onClick={onExport}>Export notes…</Action>
      </div>
      <div className="folder-action-group" role="group" aria-label="Folder settings">
        <Action icon={PencilSimple} onClick={onRename}>Rename folder…</Action>
        <Action icon={SlidersHorizontal} next data-folder-view="defaults" onClick={() => setPage('defaults')}>New note defaults</Action>
      </div>
      <div className="folder-action-group"><Action icon={Trash} className="danger-text" onClick={onTrash}>Move folder to Trash</Action></div>
    </> : <>
      <div className="folder-options-heading">
        <Action icon={ArrowLeft} className="folder-options-back" aria-label="Back to folder options" onClick={() => setPage('main')} />
        <h3>New note defaults</h3>
      </div>
      <div className="folder-defaults">
        <label htmlFor="folder-default-template" className="folder-default-label"><Files size={18} aria-hidden="true" />Default template</label>
        <AppSelect id="folder-default-template" label="Default note template" value={folder.templateId || ''} options={[{ value: '', label: 'None' }, ...templates]} onChange={onDefaultTemplate} />
        <Action icon={Copy} className="folder-copy-toggle" aria-pressed={!!folder.copyLastNote} aria-label="Copy last note" onClick={onCopyLast}>
          <span>Copy last note</span><small>Start new notes with its content</small>
          <span className="folder-copy-indicator" aria-hidden="true">{folder.copyLastNote && <Check size={13} />}</span>
        </Action>
        {folder.templateId && <p className="folder-default-hint">The default template takes priority over copying the last note.</p>}
      </div>
    </>}
  </div>;
}

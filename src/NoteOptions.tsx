import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUUpLeft, ClockCounterClockwise, Copy, DownloadSimple, Files, FolderSimple, PushPin, PushPinSlash, MagnifyingGlass, TextT, Trash } from '@phosphor-icons/react';
import { MenuAction as Action } from './MenuAction';
import { AppSelect } from './AppSelect';
import { useContentMotion } from './useSurfaceMotion';
import { isBoard, type Folder, type Note } from './types';

type Page = 'main' | 'move' | 'export';
export function NoteOptions({ note, folders, onPin, onFind, onDuplicate, onTemplate, onMove, onFormattedExport, onRawExport, onHistory, onRestore, onTrash, onMoveCloseFocus }: {
  note: Note; folders: Folder[]; onPin: () => void; onFind: () => void; onDuplicate: () => void;
  onTemplate: () => void; onMove: (folderId: string) => void; onFormattedExport: () => void;
  onRawExport: () => void; onHistory: () => void; onRestore: () => void; onTrash: () => void;
  onMoveCloseFocus: () => void;
}) {
  const [page, setPage] = useState<Page>('main');
  const content = useRef<HTMLDivElement>(null), previousPage = useRef<Page>('main');
  const board = isBoard(note), live = !note.archived && !note.deletedAt;
  const kind = board ? 'board' : 'note';
  useContentMotion(content, page);
  useLayoutEffect(() => {
    if (page !== 'main') content.current?.querySelector<HTMLButtonElement>('.folder-options-back')?.focus({ preventScroll: true });
    else if (previousPage.current !== 'main') content.current?.querySelector<HTMLButtonElement>(`[data-note-view="${previousPage.current}"]`)?.focus({ preventScroll: true });
    previousPage.current = page;
  }, [page]);
  return <div ref={content} className="folder-options-content" onKeyDown={event => {
    if (page !== 'main' && !(event.target as HTMLElement).closest('[role="combobox"]') && ['Escape', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); setPage('main');
    }
  }}>
    {page === 'main' ? <>
      {(live || !board) && <div className="folder-action-group" role="group" aria-label="Navigation">
        {live && <Action icon={note.pinned ? PushPinSlash : PushPin} onClick={onPin}>{note.pinned ? 'Unpin' : 'Pin'} {kind}</Action>}
        {!board && <Action icon={MagnifyingGlass} onClick={onFind}>Find in note</Action>}
      </div>}
      <div className="folder-action-group" role="group" aria-label="Organize item">
        <Action icon={Copy} onClick={onDuplicate}>Duplicate {kind}</Action>
        {!board && live && <Action icon={Files} onClick={onTemplate}>Save as template…</Action>}
        {!note.deletedAt && <Action icon={FolderSimple} next data-note-view="move" onClick={() => setPage('move')}>Move to folder</Action>}
      </div>
      <div className="folder-action-group" role="group" aria-label="Export and history">
        {board ? <Action icon={DownloadSimple} onClick={onRawExport}>Export drawing…</Action>
          : <Action icon={DownloadSimple} next data-note-view="export" onClick={() => setPage('export')}>Export note</Action>}
        {!note.deletedAt && <Action icon={ClockCounterClockwise} onClick={onHistory}>Version history</Action>}
      </div>
      <div className="folder-action-group" role="group" aria-label="Trash actions">
        {note.deletedAt && <Action icon={ArrowUUpLeft} onClick={onRestore}>Restore {kind}</Action>}
        <Action icon={Trash} className="danger-text" onClick={onTrash}>{note.deletedAt ? 'Delete permanently…' : 'Move to Trash'}</Action>
      </div>
    </> : <>
      <div className="folder-options-heading">
        <Action icon={ArrowLeft} className="folder-options-back" aria-label={`Back to ${kind} options`} onClick={() => setPage('main')} />
        <h3>{page === 'move' ? 'Move to folder' : 'Export note'}</h3>
      </div>
      {page === 'move' ? <div className="folder-defaults">
        <label className="folder-default-label" htmlFor="note-destination-folder"><FolderSimple size={18} aria-hidden="true" />Destination folder</label>
        <AppSelect id="note-destination-folder" className="move-folder-picker" label={`Move ${kind} to folder`} value={note.folderId || ''}
          options={[{ value: '', label: 'Unfiled notes' }, ...folders.map(folder => ({ value: folder.id, label: folder.name }))]}
          onChange={onMove} onCloseFocus={onMoveCloseFocus} />
      </div> : <div className="folder-action-group" role="group" aria-label="Export format">
        <Action icon={Files} onClick={onFormattedExport}>Formatted document…</Action>
        <Action icon={TextT} onClick={onRawExport}>Plain text (.txt)</Action>
      </div>}
    </>}
  </div>;
}

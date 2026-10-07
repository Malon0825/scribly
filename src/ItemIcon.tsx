import { Microphone, ListChecks } from '@phosphor-icons/react';
import { AnimatedIcon } from './AnimatedIcon';
import { isBoard, type Note } from './types';
export function ItemIcon({ note, size }: { note:Note; size:number }) {
  if (note.meeting) return <span className={`meeting-item-icon is-${note.meeting.role}`} role="img" aria-label={note.meeting.role === 'summary' ? 'Meeting summary' : 'Meeting transcript'}>
    {note.meeting.role === 'summary' ? <ListChecks size={size} /> : <Microphone size={size} />}
  </span>;
  return <AnimatedIcon kind={isBoard(note) ? 'board' : 'note'} size={size} />;
}

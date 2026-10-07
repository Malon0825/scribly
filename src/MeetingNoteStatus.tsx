import type { Meeting } from './meetings';
import type { Note } from './types';
export function MeetingNoteStatus({ note, meeting, summary, onOpen, onReview }: {
  note:Note; meeting?:Meeting; summary?:Note;
  onOpen:(id:string) => void; onReview:() => void;
}) {
  if (!note.meeting) return null;
  const sourceNoteId = note.meeting.sourceNoteId;
  return <div className="meeting-note-context">
    <div className="meeting-document-nav" role="group" aria-label="Meeting documents">
      <button aria-pressed={note.meeting.role === 'transcript'} onClick={() => onOpen(sourceNoteId || note.id)}>Transcript</button>
      <button aria-pressed={note.meeting.role === 'summary'} disabled={!summary && note.meeting.role !== 'summary'} onClick={() => onOpen(summary?.id || note.id)}>Meeting notes</button>
    </div>
    {note.meeting.role === 'transcript' && !!meeting?.segments.length && <div className="meeting-note-links"><button disabled={['recording','paused'].includes(meeting.recording) || ['transcribing','analyzing'].includes(meeting.processing) || meeting.notesStatus === 'processing'} onClick={onReview}>Review transcript</button></div>}
  </div>;
}

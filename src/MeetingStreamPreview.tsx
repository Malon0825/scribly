import { CircleNotch } from '@phosphor-icons/react';
import { meetingLabels, type Meeting, type MeetingStream } from './meetings';

export function MeetingStreamPreview({ meeting, stream, onCancel }: {
  meeting:Meeting; stream?:MeetingStream; onCancel:() => void;
}) {
  if (!stream && !['transcribing','analyzing'].includes(meeting.processing) && meeting.notesStatus !== 'processing') return null;
  const transcribing = meeting.processing === 'transcribing';
  const label = transcribing ? 'Transcribing recording' : stream ? `Creating ${meetingLabels[stream.kind].toLowerCase()}` : 'Preparing meeting notes';
  return <section className="meeting-stream-preview" aria-label="Meeting generation in progress" aria-busy="true">
    <div className="meeting-stream-heading"><p role="status"><CircleNotch size={18} className="meeting-stream-spinner" aria-hidden="true" />{label}…</p><button type="button" onClick={onCancel}>Cancel</button></div>
    {stream?.message ? <p className="setting-hint" role="status">{'Continuing from saved progress…'}</p> : stream && stream.parts > 1 && <p className="setting-hint">{stream.part > stream.parts ? 'Combining the meeting into one result' : `Reading part ${stream.part} of ${stream.parts}`}</p>}
    {stream?.texts.some(text => !!text) ? <><p className="setting-hint">Live draft · Still being generated and checked. Saves when this section finishes.</p><ul>{stream.texts.map((text,index) => <li key={index}>{text}</li>)}</ul></>
      : <p className="setting-hint">{transcribing ? 'Your recap will follow the transcript.' : stream?.part === 0 && !stream.message ? 'Checking the transcript and speaker context…' : stream?.message ? 'You can keep writing or switch notes. Completed parts are saved as processing continues.' : 'You can keep writing or switch notes. Your transcript and completed notes are retained.'}</p>}
  </section>;
}

import { useEffect, useState } from 'react';
import { CircleNotch } from '@phosphor-icons/react';
import { meetingLabels, type Meeting, type MeetingKind, type MeetingStream } from './meetings';
import type { MeetingAITask } from './useMeetings';

const generating: Record<MeetingKind, string> = {
  summary:'Generating summary', actions:'Finding action items', minutes:'Preparing key points',
  study:'Creating study notes', quiz:'Creating quiz', flashcards:'Creating flashcards', question:'Answering your question',
};

export function MeetingStreamPreview({ meeting, stream, task, onCancel }: {
  meeting:Meeting; stream?:MeetingStream; task?:MeetingAITask | null; onCancel:() => Promise<void>;
}) {
  const [cancellation, setCancellation] = useState<'idle' | 'stopping'>('idle');
  const [cancelError, setCancelError] = useState('');
  const activeTask = task?.id === meeting.id ? task : null;
  const activeStream = stream?.id === meeting.id && !stream.done ? stream : undefined;
  const active = !!activeTask || !!activeStream || ['transcribing','analyzing'].includes(meeting.processing) || meeting.notesStatus === 'processing';
  useEffect(() => { setCancellation('idle'); setCancelError(''); }, [meeting.id, active]);
  if (!active) return null;

  const transcribing = activeTask?.kind === 'transcript' || meeting.processing === 'transcribing';
  const kind = activeTask && activeTask.kind !== 'recap' && activeTask.kind !== 'transcript' ? activeTask.kind : activeStream?.kind;
  const title = transcribing ? 'Creating transcript' : activeTask?.resuming && kind ? `Continuing ${meetingLabels[kind].toLowerCase()}` : activeTask?.kind === 'recap' || (!kind && meeting.notesStatus === 'processing') ? 'Preparing meeting notes' : kind ? generating[kind] : 'Preparing meeting notes';
  const updating = activeTask?.stage === 'updating';
  const multipart = !!activeStream && activeStream.parts > 1;
  const combining = !!activeStream && activeStream.part > activeStream.parts;
  const phase = cancellation === 'stopping' ? 'Waiting for processing to stop.'
    : updating ? 'Updating your meeting…'
    : transcribing ? 'Processing recorded audio…'
    : activeStream?.message ? 'Continuing from saved progress…'
    : activeStream?.part === 0 ? 'Checking the transcript and speakers…'
    : combining ? 'Combining the transcript sections…'
    : multipart ? `Reading transcript part ${activeStream.part} of ${activeStream.parts}`
    : activeStream?.texts.some(Boolean) ? 'Writing and checking the result…'
    : kind && activeTask?.kind === 'recap' ? `${generating[kind]}…` : 'Reading the transcript…';

  async function cancel() {
    setCancellation('stopping'); setCancelError('');
    try { await onCancel(); }
    catch (reason) { setCancellation('idle'); setCancelError(`Could not stop processing: ${String(reason)}`); }
  }
  return <section className="meeting-stream-preview" aria-label={title} aria-busy="true">
    <div className="meeting-stream-heading">
      <CircleNotch size={22} className="meeting-stream-spinner" aria-hidden="true" />
      <div role="status" aria-live="polite" aria-atomic="true"><strong>{cancellation === 'stopping' ? 'Stopping…' : title}</strong><p>{phase}</p></div>
      {!updating && <button type="button" disabled={cancellation === 'stopping'} onClick={() => void cancel()}>{cancellation === 'stopping' ? 'Stopping…' : 'Cancel'}</button>}
    </div>
    {multipart && !updating && cancellation !== 'stopping' && <progress aria-label="Transcript parts completed" max={activeStream.parts} value={Math.max(0,Math.min(activeStream.parts,activeStream.part - 1))} />}
    {activeStream?.texts.some(Boolean) && <details className="meeting-stream-draft"><summary>Preview draft</summary><p>Still being generated and checked.</p><ul>{activeStream.texts.map((text,index) => text && <li key={index}>{text}</li>)}</ul></details>}
    {cancelError && <p className="meeting-error" role="alert">{cancelError}</p>}
  </section>;
}

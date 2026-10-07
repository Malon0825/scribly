import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { meetingTime, setMeetingAction, speakerLabel, updateMeeting, type Meeting, type MeetingAnalysis, type MeetingSegment } from './meetings';
import { meetingPersonalContent, meetingSummaryContent } from './meetingNotes';
import { NoteEditor } from './NoteEditor';
import { MeetingPlayer } from './MeetingPlayer';
import type { MeetingPlayback } from './useMeetingPlayback';
import type { MeetingsController } from './useMeetings';
import type { MeetingRequests } from './MeetingAIControls';

export function MeetingDocument({meeting,transcript,content,editedAnalysisIds,formattingVisible,player,c,requests,analysisId,seekRequest,onSeek,onFix,onSettings,onSummary,onPersonalChange,onSummaryChange,readOnly}:{
  meeting:Meeting; transcript:boolean; content:string; player:MeetingPlayback; c:MeetingsController; requests:MeetingRequests;
  editedAnalysisIds:string[]; formattingVisible:boolean;
  analysisId:string | null; seekRequest:{id:string;segment:number;serial:number} | null;
  onSeek:(segment:number) => void; onFix:(segment:number | null) => void; onSettings:() => void; onSummary:() => void;
  onPersonalChange:(html:string) => void; onSummaryChange:(html:string,ids:string[]) => boolean; readOnly:boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const actionWrites = useRef<Promise<void>>(Promise.resolve());
  const [away, setAway] = useState(false);
  const [naming, setNaming] = useState('');
  const [name, setName] = useState('');
  const personal = useMemo(() => meetingPersonalContent(content,meeting), [content,meeting]);
  const hasPersonal = useMemo(() => {
    const doc = new DOMParser().parseFromString(personal,'text/html');
    return !!doc.body.textContent?.trim() || !!doc.querySelector('img,hr,pre,table,[data-note-ink]');
  }, [personal]);
  const current = meeting.segments.find(segment => player.time >= segment.start && player.time < segment.end)?.id;
  const selected = meeting.analyses.find(analysis => analysis.id === analysisId);
  const results = selected ? [selected] : (['summary','actions','minutes'] as const).map(kind => [...meeting.analyses].reverse().find(analysis => analysis.kind === kind)).filter((result):result is MeetingAnalysis => !!result);
  const summary = meetingSummaryContent(content,meeting,results,editedAnalysisIds);
  const updated = results.length ? Math.max(...results.map(result => result.createdAt)) : null;
  function scrollTo(segment:number) { root.current?.querySelector<HTMLElement>(`[data-segment="${segment}"]`)?.scrollIntoView({block:'center',behavior:'instant'}); }
  useEffect(() => { if (transcript && seekRequest?.id === meeting.id) scrollTo(seekRequest.segment); }, [transcript,seekRequest,meeting.id]);
  useEffect(() => {
    const line = current === undefined ? null : root.current?.querySelector(`[data-segment="${current}"]`);
    if (!transcript || !line) { setAway(false); return; }
    const observer = new IntersectionObserver(entries => setAway(!entries[0].isIntersecting), {root:root.current?.closest('.document-scroll') || null,threshold:.3});
    observer.observe(line); return () => observer.disconnect();
  }, [current,transcript]);
  const groups = meeting.segments.reduce<MeetingSegment[][]>((groups,segment) => {
    const last = groups[groups.length - 1];
    if (last?.[0].speaker === segment.speaker) last.push(segment); else groups.push([segment]);
    return groups;
  }, []);
  function passage(segment:MeetingSegment):ReactNode {
    const words = segment.words?.filter(word => word.confidence < .8) || [];
    const fragments:ReactNode[] = []; let offset = 0;
    for (const word of words) {
      const index = segment.text.toLocaleLowerCase().indexOf(word.text.toLocaleLowerCase(),offset);
      if (index < 0) continue;
      fragments.push(segment.text.slice(offset,index),<span className="meeting-unclear" data-word-time={word.start} key={`${word.start}-${index}`} title="Listen and correct this unclear passage">{segment.text.slice(index,index + word.text.length)}</span>);
      offset = index + word.text.length;
    }
    fragments.push(segment.text.slice(offset)); return fragments;
  }
  return <div ref={root} className="meeting-reader">
    {!transcript && <p className="meeting-ai-caption">Made with AI · tap a time to check the original{updated && <span>Updated {new Date(updated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span>}</p>}
    {transcript ? <>
      <div className="meeting-transcript-heading"><h2>Transcript</h2><button disabled={readOnly || !!c.busy || requests.processing || meeting.recording !== 'saved'} onClick={() => onFix(current ?? meeting.segments[0]?.id ?? null)}>Fix</button></div>
      {!meeting.segments.length && <p className="meeting-empty">{meeting.recording === 'recording' ? 'The conversation will appear here as you speak.' : 'No transcript yet.'}</p>}
      {groups.map(group => {
        const canName = !meeting.speakers[group[0].speaker] && group === groups.find(item => item[0].speaker === group[0].speaker) && !readOnly;
        return <section className="meeting-speaker-group" key={group[0].id}>
        <div className="meeting-speaker-label"><h3>{canName ? <button className="meeting-name-prompt" aria-label={`Who is ${speakerLabel(meeting,group[0].speaker)}?`} title="Name this speaker" disabled={!!c.busy || requests.processing || meeting.recording !== 'saved'} onClick={() => { setNaming(group[0].speaker); setName(''); }}><span className="meeting-speaker-name">{speakerLabel(meeting,group[0].speaker)}<PencilSimple size={14} /></span><span className="meeting-speaker-time">{meetingTime(group[0].start)}</span></button> : speakerLabel(meeting,group[0].speaker)}</h3>{!canName && <span className="meeting-speaker-time">{meetingTime(group[0].start)}</span>}</div>
        {canName && naming === group[0].speaker && <form className="meeting-inline-name" onSubmit={event => { event.preventDefault(); if (name.trim()) void c.run('Saving name', () => updateMeeting({...meeting,speakers:{...meeting.speakers,[naming]:name.trim()}}), () => { setNaming(''); setName(''); }); }}><label>Who is {speakerLabel(meeting,group[0].speaker)}?<input autoFocus value={name} maxLength={200} onChange={event => setName(event.target.value)} placeholder="Name" /></label><button disabled={!name.trim() || !!c.busy} type="submit">Save</button><button type="button" onClick={() => setNaming('')}>Cancel</button></form>}
        {group.map(segment => <button key={segment.id} className="meeting-transcript-line" data-first={segment.id === group[0].id} data-segment={segment.id} data-current={(player.available ? current : seekRequest?.id === meeting.id ? seekRequest.segment : undefined) === segment.id} aria-label={`Play ${meetingTime(segment.start)}: ${segment.text}`} onClick={event => {
          const unclear = (event.target as HTMLElement).closest<HTMLElement>('[data-word-time]');
          if (unclear && !readOnly && !c.busy && !requests.processing && meeting.recording === 'saved') { player.seek(Number(unclear.dataset.wordTime),true); onFix(segment.id); }
          else onSeek(segment.id);
        }}>{group[0].id !== segment.id && <span className="meeting-line-time">{meetingTime(segment.start)}</span>}<span>{passage(segment)}</span></button>)}
      </section>; })}
      <div className="meeting-transcript-dock">{away && player.playing && current !== undefined && <button className="meeting-jump" onClick={() => scrollTo(current)}>Jump to now</button>}<MeetingPlayer player={player} />{!player.available && !player.error && <p className="meeting-secondary">No recording attached</p>}</div>
    </> : <>
      {selected && <button className="link-button" onClick={onSummary}>Back to summary</button>}
      {!results.length && <div className="meeting-empty"><h2>Summary</h2><p>{requests.processing ? 'Your summary is being prepared.' : 'Your summary has not been prepared yet.'}</p>{!requests.processing && !readOnly && meeting.recording === 'saved' && meeting.segments.length > 0 && (requests.connected ? <button className="primary" disabled={requests.unavailable} onClick={() => requests.prepare()}>Prepare summary</button> : <button className="primary" onClick={onSettings}>Set up meeting notes</button>)}</div>}
      {!!results.length && !selected && results.some(result => result.revision !== meeting.revision) && <p className="meeting-notice">The transcript has changed. Use Redo summary in meeting options to update these notes.</p>}
      <NoteEditor content={summary} readOnly={readOnly} formattingVisible={formattingVisible}
        onMeetingSeek={(session,segment) => { if (session === meeting.id) onSeek(segment); }}
        onChange={html => {
          if (!onSummaryChange(html,results.map(result => result.id))) return;
          const doc = new DOMParser().parseFromString(html,'text/html');
          const before = new DOMParser().parseFromString(summary,'text/html');
          const checked = new Map(Array.from(doc.querySelectorAll('[data-meeting-action]')).map(node => [node.getAttribute('data-meeting-action'),node.getAttribute('data-checked') === 'true']));
          const previous = new Map(Array.from(before.querySelectorAll('[data-meeting-action]')).map(node => [node.getAttribute('data-meeting-action'),node.getAttribute('data-checked') === 'true']));
          const changes = results.filter(result => result.kind === 'actions').flatMap(result => result.items.flatMap((_item,index) => {
            const key = `${result.id}:${index}`, done = checked.get(key);
            return done !== undefined && done !== previous.get(key) ? [{id:result.id,index,done}] : [];
          }));
          if (changes.length) actionWrites.current = actionWrites.current.then(async () => {
            for (const change of changes) await setMeetingAction(meeting.id,change.id,change.index,change.done);
            await c.reload();
          }).catch(reason => c.setError(`Action items could not be synchronized: ${String(reason)}`));
        }} />
    </>}
    {transcript && hasPersonal && <NoteEditor content={personal} readOnly={readOnly} formattingVisible={formattingVisible} onChange={onPersonalChange} />}
  </div>;
}

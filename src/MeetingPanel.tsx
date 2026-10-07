import { useEffect, useRef, useState } from 'react';
import { useContentMotion } from './useSurfaceMotion';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { Microphone, Pause, Play, Stop, Gear, DotsThree, Trash, DownloadSimple, Copy, Users, Translate, ArrowCounterClockwise, ArrowsClockwise, ClockCounterClockwise, VideoCamera, NotePencil, ListChecks, Cards, Folders } from '@phosphor-icons/react';
import { Dialog } from './Dialog';
import { MeetingAIControls, type MeetingRequests } from './MeetingAIControls';
import { ActionPopover } from './ActionPopover';
import { MenuAction } from './MenuAction';
import { MeetingPlayer } from './MeetingPlayer';
import type { MeetingPlayback } from './useMeetingPlayback';
import { desktop, exportArtifact } from './storage';
import { defaultSpeakerLabel, meetingMarkdown, meetingMedia, meetingTime, speakerLabel, speakerIdentityLabel, sampleMeeting, savePreviewMeeting, updateMeeting, type Meeting, type MeetingDevice } from './meetings';
import type { MeetingsController } from './useMeetings';

type Editor = { meeting: Meeting; segment: number | null };
export function MeetingEdit({ value, c, onClose }: { value: Editor; c: MeetingsController; onClose: () => void }) {
  const [draft, setDraft] = useState(value.meeting);
  const [segmentId, setSegmentId] = useState(value.segment);
  const segment = segmentId === null ? null : draft.segments.find(item => item.id === segmentId);
  return createPortal(<Dialog title={segment ? 'Fix transcript' : 'Rename people'} onClose={() => { if (!c.busy) onClose(); }} initialFocus={() => document.querySelector<HTMLInputElement | HTMLTextAreaElement>('#meeting-edit-first')}>
    <form onSubmit={event => { event.preventDefault(); void c.run('Saving meeting', () => updateMeeting(draft), onClose); }}>
      {segment ? <>
        <label className="meeting-field">Transcript segment<select value={segmentId!} onChange={event => setSegmentId(Number(event.target.value))}>{draft.segments.map(item => <option key={item.id} value={item.id}>{meetingTime(item.start)} · {speakerLabel(draft,item.speaker)} · {item.text.slice(0,70)}</option>)}</select></label>
        <label className="field-label" htmlFor="meeting-edit-first">Transcript · {meetingTime(segment.start)}</label>
        <textarea id="meeting-edit-first" className="meeting-transcript-edit" value={segment.text} maxLength={50_000} onChange={event => setDraft({ ...draft, segments: draft.segments.map(item => item.id === segment.id ? { ...item, text: event.target.value, words:[] } : item) })} />
        <label className="field-label" htmlFor="meeting-edit-speaker">Speaker</label>
        <select id="meeting-edit-speaker" value={segment.speaker} onChange={event => setDraft({ ...draft, segments: draft.segments.map(item => item.id === segment.id ? { ...item, speaker: event.target.value } : item) })}>
          {[...new Set(draft.segments.map(item => item.speaker))].map(id => <option key={id} value={id}>{speakerLabel(draft,id)}</option>)}
        </select>
      </> : <>
        <label className="meeting-field" htmlFor="meeting-edit-first">Meeting title
          <input id="meeting-edit-first" value={draft.title} required maxLength={200} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <p className="setting-hint">Name each person once. Their name will appear throughout the meeting.</p>
        {[...new Set(draft.segments.map(item => item.speaker))].map(id => {
          const identity = draft.speakerIdentities?.find(identity => identity.speakerId === id);
          const current = draft.speakerIdentityRevision === draft.revision;
          return <div key={id} className="meeting-speaker-entry"><label className="meeting-field">{defaultSpeakerLabel(id)}<input value={draft.speakers[id] || ''} maxLength={200} placeholder={defaultSpeakerLabel(id)} onChange={event => setDraft({ ...draft, speakers: { ...draft.speakers, [id]: event.target.value } })} /></label>
            {identity && <details className="meeting-speaker-evidence"><summary>{identity.confidence === 'strong' ? 'AI inferred' : 'Suggested'}: {speakerIdentityLabel(identity)}{!current && ' · Earlier transcript'}</summary>
              <p className="setting-hint">{identity.reason}</p>
              {!!identity.aliases.length && <p className="setting-hint">Spelling variants: {identity.aliases.join(', ')}</p>}
              {current && identity.sources.map(id => { const source = draft.segments.find(segment => segment.id === id); return source ? <p key={id} className="setting-hint">{meetingTime(source.start)} · {defaultSpeakerLabel(source.speaker)}: {source.text.slice(0,400)}</p> : null; })}
              {current && draft.speakers[id] !== speakerIdentityLabel(identity) && <button type="button" disabled={!!c.busy} onClick={() => setDraft({...draft,speakers:{...draft.speakers,[id]:speakerIdentityLabel(identity)}})}>Use suggested name</button>}
            </details>}
          </div>;
        })}
      </>}

      {c.error && <p role="alert" className="meeting-error">Changes could not be saved. Try again or check Settings.</p>}
      <div className="dialog-actions"><button type="button" disabled={!!c.busy} onClick={onClose}>Cancel</button><button className="primary" disabled={!!c.busy || !draft.title.trim()} type="submit">Save changes</button></div>
    </form>
  </Dialog>, document.body);
}

export function MeetingPanel({ controller: c, noteId, noteTitle, meetingNote, meetingSessionId, allowAnalysis, requests, player, transcript, onView, onAnalysis, onDelete, onExport, onPrepareMeeting, onOpenMeeting, onSettings }: {
  controller: MeetingsController; noteId: string | null; noteTitle: string;
  meetingNote: boolean; meetingSessionId?: string; onPrepareMeeting: () => Promise<{noteId:string;title:string}>;
  onOpenMeeting: (meeting: Meeting, results?:boolean) => void; onSettings: () => void;
  allowAnalysis: boolean; requests:MeetingRequests; player:MeetingPlayback; transcript:boolean; onView:(transcript:boolean) => void; onAnalysis:(id:string | null) => void; onDelete:(meeting:Meeting) => void;
  onExport:(meeting:Meeting,returnTo:HTMLElement | null) => boolean;
}) {
  const [devices, setDevices] = useState<MeetingDevice[]>([]);
  const [microphone, setMicrophone] = useState('default');
  const [system, setSystem] = useState('default');
  const [videoSource, setVideoSource] = useState('none');
  const [consent, setConsent] = useState(false);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('en');
  const [liveTranscription, setLiveTranscription] = useState(true);
  const [newRecording, setNewRecording] = useState(false);
  const transcriptionModel = c.preferences.transcriptionModel;
  const batchTranscription = transcriptionModel === 'gemini-3.5-transcribe';
  const transcriptionConnected = transcriptionModel === 'deepgram' ? c.connections.deepgram : !!c.connections.gemini;
  const fileModel = transcriptionModel === 'deepgram' ? 'deepgram' : 'gemini-3.5-transcribe';
  const [edit, setEdit] = useState<Editor | null>(null);
  const [options, setOptions] = useState(false);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<'redo' | 'save' | 'language' | 'history' | 'other' | 'video' | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const [includeMedia, setIncludeMedia] = useState(true);
  const titleInput = useRef<HTMLInputElement>(null);
  const restoreSetupFocus = useRef(false);
  const meeting = meetingSessionId ? c.meetings.find(item => item.id === meetingSessionId && !item.deletedAt) || null : meetingNote ? null : c.selected;
  const showSetup = !c.recording && (!meeting || newRecording);
  useEffect(() => {
    if (newRecording && showSetup) titleInput.current?.focus();
    else if (restoreSetupFocus.current) { restoreSetupFocus.current = false; optionsButton.current?.focus(); }
  }, [newRecording, showSetup]);
  const surface = useRef<HTMLDivElement>(null);
  useContentMotion(surface, meeting?.id || 'new');
  const processing = !!meeting && (['transcribing', 'analyzing'].includes(meeting.processing) || meeting.notesStatus === 'processing');
  const error = c.error || (!showSetup && meeting?.error);
  const progress = (c.busy ? /sav|updat|restor|export|import|recover/i.test(c.busy) ? 'Saving changes' : 'Working on this meeting' : '') || (processing ? meeting?.processing === 'transcribing' ? 'Creating the transcript' : 'Preparing meeting notes' : '');
  const refreshDevices = () => { if (desktop) void invoke<MeetingDevice[]>('meeting_devices').then(setDevices).catch(reason => c.setError(String(reason))); };
  useEffect(refreshDevices, []);
  useEffect(() => { setLanguage(meeting?.transcriptionLanguage || 'en'); setOptions(false); setSheet(null); }, [meeting?.id]);
  useEffect(() => {
    let live = true; setVideoUrl('');
    if (sheet === 'video' && meeting?.video && desktop) void meetingMedia(meeting.id,true).then(url => { if (live) setVideoUrl(url); }).catch(reason => { if (live) c.setError(String(reason)); });
    return () => { live = false; };
  }, [sheet,meeting?.id,meeting?.video]);
  useEffect(() => {
    const element = video.current; if (!element) return;
    if (Math.abs(element.currentTime - player.time) > .3) element.currentTime = player.time;
    if (player.playing) void element.play().catch(() => {}); else element.pause();
  }, [player.time,player.playing,videoUrl]);
  const nativeSource = (value: string) => value === 'none' ? null : value === 'default' ? '' : value;
  function sourceSelect(label: string, kind: MeetingDevice['kind'], value: string, set: (value: string) => void) {
    return <label className="meeting-field">{label}<select value={value} onChange={event => set(event.target.value)} disabled={!!c.recording || !!c.busy || !desktop}>
      <option value="none">Off</option>{kind !== 'video' && <option value="default">Windows default</option>}
      {devices.filter(device => device.kind === kind).map((device, index) => <option key={`${device.id}-${index}`} value={device.id}>{device.name}</option>)}
    </select></label>;
  }
  function languageSelect() {
    return <label className="meeting-field">Spoken language<select value={language} disabled={!!c.busy || processing || !desktop} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="multi">Multilingual</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ja">Japanese</option><option value="zh">Chinese</option></select></label>;
  }
  function openResult(result: Meeting | null) { if (result) { setNewRecording(false); c.selectResult(result); onOpenMeeting(result); } }
  function transcribe() { void c.run('Creating transcript', () => invoke<Meeting>('meeting_transcribe', {id:meeting!.id,language,model:fileModel}), c.selectResult); }
  const cannotTranscribe = !desktop || !transcriptionConnected || !meeting?.media || meeting?.recording !== 'saved' || !!c.busy || processing;
  const sources = [microphone !== 'none' && 'microphone', system !== 'none' && 'call audio', videoSource !== 'none' && 'video'].filter(Boolean).join(', ');
  return <div ref={surface} className="meeting-panel">
    {(!meeting || showSetup) && <div className="meeting-toolbar"><strong>New meeting</strong><button className="icon-button" aria-label="Meeting settings" title="Services and defaults" onClick={onSettings}><Gear size={19} /></button></div>}
    {!desktop && <p className="meeting-notice">Browser preview. Recording and connected AI are available in the Windows app.</p>}
    {c.reminder && <div className="meeting-notice" role="alert"><p>{c.reminder.message}</p><button onClick={c.dismissReminder}>Dismiss reminder</button></div>}
    {error && <div className="meeting-feedback" role="alert"><strong>This action could not finish.</strong><p>Check your account or recording in Settings, then try again.</p><button className="link-button" onClick={onSettings}>Open Settings</button></div>}
    {progress && <div className="meeting-work-status"><p role="status" className="meeting-progress">{progress}…</p>{processing && meeting && <button className="link-button" onClick={() => void invoke('meeting_cancel', {id:meeting.id}).catch(reason => c.setError(String(reason)))}>Cancel processing</button>}</div>}
    {c.recording ? <section className="meeting-capture" aria-label="Recording controls">
      <p className="meeting-recording-label" role="status">{c.recording.recording === 'paused' ? 'Paused' : 'Recording'} <span>{meetingTime(c.feedback?.id === c.recording.id ? c.feedback.duration : c.recording.duration)}</span></p>
      <h3 className="meeting-section-title">{c.recording.title}</h3>
      <div className="meeting-levels"><label>Microphone <meter min={0} max={1} value={c.feedback?.microphone || 0} /></label><label>Call audio <meter min={0} max={1} value={c.feedback?.system || 0} /></label></div>
      <div className="meeting-buttons"><button disabled={!!c.recordingBusy} onClick={() => void c.runRecording('Updating recording', () => invoke<Meeting>('meeting_pause', {id:c.recording!.id,paused:c.recording!.recording !== 'paused'}))}>{c.recording.recording === 'paused' ? <Play size={16} /> : <Pause size={16} />}{c.recording.recording === 'paused' ? 'Resume' : 'Pause'}</button><button className="primary" disabled={!!c.recordingBusy} onClick={() => void c.runRecording('Ending recording', () => invoke<Meeting | null>('meeting_stop'), value => { if (value) { setNewRecording(false); onOpenMeeting(value,true); } })}><Stop size={16} />End recording</button></div>
      <p className="setting-hint">Stops after 3 minutes of silence. Paused time does not count.{c.feedback?.silentFor !== undefined && c.feedback.silentFor > 60 && ` No speech for ${meetingTime(c.feedback.silentFor)}.`}</p>
      {c.recordingBusy && <p role="status" className="meeting-progress">{c.recordingBusy}…</p>}
    </section> : showSetup && <section className="meeting-capture" aria-label="New recording">
      <div className="meeting-heading"><h3 className="meeting-section-title">New recording</h3>{meeting && <button className="link-button" disabled={!!c.busy} onClick={() => { restoreSetupFocus.current = true; setNewRecording(false); }}>Back to meeting</button>}</div>
      <p className="setting-hint">Record the conversation. Get a transcript and meeting notes when you finish.</p>
      <label className="meeting-field meeting-title-field">Meeting title <span className="meeting-field-optional">Optional</span><input ref={titleInput} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder={meetingNote ? noteTitle : 'Leave blank to use the note title'} disabled={!!c.busy} /></label>
      <p className="meeting-source-summary">{microphone !== 'none' || system !== 'none' ? `Capturing ${sources}.` : 'Choose a microphone or call audio in Recording options.'}</p>
      <details className="meeting-recording-options"><summary>Recording options</summary>
        {sourceSelect('Microphone', 'microphone', microphone, setMicrophone)}{sourceSelect('Call audio', 'system', system, setSystem)}{sourceSelect('Screen or window (optional)', 'video', videoSource, setVideoSource)}
        {desktop && <button className="link-button" disabled={!!c.busy} onClick={refreshDevices}>Refresh available devices</button>}
        {languageSelect()}
        {!batchTranscription && <label className="meeting-check"><input type="checkbox" checked={liveTranscription} disabled={!desktop || !!c.busy} onChange={event => setLiveTranscription(event.target.checked)} />Show transcript while recording</label>}
        <p className="setting-hint">{batchTranscription ? 'Audio is sent to your connected account after recording. Maximum 30 minutes.' : liveTranscription ? 'Audio is sent to your connected account while recording.' : 'Audio stays local until you choose to create a transcript.'} Account and data-use details are in Settings.</p>
      </details>
      <label className="meeting-check"><input type="checkbox" checked={consent} disabled={!desktop || !!c.busy} onChange={event => setConsent(event.target.checked)} />I have permission to record everyone.</label>
      {(batchTranscription || liveTranscription) && !transcriptionConnected && desktop && <p className="meeting-notice">Connect your transcription service in Meeting settings before recording.{!batchTranscription && ' Or turn off live transcription to record locally.'}</p>}
      <div className="meeting-buttons meeting-start-actions"><button className="primary" disabled={!desktop || !consent || (microphone === 'none' && system === 'none') || !!c.busy || ((batchTranscription || liveTranscription) && !transcriptionConnected)} onClick={() => void c.run('Starting recording', async () => { const target = await onPrepareMeeting(); return invoke<Meeting>('meeting_start', {title:title.trim() || target.title,noteId:target.noteId,microphone:nativeSource(microphone),system:nativeSource(system),video:nativeSource(videoSource),consent,language:batchTranscription || liveTranscription ? language : null,autoNotes:true,model:null,transcriptionModel}); }, result => { setConsent(false); openResult(result); })}><Microphone size={16} />Start recording</button>
        <button className="link-button" disabled={!desktop || !!c.busy} onClick={() => void c.run('Importing recording', () => invoke<Meeting | null>('meeting_import', {title,noteId}), openResult)}>Use a recording file</button></div>
      {!desktop && <button disabled={!!c.busy} onClick={() => void c.run('Loading sample', async () => { const target = await onPrepareMeeting(); const record = sampleMeeting(target.noteId,true); await savePreviewMeeting(record); return record; }, openResult)}>Load sample meeting</button>}
    </section>}
    {meeting && !showSetup && <>
      <div className="meeting-panel-heading"><div><h3>{meeting.title}</h3><p className="meeting-secondary">{new Date(meeting.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · {meetingTime(meeting.duration)} · {new Set(meeting.segments.map(segment => segment.speaker)).size} people</p></div><button ref={optionsButton} className="icon-button meeting-options-trigger" aria-label="Meeting options" title="Meeting options" aria-haspopup="dialog" aria-expanded={options} onClick={() => setOptions(value => !value)}><DotsThree size={28} weight="regular" /></button></div>
      <div className="meeting-document-nav" role="group" aria-label="Meeting view"><button aria-pressed={!transcript} onClick={() => onView(false)}>Summary</button><button aria-pressed={transcript} onClick={() => onView(true)}>Transcript</button></div>
      {meeting.recording === 'interrupted' && <div className="meeting-next-step"><p>This recording was interrupted.</p><button className="primary" disabled={!!c.busy} onClick={() => void c.run('Recovering recording', () => invoke<Meeting>('meeting_recover', {id:meeting.id}), c.selectResult)}>Recover recording</button></div>}
      {meeting.recording === 'saved' && !meeting.segments.length && <div className="meeting-next-step"><p>No transcript yet.</p>{!transcriptionConnected && desktop ? <button className="primary" onClick={onSettings}>Set up transcription</button> : <button className="primary" disabled={cannotTranscribe} onClick={transcribe}>Create transcript</button>}</div>}
      {allowAnalysis && meeting.recording === 'saved' && !!meeting.segments.length && <MeetingAIControls key={meeting.id} requests={requests} />}
      {options && <ActionPopover anchor={optionsButton.current} label="Meeting options" className="meeting-options-menu" onClose={() => setOptions(false)}>
        <div className="folder-action-group" role="group" aria-label="Share and save">
          <MenuAction icon={DownloadSimple} disabled={!!c.busy} onClick={() => { setOptions(false); if (onExport(meeting,optionsButton.current)) return; void c.run('Exporting meeting', () => exportArtifact(`${meeting.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)}.md`,meetingMarkdown(meeting),'text/markdown')); }}>Share or export</MenuAction>
          <MenuAction icon={Copy} disabled={!desktop || !!c.busy || meeting.recording !== 'saved'} onClick={() => { setOptions(false); setSheet('save'); }}>Save a copy</MenuAction>
        </div>
        <div className="folder-action-group" role="group" aria-label="Fix meeting">
          <MenuAction icon={Users} disabled={!!c.busy || processing || meeting.recording !== 'saved'} onClick={() => { setOptions(false); setEdit({meeting,segment:null}); }}>Rename people</MenuAction>
          <MenuAction icon={Translate} disabled={!!c.busy || processing} onClick={() => { setOptions(false); setSheet('language'); }}>Language: {({en:'English',multi:'Multilingual',es:'Spanish',fr:'French',de:'German',ja:'Japanese',zh:'Chinese'} as Record<string,string>)[language] || language}</MenuAction>
          <MenuAction icon={ArrowCounterClockwise} disabled={cannotTranscribe} onClick={() => { setOptions(false); setSheet('redo'); }}>Redo transcript</MenuAction>
          <MenuAction icon={ArrowsClockwise} disabled={requests.unavailable || !allowAnalysis} onClick={() => { setOptions(false); requests.prepare(true); }}>Redo summary</MenuAction>
          {meeting.recovery && <MenuAction icon={Play} disabled={requests.unavailable} onClick={() => { setOptions(false); requests.resume(); }}>Continue unfinished summary</MenuAction>}
          <MenuAction icon={ClockCounterClockwise} disabled={!meeting.analyses.length} onClick={() => { setOptions(false); setSheet('history'); }}>Earlier versions</MenuAction>
          {meeting.video && <MenuAction icon={VideoCamera} onClick={() => { setOptions(false); setSheet('video'); }}>Watch video</MenuAction>}
        </div>
        <div className="folder-action-group" role="group" aria-label="Study tools">
          <MenuAction icon={NotePencil} disabled={requests.unavailable || !allowAnalysis} onClick={() => { setOptions(false); requests.generate('study'); }}>Make study notes</MenuAction>
          <MenuAction icon={ListChecks} disabled={requests.unavailable || !allowAnalysis} onClick={() => { setOptions(false); requests.generate('quiz'); }}>Make quiz</MenuAction>
          <MenuAction icon={Cards} disabled={requests.unavailable || !allowAnalysis} onClick={() => { setOptions(false); requests.generate('flashcards'); }}>Make flashcards</MenuAction>
        </div>
        <div className="folder-action-group" role="group" aria-label="Meeting navigation and settings">
          <MenuAction icon={Microphone} onClick={() => { setOptions(false); setTitle(''); setConsent(false); setNewRecording(true); }}>New recording</MenuAction>
          {c.meetings.filter(item => !item.deletedAt).length > 1 && <MenuAction icon={Folders} onClick={() => { setOptions(false); setSheet('other'); }}>Other meetings</MenuAction>}
          <MenuAction icon={Gear} onClick={() => { setOptions(false); onSettings(); }}>Settings</MenuAction>
        </div>
        <div className="folder-action-group" role="group" aria-label="Remove meeting"><MenuAction icon={Trash} className="danger-text" disabled={!!c.busy || processing || c.recording?.id === meeting.id} onClick={() => { setOptions(false); onDelete(meeting); }}>Delete</MenuAction></div>
      </ActionPopover>}
    </>}
    {showSetup && c.meetings.some(item => !item.deletedAt) && <button className="link-button" onClick={() => setSheet('other')}>Open a saved meeting</button>}
    {edit && <MeetingEdit value={edit} c={c} onClose={() => setEdit(null)} />}
    {sheet && meeting && sheet !== 'other' && createPortal(<Dialog title={sheet === 'redo' ? 'Redo transcript?' : sheet === 'save' ? 'Save a copy' : sheet === 'language' ? 'Meeting language' : sheet === 'video' ? 'Meeting video' : 'Earlier versions'} onClose={() => setSheet(null)} initialFocus={() => document.getElementById('meeting-sheet-first')}>
      {sheet === 'video' && <>{videoUrl ? <video ref={video} src={videoUrl} className="meeting-video" muted playsInline aria-label="Meeting video" onError={() => c.setError('The video could not be played.')} /> : <p role="status">Opening video…</p>}<MeetingPlayer player={player} /></>}
      {sheet === 'redo' && <><p>Create a new transcript? Your current one and speaker names will be replaced. Your notes stay.</p><div className="dialog-actions"><button id="meeting-sheet-first" onClick={() => setSheet(null)}>Cancel</button><button className="primary" disabled={cannotTranscribe} onClick={() => { setSheet(null); transcribe(); }}>Create new transcript</button></div></>}
      {sheet === 'save' && <><label className="meeting-check"><input id="meeting-sheet-first" type="checkbox" checked={includeMedia} onChange={event => setIncludeMedia(event.target.checked)} />Include audio and video</label><div className="dialog-actions"><button onClick={() => setSheet(null)}>Cancel</button><button className="primary" disabled={!!c.busy} onClick={() => void c.run('Saving a copy', () => invoke('meeting_archive',{id:meeting.id,includeMedia}), () => setSheet(null))}>Save copy</button></div></>}
      {sheet === 'language' && <>{languageSelect()}<p className="setting-hint">Used next time you redo the transcript.</p><div className="dialog-actions"><button id="meeting-sheet-first" onClick={() => setSheet(null)}>Done</button></div></>}
      {sheet === 'history' && <div className="meeting-version-list">{[...meeting.analyses].reverse().map(result => <button key={result.id} onClick={() => { setSheet(null); onAnalysis(result.id); }}>{({summary:'Summary',minutes:'Key points',actions:'Action items',study:'Study notes',quiz:'Quiz',flashcards:'Flashcards',question:'Answer'})[result.kind]}<span>{new Date(result.createdAt).toLocaleString()}</span></button>)}</div>}
    </Dialog>, document.body)}
    {sheet === 'other' && createPortal(<Dialog title="Saved meetings" onClose={() => setSheet(null)}><div className="meeting-version-list">{c.meetings.filter(item => !item.deletedAt).map(item => <button key={item.id} onClick={() => { setSheet(null); openResult(item); }}>{item.title}<span>{new Date(item.createdAt).toLocaleDateString()}</span></button>)}</div></Dialog>,document.body)}
  </div>;
}

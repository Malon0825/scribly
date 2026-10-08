import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';
import { openRouterModel, meetingLabels, meetingTime, type Meeting, type MeetingKind } from './meetings';
import type { MeetingsController } from './useMeetings';
import { CircleNotch } from '@phosphor-icons/react';

export function useMeetingRequests(meeting: Meeting | null, c: MeetingsController, onGenerated: (meeting: Meeting, kind?: MeetingKind) => void) {
  const [model, setModel] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const provider = c.preferences.requestProvider;
  useEffect(() => {
    let live = true;
    setModel(''); setCatalogError('');
    const loading = desktop && c.connections.chatgpt && provider === 'chatgpt';
    setCatalogLoading(loading);
    if (loading) void invoke<{id:string;name:string}[]>('meeting_models').then(items => {
      if (!live) return;
      const selected = c.preferences.chatgptModel;
      if (selected && !items.some(item => item.id === selected)) setCatalogError('The selected model is unavailable. Choose another in Settings.');
      else if (!items.length) setCatalogError('No meeting models are available for this account. Check your connection in Settings.');
      else setModel(selected || items[0]?.id || '');
    }).catch(reason => { if (live) setCatalogError(String(reason)); }).finally(() => { if (live) setCatalogLoading(false); });
    return () => { live = false; };
  }, [c.connections.chatgpt, c.connections.email, c.preferences.chatgptModel, provider]);
  const requestModel = provider === 'gemini' ? 'gemini-3.8-flash' : provider === 'openrouter' ? openRouterModel : model;
  const connected = provider === 'gemini' ? !!c.connections.gemini : provider === 'openrouter' ? !!c.connections.openrouter : c.connections.chatgpt;
  const processing = !!meeting && (['transcribing','analyzing'].includes(meeting.processing) || meeting.notesStatus === 'processing');
  const unavailable = !desktop || !requestModel || !connected || !meeting?.segments.length || meeting.recording !== 'saved' || !!c.busy || processing || !!meeting.deletedAt;
  const recovery = meeting?.recovery;
  const canResume = !unavailable && !!recovery && recovery.model === requestModel && recovery.revision === meeting?.revision;
  const recapKinds = ['summary','actions','minutes'] as const;
  const missing = meeting ? recapKinds.filter(kind => !meeting.analyses.some(analysis => analysis.kind === kind && analysis.revision === meeting.revision)) : [...recapKinds];
  function prepare(regenerate = false) {
    if (!meeting || unavailable) return;
    void c.run('Preparing summary', async () => {
      let result = meeting;
      const kinds: string[] = regenerate ? [...recapKinds] : [];
      for (let request = 0; request < recapKinds.length + 1; request++) {
        const kind = kinds.shift() || recapKinds.find(kind => !result.analyses.some(analysis => analysis.kind === kind && analysis.revision === result.revision));
        if (!kind) break;
        result = await invoke<Meeting>('meeting_analyze', {id:meeting.id,model:requestModel,kind,question:'',notes:''});
        await c.reload();
      }
      return result;
    }, result => onGenerated(result), {id:meeting.id,kind:'recap'});
  }
  function generate(kind: MeetingKind, question = '') {
    if (!meeting || unavailable) return;
    void c.run(`Creating ${meetingLabels[kind].toLowerCase()}`, () => analyze(kind, question, ''), result => onGenerated(result,kind), {id:meeting.id,kind});
  }
  async function analyze(kind: MeetingKind, question: string, notes: string) {
    if (!meeting) throw Error('No meeting is selected.');
    return invoke<Meeting>('meeting_analyze', {id:meeting.id,model:requestModel,kind,question,notes});
  }
  function resume() {
    const recovery = meeting?.recovery;
    if (!meeting || !recovery || !canResume) return;
    void c.run(`Continuing ${meetingLabels[recovery.kind].toLowerCase()}`, () => analyze(recovery.kind,recovery.question,recovery.notes), result => onGenerated(result,recovery.kind), {id:meeting.id,kind:recovery.kind,resuming:true});
  }
  return {unavailable, connected, missing, processing, catalogError, catalogLoading, canResume, questionPending:!!meeting && c.aiTask?.id === meeting.id && c.aiTask.kind === 'question', prepare, generate, resume};
}
export type MeetingRequests = ReturnType<typeof useMeetingRequests>;

export function MeetingAIControls({ requests, meeting, onSeek, progress }: {requests:MeetingRequests; meeting:Meeting; onSeek:(segment:number) => void; progress?:ReactNode}) {
  const [question, setQuestion] = useState('');
  return <div className="meeting-questions">
    <form onSubmit={event => { event.preventDefault(); if (question.trim()) requests.generate('question',question.trim()); }}>
      <label className="sr-only" htmlFor="meeting-question">Ask about this meeting</label>
      <input id="meeting-question" value={question} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder="Ask about this meeting…" readOnly={requests.questionPending} />
      {!!question.trim() && <button disabled={requests.unavailable} type="submit" aria-busy={requests.questionPending}>{requests.questionPending ? 'Asking…' : 'Ask'}</button>}
    </form>
    {progress}
    {requests.catalogError ? <p className="meeting-error" role="status">{requests.catalogError}</p> : !requests.connected && <p className="meeting-secondary">Questions and study tools need an account. Open Settings from meeting options.</p>}
    {requests.catalogLoading && <p role="status" className="meeting-model-loading"><CircleNotch size={16} className="meeting-stream-spinner" aria-hidden="true" />Loading AI models…</p>}
    <div className="meeting-follow-ups" aria-label="Meeting questions and answers">
      {[...meeting.analyses].reverse().filter(result => result.kind === 'question').map(result => <section key={result.id} id={`meeting-answer-${result.id}`} className="meeting-follow-up" aria-label={result.question}>
        <h4>{result.question}</h4>
        {result.revision !== meeting.revision && <p className="meeting-secondary">Based on an earlier transcript</p>}
        {result.items.length ? <ul>{result.items.map((item,index) => {
          const source = result.revision === meeting.revision ? meeting.segments.find(segment => item.sources.includes(segment.id)) : undefined;
          return <li key={index}>{item.text}{source && <button type="button" className="meeting-time" aria-label={`Play source at ${meetingTime(source.start)}`} onClick={() => onSeek(source.id)}>{meetingTime(source.start)}</button>}</li>;
        })}</ul> : <p>The transcript does not contain enough information to answer this question.</p>}
      </section>)}
    </div>
  </div>;
}

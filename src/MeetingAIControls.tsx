import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';
import { openRouterModel, meetingLabels, type Meeting, type MeetingKind } from './meetings';
import type { MeetingsController } from './useMeetings';

export function useMeetingRequests(meeting: Meeting | null, c: MeetingsController, onGenerated: (meeting: Meeting, kind?: MeetingKind) => void) {
  const [model, setModel] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const provider = c.preferences.requestProvider;
  useEffect(() => {
    let live = true;
    setModel(''); setCatalogError('');
    if (desktop && c.connections.chatgpt && provider === 'chatgpt') void invoke<{id:string;name:string}[]>('meeting_models').then(items => {
      if (!live) return;
      const selected = c.preferences.chatgptModel;
      if (selected && !items.some(item => item.id === selected)) setCatalogError('The selected model is unavailable. Choose another in Settings.');
      else setModel(selected || items[0]?.id || '');
    }).catch(reason => { if (live) setCatalogError(String(reason)); });
    return () => { live = false; };
  }, [c.connections.chatgpt, c.connections.email, c.preferences.chatgptModel, provider]);
  const requestModel = provider === 'gemini' ? 'gemini-3.8-flash' : provider === 'openrouter' ? openRouterModel : model;
  const connected = provider === 'gemini' ? !!c.connections.gemini : provider === 'openrouter' ? !!c.connections.openrouter : c.connections.chatgpt;
  const processing = !!meeting && (['transcribing','analyzing'].includes(meeting.processing) || meeting.notesStatus === 'processing');
  const unavailable = !desktop || !requestModel || !connected || !meeting?.segments.length || meeting.recording !== 'saved' || !!c.busy || processing || !!meeting.deletedAt;
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
    }, result => onGenerated(result));
  }
  function generate(kind: MeetingKind, question = '') {
    if (!meeting || unavailable) return;
    void c.run(`Creating ${meetingLabels[kind].toLowerCase()}`, () => invoke<Meeting>('meeting_analyze', {id:meeting.id,model:requestModel,kind,question,notes:''}), result => onGenerated(result,kind));
  }
  function resume() {
    const recovery = meeting?.recovery;
    if (!meeting || !recovery || unavailable || recovery.model !== requestModel || recovery.revision !== meeting.revision) return;
    void c.run('Continuing summary', () => invoke<Meeting>('meeting_analyze', {id:meeting.id,model:requestModel,kind:recovery.kind,question:recovery.question,notes:recovery.notes}), result => onGenerated(result,recovery.kind));
  }
  return {unavailable, connected, missing, processing, catalogError, prepare, generate, resume};
}
export type MeetingRequests = ReturnType<typeof useMeetingRequests>;

export function MeetingAIControls({ requests }: {requests:MeetingRequests}) {
  const [question, setQuestion] = useState('');
  return <div className="meeting-questions">
    <form onSubmit={event => { event.preventDefault(); if (question.trim()) requests.generate('question',question.trim()); }}>
      <label className="sr-only" htmlFor="meeting-question">Ask about this meeting</label>
      <input id="meeting-question" value={question} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder="Ask about this meeting…" disabled={requests.processing} />
      {!!question.trim() && <button disabled={requests.unavailable} type="submit">Ask</button>}
    </form>
    {(!requests.connected || requests.catalogError) && <p className="meeting-secondary">Questions and study tools need an account. Open Settings from meeting options.</p>}
  </div>;
}

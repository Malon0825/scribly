import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listConversations, newConversation, type Conversation } from './localAI';
import { desktop } from './storage';
import { meetingLabels, meetingTime, type Meeting, type MeetingKind } from './meetings';
import type { MeetingsController } from './useMeetings';
import { CircleNotch } from '@phosphor-icons/react';

export function useMeetingRequests(meeting: Meeting | null, c: MeetingsController, onGenerated: (meeting: Meeting, kind?: MeetingKind) => void) {
  const scope=useRef(meeting?.id);scope.current=meeting?.id;
  const [conversation,setConversation]=useState<Conversation | null>(null);
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [conversationError,setConversationError]=useState('');
  useEffect(()=>{if(!desktop || !meeting || !conversation || meeting.processing!=='failed')return;let live=true;void listConversations('meeting',meeting.id).then(records=>{if(live)setConversation(records.find(c=>c.id===conversation.id)||null);}).catch(()=>{});return()=>{live=false;};},[meeting?.processing,conversation?.id,meeting?.id]);
  useEffect(()=>{setConversation(null);setConversations([]);setConversationError('');if(!desktop || !meeting)return;let live=true;void listConversations('meeting',meeting.id).then(async records=>records.length?records:[await newConversation('meeting',meeting.id)]).then(records=>{if(live){setConversations(records);setConversation(records[0]);}}).catch(reason=>{if(live)setConversationError(String(reason));});return()=>{live=false;};},[meeting?.id]);
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
  const requestModel = provider === 'ollama' ? c.preferences.ollamaModel : model;
  const connected = provider === 'ollama' ? !!c.connections.ollama : c.connections.chatgpt;
  const processing = !!meeting && (['transcribing','analyzing'].includes(meeting.processing) || meeting.notesStatus === 'processing');
  const transcriptIncomplete = !!meeting && (meeting.transcriptionModel?.startsWith('moonshine') || meeting.liveTranscription) && !meeting.liveComplete;
  const unavailable = !desktop || !requestModel || !connected || !meeting?.segments.length || meeting.recording !== 'saved' || !!c.busy || processing || transcriptIncomplete || !!meeting.deletedAt;
  const recovery = meeting?.localRecovery;
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
        result = await invoke<Meeting>('meeting_analyze', {id:meeting.id,model:requestModel,kind,question:'',notes:'',provider});
        await c.reload();
      }
      return result;
    }, result => onGenerated(result), {id:meeting.id,kind:'recap'});
  }
  function generate(kind: MeetingKind, question = '') {
    if (!meeting || unavailable || (provider==='ollama' && kind==='question' && !conversation)) return;
    void c.run(`Creating ${meetingLabels[kind].toLowerCase()}`, () => analyze(kind, question, ''), result => onGenerated(result,kind), {id:meeting.id,kind});
  }
  async function analyze(kind: MeetingKind, question: string, notes: string) {
    if (!meeting) throw Error('No meeting is selected.');
    const result=await invoke<Meeting>('meeting_analyze', {id:meeting.id,model:requestModel,kind,question,notes,provider,conversationId:kind==='question' && provider==='ollama' ? conversation?.id : null});
    if(kind==='question' && provider==='ollama') {const records=await listConversations('meeting',meeting.id);if(scope.current===meeting.id){setConversations(records);setConversation(records.find(c=>c.id===conversation?.id)||null);}}
    return result;
  }
  function resume() {
    const recovery = meeting?.localRecovery;
    if (!meeting || !recovery || !canResume) return;
    void c.run(`Continuing ${meetingLabels[recovery.kind].toLowerCase()}`, () => analyze(recovery.kind,recovery.question,recovery.notes), result => onGenerated(result,recovery.kind), {id:meeting.id,kind:recovery.kind,resuming:true});
  }
  async function resetConversation(clear=false) {
    if(!meeting || processing || c.busy)return;setConversationError('');
    try {if(clear && conversation)await invoke('ai_conversation_clear',{id:conversation.id});const next=await newConversation('meeting',meeting.id);const records=await listConversations('meeting',meeting.id);if(scope.current===meeting.id){setConversation(next);setConversations(records);}await c.reload();}
    catch(reason){if(scope.current===meeting.id)setConversationError(String(reason));}
  }
  return {conversation,conversations,selectConversation:(id:string)=>setConversation(conversations.find(c=>c.id===id)||null),conversationError,local:provider==='ollama',resetConversation,unavailable, connected, missing, processing, catalogError, catalogLoading, canResume, questionPending:!!meeting && c.aiTask?.id === meeting.id && c.aiTask.kind === 'question', prepare, generate, resume};
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
    {requests.local&&!!requests.conversations.length&&<label className="meeting-field">Conversation<select disabled={requests.processing||requests.questionPending} value={requests.conversation?.id||''} onChange={event=>requests.selectConversation(event.target.value)}>{requests.conversations.map(c=><option key={c.id} value={c.id}>{c.messages.find(m=>m.role==='user')?.text.slice(0,55)||'New conversation'} · {new Date(c.createdAt).toLocaleDateString()}</option>)}</select></label>}
    {requests.local && <div className="meeting-conversation-controls"><button disabled={requests.processing || requests.questionPending} onClick={()=>void requests.resetConversation()}>New conversation</button><button disabled={requests.processing || requests.questionPending || !requests.conversation} onClick={()=>void requests.resetConversation(true)}>Clear history</button><span>Only this meeting is included.</span></div>}
    {requests.conversationError && <p role="alert" className="meeting-error">{requests.conversationError}</p>}
    {requests.catalogError ? <p className="meeting-error" role="status">{requests.catalogError}</p> : !requests.connected && <p className="meeting-secondary">Connect the selected AI service in Settings from meeting options.</p>}
    {requests.catalogLoading && <p role="status" className="meeting-model-loading"><CircleNotch size={16} className="meeting-stream-spinner" aria-hidden="true" />Loading AI models…</p>}
    <div className="meeting-follow-ups" aria-label="Meeting questions and answers">
      {[...meeting.analyses].reverse().filter(result => result.kind === 'question' && (!requests.local || result.conversationId === requests.conversation?.id)).map(result => <section key={result.id} id={`meeting-answer-${result.id}`} className="meeting-follow-up" aria-label={result.question}>
        <h4>{result.question}</h4>
        {result.revision !== meeting.revision && <p className="meeting-secondary">Based on an earlier transcript</p>}
        {result.items.length ? <ul>{result.items.map((item,index) => {
          const source = result.revision === meeting.revision ? meeting.segments.find(segment => item.sources.includes(segment.id)) : undefined;
          return <li key={index}>{item.text}{source && <button type="button" className="meeting-time" aria-label={`Play source at ${meetingTime(source.start)}`} onClick={() => onSeek(source.id)}>{meetingTime(source.start)}</button>}</li>;
        })}</ul> : <p>The transcript does not contain enough information to answer this question.</p>}
      </section>)}
      {requests.local && requests.conversation?.messages.filter(m=>m.role==='assistant' && m.status!=='completed').map(m=><section key={m.id} className="meeting-follow-up"><p role="status">{m.status}: {m.text || "Interrupted attempt. Ask again to retry."}</p></section>)}
    </div>
  </div>;
}

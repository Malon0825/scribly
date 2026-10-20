import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Sparkle } from '@phosphor-icons/react';
import { desktop } from './storage';
import { Dialog } from './Dialog';
import { listConversations, newConversation, type Conversation } from './localAI';

type Target = {doc:PMNode;from:number;to:number;passage:string;nearby:string;revision:number;scroll:HTMLElement | null;scrollTop:number};
export function WritingAssist({editor,noteId}:{editor:Editor;noteId:string}) {
  const [target,setTarget]=useState<Target | null>(null);
  const [conversation,setConversation]=useState<Conversation | null>(null);
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [prompt,setPrompt]=useState('Rewrite this passage clearly while preserving its meaning.');
  const [mode,setMode]=useState<'rewrite'|'continue'>('rewrite');
  const [result,setResult]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [stale,setStale]=useState(false);
  const [phase,setPhase]=useState('Generating locally…');
  const active=useRef(true);const pending=useRef('');const generation=useRef(0);const sequence=useRef(0);
  useEffect(()=>{const edited=()=>{sequence.current++;if(target)setStale(!editor.state.doc.eq(target.doc));};editor.on('update',edited);return()=>{editor.off('update',edited);};},[editor,target]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;if(pending.current)void invoke('ai_writing_cancel',{id:pending.current}).catch(()=>{});};},[]);
  useEffect(()=>{if(!busy||!conversation)return;let live=true;let off:(()=>void)|undefined;void listen<{id:string;message?:string}>('meeting-analysis-stream',event=>{if(live&&event.payload.id===conversation.id&&event.payload.message)setPhase(event.payload.message);}).then(unlisten=>{if(live)off=unlisten;else unlisten();}).catch(()=>{});return()=>{live=false;off?.();};},[busy,conversation?.id]);
  function open() {
    const {selection,doc}=editor.state;
    if (!(selection instanceof TextSelection || selection instanceof AllSelection) || selection.empty) {setError('Select a passage in your note first.');return;}
    let embedded=false;doc.nodesBetween(selection.from,selection.to,node=>{if(node.isLeaf&&!node.isText)embedded=true;});
    if(embedded){setError('Select prose without embedded images or attachments.');return;}
    const passage=doc.textBetween(selection.from,selection.to,'\n');
    if(new TextEncoder().encode(passage).length>3000){setError('Select a shorter passage for local writing help.');return;}
    const scroll=editor.view.dom.closest<HTMLElement>('.document-scroll');
    setConversation(null);setTarget({doc,from:selection.from,to:selection.to,passage,nearby:doc.textBetween(Math.max(0,selection.from-180),selection.from,'\n')+'\n'+doc.textBetween(selection.to,Math.min(doc.content.size,selection.to+180),'\n'),revision:sequence.current,scroll,scrollTop:scroll?.scrollTop||0});setResult('');setStale(false);setError('');
    const ticket=++generation.current;
    void listConversations('note',noteId).then(async records=>records.length?records:[await newConversation('note',noteId)]).then(records=>{if(active.current&&ticket===generation.current){setConversations(records);setConversation(records[0]);}}).catch(reason=>{if(active.current&&ticket===generation.current)setError(String(reason));});
  }
  function close() {generation.current++;if(pending.current)void invoke('ai_writing_cancel',{id:pending.current}).catch(()=>{});setTarget(null);setBusy(false);editor.commands.focus(undefined,{scrollIntoView:false});}
  async function request() {
    if(!target||!conversation||busy)return;setBusy(true);setPhase('Generating locally…');setResult('');setError('');pending.current=conversation.id;const ticket=++generation.current;
    try {
      const encoder=new TextEncoder();const nearbyCharacters=Array.from(target.nearby);while(encoder.encode(nearbyCharacters.join('')).length>800)nearbyCharacters.pop();const nearby=nearbyCharacters.join('');
      const value=await invoke<{text:string;revision:number}>('ai_writing_request',{conversationId:conversation.id,parentId:noteId,prompt:mode==='continue' ? `Continue the passage with a new paragraph. ${prompt}` : prompt,passage:target.passage,nearby,revision:target.revision});
      if(active.current&&ticket===generation.current){setResult(value.text);setStale(!editor.state.doc.eq(target.doc));const records=await listConversations('note',noteId);if(active.current&&ticket===generation.current){setConversations(records);setConversation(records.find(c=>c.id===conversation.id)||null);}}
    }catch(reason){if(active.current&&ticket===generation.current)setError(String(reason));}
    finally{if(active.current&&ticket===generation.current){setBusy(false);pending.current='';}}
  }
  async function resetConversation(clear=false) {
    if(!conversation||busy)return;const ticket=++generation.current;
    try {if(clear)await invoke('ai_conversation_clear',{id:conversation.id});const value=await newConversation('note',noteId);const records=await listConversations('note',noteId);if(active.current&&ticket===generation.current){setConversations(records);setConversation(value);setResult('');}}
    catch(reason){if(active.current&&ticket===generation.current)setError(String(reason));}
  }
  function accept() {
    if(!target||!result||stale||busy)return;
    if(!editor.state.doc.eq(target.doc)){setStale(true);return;}
    // Plain text is inserted as schema text nodes, never interpreted as HTML.
    const blocks=result.split(/\n\s*\n/).map(text=>editor.schema.nodes.paragraph.create(null,text ? editor.schema.text(text) : undefined));
    const transaction=closeHistory(editor.state.tr);
    if(mode==='continue')transaction.insert(target.to,blocks);else transaction.replaceWith(target.from,target.to,blocks);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(transaction.doc.content.size,transaction.mapping.map(target.to)))));
    editor.view.dispatch(transaction);editor.view.dispatch(closeHistory(editor.state.tr));
    target.scroll?.scrollTo({top:target.scrollTop,behavior:'instant'});setTarget(null);editor.commands.focus(undefined,{scrollIntoView:false});
  }
  return <div className="writing-assist-control"><button disabled={!desktop} title={desktop ? 'Select prose, then ask for a local suggestion' : 'Local writing help is available in the Windows app'} onMouseDown={event=>event.preventDefault()} onClick={open}><Sparkle size={16} aria-hidden="true"/>Writing help</button>
    {!target&&error&&<span role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></span>}
    {target&&createPortal(<Dialog title="Local writing help" className="writing-assist-dialog" onClose={close} returnFocus={()=>editor.view.dom} initialFocus={()=>document.getElementById('writing-instruction')}>
      <p className="setting-hint">Review the proposal before applying it. This conversation includes only your selection and nearby prose.</p>
      {!!conversations.length&&<label className="meeting-field">Conversation<select disabled={busy} value={conversation?.id||''} onChange={event=>{setConversation(conversations.find(c=>c.id===event.target.value)||null);setResult('');}}>{conversations.map(c=><option key={c.id} value={c.id}>{c.messages.find(m=>m.role==='user')?.text.slice(0,55)||'New conversation'} · {new Date(c.createdAt).toLocaleDateString()}</option>)}</select></label>}
      <label className="meeting-field">Task<select value={mode} disabled={busy||!!result} onChange={event=>setMode(event.target.value as 'rewrite'|'continue')}><option value="rewrite">Rewrite selection</option><option value="continue">Continue after selection</option></select></label>
      <label className="meeting-field" htmlFor="writing-instruction">Instruction<textarea id="writing-instruction" value={prompt} maxLength={1000} readOnly={busy} onChange={event=>setPrompt(event.target.value)}/></label>
      <div className="writing-assist-review"><section><h3>Original</h3><p>{target.passage}</p></section><section><h3>Suggestion</h3><p>{result|| (busy?'Generating locally…':'Your proposal will appear here.')}</p></section></div>
      {stale&&<p role="alert" className="meeting-error">Your note changed. Close this review and select the current passage to request a new suggestion.</p>}
      {error&&<p role="alert" className="meeting-error">{error}</p>}
      {busy&&<p role="status">{phase}<button onClick={()=>{setPhase('Stopping…');void invoke('ai_writing_cancel',{id:conversation?.id}).catch(reason=>setError(String(reason)));}}>Cancel generation</button></p>}
      <div className="dialog-actions"><button onClick={close}>Close</button><button disabled={busy||!conversation||!prompt.trim()||stale} onClick={()=>void request()}>{result?'Request follow-up':'Generate suggestion'}</button><button className="primary" disabled={busy||!result||stale} onClick={accept}>Accept {mode==='continue'?'continuation':'rewrite'}</button></div>
      {conversation&&<details className="settings-details"><summary>Conversation history · {conversation.messages.filter(m=>m.role==='assistant').length} attempts</summary>{conversation.messages.map(m=><p key={m.id}>{m.role==='user'?'You':'Assistant'} · {m.status}: {m.text}</p>)}
        <button disabled={busy} onClick={()=>void resetConversation()}>New conversation</button><button disabled={busy} onClick={()=>void resetConversation(true)}>Clear history</button></details>}
    </Dialog>,document.body)}
  </div>;
}

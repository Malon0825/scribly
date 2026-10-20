import { invoke } from '@tauri-apps/api/core';
import type { Workspace } from './types';
export type LocalModel = { id:string; name:string; digest:string; quantization:string; thinking:boolean };
export type SpeechStatus = { runtime:boolean; medium:boolean; small:boolean; version:string; language:string };
export type LocalStatus = { models:LocalModel[]; running:unknown[]; speech:SpeechStatus;availableBytes:number;calibration:{digest:string;additionalBytes:number;reserveBytes:number;measuredAt:number}|null };
export type ConversationMessage = { id:string; role:'user'|'assistant'; text:string; status:'pending'|'completed'|'failed'|'cancelled'; createdAt:number; revision:number; model:string; digest:string; sources:number[];sourceHash?:string|null;evidence?:string|null };
export type Conversation = { version:1; id:string; scope:'meeting'|'note'; parentId:string; createdAt:number; messages:ConversationMessage[]; memory?:{text:string;coveredIds:string[];revision:number} | null };
export const listConversations = (scope:'meeting'|'note',parentId:string) => invoke<Conversation[]>('ai_conversation_list',{scope,parentId});
export const newConversation = (scope:'meeting'|'note',parentId:string) => invoke<Conversation>('ai_conversation_new',{scope,parentId});
export function validateConversations(value:unknown,parents:ReadonlySet<string>):Conversation[] {
  if(!Array.isArray(value)||value.length>5000||JSON.stringify(value).length>16_000_000)throw Error('Invalid conversation backup size.');
  const ids=new Set<string>();
  const uuid=(id:unknown)=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  for(const c of value) {
    if(!object(c)||c.version!==1||!uuid(c.id)||ids.has(String(c.id))||c.scope!=='note'||typeof c.parentId!=='string'||!parents.has(c.parentId)||!Number.isSafeInteger(c.createdAt)||!Array.isArray(c.messages)||c.messages.length>200)throw Error('Invalid conversation backup or parent.');
    ids.add(String(c.id));const messageIds=new Set<string>();
    for(const m of c.messages) {if(!object(m)||!uuid(m.id)||messageIds.has(String(m.id))||!['user','assistant'].includes(String(m.role))||!['pending','completed','failed','cancelled'].includes(String(m.status))||typeof m.text!=='string'||new TextEncoder().encode(m.text).length>32768||!Number.isSafeInteger(m.createdAt)||!Number.isSafeInteger(m.revision)||typeof m.model!=='string'||m.model.length>100||typeof m.digest!=='string'||m.digest.length>100||!Array.isArray(m.sources)||m.sources.length>100||!m.sources.every(s=>Number.isSafeInteger(s)&&s>=0)||(m.sourceHash!=null&&(typeof m.sourceHash!=='string'||!/^[a-f0-9]{64}$/i.test(m.sourceHash)))||(m.evidence!=null&&(typeof m.evidence!=='string'||new TextEncoder().encode(m.evidence).length>4000)))throw Error('Invalid conversation messages.');messageIds.add(String(m.id));}
    if(c.messages.reduce((size,m)=>size+new TextEncoder().encode(m.text).length,0)>512000)throw Error('Oversized conversation history.');
    const messages=c.messages;
    if(c.memory!=null&&(!object(c.memory)||typeof c.memory.text!=='string'||new TextEncoder().encode(c.memory.text).length>1800||!Number.isSafeInteger(c.memory.revision)||!Array.isArray(c.memory.coveredIds)||c.memory.coveredIds.length>200||!c.memory.coveredIds.every(id=>messages.some(m=>m.id===id&&m.status==='completed'))))throw Error('Invalid conversation memory.');
  }
  // Keep only ledger fields: transient reasoning and unknown extension data
  // never become notebook backup content.
  return (value as Conversation[]).map(c=>({version:1,id:c.id,scope:c.scope,parentId:c.parentId,createdAt:c.createdAt,memory:c.memory?{text:c.memory.text,coveredIds:c.memory.coveredIds,revision:c.memory.revision}:null,messages:c.messages.map(m=>({id:m.id,role:m.role,text:m.text,status:m.status,createdAt:m.createdAt,revision:m.revision,model:m.model,digest:m.digest,sources:m.sources,sourceHash:m.sourceHash,evidence:m.evidence}))}));
}
export function remapConversations(conversations:Conversation[],parents:ReadonlyMap<string,string>):Conversation[] {
  return conversations.map(c=>({...c,id:crypto.randomUUID(),memory:null,parentId:parents.get(c.parentId)||c.parentId,messages:c.messages.map(m=>({...m,id:crypto.randomUUID(),status:m.status==='pending'?'failed':m.status}))}));
}
// Desktop history is imported into its own ledger in the save transaction.
// Remove only the acknowledged objects; a concurrent restore may have added
// another envelope while that save was in flight.
export function consumeConversationImports(current:Workspace,saved:Workspace):Workspace {
  if(!current.aiConversations?.length)return current;
  const consumed=new Set(saved.aiConversations || []);
  const remaining=current.aiConversations.filter(c=>!consumed.has(c));
  if(remaining.length===current.aiConversations.length)return current;
  if(remaining.length)return {...current,aiConversations:remaining};
  const {aiVersion,aiConversations,...document}=current;
  return document;
}
export function pruneConversationImports(document:Workspace):Workspace {
  if(!document.aiConversations?.length)return document;
  const parents=new Set(document.notes.map(note=>note.id));
  const remaining=document.aiConversations.filter(c=>parents.has(c.parentId));
  return remaining.length===document.aiConversations.length ? document : {...document,aiConversations:remaining};
}

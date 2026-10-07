import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';

export type MeetingWord = { text:string; start:number; end:number; confidence:number };
export type MeetingSegment = { id: number; start: number; end: number; speaker: string; text: string; words?:MeetingWord[] };
export type TranscriptionModel = 'deepgram' | 'gemini-3.5-transcribe-live' | 'gemini-3.5-transcribe';
export type RequestProvider = 'chatgpt' | 'gemini' | 'openrouter';
export const openRouterModel = 'nvidia/nemotron-3.5-lightning:free';
export const requestProviderLabels: Record<RequestProvider, string> = { chatgpt: 'ChatGPT subscription', gemini: 'Gemini 3.8 Flash', openrouter: 'OpenRouter · NVIDIA Nemotron 3.5 Lightning (free)' };
export const requestProviderNames: Record<RequestProvider, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', openrouter: 'OpenRouter' };
export const geminiBillingNotice = 'Use a Gemini API key with available quota. Paid requests require active Gemini billing and sufficient credit balance (for prepaid accounts). New GCP $300 welcome credits do not cover Gemini API usage. Connecting a key does not verify its balance.';
export const openRouterNotice = 'Free endpoint · Requests are limited. Token-limit recovery can use additional free requests. NVIDIA logs requests and may use them to improve its services. Do not send confidential meetings or personal data. No paid model fallback.';
export type MeetingStream = { id:string; kind:MeetingKind; texts:string[]; part:number; parts:number; done:boolean; message?:string };
export type MeetingPreferences = { transcriptionModel: TranscriptionModel; requestProvider: RequestProvider; chatgptModel: string | null };
export const defaultMeetingPreferences: MeetingPreferences = { transcriptionModel: 'deepgram', requestProvider: 'chatgpt', chatgptModel: null };
export const transcriptionLabels: Record<TranscriptionModel, string> = { deepgram: 'Deepgram Nova-3', 'gemini-3.5-transcribe-live': 'Gemini 3.5 Transcribe Live', 'gemini-3.5-transcribe': 'Gemini 3.5 Transcribe' };
export type MeetingKind = 'summary' | 'minutes' | 'actions' | 'study' | 'flashcards' | 'quiz' | 'question';
export type SpeakerIdentity = { speakerId: string; name: string; team: string | null; aliases: string[]; confidence: 'strong' | 'tentative'; sources: number[]; reason: string };
export const speakerIdentityLabel = (identity: SpeakerIdentity) => identity.team ? `${identity.name} (${identity.team})` : identity.name;
export type MeetingAnalysis = { id: string; kind: MeetingKind; model: string; question: string; revision: number; createdAt: number;
  items: { text: string; sources: number[]; owner?: string | null; deadline?: string | null }[] };
export type Meeting = { id: string; noteId: string | null; title: string; createdAt: number; duration: number; media: string | null; video: string | null;
  recording: 'saved' | 'recording' | 'paused' | 'interrupted'; processing: 'idle' | 'transcribing' | 'analyzing' | 'ready' | 'failed';
  error: string | null; revision: number; segments: MeetingSegment[]; speakers: Record<string, string>; analyses: MeetingAnalysis[];
  speakerIdentities?: SpeakerIdentity[]; speakerIdentityRevision?: number | null;
  speakerWarning?: string | null; deletedAt?:number | null; completedActions?:string[];
  recovery?: { kind:MeetingKind; model:string; revision:number; title:string; question:string; notes:string; checkpoints:unknown[]; splits:string[] } | null;
  transcriptionModel?: TranscriptionModel | null; transcriptionLanguage?: string | null;
  liveTranscription?: boolean; liveComplete?: boolean; autoNotes?: boolean; notesStatus?: '' | 'processing' | 'ready' | 'failed'; stopReason?: 'manual' | 'silence' | 'shutdown' | null };
export type IntegratedMeeting = Meeting;
export type MeetingConnections = { deepgram: boolean; chatgpt: boolean; gemini?: boolean; openrouter?: boolean; preferences?: MeetingPreferences; email: string | null };
export type MeetingDevice = { id: string; name: string; kind: 'microphone' | 'system' | 'video' };
export type RecordingFeedback = { id: string; duration: number; microphone: number; system: number; paused: boolean; silentFor?: number };
export const meetingLabels: Record<MeetingKind, string> = { summary: 'Summary', minutes: 'Key points', actions: 'Action items', study: 'Study notes', flashcards: 'Flashcards', quiz: 'Quiz', question: 'Answer' };
const key = 'scribly-meetings-preview';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
function previewSpeakerIdentity(value: unknown): value is SpeakerIdentity {
  return object(value) && typeof value.speakerId === 'string' && value.speakerId.length > 0 && value.speakerId.length <= 40
    && typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 200
    && (value.team === null || (typeof value.team === 'string' && !!value.team.trim() && value.team.length <= 100))
    && Array.isArray(value.aliases) && value.aliases.length <= 10 && value.aliases.every((name:unknown) => typeof name === 'string' && !!name.trim() && name.length <= 200)
    && ['strong','tentative'].includes(String(value.confidence)) && typeof value.reason === 'string' && !!value.reason.trim() && value.reason.length <= 1000
    && Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 20 && new Set(value.sources).size === value.sources.length && value.sources.every((id:unknown) => number(id) && Number.isInteger(id));
}
function previewMeeting(value: unknown): value is Meeting {
  if (!object(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || !nullableText(value.noteId)
    || !number(value.createdAt) || !number(value.duration) || !number(value.revision) || !nullableText(value.media) || !nullableText(value.video) || !nullableText(value.error)
    || !['saved', 'recording', 'paused', 'interrupted'].includes(String(value.recording)) || !['idle', 'transcribing', 'analyzing', 'ready', 'failed'].includes(String(value.processing))
    || !object(value.speakers) || !Object.values(value.speakers).every(name => typeof name === 'string')
    || (value.autoNotes !== undefined && typeof value.autoNotes !== 'boolean')
    || (value.liveTranscription !== undefined && typeof value.liveTranscription !== 'boolean')
    || (value.liveComplete !== undefined && typeof value.liveComplete !== 'boolean')
    || (value.transcriptionModel !== undefined && value.transcriptionModel !== null && !Object.hasOwn(transcriptionLabels, String(value.transcriptionModel)))
    || (value.transcriptionLanguage !== undefined && !nullableText(value.transcriptionLanguage))
    || (value.notesStatus !== undefined && !['','processing','ready','failed'].includes(String(value.notesStatus)))
    || !Array.isArray(value.segments) || !Array.isArray(value.analyses)) return false;
  const identities = value.speakerIdentities;
  const segments = value.segments;
  const identityRevision = value.speakerIdentityRevision;
  const recovery = value.recovery;
  return (value.speakerWarning === undefined || nullableText(value.speakerWarning))
    && (value.deletedAt === undefined || value.deletedAt === null || number(value.deletedAt))
    && (value.completedActions === undefined || (Array.isArray(value.completedActions) && value.completedActions.length <= 300_000 && value.completedActions.every(id => typeof id === 'string' && id.length <= 120)))
    && (recovery === undefined || recovery === null || (object(recovery) && typeof recovery.kind === 'string' && Object.hasOwn(meetingLabels,recovery.kind)
      && recovery.model === openRouterModel && recovery.revision === value.revision && recovery.title === value.title
      && typeof recovery.question === 'string' && recovery.question.length <= 4000 && typeof recovery.notes === 'string' && recovery.notes.length <= 20_000
      && Array.isArray(recovery.checkpoints) && recovery.checkpoints.length <= 512 && Array.isArray(recovery.splits) && recovery.splits.length <= 512
      && recovery.splits.every((key:unknown) => typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key))))
    && (identityRevision === undefined || identityRevision === null || (number(identityRevision) && identityRevision <= value.revision))
    && (identities === undefined || (Array.isArray(identities) && identities.length <= 100 && identities.every(previewSpeakerIdentity)
      && new Set(identities.map(identity => identity.speakerId)).size === identities.length
      && (!identities.length || number(identityRevision))
      && (identityRevision !== value.revision || identities.every(identity => identity.sources.every(id => segments.some(segment => object(segment) && segment.id === id)) && segments.some(segment => object(segment) && segment.speaker === identity.speakerId && number(segment.id) && identity.sources.includes(segment.id))))))
    && segments.every((segment: unknown, index: number) => object(segment) && segment.id === index && number(segment.start) && number(segment.end) && segment.end >= segment.start && typeof segment.text === 'string' && typeof segment.speaker === 'string'
      && (segment.words === undefined || (Array.isArray(segment.words) && segment.words.length <= 10_000 && segment.words.every(word => object(word) && typeof word.text === 'string' && word.text.length <= 1000 && number(word.start) && number(word.end) && word.end >= word.start && number(word.confidence) && word.confidence <= 1))))
    && value.analyses.every((analysis: unknown) => object(analysis) && typeof analysis.id === 'string' && typeof analysis.kind === 'string' && Object.hasOwn(meetingLabels, analysis.kind) && typeof analysis.model === 'string' && typeof analysis.question === 'string' && number(analysis.createdAt) && number(analysis.revision) && Array.isArray(analysis.items)
      && analysis.items.every((item: unknown) => object(item) && typeof item.text === 'string' && Array.isArray(item.sources) && item.sources.every((source: unknown) => number(source) && Number.isInteger(source)) && (item.owner === undefined || nullableText(item.owner)) && (item.deadline === undefined || nullableText(item.deadline))));
}
export async function listMeetings(): Promise<Meeting[]> {
  if (desktop) return invoke('meeting_list');
  const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
  if (!Array.isArray(value) || !value.every(previewMeeting)) throw new Error('Preview meeting storage is damaged. Your notebook remains available; the stored meeting data was retained.');
  return value;
}
export async function savePreviewMeeting(meeting: Meeting) {
  const meetings = await listMeetings();
  localStorage.setItem(key, JSON.stringify([meeting, ...meetings.filter(item => item.id !== meeting.id)]));
}
export async function deleteMeeting(id: string) {
  if (desktop) return invoke<void>('meeting_delete', { id });
  localStorage.setItem(key, JSON.stringify((await listMeetings()).filter(item => item.id !== id)));
}
export async function setMeetingTrashed(id:string, trashed:boolean):Promise<Meeting> {
  if (desktop) return invoke('meeting_trash', {id,trashed});
  const old = (await listMeetings()).find(item => item.id === id);
  if (!old) throw Error('Meeting no longer exists.');
  const next = {...old,deletedAt:trashed ? Date.now() : null};
  await savePreviewMeeting(next); return next;
}
export async function setMeetingAction(id:string, analysisId:string, index:number, completed:boolean):Promise<Meeting> {
  if (desktop) return invoke('meeting_action', {id,analysisId,index,completed});
  const old = (await listMeetings()).find(item => item.id === id);
  if (!old || old.deletedAt || !old.analyses.some(analysis => analysis.id === analysisId && analysis.kind === 'actions' && analysis.items[index])) throw Error('This action item is unavailable.');
  const key = `${analysisId}:${index}`;
  const next = {...old,completedActions:[...(old.completedActions || []).filter(item => item !== key),...(completed ? [key] : [])]};
  await savePreviewMeeting(next); return next;
}
export async function updateMeeting(meeting: Meeting): Promise<Meeting> {
  if (desktop) return invoke('meeting_update', { id: meeting.id, title: meeting.title, speakers: meeting.speakers, segments: meeting.segments });
  const old = (await listMeetings()).find(item => item.id === meeting.id);
  const changed = JSON.stringify(old?.segments) !== JSON.stringify(meeting.segments) || JSON.stringify(old?.speakers) !== JSON.stringify(meeting.speakers);
  const edited = { ...meeting, recovery:changed || old?.title !== meeting.title ? null : meeting.recovery, speakerWarning:changed ? null : meeting.speakerWarning, speakerIdentities: meeting.speakerIdentities?.filter(identity => old?.speakers[identity.speakerId] === meeting.speakers[identity.speakerId]), revision: (old?.revision || 0) + Number(changed) };
  await savePreviewMeeting(edited); return edited;
}
export async function meetingMedia(id: string, video = false) { return convertFileSrc(await invoke<string>('meeting_media', { id, video })); }
export function meetingTime(seconds: number) {
  const time = Math.max(0, Math.floor(seconds));
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
}
const html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function speakerLabel(meeting: Pick<Meeting, 'speakers'>, id: string) {
  return meeting.speakers[id] || defaultSpeakerLabel(id);
}
export function defaultSpeakerLabel(id: string) {
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? `Speaker ${Number(id) + 1}` : 'Speaker unknown';
}
export function analysisHtml(meeting: Meeting, analysis: MeetingAnalysis, sectionOnly = false) {
  return `<h2>${sectionOnly ? meetingLabels[analysis.kind] : `${html(meeting.title)} · ${meetingLabels[analysis.kind]}`}</h2>${analysis.question ? `<p>${html(analysis.question)}</p>` : ''}<ul>${analysis.items.map(item => `<li><p>${html(item.text).replace(/\n/g, '<br>')}${item.owner ? ` · Owner: ${html(item.owner)}` : ''}${item.deadline ? ` · Due: ${html(item.deadline)}` : ''}</p><p>Source: ${item.sources.map(id => meeting.segments.find(segment => segment.id === id)).filter((segment): segment is MeetingSegment => !!segment).map(segment => html(`${speakerLabel(meeting, segment.speaker)} ${meetingTime(segment.start)}`)).join(', ')}</p></li>`).join('')}</ul>`;
}
export function meetingMarkdown(meeting: Meeting) {
  const transcript = meeting.segments.map(segment => `[${meetingTime(segment.start)}] ${speakerLabel(meeting, segment.speaker)}: ${segment.text}`).join('\n\n');
  const latest = (['summary','actions','minutes'] as const).map(kind => [...meeting.analyses].reverse().find(result => result.kind === kind)).filter((result):result is MeetingAnalysis => !!result);
  return `# ${meeting.title}\n\n${new Date(meeting.createdAt).toLocaleDateString()} · ${meetingTime(meeting.duration)} · ${new Set(meeting.segments.map(segment => segment.speaker)).size} people\n\nMade with AI · check times against the transcript.\n\n${latest.map(analysis => `## ${meetingLabels[analysis.kind]}${analysis.revision !== meeting.revision ? ' (earlier transcript)' : ''}\n\n${analysis.items.map((item,index) => {
    const source = analysis.revision === meeting.revision ? meeting.segments.find(segment => segment.id === item.sources[0]) : null;
    return `- ${analysis.kind === 'actions' ? `[${meeting.completedActions?.includes(`${analysis.id}:${index}`) ? 'x' : ' '}] ` : ''}${item.text}${analysis.kind === 'actions' ? ` — ${item.owner || 'Unassigned'} · ${item.deadline || 'No date agreed'}` : ''}${source ? ` (${meetingTime(source.start)})` : ''}`;
  }).join('\n')}`).join('\n\n')}\n\n## Transcript\n\n${transcript}`;
}
export function sampleMeeting(noteId: string | null, integrated = false): Meeting {
  const segments: MeetingSegment[] = [
    { id: 0, start: 0, end: 8, speaker: '0', text: 'For the launch, let’s keep the onboarding to three steps and ship the first version on Friday.' },
    { id: 1, start: 8, end: 18, speaker: '1', text: 'I’ll update the onboarding copy by Thursday. We still need to check keyboard navigation before we release.' },
    { id: 2, start: 18, end: 28, speaker: '0', text: 'Agreed. I’ll run the keyboard checks on Thursday afternoon. We’ll review the results together before shipping.' },
  ];
  return { id: crypto.randomUUID(), noteId, title: 'Sample · Launch planning', createdAt: Date.now(), duration: 28, media: null, video: null,
    recording: 'saved', processing: 'ready', error: null, revision: 1, segments, speakers: { '0': 'Alex', '1': 'Sam' }, autoNotes:integrated, notesStatus:integrated ? 'ready' : '',
    analyses: [
      { id: crypto.randomUUID(), kind: 'summary', model: 'Preview sample', question: '', revision: 1, createdAt: Date.now(), items: [{ text: 'Keep onboarding to three steps. Target Friday for the first release, following a joint review of keyboard navigation checks.', sources: [0, 1, 2] }] },
      ...(integrated ? [{ id:crypto.randomUUID(), kind:'minutes' as const, model:'Preview sample', question:'', revision:1, createdAt:Date.now(), items:[{ text:'0:00 — Alex proposed a three-step onboarding and Friday launch. Sam committed to the copy update, then Alex agreed to keyboard checks before a joint release review.', sources:[0,1,2] }] }] : []),
      { id: crypto.randomUUID(), kind: 'actions', model: 'Preview sample', question: '', revision: 1, createdAt: Date.now(), items: [{ text: 'Update the onboarding copy.', owner: 'Sam', deadline: 'Thursday (date unspecified)', sources: [1] }, { text: 'Run keyboard navigation checks and review the results before shipping.', owner: 'Alex', deadline: 'Thursday afternoon (date unspecified)', sources: [2] }] },
    ] };
}

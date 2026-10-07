import { analysisHtml, meetingLabels, meetingTime, speakerLabel, type IntegratedMeeting, type Meeting, type MeetingAnalysis } from './meetings';
import { itemHref } from './itemLinks';
import { isLiveItem, isBoard, type MeetingNote, type Note, type Workspace } from './types';

export function validateMeetingNote(value: unknown): asserts value is MeetingNote {
  if (!value || typeof value !== 'object') throw Error('Invalid meeting note metadata.');
  const data = value as Record<string, unknown>;
  if (!['transcript', 'summary'].includes(String(data.role))
    || (data.sessionId !== undefined && (typeof data.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.sessionId)))
    || (data.sourceNoteId !== undefined && (typeof data.sourceNoteId !== 'string' || !data.sourceNoteId || data.sourceNoteId.length > 200))
    || (data.segmentCount !== undefined && (!Number.isSafeInteger(data.segmentCount) || Number(data.segmentCount) < 0 || Number(data.segmentCount) > 100_000))
    || (data.transcriptClosed !== undefined && typeof data.transcriptClosed !== 'boolean')
    || ['analysisIds','editedAnalysisIds'].some(key => data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 1000 || !data[key].every(id => typeof id === 'string' && id.length <= 100)))) throw Error('Invalid meeting note metadata.');
}
export function meetingNoteTitle(folder: string, date = new Date(), summary = false) {
  return `${folder} · ${new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', year:'numeric' }).format(date)} · Meeting${summary ? ' Summary' : ''}`;
}
const escape = (text: string) => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function transcriptHtml(meeting: Meeting, from: number) {
  return meeting.segments.slice(from).map(segment => {
    const html = `<strong>${escape(speakerLabel(meeting, segment.speaker))}:</strong> ${escape(segment.text).replace(/\n/g,'<br>')}`;
    return `<p data-meeting-source="${escape(JSON.stringify({ session:meeting.id, segment:segment.id, html }))}">${html}</p>`;
  }).join('');
}
export type NoteBlockEdit = { index:number; remove:number; html:string };
export type MeetingNoteWrite = string | ((content:string) => NoteBlockEdit[]);
export type TranscriptSource = { session:string; segment:number; html:string };
export function transcriptSource(value: string | null): TranscriptSource | null {
  if (!value) return null;
  try {
    const source:unknown = JSON.parse(value);
    if (!source || typeof source !== 'object') return null;
    const data = source as Record<string,unknown>;
    return typeof data.session === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session)
      && typeof data.segment === 'number' && Number.isSafeInteger(data.segment) && data.segment >= 0 && typeof data.html === 'string'
      ? {session:data.session,segment:data.segment,html:data.html} : null;
  } catch { return null; }
}
// Only generated paragraphs belong to the transcript. Personal writing is never replaced.
export function transcriptEdits(content:string, meeting:Meeting, count:number, previous?:Meeting): NoteBlockEdit[] {
  const document = new DOMParser().parseFromString(content, 'text/html');
  const wanted = new DOMParser().parseFromString(transcriptHtml(meeting,0), 'text/html');
  const paragraphs = Array.from(wanted.body.children);
  const seen = new Set<number>();
  const edits:NoteBlockEdit[] = [];
  const legacy = new DOMParser().parseFromString(transcriptHtml(previous || meeting,0), 'text/html');
  const old = Array.from(legacy.body.children);
  const legacyIds = new Map<string,number[]>();
  old.slice(0,count).forEach((candidate,id) => { const ids = legacyIds.get(candidate.innerHTML) || []; ids.push(id); legacyIds.set(candidate.innerHTML,ids); });
  Array.from(document.body.children).forEach((node,index) => {
    let source = transcriptSource(node.getAttribute('data-meeting-source'));
    if (!source && node.tagName === 'P') {
      const ids = legacyIds.get(node.innerHTML);
      while (ids?.length && seen.has(ids[0])) ids.shift();
      const id = ids?.shift();
      if (id !== undefined) source = transcriptSource(old[id].getAttribute('data-meeting-source'));
    }
    if (!source || source.session !== meeting.id) return;
    seen.add(source.segment);
    const next = paragraphs[source.segment];
    const tagged = node.hasAttribute('data-meeting-source');
    if (next && source.html === next.innerHTML) {
      if (!tagged) { const adopted = node.cloneNode(true) as Element; adopted.setAttribute('data-meeting-source',next.getAttribute('data-meeting-source')!); edits.push({index,remove:1,html:adopted.outerHTML}); }
      return;
    }
    if (node.innerHTML === source.html) {
      const updated = node.cloneNode(true) as Element;
      if (next) { updated.innerHTML = next.innerHTML; updated.setAttribute('data-meeting-source',next.getAttribute('data-meeting-source')!); }
      edits.push({index,remove:1,html:next ? updated.outerHTML : ''});
    } else {
      // Keep a manually edited paragraph as personal writing, then insert the correction.
      const personal = node.cloneNode(true) as Element; personal.removeAttribute('data-meeting-source');
      edits.push({index,remove:1,html:personal.outerHTML + (next?.outerHTML || '')});
    }
  });
  const fresh = paragraphs.filter((_,id) => id >= count && !seen.has(id)).map(node => node.outerHTML).join('');
  if (fresh) edits.push({index:document.body.children.length,remove:0,html:fresh});
  return edits;
}
export function applyNoteBlockEdits(content:string, edits:NoteBlockEdit[]) {
  const document = new DOMParser().parseFromString(content,'text/html');
  const blocks = Array.from(document.body.children);
  for (const edit of [...edits].reverse()) {
    const template = document.createElement('template'); template.innerHTML = edit.html;
    const anchor = blocks[edit.index];
    if (anchor) { anchor.before(template.content); for (let i = 0; i < edit.remove; i++) blocks[edit.index + i]?.remove(); }
    else document.body.append(template.content);
  }
  return document.body.innerHTML;
}
// Move only exact, unchanged output from the former Insert into transcript action.
// The destination must have saved the analysis before its source blocks are removed.
export function insertedAnalysisEdits(content:string, meeting:Meeting, savedIds:string[]): NoteBlockEdit[] {
  const blocks = Array.from(new DOMParser().parseFromString(content,'text/html').body.children);
  const claimed = new Set<number>();
  const edits:NoteBlockEdit[] = [];
  const legacy = { ...meeting, speakers:{ ...meeting.speakers } };
  for (const segment of meeting.segments) if (!legacy.speakers[segment.speaker]) legacy.speakers[segment.speaker] = `Speaker ${segment.speaker}`;
  for (const analysis of meeting.analyses.filter(item => savedIds.includes(item.id))) {
    for (const version of [meeting,legacy]) {
      const generated = Array.from(new DOMParser().parseFromString(analysisHtml(version,analysis),'text/html').body.children);
      for (let index = 0; index <= blocks.length - generated.length; index++) {
        if (!generated.every((node,offset) => !claimed.has(index + offset) && node.outerHTML === blocks[index + offset].outerHTML)) continue;
        generated.forEach((_,offset) => claimed.add(index + offset));
        edits.push({index,remove:generated.length,html:''});
      }
    }
  }
  return edits.sort((a,b) => a.index - b.index);
}
export function summaryNote(workspace: Workspace, source: Note, meeting: IntegratedMeeting): Note | null {
  if (meeting.recording !== 'saved' || source.meeting?.role !== 'transcript' || !isLiveItem(source)) return null;
  if (workspace.notes.some(note => note.meeting?.role === 'summary' && note.meeting.sessionId === meeting.id && note.meeting.sourceNoteId === source.id)) return null;
  const now = new Date().toISOString();
  const title = source.title.endsWith(' · Meeting') ? `${source.title} Summary` : `${source.title} · Meeting Summary`;
  return { id:crypto.randomUUID(), folderId:source.folderId, title, content:`<p><a data-item-id="${escape(source.id)}" href="${escape(itemHref(source.id))}">Meeting transcript</a> · ${meetingTime(meeting.duration)}</p>`,
    createdAt:now, updatedAt:now, archived:false, meeting:{ role:'summary', sessionId:meeting.id, sourceNoteId:source.id, analysisIds:[] } };
}
export function appendSummaryResults(note: Note, meeting: IntegratedMeeting): Note {
  if (note.meeting?.role !== 'summary' || note.meeting.sessionId !== meeting.id || !note.meeting.sourceNoteId || !isLiveItem(note) || isBoard(note)) return note;
  const written = new Set(note.meeting.analysisIds || []);
  const fresh = meeting.analyses.filter(analysis => !written.has(analysis.id));
  const content = removeModelStamps(note.content,meeting);
  if (!fresh.length && content === note.content) return note;
  return { ...note, content:content + fresh.map(analysis => analysisHtml(meeting,analysis,true) + `<p>Updated ${escape(new Date(analysis.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</p>`).join(''), updatedAt:new Date().toISOString(), meeting:{ ...note.meeting, analysisIds:[...written,...fresh.map(analysis => analysis.id)] } };
}

// Only exact generated metadata is migrated; edited paragraphs remain personal writing.
export function removeModelStamps(content:string, meeting:Meeting) {
  const doc = new DOMParser().parseFromString(content,'text/html');
  let changed = false;
  for (const analysis of meeting.analyses) {
    const base = `${analysis.model} · ${new Date(analysis.createdAt).toLocaleString()}`;
    const variants = new Set([base,base + ' · Earlier transcript version',base + ' · No relevant evidence found',base + ' · Earlier transcript version · No relevant evidence found']);
    for (const node of Array.from(doc.body.children)) {
      if (node.tagName === 'P' && node.children.length === 1 && node.firstElementChild?.tagName === 'EM' && variants.has(node.textContent || '')) { node.remove(); changed = true; }
    }
  }
  return changed ? doc.body.innerHTML : content;
}

function personalDocument(content:string, meeting:Meeting) {
  const doc = new DOMParser().parseFromString(removeModelStamps(content,meeting),'text/html');
  Array.from(doc.body.children).forEach((node,index) => node.setAttribute('data-meeting-personal-index',String(index)));
  if (doc.body.firstElementChild?.querySelector('a[data-item-id]')?.textContent === 'Meeting transcript') doc.body.firstElementChild.remove();
  for (const node of Array.from(doc.body.children)) {
    if (node.hasAttribute('data-meeting-analysis') || (node.tagName === 'P' && node.textContent?.trim() === 'AI notes should be reviewed against the transcript.')) node.remove();
    const source = transcriptSource(node.getAttribute('data-meeting-source'));
    if (source?.session === meeting.id && source.html === node.innerHTML) node.remove();
  }
  for (const analysis of meeting.analyses) {
    for (const variant of [analysisHtml(meeting,analysis,true),analysisHtml(meeting,analysis,true).replace('<h2>Key points</h2>','<h2>Meeting minutes</h2>')]) {
      const generated = Array.from(new DOMParser().parseFromString(variant,'text/html').body.children);
      const blocks = Array.from(doc.body.children);
      for (let index = 0; index <= blocks.length - generated.length; index++) {
        if (!generated.every((node,offset) => {
          const candidate = blocks[index + offset].cloneNode(true) as Element; candidate.removeAttribute('data-meeting-personal-index');
          return node.outerHTML === candidate.outerHTML;
        })) continue;
        generated.forEach((_,offset) => blocks[index + offset].remove());
        const stamp = blocks[index + generated.length];
        if (stamp?.textContent === `Updated ${new Date(analysis.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`) stamp.remove();
      }
    }
  }
  // Older output may cite a speaker's former name. Hide only an exact generated
  // heading/list whose item bodies are unchanged; edited blocks stay personal.
  for (const analysis of meeting.analyses) {
    const blocks = Array.from(doc.body.children);
    for (let index = 0; index < blocks.length - 1; index++) {
      const heading = blocks[index], question = analysis.question ? blocks[index + 1] : null;
      const listIndex = index + (question ? 2 : 1), list = blocks[listIndex];
      if (heading.tagName !== 'H2' || ![meetingLabels[analysis.kind],analysis.kind === 'minutes' ? 'Meeting minutes' : meetingLabels[analysis.kind]].includes(heading.textContent || '') || list?.tagName !== 'UL'
        || (question && (question.tagName !== 'P' || question.textContent !== analysis.question))) continue;
      const items = Array.from(list.children);
      if (items.length !== analysis.items.length || !items.every((node,i) => {
        const item = analysis.items[i];
        const wanted = `${item.text}${item.owner ? ` · Owner: ${item.owner}` : ''}${item.deadline ? ` · Due: ${item.deadline}` : ''}`.replace(/\n/g,'');
        return node.tagName === 'LI' && node.children.length === 2 && node.children[0].textContent === wanted && (node.children[1].textContent || '').startsWith('Source: ');
      })) continue;
      heading.remove(); question?.remove(); list.remove();
      const stamp = blocks[listIndex + 1];
      if (stamp?.textContent === `Updated ${new Date(analysis.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`) stamp.remove();
    }
  }
  return doc;
}
export function meetingPersonalContent(content:string, meeting:Meeting) {
  const doc = personalDocument(content,meeting);
  for (const node of Array.from(doc.body.children)) node.removeAttribute('data-meeting-personal-index');
  return doc.body.innerHTML;
}
export function replaceMeetingPersonalContent(content:string, meeting:Meeting, personal:string) {
  const retained = new DOMParser().parseFromString(removeModelStamps(content,meeting),'text/html');
  const indices = new Set(Array.from(personalDocument(content,meeting).body.children).map(node => Number(node.getAttribute('data-meeting-personal-index'))));
  Array.from(retained.body.children).forEach((node,index) => { if (indices.has(index)) node.remove(); });
  return retained.body.innerHTML + personal;
}

// The note owns editable versions; original structured analyses remain available.
export function meetingSummaryContent(content:string, meeting:Meeting, results:MeetingAnalysis[], editedIds:string[]) {
  const stored = new DOMParser().parseFromString(removeModelStamps(content,meeting),'text/html');
  for (const button of Array.from(stored.querySelectorAll('button[data-meeting-citation]'))) {
    try {
      const source:unknown = JSON.parse(button.getAttribute('data-meeting-citation') || 'null');
      if (!source || typeof source !== 'object' || !('session' in source) || source.session !== meeting.id || !('revision' in source) || source.revision !== meeting.revision) button.replaceWith(stored.createTextNode(`${button.textContent || ''} · earlier transcript`));
    } catch { button.replaceWith(stored.createTextNode(button.textContent || '')); }
  }
  if (results.every(result => editedIds.includes(result.id))) {
    const personalIndices = new Set(Array.from(personalDocument(content,meeting).body.children).map(node => Number(node.getAttribute('data-meeting-personal-index'))));
    const ids = new Set(results.map(result => result.id));
    return Array.from(stored.body.children).filter((node,index) => ids.has(node.getAttribute('data-meeting-analysis') || '') || personalIndices.has(index)).map(node => node.outerHTML).join('');
  }
  return results.map(result => {
    if (editedIds.includes(result.id)) return Array.from(stored.body.children).filter(node => node.getAttribute('data-meeting-analysis') === result.id).map(node => node.outerHTML).join('');
    const tag = `data-meeting-analysis="${escape(result.id)}"`;
    const actions = result.kind === 'actions';
    const list = result.items.map((item,index) => {
      const source = result.revision === meeting.revision ? meeting.segments.find(segment => segment.id === item.sources[0]) : null;
      const citation = source ? ` <button data-meeting-citation="${escape(JSON.stringify({session:meeting.id,segment:source.id,revision:meeting.revision,label:meetingTime(source.start)}))}">${meetingTime(source.start)}</button>` : '';
      const key = `${result.id}:${index}`;
      return `<li${actions ? ` data-type="taskItem" data-checked="${meeting.completedActions?.includes(key) || false}" data-meeting-action="${escape(key)}"` : ''}><p>${escape(item.text).replace(/\n/g,'<br>')}${citation}</p>${actions ? `<p>${escape(item.owner || 'Unassigned')} · ${escape(item.deadline || 'No date agreed')}</p>` : ''}</li>`;
    }).join('');
    return `<h2 ${tag}>${meetingLabels[result.kind]}</h2>${result.question ? `<p ${tag}>${escape(result.question)}</p>` : ''}${result.items.length ? `<ul ${tag}${actions ? ' data-type="taskList"' : ''}>${list}</ul>` : `<p ${tag}>${actions ? 'No action items were identified.' : 'No relevant details were identified.'}</p>`}`;
  }).join('') + meetingPersonalContent(content,meeting);
}

export function replaceMeetingSummaryContent(content:string, meeting:Meeting, ids:string[], html:string) {
  const doc = new DOMParser().parseFromString(replaceMeetingPersonalContent(content,meeting,''),'text/html');
  for (const node of Array.from(doc.body.children)) {
    if (ids.includes(node.getAttribute('data-meeting-analysis') || '') || (node.tagName === 'P' && node.textContent?.trim() === 'AI notes should be reviewed against the transcript.')) node.remove();
  }
  return doc.body.innerHTML + html;
}

export function meetingNoteForExport(note:Note, meeting:Meeting):Note {
  const results = (['summary','actions','minutes'] as const).map(kind => [...meeting.analyses].reverse().find(result => result.kind === kind)).filter((result):result is MeetingAnalysis => !!result);
  const content = note.meeting?.role === 'summary' ? meetingSummaryContent(note.content,meeting,results,note.meeting.editedAnalysisIds || []) : transcriptHtml(meeting,0) + meetingPersonalContent(note.content,meeting);
  const doc = new DOMParser().parseFromString(content,'text/html');
  for (const button of Array.from(doc.querySelectorAll('button[data-meeting-citation]'))) button.replaceWith(doc.createTextNode(` (${button.textContent || ''})`));
  return {...note,content:doc.body.innerHTML};
}

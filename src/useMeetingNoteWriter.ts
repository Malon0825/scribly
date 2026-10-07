import { useEffect, useRef, type RefObject } from 'react';
import type { Meeting } from './meetings';
import { appendSummaryResults, applyNoteBlockEdits, insertedAnalysisEdits, summaryNote, transcriptEdits, type MeetingNoteWrite } from './meetingNotes';
import { isLiveItem, type Workspace } from './types';

export type MeetingAppend = { id: string; write: (change:MeetingNoteWrite, commit:(content:string) => boolean) => boolean };
export function useMeetingNoteWriter(records: Meeting[], activeId: string | undefined, options: {
  checkpoint: () => Workspace | null; update: (change: (workspace: Workspace) => Workspace) => boolean;
  append: RefObject<MeetingAppend | null>; error: (message: string) => void;
}) {
  const latest = useRef(options); latest.current = options;
  const previous = useRef<Meeting[]>([]);
  useEffect(() => {
    const { checkpoint, update, append, error } = latest.current;
    try {
      for (const meeting of records) {
        if (meeting.deletedAt) continue;
        let workspace = checkpoint();
        const source = workspace?.notes.find(note => note.meeting?.sessionId === meeting.id && note.meeting.role === 'transcript' && isLiveItem(note))
          || workspace?.notes.find(note => note.id === meeting.noteId && note.meeting?.role === 'transcript' && isLiveItem(note));
        if (!workspace || !source || !source.meeting || (source.meeting.sessionId && source.meeting.sessionId !== meeting.id)) continue;
        const count = source.meeting.segmentCount || 0;
        {
          const last = previous.current.find(record => record.id === meeting.id);
          const change = (content:string) => transcriptEdits(content,meeting,count,last);
          const edits = change(source.content);
          const closed = meeting.recording === 'saved';
          if (edits.length || source.meeting.sessionId !== meeting.id || source.meeting.transcriptClosed !== closed || count !== meeting.segments.length) {
            const commit = (content:string) => update(w => ({ ...w, notes:w.notes.map(note => note.id === source.id && isLiveItem(note) ? { ...note, content, updatedAt:new Date().toISOString(), meeting:{ ...source.meeting, role:'transcript', sessionId:meeting.id, segmentCount:meeting.segments.length, transcriptClosed:closed } } : note) }));
            const saved = edits.length && append.current?.id === source.id ? append.current.write(change,commit) : commit(applyNoteBlockEdits(source.content,edits));
            if (!saved) throw Error('Meeting transcript could not be added to its note. The transcript and recording remain in Meetings.');
          }
        }
        workspace = checkpoint(); if (!workspace) continue;
        const created = summaryNote(workspace, source, meeting);
        if (created && !update(w => ({ ...w, notes:[...w.notes,created] }))) throw Error('The meeting summary note could not be created. AI results remain in Meetings.');
        const summaries = checkpoint()?.notes.filter(note => note.meeting?.role === 'summary' && note.meeting.sessionId === meeting.id && note.meeting.sourceNoteId === source.id) || [];
        for (const note of summaries) {
          const next = appendSummaryResults(note,meeting);
          if (next === note) continue;
          const commit = (content:string) => update(w => ({ ...w, notes:w.notes.map(item => item.id === note.id && isLiveItem(item) ? { ...next,content } : item) }));
          const saved = append.current?.id === note.id && next.content.startsWith(note.content) ? append.current.write(next.content.slice(note.content.length),commit) : commit(next.content);
          if (!saved) throw Error('Meeting results could not be saved into the summary note. The results remain in Meetings.');
        }
        const savedSummary = checkpoint()?.notes.find(note => note.meeting?.role === 'summary' && note.meeting.sessionId === meeting.id && note.meeting.sourceNoteId === source.id && isLiveItem(note));
        const currentSource = checkpoint()?.notes.find(note => note.id === source.id && isLiveItem(note));
        if (savedSummary && currentSource) {
          const change = (content:string) => insertedAnalysisEdits(content,meeting,savedSummary.meeting?.analysisIds || []);
          const edits = change(currentSource.content);
          if (edits.length) {
            const commit = (content:string) => update(w => ({...w,notes:w.notes.map(note => note.id === source.id && isLiveItem(note) ? {...note,content,updatedAt:new Date().toISOString()} : note)}));
            const saved = append.current?.id === source.id ? append.current.write(change,commit) : commit(applyNoteBlockEdits(currentSource.content,edits));
            if (!saved) throw Error('AI notes were saved to the summary; their original transcript copies could not be removed.');
          }
        }
      }
      previous.current = records;
    } catch (reason) { error(String(reason)); }
  }, [records, activeId]);
}

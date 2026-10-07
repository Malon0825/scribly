import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktop } from './storage';
import { defaultMeetingPreferences, listMeetings, savePreviewMeeting, sampleMeeting, type Meeting, type MeetingConnections, type MeetingPreferences, type MeetingStream, type RecordingFeedback } from './meetings';

export function useMeetings(ready: boolean) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, select] = useState('');
  const [connections, setConnections] = useState<MeetingConnections>({ deepgram: false, chatgpt: false, email: null });
  const [feedback, setFeedback] = useState<RecordingFeedback | null>(null);
  const [streams, setStreams] = useState<Record<string,MeetingStream>>({});
  const [interim, setInterim] = useState<{ id:string; text:string } | null>(null);
  const [reminder, setReminder] = useState<{ id:string; message:string } | null>(null);
  const [busy, setBusy] = useState('');
  const [recordingBusy, setRecordingBusy] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const preferences = connections.preferences || defaultMeetingPreferences;
  const lock = useRef(false);
  const recordingLock = useRef(false);
  const loadGeneration = useRef(0);
  const reload = useCallback(async () => { const generation = ++loadGeneration.current; const records = await listMeetings(); if (generation === loadGeneration.current) { setMeetings(records); setLoaded(true); } }, []);
  const refreshConnections = useCallback(async () => { if (desktop) setConnections(await invoke('meeting_connections')); }, []);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void reload().catch(reason => { if (live) setError(String(reason)); });
    if (desktop) void invoke<MeetingConnections>('meeting_connections').then(value => { if (live) setConnections(value); }).catch(reason => { if (live) setError(String(reason)); });
    const offs: (() => void)[] = [];
    if (desktop) {
      void listen('meeting-changed', () => { if (live) void reload().catch(reason => { if (live) setError(String(reason)); }); }).then(off => { if (live) offs.push(off); else off(); });
      void listen<RecordingFeedback>('meeting-recording', event => { if (live) setFeedback(event.payload); }).then(off => { if (live) offs.push(off); else off(); });
      void listen<{ id:string; interim:string }>('meeting-live', event => { if (live) setInterim({ id:event.payload.id, text:event.payload.interim }); }).then(off => { if (live) offs.push(off); else off(); });
      void listen<MeetingStream>('meeting-analysis-stream', event => { if (live) setStreams(current => { const next = {...current}; if (event.payload.done) delete next[event.payload.id]; else next[event.payload.id] = event.payload; return next; }); }).then(off => { if (live) offs.push(off); else off(); });
      void listen<{ id:string; message:string }>('meeting-silence', event => { if (live) setReminder(event.payload); }).then(off => { if (live) offs.push(off); else off(); });
    }
    return () => { live = false; loadGeneration.current++; offs.forEach(off => off()); };
  }, [ready, reload]);
  async function run<T>(label: string, operation: () => Promise<T>, after?: (value: T) => void): Promise<void> {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError('');
    try { const value = await operation(); await reload(); lock.current = false; setBusy(''); after?.(value); }
    catch (reason) { setError(String(reason)); }
    finally { lock.current = false; setBusy(''); }
  }
  async function runRecording(label: string, operation: () => Promise<Meeting | null>, after?: (value:Meeting | null) => void): Promise<void> {
    if (recordingLock.current) return;
    recordingLock.current = true; setRecordingBusy(label); setError('');
    try { const value = await operation(); await reload(); selectResult(value); after?.(value); }
    catch (reason) { setError(String(reason)); }
    finally { recordingLock.current = false; setRecordingBusy(''); }
  }
  function savePreferences(change: Partial<MeetingPreferences>) {
    const value = { ...preferences, ...change };
    if (!desktop) { setConnections(current => ({ ...current, preferences: value })); return; }
    void run('Saving meeting preferences', () => invoke<MeetingConnections>('meeting_set_preferences', { preferences: value }), setConnections);
  }
  function selectResult(value: Meeting | null) { if (value) select(value.id); }
  function addSample(noteId: string | null, integrated = false) { void run('Loading sample', async () => { const record = sampleMeeting(noteId,integrated); await savePreviewMeeting(record); return record; }, selectResult); }
  const selected = meetings.find(item => item.id === selectedId && !item.deletedAt) || meetings.find(item => !item.deletedAt) || null;
  const recording = meetings.find(item => !item.deletedAt && (item.recording === 'recording' || item.recording === 'paused')) || null;
  return { meetings, selected, select, recording, feedback, interim, streams, reminder, dismissReminder:() => setReminder(null), connections, preferences, savePreferences, setConnections, refreshConnections, busy, recordingBusy, error, setError, loaded, run, runRecording, reload, selectResult, addSample };
}
export type MeetingsController = ReturnType<typeof useMeetings>;

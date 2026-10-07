// Launched only by the isolated profile wrapper. Never uses production accounts.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
const port = Number(process.argv[2]), profile = resolve(process.argv[3] || ''), stage = process.argv[4];
if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^meetings-webview-test-[a-f0-9]{32}$/.test(basename(profile)) || !['capture', 'recover','silence'].includes(stage)) throw Error('Use the isolated meetings launcher.');
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
  catch { await new Promise(done => setTimeout(done, 200)); }
}
if (!browser) throw Error('Isolated WebView2 endpoint unavailable');
const page = browser.contexts()[0].pages().find(item => !new URL(item.url()).searchParams.has('capture'));
if (!page) throw Error('Main WebView unavailable');
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const load = () => invoke('load_workspace');
await page.getByRole('textbox', { name: 'Note content', exact: true }).waitFor({ timeout: 60000 });
if ((await invoke('meeting_connections')).deepgram || (await invoke('meeting_connections')).chatgpt) throw Error('Diagnostic unexpectedly has connected accounts; no provider test was run.');
try {
  if (stage === 'capture') {
    const devices = await invoke('meeting_devices');
    if (!devices.some(device => device.kind === 'system')) throw Error('No Windows render endpoint is available for loopback validation.');
    await expect.poll(async () => (await load()).document?.activeId, { timeout: 15000 }).toBeTruthy();
    const noteId = (await load()).document.activeId;
    await expect(invoke('meeting_start', { title: 'Rejected recording', noteId, microphone: null, system: '', video: null, consent: false })).rejects.toThrow('permission');
    const videoSource = devices.find(device => device.kind === 'video' && device.id.startsWith('window:') && device.name.includes('isolated performance measurement'));
    const record = await invoke('meeting_start', { title: 'Native system recording', noteId, microphone: null, system: '', video: videoSource?.id || null, consent: true });
    await page.getByLabel('Meetings', { exact: true }).click();
    const meetingPanel = page.getByRole('complementary', { name: 'Meeting panel' });
    await page.getByRole('textbox', { name: 'Note content', exact: true }).fill('Writing stays editable during recording.');
    await expect.poll(async () => (await load()).document.notes.find(note => note.id === noteId)?.content, { timeout: 15000 }).toContain('Writing stays editable');
    await new Promise(done => setTimeout(done, 1200));
    await meetingPanel.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(async () => (await invoke('meeting_list')).find(item => item.id === record.id)?.recording).toBe('paused');
    await new Promise(done => setTimeout(done, 700));
    await meetingPanel.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(async () => (await invoke('meeting_list')).find(item => item.id === record.id)?.recording).toBe('recording');
    await new Promise(done => setTimeout(done, 1000));
    await meetingPanel.getByRole('button', { name: 'End recording', exact: true }).click();
    await expect.poll(async () => (await invoke('meeting_list')).find(item => item.id === record.id)?.recording).toBe('saved');
    const saved = (await invoke('meeting_list')).find(item => item.id === record.id);
    if (saved.recording !== 'saved' || !saved.media || saved.duration < 2 || saved.duration > 15) throw Error('Native recording was not finalized with a plausible duration.');
    const raw = await readFile(join(profile, 'meetings', saved.id, 'audio.wav'));
    if (raw.toString('ascii', 0, 4) !== 'RIFF' || raw.readUInt32LE(24) !== 16000) throw Error('Managed WAV header is invalid.');
    await expect.poll(() => page.locator('.meeting-panel audio').evaluate(audio => audio.duration), { timeout: 15000 }).toBeGreaterThan(2);
    if (videoSource) {
      if (!saved.video) throw Error(`Native video did not finalize: ${saved.error || 'No video reference'}`);
      await expect.poll(() => page.locator('.meeting-panel video').evaluate(video => video.videoWidth), { timeout: 15000 }).toBeGreaterThan(0);
    }
    await expect(invoke('meeting_transcribe', { id: saved.id, language: 'en' })).rejects.toThrow('Connect Deepgram');
    const retained = (await invoke('meeting_list')).find(item => item.id === saved.id);
    if (!retained.media || retained.processing !== 'failed') throw Error('Provider failure discarded the recording.');
    const crash = await invoke('meeting_start', { title: 'Interrupted recording recovery', noteId, microphone: null, system: '', video: null, consent: true });
    await new Promise(done => setTimeout(done, 2300));
    if (!(await stat(join(profile, 'meetings', crash.id, 'system.pcm'))).size) throw Error('Recoverable PCM was not flushed.');
    await writeFile(join(profile, 'meetings-test-state.json'), JSON.stringify({ savedId: saved.id, crashId: crash.id, duration: saved.duration, videoChecked: !!videoSource }));
    // The wrapper deliberately terminates this launcher-owned app to test recovery.
  } else if (stage === 'recover') {
    const { savedId, crashId, videoChecked } = JSON.parse(await readFile(join(profile, 'meetings-test-state.json'), 'utf8'));
    const records = await invoke('meeting_list');
    if (!records.find(item => item.id === savedId)?.media || records.find(item => item.id === crashId)?.recording !== 'interrupted') throw Error('Meeting persistence or crash detection failed.');
    const recovered = await invoke('meeting_recover', { id: crashId });
    if (recovered.recording !== 'saved' || !recovered.media || recovered.duration < .5) throw Error('Interrupted PCM recovery failed.');
    await invoke('meeting_update', { id: recovered.id, title: 'Recovered native meeting', speakers: { '0': 'Known speaker' }, segments: [{ id: 0, start: 0, end: .5, speaker: '0', text: 'Locally reviewed transcript fixture.' }] });
    await expect(invoke('meeting_analyze', { id: recovered.id, model: 'test-model', kind: 'summary', question: '', notes: '' })).rejects.toThrow('Connect ChatGPT');
    await invoke('meeting_delete', { id: recovered.id });
    if ((await invoke('meeting_list')).some(item => item.id === recovered.id)) throw Error('Meeting deletion did not commit.');
    await expect.poll(async () => (await load()).document.notes.some(note => note.content.includes('Writing stays editable'))).toBe(true);
    await writeFile(join(profile, 'meetings-test-result.json'), JSON.stringify({ ok: true, loopbackRecording: true, pauseResume: true, playback: true, writingAndAutosave: true, recordingControlsViaUI: true, providerFailureRetainsAudio: true, restartPersistence: true, crashRecovery: true, independentDeletion: true, videoChecked, providersCalled: false }));
    await page.getByRole('button', { name: 'Close window', exact: true }).click();
  } else {
    await expect.poll(async () => (await load()).document?.activeId,{timeout:15000}).toBeTruthy();
    const workspace = (await load()).document;
    if (!(await invoke('meeting_list')).length) {
      await invoke('meeting_start',{title:'Prior saved session',noteId:workspace.activeId,microphone:null,system:'',video:null,consent:true});
      await new Promise(done => setTimeout(done,1000)); await invoke('meeting_stop');
    }
    const folder = workspace.folders.find(folder => !folder.deletedAt);
    if (!folder) throw Error('The diagnostic notebook has no folder for the meeting workflow.');
    await page.getByRole('button',{name:`Options for ${folder.name}`,exact:true}).click();
    await page.getByRole('button',{name:'Start meeting',exact:true}).click();
    const editor = page.getByRole('textbox',{name:'Note content',exact:true});
    await expect(editor).toHaveText('');
    const meetingPanel = page.getByRole('complementary',{name:'Meeting panel'});
    await meetingPanel.getByLabel(/^Microphone/).selectOption('none');
    await meetingPanel.getByLabel(/^System audio/).selectOption('default');
    await meetingPanel.getByLabel('Transcribe live into the meeting note').uncheck();
    await meetingPanel.getByLabel('I have permission to record the participants.').check();
    await meetingPanel.getByRole('button',{name:'Start recording',exact:true}).click();
    await expect(meetingPanel.getByRole('button',{name:'End recording',exact:true})).toBeVisible();
    const record = (await invoke('meeting_list')).find(meeting => meeting.recording === 'recording');
    if (!record?.autoNotes) throw Error('Folder recording was not configured for automatic meeting notes.');
    await editor.fill('My notes survive the automatic stop.');
    await meetingPanel.getByRole('button',{name:'Pause',exact:true}).click();
    await new Promise(done => setTimeout(done,2000));
    await meetingPanel.getByRole('button',{name:'Resume',exact:true}).click();
    await expect.poll(async () => (await invoke('meeting_list')).find(meeting => meeting.id === record.id)?.stopReason,{timeout:200000,intervals:[1000]}).toBe('silence');
    await expect.poll(async () => (await invoke('meeting_list')).find(meeting => meeting.id === record.id)?.recording,{timeout:20000}).toBe('saved');
    await expect(meetingPanel.getByRole('alert').filter({hasText:'No speech detected for 3 minutes'})).toBeVisible();
    const saved = (await invoke('meeting_list')).find(meeting => meeting.id === record.id);
    if (!saved.media || saved.duration < 180 || saved.duration > 185) throw Error('Silence stop failed to finalize three minutes of unpaused audio.');
    await expect.poll(async () => (await load()).document.notes.filter(note => note.meeting?.role === 'summary' && note.meeting.sessionId === record.id).length,{timeout:15000}).toBe(1);
    const document = (await load()).document;
    const source = document.notes.find(note => note.id === record.noteId), summary = document.notes.find(note => note.meeting?.role === 'summary' && note.meeting.sessionId === record.id);
    if (source.folderId !== folder.id || summary.folderId !== folder.id || summary.title !== `${source.title} Summary` || !source.content.includes('My notes survive')) throw Error('Automatic stop did not preserve the folder, titles and writing.');
    if (!(await stat(join(profile,'meeting-credentials','silence-reminder.mp3'))).size) throw Error('Notification sound was not materialized.');
    const resultPath = join(profile,'meetings-test-result.json'); const result = JSON.parse(await readFile(resultPath,'utf8').catch(error => { if(error.code === 'ENOENT') return '{"ok":true,"providersCalled":false}'; throw error; }));
    await writeFile(resultPath,JSON.stringify({...result,folderMeeting:true,silenceAutoStop:true,silenceDuration:saved.duration,pauseExcluded:true,reminderVisible:true,soundMaterialized:true,separateSummary:true,missingTranscriptRetainsAudio:true}));
    await page.getByRole('button',{name:'Close window',exact:true}).click();
  }
} catch (error) {
  await writeFile(join(profile,'failure-ui.txt'),await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }

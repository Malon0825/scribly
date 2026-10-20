// Real local services in a fresh diagnostic notebook. No accounts or microphone.
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {basename,resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const port=Number(process.argv[2]),profile=resolve(process.argv[3]||''),stage=process.argv[4],speech=process.argv[5]==='speech';
const speechModel=process.argv[6] || 'moonshine';
if(!['moonshine','moonshine-small'].includes(speechModel))throw Error('Invalid speech fixture model');
if (!Number.isInteger(port)||!/^local-ai-native-[a-f0-9]{32}$/.test(basename(profile))||!['exercise','restart'].includes(stage))throw Error('Use the isolated local-AI launcher');
let browser;
for(let n=0;n<150;n++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{await new Promise(done=>setTimeout(done,200));}}
if(!browser)throw Error('Diagnostic WebView unavailable');
const page=browser.contexts()[0].pages().find(p=>!new URL(p.url()).searchParams.has('capture'));
if(process.argv[7]==='production' && ['localhost','127.0.0.1'].includes(new URL(page.url()).hostname))throw Error('Release executable unexpectedly uses a dev server');
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const metrics=[];
await page.exposeFunction('recordLocalMetric',metric=>metrics.push(metric));
const load=()=>invoke('load_workspace');
page.on('pageerror',error=>console.log('Diagnostic page error:',error.message));
page.on('requestfailed',request=>console.log('Diagnostic request failed:',request.url(),request.failure()?.errorText));
try {await page.getByRole('textbox',{name:'Note content',exact:true}).waitFor({timeout:30000});}
catch(error) {console.log('Diagnostic URL:',page.url(),'Body:',(await page.locator('body').innerText()).slice(0,1200));await page.screenshot({path:join(profile,'failed-startup.png')});throw error;}
await expect.poll(async()=>(await load()).document?.activeId,{timeout:15000}).toBeTruthy();
await page.evaluate(async()=>{
  await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'local-ai-metrics',target:{kind:'Any'},handler:window.__TAURI_INTERNALS__.transformCallback(event=>window.recordLocalMetric(event.payload))});
});
const sql=async(query)=>{
  const config=JSON.parse(await readFile(join(profile,'local-database.json'),'utf8'));
  const file=join(profile,'fixture.sql');await writeFile(file,query);
  const {stdout}=await promisify(execFile)(resolve('src-tauri/resources/postgres/bin/psql.exe'),['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(config.port),'-U','still','-d','postgres','-At','-f',file],{env:{...process.env,PGPASSWORD:config.password}});return stdout.trim();
};
const record=()=>({id:randomUUID(),noteId:null,title:'Local fixture',createdAt:Date.now(),duration:20,media:null,video:null,recording:'saved',processing:'ready',error:null,revision:1,speakers:{'0':'Sam','1':'Jordan'},analyses:[],segments:[
  {id:0,start:0,end:5,speaker:'0',text:'I am Sam. I will review the prototype on Tuesday.'},
  {id:1,start:5,end:10,speaker:'1',text:'I am Jordan. I will write the release notes on Friday.'},
  {id:2,start:10,end:15,speaker:'0',text:'We have not decided the budget. Sam will review the prototype.'},
]});
const insert=async(meeting)=>{await sql(`INSERT INTO scribly_meetings(id,document) VALUES('${meeting.id}',$fixture$${JSON.stringify(meeting)}$fixture$::jsonb);`);};
const output=join(profile,'local-ai-state.json');
try {
  const connections=await invoke('meeting_connections');
  if(connections.deepgram||connections.chatgpt||connections.gemini||connections.openrouter)throw Error('Diagnostic unexpectedly has credentials');
  if(stage==='exercise') {
    if(connections.preferences.requestProvider!=='ollama'||connections.preferences.transcriptionModel!=='moonshine')throw Error('Fresh installs must select local defaults');
    const status=await invoke('local_ai_status');if(!status.models.some(m=>m.id==='gemma4:e4b'))throw Error('Install gemma4:e4b explicitly before testing');
    const started=Date.now();const connectionTest=await invoke('local_ai_test');console.log(connectionTest);
    const meeting=record();await invoke('meeting_list');await insert(meeting);
    const conversation=await invoke('ai_conversation_new',{scope:'meeting',parentId:meeting.id});
    const analyze=(kind,question='',model='gemma4:e4b')=>invoke('meeting_analyze',{id:meeting.id,provider:'ollama',model,kind,question,notes:'',conversationId:kind==='question'?conversation.id:null});
    let answered=await analyze('question','What will Sam do, and when?');
    let answer=answered.analyses.at(-1);if(!answer.items.length||!answer.items.every(i=>i.sources.every(s=>meeting.segments.some(segment=>segment.id===s))))throw Error('Answer lost valid citations');
    const follow=await analyze('question','Make it shorter.');if(!follow.analyses.at(-1).items.some(i=>/Sam|prototype|Tuesday/i.test(i.text)))throw Error('Follow-up lost conversation references');console.log('Citations and scoped follow-up passed');
    await expect(analyze('summary','','missing-local-model')).rejects.toThrow('missing');
    await expect(analyze('question','Will missing models keep this attempt?','missing-local-model')).rejects.toThrow('missing');
    if(!(await invoke('ai_conversation_list',{scope:'meeting',parentId:meeting.id}))[0].messages.some(m=>m.role==='assistant'&&m.status==='failed'&&/missing/.test(m.text)))throw Error('Missing-model attempt was not retained');
    if((await invoke('meeting_list')).find(m=>m.id===meeting.id).segments.length!==3)throw Error('Missing-model failure lost transcript');
    const cancelled=analyze('question','List every commitment in detailed prose.').then(()=>null,e=>String(e));await new Promise(done=>setTimeout(done,150));await invoke('meeting_cancel',{id:meeting.id});if(!/canceled/.test(await cancelled))throw Error('Cancellation did not reject the request');
    if((await invoke('ai_conversation_list',{scope:'meeting',parentId:meeting.id}))[0].messages.some(m=>m.status==='pending'))throw Error('Cancellation left pending durable turns');
    // A real editor proposal must be reviewed before it changes notebook content.
    const noteId=(await load()).document.activeId;
    const editor=page.getByRole('textbox',{name:'Note content',exact:true});const original='The draft is ready. Sam reviews the prototype on Tuesday.';
    await editor.fill(original);await editor.focus();await page.keyboard.press('Control+A');
    await page.getByRole('button',{name:'Writing help',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Local writing help'});await dialog.getByRole('button',{name:'Generate suggestion',exact:true}).click();
    const accept=dialog.getByRole('button',{name:'Accept rewrite',exact:true});await expect(accept).toBeEnabled({timeout:120000});
    for(const [theme,width] of [['light',1440],['dark',900]]) {
      await page.setViewportSize({width,height:800});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      const bounds=await dialog.boundingBox();if(!bounds||bounds.x<0||bounds.x+bounds.width>width+1||await dialog.evaluate(node=>node.scrollWidth>node.clientWidth+1))throw Error('Writing review overflows the viewport');
      await page.screenshot({path:join(profile,`writing-${theme}.png`)});
    }
    await page.setViewportSize({width:1440,height:920});await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    await expect(editor).toHaveText(original);const proposal=await dialog.locator('.writing-assist-review section').last().locator('p').innerText();
    await accept.click();await expect(editor).toHaveText(proposal);await expect.poll(async()=>(await load()).document.notes.find(n=>n.id===noteId).content,{timeout:15000}).toContain(proposal.slice(0,20));
    await page.keyboard.press('Control+z');await expect(editor).toHaveText(original);await expect.poll(async()=>(await load()).document.notes.find(n=>n.id===noteId).content,{timeout:15000}).toContain(original);
    const noteHistory=await invoke('ai_conversation_list',{scope:'note',parentId:noteId});if(!noteHistory[0].messages.some(m=>m.status==='completed'))throw Error('Writing history did not persist');console.log('Writing Accept, Undo and autosave passed');
    // Editing after the snapshot makes a late proposal ineligible for Accept.
    await editor.focus();await page.keyboard.press('Control+A');await page.getByRole('button',{name:'Writing help',exact:true}).click();
    await dialog.getByRole('button',{name:'Generate suggestion',exact:true}).click();
    await editor.evaluate(dom=>dom.editor.commands.insertContent('Changed after request. '));
    await expect(dialog.getByText('Your note changed.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Accept rewrite',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Close',exact:true}).click();
    const backup=await invoke('ai_conversation_backup',{noteIds:[noteId]});if(!backup.length)throw Error('Notebook backup omitted history');
    const snapshot=await load();const clonedNote={...snapshot.document.notes.find(n=>n.id===noteId),folderId:null,title:'Restored writing history'};
    await page.getByLabel('Import files',{exact:true}).setInputFiles({name:'local-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:2,notes:[clonedNote],folders:[],aiVersion:1,aiConversations:backup}))});
    await expect.poll(async()=>(await load()).document.notes.some(n=>n.title==='Restored writing history'),{timeout:15000}).toBe(true);
    let restoredNoteId=(await load()).document.notes.find(n=>n.title==='Restored writing history').id;
    const restoredHistory=await invoke('ai_conversation_list',{scope:'note',parentId:restoredNoteId});if(!restoredHistory.length||restoredHistory[0].id===backup[0].id||restoredHistory[0].messages[0].id===backup[0].messages[0].id||(await load()).document.aiConversations)throw Error('Restored history was not remapped into separate ledger storage');
    for(const conversation of restoredHistory)await invoke('ai_conversation_clear',{id:conversation.id});
    await editor.fill('Imported history stays cleared after another editor save.');
    await expect.poll(async()=>(await load()).document.notes.find(n=>n.id===restoredNoteId).content,{timeout:15000}).toContain('Imported history stays cleared');
    if((await invoke('ai_conversation_list',{scope:'note',parentId:restoredNoteId})).length)throw Error('An acknowledged import resurrected cleared history');
    // Import once more to exercise independent restored IDs and restart retention.
    await page.getByLabel('Import files',{exact:true}).setInputFiles({name:'local-history-again.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:2,notes:[{...clonedNote,title:'Second restored history'}],folders:[],aiVersion:1,aiConversations:backup}))});
    await expect.poll(async()=>(await load()).document.notes.some(n=>n.title==='Second restored history'),{timeout:15000}).toBe(true);
    restoredNoteId=(await load()).document.notes.find(n=>n.title==='Second restored history').id;
    // Queue explicitly requested work during capture; cancellation accepts input immediately.
    const captured=await invoke('meeting_start',{title:'Local scheduler test',noteId,microphone:null,system:'',video:null,consent:true,language:null,autoNotes:false,transcriptionModel:'moonshine'});
    const queue=analyze('summary').then(()=>null,e=>String(e));await new Promise(done=>setTimeout(done,500));await invoke('meeting_cancel',{id:meeting.id});if(!/canceled/.test(await queue))throw Error('Queued analysis did not cancel');
    await invoke('meeting_pause',{id:captured.id,paused:true});await new Promise(done=>setTimeout(done,700));await invoke('meeting_pause',{id:captured.id,paused:false});await new Promise(done=>setTimeout(done,500));const saved=await invoke('meeting_stop');if(!saved.media||saved.duration<.5)throw Error('Capture did not save independently of the cancelled job');
    let speechResult=null;
    if(speech) {
      const installed=await invoke('local_speech_setup',{model:speechModel});if(!(speechModel==='moonshine' ? installed.medium : installed.small))throw Error('Speech/speaker setup failed');
      const audioMeeting=record();audioMeeting.segments=[];audioMeeting.speakers={};audioMeeting.media='audio.wav';await mkdir(join(profile,'meetings',audioMeeting.id),{recursive:true});await copyFile(join(profile,'speech-fixture.wav'),join(profile,'meetings',audioMeeting.id,'audio.wav'));await insert(audioMeeting);
      const before=Date.now();let transcript=await invoke('meeting_transcribe',{id:audioMeeting.id,language:'en',model:speechModel});
      if(!transcript.liveComplete||!transcript.segments.length||!transcript.segments.some(s=>s.speakerSpans?.length))throw Error(`Native speech failed: ${transcript.error||'Missing words or speakers'}`);
      const source=transcript.segments[0];const corrected='User corrected the first line.';transcript=await invoke('meeting_update',{id:transcript.id,title:transcript.title,speakers:{...transcript.speakers,[source.speaker]:'Reviewed speaker'},segments:transcript.segments.map(s=>s.id===source.id?{...s,text:corrected}:s)});
      const replay=await invoke('meeting_transcribe',{id:transcript.id,language:'en',model:speechModel});if(replay.segments[0].text!==corrected||replay.segments[0].id!==source.id||replay.speakers[source.speaker]!=='Reviewed speaker')throw Error('Replay erased corrections or stable sources');
      speechResult={model:speechModel,seconds:(Date.now()-before)/1000,lines:replay.segments.length,spans:replay.segments.reduce((n,s)=>n+(s.speakerSpans?.length||0),0),cursor:replay.transcriptionCursor,syntheticAudio:true};
      // Only this isolated app's worker is killed. Capture must still finalize.
      const live=await invoke('meeting_start',{title:'Worker interruption fixture',noteId,microphone:null,system:'',video:null,consent:true,language:'en',autoNotes:false,transcriptionModel:speechModel});
      await new Promise(done=>setTimeout(done,1200));
      const children=await promisify(execFile)('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='scribly-moonshine.exe'" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`]);
      const parents=await promisify(execFile)('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='scribly.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`]);
      const list=v=>Array.isArray(v)?v:[v];const owner=list(JSON.parse(parents.stdout)).find(p=>p.CommandLine.includes(profile));const child=list(JSON.parse(children.stdout)).find(p=>p.ParentProcessId===owner?.ProcessId);if(!child)throw Error('Own worker process could not be identified');
      await promisify(execFile)('powershell',['-NoProfile','-Command',`Stop-Process -Id ${Number(child.ProcessId)} -Force`]);const stopped=await invoke('meeting_stop');if(!stopped.media||stopped.liveComplete||!stopped.error||!(await stat(join(profile,'meetings',live.id,'system.pcm'))).size)throw Error('Worker crash did not retain audio and expose recovery');
      await invoke('meeting_transcribe',{id:live.id,language:'en',model:speechModel});
    }
    await writeFile(output,JSON.stringify({meetingId:meeting.id,conversationId:conversation.id,noteId,noteConversationId:noteHistory[0].id,restoredNoteId,capturedId:captured.id,connectionTest,elapsedSeconds:(Date.now()-started)/1000,speechResult,metrics}));
    await page.getByRole('button',{name:'Close window',exact:true}).click();
  } else {
    const state=JSON.parse(await readFile(output,'utf8'));const history=await invoke('ai_conversation_list',{scope:'meeting',parentId:state.meetingId});if(!history.find(c=>c.id===state.conversationId)?.messages.some(m=>m.status==='completed'))throw Error('Meeting history lost on restart');
    const notes=await invoke('ai_conversation_list',{scope:'note',parentId:state.noteId});if(!notes.find(c=>c.id===state.noteConversationId)?.messages.some(m=>m.status==='completed'))throw Error('Writing history lost on restart');
    // Force older complete pairs out of the recent allowance. These are only
    // synthetic final turns; private reasoning is never stored or supplied.
    const scoped=history.find(c=>c.id===state.conversationId);
    for(let n=0;n<2;n++)for(const role of ['user','assistant'])scoped.messages.push({id:randomUUID(),role,status:'completed',createdAt:Date.now(),revision:1,model:'gemma4:e4b',digest:scoped.messages[0].digest,sources:role==='assistant'?[0,1]:[],text:role==='user'?'Keep the explanation concise. '.repeat(12):'Sam reviews the prototype on Tuesday; Jordan writes release notes on Friday. '.repeat(8)});
    await sql(`UPDATE scribly_conversations SET document=$fixture$${JSON.stringify(scoped)}$fixture$::jsonb WHERE id='${scoped.id}';`);
    const reply=await invoke('meeting_analyze',{id:state.meetingId,model:'gemma4:e4b',provider:'ollama',kind:'question',question:'Which day was Sam going to do that?',notes:'',conversationId:state.conversationId});if(!reply.analyses.at(-1).items.some(i=>/Tuesday/i.test(i.text)))throw Error('Follow-up lost references on app restart');
    const compacted=(await invoke('ai_conversation_list',{scope:'meeting',parentId:state.meetingId})).find(c=>c.id===state.conversationId);if(!compacted.memory?.coveredIds.length||Buffer.byteLength(compacted.memory.text)>1800)throw Error('Older turns did not produce bounded memory');
    console.log('Restart, follow-up and conversation compaction passed');
    await invoke('meeting_trash',{id:state.meetingId,trashed:true});if(await sql(`SELECT count(*) FROM scribly_conversations WHERE parent_id='${state.meetingId}';`)!=='1')throw Error('Trash discarded retained history');await invoke('meeting_trash',{id:state.meetingId,trashed:false});
    await sql(`UPDATE scribly_meetings SET document=jsonb_set(document,'{localRecovery}',$fixture$${JSON.stringify({kind:'question',model:'gemma4:e4b',revision:1,title:'Local fixture',question:'Interrupted follow-up',notes:'',digest:scoped.messages[0].digest,checkpoints:[]})}$fixture$::jsonb) WHERE id='${state.meetingId}';`);
    await invoke('ai_conversation_clear',{id:state.conversationId});if((await invoke('ai_conversation_list',{scope:'meeting',parentId:state.meetingId})).length||(await invoke('meeting_list')).find(m=>m.id===state.meetingId).localRecovery)throw Error('Clear did not delete ledger and derived question recovery');
    await invoke('ai_conversation_new',{scope:'meeting',parentId:state.meetingId});
    await invoke('meeting_delete',{id:state.meetingId});if(await sql(`SELECT count(*) FROM scribly_conversations WHERE parent_id='${state.meetingId}';`)!=='0')throw Error('Deleted meeting orphaned private history');
    let workspace=await load();const trash={...workspace.document,notes:workspace.document.notes.map(n=>n.id===state.restoredNoteId?{...n,deletedAt:new Date().toISOString()}:n)};
    await invoke('save_workspace',{document:trash,revision:workspace.revision});if(await sql(`SELECT count(*) FROM scribly_conversations WHERE parent_id='${state.restoredNoteId}';`)==='0')throw Error('Note Trash discarded history');
    workspace=await load();const remainingNotes=workspace.document.notes.filter(n=>n.id!==state.restoredNoteId);
    await invoke('save_workspace',{document:{...workspace.document,notes:remainingNotes,recentIds:workspace.document.recentIds?.filter(id=>id!==state.restoredNoteId),referenceId:workspace.document.referenceId===state.restoredNoteId?null:workspace.document.referenceId,activeId:workspace.document.activeId===state.restoredNoteId?(remainingNotes.find(n=>!n.deletedAt&&!n.archived)?.id||''):workspace.document.activeId},revision:workspace.revision});if(await sql(`SELECT count(*) FROM scribly_conversations WHERE parent_id='${state.restoredNoteId}';`)!=='0')throw Error('Deleted note orphaned private history');
    await writeFile(join(profile,'local-ai-result.json'),JSON.stringify({...state,ok:true,realOllama:true,citations:true,followupAcrossRestart:true,missingModelRetainsData:true,cancellation:true,captureQueue:true,writingAcceptUndoAutosave:true,staleSnapshotBlocked:true,historyBackup:true,parentRetentionAndDeletion:true},null,2));
    await page.getByRole('button',{name:'Close window',exact:true}).click();console.log('Local AI native checks passed');
  }
}catch(error){await page.screenshot({path:join(profile,`failed-${stage}.png`)}).catch(()=>{});throw error;}

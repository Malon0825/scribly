import { test, expect, type Page } from '@playwright/test';
import type { Workspace } from '../src/types';
import type { Meeting } from '../src/meetings';

const stamp = '2026-10-07T00:00:00Z';
const fixture: Workspace = { theme: 'light', activeId: 'meeting-note', referenceId: 'reference-note', folders: [], notes: [
  { id: 'meeting-note', folderId: null, title: 'Meeting notebook', content: '<p>My original notes.</p>', createdAt: stamp, updatedAt: stamp, archived: false },
  { id: 'reference-note', folderId: null, title: 'Other note', content: '<p>Reference remains available.</p>', createdAt: stamp, updatedAt: stamp, archived: false },
] };
async function open(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(workspace => { if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document: workspace, dataPath: 'Test' })); }, { ...fixture, theme });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
  await page.getByLabel('Meetings', { exact: true }).click();
  await page.getByRole('button', { name: 'Load sample meeting' }).click();
  await expect(page.getByRole('complementary', { name: 'Meeting panel' })).toContainText('Sample · Launch planning');
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Meeting panel' });
const linkedMeeting:Meeting = { id:'73e4f8b5-d38d-46e8-8295-4e954875d77d',noteId:'meeting-note',title:'Meeting notebook',createdAt:1,duration:10,media:null,video:null,
  recording:'saved',processing:'ready',error:null,revision:1,speakers:{},analyses:[],segments:[
    {id:0,start:0,end:5,speaker:'0',text:'Original first statement.'},
    {id:1,start:5,end:10,speaker:'1',text:'Original second statement.'},
  ] };

for (const theme of ['light','dark'] as const) test(`organized meeting minutes preserve citations, edits, actions and reload in ${theme}`, async ({page}) => {
  const meeting:Meeting = {...linkedMeeting, analyses:[
    {id:'structured-summary',kind:'summary',model:'Test',question:'',revision:1,createdAt:1,items:[
      {text:'Review Beta migration readiness; release remains conditional on QA.',sources:[0,1],section:'overview'},
      {text:'Use Beta rather than Alpha after QA passes.',sources:[1],section:'decisions'},
    ]},
    {id:'structured-minutes',kind:'minutes',model:'Test',question:'',revision:1,createdAt:1,items:[
      {text:'Next review is Thursday at 10 a.m.',sources:[1],section:'next_meeting'},
      {text:'Purpose: review migration readiness.',sources:[0],section:'overview'},
      {text:'Data quality: corrected error rate is 0.03%; QA remains incomplete.',sources:[0,1],section:'discussion'},
      {text:'Use Beta after QA passes; a dashboard remains a suggestion.',sources:[1],section:'decisions'},
      {text:'QA sign-off remains unresolved.',sources:[1],section:'open_points'},
      {text:'Mapping-v3.xlsx is referenced; it is not attached.',sources:[1],section:'references'},
    ]},
    {id:'structured-actions',kind:'actions',model:'Test',question:'',revision:1,createdAt:1,items:[
      {text:'Send corrected mapping report after DBA row counts arrive.',sources:[0],owner:'Priya',deadline:'before Thursday review'},
      {text:'Supply row counts.',sources:[1]},
    ]},
  ]};
  const workspace:Workspace = {...fixture,theme,notes:fixture.notes.map(note => note.id === 'meeting-note' ? {...note,meeting:{role:'transcript',sessionId:meeting.id,segmentCount:0}} : note)};
  await page.addInitScript(({workspace,meeting}) => {
    if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'}));
    if (!localStorage.getItem('scribly-meetings-preview')) localStorage.setItem('scribly-meetings-preview',JSON.stringify([meeting]));
  },{workspace,meeting});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Meetings',exact:true}).click();
  await panel(page).getByRole('button',{name:'Summary',exact:true}).click();
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor.locator('h3[data-meeting-analysis="structured-minutes"]')).toHaveText([
    'Meeting details','Agenda & discussion','Decisions','Open & deferred items','Next meeting','Referenced documents',
  ]);
  await expect(editor).toContainText('Draft minutes · review against the transcript before sharing.');
  await expect(editor.locator('h3[data-meeting-analysis="structured-summary"]')).toHaveText(['Overview','Decisions']);
  await expect(editor).toContainText('Owner not stated · No date agreed');
  await expect(editor).not.toContainText('Attendance:');
  const citation = await editor.locator('ul[data-meeting-analysis="structured-minutes"] button[data-meeting-citation]').first().getAttribute('data-meeting-citation');
  expect(JSON.parse(citation!)).toMatchObject({session:meeting.id,segment:0,revision:1});
  const heading = editor.locator('h3[data-meeting-analysis="structured-minutes"]').filter({hasText:'Agenda & discussion'});
  await editor.focus();
  await heading.evaluate(async element => {
    const range=document.createRange();range.selectNodeContents(element);
    const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  });
  await page.keyboard.insertText('Topics reviewed');
  const checkbox = editor.locator('li[data-meeting-action="structured-actions:1"] input[type=checkbox]');
  await checkbox.check();
  await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note:{meeting?:{role:string}})=>note.meeting?.role==='summary')?.content || '')).toContain('Topics reviewed');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0].completedActions)).toContain('structured-actions:1');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor.locator('h3').filter({hasText:'Topics reviewed'})).toHaveCount(1);
  await expect(editor.locator('h2').filter({hasText:'Meeting minutes'})).toHaveCount(1);
  await expect(checkbox).toBeChecked();
  await expect(editor).toContainText('Data quality: corrected error rate is 0.03%');
  if (process.env.PLAYWRIGHT_PREVIEW !== '1') {
    const exported = await page.evaluate(async () => {
      const {meetingMarkdown}=await import('/src/meetings.ts');
      const {meetingNoteForExport}=await import('/src/meetingNotes.ts');
      const meeting=JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0];
      const note=JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note:{meeting?:{role:string}})=>note.meeting?.role==='summary');
      return {markdown:meetingMarkdown(meeting),html:meetingNoteForExport(note,meeting).content};
    });
    expect(exported.markdown).toContain('### Decisions');
    expect(exported.markdown).toContain('### Next meeting');
    expect(exported.markdown).toContain('speaker labels');
    expect(exported.html).toContain('Topics reviewed');
    expect(exported.html).not.toContain('data-meeting-citation');
  }
  await page.screenshot({path:`test-results/organized-minutes-${theme}.png`});
});

test('ChatGPT summary controls wait for the final Moonshine transcript and local naming',async({page})=>{
  test.skip(process.env.PLAYWRIGHT_PREVIEW==='1','Isolated request-hook fixture requires Vite module routing');
  await page.route('**/src/MeetingAIControls.tsx*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace(/import \{ desktop \} from "([^\"]+)";/,'const desktop = true;')});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const main=await (await page.request.get('/src/main.tsx')).text();
  const reactUrl=main.match(/from "([^\"]+\/react\.js[^\"]*)"/)?.[1];
  const reactDomUrl=main.match(/from "([^\"]+\/react-dom_client\.js[^\"]*)"/)?.[1];
  expect(reactUrl).toBeTruthy();expect(reactDomUrl).toBeTruthy();
  await page.evaluate(async({base,reactUrl,reactDomUrl})=>{
    const React=(await import(reactUrl!)).default; const {createRoot}=(await import(reactDomUrl!)).default;
    const {useMeetings}=await import('/src/useMeetings.ts');
    const {useMeetingRequests}=await import('/src/MeetingAIControls.tsx');
    const {defaultMeetingPreferences}=await import('/src/meetings.ts');
    const calls:{kind:string;revision:number;text:string;name:string}[]=[];
    let current:Meeting;
    let currentPhase=-1;
    Object.assign(window,{handoffCalls:calls,__TAURI_INTERNALS__:{invoke:async(command:string,args?:{kind:string})=>{
      if(command==='meeting_models')return [{id:'gpt-6.1-sol',name:'GPT-6.1-Sol'}];
      if(command==='ai_conversation_list')return [];
      if(command==='ai_conversation_new')return {id:'fixture',messages:[]};
      if(command==='meeting_analyze') {
        calls.push({kind:args!.kind,revision:current.revision,text:current.segments[0].text,name:current.speakers['0']});
        current={...current,analyses:[...current.analyses,{id:crypto.randomUUID(),kind:args!.kind,model:'gpt-6.1-sol',question:'',revision:current.revision,createdAt:1,items:[{text:'Final summary',sources:[0]}]}]};
        return current;
      }
      return null;
    }}});
    const target=document.createElement('div');document.body.append(target);
    function Harness() {
      const c=useMeetings(false);const [phase,setPhase]=React.useState(0);
      Object.assign(window,{handoffPhase:setPhase});
      if(currentPhase!==phase) { currentPhase=phase;current={...base,transcriptionModel:'moonshine',liveTranscription:true,liveComplete:phase>=2,processing:phase===1?'transcribing':phase===2?'analyzing':'ready',notesStatus:phase===2?'processing':'idle',
        revision:phase===3?3:1,speakers:phase===3?{'0':'Final local name'}:{},segments:base.segments.map(s=>({...s,text:phase===3?'The final sentence arrived during the Moonshine drain.':s.text}))};
      }
      React.useEffect(()=>{c.setConnections({chatgpt:true,deepgram:false,email:'fixture@example.com',preferences:{...defaultMeetingPreferences,requestProvider:'chatgpt'}});},[c.setConnections]);
      const requests=useMeetingRequests(current,c,()=>{});
      return React.createElement('button',{disabled:requests.unavailable,onClick:()=>requests.prepare()},'Handoff summary');
    }
    createRoot(target).render(React.createElement(Harness));
  },{base:linkedMeeting,reactUrl,reactDomUrl});
  const summary=page.getByRole('button',{name:'Handoff summary',exact:true});
  for(const phase of [0,1,2]) {
    await page.evaluate(phase=>(window as Window&{handoffPhase:(phase:number)=>void}).handoffPhase(phase),phase);
    await expect(summary).toBeDisabled();
    expect(await page.evaluate(()=>(window as Window&{handoffCalls:unknown[]}).handoffCalls.length)).toBe(0);
  }
  await page.evaluate(()=>(window as Window&{handoffPhase:(phase:number)=>void}).handoffPhase(3));
  await expect(summary).toBeEnabled();await summary.click();
  await expect.poll(()=>page.evaluate(()=>(window as Window&{handoffCalls:unknown[]}).handoffCalls.length)).toBe(3);
  const calls=await page.evaluate(()=>(window as Window&{handoffCalls:{kind:string;revision:number;text:string;name:string}[]}).handoffCalls);
  expect(calls.map(call=>call.kind)).toEqual(['summary','actions','minutes']);
  expect(calls.every(call=>call.revision===3&&call.name==='Final local name'&&call.text==='The final sentence arrived during the Moonshine drain.')).toBe(true);
});

async function openLinked(page:Page, theme:'light' | 'dark' = 'light', meeting:Meeting = linkedMeeting) {
  const workspace:Workspace = { ...fixture,theme,notes:fixture.notes.map(note => note.id === 'meeting-note' ? { ...note,
    content:'<p>My original notes.</p><p><strong>Speaker 1:</strong> Original first statement.</p><p><strong>Personal writing between speakers.</strong></p><p><strong>Speaker 2:</strong> Original second statement.</p>',
    meeting:{role:'transcript',sessionId:linkedMeeting.id,segmentCount:2,transcriptClosed:true} } : note) };
  await page.addInitScript(({workspace,meeting}) => {
    if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'}));
    if (!localStorage.getItem('scribly-meetings-preview')) localStorage.setItem('scribly-meetings-preview',JSON.stringify([meeting]));
  }, {workspace,meeting});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(page.locator('.meeting-transcript-line')).toHaveCount(2);
  await page.getByLabel('Meetings',{exact:true}).click();
  return editor;
}

test('retired provider transcripts and summaries remain readable without cloud resume controls',async({page})=>{
  const meeting:Meeting={...linkedMeeting,transcriptionModel:'gemini-3.5-transcribe-live',liveTranscription:true,liveComplete:true,
    recovery:{kind:'summary',model:'nvidia/nemotron-3.5-lightning:free',revision:1,title:linkedMeeting.title,question:'',notes:'',checkpoints:[],splits:[]},
    analyses:[{id:'legacy-summary',kind:'summary',provider:'gemini',model:'gemini-3.8-flash',question:'',revision:1,createdAt:1,items:[{text:'Previously saved cloud summary.',sources:[0]}]}]};
  await openLinked(page,'light',meeting);
  await expect(page.locator('.meeting-transcript-line').first()).toContainText('Original first statement.');
  await panel(page).getByRole('group',{name:'Meeting view'}).getByRole('button',{name:'Summary',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Note content',exact:true})).toContainText('Previously saved cloud summary.');
  await panel(page).getByRole('button',{name:'Meeting options',exact:true}).click();
  await expect(page.getByRole('button',{name:/Continue unfinished/})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>{
    const workspace=JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document;
    return workspace.notes.find((note:{id:string})=>note.id===workspace.activeId)?.meeting?.role;
  })).toBe('summary');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('textbox',{name:'Note content',exact:true})).toContainText('Previously saved cloud summary.');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0]);
  expect(saved.transcriptionModel).toBe('gemini-3.5-transcribe-live');
  expect(saved.analyses[0].model).toBe('gemini-3.8-flash');
});

for (const theme of ['light','dark'] as const) test(`local speaker names remain editable inline and retain manual corrections in ${theme}`,async({page})=>{
  const meeting:Meeting = {...linkedMeeting,transcriptionModel:'moonshine-small',liveTranscription:true,liveComplete:true,
    speakers:{'0':'Tom'},speakerIdentityRevision:1,chatgptSpeakerRevision:1,
    speakerIdentities:[{speakerId:'0',name:'Tom',team:null,aliases:[],confidence:'strong',sources:[0],reason:'Self introduction.'}],
    speakerWarning:'Local naming could not resolve the remaining voices.'};
  await openLinked(page,theme,meeting);
  await expect(page.getByRole('status').filter({hasText:meeting.speakerWarning!})).toBeVisible();
  const rename = page.getByRole('button',{name:'Rename Tom',exact:true});
  await rename.focus(); await page.keyboard.press('Enter');
  const name = page.getByRole('textbox',{name:'Speaker name',exact:true});
  await expect(name).toBeFocused(); await expect(name).toHaveValue('Tom');
  await name.fill('Discard this'); await page.keyboard.press('Escape');
  await expect(rename).toBeFocused(); await expect(name).toHaveCount(0);
  await rename.click(); await name.fill('Thomas');
  await page.locator('.meeting-inline-name').getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Rename Thomas',exact:true})).toBeFocused();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Rename Thomas',exact:true})).toBeVisible();
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0] as Meeting);
  expect(saved.speakers['0']).toBe('Thomas'); expect(saved.speakerIdentities).toEqual([]);
  expect(saved.chatgptSpeakerRevision).toBe(1); // The edit's new revision requires another contextual review.
  expect(saved.segments).toEqual(meeting.segments.map(segment=>({...segment,corrected:false}))); expect(saved.revision).toBe(2);
});

for (const transcriptionModel of ['moonshine','deepgram'] as const) test(`local speaker naming retries without losing manual names or a meeting title draft with ${transcriptionModel}`,async({page})=>{
  test.skip(process.env.PLAYWRIGHT_PREVIEW==='1','Native naming mock requires Vite module routing');
  await page.route('**/src/MeetingPanel.tsx*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/import \{ desktop, exportArtifact \} from "([^\"]+)";/,'import { exportArtifact } from "$1"; const desktop = true;');
    await route.fulfill({response,body});
  });
  const meeting:Meeting = {...linkedMeeting,transcriptionModel,liveTranscription:transcriptionModel === 'moonshine',liveComplete:transcriptionModel === 'moonshine',speakers:{'0':'Confirmed Tom'}};
  await openLinked(page,'light',meeting);
  await page.evaluate(()=>{
    let attempts=0;
    Object.assign(window,{__TAURI_INTERNALS__:{invoke:async(command:string,args:{revision:number})=>{
      if(command==='meeting_name_speakers') {
        if(args.revision!==1)throw Error('Unexpected naming revision');
        if(!attempts++)throw Error('Ollama is unavailable. Existing names were retained.');
        const record=JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0];
        record.speakerIdentityRevision=1;
        record.speakerIdentities=[{speakerId:'1',name:'Sonia',team:null,aliases:[],confidence:'tentative',sources:[0,1],reason:'A named response needs confirmation.'}];
        localStorage.setItem('scribly-meetings-preview',JSON.stringify([record]));return record;
      }
      return null;
    }}});
  });
  await panel(page).getByRole('button',{name:'Meeting options',exact:true}).click();
  await page.getByRole('button',{name:'Rename people',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Rename people',exact:true});
  const suggest=dialog.getByRole('button',{name:'Suggest names locally',exact:true});
  await dialog.getByLabel('Speaker 1',{exact:true}).fill('Unsaved name');await expect(suggest).toBeDisabled();
  await dialog.getByLabel('Speaker 1',{exact:true}).fill('Confirmed Tom');
  await dialog.getByLabel('Meeting title',{exact:true}).fill('My title draft');
  await suggest.click(); await expect(dialog.getByRole('alert')).toContainText('Ollama is unavailable');
  await expect(dialog.getByLabel('Speaker 1',{exact:true})).toHaveValue('Confirmed Tom');
  await suggest.click();
  await expect(dialog.getByText('Suggested: Sonia',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Speaker 2',{exact:true})).toHaveValue('');
  await expect(dialog.getByLabel('Meeting title',{exact:true})).toHaveValue('My title draft');
  await dialog.getByText('Suggested: Sonia',{exact:true}).click();
  await dialog.getByRole('button',{name:'Use suggested name',exact:true}).click();
  await dialog.getByLabel('Speaker 2',{exact:true}).fill('Sonya');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Rename Sonya',exact:true})).toBeVisible();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0] as Meeting);
  expect(saved.speakers).toEqual({'0':'Confirmed Tom','1':'Sonya'});expect(saved.title).toBe('My title draft');
});

test('final speaker review warning persists through transcript edits and reload', async ({page}) => {
  const warning = 'Final speaker review failed. The live transcript was retained.';
  await openLinked(page, 'light', {...linkedMeeting, diarizationWarning:warning});
  const notice = page.locator('.meeting-reader').getByRole('status').filter({hasText:warning});
  await expect(notice).toHaveText(warning);
  await page.locator('.meeting-document').getByRole('button',{name:'Fix',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Fix transcript',exact:true});
  await dialog.getByLabel('Transcript · 0:00',{exact:true}).fill('User corrected statement.');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(notice).toHaveText(warning);
  await page.reload();
  await expect(page.locator('.meeting-transcript-line').first()).toContainText('User corrected statement.');
  await expect(notice).toHaveText(warning);
});

for (const theme of ['light','dark'] as const) test(`Moonshine recording refreshes independently of Ollama with ChatGPT notes in ${theme}`, async ({page}) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === '1','Native readiness fixture requires Vite module routing');
  for (const file of ['MeetingPanel.tsx','MeetingSettings.tsx','LocalAISettings.tsx','useMeetings.ts']) await page.route(`**/src/${file}*`,async route => {
    const response=await route.fetch();
    const body=(await response.text()).replace(/import \{ desktop(?:, exportArtifact)? \} from "([^\"]+)";/,(_match,url)=>`${file==='MeetingPanel.tsx' ? `import { exportArtifact } from "${url}";` : ''} const desktop = true;`);
    await route.fulfill({response,body});
  });
  await page.addInitScript(workspace=>{
    localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'}));
    let preferences={transcriptionModel:'moonshine',requestProvider:'chatgpt',chatgptModel:'gpt-6.1-sol',ollamaModel:'gemma4:e4b',ollamaEndpoint:'http://127.0.0.1:11434'};
    const fixture={ready:false,starts:[] as unknown[]};
    Object.assign(window,{moonshineRecordingFixture:fixture,__TAURI_INTERNALS__:{transformCallback:()=>1,invoke:async(command:string,args?:{preferences:typeof preferences})=>{
      const connections=()=>({deepgram:false,chatgpt:true,email:'fixture@example.com',preferences});
      if(command==='meeting_connections')return connections();
      if(command==='meeting_set_preferences'){preferences=args!.preferences;return connections();}
      if(command==='local_speech_status')return {runtime:true,medium:fixture.ready,small:fixture.ready,version:'0.1.5',language:'English'};
      if(command==='local_ai_status')throw Error('Ollama is not running');
      if(command==='meeting_models')return [{id:'gpt-6.1-sol',name:'GPT-6.1-Sol',reasoningEfforts:['low','medium','high']}];
      if(command==='meeting_devices')return [];
      if(command==='meeting_start'){fixture.starts.push({...args,requestProvider:preferences.requestProvider});throw Error('Recording dispatch verified; fixture does not open audio devices.');}
      if(command.startsWith('plugin:event|'))return 1;
      throw Error(`Unexpected Moonshine fixture command: ${command}`);
    }}});
  },{...fixture,theme});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('textbox',{name:'Note content',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Meetings',exact:true}).click();
  const start=panel(page).getByRole('button',{name:'Start recording',exact:true});
  await panel(page).getByLabel('I have permission to record everyone.',{exact:true}).check();
  await expect(start).toBeDisabled();
  await expect(panel(page)).toContainText('Moonshine Medium English is not ready.');
  await expect(panel(page)).toContainText('Ollama is not required for transcription.');
  await page.evaluate(()=>{(window as unknown as {moonshineRecordingFixture:{ready:boolean}}).moonshineRecordingFixture.ready=true;});
  await panel(page).getByRole('button',{name:'Open transcription settings',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
  await expect(settings.locator('.meeting-local-settings')).toContainText('Assets ready');
  await expect(settings.locator('.meeting-local-settings')).toContainText('Ollama is not running');
  const transcription=settings.getByRole('combobox',{name:'Audio transcription service',exact:true});
  await transcription.selectOption('deepgram');
  await settings.getByRole('button',{name:'Done',exact:true}).click();
  await expect(start).toBeDisabled();
  await expect(panel(page)).toContainText('Connect Deepgram in Meeting settings');
  await panel(page).getByRole('button',{name:'Open transcription settings',exact:true}).click();
  await transcription.selectOption('moonshine-small');
  await settings.getByRole('combobox',{name:'ChatGPT reasoning effort',exact:true}).selectOption('high');
  await settings.getByRole('button',{name:'Done',exact:true}).click();
  await expect(start).toBeEnabled();
  await expect(panel(page).getByRole('button',{name:'Open transcription settings',exact:true})).toHaveCount(0);
  await start.click();
  const starts=await page.evaluate(()=>(window as unknown as {moonshineRecordingFixture:{starts:unknown[]}}).moonshineRecordingFixture.starts);
  expect(starts).toEqual([expect.objectContaining({transcriptionModel:'moonshine-small',language:'en',autoNotes:true,consent:true,requestProvider:'chatgpt'})]);
});

for (const theme of ['light','dark'] as const) test(`supported meeting providers migrate preferences and preserve ChatGPT reasoning in ${theme}`, async ({page}) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === '1','Native preferences fixture requires Vite module routing');
  for (const file of ['MeetingSettings.tsx','useMeetings.ts']) await page.route(`**/src/${file}*`,async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/import \{ desktop \} from "([^\"]+)";/,'const desktop = true;');
    await route.fulfill({response,body});
  });
  await page.addInitScript(theme => {
    if(!localStorage.getItem('reasoning-test-preferences'))localStorage.setItem('reasoning-test-preferences',JSON.stringify({transcriptionModel:theme==='light'?'gemini-3.5-transcribe':'gemini-3.5-transcribe-live',requestProvider:theme==='light'?'gemini':'openrouter',chatgptModel:null,ollamaModel:'gemma4:e4b',ollamaEndpoint:'http://127.0.0.1:11434'}));
    Object.assign(window,{__TAURI_INTERNALS__:{transformCallback:()=>1,invoke:async(command:string,args?:{preferences:unknown})=> {
      const connections = () => ({deepgram:false,chatgpt:true,email:'fixture@example.com',preferences:JSON.parse(localStorage.getItem('reasoning-test-preferences') || '{"transcriptionModel":"moonshine","requestProvider":"chatgpt","chatgptModel":null,"ollamaModel":"gemma4:e4b","ollamaEndpoint":"http://127.0.0.1:11434"}')});
      if(command==='meeting_connections')return connections();
      if(command==='meeting_set_preferences'){localStorage.setItem('reasoning-test-preferences',JSON.stringify(args?.preferences));return connections();}
      if(command==='meeting_models')return [{id:'gpt-6-astra',name:'GPT-6 Astra',reasoningEfforts:['low','medium','high','xhigh','max']},{id:'gpt-5.6-sol',name:'GPT-5.6 Sol',reasoningEfforts:['none','low','medium','high','xhigh','max']},{id:'unknown-model',name:'Unverified model',reasoningEfforts:[]}];
      if(command==='local_ai_status')return {models:[],speech:{medium:false,small:false}};
      if(command==='local_speech_status')return {medium:false,small:false};
      if(command.startsWith('plugin:event|'))return 1;
      throw Error(`Unexpected fixture command: ${command}`);
    }}});
  },theme);
  await openLinked(page,theme);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const settings = page.getByRole('dialog',{name:'Settings',exact:true});
  // Meeting preferences are hosted in the existing Settings surface.
  await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
  const effort = settings.getByRole('combobox',{name:'ChatGPT reasoning effort',exact:true});
  const model = settings.getByRole('combobox',{name:'Default ChatGPT model',exact:true});
  await expect(effort).toHaveValue('auto');
  await expect(effort.locator('option[value="none"]')).toHaveCount(0);
  await effort.selectOption('high');
  await expect(effort).toHaveValue('high');
  const provider = settings.getByRole('combobox',{name:'AI service for meeting notes',exact:true});
  expect(await provider.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['ollama','chatgpt']);
  const transcription=settings.getByRole('combobox',{name:'Audio transcription service',exact:true});
  await expect(transcription).toHaveValue('moonshine');
  expect(await transcription.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['moonshine','moonshine-small','deepgram']);
  await expect(settings.getByLabel('Gemini API key',{exact:true})).toHaveCount(0);
  await expect(settings.getByLabel('OpenRouter API key',{exact:true})).toHaveCount(0);
  await expect(settings.getByText('Google Gemini',{exact:true})).toHaveCount(0);
  await expect(settings.getByText('OpenRouter',{exact:true})).toHaveCount(0);
  await provider.selectOption('ollama'); await expect(effort).toHaveCount(0);
  const saved = () => page.evaluate(()=>JSON.parse(localStorage.getItem('reasoning-test-preferences')!));
  expect((await saved()).chatgptReasoningEffort).toBe('high');
  expect((await saved()).ollamaModel).toBe('gemma4:e4b');
  await provider.selectOption('chatgpt'); await expect(effort).toHaveValue('high');
  await effort.scrollIntoViewIfNeeded();
  await model.selectOption('gpt-5.6-sol');await expect(effort).toHaveValue('high');
  await effort.selectOption('none');await expect(effort).toHaveValue('none');
  await model.selectOption('gpt-6-astra');await expect(effort).toHaveValue('auto');
  await effort.selectOption('max');
  await expect.poll(async()=>(await saved()).chatgptReasoningEffort).toBe('max');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
  await expect(effort).toHaveValue('max');
  await model.selectOption('unknown-model');await expect(effort).toHaveValue('auto');
  await expect(effort.locator('option')).toHaveCount(1);
});

for (const theme of ['light','dark'] as const) test(`transcript cleanup is reviewed before saving and retains original text in ${theme}`, async ({page}) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW==='1','Isolated local suggestion mock requires Vite module routing');
  await page.route('**/src/MeetingPanel.tsx*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/import \{ desktop, exportArtifact \} from "([^\"]+)";/,'import { exportArtifact } from "$1"; const desktop = true;');
    await route.fulfill({response,body});
  });
  await openLinked(page,theme);
  await page.evaluate(()=>{Object.assign(window,{__TAURI_INTERNALS__:{invoke:async(command:string,args:{segment:number;revision:number})=>{
    if(command==='meeting_cleanup_suggest')return {segment:args.segment,revision:args.revision,original:'Original first statement.',text:'Reviewed first statement.',reason:'Review against the recording.'};
    return null;
  }}});});
  const fix=page.locator('.meeting-document').getByRole('button',{name:'Fix',exact:true});await fix.click();
  const dialog=page.getByRole('dialog',{name:'Fix transcript',exact:true});
  await dialog.getByRole('button',{name:'Suggest cleanup',exact:true}).click();
  await expect(dialog.getByLabel('Review transcript suggestion')).toContainText('Reviewed first statement.');
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0]);
  expect((await saved()).segments[0].text).toBe('Original first statement.');
  await dialog.getByRole('button',{name:'Use suggestion',exact:true}).click();
  await expect(dialog.getByLabel('Transcript · 0:00',{exact:true})).toHaveValue('Reviewed first statement.');
  expect((await saved()).segments[0].text).toBe('Original first statement.');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(fix).toBeFocused();
  expect((await saved()).segments[0].text).toBe('Original first statement.');
  await fix.click();await dialog.getByRole('button',{name:'Suggest cleanup',exact:true}).click();await dialog.getByRole('button',{name:'Use suggestion',exact:true}).click();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('.meeting-transcript-line').first()).toContainText('Reviewed first statement.');
  const edited=await saved();expect(edited.segments[0].originalText).toBe('Original first statement.');expect(edited.segments[0].id).toBe(0);expect(edited.segments[0].start).toBe(0);expect(edited.revision).toBe(2);
  await page.reload({waitUntil:'domcontentloaded'});await fix.click();
  await dialog.getByRole('button',{name:'Restore original text',exact:true}).click();await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('.meeting-transcript-line').first()).toContainText('Original first statement.');
  expect((await saved()).segments[0].originalText).toBe('Original first statement.');
});

test('stale transcript review cannot overwrite a newer correction',async({page})=>{
  await openLinked(page);await page.locator('.meeting-document').getByRole('button',{name:'Fix',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Fix transcript',exact:true});
  await dialog.getByLabel('Transcript · 0:00',{exact:true}).fill('Stale draft.');
  await page.evaluate(()=>{const records=JSON.parse(localStorage.getItem('scribly-meetings-preview')!);records[0].revision++;records[0].segments[0].text='Newer saved correction.';localStorage.setItem('scribly-meetings-preview',JSON.stringify(records));});
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('transcript changed');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0].segments[0].text)).toBe('Newer saved correction.');
});
test('linked transcript corrections preserve personal writing, undo and reload', async ({page}) => {
  const editor = await openLinked(page);
  const transcript = page.locator('.meeting-document');
  await editor.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.type('Personal addition. ');
  await transcript.getByRole('button',{name:'Who is Speaker 1?',exact:true}).click();
  const naming=transcript.locator('.meeting-inline-name');
  await naming.getByRole('textbox').fill('Taylor');await naming.getByRole('button',{name:'Save',exact:true}).click();
  await expect(transcript).toContainText('Taylor');
  const fix=transcript.getByRole('button',{name:'Fix',exact:true});await fix.click();
  await page.getByRole('dialog').getByLabel('Transcript · 0:00').fill('Corrected first statement.');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(transcript).toContainText('Corrected first statement.');await expect(transcript).not.toContainText('Original first statement.');
  await expect(editor).toContainText('Personal addition.');await expect(editor).toContainText('My original notes.');
  await expect(editor.locator('strong').filter({hasText:'Personal writing between speakers.'})).toHaveCount(1);
  await editor.focus(); await page.keyboard.press('Control+z');await expect(editor).not.toContainText('Personal addition.');
  await expect(transcript).toContainText('Corrected first statement.');
  await page.keyboard.press('Control+End');await page.keyboard.type(' My personal rewrite.');
  await fix.click();await page.getByRole('dialog').getByRole('combobox',{name:'Transcript segment',exact:true}).selectOption('1');
  await page.getByRole('dialog').getByLabel('Transcript · 0:05').fill('Corrected second statement.');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(transcript).toContainText('Corrected second statement.');await expect(editor).toContainText('My personal rewrite.');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((n:{id:string})=>n.id==='meeting-note').content)).toContain('My personal rewrite.');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(transcript.locator('.meeting-transcript-line')).toHaveCount(2);await expect(transcript).toContainText('Corrected first statement.');await expect(transcript).toContainText('Corrected second statement.');
  await expect(editor).toContainText('My personal rewrite.');await expect(editor).toContainText('Personal writing between speakers.');
});
for (const theme of ['light','dark'] as const) test(`inferred speaker names show evidence and tentative names require review in ${theme}`, async ({page}) => {
  const meeting:Meeting = {...linkedMeeting,revision:2,speakers:{'0':'Mark (DBA)'},speakerIdentityRevision:2,
    speakerIdentities:[
      {speakerId:'0',name:'Mark',team:'DBA',aliases:['Marc'],confidence:'strong',sources:[0],reason:'Explicit self-introduction.'},
      {speakerId:'1',name:'Mark',team:'Development',aliases:[],confidence:'tentative',sources:[0,1],reason:'Named response, but the exchange is ambiguous.'},
    ]};
  const editor = await openLinked(page,theme);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note:{id:string}) => note.id === 'meeting-note').content)).toContain('data-meeting-source');
  // Identification arrives after generated transcript paragraphs acquired provenance.
  await page.evaluate(meeting => localStorage.setItem('scribly-meetings-preview',JSON.stringify([meeting])),meeting);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toContainText('Mark (DBA): Original first statement.');
  await expect(editor).toContainText('Speaker 2: Original second statement.');
  await page.setViewportSize({width:1100,height:800});
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  const review = page.getByRole('button',{name:'Review speaker names',exact:true});
  await review.click();
  const dialog = page.getByRole('dialog',{name:'Meeting details'});
  await expect(dialog.getByRole('textbox',{name:'Meeting title',exact:true})).toBeFocused();
  await dialog.getByText('AI inferred: Mark (DBA)',{exact:true}).click();
  await expect(dialog).toContainText('Spelling variants: Marc');
  await expect(dialog).toContainText('0:00 · Speaker 1: Original first statement.');
  await dialog.getByText('Suggested: Mark (Development)',{exact:true}).click();
  await expect(dialog.getByLabel('Speaker 2',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Use suggested name',exact:true}).click();
  await expect(dialog.getByLabel('Speaker 2',{exact:true})).toHaveValue('Mark (Development)');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(review).toBeFocused();
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(editor).toContainText('Mark (Development): Original second statement.');
  await expect(editor).toContainText('Personal writing between speakers.');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toContainText('Mark (DBA): Original first statement.');
  await expect(editor).toContainText('Mark (Development): Original second statement.');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0] as Meeting);
  expect(saved.speakerIdentities?.map(identity => identity.speakerId)).toEqual(['0']);
  expect(saved.revision).toBe(3);
});

test('retranscription replaces generated segments and preserves writing in inactive notes', async ({page}) => {
  const editor = await openLinked(page);
  await page.getByRole('textbox',{name:'Search notes',exact:true}).fill('Other note');
  await page.locator('.note-select').filter({hasText:'Other note'}).click();
  await expect(editor).toContainText('Reference remains available.');
  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('scribly-meetings-preview')!);
    records[0].revision++;
    records[0].segments = [
      {id:0,start:0,end:3,speaker:'1',text:'Replacement first.'},
      {id:1,start:3,end:7,speaker:'0',text:'Replacement second.'},
      {id:2,start:7,end:10,speaker:'unknown',text:'Additional third.'},
    ];
    localStorage.setItem('scribly-meetings-preview',JSON.stringify(records));
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((n:{id:string}) => n.id === 'meeting-note').content)).toContain('Additional third.');
  await page.getByRole('textbox',{name:'Search notes',exact:true}).fill('Meeting notebook');
  await page.locator('.note-select').getByText('Meeting notebook',{exact:true}).click();
  await expect(editor).toContainText('Speaker 2: Replacement first.');
  await expect(editor).toContainText('Speaker unknown: Additional third.');
  await expect(editor).not.toContainText('Original first statement.');
  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('scribly-meetings-preview')!);
    records[0].revision++; records[0].segments = [{id:0,start:0,end:10,speaker:'0',text:'Final consolidated statement.'}];
    localStorage.setItem('scribly-meetings-preview',JSON.stringify(records));
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toContainText('Speaker 1: Final consolidated statement.');
  await expect(editor).not.toContainText('Replacement second.');
  await expect(editor).not.toContainText('Additional third.');
  await expect(editor).toContainText('My original notes.');
  await expect(editor).toContainText('Personal writing between speakers.');
  await expect(editor.locator('p[data-meeting-source]')).toHaveCount(1);
});
test('model refresh exposes newly eligible account models and preserves selection', async ({page}) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === '1','Isolated native catalog mock requires Vite module routing');
  for (const file of ['MeetingPanel.tsx','MeetingAIControls.tsx','MeetingSettings.tsx','useMeetings.ts']) await page.route(`**/src/${file}*`,async route => {
    const response = await route.fetch(); const body = await response.text();
    const storageImport = /import \{ desktop(?:, exportArtifact)? \} from "(\/src\/storage\.ts(?:\?[^\"]*)?)";/;
    expect(storageImport.test(body)).toBe(true);
    await route.fulfill({response,body:body.replace(storageImport,(_match,url) => `${file === 'MeetingPanel.tsx' ? `import { exportArtifact } from "${url}";` : ''} const desktop = true;`)});
  });
  await page.addInitScript(meeting => {
    const calls:{command:string; model?:string;kind?:string;question?:string}[] = [];
    const catalog = {hasSol:false,renameNext:false};
    Object.assign(window, { __TAURI_INTERNALS__:{
      transformCallback:() => 1,
      invoke:async (command:string,args?:{model?:string;kind?:string;question?:string;preferences?:{transcriptionModel:string;requestProvider:string;chatgptModel:string|null}}) => {
        calls.push({command,model:args?.model,kind:args?.kind,question:args?.question});
        const connections = () => ({deepgram:false,chatgpt:true,email:'test@example.com',preferences:JSON.parse(localStorage.getItem('meeting-test-preferences') || '{"transcriptionModel":"deepgram","requestProvider":"chatgpt","chatgptModel":null}')});
        if (command === 'meeting_connections') return connections();
        if (command === 'meeting_set_preferences') { localStorage.setItem('meeting-test-preferences',JSON.stringify(args?.preferences)); return connections(); }
        if (command === 'meeting_devices') return [];
        if (command.startsWith('plugin:event|')) return 1;
        if (command === 'meeting_models') {
          return !catalog.hasSol ? [{id:'gpt-6-astra',name:'GPT-6-Astra'}] : [{id:'gpt-6-astra',name:'GPT-6-Astra'},{id:'gpt-6.1-sol',name:'GPT-6.1-Sol'}];
        }
        if (command === 'meeting_analyze') {
          const records = JSON.parse(localStorage.getItem('scribly-meetings-preview')!);
          const record = records.find((item:{id:string}) => item.id === meeting.id);
          if (catalog.renameNext) { record.revision++; record.speakers['0'] = 'Mark'; catalog.renameNext = false; }
          record.analyses.push({id:crypto.randomUUID(),kind:args?.kind,model:args?.model,question:args?.question || '',revision:record.revision,createdAt:Date.now(),items:[{text:'Generated study evidence.',sources:[0]}]});
          localStorage.setItem('scribly-meetings-preview',JSON.stringify(records)); return record;
        }
        throw Error(`Unexpected meeting command ${command}`);
      },
    }, meetingCatalogCalls:calls, meetingCatalogState:catalog });
  }, linkedMeeting);
  await page.addInitScript(meeting => {
    if (!localStorage.getItem('scribly-meetings-preview')) localStorage.setItem('scribly-meetings-preview',JSON.stringify([{...meeting,analyses:[{id:'existing-summary',kind:'summary',model:'Test',question:'',revision:1,createdAt:1,items:[{text:'Already prepared summary.',sources:[0]}]}]}]));
  },linkedMeeting);
  await openLinked(page);
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  const controls = page.locator('.meeting-ai-controls');
  await controls.locator('.meeting-generation-settings > summary').click();
  const models = controls.getByRole('combobox',{name:'ChatGPT model',exact:true});
  await expect(models).toHaveValue('gpt-6-astra');
  await expect(models.locator('option:checked')).toHaveText('GPT-6-Astra (Default)');
  await expect(controls).toContainText('Reasoning: Low.');
  expect(await page.evaluate(() => (window as Window & {meetingCatalogCalls:{command:string}[]}).meetingCatalogCalls.filter(call => call.command === 'meeting_analyze').length)).toBe(0);
  await expect(controls.getByRole('combobox',{name:'Create',exact:true})).toHaveCount(0);
  await expect(controls.getByRole('group',{name:'Study and question tools'}).getByRole('button')).toHaveCount(4);
  await expect(controls).toContainText('GPT-6.1-Sol is not in this account');
  await page.evaluate(() => { (window as Window & {meetingCatalogState:{hasSol:boolean}}).meetingCatalogState.hasSol = true; });
  await controls.getByRole('button',{name:'Refresh models',exact:true}).click();
  await expect(models.locator('option[value="gpt-6.1-sol"]')).toHaveText('GPT-6.1-Sol');
  await models.selectOption('gpt-6.1-sol');
  await controls.getByRole('button',{name:'Refresh models',exact:true}).click();
  await expect(models).toHaveValue('gpt-6.1-sol');
  await controls.getByRole('button',{name:'Study notes',exact:true}).click();
  await controls.getByRole('button',{name:'Generate study notes',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as Window & {meetingCatalogCalls:{command:string;model?:string}[]}).meetingCatalogCalls.find(call => call.command === 'meeting_analyze')?.model)).toBe('gpt-6.1-sol');
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor).toContainText('Study notes'); await expect(editor).toContainText('Generated study evidence.');
  await expect(panel(page)).not.toContainText('Generated study evidence.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note:{meeting?:{role:string}}) => note.meeting?.role === 'summary').meeting.analysisIds.length)).toBe(2);
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(editor).not.toContainText('Generated study evidence.');
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await expect(editor).toContainText('Generated study evidence.');
  await page.reload({waitUntil:'domcontentloaded'}); await expect(editor).toContainText('Generated study evidence.');
  await expect(editor.locator('h2').filter({hasText:'Study notes'})).toHaveCount(1);
  // A partially prepared recap retries only missing sections, never optional outputs.
  await controls.getByRole('button',{name:'Complete meeting recap',exact:true}).click();
  await expect(controls.getByRole('list',{name:'Meeting recap sections'}).locator('[data-ready=true]')).toHaveCount(3);
  await expect(controls.getByRole('button',{name:'Complete meeting recap',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & {meetingCatalogCalls:{command:string;kind?:string}[]}).meetingCatalogCalls.filter(call => call.command === 'meeting_analyze').map(call => call.kind))).toEqual(['minutes','actions']);
  await expect(editor.locator('h2').filter({hasText:'Study notes'})).toHaveCount(1);
  await controls.getByRole('button',{name:'Ask a question',exact:true}).click();
  const input = controls.getByRole('textbox',{name:'Question',exact:true});
  await expect(input).toBeFocused();
  await expect(controls.getByRole('button',{name:'Get answer',exact:true})).toBeDisabled();
  await input.fill('What was decided?');
  await controls.getByRole('button',{name:'Get answer',exact:true}).click();
  await expect(editor).toContainText('What was decided?');
  expect(await page.evaluate(() => (window as Window & {meetingCatalogCalls:{command:string;kind?:string}[]}).meetingCatalogCalls.filter(call => call.command === 'meeting_analyze').map(call => call.kind))).toEqual(['minutes','actions','question']);
  // If name resolution changes revision during recovery, revisit sections made outdated.
  await page.evaluate(() => {
    const records:Meeting[] = JSON.parse(localStorage.getItem('scribly-meetings-preview')!);
    const record = records[0]; record.revision++;
    record.analyses.filter(result => result.kind === 'summary' || result.kind === 'minutes').forEach(result => { result.revision = record.revision; });
    localStorage.setItem('scribly-meetings-preview',JSON.stringify(records));
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.evaluate(() => { (window as Window & {meetingCatalogState:{renameNext:boolean}}).meetingCatalogState.renameNext = true; });
  await controls.getByRole('button',{name:'Complete meeting recap',exact:true}).click();
  await expect(controls.getByRole('list',{name:'Meeting recap sections'}).locator('[data-ready=true]')).toHaveCount(3);
  expect(await page.evaluate(() => (window as Window & {meetingCatalogCalls:{command:string;kind?:string}[]}).meetingCatalogCalls.filter(call => call.command === 'meeting_analyze').map(call => call.kind))).toEqual(['actions','summary','minutes']);
  // Compare providers explicitly; retain earlier results and persist the chosen pair.
  await controls.locator('.meeting-generation-settings > summary').click();

});
for (const theme of ['notebook','dark'] as const) test(`folder meeting creates durable transcript and separate summary in ${theme}`, async ({ page }) => {
  const workspace:Workspace = { ...fixture,theme,folders:[{id:'intro',name:'Introduction',copyLastNote:true}],notes:fixture.notes.map(note => ({...note,folderId:'intro'})) };
  await page.addInitScript(workspace => { if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'})); }, workspace);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Options for Introduction',exact:true}).click();
  await page.getByRole('button',{name:'Start meeting',exact:true}).click();
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor).toHaveText('');
  await expect(page.locator('.document-head')).toContainText('Introduction ·');
  await expect(page.locator('.document-head')).toContainText('· Meeting');
  await expect(panel(page)).toBeVisible();
  await editor.fill('My own meeting notes.');
  await panel(page).getByRole('button',{name:'Load sample meeting'}).click();
  await expect(editor).toContainText('My own meeting notes.');
  await expect(editor).toContainText('Alex:');
  await expect(editor).toContainText('Sam:');
  const document = () => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document as Workspace);
  await expect.poll(async () => (await document()).notes.filter(note => note.meeting?.role === 'summary').length).toBe(1);
  const source = (await document()).notes.find(note => note.meeting?.role === 'transcript')!;
  expect(source.folderId).toBe('intro'); expect(source.meeting?.segmentCount).toBe(3);
  await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Personal follow-up.'); await page.keyboard.press('Control+z');
  await expect(editor).toContainText('ship the first version on Friday');
  await page.getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await expect(editor).toContainText('Summary'); await expect(editor).toContainText('Meeting minutes'); await expect(editor).toContainText('Action items');
  await expect.poll(async () => (await document()).notes.find(note => note.meeting?.role === 'summary')?.meeting?.analysisIds?.length).toBe(3);
  const summary = (await document()).notes.find(note => note.meeting?.role === 'summary')!;
  expect(summary.folderId).toBe('intro'); expect(summary.title).toBe(`${source.title} Summary`);
  await page.setViewportSize({width:1100,height:800});
  await page.emulateMedia({reducedMotion:'reduce'});
  const tools = page.getByRole('group',{name:'Study and question tools'});
  await expect(tools.getByRole('button')).toHaveCount(4);
  await expect(page.locator('.meeting-study-form')).toHaveCount(0);
  await tools.getByRole('button',{name:'Ask a question',exact:true}).click();
  await expect(page.locator('.meeting-study-form').getByRole('textbox',{name:'Question',exact:true})).toBeFocused();
  await expect(page.locator('.meeting-study-form').getByRole('button',{name:'Get answer',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.meeting-study-form')).toHaveCount(0);
  await expect(tools.getByRole('button',{name:'Ask a question',exact:true})).toBeFocused();
  expect(await page.locator('.meeting-ai-controls').evaluate(el => {
    const parent = el.closest('.document-scroll')!;
    const bounds = parent.getBoundingClientRect(); const form = el.getBoundingClientRect();
    return el.scrollWidth <= el.clientWidth + 1 && form.left >= bounds.left && form.right <= bounds.right;
  })).toBe(true);
  await page.setViewportSize({width:1440,height:920});
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toContainText('Meeting minutes');
  expect((await document()).notes.filter(note => note.meeting?.role === 'summary')).toHaveLength(1);
  await page.getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(editor).toContainText('My own meeting notes.');
  await expect(editor.locator('p').filter({hasText:'For the launch'})).toHaveCount(1);
  await expect(page.locator('.note-select [aria-label="Meeting transcript"]')).toHaveCount(1);
  await expect(page.locator('.note-select [aria-label="Meeting summary"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Meeting controls',exact:true}).click();
  await page.getByRole('button',{name:'Options for Introduction',exact:true}).click();
  await page.getByRole('button',{name:'Start meeting',exact:true}).click();
  await expect(editor).toHaveText('');
  await expect(panel(page).getByLabel('Recording title',{exact:true})).toBeVisible();
  await panel(page).getByRole('button',{name:'Meeting AI settings'}).click();
  await expect(page.getByRole('tab',{name:'Meeting AI'})).toHaveAttribute('aria-selected','true');
});
for (const theme of ['light', 'dark'] as const) test(`meeting results stay in a separate editable note and preserve panels in ${theme}`, async ({ page }) => {
  await open(page, theme);
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await expect(editor).toContainText('Alex:');
  await expect(editor).not.toContainText('Target Friday');
  await expect(panel(page).getByRole('button', {name:'AI notes',exact:true})).toHaveCount(0);
  await expect(panel(page).locator('.meeting-transcript, .meeting-results')).toHaveCount(0);
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await expect(editor).toContainText('Target Friday');
  await expect(editor).toContainText('Action items');
  await expect(panel(page)).not.toContainText('Target Friday');
  await expect(panel(page).getByRole('combobox',{name:'ChatGPT model',exact:true})).toHaveCount(0);
  await page.locator('.meeting-generation-settings > summary').click();
  await expect(page.locator('.meeting-ai-controls').getByRole('combobox',{name:'ChatGPT model',exact:true})).toBeVisible();
  await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Personal review.');
  await page.keyboard.press('Control+z'); await expect(editor).not.toContainText('Personal review.');
  await expect(editor).toContainText('Target Friday');
  await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Saved review.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note:{meeting?:{role:string}}) => note.meeting?.role === 'summary').content)).toContain('Saved review.');
  await page.reload({waitUntil:'domcontentloaded'}); await expect(editor).toContainText('Saved review.');
  await page.getByRole('button',{name:'Meeting controls',exact:true}).click();
  await page.getByRole('button', { name: 'Close meetings', exact: true }).click();
  await expect(page.getByLabel('Meetings', { exact: true })).toBeFocused();
  await page.getByLabel('Meetings', { exact: true }).click();
  await page.locator('.reference-modes').getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(page.locator('.reference-editor')).toContainText('Reference remains available.');
  await expect(editor).toContainText('Target Friday');
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(editor).not.toContainText('Target Friday');
  await page.getByRole('textbox',{name:'Search notes',exact:true}).fill('Meeting notebook');
  await page.locator('.note-select').getByText('Meeting notebook',{exact:true}).click();
  await expect(editor).toHaveText('My original notes.');
});
test('speaker and transcript edits persist, invalidate AI notes, and restore modal focus', async ({ page }) => {
  await open(page);
  const transcript=page.locator('.meeting-document');
  await panel(page).getByRole('button',{name:'Meeting options',exact:true}).click();await page.getByRole('button',{name:'Rename people',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Rename people'});
  await dialog.getByLabel('Speaker 1',{exact:true}).fill('Taylor');await dialog.getByRole('button',{name:'Save changes'}).click();
  await expect(transcript).toContainText('Taylor');
  const fix=transcript.getByRole('button',{name:'Fix',exact:true});await fix.click();
  await page.getByRole('dialog').getByLabel('Transcript · 0:00').fill('Corrected meeting evidence.');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(transcript).toContainText('Corrected meeting evidence.');await expect(fix).toBeFocused();
  await panel(page).getByRole('group',{name:'Meeting view'}).getByRole('button',{name:'Summary',exact:true}).click();
  await expect(transcript).toContainText('The transcript has changed.');await expect(page.getByRole('textbox',{name:'Note content',exact:true})).toContainText('Target Friday');
  await panel(page).getByRole('group',{name:'Meeting view'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});await expect(transcript).toContainText('Corrected meeting evidence.');await expect(transcript).toContainText('Taylor');
});
test('meeting export and confirmed deletion leave transcript and summary notes intact', async ({ page }) => {
  await open(page);
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await panel(page).getByText('Export and backup', { exact: true }).click();
  const download = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'Export transcript & AI notes' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await panel(page).getByRole('button', { name: 'Delete meeting…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel(page)).toContainText('Sample · Launch planning');
  await panel(page).getByRole('button', { name: 'Delete meeting…', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(panel(page).getByLabel('Saved meetings')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('Target Friday');
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('Alex:');
  await panel(page).getByRole('button', { name: 'Meeting AI settings' }).click();
  await expect(page.getByRole('tab', { name: 'Meeting AI' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Sign in with ChatGPT', exact: true })).toBeDisabled();
});
test('generated text is saved literally without creating executable HTML', async ({ page }) => {
  await openLinked(page);
  const payload = '<img src=x onerror="window.meetingInjected=true"> & <script>bad()</script>';
  await page.evaluate(payload => {
    const records = JSON.parse(localStorage.getItem('scribly-meetings-preview')!);
    records[0].analyses.push({id:crypto.randomUUID(),kind:'study',model:'Test',question:'',revision:1,createdAt:Date.now(),items:[{text:payload,sources:[0]}]});
    localStorage.setItem('scribly-meetings-preview', JSON.stringify(records));
  }, payload);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('Meetings',{exact:true}).click();
  await panel(page).getByRole('button',{name:'Meeting options',exact:true}).click();
  await page.getByRole('button',{name:'Earlier versions',exact:true}).click();
  await page.getByRole('dialog',{name:'Earlier versions'}).getByRole('button',{name:'Study notes',exact:false}).click();
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await expect(editor).toContainText(payload);
  // Citation atoms use ProseMirror's own empty cursor separator image.
  await expect(editor.locator('img:not(.ProseMirror-separator),script,[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => 'meetingInjected' in window)).toBe(false);
});
test('damaged meeting storage cannot block notebook editing or destroy its data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('scribly-meetings-preview', '[null]'));
  await page.addInitScript(workspace => localStorage.setItem('still-notes-browser-v1', JSON.stringify({ revision: 1, document: workspace, dataPath: 'Test' })), fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill('Writing survives damaged meeting data.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes[0].content)).toContain('Writing survives');
  await page.getByLabel('Meetings', { exact: true }).click();
  await expect(panel(page)).toContainText('Preview meeting storage is damaged.');
  expect(await page.evaluate(() => localStorage.getItem('scribly-meetings-preview'))).toBe('[null]');
});


test('legacy AI sections move to summary once while edited sections and personal writing survive', async ({page}) => {
  const meeting:Meeting = {...linkedMeeting,analyses:[
    {id:'legacy-summary',kind:'summary',model:'Test',question:'',revision:1,createdAt:1,items:[{text:'Canonical summary.',sources:[0]}]},
    {id:'legacy-study',kind:'study',model:'Test',question:'',revision:1,createdAt:1,items:[{text:'Original study result.',sources:[1]}]},
  ]};
  const workspace:Workspace = {...fixture,notes:fixture.notes.map(note => note.id === 'meeting-note' ? {...note,meeting:{role:'transcript',sessionId:meeting.id,segmentCount:0},content:'<p>Personal writing.</p><h2>Meeting notebook · Summary</h2><ul><li><p>Canonical summary.</p><p>Source: Speaker 0 0:00</p></li></ul><h2>Meeting notebook · Study notes</h2><ul><li><p>My edited study result.</p><p>Source: Speaker 1 0:05</p></li></ul>'} : note)};
  await page.addInitScript(({workspace,meeting}) => {
    if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'}));
    if (!localStorage.getItem('scribly-meetings-preview')) localStorage.setItem('scribly-meetings-preview',JSON.stringify([meeting]));
  },{workspace,meeting});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor).toContainText('Personal writing.'); await expect(editor).toContainText('My edited study result.');
  await expect(editor).not.toContainText('Canonical summary.');
  await page.getByRole('button',{name:'Meetings',exact:true}).click();
  await panel(page).getByRole('button',{name:'Summary',exact:true}).click();
  await expect(editor).toContainText('Canonical summary.');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('scribly-meetings-preview')!)[0].analyses.find((analysis:{kind:string})=>analysis.kind==='study').items[0].text)).toBe('Original study result.');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor.locator('h2').filter({hasText:'Summary'})).toHaveCount(1);
  await expect(editor.locator('h2').filter({hasText:'Study notes'})).toHaveCount(0);
  if (!await panel(page).isVisible()) await page.getByRole('button',{name:'Meetings',exact:true}).click();
  await panel(page).getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(editor).toContainText('Personal writing.'); await expect(editor).toContainText('My edited study result.');
  await expect(editor).not.toContainText('Canonical summary.');
});

test('opening an older saved meeting creates linked documents without changing its original note', async ({page}) => {
  await page.addInitScript(({workspace,meeting}) => {
    if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'}));
    if (!localStorage.getItem('scribly-meetings-preview')) localStorage.setItem('scribly-meetings-preview',JSON.stringify([meeting]));
  },{workspace:fixture,meeting:linkedMeeting});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor).toHaveText('My original notes.');
  await page.getByLabel('Meetings',{exact:true}).click();
  await panel(page).getByRole('combobox',{name:'Saved meetings',exact:true}).selectOption(linkedMeeting.id);
  await expect(editor).toContainText('Original first statement.');
  await expect(editor).not.toContainText('My original notes.');
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await expect(page.locator('.meeting-ai-controls')).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await expect(editor.locator('p[data-meeting-source]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.filter((note:{meeting?:unknown}) => note.meeting).length)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-browser-v1')!).document.notes.find((note:{id:string}) => note.id === 'meeting-note').content)).toBe('<p>My original notes.</p>');
});

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
async function openLinked(page:Page, theme:'light' | 'dark' = 'light') {
  const workspace:Workspace = { ...fixture,theme,notes:fixture.notes.map(note => note.id === 'meeting-note' ? { ...note,
    content:'<p>My original notes.</p><p><strong>Speaker 1:</strong> Original first statement.</p><p><strong>Personal writing between speakers.</strong></p><p><strong>Speaker 2:</strong> Original second statement.</p>',
    meeting:{role:'transcript',sessionId:linkedMeeting.id,segmentCount:2,transcriptClosed:true} } : note) };
  await page.addInitScript(({workspace,meeting}) => {
    if (!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,document:workspace,dataPath:'Test'}));
    if (!localStorage.getItem('scribly-meetings-preview')) localStorage.setItem('scribly-meetings-preview',JSON.stringify([meeting]));
  }, {workspace,meeting:linkedMeeting});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor.locator('p[data-meeting-source]')).toHaveCount(2);
  await page.getByLabel('Meetings',{exact:true}).click();
  return editor;
}
test('linked transcript corrections preserve personal writing, undo and reload', async ({page}) => {
  const editor = await openLinked(page);
  await expect(editor.locator('p[data-meeting-source] strong').first()).toHaveText('Speaker 1:');
  await expect(panel(page).locator('.meeting-transcript')).toHaveCount(0);
  await editor.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.type('Personal addition. ');
  await panel(page).getByRole('button',{name:'Edit meeting details and speakers'}).click();
  await page.getByRole('dialog').getByLabel('Speaker 1',{exact:true}).fill('Taylor');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(editor).toContainText('Taylor: Original first statement.');
  await expect(editor).toContainText('Personal addition. My original notes.');
  await page.getByRole('button',{name:'Review transcript',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Transcript · 0:00').fill('Corrected first statement.');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(editor).toContainText('Taylor: Corrected first statement.');
  await expect(editor).not.toContainText('Original first statement.');
  await expect(editor.locator('strong').filter({hasText:'Personal writing between speakers.'})).toHaveCount(1);
  await editor.focus(); await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('Personal addition.');
  await expect(editor).toContainText('Taylor: Corrected first statement.');
  // Editing a generated paragraph makes its text personal; a provider correction keeps both.
  await editor.locator('p[data-meeting-source]').last().fill('My personal rewrite.');
  await page.getByRole('button',{name:'Review transcript',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'Transcript segment',exact:true}).selectOption('1');
  await page.getByRole('dialog').getByLabel('Transcript · 0:05').fill('Corrected second statement.');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes'}).click();
  await expect(editor).toContainText('My personal rewrite.');
  await expect(editor).toContainText('Speaker 2: Corrected second statement.');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor.locator('p[data-meeting-source]')).toHaveCount(2);
  await expect(editor.locator('p').filter({hasText:'My personal rewrite.'})).toHaveCount(1);
  await expect(editor.locator('p').filter({hasText:'Corrected second statement.'})).toHaveCount(1);
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
        const connections = () => ({deepgram:false,chatgpt:true,gemini:true,email:'test@example.com',preferences:JSON.parse(localStorage.getItem('meeting-test-preferences') || '{"transcriptionModel":"deepgram","requestProvider":"chatgpt","chatgptModel":null}')});
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
  await controls.getByRole('combobox',{name:'Request handling model',exact:true}).selectOption('gemini');
  await expect(controls.getByRole('combobox',{name:'ChatGPT model',exact:true})).toHaveCount(0);
  await controls.getByRole('button',{name:'Regenerate meeting recap',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as Window & {meetingCatalogCalls:{command:string;model?:string}[]}).meetingCatalogCalls.filter(call => call.command === 'meeting_analyze' && call.model === 'gemini-3.8-flash').length)).toBe(3);
  await controls.getByRole('button',{name:'Flashcards',exact:true}).click();
  await controls.getByRole('button',{name:'Generate flashcards',exact:true}).click();
  await expect(editor).toContainText('Flashcards');
  await expect(editor.locator('h2').filter({hasText:/^Summary$/})).toHaveCount(3);
  await expect(editor).toContainText('gemini-3.8-flash');
  await page.getByRole('button',{name:'Meeting controls',exact:true}).click();
  await panel(page).getByRole('button',{name:'Meeting AI settings'}).click();
  const settings = page.getByRole('dialog',{name:'Settings',exact:true});
  await expect(settings.getByLabel('Gemini API key',{exact:true})).toHaveAttribute('type','password');
  await settings.getByRole('combobox',{name:'Transcription model',exact:true}).selectOption('gemini-3.5-transcribe-live');
  await expect(settings).toContainText('Speakers stay unknown');
  await settings.getByRole('combobox',{name:'Transcription model',exact:true}).selectOption('gemini-3.5-transcribe');
  await expect(settings).toContainText('Up to 30 minutes');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toContainText('gemini-3.8-flash');
  await controls.locator('.meeting-generation-settings > summary').click();
  await expect(controls.getByRole('combobox',{name:'Request handling model',exact:true})).toHaveValue('gemini');
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
  const editor = page.getByRole('textbox',{name:'Note content',exact:true});
  const trigger = panel(page).getByRole('button', { name: 'Edit meeting details and speakers' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Meeting details' });
  await dialog.getByLabel('Speaker 1', { exact: true }).fill('Taylor');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await expect(editor).toContainText('Taylor:');
  const review = page.getByRole('button',{name:'Review transcript',exact:true});
  await review.click();
  await page.getByRole('dialog').getByLabel('Transcript · 0:00').fill('Corrected meeting evidence.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toContainText('Corrected meeting evidence.'); await expect(review).toBeFocused();
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await expect(page.locator('.meeting-note-context')).toContainText('Transcript or names changed');
  await expect(editor).toContainText('Target Friday');
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toContainText('Corrected meeting evidence.'); await expect(editor).toContainText('Taylor:');
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
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
  await expect(editor).toContainText(payload);
  await expect(editor.locator('img,script')).toHaveCount(0);
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
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Summary & AI notes',exact:true}).click();
  await expect(editor).toContainText('Canonical summary.'); await expect(editor).toContainText('Original study result.');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor.locator('h2').filter({hasText:'Summary'})).toHaveCount(1);
  await expect(editor.locator('h2').filter({hasText:'Study notes'})).toHaveCount(1);
  await page.getByRole('group',{name:'Meeting documents'}).getByRole('button',{name:'Transcript',exact:true}).click();
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

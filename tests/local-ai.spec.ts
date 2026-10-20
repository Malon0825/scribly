import {test,expect} from '@playwright/test';

for (const theme of ['notebook','light','dark'] as const) test(`writing help preference persists without replacing the editor in ${theme}`,async({page})=>{
  test.skip(process.env.PLAYWRIGHT_PREVIEW==='1','Writing assistance fixture requires Vite module routing');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/src/WritingAssist.tsx*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/import \{ desktop \} from "[^\"]+";/,'const desktop = true;');
    await route.fulfill({response,body});
  });
  await page.addInitScript(theme=>{
    if(!localStorage.getItem('still-notes-browser-v1')) localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,dataPath:'Test',document:{schemaVersion:5,theme,activeId:'test-note',referenceId:null,folders:[],notes:[{id:'test-note',title:'Test note',folderId:null,content:'<p>Follow up DBA for RMS OGG deployment progress</p>',archived:false,createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'}]}}));
    const conversation={version:1,id:'writing-test',scope:'note',parentId:'test-note',createdAt:1,messages:[] as {id:string;role:string;text:string;status:string;createdAt:number}[]};
    Object.assign(window,{__TAURI_INTERNALS__:{transformCallback:()=>1,invoke:async(command:string,args?:{prompt:string;revision:number})=>{
      if(command==='ai_conversation_list')return conversation.messages.length ? [conversation] : [];
      if(command==='ai_conversation_new')return conversation;
      if(command==='ai_writing_request'){
        const text='Follow up with the DBA on the progress of the RMS OGG deployment.';
        conversation.messages.push({id:'user',role:'user',text:args!.prompt,status:'completed',createdAt:1},{id:'assistant',role:'assistant',text,status:'completed',createdAt:2});
        return {text,revision:args!.revision};
      }
      if(command.startsWith('plugin:event|'))return 1;
      throw Error(`Unexpected writing fixture command: ${command}`);
    }}});
  },theme);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor=page.getByRole('textbox',{name:'Note content',exact:true});
  await expect(editor).toBeVisible();
  await editor.evaluate(element=>element.setAttribute('data-editor-instance','preserved'));
  const original=await editor.textContent();
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  const openSettings=async()=>{
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
  };
  await openSettings();
  const toggle=settings.getByRole('switch',{name:'Local writing help',exact:true});
  await expect(toggle).toHaveAttribute('aria-checked','true');
  await expect(settings.getByLabel('Gemini API key',{exact:true})).toHaveCount(0);
  await expect(settings.getByRole('button',{name:'Test local text',exact:true})).toBeHidden();
  await settings.screenshot({path:`test-results/writing-settings-${theme}.png`});
  await toggle.focus();await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked','false');
  await settings.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Writing help',exact:true})).toHaveCount(0);
  await expect(editor).toHaveAttribute('data-editor-instance','preserved');
  await expect(editor).toHaveText(original!);
  await editor.fill('The draft stays editable while Writing help is off.');await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(async()=>{const {loadWorkspace}=await import('/src/storage.ts');return (await loadWorkspace()).document?.notes.some(note=>note.content.includes('The draft stays editable while Writing help is off.'));})).toBe(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(editor).toHaveText('The draft stays editable while Writing help is off.');
  await expect(page.getByRole('button',{name:'Writing help',exact:true})).toHaveCount(0);
  await openSettings();await expect(toggle).toHaveAttribute('aria-checked','false');
  await settings.getByText('Local writing help',{exact:true}).click();await expect(toggle).toHaveAttribute('aria-checked','true');
  await page.setViewportSize({width:850,height:600});
  await settings.getByRole('heading',{name:'Connected accounts',exact:true}).scrollIntoViewIfNeeded();
  await expect.poll(()=>settings.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await settings.screenshot({path:`test-results/writing-settings-${theme}-compact.png`});
  await settings.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Writing help',exact:true})).toBeEnabled();
  await editor.fill(original!);await editor.press('Control+a');
  await expect.poll(()=>page.evaluate(()=>window.getSelection()?.toString())).toBe(original);
  await page.getByRole('button',{name:'Writing help',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Local writing help',exact:true});
  await expect(review).toBeVisible();
  await review.getByRole('button',{name:'Generate suggestion',exact:true}).click();
  await expect(review.getByRole('button',{name:'Accept rewrite',exact:true})).toBeEnabled();
  await review.getByRole('button',{name:'Accept rewrite',exact:true}).click();
  await expect(editor).toHaveText('Follow up with the DBA on the progress of the RMS OGG deployment.');
  await editor.press('Control+z');await expect(editor).toHaveText(original!);
});

test('local model picker discovers Spark on opening and retains the selected model',async({page})=>{
  test.skip(process.env.PLAYWRIGHT_PREVIEW==='1','Local catalog mock requires Vite module routing');
  await page.route('**/src/LocalAISettings.tsx*',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/import \{ desktop \} from "[^\"]+";/,'const desktop = true;');
    await route.fulfill({response,body});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('textbox',{name:'Note content',exact:true})).toBeVisible();
  await page.evaluate(()=>Object.assign(window,{__TAURI_INTERNALS__:{invoke:async(command:string)=>{
    const speech={runtime:true,version:'0.1.5',medium:true,small:true};
    if(command==='local_speech_status')return speech;
    if(command==='local_ai_status')return {speech,availableBytes:12e9,models:[
      {id:'gemma4:e4b',name:'gemma4:e4b',digest:'gemma',quantization:'Q4_K_M'},
      {id:'SparkLLM/Spark-X2.5-4B:latest',name:'SparkLLM/Spark-X2.5-4B:latest',digest:'spark',quantization:'BF16'},
    ]};
    return null;
  }}}));
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
  const picker=page.getByRole('combobox',{name:'Local text model',exact:true});
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue('gemma4:e4b');
  await expect(picker.locator('option[value="SparkLLM/Spark-X2.5-4B:latest"]')).toHaveText('SparkLLM/Spark-X2.5-4B:latest · BF16');
  await picker.selectOption('SparkLLM/Spark-X2.5-4B:latest');
  await page.locator('summary').filter({hasText:'Local service & diagnostics'}).click();
  await page.getByRole('button',{name:'Check local services',exact:true}).click();
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue('SparkLLM/Spark-X2.5-4B:latest');
});

for(const theme of ['light','dark'] as const) test(`one-click Gemma setup reports progress, resumes after closing and preserves ChatGPT in ${theme}`,async({page})=>{
  test.skip(process.env.PLAYWRIGHT_PREVIEW==='1','Native setup fixture requires Vite module routing');
  for(const file of ['LocalAISettings.tsx','GemmaSetup.tsx','useMeetings.ts']) await page.route(`**/src/${file}*`,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace(/import \{ desktop \} from "[^\"]+";/,'const desktop = true;')});
  });
  await page.addInitScript(theme=>{
    if(!localStorage.getItem('still-notes-browser-v1'))localStorage.setItem('still-notes-browser-v1',JSON.stringify({revision:1,dataPath:'Test',document:{schemaVersion:5,theme,activeId:'test-note',referenceId:null,folders:[],notes:[{id:'test-note',title:'Test note',folderId:null,content:'<p>My writing stays intact.</p>',archived:false,createdAt:'2026-10-20T00:00:00Z',updatedAt:'2026-10-20T00:00:00Z'}]}}));
    let preferences=JSON.parse(localStorage.getItem('setup-preferences') || '{"transcriptionModel":"moonshine","requestProvider":"chatgpt","chatgptModel":null,"ollamaModel":"SparkLLM/Spark-X2.5-4B:latest","ollamaEndpoint":"http://127.0.0.1:11434"}');
    let ready=!!localStorage.getItem('setup-ready');
    let progress={running:false,message:'',completed:null as number|null,total:null as number|null};
    let nextCallback=0;
    const callbacks=new Map<number,(event:unknown)=>void>();
    const events=new Map<number,string>();
    let finish:(value:unknown)=>void=()=>{};
    let fail:(reason:string)=>void=()=>{};
    const emit=()=>events.forEach((event,id)=>{if(event==='local-model-setup')callbacks.get(id)?.({event,id,payload:progress});});
    const connections=()=>({chatgpt:true,deepgram:false,email:'fixture@example.com',preferences});
    const fixture={complete:()=>{
      ready=true;preferences={...preferences,ollamaModel:'gemma4:e4b'};
      localStorage.setItem('setup-ready','true');localStorage.setItem('setup-preferences',JSON.stringify(preferences));
      progress={running:false,message:'Gemma 4 is ready.',completed:null,total:null};emit();finish({connections:connections()});
    }};
    Object.assign(window,{gemmaSetupFixture:fixture,__TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener:(_event:string,id:number)=>events.delete(id)},__TAURI_INTERNALS__:{
      transformCallback:(callback:(event:unknown)=>void)=>{const id=++nextCallback;callbacks.set(id,callback);return id;},
      invoke:async(command:string,args?:{event:string;handler:number})=>{
        if(command==='plugin:event|listen'){events.set(args!.handler,args!.event);return args!.handler;}
        if(command.startsWith('plugin:event|'))return null;
        if(command==='meeting_connections')return connections();
        if(command==='local_speech_status')return {runtime:true,medium:true,small:false,version:'0.1.5'};
        if(command==='local_model_setup_status')return progress;
        if(command==='local_ai_status')return {speech:{medium:true,small:false},availableBytes:20e9,models:ready?[{id:'gemma4:e4b',name:'gemma4:e4b',digest:'verified',quantization:'Q4_K_M'}]:[]};
        if(command==='local_model_setup'){
          const attempts=Number(localStorage.getItem('setup-attempts')||0)+1;localStorage.setItem('setup-attempts',String(attempts));
          if(attempts===1)throw Error('Download interrupted. Retry setup.');
          progress={running:true,message:'Downloading Gemma 4',completed:2e9,total:10e9};emit();
          return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
        }
        if(command==='local_model_setup_cancel'){progress={running:false,message:'Setup stopped. Retry to resume.',completed:null,total:null};emit();fail(progress.message);return null;}
        throw Error(`Unexpected setup fixture command: ${command}`);
      },
    }});
  },theme);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor=page.getByRole('textbox',{name:'Note content',exact:true});await expect(editor).toHaveText('My writing stays intact.');
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  const open=async()=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();};
  await open();
  const setup=settings.getByRole('button',{name:'Set up Gemma 4',exact:true});
  expect(await page.evaluate(()=>localStorage.getItem('setup-attempts'))).toBeNull();
  await setup.click();await expect(settings.getByRole('alert')).toContainText('Download interrupted');
  await setup.click();await expect(settings.getByRole('progressbar',{name:'Local model download'})).toHaveAttribute('value','2000000000');
  await expect(setup).toBeDisabled();
  await settings.getByRole('button',{name:'Done',exact:true}).click();
  await expect(editor).toHaveText('My writing stays intact.');
  await open();await expect(settings.getByRole('button',{name:'Stop setup',exact:true})).toBeVisible();await expect(setup).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem('setup-attempts'))).toBe('2');
  await settings.getByRole('button',{name:'Stop setup',exact:true}).click();await expect(setup).toBeEnabled();
  await setup.click();await page.evaluate(()=>(window as unknown as {gemmaSetupFixture:{complete:()=>void}}).gemmaSetupFixture.complete());
  const picker=settings.getByRole('combobox',{name:'Local text model',exact:true});
  await expect(picker).toBeEnabled();await expect(picker).toHaveValue('gemma4:e4b');
  await expect(settings.getByRole('combobox',{name:'AI service for meeting notes',exact:true})).toHaveValue('chatgpt');
  await settings.getByRole('button',{name:'Done',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});
  await open();await expect(picker).toHaveValue('gemma4:e4b');
  await expect(settings.getByRole('combobox',{name:'AI service for meeting notes',exact:true})).toHaveValue('chatgpt');
  expect(await page.evaluate(()=>localStorage.getItem('setup-attempts'))).toBe('3');
});

test('preview keeps local generation unavailable while writing remains editable',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const editor=page.getByRole('textbox',{name:'Note content',exact:true});await expect(editor).toBeVisible();
  await expect(page.getByRole('button',{name:'Writing help',exact:true})).toBeDisabled();
  await expect(page.locator('.save-state.saving')).toHaveCount(0);await editor.fill('Preview writing stays editable.');await page.keyboard.press('Control+s');
  await expect.poll(()=>page.evaluate(async()=>{const {loadWorkspace}=await import('/src/storage.ts');return (await loadWorkspace()).document?.notes.some(n=>n.content.includes('Preview writing stays editable.'));})).toBe(true);
  await page.reload({waitUntil:'domcontentloaded'});await expect(editor).toHaveText('Preview writing stays editable.');
});

test('speaker display turns preserve canonical citations and UTF-8 ranges',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const turns=await page.evaluate(async()=>{
    const {speakerTurns}=await import('/src/meetings.ts');
    const text='Sam 日本語 Jordan';const encoded=new TextEncoder();
    const boundary=encoded.encode('Sam 日本語 ').length;
    return speakerTurns({id:7,start:0,end:4,speaker:'unknown',text,words:[{text:'Sam',start:0,end:1}],speakerSpans:[{speaker:'0',start:0,end:2,textStart:0,textEnd:boundary},{speaker:'1',start:2,end:4,textStart:boundary,textEnd:encoded.encode(text).length}]});
  });
  expect(turns.map(t=>t.id)).toEqual([7,7]);expect(turns.map(t=>t.speaker)).toEqual(['0','1']);expect(turns.map(t=>t.text).join('')).toBe('Sam 日本語 Jordan');expect(turns[1].start).toBe(2);
});

test('history import remaps parents and turns while excluding transient reasoning',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {validateConversations,remapConversations}=await import('/src/localAI.ts');
    const user=crypto.randomUUID(),assistant=crypto.randomUUID(),id=crypto.randomUUID();
    const c={version:1,id,scope:'note',parentId:'original',createdAt:1,messages:[{id:user,role:'user',text:'Make it shorter.',status:'completed',createdAt:1,revision:1,model:'gemma4:e4b',digest:'d',sources:[]},{id:assistant,role:'assistant',text:'Final answer.',status:'completed',createdAt:2,revision:1,model:'gemma4:e4b',digest:'d',sources:[],thinking:'private transient trace'}],memory:{text:'Concise preference',coveredIds:[user,assistant],revision:1},thinking:'transient'};
    const valid=validateConversations([c],new Set(['original']));
    const remapped=remapConversations(valid,new Map([['original','restored']]));
    let rejected=false;try{validateConversations([c],new Set(['other']));}catch{rejected=true;}
    return {changed:remapped[0].id!==id&&remapped[0].messages[0].id!==user&&remapped[0].messages[1].id!==assistant,parent:remapped[0].parentId,memory:remapped[0].memory,rejected,serialized:JSON.stringify(valid)};
  });
  expect(result.changed).toBe(true);expect(result.parent).toBe('restored');expect(result.memory).toBeNull();expect(result.rejected).toBe(true);expect(result.serialized).not.toContain('private transient trace');expect(result.serialized).not.toContain('thinking');
});

test('backup history survives consecutive merges and save acknowledgement preserves concurrent imports',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('textbox',{name:'Note content',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>!!(await (await import('/src/storage.ts')).loadWorkspace()).document)).toBe(true);
  const result=await page.evaluate(async()=>{
    const {mergeBackup}=await import('/src/importBackup.ts');
    const {consumeConversationImports}=await import('/src/localAI.ts');
    const {attachmentSchema}=await import('/src/attachments.ts');
    const {loadWorkspace,saveWorkspace}=await import('/src/storage.ts');
    const loaded=await loadWorkspace();if(!loaded.document)throw Error('Notebook is not loaded.');
    const note={...loaded.document.notes[0],id:'imported',folderId:null,meeting:undefined};
    const conversation={version:1 as const,id:crypto.randomUUID(),scope:'note' as const,parentId:note.id,createdAt:1,messages:[]};
    const backup={notes:[note],folders:[],aiVersion:1 as const,aiConversations:[conversation]};
    const first=mergeBackup(loaded.document,backup),second=mergeBackup(first,backup);
    const acknowledged=consumeConversationImports(second,first);
    const clean=consumeConversationImports(first,first);
    const removed=attachmentSchema({...second,notes:second.notes.filter(n=>n.id!==first.aiConversations![0].parentId)});
    await saveWorkspace(second,loaded.revision);
    const reloaded=await loadWorkspace();
    return {merged:second.aiConversations?.length,previewSaved:reloaded.document?.aiConversations?.length,
      pending:acknowledged.aiConversations?.map(c=>c.id),expected:second.aiConversations![1].id,
      clean:clean.aiConversations===undefined&&clean.aiVersion===undefined,
      immutable:first.aiConversations?.length,removed:removed.aiConversations?.map(c=>c.id)};
  });
  expect(result.merged).toBe(2);expect(result.previewSaved).toBe(2);
  expect(result.pending).toEqual([result.expected]);expect(result.removed).toEqual([result.expected]);
  expect(result.clean).toBe(true);expect(result.immutable).toBe(1);
});

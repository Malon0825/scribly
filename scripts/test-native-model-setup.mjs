// Focused real WebView2/IPC setup check in an isolated diagnostic notebook.
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {resolve,basename,join} from 'node:path';
import {writeFile} from 'node:fs/promises';

const port=Number(process.argv[2]),profile=resolve(process.argv[3]||''),stage=process.argv[4];
if(!Number.isInteger(port)||!/^local-ai-native-[a-f0-9]{32}$/.test(basename(profile))||!['exercise','restart'].includes(stage))throw Error('Use the isolated model-setup launcher');
let browser;
for(let n=0;n<150;n++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{await new Promise(done=>setTimeout(done,200));}}
if(!browser)throw Error('Diagnostic WebView unavailable');
const page=browser.contexts()[0].pages().find(p=>!new URL(p.url()).searchParams.has('capture'));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
await page.getByRole('textbox',{name:'Note content',exact:true}).waitFor({timeout:30000});
// The release UI can paint the starter note before its first autosave commits.
await expect.poll(async()=>(await invoke('load_workspace')).document?.activeId,{timeout:15000}).toBeTruthy();
const original=await invoke('load_workspace');
if(!resolve(original.dataPath).startsWith(profile))throw Error('Notebook isolation check failed');
const initial=await invoke('meeting_connections');
if(initial.chatgpt||initial.deepgram)throw Error('Unexpected credentials in test notebook');
let preferences=initial.preferences;
const save=async change=>{const result=await invoke('meeting_set_preferences',{preferences:{...preferences,...change}});preferences=result.preferences;return result;};
const status=()=>invoke('local_model_setup_status');
let server;
try{
  if(stage==='exercise'){
    const real=await invoke('local_ai_status');
    if(!real.models.some(m=>m.id==='gemma4:e4b'))throw Error('Existing Gemma 4 required; this runner never downloads it');
    await save({requestProvider:'chatgpt',ollamaModel:'fixture-before-setup',chatgptReasoningEffort:'high'});
    const currentWorkspace=JSON.stringify((await invoke('load_workspace')).document);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
    await settings.getByRole('button',{name:'Set up Gemma 4',exact:true}).click();
    await expect.poll(status).toMatchObject({running:false,message:expect.stringContaining('ready')});
    await expect(settings.getByRole('combobox',{name:'Local text model',exact:true})).toHaveValue('gemma4:e4b');
    let connection=await invoke('meeting_connections');
    expect(connection.preferences).toMatchObject({requestProvider:'chatgpt',ollamaModel:'gemma4:e4b',chatgptReasoningEffort:'high'});
    expect(JSON.stringify((await invoke('load_workspace')).document)).toBe(currentWorkspace);
    await settings.getByRole('button',{name:'Done',exact:true}).click();

    // Fake only the loopback service: the native streaming/IPC/persistence are real.
    let mode='hang',present=false,pulls=0,pending;
    server=createServer(async(req,res)=>{
      let body='';for await(const chunk of req)body+=chunk;
      const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
      if(req.url==='/api/version')return json({version:'setup-fixture'});
      if(req.url==='/api/ps')return json({models:[]});
      if(req.url==='/api/tags')return json({models:present?[{name:'gemma4:e4b',digest:'fixture-digest',details:{quantization_level:'Q4_K_M'}}]:[]});
      if(req.url==='/api/show')return json({capabilities:['completion']});
      if(req.url==='/api/pull'){
        pulls++;expect(JSON.parse(body)).toEqual({model:'gemma4:e4b',stream:true});
        res.setHeader('Content-Type','application/x-ndjson');
        res.write('{"status":"pulling","completed":2,"total":10}\n');
        if(mode==='hang'){pending=res;return;}
        if(mode==='incomplete')return res.end('{"status":"verifying sha256 digest"}\n');
        if(mode==='error')return res.end('{"error":"fixture digest mismatch"}\n');
        present=true;return res.end('{"status":"verifying sha256 digest"}\n{"status":"success"}');
      }
      res.writeHead(404);res.end();
    });
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const endpoint=`http://127.0.0.1:${server.address().port}`;
    await save({ollamaEndpoint:endpoint,ollamaModel:'fixture-before-setup'});
    const start=()=>page.evaluate(()=>{
      window.setupOutcome=null;
      window.setupPromise=window.__TAURI_INTERNALS__.invoke('local_model_setup').then(value=>window.setupOutcome={ok:true,value},error=>window.setupOutcome={ok:false,error:String(error)});
    });
    const outcome=()=>page.evaluate(()=>window.setupOutcome);
    await start();await expect.poll(()=>pulls).toBe(1);await expect.poll(status).toMatchObject({running:true});
    const duplicate=await invoke('local_model_setup').then(()=>({rejected:false,error:''}),error=>({rejected:true,error:String(error)}));
    expect(duplicate).toMatchObject({rejected:true,error:expect.stringContaining('already running')});
    await invoke('local_model_setup_cancel');
    await expect.poll(outcome).toMatchObject({ok:false,error:expect.stringContaining('stopped')});
    await expect.poll(status).toMatchObject({running:false});pending.destroy();
    expect((await invoke('meeting_connections')).preferences.ollamaModel).toBe('fixture-before-setup');
    for(const failure of ['incomplete','error']){
      mode=failure;await start();
      await expect.poll(outcome).toMatchObject({ok:false,error:expect.stringContaining(failure==='incomplete'?'before verification completed':'digest mismatch')});
      expect((await invoke('meeting_connections')).preferences.ollamaModel).toBe('fixture-before-setup');
    }
    mode='hang';await start();await expect.poll(()=>pulls).toBe(4);
    await save({ollamaEndpoint:'http://127.0.0.1:11434'});
    present=true;pending.end('{"status":"success"}\n');
    await expect.poll(outcome).toMatchObject({ok:false,error:expect.stringContaining('address changed')});
    expect((await invoke('meeting_connections')).preferences.ollamaModel).toBe('fixture-before-setup');
    present=false;mode='success';await save({ollamaEndpoint:endpoint});await start();
    await expect.poll(outcome).toMatchObject({ok:true});
    expect((await invoke('meeting_connections')).preferences).toMatchObject({requestProvider:'chatgpt',ollamaModel:'gemma4:e4b',chatgptReasoningEffort:'high'});
    await save({ollamaEndpoint:'http://127.0.0.1:11434',ollamaModel:'gemma4:e4b'});
    await writeFile(join(profile,'model-setup-result.json'),JSON.stringify({ok:true,realOllamaReuse:true,nativeIPC:true,loopbackPullRequests:pulls,cancel:true,duplicateStartRejected:true,completionRequired:true,digestFailureRetainsPreferences:true,changedEndpointRetainsSelection:true,providerPreserved:true,notebookUnchanged:true},null,2));
  }else{
    expect(initial.preferences).toMatchObject({requestProvider:'chatgpt',ollamaModel:'gemma4:e4b',chatgptReasoningEffort:'high',ollamaEndpoint:'http://127.0.0.1:11434'});
    expect(await status()).toMatchObject({running:false});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const settings=page.getByRole('dialog',{name:'Settings',exact:true});
    await settings.getByRole('tab',{name:'Accounts & Advanced',exact:true}).click();
    await expect(settings.getByRole('button',{name:'Set up Gemma 4',exact:true})).toBeEnabled();
    await expect(settings.getByRole('combobox',{name:'Local text model',exact:true})).toHaveValue('gemma4:e4b');
    await settings.getByRole('button',{name:'Done',exact:true}).click();
  }
  await page.getByRole('button',{name:'Close window',exact:true}).click();
  console.log(`Native model setup ${stage} passed`);
}catch(error){await page.screenshot({path:join(profile,`failed-${stage}.png`)}).catch(()=>{});throw error;}
finally{if(server){server.closeAllConnections();server.close();}await browser.close();}

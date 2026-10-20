// Focused real WebView2/PostgreSQL/Ollama check. No microphone or cloud calls.
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const port=Number(process.argv[2]),profile=resolve(process.argv[3]||''),stage=process.argv[4];
if(!Number.isInteger(port)||!/^local-ai-native-[a-f0-9]{32}$/.test(basename(profile))||!['exercise','restart'].includes(stage))throw Error('Use the isolated local AI launcher');
let browser;
for(let n=0;n<150;n++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{await new Promise(done=>setTimeout(done,200));}}
if(!browser)throw Error('Diagnostic WebView unavailable');
const page=browser.contexts()[0].pages().find(p=>!new URL(p.url()).searchParams.has('capture'));
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
await page.waitForFunction(()=>Boolean(window.__TAURI_INTERNALS__?.invoke),null,{timeout:30000});
await expect.poll(async()=>{
 try{return (await invoke('load_workspace')).document?.activeId;}
 catch(error){if(/Execution context was destroyed/.test(String(error)))return null;throw error;}
},{timeout:30000}).toBeTruthy();
const sql=async(query)=>{
 const config=JSON.parse(await readFile(join(profile,'local-database.json'),'utf8'));
 const file=join(profile,'fixture.sql');await writeFile(file,query);
 const {stdout}=await promisify(execFile)(resolve('src-tauri/resources/postgres/bin/psql.exe'),['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(config.port),'-U','still','-d','postgres','-At','-f',file],{env:{...process.env,PGPASSWORD:config.password}});return stdout.trim();
};
const metrics=[];
await page.exposeFunction('recordSummaryMetric',metric=>metrics.push(metric));
await page.evaluate(async()=>{await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'local-ai-metrics',target:{kind:'Any'},handler:window.__TAURI_INTERNALS__.transformCallback(event=>window.recordSummaryMetric(event.payload))});});
const output=join(profile,'summary-quality.json');
if(stage==='exercise'){
 let original;
 try{original=JSON.parse((await readFile(join(profile,'recording.json'),'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')throw error;}
 const texts=['Hello.','The speech engine sounded like Amun Shain.','Is that Whisper?',...Array.from({length:24},(_,i)=>`Discussion point ${i+1}: the app must keep audio and transcript text on the device, without uploading to a cloud service.`),'No, Moonshine handles speech to text. Gemma 4 creates summaries, using Ollama.','What is the main difficulty: latency or quality?','Latency is high when live transcription runs.','Chunk size and audio sending frequency might contribute; we have not measured the cause.','How large are the chunks and what is their overlap?','I guess I need to debug that.','Maybe log capture, transcription and summarization timestamps to locate the delay.','Thanks.'];
 const meeting={...(original||{}),id:randomUUID(),noteId:null,title:'Local summary quality fixture',createdAt:Date.now(),duration:original?.duration||texts.length*5,media:null,video:null,recording:'saved',processing:'ready',error:null,revision:original?.revision||1,speakers:original?.speakers||{},analyses:[],localRecovery:null,recovery:null,deletedAt:null,notesStatus:'',autoNotes:false,liveTranscription:false,liveComplete:true,segments:original?.segments||texts.map((text,id)=>({id,start:id*5,end:(id+1)*5,speaker:String(id%2),text}))};
 await invoke('meeting_list');await sql(`INSERT INTO scribly_meetings(id,document) VALUES('${meeting.id}',$fixture$${JSON.stringify(meeting)}$fixture$::jsonb);`);
 let summary=null,minutes=null;
 if(process.argv[8]!=='skip-recap'){
 const started=Date.now();
 const summarized=await invoke('meeting_analyze',{id:meeting.id,provider:'ollama',model:'gemma4:e4b',kind:'summary',question:'',notes:''});
 summary=summarized.analyses.at(-1);const text=summary.items.map(i=>i.text).join('\n');
 if(!summary.items.length||summary.items.length>8||!/^Overview:/i.test(summary.items[0].text))throw Error(`Summary lacks bounded overview: ${text}`);
 if(!/Moonshine/i.test(text)||!/Gemma/i.test(text)||!/latency|delay/i.test(text)||!/timestamp/i.test(text))throw Error(`Summary lost essential subject or next step: ${text}`);
 if(/Amun Shain|Mengcheng|acknowledg|thanks|They don't know/i.test(text))throw Error(`Summary retained superseded names or chatter: ${text}`);
 if(/(?:unresolved|open)[^\n]*(?:latency,? quality|latency or quality|latency versus quality)/i.test(text))throw Error(`Summary treats answered question as open: ${text}`);
 if(/(?:Decision:|agreed to|committed to)[^\n]*(?:debug|timestamp)/i.test(text))throw Error(`Summary invents a commitment: ${text}`);
 if(!summary.items.every(i=>i.sources.length&&i.sources.every(s=>meeting.segments.some(segment=>segment.id===s))))throw Error('Summary lost stable citations');
 console.log(`Summary: ${summary.items.length} items, ${((Date.now()-started)/1000).toFixed(1)}s\n${text}`);
 const minutesResult=await invoke('meeting_analyze',{id:meeting.id,provider:'ollama',model:'gemma4:e4b',kind:'minutes',question:'',notes:''});
 minutes=minutesResult.analyses.at(-1);const minutesText=minutes.items.map(i=>i.text).join('\n');
 if(!minutes.items.length||minutes.items.length>12||/Amun Shain|Mengcheng|greeting|acknowledg|thanks/i.test(minutesText)||!/timestamp/i.test(minutesText))throw Error(`Key points lost context or retained chatter: ${minutesText}`);
 }
 const actionsResult=await invoke('meeting_analyze',{id:meeting.id,provider:'ollama',model:'gemma4:e4b',kind:'actions',question:'',notes:''});
 if(actionsResult.analyses.at(-1).items.length)throw Error('Tentative debugging discussion became a firm action');
 console.log('Tentative suggestions excluded from firm actions');
 let longSummary=null;
 if(original){
   const long={id:randomUUID(),noteId:null,title:'Cross-part correction fixture',createdAt:Date.now(),duration:texts.length*5,media:null,video:null,recording:'saved',processing:'ready',error:null,revision:1,speakers:{},analyses:[],segments:texts.map((text,id)=>({id,start:id*5,end:(id+1)*5,speaker:String(id%2),text}))};
   await sql(`INSERT INTO scribly_meetings(id,document) VALUES('${long.id}',$fixture$${JSON.stringify(long)}$fixture$::jsonb);`);
   const result=await invoke('meeting_analyze',{id:long.id,provider:'ollama',model:'gemma4:e4b',kind:'summary',question:'',notes:''});
   longSummary=result.analyses.at(-1);const text=longSummary.items.map(i=>i.text).join('\n');
   if(!longSummary.items.length||longSummary.items.length>8||/Amun Shain|Whisper/i.test(text)||!/Moonshine/i.test(text)||!/Gemma/i.test(text)||!/timestamp/i.test(text))throw Error(`Cross-part synthesis lost clarification or late next step: ${text}`);
   console.log(`Cross-part synthesis: ${longSummary.items.length} items\n${text}`);
 }
 // A separate short cleanup fixture keeps the quality sample's text untouched.
 const cleanup={...meeting,id:randomUUID(),revision:1,analyses:[],duration:10,segments:[{id:0,start:0,end:5,speaker:'0',text:'hello moon shine does speech to text',words:[{text:'hello',start:0,end:1}]},{id:1,start:5,end:10,speaker:'1',text:'Yes. Moonshine transcribes speech and Gemma creates summaries.'}]};
 await sql(`INSERT INTO scribly_meetings(id,document) VALUES('${cleanup.id}',$fixture$${JSON.stringify(cleanup)}$fixture$::jsonb);`);
 const suggestion=await invoke('meeting_cleanup_suggest',{id:cleanup.id,segment:0,revision:1,terms:'Moonshine, Gemma'});
 const before=(await invoke('meeting_list')).find(m=>m.id===cleanup.id);
 expect(before.segments.map(s=>({id:s.id,text:s.text}))).toEqual(cleanup.segments.map(s=>({id:s.id,text:s.text})));if(before.revision!==1||!/Moonshine/i.test(suggestion.text)||suggestion.original!==cleanup.segments[0].text)throw Error('Cleanup lost context or original');
 const segments=cleanup.segments.map(s=>s.id===0?{...s,text:suggestion.text,words:[],speakerSpans:[]}:s);
 const edited=await invoke('meeting_update',{id:cleanup.id,title:cleanup.title,speakers:cleanup.speakers,segments,expectedRevision:1});
 if(edited.revision!==2||edited.segments[0].originalText!==cleanup.segments[0].text||edited.segments[0].id!==0||edited.segments[0].start!==0)throw Error('Accepted cleanup lost original text, revision or source anchor');
 await expect(invoke('meeting_update',{id:cleanup.id,title:cleanup.title,speakers:cleanup.speakers,segments:cleanup.segments,expectedRevision:1})).rejects.toThrow(/transcript changed/);
 const cancelled=invoke('meeting_cleanup_suggest',{id:cleanup.id,segment:1,revision:2,terms:''}).then(()=>null,e=>String(e));await new Promise(done=>setTimeout(done,50));await invoke('meeting_cancel',{id:cleanup.id});if(!/canceled/.test(await cancelled))throw Error('Cleanup cancellation failed');
 if((await invoke('meeting_list')).find(m=>m.id===cleanup.id).segments[0].text!==suggestion.text)throw Error('Cancellation changed accepted text');
 await writeFile(output,JSON.stringify({source:original?'selected recording copy':'synthetic correction fixture',meetingId:meeting.id,cleanupId:cleanup.id,original:cleanup.segments[0].text,suggestion,summary,minutes,longSummary,metrics},null,2));
 console.log('Review-only cleanup, acceptance, stable anchors, stale rejection and cancellation passed');
}else{
 const state=JSON.parse(await readFile(output,'utf8'));const meeting=(await invoke('meeting_list')).find(m=>m.id===state.cleanupId);
 if(meeting.segments[0].originalText!==state.original||meeting.segments[0].text!==state.suggestion.text)throw Error('Cleanup was lost after restart');
 const restored=await invoke('meeting_update',{id:meeting.id,title:meeting.title,speakers:meeting.speakers,expectedRevision:meeting.revision,segments:meeting.segments.map(s=>s.id===0?{...s,text:state.original,words:[],speakerSpans:[]}:s)});
 if(restored.segments[0].originalText!==state.original||restored.segments[0].text!==state.original)throw Error('Restore original lost provenance');
 console.log('Cleanup restart persistence and restoration passed');
}
await page.getByRole('button',{name:'Close window',exact:true}).click();
await browser.close();

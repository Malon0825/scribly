import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktop } from './storage';
import type { MeetingConnections } from './meetings';
import type { MeetingsController } from './useMeetings';

type SetupProgress = { running:boolean; message:string; completed:number | null; total:number | null };
const idle:SetupProgress = {running:false,message:'',completed:null,total:null};

export function GemmaSetup({controller:c,onReady,onRunning}:{controller:MeetingsController;onReady:()=>void;onRunning:(running:boolean)=>void}) {
  const [progress,setProgress] = useState(idle);
  const [error,setError] = useState('');
  const [stopping,setStopping] = useState(false);
  const mounted = useRef(false);
  const runningCallback = useRef(onRunning);
  runningCallback.current = onRunning;
  useEffect(()=>{
    mounted.current=true;
    if(!desktop)return()=>{mounted.current=false;};
    let live=true;
    let revision=0;
    let off:(()=>void) | undefined;
    const update=(value:SetupProgress)=>{setProgress(value);runningCallback.current(value.running);if(!value.running)setStopping(false);};
    void listen<SetupProgress>('local-model-setup',event=>{if(live){revision++;update(event.payload);}}).then(async unlisten=>{
      if(!live){unlisten();return;}
      off=unlisten;
      const current=revision;
      try {const value=await invoke<SetupProgress>('local_model_setup_status');if(live&&current===revision)update(value);}catch(reason){if(live)setError(String(reason));}
    }).catch(reason=>{if(live)setError(String(reason));});
    return()=>{live=false;mounted.current=false;off?.();};
  },[]);
  async function start() {
    setError('');setStopping(false);
    setProgress({...idle,running:true,message:'Checking local AI setup'});onRunning(true);
    try {
      const result=await invoke<{connections:MeetingConnections}>('local_model_setup');
      c.setConnections(result.connections);
      if(mounted.current){setProgress({...idle,message:'Gemma 4 is ready. Works offline after setup.'});onReady();}
    } catch(reason) {if(mounted.current){setError(String(reason));setProgress(idle);}}
    finally {if(mounted.current){onRunning(false);setStopping(false);}}
  }
  async function stop() {
    setStopping(true);setError('');
    try {await invoke('local_model_setup_cancel');}
    catch(reason){setError(String(reason));setStopping(false);}
  }
  const bytes=progress.total && progress.completed !== null
    ? `${(progress.completed/1e9).toFixed(1)} / ${(progress.total/1e9).toFixed(1)} GB in this download layer` : '';
  return <div>
    <p className="setting-hint">One-click setup installs Ollama if needed, downloads Gemma 4 E4B (about 10 GB), and selects it for local AI. Allow at least 20 GB of free disk space for a new setup. Your meeting notes provider stays as selected.</p>
    <div className="settings-actions">
      <button type="button" disabled={!desktop || progress.running || !!c.busy || !!c.recording} onClick={()=>void start()}>Set up Gemma 4</button>
      {progress.running && <button type="button" disabled={stopping} onClick={()=>void stop()}>{stopping ? 'Stopping after current step…' : 'Stop setup'}</button>}
    </div>
    {progress.message && <p className="setting-hint" role="status">{progress.message}{bytes && ` · ${bytes}`}</p>}
    {progress.running && progress.total !== null && progress.completed !== null && progress.total>0 && <progress aria-label="Local model download" max={progress.total} value={progress.completed} />}
    {error && <p className="meeting-error" role="alert">{error}</p>}
  </div>;
}

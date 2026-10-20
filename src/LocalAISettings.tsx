import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';
import type { MeetingsController } from './useMeetings';
import type { LocalStatus, SpeechStatus } from './localAI';
import { GemmaSetup } from './GemmaSetup';

export function LocalAISettings({controller:c}:{controller:MeetingsController}) {
  const [endpoint,setEndpoint] = useState(c.preferences.ollamaEndpoint);
  const [status,setStatus] = useState<LocalStatus | null>(null);
  const [speech,setSpeech] = useState<SpeechStatus | null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState('');
  const [test,setTest] = useState('');
  const [modelSetup,setModelSetup] = useState(false);
  const catalogRequest = useRef(0);
  const setConnections = c.setConnections;
  useEffect(() => {setEndpoint(c.preferences.ollamaEndpoint);},[c.preferences.ollamaEndpoint]);
  useEffect(() => {if (!desktop) return; let live=true; void invoke<SpeechStatus>('local_speech_status').then(value=>{if(live){setSpeech(value);setConnections(current=>({...current,moonshine:value.medium,moonshineSmall:value.small}));}}).catch(reason=>{if(live)setError(String(reason));}); return()=>{live=false;};},[setConnections]);
  const refresh = useCallback(async () => {
    const request = ++catalogRequest.current;
    setBusy('Checking local services');setError('');setTest('');
    try { const value = await invoke<LocalStatus>('local_ai_status');if(request!==catalogRequest.current)return;setStatus(value);setConnections(current=>({...current,ollama:true})); }
    catch(reason) {if(request!==catalogRequest.current)return;setError(String(reason));setStatus(null);setConnections(current=>({...current,ollama:false}));}
    finally {if(request===catalogRequest.current)setBusy('');}
  },[setConnections]);
  useEffect(()=>{
    if(!desktop)return;
    void refresh();
    return()=>{catalogRequest.current++;};
  },[c.preferences.ollamaEndpoint,refresh]);
  async function setup(model:'moonshine'|'moonshine-small') {
    setBusy('Installing and verifying speech assets');setError('');
    try {const value=await invoke<SpeechStatus>('local_speech_setup',{model});setSpeech(value);c.setConnections(current=>({...current,moonshine:value.medium,moonshineSmall:value.small}));}
    catch(reason){setError(String(reason));}finally{setBusy('');}
  }
  return <section className="meeting-local-settings settings-group" aria-labelledby="local-settings-title">
    <h3 id="local-settings-title">Local AI</h3>
    <p className="setting-hint">Moonshine transcribes English locally. Completed Moonshine and Deepgram transcripts support local speaker-name suggestions through Ollama. With Deepgram, automatic naming follows your meeting notes provider: Ollama or ChatGPT. Names stay editable. Local tasks never fall back to a cloud provider.</p>
    <GemmaSetup controller={c} onReady={()=>void refresh()} onRunning={setModelSetup} />
    <label className="meeting-field">Local text model<select disabled={!desktop || !status?.models.length || !!busy || !!c.busy || modelSetup} value={c.preferences.ollamaModel} onChange={event=>c.savePreferences({ollamaModel:event.target.value})}>
      {!status?.models.some(m=>m.id===c.preferences.ollamaModel) && <option value={c.preferences.ollamaModel}>{c.preferences.ollamaModel}{status ? ' · missing' : ''}</option>}
      {status?.models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.quantization}</option>)}
    </select></label>
    <p className="setting-hint">Writing help always uses this model. Meeting notes use it when you select Local AI. Works offline after setup.</p>
    <details className="settings-disclosure"><summary tabIndex={0}><span>Local service & diagnostics<span className="setting-hint">Ollama address, connection test & memory</span></span></summary>
    <div className="settings-disclosure-content">
    <label className="meeting-field">Ollama address<input value={endpoint} maxLength={150} disabled={!desktop || !!busy || !!c.busy} onChange={event=>setEndpoint(event.target.value)} /></label>
    <div className="settings-actions"><button disabled={!desktop || !!busy || !!c.busy || endpoint===c.preferences.ollamaEndpoint} onClick={()=>c.savePreferences({ollamaEndpoint:endpoint.trim()})}>Save address</button><button disabled={!desktop || !!busy || !!c.busy || endpoint!==c.preferences.ollamaEndpoint} onClick={()=>void refresh()}>Check local services</button></div>
    {status && <p className="setting-hint">{status.models.length} local models available. {status.models.find(m=>m.id===c.preferences.ollamaModel)?.digest.slice(0,16)} · 4K context. Context budgeting is experimental; shorter passages work best. {(status.availableBytes/1e9).toFixed(1)} GB available. {status.calibration?.digest===status.models.find(m=>m.id===c.preferences.ollamaModel)?.digest ? 'Cold-load headroom calibration is available.' : 'Test local text with the model unloaded to sample cold-load headroom.'}</p>}
    <button disabled={!desktop || !status || !!busy || !!c.busy || !!c.recording} onClick={()=>{setBusy('Testing local text');setError('');void invoke<string>('local_ai_test').then(setTest).catch(reason=>setError(String(reason))).finally(()=>setBusy(''));}}>Test local text</button>
    {test && <p className="meeting-notice" role="status">{test}</p>}
    </div>
    </details>
    <details className="settings-disclosure"><summary tabIndex={0}><span>Offline transcription setup<span className="setting-hint">Install or verify Moonshine speech assets</span></span><span className="settings-account-status">{speech ? speech.runtime ? speech.medium || speech.small ? 'Assets ready' : 'Needs assets' : 'Unavailable' : desktop ? 'Checking…' : 'Windows app'}</span></summary>
    <div className="settings-disclosure-content">
    <p className="setting-hint">Speech runtime: {speech?.runtime ? `Moonshine ${speech.version}` : 'Unavailable'}. Medium English: {speech?.medium ? 'Ready' : 'Needs assets'}. Small English: {speech?.small ? 'Ready' : 'Needs assets'}. Speaker labels can change and may be inaccurate during overlap.</p>
    <div className="settings-actions"><button disabled={!desktop || !speech?.runtime || !!busy || !!c.busy || !!c.recording} onClick={()=>void setup('moonshine')}>{speech?.medium ? 'Verify Medium assets' : 'Install Medium English · 425 MB'}</button><button disabled={!desktop || !speech?.runtime || !!busy || !!c.busy || !!c.recording} onClick={()=>void setup('moonshine-small')}>{speech?.small ? 'Verify Small assets' : 'Install Small English · 233 MB'}</button></div>
    <p className="setting-hint">Speech setup downloads from Moonshine and verifies checksums. Gemma setup above installs the local text model and Ollama separately from these speech assets. Scribly leaves the Ollama service running.</p>
    </div>
    </details>
    {busy && <p role="status">{busy}…</p>}{error && !modelSetup && <p role="alert" className="meeting-error">{error}</p>}
  </section>;
}

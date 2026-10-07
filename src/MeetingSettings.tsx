import { useEffect, useState, type MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';
import { geminiBillingNotice, openRouterNotice, requestProviderLabels, type RequestProvider, transcriptionLabels, type MeetingConnections, type TranscriptionModel } from './meetings';
import type { MeetingsController } from './useMeetings';
import { Microphone, Sparkle, Timer } from '@phosphor-icons/react';

export function MeetingSettings({ controller: c }: { controller: MeetingsController }) {
  const [key, setKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [models, setModels] = useState<{id:string;name:string}[]>([]);
  const [modelError, setModelError] = useState('');
  const [retry, setRetry] = useState(0);
  function openProviderPage(event:MouseEvent<HTMLAnchorElement>) {
    if (!desktop) return;
    event.preventDefault();
    void invoke('open_external_link', {url:event.currentTarget.href}).catch(reason => c.setError(String(reason)));
  }
  useEffect(() => {
    let live = true; setModels([]); setModelError('');
    if (desktop && c.connections.chatgpt) void invoke<{id:string;name:string}[]>('meeting_models').then(value => { if (live) setModels(value); }).catch(reason => { if (live) setModelError(String(reason)); });
    return () => { live = false; };
  }, [c.connections.chatgpt, retry]);
  return <div className="meeting-settings">
    <h3>Less note-taking. More listening.</h3>
    <p className="setting-hint">Record locally. Turn conversations into notes.</p>
    {!desktop && <p className="meeting-notice">Connect and record in the Windows app. This preview uses a sample.</p>}
    <h4 className="settings-section-title">Advanced</h4>
    <label className="meeting-field">Audio transcription service<select value={c.preferences.transcriptionModel} disabled={!!c.busy || !!c.recording} onChange={event => c.savePreferences({transcriptionModel:event.target.value as TranscriptionModel})}>{Object.entries(transcriptionLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <p className="setting-hint">{c.preferences.transcriptionModel === 'deepgram' ? 'Live text and speaker labels. Saved recordings can also be transcribed.' : c.preferences.transcriptionModel === 'gemini-3.5-transcribe-live' ? 'Live text. Speakers stay unknown and times are approximate. Sessions renew for longer meetings.' : 'Transcribes after recording ends, with speaker labels and word timestamps. Up to 30 minutes; up to 8 speakers.'}</p>
    <label className="meeting-field">AI service for meeting notes<select value={c.preferences.requestProvider} disabled={!!c.busy} onChange={event => c.savePreferences({requestProvider:event.target.value as RequestProvider})}>{Object.entries(requestProviderLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {c.preferences.requestProvider === 'chatgpt' && <><label className="meeting-field">Default ChatGPT model<select value={c.preferences.chatgptModel || ''} disabled={!desktop || !c.connections.chatgpt || !!c.busy || !models.length} onChange={event => c.savePreferences({chatgptModel:event.target.value || null})}><option value="">Account default{models[0] ? ` · ${models[0].name}` : ''}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{c.connections.chatgpt && <button disabled={!!c.busy} onClick={() => setRetry(value => value + 1)}>Refresh models</button>}{modelError && <p role="alert" className="meeting-error">{modelError}</p>}</>}
    <p className="setting-hint">Summary, key points, actions and optional study tools use this provider. Changes apply to new recordings and explicit requests.</p>
    {c.preferences.requestProvider === 'openrouter' && <p className="meeting-notice">{openRouterNotice} <a href="https://openrouter.ai/nvidia/nemotron-3.5-lightning:free" target="_blank" rel="noreferrer" onClick={openProviderPage}>Model & data use</a></p>}
    <h4 className="settings-section-title">Accounts</h4>
    <form onSubmit={event => { event.preventDefault(); void c.run('Checking Deepgram', () => invoke<MeetingConnections>('meeting_set_deepgram', { key }), value => { c.setConnections(value); setKey(''); }); }}>
      <h4 className="settings-section-title"><Microphone size={20} aria-hidden="true" />Transcription <span>Deepgram</span></h4>
      <p className="setting-hint">Live transcript with speaker labels.</p>
      <label className="field-label" htmlFor="meeting-deepgram">API key</label>
      <input id="meeting-deepgram" type="password" autoComplete="off" spellCheck={false} disabled={!desktop || !!c.busy} value={key} maxLength={512} onChange={event => setKey(event.target.value)} placeholder={c.connections.deepgram ? 'Connected · key stored by Windows' : 'Paste your own key'} />
      <p className="setting-hint">Audio goes to Deepgram. Usage is billed to your account.</p>
      <div className="settings-actions"><button  disabled={!desktop || !key.trim() || !!c.busy} type="submit">Connect Deepgram</button>
        {c.connections.deepgram && <button type="button" disabled={!!c.busy} onClick={() => void c.run('Disconnecting Deepgram', () => invoke<MeetingConnections>('meeting_set_deepgram', { key: '' }), c.setConnections)}>Disconnect</button>}</div>
    </form>
    <form onSubmit={event => { event.preventDefault(); void c.run('Checking Gemini', () => invoke<MeetingConnections>('meeting_set_gemini', { key:geminiKey }), value => { c.setConnections(value); setGeminiKey(''); }); }}>
      <h4 className="settings-section-title"><Sparkle size={20} aria-hidden="true" />Google Gemini</h4>
      <p className="setting-hint">One API key for Gemini transcription and Gemini 3.8 Flash requests.</p>
      <label className="field-label" htmlFor="meeting-gemini">Gemini API key</label>
      <input id="meeting-gemini" type="password" autoComplete="off" spellCheck={false} disabled={!desktop || !!c.busy} value={geminiKey} maxLength={512} onChange={event => setGeminiKey(event.target.value)} placeholder={c.connections.gemini ? 'Connected · key stored by Windows' : 'Paste your Google AI Studio key'} />
      <p className="setting-hint">Selected audio or meeting text goes to Google. Usage and limits depend on your Gemini API account.</p>
      <p className="meeting-notice">{geminiBillingNotice} <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" onClick={openProviderPage}>Gemini billing</a></p>
      <div className="settings-actions"><button  type="submit" disabled={!desktop || !geminiKey.trim() || !!c.busy}>Connect Gemini</button>{c.connections.gemini && <button type="button" disabled={!!c.busy} onClick={() => void c.run('Disconnecting Gemini', () => invoke<MeetingConnections>('meeting_set_gemini', {key:''}), c.setConnections)}>Disconnect Gemini</button>}</div>
    </form>
    <form onSubmit={event => { event.preventDefault(); void c.run('Checking OpenRouter', () => invoke<MeetingConnections>('meeting_set_openrouter', {key:openRouterKey}), value => { c.setConnections(value); setOpenRouterKey(''); }); }}>
      <h4 className="settings-section-title"><Sparkle size={20} aria-hidden="true" />OpenRouter</h4>
      <p className="setting-hint">NVIDIA Nemotron 3.5 Lightning (free) creates summaries, minutes, actions and study tools from your transcript. Audio transcription still uses Deepgram or Gemini.</p>
      <label className="field-label" htmlFor="meeting-openrouter">OpenRouter API key</label>
      <input id="meeting-openrouter" type="password" autoComplete="off" spellCheck={false} disabled={!desktop || !!c.busy} value={openRouterKey} maxLength={512} onChange={event => setOpenRouterKey(event.target.value)} placeholder={c.connections.openrouter ? 'Connected · key stored by Windows' : 'Paste your OpenRouter key'} />
      <p className="setting-hint">{openRouterNotice} <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" onClick={openProviderPage}>Get an API key</a></p>
      <div className="settings-actions"><button  type="submit" disabled={!desktop || !openRouterKey.trim() || !!c.busy}>Connect OpenRouter</button>{c.connections.openrouter && <button type="button" disabled={!!c.busy} onClick={() => void c.run('Disconnecting OpenRouter', () => invoke<MeetingConnections>('meeting_set_openrouter', {key:''}), c.setConnections)}>Disconnect OpenRouter</button>}</div>
    </form>
    <h4 className="settings-section-title"><Sparkle size={20} aria-hidden="true" />Summaries <span>ChatGPT</span></h4>
    <p className="setting-hint">Minutes, actions, and study notes. Models and limits depend on your account.</p>
    <p className={`meeting-connection${c.connections.chatgpt ? ' connected' : ''}`}>{c.connections.chatgpt ? `Connected${c.connections.email ? ` · ${c.connections.email}` : ''}` : 'Not connected'}</p>
    <div className="settings-actions">
      <button  disabled={!desktop || !!c.busy} onClick={() => void c.run('Waiting for ChatGPT sign-in', () => invoke<MeetingConnections>('meeting_signin'), c.setConnections)}>{c.connections.chatgpt ? 'Reconnect ChatGPT' : 'Sign in with ChatGPT'}</button>
      {c.connections.chatgpt && <button disabled={!!c.busy} onClick={() => void c.run('Disconnecting ChatGPT', () => invoke<MeetingConnections>('meeting_disconnect'), c.setConnections)}>Disconnect ChatGPT</button>}
      {c.busy === 'Waiting for ChatGPT sign-in' && <button onClick={() => void invoke('meeting_cancel_signin').catch(reason => c.setError(String(reason)))}>Cancel sign-in</button>}
    </div>
    <div className="meeting-recording-reminder"><Timer size={20} aria-hidden="true" /><p>Stops after 3 minutes of silence, with a reminder sound. Pausing stops the timer.</p></div>
    <details className="settings-details"><summary>Privacy & connections</summary>
      <p className="setting-hint">Recordings stay on this device. Your selected transcription provider receives audio; your selected request provider receives meeting text. Your writing is included only when you choose it as context. Deletion of Gemini file uploads is requested after processing. Interrupted uploads or failed cleanup may remain until Google expires them.</p>
      <p className="setting-hint">Windows protects your API keys. Keys are excluded from backups. ChatGPT sign-in opens in your browser.</p>
      <p className="setting-hint">Silence detection keeps working if transcription disconnects.</p>
    </details>
    {c.busy && <p role="status">{c.busy}…</p>}
    {c.error && <p className="meeting-error" role="alert">{c.error}</p>}
  </div>;
}

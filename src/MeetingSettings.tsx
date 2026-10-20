import { LocalAISettings } from './LocalAISettings';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './storage';
import { requestProviderLabels, reasoningLabels, type ReasoningEffort, type ChatGPTModel, type RequestProvider, transcriptionLabels, type MeetingConnections, type TranscriptionModel } from './meetings';
import type { MeetingsController } from './useMeetings';
import { Timer } from '@phosphor-icons/react';

export function MeetingSettings({ controller: c }: { controller: MeetingsController }) {
  const [key, setKey] = useState('');
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [modelError, setModelError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setModels([]); setModelError('');
    if (desktop && c.connections.chatgpt) void invoke<ChatGPTModel[]>('meeting_models').then(value => { if (live) setModels(value); }).catch(reason => { if (live) setModelError(String(reason)); });
    return () => { live = false; };
  }, [c.connections.chatgpt, retry]);
  const selectedModel = c.preferences.chatgptModel ? models.find(model => model.id === c.preferences.chatgptModel) : models[0];
  const efforts = selectedModel?.reasoningEfforts || [];
  const effort = c.preferences.chatgptReasoningEffort || 'auto';
  const unsupportedEffort = effort !== 'auto' && !efforts.includes(effort);
  function changeModel(id:string) {
    const next = id ? models.find(model => model.id === id) : models[0];
    c.savePreferences({chatgptModel:id || null, chatgptReasoningEffort:effort === 'auto' || next?.reasoningEfforts?.includes(effort) ? effort : 'auto'});
  }
  return <div className="meeting-settings">
    <section className="settings-group" aria-labelledby="meeting-settings-title">
    <h3 id="meeting-settings-title">Meeting AI</h3>
    <p className="setting-hint">Record locally. Turn conversations into notes.</p>
    {!desktop && <p className="meeting-notice">Connect and record in the Windows app. This preview uses a sample.</p>}
    <label className="meeting-field">Audio transcription service<select value={c.preferences.transcriptionModel} disabled={!!c.busy || !!c.recording} onChange={event => c.savePreferences({transcriptionModel:event.target.value as TranscriptionModel})}>{Object.entries(transcriptionLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <p className="setting-hint">{c.preferences.transcriptionModel.startsWith('moonshine') ? 'English transcription and editable speaker labels run locally. Install assets below. The model stays fixed during each recording.' : 'Live text and speaker labels. Saved recordings can also be transcribed.'}</p>
    <label className="meeting-field">AI service for meeting notes<select value={c.preferences.requestProvider} disabled={!!c.busy} onChange={event => c.savePreferences({requestProvider:event.target.value as RequestProvider})}>{Object.entries(requestProviderLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {c.preferences.requestProvider === 'chatgpt' && <>
      <label className="meeting-field">Default ChatGPT model<select value={c.preferences.chatgptModel || ''} disabled={!desktop || !c.connections.chatgpt || !!c.busy || !models.length} onChange={event => changeModel(event.target.value)}><option value="">Account default{models[0] ? ` · ${models[0].name}` : ''}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="meeting-field">ChatGPT reasoning effort<select value={effort} disabled={!desktop || !c.connections.chatgpt || !!c.busy || !models.length} onChange={event => c.savePreferences({chatgptReasoningEffort:event.target.value as ReasoningEffort})}>
        <option value="auto">{reasoningLabels.auto}</option>
        {unsupportedEffort && <option value={effort} disabled>{reasoningLabels[effort]} · unavailable for this model</option>}
        {efforts.map(value => <option key={value} value={value}>{reasoningLabels[value]}</option>)}
      </select></label>
      <p className="setting-hint">Lower effort favors speed; higher effort allows more thinking and may take longer. Applies to ChatGPT summaries, speaker-name review and questions. Local AI keeps its own settings.</p>
      {unsupportedEffort && <p role="alert" className="meeting-error">Choose a supported reasoning effort for this model before generating.</p>}
      {!!selectedModel && !efforts.length && <p className="setting-hint">Manual reasoning controls are not verified for this model. Use Model default.</p>}
      {c.connections.chatgpt && <button disabled={!!c.busy} onClick={() => setRetry(value => value + 1)}>Refresh models</button>}{modelError && <p role="alert" className="meeting-error">{modelError}</p>}
    </>}
    <p className="setting-hint">Summary, key points, actions and optional study tools use this provider. Changes apply to new recordings and explicit requests.</p>
    <details className="settings-details"><summary tabIndex={0}>Recording behavior</summary>
      <div className="meeting-recording-reminder"><Timer size={20} aria-hidden="true" /><p>Stops after 3 minutes of silence, with a reminder sound. Pausing stops the timer.</p></div>
      <p className="setting-hint">Silence detection keeps working if transcription disconnects.</p>
    </details>
    </section>
    <LocalAISettings controller={c} />
    <section className="settings-group" aria-labelledby="accounts-settings-title">
    <h3 id="accounts-settings-title">Connected accounts</h3>
    <p className="setting-hint">Connect only the services you use. Open an account to manage sign-in or API keys.</p>
    <details className="settings-disclosure"><summary tabIndex={0}><span>Deepgram<span className="setting-hint">Audio transcription</span></span><span className={`settings-account-status${c.connections.deepgram ? ' connected' : ''}`}>{c.connections.deepgram ? 'Connected' : 'Not connected'}</span></summary>
    <form onSubmit={event => { event.preventDefault(); void c.run('Checking Deepgram', () => invoke<MeetingConnections>('meeting_set_deepgram', { key }), value => { c.setConnections(value); setKey(''); }); }}>
      <p className="setting-hint">Live transcript with speaker labels.</p>
      <label className="field-label" htmlFor="meeting-deepgram">API key</label>
      <input id="meeting-deepgram" type="password" autoComplete="off" spellCheck={false} disabled={!desktop || !!c.busy} value={key} maxLength={512} onChange={event => setKey(event.target.value)} placeholder={c.connections.deepgram ? 'Connected · key stored by Windows' : 'Paste your own key'} />
      <p className="setting-hint">Audio goes to Deepgram. Usage is billed to your account.</p>
      <div className="settings-actions"><button  disabled={!desktop || !key.trim() || !!c.busy} type="submit">Connect Deepgram</button>
        {c.connections.deepgram && <button type="button" disabled={!!c.busy} onClick={() => void c.run('Disconnecting Deepgram', () => invoke<MeetingConnections>('meeting_set_deepgram', { key: '' }), c.setConnections)}>Disconnect</button>}</div>
    </form>
    </details>
    <details className="settings-disclosure"><summary tabIndex={0}><span>ChatGPT<span className="setting-hint">Meeting notes & study tools</span></span><span className={`settings-account-status${c.connections.chatgpt ? ' connected' : ''}`}>{c.connections.chatgpt ? 'Connected' : 'Not connected'}</span></summary>
    <div className="settings-disclosure-content">
    <p className="setting-hint">Summaries, key points, actions and study notes use your ChatGPT/Codex subscription. Models and limits depend on your account.</p>
    <p className={`meeting-connection${c.connections.chatgpt ? ' connected' : ''}`}>{c.connections.chatgpt ? `Connected${c.connections.email ? ` · ${c.connections.email}` : ''}` : 'Not connected'}</p>
    <div className="settings-actions">
      <button  disabled={!desktop || !!c.busy} onClick={() => void c.run('Waiting for ChatGPT sign-in', () => invoke<MeetingConnections>('meeting_signin'), c.setConnections)}>{c.connections.chatgpt ? 'Reconnect ChatGPT' : 'Sign in with ChatGPT'}</button>
      {c.connections.chatgpt && <button disabled={!!c.busy} onClick={() => void c.run('Disconnecting ChatGPT', () => invoke<MeetingConnections>('meeting_disconnect'), c.setConnections)}>Disconnect ChatGPT</button>}
      {c.busy === 'Waiting for ChatGPT sign-in' && <button onClick={() => void invoke('meeting_cancel_signin').catch(reason => c.setError(String(reason)))}>Cancel sign-in</button>}
    </div>
    </div>
    </details>
    <details className="settings-details"><summary tabIndex={0}>Privacy & connections</summary>
      <p className="setting-hint">Recordings stay on this device. Your selected transcription provider receives audio; your selected request provider receives meeting text. Your writing is included only when you choose it as context.</p>
      <p className="setting-hint">Windows protects your API keys. Keys are excluded from backups. ChatGPT sign-in opens in your browser.</p>
    </details>
    </section>
    {c.busy && <p role="status">{c.busy}…</p>}
    {c.error && <p className="meeting-error" role="alert">{c.error}</p>}
  </div>;
}

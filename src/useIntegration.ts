import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktop } from './storage';
import { executeIntegration, integrationError, type IntegrationRequest, type IntegrationWriter } from './integration';

export function useIntegration(writer: IntegrationWriter & { ready: boolean }) {
  const current = useRef(writer); current.current = writer;
  useEffect(() => {
    if (!desktop || !writer.ready) return;
    const generation = crypto.randomUUID(); let live = true, unsubscribe: (() => void) | undefined;
    void listen<IntegrationRequest>('integration-request', event => {
      if (!live || event.payload.generation !== generation) return;
      void executeIntegration(event.payload, current.current).catch(integrationError).then(result => {
        if (live) return invoke('integration_reply', { id: event.payload.id, generation, result });
      }).catch(reason => console.error('Scribly integration response failed:', String(reason)));
    }).then(async off => {
      if (!live) { off(); return; }
      unsubscribe = off; await invoke('integration_ready', { generation });
      if (!live) await invoke('integration_detach', { generation });
    }).catch(reason => console.error('Scribly integration unavailable:', String(reason)));
    return () => { live = false; unsubscribe?.(); void invoke('integration_detach', { generation }).catch(() => {}); };
  }, [writer.ready]);
}

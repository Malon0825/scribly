// Critical protocol, editor and durability checks in an isolated native notebook.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
const port = Number(process.argv[2]), profile = resolve(process.argv[3] || ''), stage = process.argv[4], appPid = Number(process.argv[5]), codex = process.argv[6];
if (!Number.isInteger(port) || !Number.isInteger(appPid) || !/^integration-native-[a-f0-9]{32}$/.test(basename(profile)) || !['exercise', 'restart'].includes(stage)) throw Error('Use the isolated integration launcher');
let browser;
for (let n = 0; n < 150; n++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await new Promise(done => setTimeout(done, 200)); } }
if (!browser) throw Error('Diagnostic WebView unavailable');
const page = browser.contexts()[0].pages().find(p => !new URL(p.url()).searchParams.has('capture'));
if (new URL(page.url()).protocol === 'file:' || ['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname)) throw Error('Diagnostic must embed the production frontend');
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const load = () => invoke('load_workspace');
const editor = page.getByRole('textbox', { name: 'Note content', exact: true });
const exec = promisify(execFile), wait = ms => new Promise(done => setTimeout(done, ms));
const statePath = join(profile, 'integration-state.json');
let endpoint, authorization, protocol = '2026-07-28';
async function rpc(method, params = {}, headers = {}) {
  if (protocol === '2026-07-28' && method === 'tools/call') headers = { 'MCP-Name': params.name, ...headers };
  if (protocol === '2026-07-28') params = { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': protocol, 'io.modelcontextprotocol/clientCapabilities': {} } };
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: authorization, 'MCP-Protocol-Version': protocol, 'MCP-Method': method, ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), signal: AbortSignal.timeout(140000) });
  const body = await response.text();
  if (!response.ok) throw Error(`MCP ${method} HTTP ${response.status}: ${body.slice(0, 400)}`);
  const data = JSON.parse(body.startsWith('data:') ? body.split('\n').find(line => line.startsWith('data:')).slice(5) : body);
  if (data.error) throw Error(`MCP ${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}
async function tool(name, args = {}, code) {
  const response = await rpc('tools/call', { name, arguments: args });
  const value = response.structuredContent || JSON.parse(response.content[0].text);
  if (code) expect(value.error?.code).toBe(code);
  else if (value.error) throw Error(`${name}: ${JSON.stringify(value.error)}`);
  return value;
}
async function paired() {
  const mcp = JSON.parse(await readFile(join(profile, 'codex-profile/.codex/plugins/scribly-local/.mcp.json'), 'utf8'));
  endpoint = mcp.mcpServers.scribly.url; authorization = mcp.mcpServers.scribly.http_headers.Authorization;
}
async function metric() {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${appPid} | Select-Object WorkingSet64,CPU | ConvertTo-Json -Compress`]);
  return JSON.parse(stdout);
}
async function codexDiscovery(env, cwd) {
  const child = spawn(codex, ['app-server', '--stdio'], { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', id = 0; const pending = new Map();
  child.stdout.setEncoding('utf8'); child.stderr.resume();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) !== -1;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const handler = pending.get(message.id); if (!handler) continue;
      clearTimeout(handler.timer); pending.delete(message.id);
      if (message.error) handler.reject(Error('Codex app-server rejected discovery request'));
      else handler.resolve(message.result);
    }
  });
  const failed = () => { for (const handler of pending.values()) { clearTimeout(handler.timer); handler.reject(Error('Codex app-server stopped')); } pending.clear(); };
  child.on('error', failed); child.on('exit', failed);
  const call = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error('Codex MCP discovery timed out')); }, 55000);
    pending.set(requestId, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
  try {
    await call('initialize', { clientInfo: { name: 'scribly-diagnostic', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const inventory = await call('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' });
    const server = inventory.data.find(server => server.name.includes('scribly'));
    if (!Object.keys(server?.tools || {}).length) console.log('Codex discovery diagnostics:', { name: server?.name, runtimeStatus: server?.runtimeStatus, authStatus: server?.authStatus, toolsError: server?.toolsError?.replaceAll(authorization, '[credential]').replaceAll(authorization.slice(7), '[credential]') });
    expect(server?.pluginId).toBeTruthy(); expect(Object.keys(server.tools)).toHaveLength(10); expect(server.toolsError ?? null).toBeNull();
  } finally { child.stdin.end(); child.kill(); }
}
try {
  await editor.waitFor({ timeout: 30000 });
  await expect.poll(async () => (await invoke('integration_status')).ready, { timeout: 15000 }).toBe(true);
  if (stage === 'exercise') {
    const initial = await invoke('integration_status'); expect(initial.enabled).toBe(false); expect(initial.policy.readOnly).toBe(true); expect(initial.policy.allowedFolderIds).toEqual([]); expect(initial.clients).toEqual([]);
    await wait(1000); const baseline = await metric();
    const busy = createServer(); await new Promise(done => busy.listen(0, '127.0.0.1', done));
    const busyPort = busy.address().port;
    const notebook = (await load()).document, active = notebook.activeId;
    const config = { enabled: true, port: busyPort, policy: { readOnly: true, allowedFolderIds: [], allowUnfiled: false } };
    const blocked = await invoke('integration_set_config', config); expect(blocked.listening).toBe(false); expect(blocked.error).toContain('unavailable');
    await new Promise(done => busy.close(done));
    const ready = await invoke('integration_set_config', config); expect(ready.listening).toBe(true);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Accounts & Advanced', exact: true }).click();
    await expect(page.getByLabel('Enable local Codex connection')).toBeChecked();
    await expect(page.getByLabel('Allow creating and editing notes')).not.toBeChecked();
    await page.getByRole('heading', { name: 'Codex integration', exact: true }).scrollIntoViewIfNeeded();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    for (const value of ['light', 'dark']) { await page.evaluate(value => { document.documentElement.dataset.theme = value; }, value); await page.screenshot({ path: join(profile, `settings-${value}.png`) }); }
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole('button', { name: 'Install Codex plugin', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Revoke access', exact: true })).toBeVisible();
    await expect(page.getByText('Paired plugin prepared.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await paired();
    // The paired secret is intentionally never printed, including in CLI output.
    const encrypted = await readFile(join(profile, 'integration.bin')); expect(encrypted.includes(Buffer.from(authorization.slice(7)))).toBe(false);
    if (!codex) throw Error('Codex CLI is required for plugin acceptance');
    const codexProfile = join(profile, 'codex-profile'), env = { ...process.env, CODEX_HOME: join(codexProfile, '.codex'), USERPROFILE: codexProfile };
    await exec(codex, ['plugin', 'marketplace', 'add', codexProfile, '--json'], { env });
    const added = JSON.parse((await exec(codex, ['plugin', 'add', 'scribly@scribly-local', '--json'], { env })).stdout);
    expect(JSON.stringify(added)).toContain('scribly');
    const listed = JSON.parse((await exec(codex, ['plugin', 'list', '--json'], { env })).stdout);
    expect(JSON.stringify(listed)).toContain('scribly');
    // Read the installed cache to prove the transport and credential survived installation.
    const cache = join(codexProfile, '.codex/plugins/cache');
    async function findMcp(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) { const found = await findMcp(file); if (found) return found; } else if (entry.name === '.mcp.json') return file; } }
    const cached = JSON.parse(await readFile(await findMcp(cache), 'utf8')); expect(cached.mcpServers.scribly.http_headers.Authorization).toBe(authorization);
    const tools = await rpc('tools/list'); expect(tools.tools).toHaveLength(10);
    await codexDiscovery(env, codexProfile);
    console.log('Codex loaded the installed plugin and discovered all ten tools through its native MCP client.');
    expect((await tool('get_status')).read_only).toBe(true);
    expect((await tool('list_folders')).folders).toEqual([]);
    await tool('read_note', { note_id: active }, 'NOT_FOUND');
    await tool('create_folder', { name: 'Denied', request_id: randomUUID() }, 'FORBIDDEN');
    await tool('get_status', { unexpected: 'field' }, 'INVALID_INPUT');
    for (const [headers, status] of [[{ Authorization: 'Bearer wrong' }, 401], [{ Origin: 'https://evil.invalid' }, 403], [{ Host: 'evil.invalid' }, 403]]) {
      const received = await new Promise((resolve, reject) => {
        const request = httpRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, ...headers } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
        request.on('error', reject); request.end('{}');
      });
      expect(received).toBe(status);
    }
    const oversized = await fetch(endpoint, { method: 'POST', headers: { Authorization: authorization }, body: 'x'.repeat(65537) }); expect(oversized.status).toBe(413); await oversized.body?.cancel();
    // Older Codex clients can initialize and use the same stateless authenticated endpoint.
    protocol = '2025-11-25'; expect((await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'fixture', version: '1' } })).protocolVersion).toBe(protocol);
    expect((await tool('get_status')).ready).toBe(true); protocol = '2026-07-28';
    config.policy = { readOnly: false, allowedFolderIds: notebook.folders.map(f => f.id), allowUnfiled: false };
    await invoke('integration_set_config', config);
    const folderRequest = { name: 'Task Reports', request_id: randomUUID() };
    const folders = await Promise.all([tool('create_folder', folderRequest), tool('create_folder', folderRequest)]); expect(folders[0].folder_id).toBe(folders[1].folder_id); expect(folders[0].saved).toBe(true);
    await tool('create_folder', { ...folderRequest, name: 'Changed' }, 'REQUEST_ID_REUSED');
    const sameId = randomUUID();
    const raced = await Promise.all(['Race A', 'Race B'].map(name => rpc('tools/call', { name: 'create_folder', arguments: { name, request_id: sameId } })));
    expect(raced.filter(result => result.structuredContent?.saved)).toHaveLength(1);
    expect(raced.filter(result => result.structuredContent?.error?.code === 'REQUEST_ID_REUSED')).toHaveLength(1);
    const noteArgs = { folder_id: folders[0].folder_id, title: 'Integration Report', text: 'Original 日本語 sentence.', request_id: randomUUID() };
    const created = await tool('create_note', noteArgs); expect(created.saved).toBe(true); expect((await load()).document.activeId).toBe(active);
    expect((await tool('create_note', noteArgs)).note_id).toBe(created.note_id);
    const read = await tool('read_note', { note_id: created.note_id }); expect(read.version).toBe(created.version); expect(read.snapshot).toBe('live');
    const appended = await tool('append_note', { note_id: created.note_id, text: 'Appended once.', expected_version: read.version, request_id: randomUUID() });
    await tool('append_note', { note_id: created.note_id, text: 'Stale', expected_version: read.version, request_id: randomUUID() }, 'VERSION_CONFLICT');
    const replaced = await tool('replace_note_text', { note_id: created.note_id, exact_text: '日本語', replacement: '世界', expected_version: appended.version, request_id: randomUUID() }); expect(replaced.saved).toBe(true);
    // Active-editor mutations preserve focus, selection, live typing and Undo.
    await editor.fill('Keep the important text.'); await editor.click();
    await page.evaluate(() => { const dom = document.querySelector('[aria-label="Note content"]'); const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode()) && !node.textContent.includes('Keep the important text.')) {} if (!node) throw Error('Edited text node unavailable'); const range = document.createRange(); range.setStart(node, 1); range.setEnd(node, 4); getSelection().removeAllRanges(); getSelection().addRange(range); });
    const selection = await page.evaluate(() => ({ text: getSelection().toString(), focus: document.activeElement.getAttribute('aria-label') }));
    const live = await tool('read_note', { note_id: active });
    const activeEdit = await tool('replace_note_text', { note_id: active, exact_text: 'the important', replacement: 'this useful', expected_version: live.version, request_id: randomUUID() }); expect(activeEdit.saved).toBe(true);
    expect(await page.evaluate(() => ({ text: getSelection().toString(), focus: document.activeElement.getAttribute('aria-label') }))).toEqual(selection);
    await page.keyboard.press('Control+z'); await expect(editor).toContainText('the important');
    await editor.press('End'); await page.keyboard.type(' User typing.');
    await tool('append_note', { note_id: active, text: 'Would overwrite typing', expected_version: activeEdit.version, request_id: randomUUID() }, 'VERSION_CONFLICT');
    await page.evaluate(() => document.querySelector('[aria-label="Note content"]').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '文' })));
    const composing = await tool('read_note', { note_id: active }); await tool('append_note', { note_id: active, text: 'Busy', expected_version: composing.version, request_id: randomUUID() }, 'BUSY');
    await page.evaluate(() => document.querySelector('[aria-label="Note content"]').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
    await expect.poll(async () => (await tool('get_status')).unsaved, { timeout: 15000 }).toBe(false);
    await wait(1000); const enabled = await metric(); const cpuStart = enabled.CPU; await wait(5000); const idle = await metric();
    const metrics = { baselineBytes: baseline.WorkingSet64, enabledBytes: enabled.WorkingSet64, enabledIdleCpuSecondsOverFiveSeconds: idle.CPU - cpuStart, includesPluginAndToolWarmup: true };
    // Failure leaves a recoverable dirty document with the same pending receipt.
    const original = await tool('read_note', { note_id: created.note_id });
    const recoveryArgs = { note_id: created.note_id, text: 'Recovered command exactly once.', expected_version: original.version, request_id: randomUUID() };
    await page.evaluate(() => {
      const internals = window.__TAURI_INTERNALS__, original = window.fetch.bind(window);
      const targets = new Set(['save_workspace', 'save_workspace_delta'].map(command => internals.convertFileSrc(command, 'ipc')));
      window.__integrationSaveFailures = 0;
      window.fetch = async (input, options) => {
        if (targets.has(input instanceof Request ? input.url : String(input))) {
          window.__integrationSaveFailures++;
          return new Response(JSON.stringify('Synthetic integration save failure'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } });
        }
        return original(input, options);
      };
    });
    await tool('append_note', recoveryArgs, 'SAVE_FAILED'); expect((await tool('get_operation_status', { request_id: recoveryArgs.request_id })).status).toBe('pending');
    expect(await page.evaluate(() => window.__integrationSaveFailures)).toBeGreaterThan(0);
    await expect(page.locator('.storage-error')).toContainText('Synthetic integration save failure');
    const receipt = await page.evaluate(() => JSON.parse(localStorage.getItem('still-notes-recovery-v2')).integrationReceiptIds); expect(receipt).toHaveLength(1);
    await writeFile(statePath, JSON.stringify({ recoveryArgs, folderRequest, noteId: created.note_id, folderId: folders[0].folder_id, metrics, clientId: (await invoke('integration_status')).clients[0].id }));
    console.log('Native protocol, scoped tools, private plugin install, editor and failed-save checks passed; restarting diagnostic.');
  } else {
    const state = JSON.parse(await readFile(statePath, 'utf8')); await paired();
    await expect.poll(async () => (await tool('get_operation_status', { request_id: state.recoveryArgs.request_id })).status, { timeout: 20000 }).toBe('committed');
    const result = await tool('append_note', state.recoveryArgs); expect(result.saved).toBe(true);
    const note = await tool('read_note', { note_id: state.noteId }); expect(note.version).toBe(result.version); expect(note.text.match(/Recovered command exactly once\./g)).toHaveLength(1);
    // A retry must never re-share a folder removed from the allowlist by its owner.
    const access = await invoke('integration_status');
    await invoke('integration_set_config', { enabled: true, port: access.port, policy: { ...access.policy, allowedFolderIds: access.policy.allowedFolderIds.filter(id => id !== state.folderId) } });
    await tool('create_folder', state.folderRequest);
    expect((await invoke('integration_status')).policy.allowedFolderIds).not.toContain(state.folderId);
    await tool('read_note', { note_id: state.noteId }, 'NOT_FOUND');
    const saved = await load(); expect(saved.document.notes.find(n => n.id === state.noteId).content).toContain('Recovered command exactly once.');
    const client = (await invoke('integration_status')).clients[0]; await invoke('integration_revoke', { clientId: client.id });
    const revoked = await fetch(endpoint, { method: 'POST', headers: { Authorization: authorization }, body: '{}' }); expect(revoked.status).toBe(401); await revoked.body?.cancel();
    const oldAuthorization = authorization;
    await invoke('integration_install_plugin'); await paired(); expect(authorization).not.toBe(oldAuthorization);
    const codexProfile = join(profile, 'codex-profile'), env = { ...process.env, CODEX_HOME: join(codexProfile, '.codex'), USERPROFILE: codexProfile };
    await exec(codex, ['plugin', 'remove', 'scribly@scribly-local', '--json'], { env });
    await exec(codex, ['plugin', 'add', 'scribly@scribly-local', '--json'], { env });
    await codexDiscovery(env, codexProfile);
    expect((await tool('get_status')).ready).toBe(true);
    await invoke('integration_remove_plugin'); expect((await invoke('integration_status')).clients).toEqual([]);
    await exec(codex, ['plugin', 'remove', 'scribly@scribly-local', '--json'], { env });
    await invoke('integration_set_config', { enabled: false, port: Number(new URL(endpoint).port), policy: { readOnly: true, allowedFolderIds: [], allowUnfiled: false } });
    expect((await invoke('integration_status')).listening).toBe(false);
    await writeFile(join(profile, 'integration-result.json'), JSON.stringify({ ok: true, realWebView2Postgres: true, privateCodexPluginInstallation: true, codexNativeToolDiscovery: true, authenticatedNewAndLegacyMcp: true, scopedReadsAndWrites: true, concurrentRetries: true, activeSelectionFocusUndo: true, staleAndCompositionBlocked: true, failedSaveCrashRecoveryExactlyOnce: true, revokedScopeSurvivesRetry: true, revokeReinstallDisable: true, metrics: state.metrics }, null, 2));
    await page.getByRole('button', { name: 'Close window', exact: true }).click(); console.log('Native restart, exactly-once recovery, revocation and shutdown checks passed.');
  }
} catch (error) { await page.screenshot({ path: join(profile, `failed-${stage}.png`) }).catch(() => {}); throw error; }
finally { await browser.close().catch(() => {}); }

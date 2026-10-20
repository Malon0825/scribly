import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', 'Focused module fixtures require Vite module routing');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
});

for (const theme of ['notebook', 'light', 'dark'] as const) test(`Codex settings permissions stay accessible and scoped in ${theme}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/src/IntegrationSettings.tsx*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/import \{ desktop \} from "([^\"]+)";/, 'const desktop = true;');
    await route.fulfill({ response, body });
  });
  await page.evaluate(theme => {
    const saved = { revision: 1, dataPath: 'Test', document: { schemaVersion: 5, theme, activeId: 'test-note', referenceId: null, folders: [] as { id: string; name: string; deletedAt?: string }[], notes: [{ id: 'test-note', title: 'Test note', folderId: null, content: '<p>Preserved writing.</p>', archived: false, createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z' }] } };
    saved.document.folders = [
      { id: 'daily', name: 'Discord Daily Task' }, { id: 'report', name: 'Task Report' },
      { id: 'pipeline', name: 'Data Pipeline Meeting' }, { id: 'notepad', name: 'Notepad Notes' },
      { id: 'misc', name: 'Misc' }, { id: 'intro', name: 'Introduction' },
      { id: 'private', name: 'Key, Token, Secrets' },
      { id: 'long', name: 'A long folder name that should wrap without separating its checkbox from the label' },
      { id: 'deleted', name: 'Deleted private folder', deletedAt: '2026-10-10T00:00:00Z' },
    ];
    localStorage.setItem('still-notes-browser-v1', JSON.stringify(saved));
  }, theme);
  await page.addInitScript(() => {
    const initial = { enabled: false, port: 14327, policy: { readOnly: true, allowUnfiled: false, allowedFolderIds: ['daily'] }, clients: [], listening: false, ready: true, error: null, url: 'http://127.0.0.1:14327' };
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string, args?: Partial<typeof initial>) => {
      const status = JSON.parse(localStorage.getItem('integration-settings-fixture') || JSON.stringify(initial));
      if (command === 'integration_status') return status;
      if (command === 'integration_set_config') {
        Object.assign(status, args, { listening: args?.enabled });
        localStorage.setItem('integration-settings-fixture', JSON.stringify(status));
        return status;
      }
      throw Error(`Unexpected fixture command: ${command}`);
    } } });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Accounts & Advanced', exact: true }).click();
  const connection = settings.getByRole('checkbox', { name: 'Enable local Codex connection', exact: true });
  await expect(connection).toBeEnabled();
  await expect(settings.getByRole('checkbox', { name: 'Deleted private folder' })).toHaveCount(0);
  await settings.screenshot({ path: `test-results/codex-settings-${theme}.png` });
  await settings.getByText('Enable local Codex connection', { exact: true }).click();
  await expect(connection).toBeChecked();
  await settings.locator('summary').filter({ hasText: 'Permissions & shared folders' }).click();
  const edit = settings.getByRole('checkbox', { name: 'Allow creating and editing notes', exact: true });
  await edit.focus(); await page.keyboard.press('Space');
  await expect(edit).toBeChecked();
  await settings.getByText('Task Report', { exact: true }).click();
  const report = settings.getByRole('checkbox', { name: 'Task Report', exact: true });
  await expect(report).toBeChecked();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('integration-settings-fixture')!));
  expect((await saved()).policy).toEqual({ readOnly: false, allowUnfiled: false, allowedFolderIds: ['daily', 'report'] });
  const long = settings.getByRole('checkbox', { name: 'A long folder name that should wrap without separating its checkbox from the label', exact: true });
  await long.focus(); await page.keyboard.press('Space'); await expect(long).toBeChecked();
  await page.setViewportSize({ width: 850, height: 600 });
  await expect.poll(() => settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await long.scrollIntoViewIfNeeded();
  await settings.screenshot({ path: `test-results/codex-settings-${theme}-compact.png` });
  await settings.locator('summary').filter({ hasText: 'Codex connection setup' }).click();
  const port = settings.getByRole('spinbutton', { name: 'Local port', exact: true });
  await port.fill('80'); await expect(settings.getByRole('button', { name: 'Save port', exact: true })).toBeDisabled();
  await port.fill('14328'); await settings.getByRole('button', { name: 'Save port', exact: true }).click();
  await expect.poll(async () => (await saved()).port).toBe(14328);
  await page.setViewportSize({ width: 1440, height: 920 });
  await settings.getByRole('button', { name: 'Install Codex plugin', exact: true }).scrollIntoViewIfNeeded();
  await settings.screenshot({ path: `test-results/codex-settings-${theme}-actions.png` });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByRole('tab', { name: 'Accounts & Advanced', exact: true }).click();
  await settings.locator('summary').filter({ hasText: 'Permissions & shared folders' }).click();
  await expect(connection).toBeChecked(); await expect(edit).toBeChecked(); await expect(report).toBeChecked();
});

test('scoped reads include shared meeting notes while excluding private, archived and board content and detecting live edits', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration, noteVersion } = await import('/src/integration.ts');
    const base = { id: 'visible', title: 'Daily report', folderId: 'shared', content: '<p>Draft 日本語 report.</p>', archived: false, createdAt: 'now', updatedAt: 'now' };
    const workspace = { folders: [{ id: 'shared', name: 'Task Report' }, { id: 'private', name: 'Secrets' }], notes: [base, { ...base, id: 'private', folderId: 'private', content: '<p>secret-token</p>' }, { ...base, id: 'archived', archived: true }, { ...base, id: 'meeting', meeting: { role: 'transcript' } }, { ...base, id: 'board', kind: 'board' }], theme: 'light', activeId: 'visible', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => true, savedRevision: () => 3, enqueueIntegration: async () => { throw Error('Unexpected write'); } };
    const request = (tool: string, args = {}) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: true, allowedFolderIds: ['shared'], allowUnfiled: false } });
    const listed = await executeIntegration(request('search_notes', { query: 'report' }), writer);
    const read = await executeIntegration(request('read_note', { note_id: 'visible', limit: 8 }), writer);
    let forbidden = ''; try { await executeIntegration(request('read_note', { note_id: 'private' }), writer); } catch (e) { forbidden = String(e); }
    return { listed, read, forbidden, changed: await noteVersion(base) !== await noteVersion({ ...base, content: '<p>New typing</p>' }) };
  });
  expect(result.listed.notes.map((n: { id: string }) => n.id)).toEqual(['visible', 'meeting']);
  expect(JSON.stringify(result.listed)).not.toContain('secret-token');
  expect(result.read.snapshot).toBe('live'); expect(result.read.unsaved).toBe(true);
  expect(result.read.next_offset).toBe(8); expect(result.forbidden).toContain('NOT_FOUND'); expect(result.changed).toBe(true);
});

test('active rich-text edits preserve selection, focus and a separate undo group', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editorEdit } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js'); const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const host = document.createElement('div'); document.body.append(host);
    const editor = new Editor({ element: host, extensions: [StarterKit], content: '<p>Keep <strong>the important</strong> text.</p><p>Reference.</p>' });
    editor.commands.setTextSelection({ from: 2, to: 5 });
    const focus = document.activeElement, selection = { from: editor.state.selection.from, to: editor.state.selection.to };
    editorEdit(editor, 'replace_note_text', { exact_text: 'the important', replacement: 'this useful' }).apply();
    const html = editor.getHTML(), sameSelection = editor.state.selection.from === selection.from && editor.state.selection.to === selection.to, sameFocus = document.activeElement === focus;
    editor.commands.undo(); const undone = editor.getHTML();
    editorEdit(editor, 'append_note', { text: 'New paragraph\nSecond paragraph' }).apply();
    const appended = editor.getHTML(); editor.commands.undo(); const appendUndone = editor.getHTML();
    editor.commands.setContent('<p>Imported <b>bold</b> text.</p>');
    const { executeIntegration, noteVersion } = await import('/src/integration.ts');
    let workspace = { folders: [], notes: [{ id: 'import', title: 'Imported', folderId: null, content: '<p>Imported <b>bold</b> text.</p>', archived: false, createdAt: 'now', updatedAt: 'now' }], theme: 'light', activeId: 'import', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => ({ noteId: 'import', editor }), isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); change.applyEditor?.(); workspace = change.workspace; return change.result; } };
    await executeIntegration({ id: 'dispatch', generation: 'generation', clientId: 'client', tool: 'append_note', args: { note_id: 'import', text: 'Append to imported HTML.', expected_version: await noteVersion(workspace.notes[0]) }, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } }, writer);
    const imported = editor.getHTML();
    editor.destroy(); host.remove(); return { html, sameSelection, sameFocus, undone, appended, appendUndone, imported };
  });
  expect(result.html).toContain('<strong>this useful</strong>'); expect(result.sameSelection).toBe(true); expect(result.sameFocus).toBe(true);
  expect(result.undone).toContain('<strong>the important</strong>');
  expect(result.appended).toContain('<p>New paragraph</p><p>Second paragraph</p>'); expect(result.appendUndone).toBe(result.undone);
  expect(result.imported).toContain('<strong>bold</strong>'); expect(result.imported).toContain('<p>Append to imported HTML.</p>');
});

test('inactive replacements preserve opaque blocks and reject ambiguous passages', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { inactiveReplacement } = await import('/src/integration.ts');
    const html = '<p data-note-block="anchor">Hello <strong>日本語</strong> reader.</p><div data-type="sourceFile" data-source-id="file"><span contenteditable="false">Original file</span></div><p><img src="asset:test" data-width="200"></p>';
    const changed = inactiveReplacement(html, '日本語', '世界');
    let ambiguous = false; try { inactiveReplacement('<p>Same Same</p>', 'Same', 'Other'); } catch { ambiguous = true; }
    return { changed, ambiguous };
  });
  expect(result.changed).toContain('<strong>世界</strong>'); expect(result.changed).toContain('data-note-block="anchor"');
  expect(result.changed).toContain('data-source-id="file"'); expect(result.changed).toContain('data-width="200"'); expect(result.ambiguous).toBe(true);
});

test('formatted Codex prose uses document headings and lists while preserving selection and undo', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editorEdit } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const host = document.createElement('div'); document.body.append(host);
    const original = '<h2>Summary</h2><p>Keep the original writing.</p>';
    const editor = new Editor({ element: host, extensions: [StarterKit], content: original });
    editor.commands.focus(); editor.commands.setTextSelection({ from: 12, to: 16 });
    const selection = { from: editor.state.selection.from, to: editor.state.selection.to }, focus = document.activeElement;
    const change = editorEdit(editor, 'append_note', { format: 'html', text: '<h2>Executive summary</h2>\n<p>Three priorities.</p>\n<ul><li><p><strong>RMS:</strong> Freshness checks.</p></li><li><p><em>Backfill:</em> Access pending.</p></li></ul><h3>Next steps</h3><ol><li><p>Review thresholds.</p></li></ol>' });
    change.apply();
    const html = editor.getHTML(), heading = host.querySelector('h2:last-of-type')?.textContent;
    const lists = host.querySelectorAll('ul li').length, emptyParagraphs = Array.from(host.querySelectorAll('p')).filter(p => !p.textContent).length;
    const sameSelection = editor.state.selection.from === selection.from && editor.state.selection.to === selection.to;
    const sameFocus = document.activeElement === focus;
    editor.commands.undo(); const undone = editor.getHTML();
    editor.destroy(); host.remove();
    return { html, stagedHtml: change.html, heading, lists, emptyParagraphs, sameSelection, sameFocus, undone, original };
  });
  expect(result.heading).toBe('Executive summary'); expect(result.lists).toBe(2);
  expect(result.emptyParagraphs).toBe(1); // The editor's single trailing caret paragraph.
  expect(result.html).toContain('<strong>RMS:</strong>'); expect(result.html).toContain('<h3>Next steps</h3><ol>');
  expect(result.stagedHtml).toBe(result.html);
  expect(result.sameSelection).toBe(true); expect(result.sameFocus).toBe(true); expect(result.undone).toBe(result.original);
});

test('formatted Codex creation and inactive appends preserve opaque blocks and survive editor hydration', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const original = '<h3>Existing section</h3><p data-note-block="anchor">Original writing.</p><div data-type="sourceFile" data-source-id="keep">Original file</div>';
    let workspace = { folders: [], notes: [{ id: 'note', title: 'Existing note', folderId: null, content: original, archived: false, createdAt: 'now', updatedAt: 'now' }], theme: 'light', activeId: 'note', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); workspace = change.workspace; return change.result; } };
    const request = (tool: string, args: Record<string, unknown>) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } });
    const read = await executeIntegration(request('read_note', { note_id: 'note' }), writer);
    const formatted = '<h3>Executive summary</h3><p>日本語 &amp; &lt;literal&gt;.</p><ul><li><p><strong>RMS:</strong> Freshness checks.</p></li></ul>';
    await executeIntegration(request('append_note', { note_id: 'note', text: formatted, format: 'html', expected_version: read.version }), writer);
    const appended = workspace.notes[0].content;
    const created = await executeIntegration(request('create_note', { folder_id: null, title: 'Formatted note', text: formatted, format: 'html' }), writer);
    const createdNote = workspace.notes.find(note => note.id === created.note_id)!;
    const editor = new Editor({ extensions: [StarterKit], content: createdNote.content });
    const hydrated = editor.getHTML(); editor.destroy();
    const unchanged = workspace.notes[0].content;
    let conflict = ''; try { await executeIntegration(request('append_note', { note_id: 'note', text: formatted, format: 'html', expected_version: read.version }), writer); } catch (error) { conflict = String(error); }
    const legacy = await executeIntegration(request('create_note', { folder_id: null, title: 'Literal text', text: '<h2>literal</h2>\n• raw bullet' }), writer);
    return { original, appended, created: createdNote.content, hydrated, headingLevel: read.section_heading_level, conflict, preserved: workspace.notes[0].content === unchanged, legacy: workspace.notes.find(note => note.id === legacy.note_id)!.content };
  });
  expect(result.appended.startsWith(result.original)).toBe(true);
  expect(result.appended).toContain('<h3>Executive summary</h3>'); expect(result.created).toBe(result.hydrated);
  expect(result.created).toContain('<ul><li><p><strong>RMS:</strong>'); expect(result.headingLevel).toBe(3);
  expect(result.conflict).toContain('VERSION_CONFLICT'); expect(result.preserved).toBe(true);
  expect(result.legacy).toBe('<p>&lt;h2&gt;literal&lt;/h2&gt;</p><p>• raw bullet</p>');
});

test('formatted Codex writes reject executable, styled and unsupported HTML without changing notes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration, noteVersion, editorEdit } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Preserved.</p>' });
    let workspace = { folders: [], notes: [{ id: 'note', title: 'Existing note', folderId: null, content: editor.getHTML(), archived: false, createdAt: 'now', updatedAt: 'now' }], theme: 'light', activeId: 'note', referenceId: null };
    const original = workspace.notes[0].content, version = await noteVersion(workspace.notes[0]);
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); workspace = change.workspace; return change.result; } };
    const errors: string[] = [], activeErrors: string[] = [];
    for (const text of ['<script>alert(1)</script>', '<p onclick="alert(1)">Text</p>', '<p style="font-size:99px">Text</p>', '<p><img src="https://example.com/tracker"></p>', '<p><a href="javascript:alert(1)">Text</a></p>', '<ul><li>Unstructured item</li></ul>', 'Unwrapped text']) {
      try { editorEdit(editor, 'append_note', { text, format: 'html' }).apply(); } catch (error) { activeErrors.push(String(error)); }
      try { await executeIntegration({ id: 'dispatch', generation: 'generation', clientId: 'client', tool: 'append_note', args: { note_id: 'note', text, format: 'html', expected_version: version }, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } }, writer); } catch (error) { errors.push(String(error)); }
    }
    const active = editor.getHTML(); editor.destroy();
    return { errors, activeErrors, preserved: workspace.notes[0].content === original, active, original };
  });
  expect(result.errors).toHaveLength(7); expect(result.activeErrors).toHaveLength(7);
  expect(result.errors.every(error => error.includes('UNSUPPORTED_CONTENT'))).toBe(true);
  expect(result.preserved).toBe(true); expect(result.active).toBe(result.original);
});

test('Unicode results respect the byte budget and continue without losing rows or text', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    const notes = Array.from({ length: 50 }, (_, index) => ({ id: String(index), title: '日本語'.repeat(66), folderId: null, content: `<p>${'日本語'.repeat(3000)}</p>`, archived: false, createdAt: 'now', updatedAt: 'now' }));
    const workspace = { folders: [], notes, theme: 'light', activeId: '0', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async () => { throw Error('Unexpected write'); } };
    const request = (tool: string, args: Record<string, unknown>) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: true, allowedFolderIds: [], allowUnfiled: true } });
    let offset: number | null = 0, total = 0, largest = 0;
    do { const page = await executeIntegration(request('search_notes', { query: '日本語', offset }), writer); total += page.notes.length; largest = Math.max(largest, new TextEncoder().encode(JSON.stringify(page)).length); offset = page.next_offset; } while (offset !== null);
    let text = ''; offset = 0;
    do { const read = await executeIntegration(request('read_note', { note_id: '0', offset }), writer); text += read.text; largest = Math.max(largest, new TextEncoder().encode(JSON.stringify(read)).length); offset = read.next_offset; } while (offset !== null);
    notes[0].content = '<p>😀 pair</p>';
    notes[0].title = 'a'.repeat(199) + '😀';
    const emoji = await executeIntegration(request('read_note', { note_id: '0', limit: 1 }), writer);
    let split = ''; try { await executeIntegration(request('read_note', { note_id: '0', offset: 1 }), writer); } catch (error) { split = String(error); }
    return { total, largest, textLength: text.trim().length, emoji, split };
  });
  expect(result.total).toBe(50); expect(result.largest).toBeLessThanOrEqual(32768); expect(result.textLength).toBe(9000);
  expect(result.emoji.text).toBe('😀'); expect(result.emoji.next_offset).toBe(2); expect(result.emoji.title).toBe('a'.repeat(199)); expect(result.split).toContain('INVALID_INPUT');
});

test('recovered dirty documents retain the native operation receipt and stale revisions isolate it', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RecoveryJournal } = await import('/src/recovery.ts');
    const saved = await (await import('/src/storage.ts')).loadWorkspace();
    const store = new Map<string, string>(); const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, key: (i: number) => Array.from(store.keys())[i] ?? null, get length() { return store.size; } };
    const id = `${crypto.randomUUID()}:${crypto.randomUUID()}`;
    const journal = new RecoveryJournal(storage); journal.write(saved.document, saved.revision, true, [id]);
    const restored = new RecoveryJournal(storage).restore(saved.document, saved.revision);
    const conflict = new RecoveryJournal(storage).restore(saved.document, saved.revision + 1);
    return { id, restored: restored.integrationReceiptIds, conflict: conflict.integrationReceiptIds, warning: conflict.warning };
  });
  expect(result.restored).toEqual([result.id]); expect(result.conflict).toBeUndefined(); expect(result.warning).toContain('previous draft');
});

test('tool discovery and reads explain unavailable items, preserve line breaks and reject mixed revision pages', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    const base = { id: 'normal', title: 'Shared note', folderId: 'shared', content: '<h3>Summary</h3><p>First<br>Second</p><div data-type="sourceFile">hidden attachment payload</div><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox"></label><div><p>Done</p></div></li></ul>', archived: false, createdAt: 'now', updatedAt: 'now' };
    let workspace = { folders: [{ id: 'shared', name: 'Shared' }, { id: 'private', name: 'Private' }], notes: [base, { ...base, id: 'meeting', meeting: { role: 'transcript' } }, { ...base, id: 'board', kind: 'board' }, { ...base, id: 'archived', archived: true, kind: 'board' }, { ...base, id: 'private', folderId: 'private' }], theme: 'light', activeId: 'normal', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async () => { throw Error('Unexpected write'); } };
    const request = (tool: string, args = {}, readOnly = true) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly, allowedFolderIds: ['shared'], allowUnfiled: false } });
    const status = await executeIntegration(request('get_status'), writer), writable = await executeIntegration(request('get_status', {}, false), writer);
    const folders = await executeIntegration(request('list_folders'), writer), notes = await executeIntegration(request('list_notes', { folder_id: 'shared' }), writer);
    const read = await executeIntegration(request('read_note', { note_id: 'normal', limit: 8 }), writer);
    const rest = await executeIntegration(request('read_note', { note_id: 'normal', offset: read.next_offset, expected_version: read.version }), writer);
    const hidden = await executeIntegration(request('search_notes', { query: 'hidden attachment' }), writer);
    workspace = { ...workspace, notes: workspace.notes.map(note => note.id === 'normal' ? { ...note, content: '<p>Changed while reading.</p>' } : note) };
    let conflict = ''; try { await executeIntegration(request('read_note', { note_id: 'normal', offset: read.next_offset, expected_version: read.version }), writer); } catch (error) { conflict = String(error); }
    workspace = { ...workspace, notes: workspace.notes.map(note => note.id === 'normal' ? { ...note, content: `<p>${'x'.repeat(1000020)}End</p>` } : note) };
    const large = await executeIntegration(request('read_note', { note_id: 'normal', offset: 1000020 }), writer);
    let outside = ''; try { await executeIntegration(request('read_note', { note_id: 'normal', offset: 1001000 }), writer); } catch (error) { outside = String(error); }
    return { status, writable, folders, notes, text: String(read.text) + String(rest.text), hidden, conflict, large: large.text, outside };
  });
  expect(result.status.write_formats).toEqual([]); expect(result.writable.write_formats).toEqual(['text', 'html']);
  expect(result.status.meeting_read).toBe(true); expect(result.status.unavailable).toContain('meeting edits');
  expect(result.folders.folders).toEqual([{ id: 'shared', name: 'Shared', note_count: 2, meeting_note_count: 1, unavailable_item_count: 1 }]);
  expect(result.notes.notes.map((note: { id: string }) => note.id)).toEqual(['normal', 'meeting']);
  expect(result.text).toBe('Summary\nFirst\nSecond\n[x] Done\n\n'); expect(result.hidden.notes).toEqual([]);
  expect(result.conflict).toContain('VERSION_CONFLICT'); expect(result.large).toBe('End\n'); expect(result.outside).toContain('INVALID_INPUT');
});

test('formatted replacement repairs existing sections without duplicates and preserves selection, undo and neighboring content', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration, noteVersion } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const outcomes = [];
    for (const active of [false, true]) {
      const host = document.createElement('div'); document.body.append(host);
      const original = '<h2>Summary</h2><p>Keep <strong>original writing.</strong></p><p>Executive summary</p><p></p><p>• RMS monitoring: Freshness checks.</p><p></p><p>• Backfill: Access pending.</p><p>Reference intact.</p>';
      const editor = new Editor({ element: host, extensions: [StarterKit], content: original });
      editor.commands.focus(); editor.commands.setTextSelection({ from: 2, to: 5 });
      const focus = document.activeElement, selection = { from: editor.state.selection.from, to: editor.state.selection.to };
      const opaque = active ? '' : '<div data-type="sourceFile" data-source-id="preserve">Original file</div>';
      let workspace = { folders: [], notes: [{ id: 'note', title: 'Existing note', folderId: null, content: original + opaque, archived: false, createdAt: 'now', updatedAt: 'now' }], theme: 'light', activeId: 'note', referenceId: null };
      const writer = { checkpoint: () => workspace, activeEditor: () => active ? { noteId: 'note', editor } : null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); change.applyEditor?.(); workspace = change.workspace; return change.result; } };
      const exact = 'Executive summary\n\n• RMS monitoring: Freshness checks.\n\n• Backfill: Access pending.';
      const replacement = '<h2>Executive summary</h2><ul><li><p><strong>RMS monitoring:</strong> Freshness checks.</p></li><li><p><strong>Backfill:</strong> Access pending.</p></li></ul>';
      await executeIntegration({ id: 'dispatch', generation: 'generation', clientId: 'client', tool: 'replace_note_text', args: { note_id: 'note', exact_text: exact, replacement, format: 'html', expected_version: await noteVersion(workspace.notes[0]) }, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } }, writer);
      const html = workspace.notes[0].content;
      const sameSelection = editor.state.selection.from === selection.from && editor.state.selection.to === selection.to, sameFocus = document.activeElement === focus;
      if (active) editor.commands.undo();
      outcomes.push({ active, html, sameSelection, sameFocus, undone: editor.getHTML(), original, opaque });
      editor.destroy(); host.remove();
    }
    return outcomes;
  });
  for (const item of result) {
    expect(item.html.match(/Executive summary/g)).toHaveLength(1);
    expect(item.html).toContain('<h2>Executive summary</h2><ul><li>'); expect(item.html).not.toContain('• RMS');
    expect(item.html).toContain('<strong>original writing.</strong>'); expect(item.html).toContain('Reference intact.');
    expect(item.sameSelection).toBe(true); expect(item.sameFocus).toBe(true);
    if (item.active) expect(item.undone).toBe(item.original); else expect(item.html.endsWith(item.opaque)).toBe(true);
  }
});

test('formatted replacements reject partial, ambiguous and protected blocks without mutation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration, noteVersion, editorEdit } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const cases = [
      { html: '<p>Keep this sentence.</p>', exact: 'this', code: 'UNSUPPORTED_CONTENT' },
      { html: '<p>Repeated</p><p>Repeated</p>', exact: 'Repeated', code: 'AMBIGUOUS_MATCH' },
      { html: '<p>Keep <a href="https://example.com">this link</a></p>', exact: 'Keep this link', code: 'UNSUPPORTED_CONTENT' },
    ];
    const outcomes = [];
    for (const item of cases) {
      const editor = new Editor({ extensions: [StarterKit], content: item.html });
      const original = editor.getHTML(); let activeError = '';
      try { editorEdit(editor, 'replace_note_text', { exact_text: item.exact, replacement: '<h2>Changed</h2>', format: 'html' }).apply(); } catch (error) { activeError = String(error); }
      let workspace = { folders: [], notes: [{ id: 'note', title: 'Note', folderId: null, content: item.html, archived: false, createdAt: 'now', updatedAt: 'now' }], theme: 'light', activeId: 'note', referenceId: null };
      const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); workspace = change.workspace; return change.result; } };
      let inactiveError = ''; try { await executeIntegration({ id: 'dispatch', generation: 'generation', clientId: 'client', tool: 'replace_note_text', args: { note_id: 'note', exact_text: item.exact, replacement: '<h2>Changed</h2>', format: 'html', expected_version: await noteVersion(workspace.notes[0]) }, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } }, writer); } catch (error) { inactiveError = String(error); }
      outcomes.push({ activeError, inactiveError, code: item.code, preserved: workspace.notes[0].content === item.html && editor.getHTML() === original });
      editor.destroy();
    }
    return outcomes;
  });
  for (const item of result) { expect(item.activeError).toContain(item.code); expect(item.inactiveError).toContain(item.code); expect(item.preserved).toBe(true); }
});

test('writes report no change, reject empty markup and keep literal replacement and Unicode limits honest', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration, noteVersion, editorEdit } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Keep</p>' });
    let workspace = { folders: [], notes: [{ id: 'note', title: 'Note', folderId: null, content: '<p>Keep</p>', archived: false, createdAt: 'now', updatedAt: 'now' }], theme: 'light', activeId: 'note', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); workspace = change.workspace; return change.result; } };
    const request = (tool: string, args: Record<string, unknown>) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } });
    let activeNoChange = ''; try { editorEdit(editor, 'replace_note_text', { exact_text: 'Keep', replacement: 'Keep' }).apply(); } catch (error) { activeNoChange = String(error); }
    let inactiveNoChange = ''; try { await executeIntegration(request('replace_note_text', { note_id: 'note', exact_text: 'Keep', replacement: 'Keep', expected_version: await noteVersion(workspace.notes[0]) }), writer); } catch (error) { inactiveNoChange = String(error); }
    let emptyMarkup = ''; try { await executeIntegration(request('create_note', { folder_id: null, title: 'Empty', text: '<ul></ul>', format: 'html' }), writer); } catch (error) { emptyMarkup = String(error); }
    await executeIntegration(request('replace_note_text', { note_id: 'note', exact_text: 'Keep', replacement: '**literal** <h2>text</h2>', expected_version: await noteVersion(workspace.notes[0]) }), writer);
    const literal = workspace.notes[0].content;
    const created = await executeIntegration(request('create_folder', { name: '😀'.repeat(200) }), writer);
    let tooLong = ''; try { await executeIntegration(request('create_folder', { name: '😀'.repeat(201) }), writer); } catch (error) { tooLong = String(error); }
    const count = workspace.notes.length; editor.destroy();
    return { activeNoChange, inactiveNoChange, emptyMarkup, literal, name: created.name, tooLong, count };
  });
  expect(result.activeNoChange).toContain('NO_CHANGE'); expect(result.inactiveNoChange).toContain('NO_CHANGE');
  expect(result.emptyMarkup).toContain('INVALID_INPUT'); expect(result.literal).toBe('<p>**literal** &lt;h2&gt;text&lt;/h2&gt;</p>');
  expect(result.name).toBe('😀'.repeat(200)); expect(result.tooLong).toContain('INVALID_INPUT'); expect(result.count).toBe(1);
});

test('literal replacements beside hard breaks and images preserve their boundaries in inactive and active notes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { inactiveReplacement, editorEdit } = await import('/src/integration.ts');
    const { Editor } = await import('/node_modules/@tiptap/core/dist/index.js');
    const { default: StarterKit } = await import('/node_modules/@tiptap/starter-kit/dist/index.js');
    const html = '<p>First<br>Second<img src="asset:test" data-width="200">Third<span contenteditable="false">Opaque</span>Fourth</p>';
    const changed = inactiveReplacement(html, 'Second', 'Updated');
    const errors = [];
    for (const exact of ['FirstSecond', 'SecondThird', 'ThirdOpaqueFourth', 'Opaque']) {
      try { inactiveReplacement(html, exact, 'Bad'); } catch (error) { errors.push(String(error)); }
    }
    const editor = new Editor({ extensions: [StarterKit], content: '<p>First<br>Second</p>' });
    const activeErrors = [];
    for (const exact of ['FirstSecond', '\uFFFC', 'First\uFFFCSecond']) {
      try { editorEdit(editor, 'replace_note_text', { exact_text: exact, replacement: 'Bad' }).apply(); } catch (error) { activeErrors.push(String(error)); }
    }
    editorEdit(editor, 'replace_note_text', { exact_text: 'Second', replacement: 'Updated' }).apply();
    const active = editor.getHTML(); editor.commands.undo(); const undone = editor.getHTML(); editor.destroy();
    const literal = new Editor({ extensions: [StarterKit], content: '<p>Literal \uFFFC value</p>' });
    editorEdit(literal, 'replace_note_text', { exact_text: '\uFFFC', replacement: 'character' }).apply();
    const literalText = literal.getText(); literal.destroy();
    return { changed, active, undone, errors, activeErrors, literalText };
  });
  expect(result.changed).toBe('<p>First<br>Updated<img src="asset:test" data-width="200">Third<span contenteditable="false">Opaque</span>Fourth</p>');
  expect(result.active).toBe('<p>First<br>Updated</p>'); expect(result.undone).toBe('<p>First<br>Second</p>');
  expect(result.errors).toHaveLength(4); expect(result.errors.every(error => error.includes('AMBIGUOUS_MATCH'))).toBe(true);
  expect(result.activeErrors).toHaveLength(3); expect(result.activeErrors.every(error => error.includes('AMBIGUOUS_MATCH'))).toBe(true);
  expect(result.literalText).toBe('Literal character value');
});

test('rejected formatted HTML stays inert before validation', async ({ page }) => {
  let requests = 0;
  await page.route('**/integration-unsafe-image.png', route => { requests++; return route.abort(); });
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    Object.assign(window, { integrationUnsafeHandler: false });
    const workspace = { folders: [], notes: [], theme: 'light', activeId: '', referenceId: null };
    let applied = false;
    const writer = { checkpoint: () => workspace, activeEditor: () => null, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { const change = await prepare(workspace); applied = true; return change.result; } };
    let error = ''; try { await executeIntegration({ id: 'dispatch', generation: 'generation', clientId: 'client', tool: 'create_note', args: { folder_id: null, title: 'Rejected', format: 'html', text: '<p><img src="/integration-unsafe-image.png" onerror="window.integrationUnsafeHandler=true"></p>' }, policy: { readOnly: false, allowedFolderIds: [], allowUnfiled: true }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } }, writer); } catch (reason) { error = String(reason); }
    return { error, applied };
  });
  // Absence of asynchronous loading needs a short observation window.
  await page.waitForTimeout(150);
  expect(result.error).toContain('UNSUPPORTED_CONTENT'); expect(result.applied).toBe(false); expect(requests).toBe(0);
  expect(await page.evaluate(() => window.integrationUnsafeHandler)).toBe(false);
});

test('shared meeting transcripts and summaries read current content, edits and completion without exposing recordings', async ({ page }) => {
  let requests = 0;
  await page.route('**/meeting-private-image.png', route => { requests++; return route.abort(); });
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    const { sampleMeeting } = await import('/src/meetings.ts');
    const { transcriptHtml } = await import('/src/meetingNotes.ts');
    let meeting = sampleMeeting('transcript', true);
    meeting.media = 'private-recording.wav'; meeting.video = 'private-video.mp4'; meeting.error = 'private-provider-diagnostic';
    const summaryId = meeting.analyses.find(analysis => analysis.kind === 'summary').id;
    const actionsId = meeting.analyses.find(analysis => analysis.kind === 'actions').id;
    meeting.completedActions = [`${actionsId}:0`];
    const base = { folderId: 'shared', archived: false, createdAt: 'now', updatedAt: 'now' };
    const transcript = { ...base, id: 'transcript', title: 'Data Pipeline Meeting · Oct 12, 2026 · Meeting', content: transcriptHtml(meeting, 0) + '<p>Personal observation.</p><img src="/meeting-private-image.png"><div data-type="sourceFile">private attachment</div>', meeting: { role: 'transcript', sessionId: meeting.id } };
    const summary = { ...base, id: 'summary', title: 'Data Pipeline Meeting · Oct 12, 2026 · Meeting Summary', content: `<h2 data-meeting-analysis="${summaryId}">Summary</h2><p data-meeting-analysis="${summaryId}">Reviewed executive wording.</p>`, meeting: { role: 'summary', sessionId: meeting.id, sourceNoteId: 'transcript', editedAnalysisIds: [summaryId] } };
    const privateNote = { ...transcript, id: 'private', folderId: 'private', title: 'Private transcript' };
    const workspace = { folders: [{ id: 'shared', name: 'Data Pipeline Meeting' }, { id: 'private', name: 'Private' }], notes: [transcript, summary, privateNote], theme: 'light', activeId: 'transcript', referenceId: null };
    const writer = { checkpoint: () => workspace, activeEditor: () => null, meetings: () => [meeting], isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async () => { throw Error('Unexpected write'); } };
    const request = (tool: string, args = {}) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: true, allowedFolderIds: ['shared'], allowUnfiled: false } });
    // Canonical corrections have not yet been copied into workspace HTML.
    meeting = { ...meeting, revision: 2, segments: [{ ...meeting.segments[0], text: 'Corrected latency threshold.' }, ...meeting.segments.slice(1)] };
    const read = await executeIntegration(request('read_note', { note_id: 'transcript' }), writer);
    const summarized = await executeIntegration(request('read_note', { note_id: 'summary' }), writer);
    meeting = { ...meeting, analyses: meeting.analyses.map(analysis => analysis.id === actionsId ? { ...analysis, items: [{ ...analysis.items[0], text: 'Updated action from the meeting record.' }, ...analysis.items.slice(1)] } : analysis) };
    const updatedSummary = await executeIntegration(request('read_note', { note_id: 'summary' }), writer);
    const found = await executeIntegration(request('search_notes', { query: 'Corrected latency' }), writer);
    const edited = await executeIntegration(request('search_notes', { query: 'Reviewed executive' }), writer);
    const listed = await executeIntegration(request('list_notes', { folder_id: 'shared' }), writer);
    let privateError = ''; try { await executeIntegration(request('read_note', { note_id: 'private' }), writer); } catch (error) { privateError = String(error); }
    return { read, summarized, updatedSummary, found, edited, listed, privateError };
  });
  expect(result.read.text).toContain('[0:00] Alex: Corrected latency threshold.');
  expect(result.read.text).toContain('Personal observation.'); expect(result.read.text).not.toContain('For the launch');
  expect(result.read.kind).toBe('meeting_transcript'); expect(result.read.read_only).toBe(true);
  expect(result.read.meeting).toMatchObject({ available: true, transcript_revision: 2, recording: 'saved' });
  expect(result.summarized.text).toContain('Reviewed executive wording.'); expect(result.summarized.text).not.toContain('Keep onboarding to three steps');
  expect(result.summarized.text).toContain('[x] Update the onboarding copy.');
  expect(result.summarized.kind).toBe('meeting_summary'); expect(result.summarized.read_only).toBe(true);
  expect(result.summarized.meeting.summary_revisions.every(result => result.transcript_revision === 1 && !result.current)).toBe(true);
  expect(result.updatedSummary.text).toContain('Updated action from the meeting record.'); expect(result.updatedSummary.text).toContain('Reviewed executive wording.');
  expect(result.updatedSummary.version).not.toBe(result.summarized.version);
  expect(result.found.notes.map(note => note.id)).toEqual(['transcript']); expect(result.edited.notes.map(note => note.id)).toEqual(['summary']);
  expect(result.listed.notes.map(note => note.kind)).toEqual(['meeting_transcript', 'meeting_summary']);
  expect(result.privateError).toContain('NOT_FOUND');
  const serialized = JSON.stringify(result);
  for (const excluded of ['private-recording.wav', 'private-video.mp4', 'private-provider-diagnostic', 'private attachment', 'Private transcript']) expect(serialized).not.toContain(excluded);
  await page.waitForTimeout(150); expect(requests).toBe(0);
});

test('meeting reads bind Unicode pagination to live revisions and speaker names and report pending snapshots', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    const { sampleMeeting } = await import('/src/meetings.ts');
    let meeting = sampleMeeting('note', true);
    meeting = { ...meeting, recording: 'recording', processing: 'transcribing', segments: [{ ...meeting.segments[0], text: 'Latency 日本語 😀 '.repeat(900) }] };
    const note = { id: 'note', title: 'Live transcript', folderId: null, content: '<p>Stored fallback.</p>', archived: false, createdAt: 'now', updatedAt: 'now', meeting: { role: 'transcript', sessionId: meeting.id } };
    const workspace = { folders: [], notes: [note], theme: 'light', activeId: 'note', referenceId: null };
    let records = [meeting];
    const writer = { checkpoint: () => workspace, activeEditor: () => null, meetings: () => records, isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async () => { throw Error('Unexpected write'); } };
    const request = (args = {}, tool = 'read_note') => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: true, allowedFolderIds: [], allowUnfiled: true } });
    const first = await executeIntegration(request({ note_id: 'note', limit: 127 }), writer);
    let text = first.text, offset = first.next_offset;
    while (offset !== null) { const next = await executeIntegration(request({ note_id: 'note', offset, limit: 127, expected_version: first.version }), writer); text += next.text; offset = next.next_offset; }
    const whole = await executeIntegration(request({ note_id: 'note' }), writer);
    records = [{ ...meeting, revision: 2 }];
    let changed = ''; try { await executeIntegration(request({ note_id: 'note', offset: first.next_offset, expected_version: first.version }), writer); } catch (error) { changed = String(error); }
    records = [{ ...meeting, speakers: { ...meeting.speakers, '0': 'Renamed speaker' } }];
    const renamed = await executeIntegration(request({ note_id: 'note', limit: 100 }), writer);
    const phrase = 'Latency 日本語 😀 ', bytes = new TextEncoder().encode(phrase).length;
    records = [{ ...meeting, segments: [{ ...meeting.segments[0], text: phrase + phrase, speakerSpans: [{ speaker: '0', start: 0, end: 1, textStart: 0, textEnd: bytes }, { speaker: '1', start: 1, end: 2, textStart: bytes, textEnd: bytes * 2 }] }] }];
    const turns = await executeIntegration(request({ note_id: 'note' }), writer);
    records = null;
    const status = await executeIntegration(request({}, 'get_status'), writer);
    let pending = ''; try { await executeIntegration(request({ note_id: 'note' }), writer); } catch (error) { pending = String(error); }
    records = [];
    const fallback = await executeIntegration(request({ note_id: 'note' }), writer);
    return { first, text, prefix: whole.text, changed, renamed, turns, status, pending, fallback };
  });
  expect(result.text).toBe('[0:00] Alex: ' + 'Latency 日本語 😀 '.repeat(900) + '\nStored fallback.\n');
  expect(result.text.startsWith(result.prefix)).toBe(true); expect(result.first.meeting.recording).toBe('recording');
  expect(result.changed).toContain('VERSION_CONFLICT'); expect(result.renamed.version).not.toBe(result.first.version);
  expect(result.renamed.text).toContain('Renamed speaker'); expect(result.status.meeting_ready).toBe(false); expect(result.pending).toContain('APP_NOT_READY');
  expect(result.turns.text).toContain('[0:00] Alex: Latency 日本語 😀 \n[0:01] Sam: Latency 日本語 😀 ');
  expect(result.fallback.snapshot).toBe('notebook'); expect(result.fallback.meeting.available).toBe(false); expect(result.fallback.text).toBe('Stored fallback.\n');
});

test('meeting scope excludes deleted sessions and folders and rejects writes without mutation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { executeIntegration } = await import('/src/integration.ts');
    const { sampleMeeting } = await import('/src/meetings.ts');
    const session = sampleMeeting('transcript', true), deletedSession = { ...sampleMeeting('deleted-session', true), deletedAt: Date.now() };
    const base = { folderId: 'shared', content: '<p>Meeting body.</p>', archived: false, createdAt: 'now', updatedAt: 'now' };
    const transcript = { ...base, id: 'transcript', title: 'Transcript', meeting: { role: 'transcript', sessionId: session.id } };
    const summary = { ...base, id: 'summary', title: 'Summary', meeting: { role: 'summary', sessionId: session.id } };
    const workspace = { folders: [{ id: 'shared', name: 'Shared' }, { id: 'deleted-folder', name: 'Deleted', deletedAt: 'now' }], notes: [transcript, summary, { ...transcript, id: 'deleted-session', meeting: { role: 'transcript', sessionId: deletedSession.id } }, { ...transcript, id: 'deleted-folder-note', folderId: 'deleted-folder' }, { ...transcript, id: 'archived', archived: true }, { ...transcript, id: 'trash', deletedAt: 'now' }, { ...transcript, id: 'unfiled', folderId: null }], theme: 'light', activeId: 'transcript', referenceId: null };
    const before = JSON.stringify(workspace); let applied = false;
    const writer = { checkpoint: () => workspace, activeEditor: () => null, meetings: () => [session, deletedSession], isDirty: () => false, savedRevision: () => 1, enqueueIntegration: async (_request, prepare) => { await prepare(workspace); applied = true; return {}; } };
    const request = (tool: string, args = {}) => ({ id: 'dispatch', generation: 'generation', clientId: 'client', tool, args, policy: { readOnly: false, allowedFolderIds: ['shared', 'deleted-folder'], allowUnfiled: false }, operation: { clientId: 'client', requestId: crypto.randomUUID(), payloadHash: 'hash' } });
    const found = await executeIntegration(request('search_notes', { query: 'Transcript' }), writer);
    const errors = [];
    for (const id of ['deleted-session', 'deleted-folder-note', 'archived', 'trash', 'unfiled']) { try { await executeIntegration(request('read_note', { note_id: id }), writer); } catch (error) { errors.push(String(error)); } }
    const writes = [];
    for (const id of ['transcript', 'summary']) for (const tool of ['append_note', 'replace_note_text']) { try { await executeIntegration(request(tool, { note_id: id, text: 'Changed', exact_text: 'Meeting', replacement: 'Changed', expected_version: 'version' }), writer); } catch (error) { writes.push(String(error)); } }
    return { found, errors, writes, applied, unchanged: before === JSON.stringify(workspace) };
  });
  expect(result.found.notes.map(note => note.id)).toEqual(['transcript']);
  expect(result.errors).toHaveLength(5); expect(result.errors.every(error => error.includes('NOT_FOUND'))).toBe(true);
  expect(result.writes).toHaveLength(4); expect(result.writes.every(error => error.includes('UNSUPPORTED_CONTENT'))).toBe(true);
  expect(result.applied).toBe(false); expect(result.unchanged).toBe(true);
});

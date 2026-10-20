import type { Editor } from '@tiptap/react';
import { DOMParser as ProseMirrorParser, DOMSerializer } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import type { Note, Workspace } from './types';
import { textExport } from './types';
import { meetingNoteForExport, meetingPersonalContent } from './meetingNotes';
import { meetingTime, speakerLabel, speakerTurns, type Meeting } from './meetings';
import type { IntegrationPrepared } from './useWorkspace';

export type IntegrationPolicy = { readOnly: boolean; allowedFolderIds: string[]; allowUnfiled: boolean };
export type IntegrationRequest = { id: string; generation: string; clientId: string; tool: string; args: Record<string, unknown>; policy: IntegrationPolicy; operation?: { clientId: string; requestId: string; payloadHash: string } | null };
export type ActiveIntegrationEditor = { noteId: string; editor: Editor };
export type IntegrationWriter = {
  checkpoint: () => Workspace | null; isDirty: () => boolean; savedRevision: () => number;
  activeEditor: () => ActiveIntegrationEditor | null;
  meetings?: () => readonly Meeting[] | null;
  enqueueIntegration: (request: IntegrationRequest, prepare: (workspace: Workspace) => Promise<IntegrationPrepared>) => Promise<Record<string, unknown>>;
};
const writeTools = new Set(['create_folder', 'create_note', 'append_note', 'replace_note_text']);
const versionCache = new WeakMap<Note, Promise<string>>();
const outputBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const outputBudget = 32 * 1024;
const highSurrogate = (text: string, at: number) => text.charCodeAt(at) >= 0xD800 && text.charCodeAt(at) <= 0xDBFF;
const lowSurrogate = (text: string, at: number) => text.charCodeAt(at) >= 0xDC00 && text.charCodeAt(at) <= 0xDFFF;
function textRange(text: string, start: number, end: number): string {
  if (lowSurrogate(text, start) && highSurrogate(text, start - 1)) start++;
  if (highSurrogate(text, end - 1) && lowSurrogate(text, end)) end--;
  return text.slice(start, end);
}
function pageResult(key: 'folders' | 'notes', rows: Record<string, unknown>[], offset: number, total: number, extra = {}): Record<string, unknown> {
  const accepted: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (outputBytes({ [key]: [...accepted, row], next_offset: offset + accepted.length + 1, ...extra }) > outputBudget) break;
    accepted.push(row);
  }
  const end = offset + accepted.length;
  return { [key]: accepted, next_offset: end < total ? end : null, ...extra };
}
export function noteVersion(note: Note): Promise<string> {
  let value = versionCache.get(note);
  if (!value) {
    const snapshot: unknown[] = [note.id, note.folderId, note.title, note.kind || 'note', note.content, note.archived, note.deletedAt || null];
    if (note.meeting) snapshot.push(note.meeting);
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    value = crypto.subtle.digest('SHA-256', bytes).then(digest => Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
    versionCache.set(note, value);
  }
  return value;
}
function fail(code: string, message: string): never { throw Error(`${code}: ${message}`); }
function string(args: Record<string, unknown>, key: string, max = 200, empty = false): string {
  const value = args[key];
  if (typeof value !== 'string' || (!empty && !value.trim()) || Array.from(value).length > max) fail('INVALID_INPUT', `Invalid ${key}.`);
  return value;
}
function integer(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (key === 'offset' ? 0 : 1) || value > max) fail('INVALID_INPUT', `Invalid ${key}.`);
  return value;
}
function allowed(policy: IntegrationPolicy, folder: string | null): boolean { return folder === null ? policy.allowUnfiled : policy.allowedFolderIds.includes(folder); }
function ordinary(note: Note): boolean { return (!note.kind || note.kind === 'note') && !note.archived && !note.deletedAt && !note.meeting; }
function readable(note: Note): boolean { return (!note.kind || note.kind === 'note') && !note.archived && !note.deletedAt && (!note.meeting || ['transcript', 'summary'].includes(note.meeting.role)); }
function visible(workspace: Workspace, policy: IntegrationPolicy, note: Note): boolean { return readable(note) && allowed(policy, note.folderId) && (note.folderId === null || workspace.folders.some(f => f.id === note.folderId && !f.deletedAt)); }
function folder(workspace: Workspace, policy: IntegrationPolicy, id: unknown): string | null {
  if (id !== null && typeof id !== 'string') fail('INVALID_INPUT', 'Provide folder_id, or null for unfiled.');
  if (!allowed(policy, id)) fail('FORBIDDEN', 'This folder is not shared with Codex.');
  if (id !== null && !workspace.folders.some(f => f.id === id && !f.deletedAt)) fail('NOT_FOUND', 'The folder is no longer available.');
  return id;
}
function target(workspace: Workspace, request: IntegrationRequest): Note {
  const id = string(request.args, 'note_id');
  const note = workspace.notes.find(n => n.id === id);
  if (!note || !visible(workspace, request.policy, note)) fail('NOT_FOUND', 'The note is unavailable in this connection.');
  return note;
}
function textParagraphs(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const p = document.createElement('p'); p.textContent = line;
    return p.outerHTML;
  }).join('');
}
function readableHtml(html: string): string {
  const container = document.createElement('template'); container.innerHTML = html;
  container.content.querySelectorAll('img,iframe,object,embed,script,style,audio,video,link,base,source,track,svg,input[type="image"],[contenteditable="false"],[data-type="sourceFile"],[data-type="meetingTranscript"],[data-type="meetingSummary"]').forEach(element => element.remove());
  return container.innerHTML;
}
function integrationText(html: string): string {
  const container = document.createElement('template'); container.innerHTML = readableHtml(html);
  container.content.querySelectorAll('br').forEach(element => element.replaceWith('\n'));
  return textExport(container.content);
}
function linkedMeeting(note: Note, meetings: readonly Meeting[] | null | undefined): Meeting | undefined {
  if (!note.meeting) return;
  return note.meeting.sessionId ? meetings?.find(meeting => meeting.id === note.meeting?.sessionId) : meetings?.find(meeting => meeting.noteId === note.id);
}
function readSnapshot(note: Note, meetings: readonly Meeting[] | null | undefined): { note: Note; text: string; metadata: Record<string, unknown> } {
  if (!note.meeting) return { note, text: integrationText(note.content), metadata: { kind: 'note', read_only: false, snapshot: 'live' } };
  if (meetings === null) fail('APP_NOT_READY', 'Meeting records are still loading. Retry this read shortly.');
  const meeting = linkedMeeting(note, meetings);
  if (meeting?.deletedAt) fail('NOT_FOUND', 'The meeting is unavailable in this connection.');
  const summaries = note.meeting.role === 'summary' && meeting ? (['summary', 'actions', 'minutes'] as const).map(kind => [...meeting.analyses].reverse().find(analysis => analysis.kind === kind)).filter(analysis => !!analysis).map(analysis => ({ kind: analysis.kind, transcript_revision: analysis.revision, current: analysis.revision === meeting.revision })) : [];
  const metadata = { kind: `meeting_${note.meeting.role}`, read_only: true, snapshot: meeting ? 'live' : 'notebook', meeting: {
    role: note.meeting.role, available: !!meeting, ...(meeting ? { session_id: meeting.id, transcript_revision: meeting.revision, recording: meeting.recording, processing: meeting.processing, notes_status: meeting.notesStatus || '' } : {}),
    ...(note.meeting.role === 'summary' ? { summary_revisions: summaries } : {}),
  } };
  // Reuse the notebook's summary projection so manual edits, action completion
  // and current citations agree with the displayed note. Only text is returned.
  let html = readableHtml(note.content);
  if (meeting) {
    if (note.meeting.role === 'summary') html = meetingNoteForExport({ ...note, content: html }, meeting).content;
    else {
      const transcript = meeting.segments.flatMap(speakerTurns).map(segment => `[${meetingTime(segment.start)}] ${speakerLabel(meeting, segment.speaker)}: ${segment.text}`).join('\n');
      html = textParagraphs(transcript) + meetingPersonalContent(html, meeting);
    }
  }
  const text = integrationText(html);
  // Meeting revisions/names/results can change without a workspace HTML edit.
  // Bind pagination to both the displayed text and its live state metadata.
  const snapshot = { ...note, content: JSON.stringify([html, metadata]) };
  return { note: snapshot, text, metadata };
}
function insertionFormat(args: Record<string, unknown>): 'text' | 'html' {
  const format = args.format ?? 'text';
  if (format !== 'text' && format !== 'html') fail('INVALID_INPUT', 'Use text or html format.');
  return format;
}
// Only semantic text blocks are accepted. Theme styles belong to Scribly;
// attributes, embedded content and executable markup cannot enter through MCP.
function insertionHtml(args: Record<string, unknown>, text: string, allowEmpty = false): string {
  if (insertionFormat(args) === 'text') return textParagraphs(text);
  const container = document.createElement('template'); container.innerHTML = text;
  const inline = new Set(['STRONG', 'EM', 'S', 'CODE', 'BR']);
  const blocks = new Set(['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'PRE', 'BLOCKQUOTE']);
  function validate(parent: Element | DocumentFragment, allowedTags: Set<string>, allowText: boolean) {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!allowText && child.textContent?.trim()) fail('UNSUPPORTED_CONTENT', 'Wrap text in paragraphs or headings.');
        continue;
      }
      if (!(child instanceof Element) || !allowedTags.has(child.tagName) || child.attributes.length) fail('UNSUPPORTED_CONTENT', 'Use semantic HTML without attributes, images, links or embedded content.');
      if (child.tagName === 'UL' || child.tagName === 'OL') validate(child, new Set(['LI']), false);
      else if (child.tagName === 'LI') {
        if (child.firstElementChild?.tagName !== 'P') fail('UNSUPPORTED_CONTENT', 'Start each list item with a paragraph.');
        validate(child, new Set(['P', 'UL', 'OL']), false);
      } else if (child.tagName === 'BLOCKQUOTE') validate(child, blocks, false);
      else if (child.tagName === 'PRE') validate(child, new Set(['CODE']), true);
      else validate(child, inline, true);
    }
  }
  validate(container.content, blocks, false);
  if (!allowEmpty && text.trim() && !container.content.textContent?.trim() && !container.content.querySelector('br')) fail('INVALID_INPUT', 'Formatted content must contain text.');
  return container.innerHTML;
}
// Formatted replacement is bounded to a unique run of complete top-level text
// blocks. Never drop opaque content, links, annotations or block attributes.
function formattedReplacement(html: string, exact: string, replacement: string): { html: string; startBlock: number; blockCount: number; inserted: string } {
  const inserted = insertionHtml({ format: 'html' }, replacement);
  const container = document.createElement('template'); container.innerHTML = html;
  const blocks = Array.from(container.content.children), expected = exact.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!expected.trim()) fail('INVALID_INPUT', 'Choose nonempty section text.');
  const supported = blocks.map(block => {
    try { insertionHtml({ format: 'html' }, block.outerHTML, true); return true; } catch { return false; }
  });
  const text = blocks.map(block => integrationText(block.outerHTML));
  const matches: { startBlock: number; blockCount: number }[] = [];
  for (let start = 0; start < blocks.length; start++) {
    if (!supported[start]) continue;
    let candidate = '';
    for (let end = start; end < blocks.length && supported[end]; end++) {
      candidate += text[end];
      const comparable = candidate.replace(/\n+$/, '');
      if (comparable === expected) { matches.push({ startBlock: start, blockCount: end - start + 1 }); break; }
      if (!expected.startsWith(candidate)) break;
    }
  }
  if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_MATCH' : 'UNSUPPORTED_CONTENT', matches.length ? 'The section occurs more than once; choose unique complete blocks.' : 'Formatted replacement requires complete unannotated top-level blocks; read the section again.');
  const match = matches[0], source = document.createElement('template'); source.innerHTML = inserted;
  blocks[match.startBlock].before(source.content);
  blocks.slice(match.startBlock, match.startBlock + match.blockCount).forEach(block => block.remove());
  return { html: container.innerHTML, ...match, inserted };
}
function sectionHeadingLevel(html: string): number {
  const container = document.createElement('template'); container.innerHTML = html;
  const heading = Array.from(container.content.querySelectorAll('h1,h2,h3')).find(supportedElement);
  return heading ? Number(heading.tagName.slice(1)) : 2;
}
function supportedElement(element: Element): boolean {
  return /^(P|H1|H2|H3|PRE)$/.test(element.tagName) && !element.closest('[contenteditable="false"], [data-type="sourceFile"], [data-type="meetingTranscript"], [data-type="meetingSummary"]');
}
// Inactive edits preserve opaque blocks/attributes without parsing the entire note
// through a different schema. Only text within one supported block is replaced.
export function inactiveReplacement(html: string, exact: string, replacement: string): string {
  const container = document.createElement('template'); container.innerHTML = html;
  const matches: { nodes: Text[]; start: number }[] = [];
  for (const block of container.content.querySelectorAll('p,h1,h2,h3,pre')) {
    if (!supportedElement(block)) continue;
    const runs: Text[][] = [[]];
    function visit(parent: Node) {
      for (const child of parent.childNodes) {
        if (child instanceof Text) runs[runs.length - 1].push(child);
        else if (child instanceof Element) {
          if (child.matches('br,img,[contenteditable="false"],[data-type="sourceFile"],[data-type="meetingTranscript"],[data-type="meetingSummary"]')) runs.push([]);
          else visit(child);
        }
      }
    }
    visit(block);
    for (const nodes of runs) {
      const text = nodes.map(node => node.data).join(''); let offset = 0;
      while ((offset = text.indexOf(exact, offset)) !== -1) { matches.push({ nodes, start: offset }); offset++; }
    }
  }
  if (matches.length !== 1) fail('AMBIGUOUS_MATCH', matches.length ? 'The text occurs more than once; choose a unique passage.' : 'No supported text block matches that passage.');
  const { nodes, start } = matches[0];
  let position = 0; const range = document.createRange(); let began = false, ended = false;
  for (const text of nodes) {
    const end = position + text.length;
    if (!began && start < end) { range.setStart(text, start - position); began = true; }
    if (began && start + exact.length <= end) { range.setEnd(text, start + exact.length - position); ended = true; break; }
    position = end;
  }
  if (!began || !ended) fail('UNSUPPORTED_CONTENT', 'The text range could not be resolved.');
  range.deleteContents(); if (replacement) range.insertNode(document.createTextNode(replacement));
  return container.innerHTML;
}
export function editorEdit(editor: Editor, tool: string, args: Record<string, unknown>): { html: string; apply: () => void } {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) fail('BUSY', 'Finish the current text composition before editing this note.');
  const before = editor.state.doc; let transaction = closeHistory(editor.state.tr);
  if (tool === 'append_note') {
    const text = string(args, 'text', 32768);
    if (insertionFormat(args) === 'html') {
      const source = document.createElement('div'); source.innerHTML = insertionHtml(args, text);
      transaction.insert(before.content.size, ProseMirrorParser.fromSchema(editor.schema).parse(source).content);
    } else {
      const paragraphs = text.replace(/\r\n?/g, '\n').split('\n').map(line => editor.schema.nodes.paragraph.create(null, line ? editor.schema.text(line) : undefined));
      transaction.insert(before.content.size, paragraphs);
    }
  } else if (insertionFormat(args) === 'html') {
    const match = formattedReplacement(editor.getHTML(), string(args, 'exact_text', 32768), string(args, 'replacement', 32768));
    let from = 0; for (let index = 0; index < match.startBlock; index++) from += before.child(index).nodeSize;
    let to = from; for (let index = match.startBlock; index < match.startBlock + match.blockCount; index++) to += before.child(index).nodeSize;
    const source = document.createElement('div'); source.innerHTML = match.inserted;
    transaction.replaceWith(from, to, ProseMirrorParser.fromSchema(editor.schema).parse(source).content);
  } else {
    const exact = string(args, 'exact_text', 32768); const replacement = string(args, 'replacement', 32768, true);
    if (/[\r\n]/.test(exact + replacement)) fail('UNSUPPORTED_CONTENT', 'Replace text within one block; use append_note for new paragraphs.');
    const positions: number[] = [];
    before.descendants((node, position) => {
      if (!node.isTextblock || !['paragraph', 'heading', 'codeBlock'].includes(node.type.name)) return;
      let text = '', start = 0;
      const matchRun = () => {
        let offset = 0; while ((offset = text.indexOf(exact, offset)) !== -1) { positions.push(position + 1 + start + offset); offset++; }
      };
      node.forEach((child, offset) => {
        if (child.isText) { if (!text) start = offset; text += child.text; }
        else { matchRun(); text = ''; }
      });
      matchRun();
      return false;
    });
    if (positions.length !== 1) fail('AMBIGUOUS_MATCH', positions.length ? 'Choose a unique passage.' : 'No supported text block matches that passage.');
    const from = positions[0], marks = before.resolve(from).nodeAfter?.marks || before.resolve(from).marks();
    if (replacement) transaction.replaceWith(from, from + exact.length, editor.schema.text(replacement, marks));
    else transaction.delete(from, from + exact.length);
  }
  if (transaction.doc.eq(before)) fail('NO_CHANGE', 'The requested edit does not change the note.');
  // Stage the same document the editor will display, including appended plugin
  // normalization (for example its caret paragraph after a list). Merge those
  // steps so the later dispatch does not produce a different save snapshot.
  const normalized = editor.state.applyTransaction(transaction);
  if (!normalized.transactions.length) fail('UNSUPPORTED_CONTENT', 'The editor rejected this change.');
  for (const appended of normalized.transactions.slice(1)) {
    for (const step of appended.steps) transaction.step(step);
  }
  const container = document.createElement('div'); container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(transaction.doc.content));
  const html = container.innerHTML;
  return { html, apply: () => {
    if (editor.isDestroyed || editor.state.doc !== before || editor.view.composing) fail('VERSION_CONFLICT', 'The editor changed before the command was applied.');
    const scroll: { element: HTMLElement; top: number; left: number }[] = [];
    for (let element = editor.view.dom.parentElement; element; element = element.parentElement) if (element.scrollHeight > element.clientHeight) scroll.push({ element, top: element.scrollTop, left: element.scrollLeft });
    editor.view.dispatch(transaction);
    if (!editor.state.doc.eq(transaction.doc)) fail('UNSUPPORTED_CONTENT', 'The editor rejected this change.');
    editor.view.dispatch(closeHistory(editor.state.tr));
    for (const item of scroll) { item.element.scrollTop = item.top; item.element.scrollLeft = item.left; }
  } };
}
async function prepare(request: IntegrationRequest, workspace: Workspace, active: ActiveIntegrationEditor | null): Promise<IntegrationPrepared> {
  const now = new Date().toISOString(), args = request.args;
  if (request.policy.readOnly) fail('FORBIDDEN', 'This connection is read-only.');
  if (!request.operation) fail('INVALID_INPUT', 'A write requires a request_id.');
  if (request.tool === 'create_folder') {
    const id = crypto.randomUUID(), name = string(args, 'name').trim();
    return { workspace: { ...workspace, folders: [...workspace.folders, { id, name, createdAt: now }] }, result: { folder_id: id, name, request_id: request.operation.requestId } };
  }
  if (request.tool === 'create_note') {
    const folderId = folder(workspace, request.policy, args.folder_id);
    const title = string(args, 'title').trim(), text = args.text === undefined ? '' : string(args, 'text', 32768, true);
    const note: Note = { id: crypto.randomUUID(), folderId, title, content: insertionHtml(args, text), createdAt: now, updatedAt: now, archived: false };
    return { workspace: { ...workspace, notes: [...workspace.notes, note] }, result: { note_id: note.id, folder_id: folderId, title, version: await noteVersion(note), request_id: request.operation.requestId } };
  }
  const note = target(workspace, request);
  if (!ordinary(note)) fail('UNSUPPORTED_CONTENT', 'Meeting transcripts and summaries are read-only through this connection. Create a normal note to save new commentary.');
  if (await noteVersion(note) !== string(args, 'expected_version')) fail('VERSION_CONFLICT', 'The note changed. Read it again before editing.');
  let content: string, applyEditor: (() => void) | undefined;
  if (active?.noteId === note.id) {
    if (active.editor.getHTML() !== note.content) {
      // Imported HTML can serialize differently (for example b → strong) while
      // representing the same live document. Compare the actual editor schema,
      // rather than preventing all edits until the user types into that note.
      const source = document.createElement('template'); source.innerHTML = note.content;
      if (!ProseMirrorParser.fromSchema(active.editor.schema).parse(source.content, { preserveWhitespace: 'full' }).eq(active.editor.state.doc)) fail('VERSION_CONFLICT', 'The live editor is not synchronized; read the note again.');
    }
    const change = editorEdit(active.editor, request.tool, args); content = change.html; applyEditor = change.apply;
  } else if (request.tool === 'append_note') content = note.content + insertionHtml(args, string(args, 'text', 32768));
  else if (insertionFormat(args) === 'html') {
    content = formattedReplacement(note.content, string(args, 'exact_text', 32768), string(args, 'replacement', 32768)).html;
  } else {
    const exact = string(args, 'exact_text', 32768), replacement = string(args, 'replacement', 32768, true);
    if (/[\r\n]/.test(exact + replacement)) fail('UNSUPPORTED_CONTENT', 'Replace text within one block.');
    content = inactiveReplacement(note.content, exact, replacement);
  }
  if (content === note.content) fail('NO_CHANGE', 'The requested edit does not change the note.');
  const next: Note = { ...note, content, updatedAt: now };
  return { workspace: { ...workspace, notes: workspace.notes.map(item => item.id === note.id ? next : item) }, applyEditor, result: { note_id: note.id, version: await noteVersion(next), request_id: request.operation.requestId } };
}
export async function executeIntegration(request: IntegrationRequest, writer: IntegrationWriter): Promise<Record<string, unknown>> {
  if (writeTools.has(request.tool)) return writer.enqueueIntegration(request, workspace => prepare(request, workspace, writer.activeEditor()));
  const workspace = writer.checkpoint(); if (!workspace) fail('APP_NOT_READY', 'Open the notebook first.');
  const meetings = writer.meetings?.();
  if (request.tool === 'get_status') return { ready: true, revision: writer.savedRevision(), unsaved: writer.isDirty(), read_only: request.policy.readOnly, capabilities: request.policy.readOnly ? ['read'] : ['read', 'write'], meeting_read: true, meeting_ready: meetings !== null, write_formats: request.policy.readOnly ? [] : ['text', 'html'], formatted_replacement: 'unique complete unannotated top-level text blocks', unavailable: ['meeting edits', 'recordings', 'boards', 'attachments', 'permanent deletion'] };
  const offset = integer(request.args, 'offset', 0, Number.MAX_SAFE_INTEGER);
  if (request.tool === 'read_note') {
    const note = target(workspace, request), snapshot = readSnapshot(note, meetings), text = snapshot.text, limit = integer(request.args, 'limit', 8192, 8192), version = await noteVersion(snapshot.note);
    if (request.args.expected_version !== undefined && version !== string(request.args, 'expected_version')) fail('VERSION_CONFLICT', 'The note changed between pages. Read again from offset 0.');
    if (offset > text.length) fail('INVALID_INPUT', 'Offset is beyond the note text.');
    if (lowSurrogate(text, offset) && highSurrogate(text, offset - 1)) fail('INVALID_INPUT', 'Offset splits a Unicode character; use the returned next_offset.');
    let end = Math.min(text.length, offset + limit);
    if (highSurrogate(text, end - 1) && lowSurrogate(text, end)) end++;
    const result = { note_id: note.id, title: textRange(note.title, 0, 200), folder_id: note.folderId, text: text.slice(offset, end), section_heading_level: sectionHeadingLevel(note.content), version, ...snapshot.metadata, read_only: !!note.meeting || request.policy.readOnly, unsaved: writer.isDirty(), next_offset: null as number | null, total_characters: text.length };
    let low = 0, high = result.text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (outputBytes({ ...result, text: result.text.slice(0, middle), next_offset: offset + middle }) <= outputBudget) low = middle;
      else high = middle - 1;
    }
    if (highSurrogate(result.text, low - 1) && lowSurrogate(result.text, low)) low--;
    result.text = result.text.slice(0, low);
    result.next_offset = offset + low < text.length ? offset + low : null;
    return result;
  }
  const limit = integer(request.args, 'limit', 50, 50);
  if (request.tool === 'list_folders') {
    const folders = workspace.folders.filter(f => !f.deletedAt && allowed(request.policy, f.id));
    return pageResult('folders', folders.slice(offset, offset + limit).map(f => ({ id: f.id, name: textRange(f.name, 0, 200), note_count: workspace.notes.filter(n => n.folderId === f.id && visible(workspace, request.policy, n) && !linkedMeeting(n, meetings)?.deletedAt).length, meeting_note_count: workspace.notes.filter(n => n.folderId === f.id && !!n.meeting && visible(workspace, request.policy, n) && !linkedMeeting(n, meetings)?.deletedAt).length, unavailable_item_count: workspace.notes.filter(n => n.folderId === f.id && !n.archived && !n.deletedAt && (!readable(n) || !!linkedMeeting(n, meetings)?.deletedAt)).length })), offset, folders.length, { unfiled_available: request.policy.allowUnfiled });
  }
  let notes = workspace.notes.filter(n => visible(workspace, request.policy, n) && !linkedMeeting(n, meetings)?.deletedAt);
  const snapshots = new Map<Note, ReturnType<typeof readSnapshot>>();
  const snapshot = (note: Note) => { let value = snapshots.get(note); if (!value) { value = readSnapshot(note, meetings); snapshots.set(note, value); } return value; };
  if (request.tool === 'list_notes') { const id = folder(workspace, request.policy, request.args.folder_id); notes = notes.filter(n => n.folderId === id); }
  else if (request.tool === 'search_notes') {
    if (request.args.folder_id !== undefined) { const id = folder(workspace, request.policy, request.args.folder_id); notes = notes.filter(n => n.folderId === id); }
    const query = string(request.args, 'query').toLocaleLowerCase();
    notes = notes.filter(n => n.title.toLocaleLowerCase().includes(query) || snapshot(n).text.toLocaleLowerCase().includes(query));
  } else fail('UNKNOWN_TOOL', 'Unsupported notebook operation.');
  const page = notes.slice(offset, offset + limit);
  return pageResult('notes', await Promise.all(page.map(async n => {
    const view = snapshot(n), text = request.tool === 'search_notes' ? view.text : '';
    const at = text.toLocaleLowerCase().indexOf(String(request.args.query).toLocaleLowerCase());
    return { id: n.id, folder_id: n.folderId, title: textRange(n.title, 0, 200), updated_at: n.updatedAt, kind: view.metadata.kind, read_only: !!n.meeting || request.policy.readOnly, version: await noteVersion(view.note), ...(text ? { snippet: textRange(text, Math.max(0, at - 60), Math.max(0, at - 60) + 240) } : {}) };
  })), offset, notes.length);
}
export function integrationError(reason: unknown): Record<string, unknown> {
  const message = reason instanceof Error ? reason.message : String(reason), match = /^([A-Z_]+):\s*(.*)$/s.exec(message);
  return { error: { code: match?.[1] || 'SAVE_FAILED', message: match?.[2] || message } };
}

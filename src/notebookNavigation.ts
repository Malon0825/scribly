import { isBoard, type Note } from './types';
import { noteSummary } from './noteSummary';

export type NotebookView = { density: 'compact' | 'comfortable'; notebookDensity?: 'compact' | 'comfortable'; sort: 'manual' | 'updated' | 'title'; filter: 'all' | 'notes' | 'boards' };
export const defaultNotebookView: NotebookView = { density: 'comfortable', sort: 'manual', filter: 'all' };
export function readNotebookView(): NotebookView {
  try {
    const value = JSON.parse(localStorage.getItem('scribly-notebook-view') || 'null');
    return { density: value?.density === 'compact' ? 'compact' : 'comfortable',
      ...(value?.notebookDensity === 'compact' || value?.notebookDensity === 'comfortable' ? { notebookDensity: value.notebookDensity } : {}),
      sort: ['updated', 'title'].includes(value?.sort) ? value.sort : 'manual',
      filter: ['notes', 'boards'].includes(value?.filter) ? value.filter : 'all' };
  } catch { return defaultNotebookView; }
}
export function orderNotes(notes: Note[], sort: NotebookView['sort']) {
  if (sort === 'manual' && notes.some(note => note.sidebarManual)) return notes;
  return [...notes].sort((a, b) => sort === 'title'
    ? a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    : sort === 'manual' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
}
export function matchesNote(note: Note, query: string, filter: NotebookView['filter']) {
  return (filter === 'all' || (filter === 'boards' ? isBoard(note) : !isBoard(note)))
    && (!query.trim() || noteSummary(note).search.includes(query.trim().toLowerCase()));
}
export function searchSnippet(note: Note, query: string) {
  const text = noteSummary(note).text;
  const index = text.toLowerCase().indexOf(query.trim().toLowerCase());
  const start = Math.max(0, index - 28);
  return `${start ? '…' : ''}${text.slice(start, start + 110)}`;
}
// Ordinary previews show body copy; search snippets retain heading matches.
export function notePreview(note: Note) {
  return noteSummary(note).preview.slice(0, 70);
}

import { isTemplate, type Note, type Workspace } from "./types";
import { remapItemLinks } from "./itemLinks";
export function templateNote(source: Note, name: string, titlePattern: string, resetChecklist: boolean, id = crypto.randomUUID()): Note {
  const now = new Date().toISOString();
  return remapItemLinks({ id, kind: "template", title: name.trim(), content: source.content, folderId: null, createdAt: now, updatedAt: now, archived: false, template: { titlePattern, resetChecklist } }, new Map([[source.id, id]]));
}
export function instantiateTemplate(template: Note, id: string, title: string, created = new Date(), reset = template.template?.resetChecklist || false) {
  const date = `${created.getFullYear()}-${String(created.getMonth()+1).padStart(2,"0")}-${String(created.getDate()).padStart(2,"0")}`;
  const fill = (value: string) => value.replace(/\{\{(date|title)\}\}/g, (_, field: string) => field === "date" ? date : title);
  const dom = document.createElement("template"); dom.innerHTML = template.content;
  const walker = document.createTreeWalker(dom.content, NodeFilter.SHOW_TEXT); let text: Node | null;
  while ((text = walker.nextNode())) text.textContent = fill(text.textContent || "");
  if (reset) {
    dom.content.querySelectorAll('li[data-type="taskItem"]').forEach(item => { item.setAttribute("data-checked","false"); item.querySelectorAll('input[type="checkbox"]').forEach(input => input.removeAttribute("checked")); });
  }
  const remapped = remapItemLinks({ ...template, content: dom.innerHTML }, new Map([[template.id, id]]));
  return { title: fill(template.template?.titlePattern || "{{title}}") || title, content: remapped.content };
}
export function removeTemplate(workspace: Workspace, id: string): Workspace {
  if (!workspace.notes.some(note => note.id === id && isTemplate(note))) return workspace;
  return { ...workspace, notes: workspace.notes.filter(note => note.id !== id), folders: workspace.folders.map(folder => { if (folder.templateId !== id) return folder; const { templateId: _, ...rest } = folder; return rest; }) };
}

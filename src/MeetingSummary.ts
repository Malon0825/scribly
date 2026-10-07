import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

function citation(value:string | null) {
  if (!value) return null;
  try {
    const parsed:unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as Record<string,unknown>;
    return typeof data.session === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session)
      && Number.isSafeInteger(data.segment) && Number(data.segment) >= 0 && Number.isSafeInteger(data.revision) && Number(data.revision) >= 0 && typeof data.label === 'string' && /^\d+:\d{2}(?::\d{2})?$/.test(data.label)
      ? {session:data.session,segment:Number(data.segment),revision:Number(data.revision),label:data.label} : null;
  } catch { return null; }
}

export const MeetingSummary = Extension.create({
  name:'meetingSummary',
  addGlobalAttributes() {
    return [
      {types:['paragraph','heading','bulletList','orderedList','taskList','blockquote','codeBlock'],attributes:{meetingAnalysis:{
        default:null, keepOnSplit:false,
        parseHTML:element => element.getAttribute('data-meeting-analysis'),
        renderHTML:attrs => typeof attrs.meetingAnalysis === 'string' && attrs.meetingAnalysis.length <= 100 ? {'data-meeting-analysis':attrs.meetingAnalysis} : {},
      }}},
      {types:['taskItem'],attributes:{meetingAction:{
        default:null, keepOnSplit:false,
        parseHTML:element => element.getAttribute('data-meeting-action'),
        renderHTML:attrs => typeof attrs.meetingAction === 'string' && attrs.meetingAction.length <= 120 ? {'data-meeting-action':attrs.meetingAction} : {},
      }}},
    ];
  },
});

export const MeetingCitation = Node.create<{seek:(session:string, segment:number) => void}>({
  name:'meetingCitation', inline:true, group:'inline', atom:true, selectable:false,
  addOptions:() => ({seek:() => {}}),
  addAttributes() { return {source:{default:null,parseHTML:element => citation(element.getAttribute('data-meeting-citation')),renderHTML:attrs => attrs.source ? {'data-meeting-citation':JSON.stringify(attrs.source)} : {}}}; },
  parseHTML() { return [{tag:'button[data-meeting-citation]',getAttrs:element => citation(element.getAttribute('data-meeting-citation')) ? {} : false}]; },
  renderHTML({node,HTMLAttributes}) { return ['button',mergeAttributes(HTMLAttributes,{type:'button',class:'meeting-time-chip',contenteditable:'false',tabindex:'0','aria-label':`Play source at ${node.attrs.source?.label || ''}`}),node.attrs.source?.label || '']; },
  renderText({node}) { return node.attrs.source?.label || ''; },
  addProseMirrorPlugins() {
    const seek = this.options.seek;
    return [new Plugin({props:{handleDOMEvents:{
      click:(_view,event) => {
        const button = (event.target as Element)?.closest('button[data-meeting-citation]');
        const source = citation(button?.getAttribute('data-meeting-citation') || null);
        if (!source) return false;
        event.preventDefault(); seek(source.session,source.segment); return true;
      },
      keydown:(_view,event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return false;
        const button = (event.target as Element)?.closest('button[data-meeting-citation]');
        const source = citation(button?.getAttribute('data-meeting-citation') || null);
        if (!source) return false;
        event.preventDefault(); seek(source.session,source.segment); return true;
      },
    }}})];
  },
});

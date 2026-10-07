import { Extension } from '@tiptap/core';
import { transcriptSource } from './meetingNotes';

// Provenance survives save/reload and editor serialization without changing the paragraph UI.
export const MeetingTranscript = Extension.create({
  name:'meetingTranscript',
  addGlobalAttributes() {
    return [{ types:['paragraph'], attributes:{ meetingSource:{
      default:null,
      keepOnSplit:false,
      parseHTML:element => transcriptSource(element.getAttribute('data-meeting-source')),
      renderHTML:attributes => attributes.meetingSource ? { 'data-meeting-source':JSON.stringify(attributes.meetingSource) } : {},
    } } }];
  },
});

import type { Workspace } from "./types";

export function initialWorkspace(): Workspace {
  const stamp = new Date().toISOString();
  return {
    theme: "system",
    activeId: "welcome",
    referenceId: null,
    folders: [{ id: "introduction", name: "Introduction" }],
    notes: [{
      id: "welcome",
      folderId: "introduction",
      title: "Welcome to Scribly",
      content: "<h2>Your notebook, your way.</h2><p>Scribly is a local notebook for writing and drawing. Start with this introduction, then create the folders and notes that suit you. You can edit or delete this welcome note whenever you like.</p><h2>Start writing</h2><ul><li><p>Choose New note or press Ctrl+N to start a note.</p></li><li><p>Choose New folder in the sidebar to organize your notes.</p></li><li><p>Use Formatting for headings, lists, checklists, code, images, text colors, and drawing tools.</p></li><li><p>Choose New board or press Ctrl+Shift+N to sketch a diagram.</p></li></ul><h2>Keep your place</h2><ul><li><p>Search with Ctrl+K.</p></li><li><p>Open a note's options and choose Show as reference to keep it beside your writing.</p></li><li><p>Use Focus (Ctrl+Shift+F) for more writing space.</p></li></ul><h2>Save and back up</h2><p>Your notes save automatically on this computer. Check the save status and retry if a save fails. Export a portable backup from Settings regularly, and before updating Scribly. Settings also offers Light, Dark, and System appearance and text-size preferences.</p>",
      createdAt: stamp,
      updatedAt: stamp,
      archived: false,
    }],
  };
}

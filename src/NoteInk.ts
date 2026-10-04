import { Extension } from "@tiptap/core";
import { inkAttributes, inkNodes, readInk } from "./inkData";
import { Plugin } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

export const NoteInk = Extension.create({
  name: "noteInk",
  priority: 1100,
  addKeyboardShortcuts() {
    return { Enter: () => {
      const { selection } = this.editor.state, parent = selection.$from.parent;
      if (!selection.empty || !["paragraph", "heading"].includes(parent.type.name) || !readInk(parent.attrs.ink).length) return false;
      const originalPos = selection.$from.before(), atStart = selection.$from.parentOffset === 0, ink = parent.attrs.ink;
      return this.editor.chain().splitBlock().command(({ tr }) => {
        const target = tr.selection.$from, targetPos = target.before();
        if (targetPos === originalPos) return true;
        tr.setNodeMarkup(targetPos, undefined, { ...target.parent.attrs, ink: atStart ? ink : null });
        if (atStart) {
          const ownerPos = tr.mapping.map(originalPos, -1), owner = tr.doc.nodeAt(ownerPos);
          if (owner) tr.setNodeMarkup(ownerPos, undefined, { ...owner.attrs, ink: null });
        }
        return true;
      }).run();
    } };
  },
  addGlobalAttributes() {
    return [{ types: inkNodes, attributes: { ink: {
      default: null, keepOnSplit: false,
      parseHTML: el => { const ink = readInk(el.getAttribute("data-note-ink")); return ink.length ? ink : null; },
      renderHTML: attrs => inkAttributes(attrs.ink),
    } } }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, previous, current) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      const mapping = new Mapping(); transactions.forEach(tr => mapping.appendMapping(tr.mapping));
      const tr = current.tr;
      previous.doc.forEach((node, pos) => {
        if (!node.isTextblock || !readInk(node.attrs.ink).length || !node.content.size) return;
        const mapped = mapping.mapResult(pos + 1, 1); if (mapped.deleted || mapped.pos >= current.doc.content.size) return;
        const resolved = current.doc.resolve(mapped.pos); if (resolved.depth !== 1) return;
        const targetPos = resolved.before(1), ownerPos = mapping.map(pos, -1);
        if (targetPos === ownerPos) return;
        const owner = tr.doc.nodeAt(ownerPos), target = tr.doc.nodeAt(targetPos);
        // Enter at the beginning creates a blank block above the old text.
        // Move its annotations with that text rather than leave them on the blank.
        if (owner?.isTextblock && !owner.content.size && target?.type === node.type && target.textContent === node.textContent
          && JSON.stringify(owner.attrs.ink) === JSON.stringify(node.attrs.ink)
          && (!readInk(target.attrs.ink).length || JSON.stringify(target.attrs.ink) === JSON.stringify(node.attrs.ink))) {
          tr.setNodeMarkup(ownerPos, undefined, { ...owner.attrs, ink: null });
          tr.setNodeMarkup(targetPos, undefined, { ...target.attrs, ink: node.attrs.ink });
        }
      });
      return tr.docChanged ? tr : null;
    } })];
  },
});

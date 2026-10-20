import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { readInk } from "./inkData";

export const ListEditing = Extension.create({
  name: "listEditing",
  // Handle this narrow case before Tiptap's list keymap lifts the empty item.
  priority: 110,
  addKeyboardShortcuts() {
    const removeEmptyMiddleItem = () => {
      const { state } = this.editor;
      const { selection } = state;
      if (!this.editor.isEditable || !(selection instanceof TextSelection) || !selection.empty) return false;

      const { $from } = selection;
      const itemDepth = $from.depth - 1;
      if (itemDepth < 1 || $from.parent.type.name !== "paragraph" || $from.parent.content.size
        || readInk($from.parent.attrs.ink).length) return false;

      const item = $from.node(itemDepth);
      const list = $from.node(itemDepth - 1);
      const index = $from.index(itemDepth - 1);
      const matchingList = item.type.name === "listItem"
        ? ["bulletList", "orderedList"].includes(list.type.name)
        : item.type.name === "taskItem" && list.type.name === "taskList";
      // First/last items retain the normal list exit behavior. Items containing
      // additional paragraphs or child lists must keep their content intact.
      if (!matchingList || item.childCount !== 1 || index === 0 || index === list.childCount - 1) return false;

      const from = $from.before(itemDepth);
      const tr = state.tr.delete(from, from + item.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
      this.editor.view.dispatch(tr.scrollIntoView());
      return true;
    };
    return { Backspace: removeEmptyMiddleItem, "Mod-Backspace": removeEmptyMiddleItem };
  },
});

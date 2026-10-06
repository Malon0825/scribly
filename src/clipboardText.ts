import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

// Read original document positions so copying part of a numbered list keeps
// its actual numbering, while copying a word does not invent a list marker.
export function noteClipboardText(_slice: Slice, view: EditorView): string {
  const { doc, selection } = view.state;
  return [...selection.ranges].sort((a, b) => a.$from.pos - b.$from.pos).map(range => {
    const from = range.$from.pos, to = range.$to.pos;
    const lines: string[] = [];
    let previous: { section: ProseMirrorNode; text: string } | undefined;
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return;
      const start = pos + 1;
      const resolved = doc.resolve(pos);
      const section = doc.child(resolved.index(0));
      let prefix = "";
      if (from <= start && to >= start + node.content.size) {
        let itemDepth = 0, nesting = 0;
        for (let depth = 1; depth <= resolved.depth; depth++) {
          if (["listItem", "taskItem"].includes(resolved.node(depth).type.name)) {
            itemDepth = depth; nesting++;
          }
        }
        if (itemDepth) {
          const item = resolved.node(itemDepth), list = resolved.node(itemDepth - 1);
          const marker = item.type.name === "taskItem" ? (item.attrs.checked ? "[x] " : "[ ] ")
            : list.type.name === "orderedList" ? `${list.attrs.start + resolved.index(itemDepth - 1)}. ` : "• ";
          prefix = "  ".repeat(nesting - 1) + (resolved.index(itemDepth) === 0 ? marker : " ".repeat(marker.length));
        }
      }
      const text = prefix + node.textBetween(Math.max(0, from - start), Math.min(node.content.size, to - start), "", leaf =>
        leaf.type.name === "hardBreak" ? "\n" : leaf.type.spec.leafText?.(leaf) || "");
      // Separate sections once, keeping a heading attached to its following list.
      // An explicit blank paragraph or line break already provides separation.
      const headingList = previous?.section.type.name === "heading" && ["bulletList", "orderedList", "taskList"].includes(section.type.name);
      if (previous && previous.section !== section && !headingList && previous.text && text && !previous.text.endsWith("\n") && !text.startsWith("\n")) lines.push("");
      lines.push(text);
      previous = { section, text };
      return false;
    });
    return lines.join("\n");
  }).join("\n");
}

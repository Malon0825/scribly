import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { itemHref, validItemId, safeExternalHref } from "./itemLinks";
export const ItemLink = Mark.create<{
  activate: (id: string, anchor: HTMLElement, action: "open" | "reference" | "options") => void;
  external: (href: string) => void;
  readOnly: () => boolean;
}>({
  name: "itemLink", priority: 1100, inclusive: false, excludes: "link",
  addOptions: () => ({ activate: () => {}, external: () => {}, readOnly: () => false }),
  addAttributes() { return { targetId: { default: null, parseHTML: el => el.getAttribute("data-item-id"), renderHTML: attrs => validItemId(attrs.targetId) ? { "data-item-id": attrs.targetId, href: itemHref(attrs.targetId) } : {} } }; },
  parseHTML() { return [{ tag: "a[data-item-id]", getAttrs: el => validItemId(el.getAttribute("data-item-id")) ? {} : false }]; },
  renderHTML({ HTMLAttributes }) { return ["a", mergeAttributes(HTMLAttributes, { class: "item-link", tabindex: "0", title: "Ctrl+click to open. Alt+click or Enter for link options." }), 0]; },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin({ props: { handleDOMEvents: {
      click: (_view, event) => {
        const anchor = (event.target as Element)?.closest<HTMLElement>("a[href]"); if (!anchor) return false;
        event.preventDefault();
        const id = anchor.getAttribute("data-item-id");
        if (validItemId(id)) {
          if (event.ctrlKey || event.metaKey || options.readOnly()) options.activate(id, anchor, event.altKey ? "reference" : "open");
          else if (event.altKey || event.detail === 0) options.activate(id, anchor, "options");
        } else {
          const href = anchor.getAttribute("href");
          if (safeExternalHref(href) && (event.ctrlKey || event.metaKey || options.readOnly() || event.detail === 0)) options.external(href);
        }
        return true;
      },
      keydown: (_view, event) => {
        if (event.key !== "Enter") return false;
        const anchor = (event.target as Element)?.closest<HTMLElement>("a[data-item-id]"); const id = anchor?.getAttribute("data-item-id");
        if (!anchor || !validItemId(id)) return false;
        event.preventDefault(); options.activate(id, anchor, "options"); return true;
      },
    } } })];
  },
});

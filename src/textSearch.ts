import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type SearchOptions = { query: string; caseSensitive: boolean; wholeWord: boolean };
export type TextMatch = { from: number; to: number };
type SearchState = SearchOptions & { matches: TextMatch[]; index: number; decorations: DecorationSet };
export const searchKey = new PluginKey<SearchState>("noteFind");
export const emptySearch = { query: "", caseSensitive: false, wholeWord: false };
export function literalPattern(query: string, caseSensitive = false) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "gu" : "giu");
}
export function findTextMatches(doc: Node, options: SearchOptions): TextMatch[] {
  if (!options.query) return [];
  const pattern = literalPattern(options.query, options.caseSensitive), matches: TextMatch[] = [];
  const wordEnd = /[\p{L}\p{N}\p{M}\p{Pc}]$/u, wordStart = /^[\p{L}\p{N}\p{M}\p{Pc}]/u;
  doc.descendants((block, position) => {
    if (!block.isTextblock) return;
    let text = "";
    const positions: number[] = [];
    block.descendants((node, offset) => {
      if (node.isText) {
        const value = node.text || "";
        text += value;
        for (let i = 0; i < value.length; i++) positions.push(position + 1 + offset + i);
      } else if (node.isLeaf) { text += "\uFFFC"; positions.push(position + 1 + offset); }
    });
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index!, end = start + match[0].length;
      if (match[0].includes("\uFFFC") || (options.wholeWord && (wordEnd.test(text.slice(0, start)) || wordStart.test(text.slice(end))))) continue;
      matches.push({ from: positions[start], to: positions[end - 1] + 1 });
    }
    return false;
  });
  return matches;
}
export const NoteSearch = Extension.create({
  name: "noteFind",
  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: () => ({ ...emptySearch, matches: [], index: -1, decorations: DecorationSet.empty }),
        apply(transaction, previous) {
          const meta = transaction.getMeta(searchKey) as Partial<SearchOptions> & { index?: number; near?: number } | undefined;
          if (!transaction.docChanged && !meta) return previous;
          const options = { query: meta?.query ?? previous.query, caseSensitive: meta?.caseSensitive ?? previous.caseSensitive, wholeWord: meta?.wholeWord ?? previous.wholeWord };
          const changed = options.query !== previous.query || options.caseSensitive !== previous.caseSensitive || options.wholeWord !== previous.wholeWord;
          const matches = transaction.docChanged || changed ? findTextMatches(transaction.doc, options) : previous.matches;
          let index = meta?.index ?? previous.index;
          if (meta?.near !== undefined || changed) {
            index = matches.findIndex(match => match.from >= (meta?.near ?? transaction.selection.from));
            if (index < 0 && matches.length) index = 0;
          }
          index = matches.length ? Math.max(0, Math.min(index, matches.length - 1)) : -1;
          // Bound painting independently of match counting/navigation in very large notes.
          const start = Math.max(0, index - 500);
          const decorations = DecorationSet.create(transaction.doc, matches.slice(start, start + 1000).map((match, i) =>
            Decoration.inline(match.from, match.to, { class: start + i === index ? "find-match find-current" : "find-match" })));
          return { ...options, matches, index, decorations };
        },
      },
      props: { decorations: state => searchKey.getState(state)?.decorations },
    })];
  },
});

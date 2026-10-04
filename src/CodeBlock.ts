import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CodeBlockView } from "./CodeBlockView";
import { cachedHighlight, requestHighlight } from "./codeHighlightClient";
import { MAX_HIGHLIGHT_LENGTH, normalizeCodeLanguage, type CodeHighlight } from "./codeLanguages";

const key = new PluginKey<DecorationSet>("notify-code-highlight");
export const NotifyCodeBlock = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeBlockView, { contentDOMElementTag: "span" }); },
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, decorations) => transaction.getMeta(key) || decorations.map(transaction.mapping, transaction.doc),
      },
      props: {
        decorations: (state) => key.getState(state),
        handlePaste(view, event) {
          if (!view.editable || view.state.selection.$from.parent.type.name === "codeBlock") return false;
          const text = event.clipboardData?.getData("text/plain");
          const match = text?.match(/^```([\w+#-]*)\r?\n([\s\S]*?)\r?\n```\s*$/);
          if (!match) return false;
          const language = normalizeCodeLanguage(match[1]);
          const content = match[2] ? view.state.schema.text(match[2].replace(/\r\n/g, "\n")) : undefined;
          const code = view.state.schema.nodes.codeBlock.create({ language }, content);
          view.dispatch(view.state.tr.replaceSelectionWith(code).scrollIntoView());
          return true;
        },
      },
      view(view) {
        let destroyed = false;
        let timer: ReturnType<typeof setTimeout>;
        const waiting = new Set<Promise<unknown>>();
        const results = new Map<string, CodeHighlight>();
        function refresh() {
          if (destroyed) return;
          const decorations: Decoration[] = [];
          const currentKeys = new Set<string>();
          view.state.doc.descendants((node, pos) => {
            if (node.type.name !== "codeBlock") return;
            const cacheKey = `${node.attrs.language || "auto"}\0${node.textContent}`;
            currentKeys.add(cacheKey);
            const result = results.get(cacheKey) || cachedHighlight(node.textContent, node.attrs.language);
            if (result) {
              for (const token of result.tokens) decorations.push(Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.classes }));
            } else if (node.textContent && node.textContent.length <= MAX_HIGHLIGHT_LENGTH && node.attrs.language !== "plaintext") {
              const request = requestHighlight(node.textContent, node.attrs.language);
              if (!waiting.has(request)) {
                waiting.add(request);
                void request.then((highlight) => { waiting.delete(request); if (!destroyed) { results.set(cacheKey, highlight); clearTimeout(timer); timer = setTimeout(refresh, 0); } });
              }
            }
            return false;
          });
          for (const cacheKey of results.keys()) if (!currentKeys.has(cacheKey)) results.delete(cacheKey);
          if (!decorations.length && !(key.getState(view.state)?.find().length)) return;
          view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decorations)).setMeta("addToHistory", false));
        }
        timer = setTimeout(refresh, 0);
        return {
          update: (next, previous) => {
            if (next.state.doc.eq(previous.doc)) return;
            clearTimeout(timer);
            timer = setTimeout(refresh, 180);
          },
          destroy: () => { destroyed = true; clearTimeout(timer); waiting.clear(); results.clear(); },
        };
      },
    })];
  },
}).configure({ enableTabIndentation: true, tabSize: 2, defaultLanguage: null });

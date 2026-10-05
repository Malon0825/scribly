import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type Context = { position: number; text: string; prefix: string; left: string; topics: string };
type Suggestion = { context: Context; suffix: string; width: number };
type Options = { enabled: () => boolean; announce: (text: string) => void };
const key = new PluginKey<Suggestion | null>("nextWordPrediction");
const stopwords = new Set("a an and are as at be been but by can could did do does for from had has have he her him his how i if in is it its may me my not of on or our she should so than that the their them then there these they this those to too us was we were what when where which who will with would you your".split(" "));
const cache = new Map<string, { words: string[]; time: number }>();
let serviceUnavailableUntil = 0;

function contextAt(state: EditorState): Context | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const position = selection.$from;
  if (!["paragraph", "heading"].includes(position.parent.type.name) || position.parentOffset !== position.parent.content.size) return null;
  if ((state.storedMarks ?? position.marks()).some(mark => ["code", "link", "itemLink"].includes(mark.type.name))) return null;
  const text = position.parent.textBetween(Math.max(0, position.parentOffset - 240), position.parentOffset, "\n", "\uFFFC");
  if (!text || /[\uFFFC\n]/.test(text) || !/[a-z\s]$/i.test(text) || /[.!?]\s*$/.test(text)) return null;
  const prefix = /[a-z]+(?:['-][a-z]+)*$/i.exec(text)?.[0] || "";
  const before = prefix ? text.slice(0, -prefix.length) : text;
  const sentence = before.split(/[.!?]/).pop() || "";
  const words = sentence.match(/[a-z]+(?:['-][a-z]+)*/gi) || [];
  const left = words.at(-1)?.toLowerCase();
  if (!left || left.length > 40 || prefix.length > 40) return null;
  const topics = [...new Set(words.slice(-24).map(word => word.toLowerCase()).filter(word => word.length > 2 && word.length <= 40 && !stopwords.has(word)))].slice(-5).join(",");
  return { position: selection.from, text, prefix, left, topics };
}
const same = (a: Context | null, b: Context) => !!a && a.position === b.position && a.text === b.text;
const queryKey = (context: Context) => `${context.left}|${context.topics}|${context.prefix.toLowerCase()}`;
function cachedWords(context: Context): string[] | undefined {
  const prefix = context.prefix.toLowerCase();
  // A broader cached result can immediately finish a word while the user types.
  for (let length = prefix.length; length >= 0; length--) {
    const result = cache.get(`${context.left}|${context.topics}|${prefix.slice(0, length)}`);
    if (result && Date.now() - result.time < 300_000) {
      const words = result.words.filter(word => word.startsWith(prefix) && word.length > prefix.length);
      if (words.length || length === prefix.length) return words;
    }
  }
}
async function predict(context: Context, signal: AbortSignal): Promise<string[]> {
  if (Date.now() < serviceUnavailableUntil) return [];
  const params = new URLSearchParams({ rel_bga: context.left, lc: context.left, max: "8" });
  if (context.topics) params.set("ml", context.topics.replaceAll(",", " "));
  if (context.prefix) params.set("sp", `${context.prefix.toLowerCase()}*`);
  const request = () => fetch(`https://api.datamuse.com/words?${params}`, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  let response = await request();
  let data: unknown = await response.json();
  // Topic hints currently fail on frequent-follower queries, so nearby words
  // use the supported means-like constraint. If semantic filtering also fails,
  // retain the immediate context and follower constraint within the same budget.
  if (params.has("ml") && (response.status === 500 || (data && typeof data === "object" && "code" in data && data.code === 500) || (Array.isArray(data) && data.length === 0))) {
    params.delete("ml");
    response = await request(); data = await response.json();
  }
  if (!response.ok) {
    serviceUnavailableUntil = Date.now() + (response.status === 429 ? 60_000 : 10_000);
    throw new Error("Prediction unavailable");
  }
  if (!Array.isArray(data)) throw new Error("Invalid prediction response");
  const words = data.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("word" in item) || typeof item.word !== "string") return [];
    const word = item.word.toLowerCase();
    return /^[a-z]+(?:['-][a-z]+)*$/.test(word) && word.length <= 40 && word !== context.left && word.startsWith(context.prefix.toLowerCase()) && word.length > context.prefix.length ? [word] : [];
  });
  if (cache.size >= 120) cache.delete(cache.keys().next().value!);
  cache.set(queryKey(context), { words, time: Date.now() });
  return words;
}

export const NextWordPrediction = Extension.create<Options>({
  name: "nextWordPrediction",
  priority: 1000,
  addOptions: () => ({ enabled: () => true, announce: () => {} }),
  addProseMirrorPlugins() {
    const options = this.options;
    let cancel = () => {};
    return [new Plugin<Suggestion | null>({
      key,
      state: {
        init: () => null,
        apply(transaction, previous, _old, state) {
          if (transaction.getMeta(key) !== undefined) return transaction.getMeta(key) as Suggestion | null;
          if (transaction.docChanged || transaction.selectionSet || !options.enabled()) return null;
          return previous && same(contextAt(state), previous.context) ? previous : null;
        },
      },
      props: {
        decorations(state) {
          const suggestion = key.getState(state);
          if (!suggestion || !options.enabled()) return DecorationSet.empty;
          return DecorationSet.create(state.doc, [Decoration.widget(suggestion.context.position, () => {
            const ghost = document.createElement("span");
            ghost.className = "prediction-ghost"; ghost.contentEditable = "false"; ghost.setAttribute("aria-hidden", "true");
            const text = document.createElement("span"); text.className = "prediction-ghost-text";
            text.style.maxWidth = `${suggestion.width}px`;
            const word = document.createElement("span"); word.textContent = suggestion.suffix;
            const hint = document.createElement("kbd"); hint.textContent = "Tab";
            text.append(word, hint); ghost.append(text); return ghost;
          }, { side: 1, key: suggestion.suffix, ignoreSelection: true })]);
        },
        handleKeyDown(view, event) {
          if (event.isComposing || view.composing || event.keyCode === 229) return false;
          if (event.key === "Escape") { const active = !!key.getState(view.state); cancel(); return active; }
          if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
          const suggestion = key.getState(view.state);
          if (!suggestion || !options.enabled() || !view.editable || !same(contextAt(view.state), suggestion.context)) return false;
          if (event.repeat) return true;
          cancel();
          // Ghost text is only a decoration. Tab is the sole document mutation,
          // inserted through normal validation/autosave with a separate undo step.
          view.dispatch(closeHistory(view.state.tr).insertText(`${suggestion.suffix} `).scrollIntoView());
          return true;
        },
      },
      view(view) {
        let timer = 0, timeout = 0, generation = 0;
        let request: AbortController | null = null;
        let destroyed = false;
        const clear = () => {
          generation++; window.clearTimeout(timer); window.clearTimeout(timeout); request?.abort(); request = null;
          if (!destroyed && key.getState(view.state)) view.dispatch(view.state.tr.setMeta(key, null));
          options.announce("");
        };
        cancel = clear;
        const show = (context: Context, words: string[]) => {
          if (destroyed || !view.hasFocus() || !view.editable || view.composing || !options.enabled() || !same(contextAt(view.state), context) || !words[0]) return;
          const caret = view.coordsAtPos(context.position);
          const block = view.domAtPos(context.position).node;
          const element = block instanceof HTMLElement ? block : block.parentElement;
          const edge = element?.closest("p, h1, h2, h3, h4, h5, h6")?.getBoundingClientRect().right ?? view.dom.getBoundingClientRect().right;
          const width = Math.min(220, edge - caret.left - 4);
          if (width < 75) return;
          const suffix = words[0].slice(context.prefix.length);
          view.dispatch(view.state.tr.setMeta(key, { context, suffix, width } satisfies Suggestion));
          options.announce(`Suggestion: ${words[0]}. Press Tab to accept or Escape to dismiss.`);
        };
        const schedule = () => {
          clear();
          if (destroyed || !view.hasFocus() || !view.editable || view.composing || !options.enabled()) return;
          const context = contextAt(view.state);
          if (!context) return;
          const cached = cachedWords(context);
          if (cached) { show(context, cached); return; }
          const serial = generation;
          timer = window.setTimeout(() => {
            if (generation !== serial || destroyed) return;
            const controller = new AbortController(); request = controller;
            timeout = window.setTimeout(() => controller.abort(), 1500);
            predict(context, controller.signal).then(words => { if (serial === generation) show(context, words); })
              .catch(() => { /* An unavailable service must never interrupt writing. */ })
              .finally(() => { if (request === controller) { window.clearTimeout(timeout); request = null; } });
          }, 120);
        };
        const composed = () => { window.clearTimeout(timer); timer = window.setTimeout(schedule, 0); };
        const resize = new ResizeObserver(clear); resize.observe(view.dom);
        view.dom.addEventListener("blur", clear); view.dom.addEventListener("pointerdown", clear);
        view.dom.addEventListener("compositionstart", clear); view.dom.addEventListener("compositionend", composed);
        window.addEventListener("blur", clear);
        document.addEventListener("notify:action-open", clear);
        return {
          update(_view, previous) {
            if (!options.enabled()) { clear(); return; }
            if (view.state.doc !== previous.doc) schedule();
            else if (!view.state.selection.eq(previous.selection) || (key.getState(previous) && !key.getState(view.state))) clear();
          },
          destroy() {
            destroyed = true; clear(); resize.disconnect();
            view.dom.removeEventListener("blur", clear); view.dom.removeEventListener("pointerdown", clear);
            view.dom.removeEventListener("compositionstart", clear); view.dom.removeEventListener("compositionend", composed);
            window.removeEventListener("blur", clear); document.removeEventListener("notify:action-open", clear);
          },
        };
      },
    })];
  },
});

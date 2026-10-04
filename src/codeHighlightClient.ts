import { MAX_HIGHLIGHT_LENGTH, normalizeCodeLanguage, type CodeHighlight } from "./codeLanguages";

type Entry = { promise: Promise<CodeHighlight>; result?: CodeHighlight };
const cache = new Map<string, Entry>();
const pending = new Map<number, { resolve: (result: CodeHighlight) => void; timer: ReturnType<typeof setTimeout> }>();
let worker: Worker | undefined;
let nextId = 0;
let failed = false;
const keyFor = (code: string, language: unknown) => `${normalizeCodeLanguage(language) || "auto"}\0${code}`;
const fallback: CodeHighlight = { language: "plaintext", tokens: [], unavailable: true };
function stopWorker() {
  worker?.terminate();
  worker = undefined;
  failed = true;
  for (const item of pending.values()) { clearTimeout(item.timer); item.resolve(fallback); }
  pending.clear();
}
export function cachedHighlight(code: string, language: unknown) {
  if (code.length > MAX_HIGHLIGHT_LENGTH) return { language: "plaintext", tokens: [], limited: true } as CodeHighlight;
  if (!code || normalizeCodeLanguage(language) === "plaintext") return { language: "plaintext", tokens: [] } as CodeHighlight;
  if (failed) return fallback;
  return cache.get(keyFor(code, language))?.result;
}
export function requestHighlight(code: string, language: unknown): Promise<CodeHighlight> {
  if (code.length > MAX_HIGHLIGHT_LENGTH) return Promise.resolve({ language: "plaintext", tokens: [], limited: true });
  if (!code || normalizeCodeLanguage(language) === "plaintext") return Promise.resolve({ language: "plaintext", tokens: [] });
  const key = keyFor(code, language);
  const existing = cache.get(key);
  if (existing) return existing.promise;
  if (failed) return Promise.resolve(fallback);
  if (!worker) {
    try {
      // Vite builds a separate worker asset. No syntax engine loads for ordinary notes.
      worker = new Worker(new URL("./codeHighlight.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ id: number; result: CodeHighlight }>) => {
        const item = pending.get(event.data.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(event.data.id);
        item.resolve(event.data.result);
      };
      worker.onerror = stopWorker;
    } catch { stopWorker(); return Promise.resolve(fallback); }
  }
  const entry = {} as Entry;
  const id = ++nextId;
  entry.promise = new Promise<CodeHighlight>((resolve) => {
    pending.set(id, { resolve, timer: setTimeout(stopWorker, 8000) });
    worker!.postMessage({ id, code, language: normalizeCodeLanguage(language) });
  }).then((result) => { entry.result = result; return result; });
  cache.set(key, entry);
  // Bound retained snippets and token arrays; pending promises are owned by their callers.
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return entry.promise;
}

import { highlightCode } from "./codeHighlighter";
self.onmessage = (event: MessageEvent<{ id: number; code: string; language: string | null }>) => {
  const { id, code, language } = event.data;
  self.postMessage({ id, result: highlightCode(code, language) });
};

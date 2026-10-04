import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ArrowLeft, ArrowRight, DownloadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { sourceFromElement, formatFileSize, SOURCE_PAGE_BYTES, validSource, type SourceFile } from "./sourceFileData";
import { downloadSource, sourcePage } from "./sourceFiles";

function SourceFileView({ node }: ReactNodeViewProps) {
  const source = node.attrs.source as SourceFile;
  const [page, setPage] = useState(0), [text, setText] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0), [downloading, setDownloading] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  const pages = Math.max(1, Math.ceil(source.size / SOURCE_PAGE_BYTES));
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setText("");
    void sourcePage(source, page).then(value => {
      if (!cancelled) { setText(value); setLoading(false); textRef.current?.scrollTo(0, 0); }
    }).catch(reason => { if (!cancelled) { setError(String(reason)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [source.id, source.size, source.encoding, page, retry]);
  return <NodeViewWrapper className="source-file-block" contentEditable={false}>
    <div className="source-file-header">
      <div><strong>{source.name}</strong><span>{formatFileSize(source.size)} · Read-only original</span></div>
      <button type="button" disabled={downloading} onClick={() => {
        setDownloading(true);
        void downloadSource(source).catch(reason => setError(String(reason))).finally(() => setDownloading(false));
      }}><DownloadSimple size={18} />{downloading ? "Downloading…" : "Download original"}</button>
    </div>
    <p className="source-file-hint">Browse the file in sections. The complete original is saved; write your notes below.</p>
    <div className="source-file-navigation" aria-label={`Sections of ${source.name}`}>
      <button type="button" aria-label="Previous file section" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}><ArrowLeft size={18} />Previous</button>
      <label>Section <input type="number" aria-label="File section" min={1} max={pages} value={page + 1}
        onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= pages) setPage(value - 1); }} /> of {pages.toLocaleString()}</label>
      <button type="button" aria-label="Next file section" disabled={page + 1 >= pages} onClick={() => setPage(value => Math.min(pages - 1, value + 1))}>Next<ArrowRight size={18} /></button>
    </div>
    {loading && <p role="status">Loading section…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry section</button></div>}
    <pre ref={textRef} className="source-file-text" tabIndex={0} role="region" aria-label={`${source.name}, section ${page + 1}`} aria-busy={loading}>{text}</pre>
  </NodeViewWrapper>;
}
export const NotifySourceFile = Node.create({
  name: "sourceFile", group: "block", atom: true, selectable: true,
  addAttributes() { return { source: { default: null, parseHTML: sourceFromElement } }; },
  parseHTML() { return [{ tag: "div[data-notify-source]", getAttrs: element => sourceFromElement(element) ? {} : false }]; },
  renderHTML({ node }) {
    const source = node.attrs.source;
    if (!validSource(source)) return ["p", "[Source file unavailable]"];
    return ["div", { "data-notify-source": "", "data-source-id": source.id, "data-source-name": source.name, "data-source-size": source.size, "data-source-encoding": source.encoding }];
  },
  addNodeView() { return ReactNodeViewRenderer(SourceFileView); },
});

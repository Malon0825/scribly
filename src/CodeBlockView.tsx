import { AnimatedIcon } from "./AnimatedIcon";
import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, Copy } from "@phosphor-icons/react";
import { codeLanguages, codeLanguageLabel, normalizeCodeLanguage, type CodeHighlight } from "./codeLanguages";
import { requestHighlight } from "./codeHighlightClient";
import { AppSelect } from "./AppSelect";

export function CodeBlockView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const code = node.textContent;
  const language = normalizeCodeLanguage(node.attrs.language);
  const [result, setResult] = useState<CodeHighlight | null>(null);
  const [wrap, setWrap] = useState(false);
  const [copyState, setCopyState] = useState("Copy");
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let gone = false;
    const timer = setTimeout(() => { void requestHighlight(code, language).then((value) => { if (!gone) setResult(value); }); }, 180);
    return () => { gone = true; clearTimeout(timer); };
  }, [code, language]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopyState("Copied"); }
    catch { setCopyState("Copy failed"); }
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("Copy"), 2000);
  }
  return (
    <NodeViewWrapper className="code-block" data-wrap={wrap || undefined}>
      <div className="code-block-header" contentEditable={false}>
        {editor.isEditable ? (
          <AppSelect label="Code language" className="code-language-picker" value={language || "auto"}
            onChange={(value) => updateAttributes({ language: value === "auto" ? null : value })}
            options={[{ value: "auto", label: `Auto${result ? ` · ${codeLanguageLabel(result.language)}` : " · Detecting…"}` },
              { value: "plaintext", label: "Plain text" }, ...codeLanguages.map((item) => ({ value: item.id, label: item.label }))]} />
        ) : <span>{codeLanguageLabel(language || result?.language || "plaintext")}</span>}
        <div className="code-block-actions">
          <button aria-label="Wrap code lines" aria-pressed={wrap} title="Wrap long lines" onClick={() => setWrap((value) => !value)}><AnimatedIcon kind="alignLeft" size={17} /></button>
          <button aria-label="Copy code" title={copyState} onClick={() => void copy()}>
            {copyState === "Copied" ? <Check size={17} /> : <AnimatedIcon kind="copy" size={17} />}<span>{copyState}</span>
          </button>
        </div>
      </div>
      <pre><NodeViewContent<"code"> as="code" /></pre>
      <span className="sr-only" role="status" contentEditable={false}>{copyState === "Copy" ? "" : copyState}</span>
      {(result?.limited || result?.unavailable) && <div className="code-block-hint" contentEditable={false}>
        {result.limited ? "Large block · highlighting paused to keep editing fast" : "Highlighting unavailable · code is preserved"}
      </div>}
    </NodeViewWrapper>
  );
}

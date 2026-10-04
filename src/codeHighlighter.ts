import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import markdown from "highlight.js/lib/languages/markdown";
import type { Root, RootContent } from "hast";
import { MAX_HIGHLIGHT_LENGTH, normalizeCodeLanguage, type CodeHighlight, type CodeToken } from "./codeLanguages";

const lowlight = createLowlight({ javascript, typescript, rust, python, xml, css, json, sql, bash, java, c, cpp, csharp, go, yaml, ini, markdown });
// Restrict automatic guesses to common notebook snippets. Additional languages remain selectable.
const detectionSubset = ["javascript", "typescript", "rust", "python", "xml", "css", "json", "sql", "bash", "java", "cpp", "csharp", "go", "yaml", "ini", "markdown"];
function detectLanguage(code: string): string {
  const sample = code.slice(0, 4000).trim();
  if (!sample) return "plaintext";
  if (/^[\[{]/.test(sample)) {
    try { JSON.parse(code); return "json"; } catch { /* Incomplete snippets still get a grammar guess. */ }
  }
  if (/^<!doctype\s+html|^<\?xml|^<([a-z][\w-]*)\b[^>]*>/i.test(sample)) return "xml";
  if (/\b(?:pub\s+)?fn\s+\w+\s*\(|\buse\s+[\w]+::|\bimpl\s+\w+/.test(sample)) return "rust";
  if (/\b(?:interface|type)\s+\w+\s*(?:[={]|extends)|\b(?:const|let)\s+\w+\s*:\s*\w+/.test(sample)) return "typescript";
  if (/^(?:select\b[\s\S]*\bfrom\b|with\b[\s\S]*\bas\s*\(|create\s+table\b|insert\s+into\b|update\b[\s\S]*\bset\b)/i.test(sample)) return "sql";
  const result = lowlight.highlightAuto(sample, { subset: detectionSubset });
  return (result.data?.relevance || 0) >= 2 ? result.data?.language || "plaintext" : "plaintext";
}
function collectTokens(tree: Root): CodeToken[] {
  const tokens: CodeToken[] = [];
  let offset = 0;
  function visit(nodes: RootContent[], classes: string[]) {
    for (const node of nodes) {
      if (node.type === "text") {
        const end = offset + node.value.length;
        if (end > offset && classes.length) tokens.push({ from: offset, to: end, classes: [...new Set(classes)].join(" ") });
        offset = end;
      } else if (node.type === "element") {
        const own = (node.properties.className as string[] | undefined) || [];
        visit(node.children as RootContent[], [...classes, ...own]);
      }
    }
  }
  visit(tree.children, []);
  return tokens;
}
export function highlightCode(code: string, requestedLanguage: unknown): CodeHighlight {
  if (code.length > MAX_HIGHLIGHT_LENGTH) return { language: "plaintext", tokens: [], limited: true };
  const language = normalizeCodeLanguage(requestedLanguage) || detectLanguage(code);
  if (language === "plaintext" || !code) return { language, tokens: [] };
  try { return { language, tokens: collectTokens(lowlight.highlight(language, code)) }; }
  catch { return { language: "plaintext", tokens: [], unavailable: true }; }
}

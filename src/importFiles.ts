import { parseBackup } from "./importBackup";
import { attachmentId, compactImages } from "./attachments";
import { normalizeCodeLanguage } from "./codeLanguages";
import { isImageFile, readImage } from "./imageFiles";
import { boardFromScene } from "./boardData";

export const MAX_IMPORT_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_IMPORT_FILES = 25;
const MAX_TEXT = 2_000_000;
export const importAccept = ".excalidraw,.mmd,.mermaid,.txt,.md,.markdown,.json,.csv,.tsv,.log,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.js,.jsx,.ts,.tsx,.py,.rs,.html,.xml,.svg,.css,.sql,.sh,.bash,.java,.c,.h,.cpp,.hpp,.cs,.go,.yaml,.yml,.ini,.toml,.env";
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
export const paragraphs = (text: string) => text.split(/\r\n|\r|\n/).map((line) => `<p>${escape(line)}</p>`).join("");

function decode(bytes: Uint8Array): string {
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le"
    : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw Error("Binary content");
    return text;
  } catch { throw Error("This file is not readable text. Use UTF-8 or UTF-16 text, a PDF, or Word .docx."); }
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // WebView2 updates independently of the app; the legacy build supplies
  // missing modern JS primitives without changing the rest of the interface.
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdf.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdf.getDocument({ data: bytes, disableFontFace: true });
  try {
    const document = await task.promise;
    if (document.numPages > 500) throw Error("PDF exceeds 500 pages. Split it into smaller documents.");
    let text = "";
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      text += "\n\n";
      page.cleanup();
      if (text.length > MAX_TEXT) throw Error("Extracted text is too large. Split this document first.");
    }
    if (!text.trim()) throw Error("This PDF has no selectable text. Use a text PDF or extract its text with OCR first.");
    return text.trim();
  } catch (error) {
    if ((error as Error).name === "PasswordException" || /destroyed/i.test(String(error)))
      throw Error("This PDF is password protected. Import an unlocked copy.");
    throw error;
  } finally { await task.destroy(); }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(bytes, { filter: (entry) => {
    if (entry.name !== "word/document.xml") return false;
    if (entry.originalSize > 10 * 1024 * 1024) throw Error("Word document text is too large. Split the document first.");
    return true;
  } });
  const xml = entries["word/document.xml"];
  if (!xml) throw Error("This is not a valid Word .docx file.");
  const document = new DOMParser().parseFromString(decode(xml), "application/xml");
  if (document.querySelector("parsererror")) throw Error("Word document text could not be read.");
  const read = (node: Node): string => {
    if (node instanceof Element) {
      if (node.localName === "t") return node.textContent || "";
      if (node.localName === "tab") return "\t";
      if (["br", "cr"].includes(node.localName)) return "\n";
      // Deleted revisions are not part of the visible document.
      if (node.localName === "del") return "";
    }
    return Array.from(node.childNodes).map(read).join("");
  };
  return Array.from(document.getElementsByTagNameNS("*", "p")).map(read).join("\n");
}

export async function parseImportFile(file: File) {
  if (file.size > MAX_IMPORT_FILE_SIZE) throw Error("File exceeds 20 MB.");
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "excalidraw") {
    const scene = JSON.parse(await file.text());
    return { kind: "board" as const, title: file.name.replace(/\.excalidraw$/i, ""), board: boardFromScene(scene) };
  }
  if (isImageFile(file) && ext !== "svg") {
    const image = await readImage(file);
    return { kind: "note" as const, title: file.name.replace(/\.[^.]+$/, "") || file.name,
      content: `<figure data-notify-image="" data-width="100" data-align="center"><img ${attachmentId(image.src) ? `data-notify-attachment="${attachmentId(image.src)}"` : `src="${image.src}"`} alt="${escape(image.alt)}" title="${escape(image.title)}"></figure><p></p>` };
  }
  if (ext === "doc") throw Error("Save this legacy Word file as .docx, then import it.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = ext === "pdf" ? await pdfText(bytes) : ext === "docx" ? await docxText(bytes) : decode(bytes);
  if (ext === "mmd" || ext === "mermaid") {
    const { importMermaidBoard } = await import("./boardMermaidImport");
    return { kind: "board" as const, title: file.name.replace(/\.[^.]+$/, ""), board: await importMermaidBoard(text) };
  }
  if (ext === "json") {
    let value: unknown;
    try { value = JSON.parse(text); } catch { /* Non-backup JSON stays literal code. */ }
    if (value && typeof value === "object" && "folders" in value && "notes" in value)
      return { kind: "backup" as const, backup: await compactImages(parseBackup(value)) };
  }
  // Backups carry embedded image data and use the notebook/file byte limit.
  // The extracted-character limit applies to ordinary text documents.
  if (text.length > MAX_TEXT) throw Error("Text exceeds 2 million characters. Split this file first.");
  const prose = ["pdf", "docx", "txt", "md", "markdown"].includes(ext);
  const language = normalizeCodeLanguage(ext) || "plaintext";
  return { kind: "note" as const, title: file.name.replace(/\.[^.]+$/, "") || file.name,
    content: prose ? paragraphs(text) : `<pre><code class="language-${language}">${escape(text)}</code></pre>` };
}

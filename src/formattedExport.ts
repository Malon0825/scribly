import { invoke } from "@tauri-apps/api/core";
import { strToU8, zip } from "fflate";
import { attachmentId, imageElementSource } from "./attachments";
import { MAX_IMAGE_BYTES, rasterType, safeInlineImageSource } from "./rasterImages";
import { itemIdFromHref, safeExternalHref, validItemId } from "./itemLinks";
import { sourceFromElement } from "./sourceFileData";
import { validTextColor } from "./textColors";
import type { Note } from "./types";

export type PreparedNoteExport = { html: string; markdown: Blob; markdownName: string; htmlName: string; warnings: string[]; noteCount: number };
// These are working-memory limits for one export, independent of notebook capacity.
const MAX_INPUT = 24 * 1024 * 1024, MAX_ASSETS = 32 * 1024 * 1024, MAX_OUTPUT = 96 * 1024 * 1024;
const allowed = new Set("p h1 h2 h3 h4 h5 h6 strong b em i u s del blockquote ul ol li pre code br hr span figure figcaption a img".split(" "));
const discarded = new Set("script style iframe object embed svg math link meta base template input button textarea select audio video".split(" "));
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeMarkdown = (text: string) => text.replace(/([\\`*_[\]<>#!|~])/g, "\\$1").replace(/^(\s*)([-+])(?=\s)/gm, "$1\\$2").replace(/^(\s*)(\d+)([.)])(?=\s)/gm, "$1$2\\$3");
function codeFence(text: string, minimum: number) {
  let longest = minimum - 1;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return "`".repeat(longest + 1);
}
function check(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError"); }
function cancellable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  check(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Export cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function yieldWork(signal?: AbortSignal) { await new Promise<void>(resolve => setTimeout(resolve, 0)); check(signal); }
function fileStem(value: string) {
  let stem = Array.from(value.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").trim().replace(/[. ]+$/g, "")).slice(0, 80).join("").replace(/[. ]+$/g, "");
  if (!stem) stem = "Untitled";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return stem;
}
const foreground = ["#1960a8", "#7041aa", "#267042", "#596575", "#76523d", "#9c4b10", "#775500", "#a53671", "#ab3235"];
const background = ["#dcecff", "#eee2fb", "#dfefe3", "#e9edf1", "#efe3d9", "#f8e6d7", "#f7edc7", "#f7e1ef", "#f8e1e0"];
const tones = ["blue", "purple", "green", "gray", "brown", "orange", "yellow", "pink", "red"];
const stylesheet = `html{color-scheme:light}body{margin:0;background:#fff;color:#202b3d;font:16px/1.65 "Segoe UI",system-ui,sans-serif}main{max-width:850px;margin:40px auto;padding:0 32px}article+article{border-top:1px solid #d8dfe8;margin-top:48px;padding-top:32px}h1,h2,h3,h4,h5,h6{line-height:1.25;break-after:avoid}p{margin:.7em 0;overflow-wrap:anywhere}a{color:#1960a8;overflow-wrap:anywhere}blockquote{border-left:3px solid #becbdd;margin-left:0;padding-left:20px}pre{background:#f0f3f7;padding:16px;border:1px solid #d8dfe8;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;tab-size:4}code{font-family:Consolas,monospace}figure{margin:20px 0;break-inside:avoid}img{display:block;width:100%;max-width:100%;height:auto}figcaption{color:#596575;font-size:.9em;margin-top:8px}li{margin:.3em 0}.tasks{list-style:none;padding-left:1.5em}.tasks>li{position:relative;padding-left:1.6em}.task-box{position:absolute;left:0;top:0}.tasks>li>p:first-of-type{margin-top:0}.export-warning{margin-top:32px;break-before:page}.source-file,.export-warning{background:#f0f3f7;border:1px solid #d8dfe8;padding:12px}.item-id{font-size:.85em;color:#596575}span[data-background-color]{border-radius:2px;box-decoration-break:clone}${tones.map((tone, i) => `[data-text-color="${tone}"]{color:${foreground[i]}}[data-background-color="${tone}"]{background:${background[i]}}`).join("")}@page{margin:18mm}@media print{main{max-width:none;margin:0;padding:0}article+article{break-before:page;border:0;margin:0;padding:0}pre{box-decoration-break:clone}a{color:#1960a8}img{max-height:240mm;object-fit:contain}p,li{orphans:3;widows:3}}`;

type Asset = { path: string; data: string; bytes: Uint8Array };
/** Prepares both complete artifacts before the caller may offer a download. Never changes notes or attachment storage. */
export async function prepareNoteExport(notes: readonly Note[], signal?: AbortSignal): Promise<PreparedNoteExport> {
  check(signal);
  if (!notes.length) throw Error("Choose at least one note to export.");
  if (notes.length > 1000) throw Error("Export up to 1,000 notes at a time.");
  // Capture primitive fields synchronously so later edits cannot change this export.
  const snapshot = notes.map(note => ({ id: note.id, title: note.title || "Untitled", content: note.content }));
  let inputSize = 0;
  for (const note of snapshot) { inputSize += note.content.length * 2 + note.title.length * 2; if (note.content.length > 12 * 1024 * 1024 || inputSize > MAX_INPUT) throw Error("This export is too large to prepare safely. Export fewer notes at a time."); }
  const warnings = new Set<string>(), assets = new Map<string, Asset>(), sources = new Map<string, Asset>();
  const entries: Record<string, Uint8Array> = {}, usedNames = new Set<string>(), names = new Map<string, string>(), anchors = new Map<string, string>();
  const noteNames = snapshot.map((note, index) => {
    const base = fileStem(note.title); let name = `${base}.md`, ordinal = 2;
    while (usedNames.has(name.toLocaleLowerCase("en-US"))) name = `${base} (${ordinal++}).md`;
    usedNames.add(name.toLocaleLowerCase("en-US")); names.set(note.id, name); anchors.set(note.id, `note-${index + 1}`); return name;
  });
  let assetBytes = 0, outputSize = 0, nodes = 0;
  const addSize = (size: number) => { outputSize += size; if (outputSize > MAX_OUTPUT) throw Error("The prepared export exceeds 96 MiB. Export fewer notes at a time."); };
  async function imageAsset(element: Element): Promise<Asset> {
    const source = imageElementSource(element), cached = sources.get(source); if (cached) return cached;
    const id = attachmentId(source); let bytes: Uint8Array;
    if (id) {
      try { bytes = new Uint8Array(await cancellable(invoke<ArrayBuffer>("read_attachment", { id }), signal)); }
      catch (error) { check(signal); throw Error(`An image could not be read (${id}). Restore it before exporting. ${String(error)}`); }
    } else if (safeInlineImageSource(source)) bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), character => character.charCodeAt(0));
    else throw Error("A note contains an unsafe or unavailable image. Restore or remove that image before exporting.");
    check(signal);
    const type = rasterType(bytes); if (!type || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Error("An image is invalid or exceeds the 5 MiB image limit. Export was not prepared.");
    const digest = new Uint8Array(await cancellable(crypto.subtle.digest("SHA-256", bytes as BufferSource), signal));
    const key = `${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}.${type}`;
    if (id && id !== key) throw Error("An image does not match its stored content reference. Restore it before exporting.");
    const existing = assets.get(key); if (existing) { sources.set(source, existing); return existing; }
    assetBytes += bytes.length; if (assetBytes > MAX_ASSETS) throw Error("Images in this export exceed 32 MiB. Export fewer notes at a time.");
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: `image/${type}` }));
    try {
      const image = new Image(); image.src = url;
      await cancellable(image.decode(), signal);
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 25_000_000) throw Error("Image dimensions exceed the image limit.");
    } catch (error) { check(signal); throw Error(`An image cannot be decoded. Restore it before exporting. ${String(error)}`); }
    finally { URL.revokeObjectURL(url); }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) { binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); if (i % (512 * 1024) === 0) await yieldWork(signal); }
    const asset = { path: `assets/${key}`, data: `data:image/${type};base64,${btoa(binary)}`, bytes };
    assets.set(key, asset); sources.set(source, asset); entries[asset.path] = bytes; return asset;
  }
  async function sanitize(node: Node, parent: Node, depth = 0): Promise<void> {
    if (++nodes > 100_000 || depth > 64) throw Error("A note is too complex to export safely. Split it into smaller notes.");
    if (nodes % 250 === 0) await yieldWork(signal);
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent || "")); return; }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase(); if (discarded.has(tag)) return;
    if (node.hasAttribute("data-note-ink")) warnings.add("Handwritten ink and freehand highlights are omitted from HTML, printing and Markdown. The notebook backup retains them.");
    if (node.hasAttribute("data-notify-source")) {
      const source = sourceFromElement(node); if (!source) throw Error("A source-file reference is invalid. Export was not prepared.");
      warnings.add("Original-file blocks contain filename, size and encoding only. Original file contents are not printed or included in these exports; download originals separately.");
      const paragraph = document.createElement("p"); paragraph.className = "source-file";
      paragraph.textContent = `Original file: ${source.name} — ${source.size.toLocaleString("en-US")} bytes, ${source.encoding}. Contents not included.`;
      parent.appendChild(paragraph); return;
    }
    if (!allowed.has(tag)) { for (const child of node.childNodes) await sanitize(child, parent, depth + 1); return; }
    const clean = document.createElement(tag); parent.appendChild(clean);
    for (const attribute of ["data-text-color", "data-background-color"]) {
      const tone = node.getAttribute(attribute);
      if (validTextColor(tone)) { clean.setAttribute(attribute, tone); warnings.add("Markdown does not preserve text colors, background colors, underline or exact page layout. HTML preserves semantic colors using a readable light theme."); }
    }
    if (tag === "u") warnings.add("Markdown does not preserve text colors, background colors, underline or exact page layout. HTML preserves semantic colors using a readable light theme.");
    if (tag === "img") {
      const asset = await imageAsset(node); addSize(asset.data.length * 2);
      clean.setAttribute("src", asset.data); clean.setAttribute("data-export-asset", asset.path);
      clean.setAttribute("alt", (node.getAttribute("alt") || "Image").slice(0, 300));
      if (node.hasAttribute("title")) clean.setAttribute("title", node.getAttribute("title")!.slice(0, 300));
    }
    if (tag === "figure") {
      const width = Number(node.getAttribute("data-width")), align = node.getAttribute("data-align");
      clean.setAttribute("style", `width:${Number.isFinite(width) && width > 0 ? Math.max(20, Math.min(100, width)) : 100}%;margin-left:${align === "left" ? "0" : "auto"};margin-right:${align === "right" ? "0" : "auto"}`);
    }
    if (tag === "a") {
      const candidate = node.getAttribute("data-item-id"), id = validItemId(candidate) ? candidate : itemIdFromHref(node.getAttribute("href"));
      if (id) { clean.setAttribute("data-item-id", id); if (anchors.has(id)) clean.setAttribute("href", `#${anchors.get(id)}`); }
      else if (safeExternalHref(node.getAttribute("href"))) { clean.setAttribute("href", node.getAttribute("href")!); clean.setAttribute("rel", "noreferrer noopener"); }
    }
    if (tag === "ol") { const start = Number(node.getAttribute("start")); if (Number.isSafeInteger(start) && start > 0 && start <= 1_000_000) clean.setAttribute("start", String(start)); }
    if (tag === "ul" && node.getAttribute("data-type") === "taskList") clean.className = "tasks";
    if (tag === "li" && node.getAttribute("data-type") === "taskItem") {
      clean.setAttribute("data-task", node.getAttribute("data-checked") === "true" ? "true" : "false");
      const box = document.createElement("span"); box.className = "task-box"; box.setAttribute("aria-hidden", "true"); box.textContent = clean.getAttribute("data-task") === "true" ? "☑" : "☐"; clean.appendChild(box);
    }
    if (tag === "code") { const language = node.className.match(/(?:^|\s)language-([\w+-]{1,50})(?:\s|$)/)?.[1]; if (language) clean.setAttribute("data-language", language); }
    for (const child of node.childNodes) await sanitize(child, clean, depth + 1);
    if (tag === "a" && clean.hasAttribute("data-item-id")) {
      const reference = document.createElement("span"); reference.className = "item-id"; reference.textContent = ` (Item ID: ${clean.getAttribute("data-item-id")})`; clean.appendChild(reference);
    }
  }
  function markdown(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.textContent || "");
    if (!(node instanceof Element)) return Array.from(node.childNodes, markdown).join("");
    const tag = node.tagName.toLowerCase();
    if (node.classList.contains("task-box") || node.classList.contains("item-id")) return "";
    if (tag === "pre") {
      const text = node.textContent || "", fence = codeFence(text, 3);
      return `\n\n${fence}${node.querySelector("code")?.getAttribute("data-language") || ""}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}\n\n`;
    }
    if (tag === "code") { const text = node.textContent || "", fence = codeFence(text, 1); const padding = /^[ `]|[ `]$/.test(text) ? " " : ""; return `${fence}${padding}${text}${padding}${fence}`; }
    if (tag === "ul" || tag === "ol") {
      const start = Number(node.getAttribute("start")) || 1;
      return "\n\n" + Array.from(node.children).filter(child => child.tagName === "LI").map((li, index) => {
        const marker = tag === "ol" ? `${start + index}. ` : "- "; const task = li.hasAttribute("data-task") ? `[${li.getAttribute("data-task") === "true" ? "x" : " "}] ` : "";
        const content = Array.from(li.childNodes, markdown).join("").trim();
        return marker + task + content.replace(/\n/g, `\n${" ".repeat(marker.length)}`);
      }).join("\n") + "\n\n";
    }
    if (tag === "img") return `![${escapeMarkdown(node.getAttribute("alt") || "Image")}](${node.getAttribute("data-export-asset")})`;
    const content = Array.from(node.childNodes, markdown).join("");
    if (tag === "a") {
      const id = node.getAttribute("data-item-id");
      if (id) return `${names.has(id) ? `[${content}](${encodeURIComponent(names.get(id)!)})` : content} (Item ID: ${escapeMarkdown(id)})`;
      const href = node.getAttribute("href"); return href ? `[${content}](<${href.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\\/g, "%5C")}>)` : content;
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${content}\n\n`;
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "s" || tag === "del") return `~~${content}~~`;
    if (tag === "blockquote") return `\n\n${content.trim().replace(/^/gm, "> ")}\n\n`;
    if (tag === "br") return "  \n";
    if (tag === "hr") return "\n\n---\n\n";
    if (["p", "figure", "figcaption"].includes(tag)) return `\n\n${content}\n\n`;
    return content;
  }
  const articles: string[] = [];
  for (let i = 0; i < snapshot.length; i++) {
    await yieldWork(signal);
    const note = snapshot[i], template = document.createElement("template"), body = document.createElement("div");
    template.innerHTML = note.content;
    for (const child of template.content.childNodes) await sanitize(child, body);
    const md = `# ${escapeMarkdown(note.title)}\n\nItem ID: ${escapeMarkdown(note.id)}\n\n${markdown(body).trim()}\n`;
    const mdBytes = strToU8(md); addSize(mdBytes.length); entries[noteNames[i]] = mdBytes;
    // Internal converter metadata is useful for Markdown only.
    for (const image of body.querySelectorAll("[data-export-asset]")) image.removeAttribute("data-export-asset");
    for (const code of body.querySelectorAll("[data-language]")) code.removeAttribute("data-language");
    const article = `<article id="note-${i + 1}"><h1>${escapeHtml(note.title)}</h1><p class="item-id">Item ID: ${escapeHtml(note.id)}</p>${body.innerHTML}</article>`;
    addSize(article.length * 2); articles.push(article);
  }
  const warningList = [...warnings];
  const disclosure = warningList.length ? `<aside class="export-warning"><strong>Export notes</strong><ul>${warningList.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></aside>` : "";
  const title = snapshot.length === 1 ? snapshot[0].title : `Scribly — ${snapshot.length} notes`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${stylesheet}</style></head><body><main>${articles.join("")}${disclosure}</main></body></html>`;
  entries["README.txt"] = strToU8(`Scribly Markdown export\n${snapshot.length} notes. Images are stored in assets/; keep that directory beside the Markdown files.\nInternal links include original item IDs.\n${warningList.join("\n")}\n`);
  check(signal);
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    let terminate: (() => void) | undefined;
    const abort = () => { terminate?.(); reject(new DOMException("Export cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    terminate = zip(entries, { level: 0 }, (error, data) => { signal?.removeEventListener("abort", abort); if (error) reject(error); else resolve(data); });
    if (signal?.aborted) abort();
  });
  check(signal);
  const stem = snapshot.length === 1 ? fileStem(snapshot[0].title) : "Scribly notes";
  return { html, markdown: new Blob([archive as BlobPart], { type: "application/zip" }), htmlName: `${stem}.html`, markdownName: `${stem} Markdown.zip`, warnings: warningList, noteCount: snapshot.length };
}

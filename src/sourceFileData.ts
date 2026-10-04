export const SOURCE_PAGE_BYTES = 64 * 1024;
export const SOURCE_IMPORT_THRESHOLD = 256 * 1024;
export type SourceFile = { id: string; name: string; size: number; encoding: "utf-8" | "utf-16le" | "utf-16be" };
export function validSource(value: unknown): value is SourceFile {
  const source = value as SourceFile | null;
  return !!source && /^[a-f0-9-]{36}$/.test(source.id) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.id)
    && typeof source.name === "string" && source.name.length > 0 && source.name.length <= 300 && !/[\\/\x00-\x1f]/.test(source.name)
    && Number.isSafeInteger(source.size) && source.size >= 0 && ["utf-8", "utf-16le", "utf-16be"].includes(source.encoding);
}
export function sourceFromElement(element: Element): SourceFile | null {
  if (!element.hasAttribute("data-source-size")) return null;
  const source = { id: element.getAttribute("data-source-id") || "", name: element.getAttribute("data-source-name") || "",
    size: Number(element.getAttribute("data-source-size")), encoding: element.getAttribute("data-source-encoding") };
  return validSource(source) ? source : null;
}
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function sourceHtml(source: SourceFile) {
  if (!validSource(source)) throw Error("Invalid source file.");
  return `<div data-notify-source="" data-source-id="${source.id}" data-source-name="${escape(source.name)}" data-source-size="${source.size}" data-source-encoding="${source.encoding}"></div><p></p>`;
}
export function sourceFilesInHtml(html: string): SourceFile[] {
  if (!html.includes("data-notify-source")) return [];
  const template = document.createElement("template"); template.innerHTML = html;
  return Array.from(template.content.querySelectorAll("div[data-notify-source]"), element => {
    const source = sourceFromElement(element);
    if (!source) throw Error("A source file reference is invalid. Preserve a backup before editing this note.");
    return source;
  });
}
export function formatFileSize(size: number) {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MiB` : `${(size / 1024).toFixed(1)} KiB`;
}

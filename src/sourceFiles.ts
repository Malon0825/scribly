import { invoke, isTauri } from "@tauri-apps/api/core";
import { browserDatabase, requestValue, transactionDone } from "./browserData";
import { SOURCE_PAGE_BYTES, validSource, type SourceFile } from "./sourceFileData";

const UPLOAD_BYTES = 1024 * 1024;
export async function storeSource(blob: Blob, name: string, encoding: SourceFile["encoding"]): Promise<SourceFile> {
  const source: SourceFile = { id: crypto.randomUUID(), name: name.slice(0, 300), size: blob.size, encoding };
  if (!validSource(source)) throw Error("Invalid source file.");
  if (!isTauri()) {
    const db = await browserDatabase(), transaction = db.transaction("sources", "readwrite"), done = transactionDone(transaction);
    transaction.objectStore("sources").put(blob, source.id);
    await done;
    return source;
  }
  await invoke("begin_source", { id: source.id });
  try {
    for (let offset = 0; offset < blob.size; offset += UPLOAD_BYTES) {
      await invoke("append_source_chunk", await blob.slice(offset, offset + UPLOAD_BYTES).arrayBuffer(), {
        headers: { "X-Scribly-Source-Id": source.id, "X-Scribly-Source-Offset": String(offset) },
      });
    }
    await invoke("finish_source", { id: source.id, size: source.size });
    return source;
  } catch (error) {
    await invoke("abort_source", { id: source.id }).catch(() => {});
    throw error;
  }
}
async function browserBlob(source: SourceFile) {
  const db = await browserDatabase();
  const blob = await requestValue<Blob | undefined>(db.transaction("sources").objectStore("sources").get(source.id));
  if (!(blob instanceof Blob) || blob.size !== source.size) throw Error("This source file is missing. Restore it from a Scribly file backup.");
  return blob;
}
export async function sourceBytes(source: SourceFile, offset: number, length: number) {
  if (!validSource(source) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > UPLOAD_BYTES)
    throw Error("Invalid source file section.");
  if (isTauri()) {
    const result = await invoke<ArrayBuffer>("read_source_chunk", { id: source.id, offset, length, size: source.size });
    return new Uint8Array(result);
  }
  return new Uint8Array(await (await browserBlob(source)).slice(offset, offset + length).arrayBuffer());
}
export async function sourcePage(source: SourceFile, page: number) {
  const start = page * SOURCE_PAGE_BYTES, end = Math.min(source.size, start + SOURCE_PAGE_BYTES);
  // Look around boundaries so adjacent sections never lose or duplicate a
  // multi-byte UTF-8 character or a UTF-16 surrogate pair.
  const offset = Math.max(0, start - 4);
  const bytes = await sourceBytes(source, offset, end - offset + 4);
  let from = start - offset, to = end - offset;
  if (source.encoding === "utf-8") {
    while (from < bytes.length && (bytes[from] & 0xc0) === 0x80) from++;
    while (to < bytes.length && (bytes[to] & 0xc0) === 0x80) to++;
  } else {
    const word = (position: number) => source.encoding === "utf-16le" ? bytes[position] | bytes[position + 1] << 8 : bytes[position] << 8 | bytes[position + 1];
    if (from < bytes.length && word(from) >= 0xdc00 && word(from) <= 0xdfff) from += 2;
    if (to < bytes.length && word(to) >= 0xdc00 && word(to) <= 0xdfff) to += 2;
  }
  return new TextDecoder(source.encoding, { fatal: true, ignoreBOM: start !== 0 }).decode(bytes.subarray(from, to));
}
export async function sourceBlob(source: SourceFile): Promise<Blob> {
  if (!isTauri()) return browserBlob(source);
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < source.size; offset += UPLOAD_BYTES) {
    const bytes = await sourceBytes(source, offset, UPLOAD_BYTES);
    parts.push(new Blob([bytes]));
  }
  return new Blob(parts, { type: "application/octet-stream" });
}
export async function downloadSource(source: SourceFile) {
  if (isTauri()) return !!await invoke("export_source", { id: source.id, fileName: source.name });
  const url = URL.createObjectURL(await browserBlob(source));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = source.name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function exportLargeBlob(blob: Blob, fileName: string) {
  const source = await storeSource(blob, fileName, "utf-8");
  try { return !!await invoke("export_source", { id: source.id, fileName }); }
  finally { await invoke("remove_source", { id: source.id }).catch(() => {}); }
}

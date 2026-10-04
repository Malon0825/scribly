import { Zip, ZipPassThrough, Unzip, strToU8, strFromU8 } from "fflate";
import type { Workspace } from "./types";
import { compactImages, portableBackup } from "./attachments";
import { parseBackup } from "./importBackup";
import { sourceFilesInHtml, sourceFromElement, type SourceFile } from "./sourceFileData";
import { sourceBytes, storeSource } from "./sourceFiles";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function checksum(crc: number, bytes: Uint8Array) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}

// Stored ZIP entries keep backup work bounded by input chunks. The workspace
// manifest comes first; original bytes follow, without base64 expansion.
export async function fileBackup(workspace: Workspace): Promise<Blob> {
  const sources = new Map<string, SourceFile>();
  for (const note of workspace.notes) for (const source of sourceFilesInHtml(note.content)) sources.set(source.id, source);
  const parts: Blob[] = [];
  let archiveSize = 0;
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else if (data.length) { archiveSize += data.length; parts.push(new Blob([data])); }
  });
  const manifestBytes = strToU8(await portableBackup(workspace));
  const manifest = new ZipPassThrough("workspace.json");
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifestBytes.length, true);
  manifest.extra = { 21315: length }; zip.add(manifest);
  manifest.push(manifestBytes, true);
  for (const source of sources.values()) {
    if (source.size >= 0xffffffff) throw Error("This original exceeds the file backup format's 4 GiB entry size. Download its original separately; it remains saved in the notebook.");
    const entry = new ZipPassThrough(`sources/${source.id}`); zip.add(entry);
    for (let offset = 0; offset < source.size; offset += 1024 * 1024) {
      const bytes = await sourceBytes(source, offset, Math.min(1024 * 1024, source.size - offset));
      entry.push(bytes, offset + bytes.length === source.size);
      if (failure) throw failure;
      if (archiveSize >= 0xffffffff) throw Error("This file backup exceeds the ZIP format's 4 GiB size. Export originals separately or use smaller notebooks for portable backups.");
    }
    if (source.size === 0) entry.push(new Uint8Array(), true);
  }
  zip.end();
  if (failure) throw failure;
  if (archiveSize >= 0xffffffff) throw Error("This file backup exceeds the ZIP format's 4 GiB size. Download originals separately.");
  return new Blob(parts, { type: "application/zip" });
}

export async function importFileBackup(file: Blob) {
  let backup: Pick<Workspace, "notes" | "folders"> | null = null;
  let manifestSeen = false, failure: Error | null = null;
  let pending: Promise<void>[] = [];
  const expected = new Map<string, SourceFile>(), restored = new Map<string, SourceFile>(), seen = new Set<string>();
  const checksums = new Map<string, number>();
  const unzip = new Unzip(entry => {
    if (seen.has(entry.name) || (entry.name !== "workspace.json" && !expected.has(entry.name))) {
      failure = Error("Invalid Scribly backup entry or missing manifest."); return;
    }
    seen.add(entry.name);
    if (entry.compression !== 0) { failure = Error("Unsupported Scribly backup compression."); return; }
    const chunks: Blob[] = [];
    let size = 0, crc = 0xffffffff;
    entry.ondata = (error, bytes, final) => {
      if (error) { failure = error; return; }
      size += bytes.length;
      crc = checksum(crc, bytes);
      const source = expected.get(entry.name);
      if (source && size > source.size) { failure = Error("Backup source size does not match."); return; }
      if (bytes.length) chunks.push(new Blob([bytes]));
      if (!final) return;
      checksums.set(entry.name, (crc ^ 0xffffffff) >>> 0);
      if (entry.name === "workspace.json") {
        // Async parsing completes before the next input section is fed.
        pending.push((async () => {
          const value = JSON.parse(strFromU8(new Uint8Array(await new Blob(chunks).arrayBuffer())));
          backup = parseBackup(value, true); manifestSeen = true;
          for (const note of backup.notes) for (const reference of sourceFilesInHtml(note.content)) {
            const name = `sources/${reference.id}`, previous = expected.get(name);
            if (previous && (previous.size !== reference.size || previous.encoding !== reference.encoding)) throw Error("Conflicting source references in backup.");
            expected.set(name, reference);
          }
        })());
      } else {
        if (!source || size !== source.size) { failure = Error("Backup source is incomplete."); return; }
        pending.push(storeSource(new Blob(chunks), source.name, source.encoding).then(value => { restored.set(source.id, value); }));
      }
    };
    entry.start();
  });
  // A small ZIP extra field records the manifest length. Feed it separately
  // so source headers cannot race async manifest parsing in the same chunk.
  const header = new DataView(await file.slice(0, 30).arrayBuffer());
  if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== 0)
    throw Error("This is not a Scribly file backup.");
  const extraStart = 30 + header.getUint16(26, true), extraLength = header.getUint16(28, true);
  const extra = new DataView(await file.slice(extraStart, extraStart + extraLength).arrayBuffer());
  let manifestBytes = 0;
  for (let offset = 0; offset + 4 <= extra.byteLength;) {
    const length = extra.getUint16(offset + 2, true);
    if (offset + 4 + length > extra.byteLength) throw Error("Invalid backup header.");
    if (extra.getUint16(offset, true) === 21315 && length === 4) manifestBytes = extra.getUint32(offset + 4, true);
    offset += 4 + length;
  }
  const firstEnd = extraStart + extraLength + manifestBytes + 16;
  if (!manifestBytes || firstEnd > file.size) throw Error("Invalid Scribly backup manifest.");
  unzip.push(new Uint8Array(await file.slice(0, firstEnd).arrayBuffer()));
  await Promise.all(pending); pending = [];
  if (failure) throw failure;
  if (!manifestSeen) throw Error("The Scribly backup manifest is missing.");
  for (let offset = firstEnd; offset < file.size; offset += 1024 * 1024) {
    unzip.push(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()), offset + 1024 * 1024 >= file.size);
    await Promise.all(pending); pending = [];
    if (failure) throw failure;
  }
  // Unzip's streaming reader does not validate CRC itself. Check the central
  // directory before adopting any restored notes, including same-size damage.
  const tailStart = Math.max(0, file.size - 65557), tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let footer = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) if (tail.getUint32(offset, true) === 0x06054b50) { footer = offset; break; }
  if (footer < 0 || tailStart + footer + 22 + tail.getUint16(footer + 20, true) !== file.size) throw Error("The backup is incomplete.");
  const directoryOffset = tail.getUint32(footer + 16, true), directorySize = tail.getUint32(footer + 12, true);
  if (directoryOffset + directorySize !== tailStart + footer) throw Error("Invalid backup directory.");
  const directoryBytes = new Uint8Array(await file.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer()), directory = new DataView(directoryBytes.buffer);
  const verified = new Set<string>();
  for (let offset = 0; offset < directorySize;) {
    if (offset + 46 > directorySize || directory.getUint32(offset, true) !== 0x02014b50) throw Error("Invalid backup directory entry.");
    const nameLength = directory.getUint16(offset + 28, true), extra = directory.getUint16(offset + 30, true), comment = directory.getUint16(offset + 32, true);
    const name = strFromU8(directoryBytes.subarray(offset + 46, offset + 46 + nameLength));
    if (verified.has(name) || !checksums.has(name) || checksums.get(name) !== directory.getUint32(offset + 16, true)) throw Error("Backup checksum failed. Your current notebook was retained.");
    verified.add(name);
    offset += 46 + nameLength + extra + comment;
  }
  if (verified.size !== seen.size || verified.size !== tail.getUint16(footer + 10, true)) throw Error("The backup directory is incomplete.");
  const result = backup as Pick<Workspace, "notes" | "folders"> | null;
  if (!result || restored.size !== expected.size) throw Error("The Scribly backup is incomplete; some original files are missing.");
  const notes = result.notes.map(note => {
    if (!note.content.includes("data-notify-source")) return note;
    const template = document.createElement("template"); template.innerHTML = note.content;
    for (const element of template.content.querySelectorAll("div[data-notify-source]")) {
      const source = sourceFromElement(element)!;
      element.setAttribute("data-source-id", restored.get(source.id)!.id);
    }
    return { ...note, content: template.innerHTML };
  });
  return compactImages({ ...result, notes });
}

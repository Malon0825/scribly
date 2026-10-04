import { isBoard, type Note, type Workspace } from "./types";
import { validateBoard } from "./boardData";
import { validateWorkspace } from "./workspaceValidation";

export const RECOVERY_KEY = "still-notes-recovery-v2";
export const LEGACY_RECOVERY_KEY = "still-notes-recovery-v1";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Manifest = {
  format: 2; revision: number; dirty: boolean;
  metadata: Omit<Workspace, "notes">;
  notes: { id: string; key: string }[];
};
const recordPrefix = `${RECOVERY_KEY}:note:`;
const filePrefix = `${RECOVERY_KEY}:file:`;
type BoardRecord = { format: "board-files-1"; note: Note; files: Record<string, string> };

// Immutable note records + an atomic manifest commit retain a complete recovery
// snapshot. An interrupted write cannot mix old ordering with new note content.
export class RecoveryJournal {
  private records = new WeakMap<Note, string>();
  private keys = new Set<string>();
  private pinned = new Set<string>();
  private files = new Map<string, string>();
  private dependencies = new Map<string, string[]>();
  private preservationFailed = false;
  constructor(private storage: Store) {
    const conflicts: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)!;
      if (key.startsWith(recordPrefix) || key.startsWith(filePrefix)) this.keys.add(key);
      if (key.startsWith(`${RECOVERY_KEY}-conflict-`)) conflicts.push(key);
    }
    for (const key of conflicts) {
        try { for (const entry of this.parse(storage.getItem(key)!).notes) this.pin(entry.key); }
        catch { /* Preserve damaged conflict records too. */ for (const record of this.keys) this.pinned.add(record); }
    }
  }
  private pin(key: string) {
    this.pinned.add(key);
    const raw = this.storage.getItem(key);
    if (!raw) throw Error("A recovery note is missing");
    const record = JSON.parse(raw);
    if (record.format === "board-files-1") {
      for (const file of Object.values(record.files || {})) {
        if (typeof file !== "string" || !file.startsWith(filePrefix)) throw Error("Invalid recovery image reference");
        this.pinned.add(file);
      }
    }
  }
  private readNote(key: string): Note {
    const raw = this.storage.getItem(key);
    if (!raw) throw Error("A recovery note is missing");
    const record = JSON.parse(raw);
    if (record.format !== "board-files-1") return record as Note; // Existing inline records remain readable.
    const { note, files } = record as BoardRecord;
    if (!isBoard(note) || !files || typeof files !== "object" || Array.isArray(files)
      || Object.keys(files).length !== Object.keys(note.board.files).length) throw Error("Invalid recovery board files");
    for (const [id, file] of Object.entries(note.board.files)) {
      const reference = files[id];
      if (typeof reference !== "string" || !reference.startsWith(filePrefix)) throw Error("Invalid recovery image reference");
      const payload = this.storage.getItem(reference);
      if (!payload) throw Error("A recovery image is missing");
      const dataURL = JSON.parse(payload);
      if (typeof dataURL !== "string") throw Error("Invalid recovery image");
      file.dataURL = dataURL as typeof file.dataURL;
      this.files.set(dataURL, reference);
    }
    this.dependencies.set(key, Object.values(files));
    return note;
  }
  private parse(raw: string): Manifest {
    const value = JSON.parse(raw) as Manifest;
    if (!value || value.format !== 2 || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.dirty !== "boolean"
      || !value.metadata || !Array.isArray(value.metadata.folders) || !Array.isArray(value.notes)
      || !value.metadata.folders.every((f) => f && typeof f.id === "string" && typeof f.name === "string")
      || !value.notes.every((n) => n && typeof n.id === "string" && typeof n.key === "string" && n.key.startsWith(recordPrefix))
      || new Set(value.notes.map((n) => n.id)).size !== value.notes.length) throw Error("Invalid recovery manifest");
    return value;
  }
  restore(base: Workspace | null, revision: number): { document: Workspace | null; warning: string } {
    const raw = this.storage.getItem(RECOVERY_KEY);
    if (!raw) return { document: base, warning: "" };
    try { return this.restoreManifest(raw, base, revision); }
    catch (error) {
      // Never let subsequent writes reclaim records from a damaged draft.
      for (const key of this.keys) this.pinned.add(key);
      try { this.storage.setItem(`${RECOVERY_KEY}-conflict-${crypto.randomUUID()}`, raw); }
      catch { this.preservationFailed = true; }
      throw error;
    }
  }
  private restoreManifest(raw: string, base: Workspace | null, revision: number) {
    const manifest = this.parse(raw);
    if (!manifest.dirty) {
      // A clean checkpoint is only a serialization cache. PostgreSQL remains
      // authoritative, and changed revisions never reuse its cached records.
      if (base && manifest.revision === revision) {
        const entries = new Map(manifest.notes.map((n) => [n.id, n.key]));
        for (const note of base.notes) {
          const key = entries.get(note.id);
          // Validate once on startup; legacy drafts and damaged cache records
          // must not be mistaken for the authoritative database note.
          if (key) {
            try {
              if (JSON.stringify(this.readNote(key)) === JSON.stringify(note)) {
                this.records.set(note, key);
                // Keep the database's existing immutable strings as cache keys,
                // rather than retaining another parsed copy of each image.
                if (isBoard(note)) for (const file of Object.values(note.board.files)) {
                  const reference = this.files.get(file.dataURL);
                  if (reference) { this.files.delete(file.dataURL); this.files.set(file.dataURL, reference); }
                }
              }
            }
            catch { /* A damaged clean cache never replaces the database. */ }
          }
        }
      }
      return { document: base, warning: "" };
    }
    if (manifest.revision !== revision) {
      this.storage.setItem(`${RECOVERY_KEY}-conflict-${crypto.randomUUID()}`, raw);
      for (const note of manifest.notes) this.pin(note.key);
      return { document: base, warning: "A previous draft is kept in recovery storage. The latest database copy is open." };
    }
    const notes = manifest.notes.map(({ id, key }) => {
      const note = this.readNote(key);
      if (note.id !== id || ![note.title, note.content, note.createdAt, note.updatedAt].every((v) => typeof v === "string")
        || typeof note.archived !== "boolean"
        || (note.folderId !== null && !manifest.metadata.folders.some((f) => f.id === note.folderId))) throw Error("Invalid recovery note");
      if (note.kind !== undefined && note.kind !== "note" && note.kind !== "board") throw Error("Unsupported recovery item");
      if (isBoard(note)) validateBoard(note.board);
      this.records.set(note, key);
      return note;
    });
    const document = { ...manifest.metadata, notes };
    validateWorkspace(document);
    return { document, warning: "" };
  }
  write(workspace: Workspace, revision: number, dirty: boolean) {
    if (this.preservationFailed) throw Error("Recovery storage cannot preserve an existing draft");
    try { this.commit(workspace, revision, dirty); }
    catch (error) {
      if (dirty) throw error;
      // The caller has a database acknowledgement for this exact snapshot.
      // Replace only the current cache with a tiny clean manifest before
      // retrying, so migrating old inline records does not require two copies
      // of a large image to fit simultaneously. Conflicts remain pinned.
      const { notes: _notes, ...metadata } = workspace;
      this.storage.setItem(RECOVERY_KEY, JSON.stringify({ format: 2, revision, dirty: false, metadata, notes: [] }));
      this.reclaim(new Set(this.pinned));
      this.commit(workspace, revision, false);
    }
  }
  private commit(workspace: Workspace, revision: number, dirty: boolean) {
    const { notes, ...metadata } = workspace;
    const entries = notes.map((note) => {
      let key = this.records.get(note);
      // Undo can bring back a previously reclaimed note object.
      if (key && !this.keys.has(key)) key = undefined;
      if (!key) {
        let record: Note | BoardRecord = note;
        const references: Record<string, string> = {};
        if (isBoard(note) && Object.keys(note.board.files).length) {
          const files = Object.fromEntries(Object.entries(note.board.files).map(([id, file]) => {
            let reference = this.files.get(file.dataURL);
            if (reference && !this.keys.has(reference)) reference = undefined;
            if (!reference) {
              reference = `${filePrefix}${crypto.randomUUID()}`;
              this.storage.setItem(reference, JSON.stringify(file.dataURL));
              this.keys.add(reference); this.files.set(file.dataURL, reference);
            }
            references[id] = reference;
            return [id, { ...file, dataURL: "" as typeof file.dataURL }];
          }));
          record = { format: "board-files-1", note: { ...note, board: { ...note.board, files } }, files: references };
        }
        key = `${recordPrefix}${crypto.randomUUID()}`;
        // Remember successful writes even if a later manifest write fails.
        this.storage.setItem(key, JSON.stringify(record));
        this.keys.add(key);
        this.records.set(note, key);
        this.dependencies.set(key, Object.values(references));
      }
      return { id: note.id, key };
    });
    const manifest: Manifest = { format: 2, revision, dirty, metadata, notes: entries };
    this.storage.setItem(RECOVERY_KEY, JSON.stringify(manifest));
    // Reclaim only after the new manifest commits. Conflict snapshots are pinned.
    const live = new Set([...entries.map((n) => n.key), ...this.pinned]);
    for (const entry of entries) for (const file of this.dependencies.get(entry.key) || []) live.add(file);
    this.reclaim(live);
  }
  private reclaim(live: Set<string>) {
    for (const key of this.keys) {
      if (!live.has(key)) { this.storage.removeItem(key); this.keys.delete(key); this.dependencies.delete(key); }
    }
    for (const [dataURL, key] of this.files) if (!this.keys.has(key)) this.files.delete(dataURL);
  }
}

import { test, expect } from "@playwright/test";
import { RecoveryJournal, RECOVERY_KEY } from "../src/recovery";
import type { Workspace } from "../src/types";
import { emptyBoard } from "../src/boardData";

class MemoryStore {
  data = new Map<string, string>();
  writes: { key: string; bytes: number }[] = [];
  fail: (key: string) => boolean = () => false;
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.fail(key)) throw Error("Quota exceeded / interrupted write");
    this.data.set(key, value); this.writes.push({ key, bytes: Buffer.byteLength(value) });
  }
  removeItem(key: string) { this.data.delete(key); }
}
function notebook(count = 3, contentLength = 100): Workspace {
  return { folders: [{ id: "work", name: "Work" }], theme: "dark", activeId: "0", referenceId: "1",
    notes: Array.from({ length: count }, (_, i) => ({ id: String(i), folderId: "work", title: `Note ${i}`,
      content: `<p>${"x".repeat(contentLength)}</p>`, archived: false, createdAt: "2026-10-02", updatedAt: "2026-10-02" })) };
}
const edit = (w: Workspace, content: string) => ({ ...w, notes: w.notes.map((n, i) => i ? n : { ...n, content }) });
function imageBoard(): Workspace {
  const workspace = notebook(1);
  const dataURL = `data:image/png;base64,${Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=', 'base64'), Buffer.alloc(750_000)]).toString('base64')}`;
  workspace.notes[0] = { ...workspace.notes[0], kind: "board", board: { ...emptyBoard(), files: { pixel: { id: "pixel", mimeType: "image/png", created: 1, dataURL } } as never } };
  return workspace;
}
const resizeBoard = (w: Workspace, size: number): Workspace => ({ ...w, notes: [{ ...w.notes[0], board: { ...w.notes[0].board!, appState: { gridSize: size } } }] });

test("board resize recovery reuses image bytes and reconstructs portable files", () => {
  const store = new MemoryStore(), original = imageBoard(), journal = new RecoveryJournal(store);
  journal.write(original, 4, true); store.writes = [];
  for (let size = 1; size <= 20; size++) journal.write(resizeBoard(original, size), 4, true);
  expect(store.writes.some(w => w.key.includes(':file:'))).toBe(false);
  expect(store.writes.reduce((sum, w) => sum + w.bytes, 0)).toBeLessThan(30_000);
  expect(new RecoveryJournal(store).restore(null, 4).document).toEqual(resizeBoard(original, 20));
  expect([...store.data.keys()].filter(k => k.includes(':file:'))).toHaveLength(1);
});

test("board images survive failed manifest commits, stale conflicts and reopen", () => {
  const store = new MemoryStore(), original = imageBoard(), journal = new RecoveryJournal(store);
  journal.write(original, 4, true);
  store.fail = key => key === RECOVERY_KEY;
  expect(() => journal.write(resizeBoard(original, 10), 4, true)).toThrow();
  expect(new RecoveryJournal(store).restore(null, 4).document).toEqual(original);
  store.fail = () => false;
  const imageKeys = [...store.data.keys()].filter(k => k.includes(':file:'));
  const reopened = new RecoveryJournal(store);
  expect(reopened.restore(notebook(), 5).warning).toContain('previous draft');
  reopened.write(notebook(), 5, false);
  new RecoveryJournal(store).write(edit(notebook(), '<p>New edit</p>'), 5, true);
  for (const key of imageKeys) expect(store.getItem(key)).not.toBeNull();
  const conflict = [...store.data.entries()].find(([key]) => key.includes('-conflict-'))!;
  store.setItem(RECOVERY_KEY, conflict[1]);
  expect(new RecoveryJournal(store).restore(null, 4).document).toEqual(original);
});

test("missing board recovery image preserves draft artifacts", () => {
  const store = new MemoryStore(), original = imageBoard(); new RecoveryJournal(store).write(original, 4, true);
  const raw = store.getItem(RECOVERY_KEY)!;
  store.removeItem([...store.data.keys()].find(k => k.includes(':file:'))!);
  const reopened = new RecoveryJournal(store);
  expect(() => reopened.restore(null, 4)).toThrow('image is missing');
  reopened.write(notebook(), 4, true);
  expect([...store.data.values()]).toContain(raw);
});

test("legacy inline board cache migrates within one-image quota only after acknowledgement", () => {
  class QuotaStore extends MemoryStore {
    setItem(key: string, value: string) {
      const total = [...this.data.entries()].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), value.length);
      if (total > 1_200_000) throw Error('Quota exceeded');
      super.setItem(key, value);
    }
  }
  const store = new QuotaStore(), original = imageBoard();
  const key = `${RECOVERY_KEY}:note:legacy`, { notes, ...metadata } = original;
  store.setItem(key, JSON.stringify(notes[0]));
  store.setItem(RECOVERY_KEY, JSON.stringify({ format: 2, revision: 4, dirty: true, metadata, notes: [{ id: notes[0].id, key }] }));
  const journal = new RecoveryJournal(store), resized = resizeBoard(original, 10);
  expect(() => journal.write(resized, 4, true)).toThrow('Quota');
  expect(new RecoveryJournal(store).restore(null, 4).document).toEqual(original);
  journal.write(resized, 5, false);
  expect(new RecoveryJournal(store).restore(resized, 5).document).toBe(resized);
  journal.write(resizeBoard(resized, 20), 5, true);
  expect(new RecoveryJournal(store).restore(null, 5).document).toEqual(resizeBoard(resized, 20));
});

test("rewrites only the changed note; navigation writes only the manifest", () => {
  const store = new MemoryStore(), journal = new RecoveryJournal(store), original = notebook();
  journal.write(original, 4, true); store.writes = [];
  journal.write(edit(original, "<p>Hello 日本語 ✓</p>"), 4, true);
  expect(store.writes).toHaveLength(2);
  store.writes = [];
  journal.write({ ...original, activeId: "1" }, 4, true);
  // Bringing the previous object back requires recreating its reclaimed record.
  expect(store.writes).toHaveLength(2);
  store.writes = [];
  journal.write({ ...original, activeId: "2" }, 4, true);
  expect(store.writes.map((w) => w.key)).toEqual([RECOVERY_KEY]);
  expect(new RecoveryJournal(store).restore(null, 4).document?.activeId).toBe("2");
});

test("a failed manifest commit leaves the entire previous draft recoverable", () => {
  const store = new MemoryStore(), journal = new RecoveryJournal(store), original = notebook();
  journal.write(original, 4, true);
  const before = store.getItem(RECOVERY_KEY);
  store.fail = (key) => key === RECOVERY_KEY;
  expect(() => journal.write(edit(original, "<p>New text</p>"), 4, true)).toThrow();
  expect(store.getItem(RECOVERY_KEY)).toBe(before);
  expect(new RecoveryJournal(store).restore(null, 4).document).toEqual(original);
  store.fail = () => false;
  const next = edit(original, "<p>Retry</p>"); journal.write(next, 4, true);
  expect(new RecoveryJournal(store).restore(null, 4).document).toEqual(next);
  expect(store.length).toBe(original.notes.length + 1);
});

test("failure writing an image note retains its previous snapshot", () => {
  const store = new MemoryStore(), original = notebook(), journal = new RecoveryJournal(store);
  journal.write(original, 0, true);
  store.fail = (key) => key !== RECOVERY_KEY;
  expect(() => journal.write(edit(original, '<p>Image</p><img src="data:image/png;base64,AAAA">'), 0, true)).toThrow();
  expect(new RecoveryJournal(store).restore(null, 0).document).toEqual(original);
});

test("rebasing an acknowledged save retains edits made while saving", () => {
  const store = new MemoryStore(), journal = new RecoveryJournal(store), a = notebook();
  const b = edit(a, '<pre><code class="language-rust">fn main() {}</code></pre>');
  journal.write(a, 3, true); journal.write(b, 3, true);
  // Database acknowledged A, but B remains the live draft.
  journal.write(b, 4, true);
  expect(new RecoveryJournal(store).restore(a, 4).document).toEqual(b);
  journal.write(b, 5, false);
  expect(new RecoveryJournal(store).restore(b, 5).document).toBe(b);
});

test("archive/restore/delete/reorder/folder changes survive recovery together", () => {
  const store = new MemoryStore(), journal = new RecoveryJournal(store), a = notebook();
  const b = { ...a, folders: [{ id: "other", name: "Other" }], activeId: "2", referenceId: null,
    notes: [ { ...a.notes[2], folderId: null }, { ...a.notes[0], folderId: "other", archived: true } ] };
  journal.write(a, 7, true); journal.write(b, 7, true);
  expect(new RecoveryJournal(store).restore(null, 7).document).toEqual(b);
  const restored = { ...b, notes: b.notes.map((n) => ({ ...n, archived: false })) };
  journal.write(restored, 7, true);
  expect(new RecoveryJournal(store).restore(null, 7).document).toEqual(restored);
});

test("stale revisions preserve all conflict records through later writes and reloads", () => {
  const store = new MemoryStore(), a = notebook(); new RecoveryJournal(store).write(a, 3, true);
  const raw = store.getItem(RECOVERY_KEY)!;
  const entries = JSON.parse(raw).notes;
  const journal = new RecoveryJournal(store), latest = edit(a, "<p>Database is newer</p>");
  expect(journal.restore(latest, 4).document).toBe(latest);
  journal.write(latest, 4, false);
  new RecoveryJournal(store).write(edit(latest, "<p>Another edit</p>"), 4, true);
  for (const entry of entries) expect(store.getItem(entry.key)).not.toBeNull();
  expect([...store.data.values()]).toContain(raw);
});

test("a corrupt draft and its available records are preserved before subsequent edits", () => {
  const store = new MemoryStore(), a = notebook(); new RecoveryJournal(store).write(a, 0, true);
  const raw = store.getItem(RECOVERY_KEY)!, entries = JSON.parse(raw).notes;
  store.removeItem(entries[0].key);
  const journal = new RecoveryJournal(store);
  expect(() => journal.restore(a, 0)).toThrow("missing");
  journal.write(edit(a, "<p>Continue</p>"), 0, true);
  expect([...store.data.entries()].some(([key, value]) => key.includes("-conflict-") && value === raw)).toBe(true);
  expect(store.getItem(entries[1].key)).not.toBeNull();
});

test("cannot overwrite a damaged draft if even its preservation write fails", () => {
  const store = new MemoryStore(); store.setItem(RECOVERY_KEY, "broken draft");
  store.fail = () => true;
  const journal = new RecoveryJournal(store);
  expect(() => journal.restore(notebook(), 0)).toThrow();
  store.fail = () => false;
  expect(() => journal.write(notebook(), 0, true)).toThrow("preserve");
  expect(store.getItem(RECOVERY_KEY)).toBe("broken draft");
});

test("clean cache cannot replace changed legacy drafts or changed database revisions", () => {
  const store = new MemoryStore(), a = notebook(); new RecoveryJournal(store).write(a, 3, false);
  const legacy = edit(a, "<p>Legacy recovered text</p>"), journal = new RecoveryJournal(store);
  expect(journal.restore(legacy, 3).document).toBe(legacy);
  journal.write(legacy, 3, true);
  expect(new RecoveryJournal(store).restore(a, 3).document).toEqual(legacy);
  expect(new RecoveryJournal(store).restore(a, 4).document).toBe(a);
});

test("warm checkpoints reuse unchanged records after reopening", () => {
  const store = new MemoryStore(), a = notebook(); new RecoveryJournal(store).write(a, 3, false);
  const loaded = JSON.parse(JSON.stringify(a)), reopened = new RecoveryJournal(store);
  reopened.restore(loaded, 3); store.writes = [];
  reopened.write(edit(loaded, "<p>Changed</p>"), 3, true);
  expect(store.writes).toHaveLength(2);
});

test("benchmark complete-snapshot versus incremental recovery work", async () => {
  const { writeFileSync } = await import("node:fs");
  const a = notebook(120, 20000), iterations = 150;
  const baseline = new MemoryStore(), optimized = new MemoryStore(), journal = new RecoveryJournal(optimized);
  journal.write(a, 4, true); optimized.writes = [];
  const updates = Array.from({ length: iterations }, (_, i) => edit(a, `<p>${"x".repeat(20000)} ${i}</p>`));
  const start = performance.now();
  for (const w of updates) baseline.setItem("draft", JSON.stringify({ revision: 4, document: w }));
  const fullSnapshotMs = performance.now() - start;
  const incrementalStart = performance.now();
  for (const w of updates) journal.write(w, 4, true);
  const incrementalMs = performance.now() - incrementalStart;
  const fullSnapshotBytes = baseline.writes.reduce((n, w) => n + w.bytes, 0);
  const incrementalBytes = optimized.writes.reduce((n, w) => n + w.bytes, 0);
  expect(incrementalBytes).toBeLessThan(fullSnapshotBytes / 50);
  expect(new RecoveryJournal(optimized).restore(null, 4).document).toEqual(updates.at(-1));
  writeFileSync("release/recovery-benchmark-1.0.9.json", JSON.stringify({
    scope: "Node in-memory Storage: serialization, manifest creation, reclamation; excludes browser storage I/O and rendering",
    noteCount: a.notes.length, contentCharactersPerNote: 20000, iterations,
    fullSnapshotMs, incrementalMs, fullSnapshotBytes, incrementalBytes,
    reductionPercent: 100 * (1 - incrementalBytes / fullSnapshotBytes),
    timingWarning: "Single controlled run; not an end-to-end typing latency or native startup measurement. Initial checkpoint excluded.",
  }, null, 2));
});

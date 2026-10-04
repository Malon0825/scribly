import { browserDatabase, requestValue, transactionDone } from "./browserData";
import { RECOVERY_KEY } from "./recovery";

// Small drafts retain the synchronous recovery path. If its quota is reached,
// promote the journal atomically to IndexedDB rather than limiting the notebook.
export class RecoveryStorage {
  private records: Map<string, string> | null = null;
  private changes = new Map<string, string | undefined>();
  private queue = Promise.resolve();
  static async open() {
    const store = new RecoveryStorage(), db = await browserDatabase();
    const transaction = db.transaction("recovery"), done = transactionDone(transaction);
    const [keys, values] = await Promise.all([
      requestValue(transaction.objectStore("recovery").getAllKeys()),
      requestValue(transaction.objectStore("recovery").getAll()),
    ]);
    await done;
    if (keys.length) {
      store.promote();
      keys.forEach((key, index) => store.records!.set(String(key), values[index]));
      // Old conflict records remain recoverable; the IndexedDB manifest wins.
      for (const key of keys) store.changes.delete(String(key));
    }
    return store;
  }
  private promote() {
    if (this.records) return;
    this.records = new Map();
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)!;
      if (!key.startsWith(RECOVERY_KEY)) continue;
      const value = localStorage.getItem(key)!;
      this.records.set(key, value); this.changes.set(key, value);
    }
  }
  get length() { return this.records ? this.records.size : localStorage.length; }
  key(index: number) { return this.records ? [...this.records.keys()][index] ?? null : localStorage.key(index); }
  getItem(key: string) { return this.records ? this.records.get(key) ?? null : localStorage.getItem(key); }
  setItem(key: string, value: string) {
    if (!this.records) {
      try { localStorage.setItem(key, value); return; }
      catch (error) { if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error; this.promote(); }
    }
    this.records!.set(key, value); this.changes.set(key, value);
  }
  removeItem(key: string) {
    if (!this.records) { localStorage.removeItem(key); return; }
    this.records.delete(key); this.changes.set(key, undefined);
  }
  flush() {
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (!this.changes.size) return;
      const changes = [...this.changes], db = await browserDatabase();
      const transaction = db.transaction("recovery", "readwrite"), done = transactionDone(transaction);
      for (const [key, value] of changes) {
        if (value === undefined) transaction.objectStore("recovery").delete(key);
        else transaction.objectStore("recovery").put(value, key);
      }
      await done;
      // Reclaim the old synchronous copy only after the durable transaction
      // commits. Otherwise deleted records can reappear on the next promotion,
      // and a full localStorage would keep blocking unrelated preferences.
      for (const [key, value] of changes) {
        try { if (value === undefined || localStorage.getItem(key) === value) localStorage.removeItem(key); }
        catch { /* IndexedDB remains authoritative if local cleanup fails. */ }
      }
      for (const [key, value] of changes) if (this.changes.get(key) === value) this.changes.delete(key);
    });
    return this.queue;
  }
}

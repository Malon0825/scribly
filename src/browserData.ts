// Async, per-item storage. Large payloads never pass through localStorage.
let connection: Promise<IDBDatabase> | undefined;
export function browserDatabase() {
  return connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("scribly-notebook", 4);
    request.onupgradeneeded = () => {
      for (const name of ["workspace", "notes", "sources", "recovery", "history", "historyBodies", "backups", "protection"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      const history = request.transaction!.objectStore("history");
      if (!history.indexNames.contains("itemId")) history.createIndex("itemId", "itemId");
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(Error("Close other Scribly browser tabs and retry opening storage.")); };
  });
}
export function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || Error("Browser storage write was cancelled."));
    transaction.onerror = () => reject(transaction.error || Error("Browser storage is unavailable or full."));
  });
}
export function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

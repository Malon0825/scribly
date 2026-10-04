import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./storage";
import { browserDatabase, requestValue, transactionDone } from "./browserData";
import { storeSource } from "./sourceFiles";
import type { Workspace } from "./types";

export type BackupEntry = { id: string; time: string; size: number; protected: boolean };
export type BackupConfig = { enabled: boolean; directory: string | null; lastAt: string | null; lastRevision: number | null; entries: BackupEntry[]; warning?: string | null };
const defaults: BackupConfig = { enabled: false, directory: null, lastAt: null, lastRevision: null, entries: [] };
export async function backupStatus(): Promise<BackupConfig> {
  if (desktop) return await invoke<BackupConfig | null>("backup_status") || { ...defaults };
  const db = await browserDatabase();
  return await requestValue<BackupConfig | undefined>(db.transaction("protection").objectStore("protection").get("backups")) || { ...defaults };
}
export async function setBackupEnabled(enabled: boolean): Promise<BackupConfig> {
  if (desktop) return invoke("set_backup_enabled", { enabled });
  const update = async () => {
    const db = await browserDatabase(), transaction = db.transaction("protection", "readwrite"), done = transactionDone(transaction);
    const config = await requestValue<BackupConfig | undefined>(transaction.objectStore("protection").get("backups")) || { ...defaults };
    const next = { ...config, enabled }; transaction.objectStore("protection").put(next,"backups"); await done; return next;
  };
  return navigator.locks ? navigator.locks.request("scribly-backups", update) : update();
}
export async function chooseBackupDirectory(): Promise<BackupConfig | null> {
  return desktop ? invoke("choose_backup_directory") : backupStatus();
}
export async function saveBackup(workspace: Workspace, revision: number, protectedCopy = false): Promise<BackupConfig> {
  const { fileBackup } = await import("./fileBackup");
  const blob = await fileBackup(workspace), time = new Date().toISOString();
  if (desktop) {
    const source = await storeSource(blob,"backup.scribly","utf-8");
    try { return await invoke("commit_backup", { sourceId: source.id, time, revision, protected: protectedCopy }); }
    finally { await invoke("remove_source", { id: source.id }).catch(() => {}); }
  }
  const write = async () => {
    const db = await browserDatabase(), transaction = db.transaction(["backups", "protection"], "readwrite"), done = transactionDone(transaction);
    const config = await requestValue<BackupConfig | undefined>(transaction.objectStore("protection").get("backups")) || { ...defaults };
    const entry = { id: crypto.randomUUID(), time, size: blob.size, protected: protectedCopy };
    transaction.objectStore("backups").put(blob,entry.id);
    let ordinary = 0, safety = 0;
    const entries = [entry, ...config.entries].filter(value => {
      const retain = value.protected ? ++safety <= 3 : ++ordinary <= 7;
      if (!retain) transaction.objectStore("backups").delete(value.id);
      return retain;
    });
    const next = { ...config, entries, ...(!protectedCopy ? { lastAt: time, lastRevision: revision } : {}) };
    transaction.objectStore("protection").put(next,"backups"); await done; return next;
  };
  return navigator.locks ? navigator.locks.request("scribly-backups", write) : write();
}
export async function readBackup(entry: BackupEntry): Promise<Blob> {
  if (!desktop) {
    const db = await browserDatabase(), blob = await requestValue<Blob | undefined>(db.transaction("backups").objectStore("backups").get(entry.id));
    if (!(blob instanceof Blob) || blob.size !== entry.size) throw Error("Backup is missing or damaged. Choose another backup file.");
    return blob;
  }
  const parts: Blob[] = [];
  for (let offset = 0; offset < entry.size; offset += 1024 * 1024) parts.push(new Blob([await invoke<ArrayBuffer>("read_backup_chunk", { id: entry.id, offset, length: Math.min(1024 * 1024,entry.size - offset) })]));
  return new Blob(parts,{ type: "application/zip" });
}
export function backupDue(config: BackupConfig, revision: number, now = Date.now()) {
  return config.enabled && config.lastRevision !== revision && (!config.lastAt || now - Date.parse(config.lastAt) >= 86400_000);
}
export function useBackups(workspace: Workspace | null, status: string, checkpoint: () => Workspace | null, revision: () => number) {
  const [config, setConfig] = useState<BackupConfig>(defaults), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const initialized = useRef(false), running = useRef(false), retryAfter = useRef(0);
  const latest = useRef({ workspace, status, checkpoint, revision, config }); latest.current = { workspace, status, checkpoint, revision, config };
  useEffect(() => {
    if (!workspace || initialized.current) return;
    initialized.current = true;
    void backupStatus().then(setConfig).catch(reason => setError(String(reason)));
  },[!!workspace]);
  async function run(protectedCopy = false) {
    if (running.current) throw Error("A backup is already running. Try again when it finishes.");
    running.current = true; setBusy(true); setError("");
    try {
      let settings = await backupStatus();
      if (desktop && !settings.directory) {
        settings = await chooseBackupDirectory() || settings;
        if (!settings.directory) throw Error("Choose a backup folder before creating a recovery copy.");
      }
      const current = latest.current.checkpoint();
      if (!current) throw Error("The notebook is not ready.");
      const next = await saveBackup(current,latest.current.revision(),protectedCopy); setConfig(next);
      if (next.warning) setError(next.warning);
      return next;
    } catch (reason) { setError(String(reason)); retryAfter.current = Date.now() + 5 * 60_000; throw reason; }
    finally { running.current = false; setBusy(false); }
  }
  useEffect(() => {
    const check = async () => {
      const current = latest.current;
      if (!current.workspace || current.status !== "saved" || running.current || Date.now() < retryAfter.current) return;
      try {
        const settings = await backupStatus();
        if (backupDue(settings,current.revision()) && (!desktop || settings.directory)) await run();
      } catch (reason) { setError(String(reason)); retryAfter.current = Date.now() + 5 * 60_000; }
    };
    const first = setTimeout(() => void check(), 1500), interval = setInterval(() => void check(),60_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  },[status, config.enabled]);
  return { config, error, busy, run,
    choose: async () => { const next = await chooseBackupDirectory(); if (next) setConfig(next); },
    enable: async (enabled: boolean) => { setConfig(await setBackupEnabled(enabled)); retryAfter.current = 0; setError(""); },
  };
}

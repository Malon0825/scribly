export type BackupRecord = { at: number; downloaded: boolean };
const key = (dataPath: string) => `scribly-backup:${dataPath}`;
export function readBackup(dataPath: string): BackupRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(dataPath)) || 'null');
    return Number.isFinite(value?.at) && value.at > 0 && value.at <= Date.now()
      && typeof value.downloaded === 'boolean' ? value : null;
  } catch { return null; }
}
export function recordBackup(dataPath: string, record: BackupRecord) {
  localStorage.setItem(key(dataPath), JSON.stringify(record));
}
export function backupStatus(record: BackupRecord | null, now = Date.now()) {
  if (!record) return 'No backup export recorded';
  const days = Math.max(0, Math.floor((now - record.at) / 86400000));
  const age = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  return `${record.downloaded ? 'Backup download requested' : 'Last backup export'}: ${age}`;
}

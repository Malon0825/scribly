//! Opt-in, app-running backups. Only indexed app-created files are reclaimed.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Config {
    pub enabled: bool,
    pub directory: Option<String>,
    pub last_at: Option<String>,
    pub last_revision: Option<i64>,
    pub entries: Vec<Entry>,
    pub warning: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub id: String,
    pub time: String,
    pub size: u64,
    pub protected: bool,
}
pub(crate) fn load(root: &Path) -> Result<Config, String> {
    match crate::files::read_bounded(&root.join("backup-settings.json"), 128 * 1024) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            format!("Backup settings could not be read. Existing backups were retained: {e}")
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub(crate) fn save(root: &Path, config: &Config) -> Result<(), String> {
    crate::files::replace(
        &root.join("backup-settings.json"),
        &serde_json::to_vec(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
pub(crate) fn select(root: &Path, directory: PathBuf) -> Result<Config, String> {
    if !directory.is_dir() {
        return Err("Choose an existing backup folder.".into());
    }
    let mut config = load(root)?;
    let path = dunce::canonicalize(directory)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    if config.directory.as_ref() != Some(&path) {
        config.entries.clear();
        config.last_at = None;
        config.last_revision = None;
    }
    config.directory = Some(path);
    config.warning = None;
    save(root, &config)?;
    Ok(config)
}
fn target(config: &Config, id: &str) -> Result<PathBuf, String> {
    if uuid::Uuid::parse_str(id).is_err() || id.len() != 36 {
        return Err("Invalid backup ID.".into());
    }
    let path = PathBuf::from(
        config
            .directory
            .as_ref()
            .ok_or("Choose a backup folder first.")?,
    )
    .join(format!("Scribly-backup-{id}.scribly"));
    if let Ok(info) = fs::symlink_metadata(&path) {
        if info.file_type().is_symlink() || !info.is_file() {
            return Err("Backup paths must be ordinary files.".into());
        }
    }
    Ok(path)
}
pub(crate) fn commit(
    root: &Path,
    source_id: &str,
    time: String,
    revision: i64,
    protected: bool,
) -> Result<Config, String> {
    if time.len() != 24 || !time.ends_with('Z') || revision < 0 {
        return Err("Invalid backup snapshot.".into());
    }
    let mut config = load(root)?;
    let id = uuid::Uuid::new_v4().to_string();
    let destination = target(&config, &id)?;
    crate::sources::export(root, source_id, &destination).map_err(|e| format!("Backup could not be saved. Check the folder and available disk space; previous backups were retained: {e}"))?;
    let size = fs::metadata(&destination).map_err(|e| e.to_string())?.len();
    config.entries.insert(
        0,
        Entry {
            id,
            time: time.clone(),
            size,
            protected,
        },
    );
    if !protected {
        config.last_at = Some(time);
        config.last_revision = Some(revision);
    }
    config.warning = None;
    // Commit the successful backup index before removing any old files.
    save(root, &config)?;
    let mut ordinary = 0;
    let mut safety = 0;
    let mut retained = Vec::new();
    for entry in &config.entries {
        let count = if entry.protected {
            safety += 1;
            safety
        } else {
            ordinary += 1;
            ordinary
        };
        let limit = if entry.protected { 3 } else { 7 };
        if count <= limit {
            retained.push(entry.clone());
            continue;
        }
        match target(&config, &entry.id)
            .and_then(|path| fs::remove_file(path).map_err(|e| e.to_string()))
        {
            Ok(()) => {}
            Err(e) => {
                retained.push(entry.clone());
                config.warning = Some(format!("Backup saved. Older backup cleanup failed: {e}"));
            }
        }
    }
    config.entries = retained;
    save(root, &config)?;
    Ok(config)
}
pub(crate) fn read(root: &Path, id: &str, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    if length > 1024 * 1024 {
        return Err("Backup read chunk is too large.".into());
    }
    let config = load(root)?;
    let entry = config
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or("Backup is no longer retained.")?;
    let mut file = fs::File::open(target(&config, id)?).map_err(|e| {
        format!("Backup unavailable. Reconnect its drive or choose another file: {e}")
    })?;
    if file.metadata().map_err(|e| e.to_string())?.len() != entry.size || offset > entry.size {
        return Err("Backup size changed. Import a verified backup file instead.".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(length);
    file.take(length as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retention_reclaims_only_owned_backups_and_failed_writes_keep_prior_state() {
        let root =
            std::env::temp_dir().join(format!("scribly-backup-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("copies")).unwrap();
        fs::write(root.join("copies/unrelated.txt"), b"keep").unwrap();
        select(&root, root.join("copies")).unwrap();
        let source = uuid::Uuid::new_v4().to_string();
        crate::sources::begin(&root, &source).unwrap();
        crate::sources::append(&root, &source, 0, b"backup").unwrap();
        crate::sources::finish(&root, &source, 6).unwrap();
        for index in 0..9 {
            commit(
                &root,
                &source,
                "2026-10-04T00:00:00.000Z".into(),
                index,
                false,
            )
            .unwrap();
        }
        let before = load(&root).unwrap();
        assert_eq!(before.entries.len(), 7);
        assert_eq!(
            read(&root, &before.entries[0].id, 0, 1024).unwrap(),
            b"backup"
        );
        assert!(commit(
            &root,
            "invalid",
            "2026-10-04T00:00:00.000Z".into(),
            10,
            false
        )
        .is_err());
        assert_eq!(load(&root).unwrap().last_revision, before.last_revision);
        // Simulate a disconnected destination without deleting its copies.
        fs::rename(root.join("copies"), root.join("offline-copies")).unwrap();
        assert!(commit(&root, &source, "2026-10-04T00:00:00.000Z".into(), 10, false).is_err());
        assert_eq!(load(&root).unwrap().last_revision, before.last_revision);
        fs::rename(root.join("offline-copies"), root.join("copies")).unwrap();
        assert_eq!(
            read(&root, &before.entries[0].id, 0, 1024).unwrap(),
            b"backup"
        );
        for _ in 0..4 {
            commit(&root, &source, "2026-10-04T00:00:00.000Z".into(), 10, true).unwrap();
        }
        let protected = load(&root).unwrap();
        assert_eq!(
            protected
                .entries
                .iter()
                .filter(|entry| entry.protected)
                .count(),
            3
        );
        assert_eq!(
            protected
                .entries
                .iter()
                .filter(|entry| !entry.protected)
                .count(),
            7
        );
        assert_eq!(protected.last_revision, before.last_revision);
        assert!(root.join("copies/unrelated.txt").exists());
        assert!(read(&root, "../unrelated", 0, 1).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

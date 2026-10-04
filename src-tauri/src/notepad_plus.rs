//! Read-only Notepad++ periodic snapshots. Ignore saved originals, .bak files,
//! session XML and in-progress .tmp writes. No dependency on session.xml paths.
use crate::notepad::{RecoveredTab, ScanResult};
use serde::Serialize;
use std::{fs, io::Read, path::Path};
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 8 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 32 * 1024 * 1024;
const MAX_TABS: usize = 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotScan {
    #[serde(flatten)]
    result: ScanResult,
    source_directory: String,
}

fn snapshot_title(name: &str) -> Option<&str> {
    let (title, stamp) = name.rsplit_once('@')?;
    let bytes = stamp.as_bytes();
    if title.is_empty() || bytes.len() != 17 {
        return None;
    }
    for (i, b) in bytes.iter().enumerate() {
        if match i {
            4 | 7 => *b != b'-',
            10 => *b != b'_',
            _ => !b.is_ascii_digit(),
        } {
            return None;
        }
    }
    Some(title)
}

fn decode_snapshot(bytes: &[u8]) -> Result<String, String> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let body = &bytes[2..];
        let (pairs, remainder) = body.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err("Incomplete UTF-16 snapshot. Wait for Notepad++ to finish its backup, then scan again.".into());
        }
        let little = bytes[0] == 0xff;
        let units: Vec<u16> = pairs
            .iter()
            .map(|p| {
                if little {
                    u16::from_le_bytes(*p)
                } else {
                    u16::from_be_bytes(*p)
                }
            })
            .collect();
        String::from_utf16(&units)
            .map_err(|_| "Invalid UTF-16 snapshot. Save this tab as UTF-8 and use Import files.")?
    } else {
        let body = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
        std::str::from_utf8(body).map_err(|_| "This snapshot uses an unsupported encoding. Save the tab as UTF-8 in Notepad++ and use Import files.")?.to_owned()
    };
    if text.len() > MAX_TEXT_BYTES {
        return Err("Snapshot exceeds 8 MiB of text. Use Import files for this tab.".into());
    }
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("Snapshot contains binary data or unsupported text controls. Use Import files for this tab.".into());
    }
    Ok(text)
}

fn read_snapshot(path: &Path, root: &Path) -> Result<String, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "Snapshot is unavailable. Scan again.")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Snapshot is not a regular file.".into());
    }
    // Also exclude Windows reparse points and targets outside the chosen folder.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Linked snapshots are not imported.".into());
        }
    }
    let actual = fs::canonicalize(path).map_err(|_| "Snapshot path is unavailable.")?;
    if actual.parent() != Some(root) {
        return Err("Snapshot is outside the selected backup folder.".into());
    }
    if metadata.len() > MAX_FILE_BYTES as u64 {
        return Err("Snapshot exceeds 16 MiB. Use Import files for this tab.".into());
    }
    let mut file = fs::File::open(actual).map_err(|_| "Snapshot is locked or unreadable. Wait for Notepad++ to finish its backup, then scan again.")?;
    let before = file
        .metadata()
        .map_err(|_| "Could not read snapshot metadata.")?;
    let mut bytes = Vec::new();
    (&mut file)
        .take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read snapshot.")?;
    let after = file
        .metadata()
        .map_err(|_| "Could not read snapshot metadata.")?;
    if bytes.len() > MAX_FILE_BYTES
        || bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err("Snapshot changed while scanning. Wait for Notepad++ to finish its backup, then scan again.".into());
    }
    decode_snapshot(&bytes)
}

fn scan_directory(directory: &Path) -> Result<SnapshotScan, String> {
    // The user may choose either the Notepad++ profile or its backup folder.
    let directory = if directory.join("backup").is_dir() {
        directory.join("backup")
    } else {
        directory.to_path_buf()
    };
    let mut scan = SnapshotScan {
        result: ScanResult::default(),
        source_directory: directory.to_string_lossy().into_owned(),
    };
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(scan),
        Err(_) => return Err("The Notepad++ backup folder could not be read. Choose another folder or check its permissions.".into()),
    };
    scan.result.found = true;
    let root = fs::canonicalize(&directory).map_err(|_| "The backup folder is unavailable.")?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| "The backup folder could not be listed.")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if snapshot_title(&name).is_some() {
            if files.len() == MAX_TABS {
                scan.result.skipped.push(
                    "More than 1,000 snapshots found. Import remaining tabs as files.".into(),
                );
                break;
            }
            files.push((name, entry.path()));
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut total = 0;
    for (name, path) in files {
        match read_snapshot(&path, &root) {
            Ok(text) if text.trim().is_empty() => scan.result.empty_tabs += 1,
            Ok(text) if total + text.len() <= MAX_BATCH_BYTES => {
                total += text.len();
                scan.result.tabs.push(RecoveredTab {
                    id: name.clone(),
                    title: snapshot_title(&name).unwrap().chars().take(120).collect(),
                    text,
                });
            }
            Ok(_) => scan.result.skipped.push(format!(
                "{name}: Batch exceeds 32 MiB of text. Import remaining tabs as files."
            )),
            Err(error) => scan.result.skipped.push(format!("{name}: {error}")),
        }
    }
    Ok(scan)
}

#[tauri::command]
pub(crate) async fn scan_notepad_plus_tabs(
    app: tauri::AppHandle,
    directory: Option<String>,
    choose_directory: Option<bool>,
) -> Result<Option<SnapshotScan>, String> {
    if !cfg!(windows) {
        return Err("Direct Notepad++ import is available in the Windows app.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = if choose_directory.unwrap_or(false) {
            let Some(folder) = app
                .dialog()
                .file()
                .set_title("Choose Notepad++ profile or backup folder")
                .blocking_pick_folder()
            else {
                return Ok(None);
            };
            folder
                .into_path()
                .map_err(|_| "The selected folder is not a local path.")?
        } else if let Some(directory) = directory {
            directory.into()
        } else {
            Path::new(&std::env::var_os("APPDATA").ok_or("Windows app data is unavailable.")?)
                .join("Notepad++/backup")
        };
        scan_directory(&root).map(Some)
    })
    .await
    .map_err(|_| "Notepad++ scan could not finish.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("scribly-npp-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(path.join("backup")).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn accepts_only_periodic_snapshot_names() {
        assert_eq!(
            snapshot_title("work@home.txt@2026-10-04_123456"),
            Some("work@home.txt")
        );
        for name in [
            "session.xml",
            "new 1@2026-10-04_123456.tmp",
            "file.bak",
            "@2026-10-04_123456",
            "new 1@broken",
            "new 1@2026-10-04_12345x",
        ] {
            assert!(snapshot_title(name).is_none());
        }
    }
    #[test]
    fn decodes_unicode_and_preserves_whitespace() {
        let text = "  First  line\r\n\t日本語 😀\n";
        assert_eq!(decode_snapshot(text.as_bytes()).unwrap(), text);
        let mut utf8 = vec![0xef, 0xbb, 0xbf];
        utf8.extend(text.as_bytes());
        assert_eq!(decode_snapshot(&utf8).unwrap(), text);
        for little in [true, false] {
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for unit in text.encode_utf16() {
                bytes.extend(if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            assert_eq!(decode_snapshot(&bytes).unwrap(), text);
        }
    }
    #[test]
    fn rejects_invalid_and_binary_encodings() {
        for bytes in [
            &[0xff, 0xfe, 1][..],
            &[0xff, 0xfe, 0, 0xd8],
            &[0xe9],
            b"binary\0data",
        ] {
            assert!(decode_snapshot(bytes).is_err());
        }
        assert!(decode_snapshot(&vec![b'a'; MAX_TEXT_BYTES + 1]).is_err());
    }
    #[test]
    fn profile_and_backup_scan_leave_sources_untouched() {
        let fixture = Fixture::new();
        let backup = fixture.0.join("backup");
        let snapshot = backup.join("new 1@2026-10-04_123456");
        fs::write(&snapshot, "unsaved\n  text").unwrap();
        fs::write(backup.join("file.txt@2026-10-04_123457"), "named draft").unwrap();
        fs::write(backup.join("empty@2026-10-04_123458"), " \n").unwrap();
        fs::write(backup.join("bad@2026-10-04_123459"), [0xe9]).unwrap();
        fs::write(backup.join("file.bak"), "saved copy").unwrap();
        fs::write(backup.join("new 1@2026-10-04_123456.tmp"), "partial").unwrap();
        fs::write(fixture.0.join("session.xml"), "invalid XML must be ignored").unwrap();
        let before = fs::metadata(&snapshot).unwrap().modified().unwrap();
        for source in [&fixture.0, &backup] {
            let result = scan_directory(source).unwrap().result;
            assert!(result.found);
            assert_eq!(result.tabs.len(), 2);
            assert_eq!(result.empty_tabs, 1);
            assert_eq!(result.skipped.len(), 1);
            assert_eq!(result.tabs[1].title, "new 1");
            assert_eq!(result.tabs[1].text, "unsaved\n  text");
        }
        assert_eq!(fs::read_to_string(&snapshot).unwrap(), "unsaved\n  text");
        assert_eq!(fs::metadata(&snapshot).unwrap().modified().unwrap(), before);
    }
    #[test]
    fn missing_and_oversize_snapshots_are_reported() {
        let fixture = Fixture::new();
        assert!(
            !scan_directory(&fixture.0.join("absent"))
                .unwrap()
                .result
                .found
        );
        let large = fs::File::create(fixture.0.join("backup/huge@2026-10-04_123456")).unwrap();
        large.set_len(MAX_FILE_BYTES as u64 + 1).unwrap();
        let result = scan_directory(&fixture.0).unwrap().result;
        assert_eq!(result.skipped.len(), 1);
        assert!(result.tabs.is_empty());
    }
    #[test]
    fn ignores_directories_masquerading_as_snapshots() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("backup/new 1@2026-10-04_123456")).unwrap();
        let result = scan_directory(&fixture.0).unwrap().result;
        assert!(result.tabs.is_empty());
        assert_eq!(result.skipped.len(), 1);
    }
}

//! Immutable originals, uploaded and read in bounded chunks. No notebook quota.
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const CHUNK_BYTES: usize = 1024 * 1024;
fn path(root: &Path, id: &str, partial: bool) -> Result<PathBuf, String> {
    if uuid::Uuid::parse_str(id).is_err() || id.len() != 36 || id != id.to_lowercase() {
        return Err("Invalid source file ID.".into());
    }
    let directory = root.join("sources");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    if fs::symlink_metadata(&directory)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Source storage must be an app-owned directory.".into());
    }
    let target = directory.join(format!("{id}.{}", if partial { "part" } else { "source" }));
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Invalid source storage file.".into());
        }
    }
    Ok(target)
}
pub(crate) fn begin(root: &Path, id: &str) -> Result<(), String> {
    if path(root, id, false)?.exists() {
        return Err("Source file already exists.".into());
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path(root, id, true)?)
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub(crate) fn append(root: &Path, id: &str, offset: u64, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > CHUNK_BYTES {
        return Err("Source upload chunk is too large.".into());
    }
    let mut file = OpenOptions::new()
        .append(true)
        .open(path(root, id, true)?)
        .map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != offset {
        return Err("Source upload offset does not match. Retry importing the file.".into());
    }
    file.write_all(bytes)
        .map_err(|e| format!("Source could not be stored. Check available disk space: {e}"))
}
pub(crate) fn finish(root: &Path, id: &str, size: u64) -> Result<(), String> {
    let partial = path(root, id, true)?;
    let file = OpenOptions::new()
        .write(true)
        .open(&partial)
        .map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != size {
        return Err("Source upload is incomplete.".into());
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    let target = path(root, id, false)?;
    if target.exists() {
        return Err("Source file already exists.".into());
    }
    fs::rename(partial, target).map_err(|e| e.to_string())
}
pub(crate) fn remove(root: &Path, id: &str, partial: bool) -> Result<(), String> {
    match fs::remove_file(path(root, id, partial)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
pub(crate) fn read(
    root: &Path,
    id: &str,
    offset: u64,
    length: usize,
    size: u64,
) -> Result<Vec<u8>, String> {
    if length > CHUNK_BYTES {
        return Err("Source read chunk is too large.".into());
    }
    let mut file = File::open(path(root, id, false)?)
        .map_err(|_| "Source file is missing. Restore a Scribly file backup.".to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != size || offset > size {
        return Err("Source file size does not match the saved reference.".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(length);
    file.take(length as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}
pub(crate) fn export(root: &Path, id: &str, destination: &Path) -> Result<(), String> {
    let mut source = File::open(path(root, id, false)?).map_err(|e| e.to_string())?;
    crate::files::replace_with(destination, |output| {
        std::io::copy(&mut source, output).map(|_| ())
    })
    .map_err(|e| format!("Export failed; the previous destination was retained: {e}"))
}
pub(crate) fn validate(root: &Path, document: &serde_json::Value) -> Result<(), String> {
    static TAG: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static MARKER: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static ID: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let tag = TAG.get_or_init(|| regex::Regex::new(r"<div\b[^>]*>").unwrap());
    let marker =
        MARKER.get_or_init(|| regex::Regex::new(r"\sdata-notify-source(?:=|\s|>)").unwrap());
    let id = ID.get_or_init(|| regex::Regex::new(r#"\sdata-source-id=["']([^"']*)["']"#).unwrap());
    for note in document["notes"]
        .as_array()
        .ok_or("Invalid notebook notes")?
    {
        let content = note["content"].as_str().unwrap_or("");
        for opening in tag
            .find_iter(content)
            .filter(|opening| marker.is_match(opening.as_str()))
        {
            let capture = id
                .captures(opening.as_str())
                .ok_or("Invalid source file reference")?;
            if !matches!(document["schemaVersion"].as_u64(), Some(4 | 5))
                || !path(root, &capture[1], false)?.is_file()
            {
                return Err(
                    "Source file is missing or uses an unsupported notebook format.".into(),
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_attributes_in_literal_code_are_not_file_references() {
        let root = std::env::temp_dir();
        let literal = serde_json::json!({"schemaVersion":3,"notes":[{"content":"<pre><code>&lt;div data-notify-source=\"\" data-source-id=\"literal\"&gt;</code></pre>"}]});
        assert!(validate(&root, &literal).is_ok());
        let actual = serde_json::json!({"schemaVersion":4,"notes":[{"content":"<div data-notify-source=\"\" data-source-id=\"invalid\"></div>"}]});
        assert!(validate(&root, &actual).is_err());
    }
    #[test]
    fn large_sources_preserve_bytes_with_bounded_reads_and_atomic_export() {
        let root =
            std::env::temp_dir().join(format!("scribly-source-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        begin(&root, &id).unwrap();
        let chunk = vec![b'x'; CHUNK_BYTES];
        for index in 0..24 {
            append(&root, &id, index * CHUNK_BYTES as u64, &chunk).unwrap();
        }
        assert!(append(&root, &id, 0, b"wrong offset").is_err());
        let size = 24 * CHUNK_BYTES as u64;
        finish(&root, &id, size).unwrap();
        assert_eq!(
            read(&root, &id, size - 12, 100, size).unwrap(),
            vec![b'x'; 12]
        );
        assert!(read(&root, &id, 0, CHUNK_BYTES + 1, size).is_err());
        assert!(read(&root, &id, 0, 12, size + 1).is_err());
        assert!(read(&root, "../outside", 0, 12, size).is_err());
        let destination = root.join("original.xml");
        export(&root, &id, &destination).unwrap();
        assert_eq!(fs::metadata(&destination).unwrap().len(), size);
        let incomplete = uuid::Uuid::new_v4().to_string();
        begin(&root, &incomplete).unwrap();
        assert!(finish(&root, &incomplete, 1).is_err());
        remove(&root, &incomplete, true).unwrap();
        remove(&root, &id, false).unwrap();
        fs::remove_file(destination).unwrap();
        fs::remove_dir(root.join("sources")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

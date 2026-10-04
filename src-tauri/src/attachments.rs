use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, SystemTime},
};

const MAX_IMAGE: usize = 5 * 1024 * 1024;
pub fn valid_id(id: &str) -> bool {
    let Some((hash, ext)) = id.split_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && matches!(ext, "png" | "jpeg" | "gif" | "webp")
}
fn raster(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[137, 80, 78, 71]) {
        Some("png")
    } else if bytes.starts_with(&[255, 216, 255]) {
        Some("jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("webp")
    } else {
        None
    }
}
pub fn directory(root: &Path) -> Result<PathBuf, String> {
    let path = root.join("attachments");
    fs::create_dir_all(&path).map_err(|e| format!("Could not open image storage: {e}"))?;
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || dunce::canonicalize(&path)
            .map_err(|e| e.to_string())?
            .parent()
            != Some(
                dunce::canonicalize(root)
                    .map_err(|e| e.to_string())?
                    .as_path(),
            )
    {
        return Err("Image storage must be inside this notebook's data directory.".into());
    }
    Ok(path)
}
fn file(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid image reference.".into());
    }
    let path = directory(root)?.join(id);
    let info = fs::symlink_metadata(&path).map_err(|_| {
        "A notebook image is missing. Restore it before saving or exporting.".to_string()
    })?;
    if !info.is_file()
        || info.file_type().is_symlink()
        || info.len() == 0
        || info.len() > MAX_IMAGE as u64
    {
        return Err("Invalid notebook image file.".into());
    }
    Ok(path)
}
pub fn read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let bytes =
        crate::files::read_bounded(&file(root, id)?, MAX_IMAGE).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE
        || raster(&bytes) != id.split_once('.').map(|(_, ext)| ext)
        || format!("{:x}", Sha256::digest(&bytes)) != id[..64]
    {
        return Err("A notebook image is damaged. Restore the original before exporting.".into());
    }
    Ok(bytes)
}
pub fn store(root: &Path, bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > MAX_IMAGE {
        return Err("Image exceeds 5 MB. Use a smaller copy.".into());
    }
    let ext = raster(bytes).ok_or("Use a PNG, JPEG, WebP or GIF image.")?;
    let id = format!("{:x}.{ext}", Sha256::digest(bytes));
    let dir = directory(root)?;
    if dir.join(&id).exists() {
        read(root, &id)?;
    } else {
        let temp = dir.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            output
                .write_all(bytes)
                .and_then(|_| output.sync_all())
                .map_err(|e| format!("Image could not be saved: {e}"))?;
            drop(output);
            fs::rename(&temp, dir.join(&id)).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result?;
    }
    Ok(json!({"id":id,"size":bytes.len()}))
}
pub fn list(root: &Path) -> Result<HashMap<String, u64>, String> {
    let mut result = HashMap::new();
    for entry in fs::read_dir(directory(root)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name().to_string_lossy().to_string();
        if valid_id(&id) {
            if let Ok(path) = file(root, &id) {
                result.insert(id, fs::metadata(path).map_err(|e| e.to_string())?.len());
            }
        }
    }
    Ok(result)
}
pub fn references(document: &Value) -> Result<Vec<String>, String> {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        regex::Regex::new(r#"<img\b[^>]*\bdata-notify-attachment\s*=\s*["']([^"']*)["']"#).unwrap()
    });
    let mut ids = Vec::new();
    for note in document["notes"]
        .as_array()
        .ok_or("Invalid notebook notes")?
    {
        for capture in pattern.captures_iter(note["content"].as_str().unwrap_or("")) {
            if !matches!(document["schemaVersion"].as_u64(), Some(3..=5)) || !valid_id(&capture[1])
            {
                return Err("Invalid notebook image reference or format.".into());
            }
            ids.push(capture[1].to_string());
        }
    }
    Ok(ids)
}
pub fn validate(root: &Path, document: &Value) -> Result<(), String> {
    let mut checked = HashSet::new();
    for id in references(document)? {
        if checked.insert(id.clone()) {
            file(root, &id)?;
        }
    }
    Ok(())
}
pub fn prune(root: &Path, keep: &HashSet<String>) -> Result<usize, String> {
    let dir = directory(root)?;
    let mut removed = 0;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&id) || keep.contains(&id) {
            continue;
        }
        let path = file(root, &id)?;
        let info = fs::metadata(&path).map_err(|e| e.to_string())?;
        if SystemTime::now()
            .duration_since(info.modified().map_err(|e| e.to_string())?)
            .unwrap_or_default()
            > Duration::from_secs(30 * 86400)
        {
            fs::remove_file(path).map_err(|e| e.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn images_are_deduplicated_checked_and_missing_images_reject_save() {
        let root =
            std::env::temp_dir().join(format!("notify-attachment-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let bytes = b"\x89PNG image fixture";
        let stored = store(&root, bytes).unwrap();
        let id = stored["id"].as_str().unwrap();
        assert_eq!(stored, store(&root, bytes).unwrap());
        assert_eq!(list(&root).unwrap().len(), 1);
        assert_eq!(read(&root, id).unwrap(), bytes);
        let doc = json!({"schemaVersion":3,"notes":[{"content":format!("<img data-notify-attachment=\"{id}\">")}]});
        validate(&root, &doc).unwrap();
        assert_eq!(prune(&root, &HashSet::new()).unwrap(), 0);
        let old = SystemTime::now() - Duration::from_secs(31 * 86400);
        fs::OpenOptions::new()
            .write(true)
            .open(root.join("attachments").join(id))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();
        assert_eq!(prune(&root, &HashSet::from([id.to_string()])).unwrap(), 0);
        fs::write(root.join("attachments").join(id), b"\x89PNG tampered").unwrap();
        assert!(read(&root, id).is_err());
        fs::remove_file(root.join("attachments").join(id)).unwrap();
        assert!(validate(&root, &doc).is_err());
        let mut large = vec![0; MAX_IMAGE];
        large[..4].copy_from_slice(b"\x89PNG");
        let big = store(&root, &large).unwrap();
        let big_id = big["id"].as_str().unwrap();
        let repeated = json!({"schemaVersion":3,"notes":[{"content":format!("<img data-notify-attachment=\"{big_id}\">").repeat(4)}]});
        assert!(validate(&root, &repeated).is_ok());
        assert!(store(&root, &vec![0; MAX_IMAGE + 1]).is_err());
        fs::remove_file(root.join("attachments").join(big_id)).unwrap();
        store(&root, bytes).unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(root.join("attachments").join(id))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();
        assert_eq!(prune(&root, &HashSet::new()).unwrap(), 1);
        assert!(!valid_id("../outside.png"));
        assert!(read(&root, "../outside.png").is_err());
        fs::remove_dir(root.join("attachments")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

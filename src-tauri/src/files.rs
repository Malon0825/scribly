//! Bounded reads and same-directory, synced replacement of important files.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

struct PendingFile(PathBuf);
impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub(crate) fn read_bounded(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "File exceeds its size limit",
        ));
    }
    Ok(bytes)
}

pub(crate) fn replace(path: &Path, bytes: &[u8]) -> io::Result<()> {
    replace_with(path, |file| file.write_all(bytes))
}

pub(crate) fn replace_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let temporary = PendingFile(parent.join(format!(".scribly-{}.tmp", uuid::Uuid::new_v4())));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary.0)?;
    // No truncation of the destination: any write/sync failure retains its old bytes.
    write(&mut file)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary.0, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_preserves_previous_file_on_failed_write_and_cleans_temporary() {
        let root = std::env::temp_dir().join(format!("scribly-file-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("credentials.json");
        replace(&path, b"old credentials").unwrap();
        let error = replace_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::new(
                io::ErrorKind::StorageFull,
                "simulated full disk",
            ))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::StorageFull);
        assert_eq!(fs::read(&path).unwrap(), b"old credentials");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        replace(&path, b"new credentials").unwrap();
        assert_eq!(read_bounded(&path, 15).unwrap(), b"new credentials");
        assert!(read_bounded(&path, 14).is_err());
        let directory = root.join("existing-directory");
        fs::create_dir(&directory).unwrap();
        assert!(replace(&directory, b"cannot replace a directory").is_err());
        assert!(directory.is_dir());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir(directory).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

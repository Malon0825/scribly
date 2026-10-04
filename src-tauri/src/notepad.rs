//! Read-only Windows Notepad recovery import. Never opens the original saved
//! file, writes recovery data, closes Notepad, or falls back to guessing text.
//! Format research: ogmini/Notepad-State-Library (TabState hex pattern).
use serde::Serialize;
use std::{fs, io::Read, path::Path};

const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TEXT_UNITS: usize = 2_000_000;
const MAX_BATCH_BYTES: usize = 32 * 1024 * 1024;
const MAX_TABS: usize = 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveredTab {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) text: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanResult {
    pub(crate) tabs: Vec<RecoveredTab>,
    pub(crate) skipped: Vec<String>,
    pub(crate) empty_tabs: usize,
    pub(crate) saved_tabs: usize,
    pub(crate) found: bool,
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(len).ok_or("Invalid Notepad length.")?;
        let bytes = self.bytes.get(self.pos..end).ok_or("Incomplete recovery data. Close the Notepad window while keeping its tabs, then scan again.")?;
        self.pos = end;
        Ok(bytes)
    }
    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn number(&mut self) -> Result<u64, String> {
        let mut value = 0u64;
        for shift in (0..70).step_by(7) {
            let byte = self.byte()?;
            if shift == 63 && byte > 1 {
                return Err("Invalid Notepad number.".into());
            }
            value |= ((byte & 127) as u64) << shift;
            if byte & 128 == 0 {
                return Ok(value);
            }
        }
        Err("Invalid Notepad number.".into())
    }
    fn count(&mut self, limit: usize) -> Result<usize, String> {
        let count = self.number()?;
        if count > limit as u64 {
            return Err("Recovery data exceeds the import limit. Save this tab as a text file and use Import files instead.".into());
        }
        Ok(count as usize)
    }
    fn units(&mut self, len: usize) -> Result<Vec<u16>, String> {
        Ok(self
            .take(len.checked_mul(2).ok_or("Invalid text length.")?)?
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect())
    }
    fn checksum(&mut self, start: usize) -> Result<(), String> {
        let actual = crc32fast::hash(&self.bytes[start..self.pos]);
        let bytes = self.take(4)?;
        // CRC bytes are big endian even though text units are little endian.
        let expected = u32::from_be_bytes(bytes.try_into().unwrap());
        if actual != expected {
            return Err("Recovery data changed or is damaged. Close the Notepad window while keeping its tabs, then scan again.".into());
        }
        Ok(())
    }
}

struct ParsedTab {
    path: Option<String>,
    text: String,
}
fn parse_tab(bytes: &[u8]) -> Result<Option<ParsedTab>, String> {
    let mut r = Reader { bytes, pos: 0 };
    if r.take(2)? != b"NP" {
        return Err("Unsupported Notepad recovery format.".into());
    }
    if r.number()? != 0 {
        return Err("Unsupported Notepad recovery version.".into());
    }
    // CRC starts at TypeFlag, excluding the signature and sequence number.
    let checksum_start = r.pos;
    let kind = r.number()?;
    let path = match kind {
        0 => {
            if r.byte()? != 1 {
                return Err("Unsupported Notepad tab header.".into());
            }
            None
        }
        1 => {
            let len = r.count(32_768)?;
            let path =
                String::from_utf16(&r.units(len)?).map_err(|_| "Invalid Notepad file name.")?;
            r.number()?; // Saved file size; the original file is never opened.
            r.take(2)?; // Encoding and line ending.
            r.number()?; // FILETIME.
            r.take(32)?; // Saved file hash.
            if r.take(2)? != [0, 1] {
                return Err("Unsupported Notepad tab header.".into());
            }
            Some(path)
        }
        _ => return Err("Unsupported Notepad tab format.".into()),
    };
    r.number()?;
    r.number()?; // Selection in UTF-16 units.
    r.take(3)?; // Word wrap / RTL / Unicode controls.
    let options = r.count(1024)?;
    r.take(options)?; // Includes newer Markdown formatting options.
    let len = r.count(MAX_TEXT_UNITS)?;
    let mut text = r.units(len)?;
    if r.byte()? > 1 {
        return Err("Unsupported Notepad unsaved flag.".into());
    }
    r.checksum(checksum_start)?;
    if kind == 1 && text.is_empty() {
        if r.pos == bytes.len() {
            return Ok(None);
        }
        return Err("This saved-file tab needs its original text to replay changes. Save it in Notepad, then use Import files.".into());
    }
    // Replay additions, deletions and replacements in UTF-16 units, not Rust
    // byte offsets or Unicode scalar counts (emoji occupy two units).
    let mut chunks = 0;
    while r.pos < bytes.len() {
        chunks += 1;
        if chunks > 100_000 {
            return Err("Too many pending Notepad edits. Close its window while keeping the tabs, then scan again.".into());
        }
        let start = r.pos;
        let at = r.count(MAX_TEXT_UNITS)?;
        let deleted = r.count(MAX_TEXT_UNITS)?;
        let added = r.count(MAX_TEXT_UNITS)?;
        let insertion = r.units(added)?;
        r.checksum(start)?;
        let end = at.checked_add(deleted).ok_or("Invalid Notepad edit.")?;
        if at > text.len() || end > text.len() || text.len() - deleted + added > MAX_TEXT_UNITS {
            return Err("Notepad changes cannot be safely replayed. Close its window while keeping the tabs, then scan again.".into());
        }
        text.splice(at..end, insertion);
    }
    let text = String::from_utf16(&text)
        .map_err(|_| "Notepad recovery contains incomplete Unicode text.")?;
    Ok(Some(ParsedTab { path, text }))
}

fn tab_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name.strip_suffix(".bin")?;
    // *.0.bin and *.1.bin are cursor/settings sidecars, never extra notes.
    if stem.len() != 36 || uuid::Uuid::parse_str(stem).is_err() {
        return None;
    }
    Some(stem.to_owned())
}

fn scan_directory(root: &Path) -> Result<ScanResult, String> {
    let mut result = ScanResult::default();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(_) => return Err("Notepad recovery storage could not be read. Check Windows file permissions and try again.".into()),
    };
    result.found = true;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| "Notepad recovery storage could not be listed.")?;
        if tab_id(&entry.path()).is_some() {
            if files.len() == MAX_TABS {
                result.skipped.push("Recovery storage exceeds 1,000 tabs. Save remaining tabs as text files and use Import files.".into());
                break;
            }
            files.push(entry.path());
        }
    }
    files.sort();
    let mut total = 0;
    for path in files {
        let id = tab_id(&path).unwrap();
        let parsed = (|| -> Result<Option<ParsedTab>, String> {
            let metadata = fs::symlink_metadata(&path)
                .map_err(|_| "Recovery file is unavailable. Scan again.")?;
            if !metadata.is_file() {
                return Err("Recovery entry is not a regular file.".into());
            }
            if metadata.len() > MAX_FILE_BYTES as u64 {
                return Err("Recovery file exceeds 16 MiB. Save this tab as a text file and use Import files.".into());
            }
            let mut file = fs::File::open(&path).map_err(|_| "Recovery file is locked or unreadable. Close the Notepad window while keeping its tabs, then scan again.")?;
            let before = file
                .metadata()
                .map_err(|_| "Could not read recovery metadata.")?;
            let mut bytes = Vec::new();
            (&mut file)
                .take((MAX_FILE_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read recovery data.")?;
            let after = file
                .metadata()
                .map_err(|_| "Could not read recovery metadata.")?;
            if bytes.len() > MAX_FILE_BYTES
                || before.len() != after.len()
                || before.modified().ok() != after.modified().ok()
            {
                return Err("Recovery data changed during scanning. Scan again after Notepad finishes writing.".into());
            }
            parse_tab(&bytes)
        })();
        match parsed {
            Ok(None) => result.saved_tabs += 1,
            Ok(Some(tab)) if tab.text.trim().is_empty() => result.empty_tabs += 1,
            Ok(Some(tab)) => {
                if total + tab.text.len() > MAX_BATCH_BYTES {
                    result.skipped.push(format!("Tab {id}: Batch exceeds 32 MiB of text. Save this tab as a text file and use Import files."));
                    continue;
                }
                total += tab.text.len();
                let title = tab
                    .path
                    .as_deref()
                    .and_then(|p| p.rsplit(['\\', '/']).next())
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| {
                        tab.text
                            .lines()
                            .find(|line| !line.trim().is_empty())
                            .unwrap_or("Untitled")
                            .trim()
                            .chars()
                            .take(80)
                            .collect()
                    });
                result.tabs.push(RecoveredTab {
                    id,
                    title,
                    text: tab.text,
                });
            }
            Err(e) => result.skipped.push(format!("Tab {id}: {e}")),
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn scan_notepad_tabs() -> Result<ScanResult, String> {
    if !cfg!(windows) {
        return Err("Direct Notepad import is available in the Windows app.".into());
    }
    let local = std::env::var_os("LOCALAPPDATA").ok_or("Windows local app data is unavailable.")?;
    let root = Path::new(&local)
        .join("Packages/Microsoft.WindowsNotepad_8wekyb3d8bbwe/LocalState/TabState");
    tauri::async_runtime::spawn_blocking(move || scan_directory(&root))
        .await
        .map_err(|_| "Notepad scan could not finish.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn number(out: &mut Vec<u8>, mut n: usize) {
        loop {
            let mut b = (n & 127) as u8;
            n >>= 7;
            if n != 0 {
                b |= 128;
            }
            out.push(b);
            if n == 0 {
                break;
            }
        }
    }
    fn units(out: &mut Vec<u8>, text: &str) {
        out.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
    }
    fn checksum(out: &mut Vec<u8>, start: usize) {
        out.extend(crc32fast::hash(&out[start..]).to_be_bytes());
    }
    fn buffer(text: &str, saved: bool) -> Vec<u8> {
        let mut out = b"NP\0".to_vec();
        out.push(u8::from(saved));
        if saved {
            let path = "C:\\notes\\daily.txt";
            number(&mut out, path.encode_utf16().count());
            units(&mut out, path);
            out.extend([0, 5, 1, 0]);
            out.extend([0; 32]);
            out.extend([0, 1]);
        } else {
            out.push(1);
        }
        out.extend([0, 0, 1, 0, 0, 3, 1, 1, 2]);
        number(&mut out, text.encode_utf16().count());
        units(&mut out, text);
        out.push(1);
        checksum(&mut out, 3);
        out
    }
    fn edit(out: &mut Vec<u8>, at: usize, deleted: usize, text: &str) {
        let start = out.len();
        number(out, at);
        number(out, deleted);
        number(out, text.encode_utf16().count());
        units(out, text);
        checksum(out, start);
    }
    #[test]
    fn reads_plain_and_formatted_buffers_without_losing_unicode_or_whitespace() {
        for text in ["  line\r\n\r\n日本語 😀\t", "# Heading\n- item", ""] {
            assert_eq!(parse_tab(&buffer(text, false)).unwrap().unwrap().text, text);
        }
    }
    #[test]
    fn replays_replacement_and_deletion_in_utf16_units() {
        let mut bytes = buffer("A😀B", false);
        edit(&mut bytes, 1, 2, "日本語");
        edit(&mut bytes, 4, 1, "");
        edit(&mut bytes, 4, 0, "!");
        assert_eq!(parse_tab(&bytes).unwrap().unwrap().text, "A日本語!");
    }
    #[test]
    fn skips_saved_files_and_recovers_their_unsaved_full_buffers() {
        assert!(parse_tab(&buffer("", true)).unwrap().is_none());
        let tab = parse_tab(&buffer("Draft", true)).unwrap().unwrap();
        assert_eq!(tab.path.as_deref(), Some("C:\\notes\\daily.txt"));
        assert_eq!(tab.text, "Draft");
        let mut missing_base = buffer("", true);
        edit(&mut missing_base, 1, 0, "x");
        assert!(parse_tab(&missing_base).is_err());
    }
    #[test]
    fn rejects_corruption_partial_edits_bad_offsets_and_overflow() {
        let bytes = buffer("keep all", false);
        for len in 0..bytes.len() {
            assert!(parse_tab(&bytes[..len]).is_err());
        }
        let mut bad = bytes.clone();
        bad[5] ^= 1;
        assert!(parse_tab(&bad).is_err());
        let mut partial = bytes.clone();
        edit(&mut partial, 0, 0, "x");
        partial.pop();
        assert!(parse_tab(&partial).is_err());
        let mut offset = bytes.clone();
        edit(&mut offset, 100, 0, "x");
        assert!(parse_tab(&offset).is_err());
        let mut overflow = b"NP".to_vec();
        overflow.extend([255; 11]);
        assert!(parse_tab(&overflow).is_err());
    }
    #[test]
    fn scan_is_read_only_and_ignores_sidecars_with_partial_success() {
        let root =
            std::env::temp_dir().join(format!("scribly-notepad-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let id = uuid::Uuid::new_v4();
        let path = root.join(format!("{id}.bin"));
        let bytes = buffer("Recovered", false);
        fs::write(&path, &bytes).unwrap();
        fs::write(root.join(format!("{id}.0.bin")), b"sidecar").unwrap();
        fs::write(root.join(format!("{}.bin", uuid::Uuid::new_v4())), b"bad").unwrap();
        fs::write(
            root.join(format!("{}.bin", uuid::Uuid::new_v4())),
            buffer("", false),
        )
        .unwrap();
        fs::write(
            root.join(format!("{}.bin", uuid::Uuid::new_v4())),
            buffer("", true),
        )
        .unwrap();
        let result = scan_directory(&root).unwrap();
        assert_eq!(result.tabs.len(), 1);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.empty_tabs, 1);
        assert_eq!(result.saved_tabs, 1);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 5);
        fs::remove_dir_all(&root).unwrap();
        assert!(!scan_directory(&root).unwrap().found);
    }
    #[test]
    #[ignore = "read-only verification against this Windows user's real recovery data"]
    fn reads_local_notepad_recovery_without_printing_note_contents() {
        let local = std::env::var_os("LOCALAPPDATA").unwrap();
        let root = Path::new(&local)
            .join("Packages/Microsoft.WindowsNotepad_8wekyb3d8bbwe/LocalState/TabState");
        let result = scan_directory(&root).unwrap();
        println!(
            "Recovered: {}; skipped: {}; empty: {}; saved: {}",
            result.tabs.len(),
            result.skipped.len(),
            result.empty_tabs,
            result.saved_tabs
        );
        let mut reasons = std::collections::BTreeMap::new();
        for skipped in &result.skipped {
            *reasons
                .entry(
                    skipped
                        .split_once(": ")
                        .map(|(_, reason)| reason)
                        .unwrap_or(skipped),
                )
                .or_insert(0) += 1;
        }
        println!("Unreadable counts by reason: {reasons:?}");
        assert!(result.found);
        assert!(!result.tabs.is_empty());
        assert!(result.skipped.is_empty(), "Some local tabs could not be read; inspect format compatibility without exposing text.");
    }
}

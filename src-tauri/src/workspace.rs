//! Notebook and drawing validation, independent of Tauri and PostgreSQL.
use serde_json::Value;
pub(crate) fn valid_external_link(value: &str) -> bool {
    if value.bytes().any(|byte| byte <= 32 || byte == 127) {
        return false;
    }
    tauri::Url::parse(value)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}
pub(crate) fn valid_internal_link(value: &str) -> bool {
    let Some(value) = value.strip_prefix("#scribly-item/") else {
        return false;
    };
    let mut decoded = Vec::new();
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let (Some(a), Some(b)) = (bytes.next(), bytes.next()) else {
                return false;
            };
            let (Some(a), Some(b)) = ((a as char).to_digit(16), (b as char).to_digit(16)) else {
                return false;
            };
            decoded.push((a * 16 + b) as u8);
        } else {
            decoded.push(byte);
        }
        if decoded.len() > 800 {
            return false;
        }
    }
    String::from_utf8(decoded).is_ok_and(|id| {
        !id.is_empty()
            && id.encode_utf16().count() <= 200
            && !id.chars().any(|ch| ch <= '\u{1f}' || ch == '\u{7f}')
    })
}
pub(crate) fn validate_workspace(doc: &Value) -> Result<(), String> {
    validate_workspace_items(doc, None, None)
}

// Delta saves validate only changed bodies, but navigation references the complete item order.
pub(crate) fn validate_workspace_delta(
    doc: &Value,
    item_ids: &std::collections::HashSet<&str>,
    template_ids: &std::collections::HashSet<&str>,
) -> Result<(), String> {
    validate_workspace_items(doc, Some(item_ids), Some(template_ids))
}

fn validate_workspace_items(
    doc: &Value,
    item_ids: Option<&std::collections::HashSet<&str>>,
    template_ids: Option<&std::collections::HashSet<&str>>,
) -> Result<(), String> {
    if doc.get("schemaVersion").is_some()
        && doc["schemaVersion"] != 2
        && doc["schemaVersion"] != 3
        && doc["schemaVersion"] != 4
        && doc["schemaVersion"] != 5
    {
        return Err("Unsupported notebook format.".into());
    }
    let notes = doc
        .get("notes")
        .and_then(Value::as_array)
        .ok_or("Invalid notebook notes")?;
    let folders = doc
        .get("folders")
        .and_then(Value::as_array)
        .ok_or("Invalid notebook folders")?;
    if !matches!(
        doc.get("theme").and_then(Value::as_str),
        Some("light" | "dark" | "system")
    ) {
        return Err("Invalid appearance setting".into());
    }
    if doc["activeId"].as_str().is_none()
        || (!doc["referenceId"].is_null() && doc["referenceId"].as_str().is_none())
    {
        return Err("Invalid notebook selection.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for folder in folders {
        let id = folder
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Invalid folder ID")?;
        if id.is_empty()
            || !ids.insert(id)
            || folder.get("name").and_then(Value::as_str).is_none()
            || folder
                .get("copyLastNote")
                .is_some_and(|v| v.as_bool().is_none())
        {
            return Err("Invalid or duplicate folder".into());
        }
    }
    let mut note_ids = std::collections::HashSet::new();
    let mut templates = std::collections::HashSet::new();
    for note in notes {
        let id = note
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Invalid note ID")?;
        if id.is_empty() || !note_ids.insert(id) {
            return Err("Duplicate note ID".into());
        }
        for field in ["title", "content", "createdAt", "updatedAt"] {
            if note.get(field).and_then(Value::as_str).is_none() {
                return Err(format!("Invalid note {field}"));
            }
        }
        if note.get("archived").and_then(Value::as_bool).is_none() {
            return Err("Invalid archive state".into());
        }
        if note
            .get("pinned")
            .is_some_and(|value| value.as_bool().is_none())
        {
            return Err("Invalid pinned item.".into());
        }
        if let Some(deleted) = note.get("deletedAt") {
            if doc["schemaVersion"] != 5
                || deleted
                    .as_str()
                    .is_none_or(|s| s.len() != 24 || !s.ends_with('Z') || !s.contains('T'))
            {
                return Err("Invalid Trash item or notebook format.".into());
            }
        }
        if let Some(title) = note.get("autoTitle") {
            let valid_day = title["day"].as_str().is_some_and(|day| {
                day.len() == 10
                    && day.bytes().enumerate().all(|(i, c)| {
                        if i == 4 || i == 7 {
                            c == b'-'
                        } else {
                            c.is_ascii_digit()
                        }
                    })
            });
            if !title.is_object()
                || !valid_day
                || (!title["folderId"].is_null() && title["folderId"].as_str().is_none())
                || title["ordinal"]
                    .as_u64()
                    .is_none_or(|n| n > 9_007_199_254_740_991)
            {
                return Err("Invalid automatic note title.".into());
            }
        }
        if note.get("kind").is_some_and(|v| v.as_str().is_none()) {
            return Err("Unsupported notebook item.".into());
        }
        match note.get("kind").and_then(Value::as_str) {
            Some("board") => validate_board(note.get("board").ok_or("Missing board payload")?)?,
            None | Some("note" | "template") => {
                if note.get("board").is_some() {
                    return Err("A note cannot contain board data.".into());
                }
            }
            _ => return Err("Unsupported notebook item.".into()),
        }
        if note["kind"] == "template" {
            let settings = &note["template"];
            if !settings.is_object()
                || settings["titlePattern"]
                    .as_str()
                    .is_none_or(|text| text.trim().is_empty() || text.chars().count() > 200)
                || settings["resetChecklist"].as_bool().is_none()
                || note["title"]
                    .as_str()
                    .is_none_or(|text| text.trim().is_empty() || text.chars().count() > 200)
                || !note["folderId"].is_null()
                || note["archived"] != false
                || note.get("deletedAt").is_some()
                || note["pinned"] == true
                || note.get("autoTitle").is_some()
            {
                return Err("Invalid note template.".into());
            }
            templates.insert(id);
        } else if note.get("template").is_some() {
            return Err("Only templates can contain template settings.".into());
        }
        match note.get("folderId") {
            Some(Value::Null) => {}
            Some(Value::String(folder)) if ids.contains(folder.as_str()) => {}
            _ => return Err("A note refers to an invalid or missing folder".into()),
        }
    }
    let templates = template_ids.unwrap_or(&templates);
    for folder in folders {
        if folder
            .get("templateId")
            .is_some_and(|value| value.as_str().is_none_or(|id| !templates.contains(id)))
        {
            return Err("A folder refers to a missing note template.".into());
        }
    }
    if doc["activeId"]
        .as_str()
        .is_some_and(|id| templates.contains(id))
        || doc["referenceId"]
            .as_str()
            .is_some_and(|id| templates.contains(id))
    {
        return Err("Templates cannot be selected as live notebook items.".into());
    }
    if let Some(recent) = doc.get("recentIds") {
        let note_ids = item_ids.unwrap_or(&note_ids);
        let recent = recent.as_array().ok_or("Invalid recently opened items.")?;
        let mut opened = std::collections::HashSet::new();
        if recent.len() > 10
            || recent.iter().any(|value| {
                value.as_str().is_none_or(|id| {
                    !note_ids.contains(id) || templates.contains(id) || !opened.insert(id)
                })
            })
        {
            return Err("Invalid recently opened items.".into());
        }
    }
    Ok(())
}

pub(crate) fn validate_board(board: &Value) -> Result<(), String> {
    crate::json_size::measure(board, 20 * 1024 * 1024).map_err(|_| {
        "This drawing exceeds its 20 MiB rendering budget. Split it into separate boards."
            .to_string()
    })?;
    if board["schemaVersion"] != 1
        || board["engine"] != "excalidraw"
        || !matches!(
            board["exportDirection"].as_str(),
            Some("LR" | "RL" | "TB" | "BT")
        )
        || !board["appState"].is_object()
    {
        return Err("Invalid board format.".into());
    }
    if board["appState"]
        .get("viewBackgroundColor")
        .filter(|v| !v.is_null())
        .is_some_and(|v| {
            v.as_str().is_none_or(|s| {
                !s.starts_with('#') || s.len() > 9 || !s[1..].chars().all(|c| c.is_ascii_hexdigit())
            })
        })
        || board["appState"]
            .get("gridSize")
            .filter(|v| !v.is_null())
            .is_some_and(|v| {
                v.as_f64()
                    .is_none_or(|n| !n.is_finite() || !(0.0..=10_000_000.0).contains(&n))
            })
    {
        return Err("Invalid board background or grid.".into());
    }
    let elements = board["elements"]
        .as_array()
        .ok_or("Invalid board elements")?;
    let files = board["files"]
        .as_object()
        .ok_or("Invalid board image files")?;
    if elements.len() > 20_000
        || elements.iter().filter(|e| e["isDeleted"] != true).count() > 2500
        || files.len() > 2500
    {
        return Err("A board can contain up to 2,500 active elements.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for e in elements {
        let id = e["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 800)
            .ok_or("Invalid board element ID")?;
        if !ids.insert(id)
            || !matches!(
                e["type"].as_str(),
                Some(
                    "rectangle"
                        | "diamond"
                        | "ellipse"
                        | "arrow"
                        | "line"
                        | "text"
                        | "freedraw"
                        | "image"
                        | "frame"
                )
            )
            || e["isDeleted"].as_bool().is_none()
        {
            return Err("Invalid or duplicate board element.".into());
        }
        for key in ["x", "y", "width", "height"] {
            let n = e[key].as_f64().ok_or("Invalid board geometry")?;
            if !n.is_finite()
                || n.abs() > 10_000_000.0
                || (matches!(key, "width" | "height") && n < 0.0)
            {
                return Err("Invalid board geometry.".into());
            }
        }
        for key in ["name", "originalText", "containerId"] {
            if e.get(key)
                .filter(|v| !v.is_null())
                .is_some_and(|v| v.as_str().is_none())
            {
                return Err("Invalid board label or binding.".into());
            }
        }
        if e.get("customData")
            .filter(|v| !v.is_null())
            .is_some_and(|v| !v.is_object())
        {
            return Err("Invalid board custom data.".into());
        }
        for key in [
            "angle",
            "fontSize",
            "lineHeight",
            "strokeWidth",
            "roughness",
            "opacity",
            "version",
            "versionNonce",
            "seed",
        ] {
            if e.get(key)
                .is_some_and(|v| v.as_f64().is_none_or(|n| !n.is_finite()))
            {
                return Err("Invalid board appearance or version.".into());
            }
        }
        if e.get("groupIds").is_some_and(|v| {
            v.as_array().is_none_or(|ids| {
                ids.iter()
                    .any(|id| id.as_str().is_none_or(|s| s.is_empty() || s.len() > 800))
            })
        }) || e
            .get("boundElements")
            .filter(|v| !v.is_null())
            .is_some_and(|v| {
                v.as_array().is_none_or(|bindings| {
                    bindings.iter().any(|b| {
                        b["id"].as_str().is_none_or(|s| s.is_empty())
                            || !matches!(b["type"].as_str(), Some("text" | "arrow"))
                    })
                })
            })
        {
            return Err("Invalid board grouping or bound elements.".into());
        }
        if let Some(link) = e.get("link").filter(|v| !v.is_null()) {
            let text = link.as_str().ok_or("Invalid board link")?;
            if !valid_internal_link(text) && !valid_external_link(text) {
                return Err("Board links must target a Scribly item or use http/https.".into());
            }
        }
        if e["type"] == "text"
            && e["text"]
                .as_str()
                .is_none_or(|s| s.chars().count() > 50_000)
        {
            return Err("Invalid board text.".into());
        }
        if matches!(e["type"].as_str(), Some("arrow" | "line" | "freedraw")) {
            let points = e["points"].as_array().ok_or("Invalid drawing points")?;
            if points.len() > 20_000
                || points.iter().any(|p| {
                    p.as_array().is_none_or(|a| {
                        a.len() != 2
                            || a.iter().any(|v| {
                                v.as_f64()
                                    .is_none_or(|n| !n.is_finite() || n.abs() > 10_000_000.0)
                            })
                    })
                })
            {
                return Err("Invalid drawing points.".into());
            }
        }
        for key in ["startBinding", "endBinding"] {
            if let Some(b) = e.get(key).filter(|v| !v.is_null()) {
                if b["elementId"].as_str().is_none_or(|s| s.is_empty()) {
                    return Err("Invalid connector binding.".into());
                }
            }
        }
        if let Some(tag) = e
            .get("customData")
            .and_then(|v| v.get("notifyArchitecture"))
        {
            if tag["version"] != 1
                || !matches!(
                    tag["role"].as_str(),
                    Some("component" | "boundary" | "annotation")
                )
                || tag
                    .get("parentId")
                    .is_some_and(|v| v.as_str().is_none_or(|s| s.is_empty()))
            {
                return Err("Invalid architecture metadata.".into());
            }
        }
        if e["type"] == "image" && e["isDeleted"] == false {
            let file_id = e["fileId"].as_str().ok_or("Missing board image ID")?;
            if !files.contains_key(file_id) {
                return Err("Missing board image file.".into());
            }
        }
    }
    for (key, file) in files {
        let data = file["dataURL"].as_str().ok_or("Missing image data")?;
        let mime = file["mimeType"].as_str().ok_or("Missing image type")?;
        if file["id"] != key.as_str()
            || data.len() > 7_000_000
            || !matches!(
                mime,
                "image/png" | "image/jpeg" | "image/webp" | "image/gif"
            )
            || !data.starts_with(&format!("data:{mime};base64,"))
        {
            return Err("Use local PNG, JPEG, WebP or GIF images up to 5 MB.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod navigation_tests {
    use super::validate_workspace;
    use serde_json::json;
    #[test]
    fn item_links_and_template_defaults_reject_malformed_or_dangling_metadata() {
        assert!(super::valid_internal_link("#scribly-item/n"));
        assert!(super::valid_internal_link(
            "#scribly-item/%E6%97%A5%E6%9C%AC"
        ));
        for value in [
            "#scribly-item/",
            "#scribly-item/%zz",
            "#scribly-item/%00",
            "javascript:alert(1)",
            "file:///secret",
        ] {
            assert!(!super::valid_internal_link(value));
            assert!(!super::valid_external_link(value));
        }
        assert!(super::valid_external_link(
            "https://example.com/path?q=a&b=c"
        ));
        assert!(!super::valid_external_link("https://example.com/\n"));
        let doc = json!({"schemaVersion":5,"theme":"light","folders":[{"id":"f","name":"Work","templateId":"t"}],"activeId":"n","referenceId":null,"notes":[{"id":"n","title":"Note","content":"<p>Body</p>","createdAt":"x","updatedAt":"x","archived":false,"folderId":"f"},{"id":"t","title":"Daily","kind":"template","template":{"titlePattern":"{{title}} {{date}}","resetChecklist":true},"content":"<p>Template</p>","folderId":null,"archived":false,"createdAt":"x","updatedAt":"x"}]});
        assert!(validate_workspace(&doc).is_ok());
        for invalid in ["missing", "n"] {
            let mut bad = doc.clone();
            bad["folders"][0]["templateId"] = json!(invalid);
            assert!(validate_workspace(&bad).is_err());
        }
        let mut bad = doc.clone();
        bad["notes"][1]["template"]["resetChecklist"] = json!("yes");
        assert!(validate_workspace(&bad).is_err());
        let mut bad = doc.clone();
        bad["activeId"] = json!("t");
        assert!(validate_workspace(&bad).is_err());
        let mut bad = doc;
        bad["recentIds"] = json!(["t"]);
        assert!(validate_workspace(&bad).is_err());
    }
    #[test]
    fn navigation_metadata_is_optional_bounded_and_references_real_items() {
        let mut doc = json!({"schemaVersion":5,"theme":"light","folders":[],"activeId":"n","referenceId":null,"notes":[{"id":"n","title":"Note","content":"<p>Body</p>","createdAt":"x","updatedAt":"x","archived":false,"folderId":null}]});
        assert!(validate_workspace(&doc).is_ok());
        doc["notes"][0]["pinned"] = json!(true);
        doc["recentIds"] = json!(["n"]);
        assert!(validate_workspace(&doc).is_ok());
        doc["notes"][0]["pinned"] = json!("true");
        assert!(validate_workspace(&doc).is_err());
        doc["notes"][0]["pinned"] = json!(true);
        for recent in [
            json!(["missing"]),
            json!(["n", "n"]),
            json!([false]),
            json!("n"),
            json!(vec!["n"; 11]),
        ] {
            doc["recentIds"] = recent;
            assert!(validate_workspace(&doc).is_err());
        }
    }
}

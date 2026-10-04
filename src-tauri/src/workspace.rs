//! Notebook and drawing validation, independent of Tauri and PostgreSQL.
use serde_json::Value;
pub(crate) fn validate_workspace(doc: &Value) -> Result<usize, String> {
    if doc.get("schemaVersion").is_some() && doc["schemaVersion"] != 2 && doc["schemaVersion"] != 3
    {
        return Err("Unsupported notebook format.".into());
    }
    let bytes = crate::json_size::measure(doc, 20 * 1024 * 1024)
        .map_err(|e| format!("Notebook exceeds the 20 MB limit or could not be validated: {e}"))?;
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
            None | Some("note") => {
                if note.get("board").is_some() {
                    return Err("A note cannot contain board data.".into());
                }
            }
            _ => return Err("Unsupported notebook item.".into()),
        }
        match note.get("folderId") {
            Some(Value::Null) => {}
            Some(Value::String(folder)) if ids.contains(folder.as_str()) => {}
            _ => return Err("A note refers to an invalid or missing folder".into()),
        }
    }
    Ok(bytes)
}
pub(crate) fn validate_board(board: &Value) -> Result<(), String> {
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
            let text = link
                .as_str()
                .ok_or("Invalid board link")?
                .to_ascii_lowercase();
            if !text.starts_with("http://") && !text.starts_with("https://") {
                return Err("Board links must use http or https.".into());
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

//! Isolated, real-runtime checks used by release verification.
#[cfg(test)]
use crate::workspace::validate_board;
use crate::{attachments, database::Database};
use serde_json::{json, Value};
use std::path::PathBuf;
// Exercise the actual packaged PostgreSQL runtime, persistence and conflict guard.
pub fn database_self_test(root: PathBuf, runtime: PathBuf) -> Result<Value, String> {
    // Never replace a user's notebook when a diagnostic path is supplied.
    if root.exists()
        && std::fs::read_dir(&root)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err("Database diagnostics require an empty, isolated profile directory.".into());
    }
    let mut doc = json!({"folders":[{"id":"f","name":"Test folder"}],"notes":[{"id":"n","folderId":"f","title":"Unicode persistence 日本語","content":"<p>Saved across restarts ✓</p><pre><code class=\"language-rust\">fn main() {\n  println!(\"Preserved 日本語 ✓\");\n}</code></pre>","createdAt":"2026-10-02T00:00:00Z","updatedAt":"2026-10-02T00:00:00Z","archived":false}],"theme":"dark","activeId":"n","referenceId":null,"appearance":{"elementSize":"small","textScale":125,"font":"caveat"}});
    // Authored semantic colors must survive the same save/restart path as prose.
    let original_content = format!("{}<p><span data-text-color=\"purple\" data-background-color=\"yellow\">Colored 日本語 ✓</span></p>", doc["notes"][0]["content"].as_str().unwrap());
    let ink = json!([{"color":"yellow","points":[[0.1,0.0],[0.5,1.0]]}])
        .to_string()
        .replace('"', "&quot;");
    let original_content =
        format!("{original_content}<p data-note-ink=\"{ink}\">Marker 日本語 ✓</p>");
    doc["notes"][0]["content"] = Value::String(format!("{original_content}<figure data-notify-image=\"\" data-width=\"65\" data-align=\"right\"><img src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=\" alt=\"Image 日本語\"><figcaption>Persisted caption ✓</figcaption></figure>"));
    doc["schemaVersion"] = json!(2);
    doc["notes"].as_array_mut().unwrap().push(json!({"id":"board","folderId":"f","title":"Architecture 日本語","content":"","kind":"board","archived":false,"createdAt":"2026-10-03T00:00:00Z","updatedAt":"2026-10-03T00:00:00Z","board":board_test_fixture()}));
    doc["referenceId"] = json!("board");
    let revision;
    {
        let mut db = Database::open(root.clone(), runtime.clone())?;
        let loaded = db.load()?;
        let pixel = attachments::store(&root, b"\x89PNG attachment diagnostic")?;
        let image_id = pixel["id"].as_str().ok_or("Missing attachment ID")?;
        doc["schemaVersion"] = json!(3);
        doc["notes"][0]["content"] = json!(format!("{}<figure data-notify-image=\"\"><img data-notify-attachment=\"{image_id}\" alt=\"Stored image\"></figure>", doc["notes"][0]["content"].as_str().unwrap()));
        if attachments::read(&root, image_id)? != b"\x89PNG attachment diagnostic" {
            return Err("Attachment round trip failed".into());
        }
        let first = db.save(doc.clone(), loaded["revision"].as_i64().unwrap())?;
        let mut metadata = doc.clone();
        metadata.as_object_mut().unwrap().remove("notes");
        let order = doc["notes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].clone())
            .collect::<Vec<_>>();
        revision = db.save_delta(
            json!({"metadata":metadata,"order":order,"changed":[]}),
            first,
        )?;
        if db.save(doc.clone(), revision - 1).is_ok() {
            return Err("Conflict guard failed".into());
        }
    }
    {
        let mut db = Database::open(root.clone(), runtime)?;
        let loaded = db.load()?;
        doc["schemaVersion"] = json!(5);
        if loaded["document"] != doc || loaded["revision"] != revision {
            return Err("Persistence across restarts failed".into());
        }
    }
    Ok(
        json!({"ok":true,"postgres":true,"unicodeRoundTrip":true,"restartPersistence":true,"appearancePersistence":true,"codeBlockPersistence":true,"imagePersistence":true,"boardPersistence":true,"boardImagePersistence":true,"architectureMetadataPersistence":true,"nestedArchitectureMetadataPersistence":true,"boardReferencePersistence":true,"staleRevisionRejected":true,"attachmentPersistence":true,"deltaPersistence":true,"revision":revision,"dataPath":root}),
    )
}
pub(crate) fn board_test_fixture() -> Value {
    json!({"schemaVersion":1,"engine":"excalidraw","exportDirection":"LR","appState":{"viewBackgroundColor":"#ffffff"},"elements":[
        {"id":"component","type":"rectangle","x":10,"y":20,"width":100,"height":80,"isDeleted":false,"customData":{"notifyArchitecture":{"version":1,"role":"component","parentId":"server"}}},
        {"id":"server","type":"rectangle","x":0,"y":0,"width":300,"height":200,"isDeleted":false,"customData":{"notifyArchitecture":{"version":1,"role":"boundary","parentId":"region"}}},
        {"id":"region","type":"rectangle","x":0,"y":0,"width":400,"height":300,"isDeleted":false,"customData":{"notifyArchitecture":{"version":1,"role":"boundary"}}},
        {"id":"image","type":"image","x":20,"y":20,"width":40,"height":40,"isDeleted":false,"fileId":"pixel"}],
        "files":{"pixel":{"id":"pixel","mimeType":"image/png","dataURL":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAV8AAAAASUVORK5CYII=","created":1}}})
}
#[cfg(test)]
mod board_tests {
    use super::*;
    #[test]
    fn valid_board_retains_images_and_semantics() {
        assert!(validate_board(&board_test_fixture()).is_ok());
    }
    #[test]
    fn malformed_labels_and_rendering_metadata_are_rejected() {
        for (key, value) in [
            ("name", json!(42)),
            ("originalText", json!([])),
            ("angle", json!("wrong")),
            ("groupIds", json!([42])),
            ("boundElements", json!([{"id":"label","type":"image"}])),
        ] {
            let mut board = board_test_fixture();
            board["elements"][0][key] = value;
            assert!(validate_board(&board).is_err(), "accepted invalid {key}");
        }
    }
    #[test]
    fn future_missing_image_and_executable_elements_are_rejected() {
        let mut board = board_test_fixture();
        board["schemaVersion"] = json!(9);
        assert!(validate_board(&board).is_err());
        board = board_test_fixture();
        board["files"] = json!({});
        assert!(validate_board(&board).is_err());
        board = board_test_fixture();
        board["elements"][0]["type"] = json!("embeddable");
        assert!(validate_board(&board).is_err());
        board = board_test_fixture();
        board["elements"][0]["link"] = json!("javascript:alert(1)");
        assert!(validate_board(&board).is_err());
    }
}

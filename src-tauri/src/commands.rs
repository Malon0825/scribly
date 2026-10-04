//! Thin IPC adapters; blocking database and file work stays off the UI thread.
use crate::{
    attachments,
    database::{Database, DatabaseState},
    files, StartupTiming,
};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

// A fixed destination avoids exposing a general URL or shell launcher over IPC.
#[tauri::command]
pub(crate) async fn open_releases() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg("https://github.com/Malon0825/scribly/releases/latest")
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    Err("Open https://github.com/Malon0825/scribly/releases/latest in your browser.".into())
}
fn runtime_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("postgres");
    if bundled.join("bin/postgres.exe").exists() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres");
        if dev.exists() {
            return Ok(dev);
        }
    }
    Ok(bundled)
}
#[tauri::command]
pub(crate) async fn load_workspace(app: tauri::AppHandle) -> Result<Value, String> {
    open_workspace(app, true).await
}
// Warm the database without reading/decoding the notebook twice at startup.
pub(crate) async fn open_workspace(
    app: tauri::AppHandle,
    read_document: bool,
) -> Result<Value, String> {
    let runtime = runtime_path(&app)?;
    let root = app
        .state::<StartupTiming>()
        .benchmark_root
        .clone()
        .unwrap_or(app.path().app_local_data_dir().map_err(|e| e.to_string())?);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            match Database::open(root.clone(), runtime.clone()) {
                Ok(db) => {
                    *guard = Some(db);
                    let timing = app.state::<StartupTiming>();
                    *timing.database_ready_ms.lock().map_err(|e| e.to_string())? =
                        Some(timing.started.elapsed().as_millis());
                    let _ = fs::remove_file(root.join("startup-error.log"));
                }
                Err(error) => {
                    let _ = fs::write(
                        root.join("startup-error.log"),
                        format!(
                            "{error}\nRuntime: {}\nData: {}\n",
                            runtime.display(),
                            root.display()
                        ),
                    );
                    return Err(error);
                }
            }
        }
        let directory = attachments::directory(&root)?;
        app.asset_protocol_scope()
            .allow_directory(directory, false)
            .map_err(|e| e.to_string())?;
        if read_document {
            guard
                .as_mut()
                .ok_or("The notebook database has not opened yet")?
                .load()
        } else {
            Ok(Value::Null)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn save_workspace(
    app: tauri::AppHandle,
    document: Value,
    revision: i64,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard
            .as_mut()
            .ok_or("The notebook database has not opened yet")?
            .save(document, revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn save_workspace_delta(
    app: tauri::AppHandle,
    delta: Value,
    revision: i64,
) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard
            .as_mut()
            .ok_or("The notebook database has not opened yet")?
            .save_delta(delta, revision)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn store_attachment(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Image upload requires binary data.".into());
    };
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("Image exceeds 5 MB.".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = attachment_root(&app)?;
        attachments::store(&root, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn read_attachment(
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = attachment_root(&app)?;
        attachments::read(&root, &id).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn export_attachment(
    app: tauri::AppHandle,
    id: String,
    file_name: String,
) -> Result<Option<String>, String> {
    let handle = app.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let root = attachment_root(&handle)?;
        attachments::read(&root, &id)
    })
    .await
    .map_err(|e| e.to_string())??;
    export_file(app, file_name, String::new(), Some(bytes)).await
}
#[tauri::command]
pub(crate) async fn prune_attachments(
    app: tauri::AppHandle,
    keep: Vec<String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DatabaseState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        let db = guard
            .as_mut()
            .ok_or("The notebook database has not opened yet")?;
        // Keep the save lock through reclamation: a concurrent save must not
        // introduce a reference between the retained snapshot and deletion.
        let saved = db.load()?;
        let mut retain: std::collections::HashSet<String> = if saved["document"].is_null() {
            Default::default()
        } else {
            attachments::references(&saved["document"])?
                .into_iter()
                .collect()
        };
        retain.extend(keep);
        attachments::prune(&db.root, &retain)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn export_file(
    app: tauri::AppHandle,
    file_name: String,
    data: String,
    binary_data: Option<Vec<u8>>,
) -> Result<Option<String>, String> {
    if binary_data
        .as_ref()
        .is_some_and(|bytes| bytes.len() > 20 * 1024 * 1024)
    {
        return Err("Image export exceeds 20 MB.".into());
    }
    if data.len() > 32 * 1024 * 1024 {
        return Err("Text export exceeds 32 MB.".into());
    }
    let bytes = binary_data.unwrap_or_else(|| data.into_bytes());
    write_export(app, file_name, bytes).await
}

#[tauri::command]
pub(crate) async fn export_binary_file(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Image export requires binary data.".into());
    };
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Image export exceeds 20 MB.".into());
    }
    let header = request
        .headers()
        .get("X-Scribly-Export-Name")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing export filename.")?;
    let file_name = export_name(header)?;
    write_export(app, file_name, bytes.clone()).await
}

fn export_name(header: &str) -> Result<String, String> {
    if header.len() > 4096 {
        return Err("Export filename is too long.".into());
    }
    let name: String =
        serde_json::from_str(header).map_err(|e| format!("Invalid export filename: {e}"))?;
    if name.is_empty() || name.contains('\0') {
        return Err("Invalid export filename.".into());
    }
    Ok(name)
}

async fn write_export(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_file_name(&file_name)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        files::replace(&path, &bytes).map_err(|e| {
            format!("Export could not be saved. The previous file was retained: {e}")
        })?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn attachment_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<DatabaseState>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard
        .as_ref()
        .ok_or("The notebook database has not opened yet")?
        .root
        .clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binary_export_filename_header_preserves_unicode_and_rejects_malformed_values() {
        assert_eq!(
            export_name(r#""\u65e5\u672c\u8a9e \ud83d\ude00.png""#).unwrap(),
            "日本語 😀.png"
        );
        for header in [
            "null",
            "[]",
            "not JSON",
            r#""""#,
            r#""bad\u0000.png""#,
            r#""\ud800.png""#,
        ] {
            assert!(export_name(header).is_err());
        }
        assert!(export_name(&"x".repeat(4097)).is_err());
    }
}

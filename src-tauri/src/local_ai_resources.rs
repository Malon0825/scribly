//! Machine-specific calibration is separate from private notebook backups.
use crate::{
    meeting_ollama::{self, Model},
    meetings,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Calibration {
    pub digest: String,
    pub additional_bytes: u64,
    pub reserve_bytes: u64,
    pub measured_at: u64,
}
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("local-ai/headroom.json"))
}
pub(crate) fn read(app: &tauri::AppHandle) -> Option<Calibration> {
    serde_json::from_slice(&crate::files::read_bounded(&path(app).ok()?, 4096).ok()?).ok()
}
#[cfg(windows)]
pub(crate) fn memory() -> Result<(u64, u64), String> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return Err("Available Windows memory could not be measured".into());
    }
    Ok((status.ullAvailPhys, status.ullTotalPhys))
}
#[cfg(not(windows))]
pub(crate) fn memory() -> Result<(u64, u64), String> {
    Err("Local resource calibration requires Windows".into())
}
pub(crate) async fn resident(endpoint: &str, model: &str) -> Result<bool, String> {
    let (client, base) = meeting_ollama::client(endpoint)?;
    let value = meeting_ollama::bounded(
        client
            .get(base.join("api/ps").map_err(|e| e.to_string())?)
            .send()
            .await
            .map_err(|_| "Ollama memory status is unavailable")?,
        512_000,
    )
    .await?;
    Ok(value["models"].as_array().is_some_and(|models| {
        models
            .iter()
            .any(|m| m["name"] == model || m["model"] == model)
    }))
}
pub(crate) async fn wait(
    app: &tauri::AppHandle,
    endpoint: &str,
    model: &Model,
    scope: &str,
    kind: &str,
) -> Result<(), String> {
    let Some(calibration) = read(app).filter(|c| c.digest == model.digest) else {
        return Ok(());
    };
    loop {
        let needed = calibration.reserve_bytes
            + if resident(endpoint, &model.id).await? {
                0
            } else {
                calibration.additional_bytes
            };
        if memory()?.0 >= needed {
            return Ok(());
        }
        let _=app.emit("meeting-analysis-stream",json!({"id":scope,"kind":kind,"texts":[],"part":0,"parts":0,"done":false,"message":"Waiting for available memory; close other applications or cancel"}));
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
pub(crate) fn store(
    app: &tauri::AppHandle,
    model: &Model,
    before: u64,
    lowest: u64,
    total: u64,
) -> Result<Calibration, String> {
    let previous = read(app).filter(|c| c.digest == model.digest);
    let additional = before
        .saturating_sub(lowest)
        .max(previous.map_or(0, |c| c.additional_bytes));
    // Policy margin around an observed cold-load peak, not a model-size estimate.
    let calibration = Calibration {
        digest: model.digest.clone(),
        additional_bytes: additional,
        reserve_bytes: total / 20 + additional / 4,
        measured_at: meetings::now(),
    };
    let path = path(app)?;
    std::fs::create_dir_all(path.parent().ok_or("Missing calibration directory")?)
        .map_err(|e| e.to_string())?;
    crate::files::replace(
        &path,
        &serde_json::to_vec(&calibration).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(calibration)
}

//! Explicit, user-started setup of the optional Ollama/Gemma runtime.
use crate::{meeting_auth, meeting_ollama, meetings::MeetingState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const MODEL: &str = "gemma4:e4b";
const FRAME_LIMIT: usize = 65_536;
const STOPPED: &str = "Setup stopped. Retry to continue the model download.";

#[derive(Clone, Default, Serialize)]
pub(crate) struct Progress {
    running: bool,
    message: String,
    completed: Option<u64>,
    total: Option<u64>,
}
#[derive(Default)]
pub(crate) struct SetupState(Mutex<(Progress, Option<CancellationToken>)>);

fn progress(app: &tauri::AppHandle, message: &str, completed: Option<u64>, total: Option<u64>) {
    let value = Progress {
        running: true,
        message: message.into(),
        completed,
        total,
    };
    if let Ok(mut state) = app.state::<SetupState>().0.lock() {
        state.0 = value.clone();
    }
    let _ = app.emit("local-model-setup", value);
}

fn canceled(cancel: &CancellationToken) -> Result<(), String> {
    if cancel.is_cancelled() {
        Err(STOPPED.into())
    } else {
        Ok(())
    }
}

fn transfer_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(90))
        .timeout(Duration::from_secs(7200))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "ollama.com"
                            | "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn service_ready(endpoint: &str) -> bool {
    let Ok((_, base)) = meeting_ollama::client(endpoint) else {
        return false;
    };
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return false;
    };
    let Ok(url) = base.join("api/version") else {
        return false;
    };
    match client.get(url).send().await {
        Ok(response) => meeting_ollama::bounded(response, 4096)
            .await
            .is_ok_and(|value| value["version"].is_string()),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn installed_cli() -> Option<PathBuf> {
    let standard = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("Programs/Ollama/ollama.exe"));
    standard.filter(|p| p.is_file()).or_else(|| {
        std::env::var_os("PATH").and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|p| p.join("ollama.exe"))
                .find(|p| p.is_file())
        })
    })
}

struct Installer(PathBuf);
impl Drop for Installer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(windows)]
async fn install_runtime(
    app: &tauri::AppHandle,
    cancel: &CancellationToken,
) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("local-ai/setup");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|e| e.to_string())?;
    let installer = Installer(directory.join(format!("OllamaSetup-{}.exe", uuid::Uuid::new_v4())));
    progress(app, "Downloading Ollama", None, None);
    let download = async {
        let mut response = transfer_client()?
            .get("https://ollama.com/download/OllamaSetup.exe")
            .send()
            .await
            .map_err(|_| "Could not download Ollama. Check your connection and retry.")?;
        if !response.status().is_success() {
            return Err("The Ollama installer download was rejected.".into());
        }
        let total = response.content_length();
        let mut file = tokio::fs::File::create(&installer.0)
            .await
            .map_err(|e| e.to_string())?;
        let mut completed = 0;
        let mut last = std::time::Instant::now();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Ollama download interrupted. Retry setup.")?
        {
            completed += chunk.len() as u64;
            if completed > 4 * 1024 * 1024 * 1024 {
                return Err("Unexpected Ollama installer size.".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Cannot save Ollama installer: {e}"))?;
            if last.elapsed() >= Duration::from_millis(250) {
                progress(app, "Downloading Ollama", Some(completed), total);
                last = std::time::Instant::now();
            }
        }
        if completed == 0 || total.is_some_and(|total| completed != total) {
            return Err("Incomplete Ollama installer. Retry setup.".into());
        }
        file.sync_all().await.map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    };
    tokio::select! { _ = cancel.cancelled() => return Err(STOPPED.into()), result = download => result? }
    progress(app, "Verifying the Ollama installer publisher", None, None);
    let powershell = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or("Windows system directory is unavailable")?
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    // The path travels as an environment value, never interpolated shell code.
    let mut verify = tokio::process::Command::new(powershell);
    verify.args(["-NoProfile", "-NonInteractive", "-Command",
        "$s=Get-AuthenticodeSignature -LiteralPath $env:SCRIBLY_OLLAMA_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ne 'Ollama Inc.'){exit 1}"])
        .env("SCRIBLY_OLLAMA_INSTALLER", &installer.0).creation_flags(0x08000000)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
    let verified = tokio::select! { _ = cancel.cancelled() => return Err(STOPPED.into()), result = verify.status() => result.map_err(|e| e.to_string())? };
    if !verified.success() {
        return Err(
            "Ollama installer signature or publisher verification failed. Nothing was installed."
                .into(),
        );
    }
    canceled(cancel)?;
    progress(
        app,
        "Installing Ollama · Stop takes effect after this step",
        None,
        None,
    );
    // Let the installer finish atomically even if Stop is requested while it runs.
    let installed = tokio::process::Command::new(&installer.0)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("Could not start the Ollama installer: {e}"))?;
    if !installed.success() && installed.code() != Some(3010) {
        return Err(
            "Ollama installation did not finish. Retry or install Ollama from ollama.com.".into(),
        );
    }
    canceled(cancel)?;
    installed_cli().ok_or(
        "Ollama installed but its executable could not be found. Restart Scribly and retry.".into(),
    )
}

async fn ensure_service(
    app: &tauri::AppHandle,
    endpoint: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    if service_ready(endpoint).await {
        return Ok(());
    }
    if endpoint.trim_end_matches('/') != "http://127.0.0.1:11434" {
        return Err("Start Ollama at your saved address, or use http://127.0.0.1:11434 for automatic runtime setup.".into());
    }
    #[cfg(windows)]
    {
        let cli = match installed_cli() {
            Some(cli) => cli,
            None => install_runtime(app, cancel).await?,
        };
        canceled(cancel)?;
        if !service_ready(endpoint).await {
            progress(app, "Starting Ollama", None, None);
            // Reuse the user's standard service/model store; never kill or reconfigure it.
            tokio::process::Command::new(cli)
                .arg("serve")
                .env("OLLAMA_HOST", endpoint)
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Could not start Ollama: {e}"))?;
        }
    }
    #[cfg(not(windows))]
    return Err("Install and start Ollama, then retry model setup. Automatic runtime setup is available in the Windows app.".into());
    #[cfg(windows)]
    for _ in 0..60 {
        canceled(cancel)?;
        if service_ready(endpoint).await {
            return Ok(());
        }
        tokio::select! { _ = cancel.cancelled() => return canceled(cancel), _ = tokio::time::sleep(Duration::from_millis(500)) => {} }
    }
    #[cfg(windows)]
    return Err("Ollama did not become ready. Open Ollama, then retry setup.".into());
}

#[derive(Deserialize)]
struct PullFrame {
    status: Option<String>,
    error: Option<String>,
    completed: Option<u64>,
    total: Option<u64>,
}
fn pull_frame(line: &[u8]) -> Result<PullFrame, String> {
    if line.len() > FRAME_LIMIT {
        return Err("Ollama setup progress exceeded its limit.".into());
    }
    let value: PullFrame =
        serde_json::from_slice(line).map_err(|_| "Invalid Ollama setup progress")?;
    if let Some(error) = value.error {
        return Err(format!(
            "Model download failed: {}",
            error.chars().take(500).collect::<String>()
        ));
    }
    if value
        .completed
        .zip(value.total)
        .is_some_and(|(done, total)| done > total)
    {
        return Err("Invalid Ollama download byte counts".into());
    }
    Ok(value)
}

#[derive(Default)]
struct PullStream {
    buffer: Vec<u8>,
    success: bool,
}
impl PullStream {
    fn feed(&mut self, chunk: &[u8], mut report: impl FnMut(PullFrame)) -> Result<(), String> {
        for byte in chunk {
            if *byte == b'\n' {
                if !self.buffer.is_empty() {
                    let frame = pull_frame(&self.buffer)?;
                    self.success |= frame.status.as_deref() == Some("success");
                    report(frame);
                    self.buffer.clear();
                }
            } else {
                if self.buffer.len() >= FRAME_LIMIT {
                    return Err("Ollama setup progress exceeded its limit.".into());
                }
                self.buffer.push(*byte);
            }
        }
        Ok(())
    }
    fn finish(mut self) -> Result<(), String> {
        if !self.buffer.is_empty() {
            self.success |= pull_frame(&self.buffer)?.status.as_deref() == Some("success");
        }
        if !self.success {
            return Err(
                "Gemma download ended before verification completed. Retry to resume.".into(),
            );
        }
        Ok(())
    }
}

async fn pull(
    app: &tauri::AppHandle,
    endpoint: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let (_, base) = meeting_ollama::client(endpoint)?;
    // Same loopback restrictions as inference; longer timeout for a multi-GB pull.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .read_timeout(Duration::from_secs(120))
        .timeout(Duration::from_secs(7200))
        .build()
        .map_err(|e| e.to_string())?;
    let download = async {
        let mut response = client
            .post(base.join("api/pull").map_err(|e| e.to_string())?)
            .json(&json!({"model":MODEL,"stream":true}))
            .send()
            .await
            .map_err(|_| "Could not start Gemma download. Check Ollama and retry.")?;
        if !response.status().is_success() {
            return Err(format!(
                "Ollama model setup returned HTTP {}",
                response.status()
            ));
        }
        let mut stream = PullStream::default();
        let mut last = std::time::Instant::now();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Gemma download interrupted. Retry to resume.")?
        {
            stream.feed(&chunk, |frame| {
                if last.elapsed() >= Duration::from_millis(250)
                    || frame.status.as_deref() == Some("success")
                {
                    progress(
                        app,
                        &format!(
                            "Gemma 4 · {}",
                            frame
                                .status
                                .unwrap_or_else(|| "Downloading".into())
                                .chars()
                                .take(160)
                                .collect::<String>()
                        ),
                        frame.completed,
                        frame.total,
                    );
                    last = std::time::Instant::now();
                }
            })?;
        }
        stream.finish()
    };
    tokio::select! { _ = cancel.cancelled() => canceled(cancel), result = download => result }
}

async fn setup(app: &tauri::AppHandle, cancel: &CancellationToken) -> Result<Value, String> {
    let endpoint = {
        let state = app.state::<MeetingState>();
        let _lock = state.credentials.lock().await;
        meeting_auth::read(app)?.preferences.ollama_endpoint
    };
    meeting_ollama::client(&endpoint)?;
    ensure_service(app, &endpoint, cancel).await?;
    canceled(cancel)?;
    let catalog = tokio::select! {
        _ = cancel.cancelled() => return Err(STOPPED.into()),
        result = meeting_ollama::models(&endpoint) => result?,
    };
    if !catalog.iter().any(|m| m.id == MODEL) {
        progress(
            app,
            "Downloading Gemma 4 · existing downloads can resume",
            None,
            None,
        );
        pull(app, &endpoint, cancel).await?;
    }
    canceled(cancel)?;
    progress(app, "Verifying Gemma 4 is available locally", None, None);
    let model = tokio::select! {
        _ = cancel.cancelled() => return Err(STOPPED.into()),
        result = meeting_ollama::resolve(&endpoint, MODEL) => result?,
    };
    let state = app.state::<MeetingState>();
    let _lock = state.credentials.lock().await;
    canceled(cancel)?;
    let mut credentials = meeting_auth::read(app)?;
    if credentials.preferences.ollama_endpoint != endpoint {
        return Err("The Ollama address changed during setup. Check the address and retry.".into());
    }
    credentials.preferences.ollama_model = MODEL.into();
    meeting_auth::write(app, &credentials)?;
    Ok(json!({"connections":meeting_auth::status(&credentials),"model":model}))
}

fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Local model setup is available only in the main window".into())
    }
}
#[tauri::command]
pub(crate) fn local_model_setup_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Progress, String> {
    main_window(&window)?;
    let state = app.state::<SetupState>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.0.clone())
}
#[tauri::command]
pub(crate) fn local_model_setup_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    main_window(&window)?;
    if let Some(cancel) = &app
        .state::<SetupState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .1
    {
        cancel.cancel();
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn local_model_setup(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    main_window(&window)?;
    let cancel = CancellationToken::new();
    {
        let state = app.state::<SetupState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.1.is_some() {
            return Err("Local model setup is already running".into());
        }
        guard.1 = Some(cancel.clone());
        guard.0 = Progress {
            running: true,
            message: "Checking local AI setup".into(),
            ..Progress::default()
        };
    }
    let result = setup(&app, &cancel).await;
    let final_progress = Progress {
        running: false,
        message: match &result {
            Ok(_) => {
                "Gemma 4 is ready. Writing help and local meeting AI can use it offline.".into()
            }
            Err(error) => error.clone(),
        },
        ..Progress::default()
    };
    {
        let state = app.state::<SetupState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = (final_progress.clone(), None);
    }
    let _ = app.emit("local-model-setup", final_progress);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_setup_progress_rejects_errors_oversize_and_invalid_counts() {
        assert!(pull_frame(br#"{"status":"pulling","completed":3,"total":10}"#).is_ok());
        assert_eq!(
            pull_frame(br#"{"status":"success"}"#)
                .unwrap()
                .status
                .as_deref(),
            Some("success")
        );
        assert!(pull_frame(br#"{"error":"not enough disk space"}"#)
            .err()
            .unwrap()
            .contains("not enough disk space"));
        assert!(pull_frame(br#"{"completed":11,"total":10}"#).is_err());
        assert!(pull_frame(&vec![b' '; FRAME_LIMIT + 1]).is_err());
        assert!(pull_frame(br#"{"status":"unfinished""#).is_err());
    }

    #[test]
    fn local_setup_requires_verified_completion_across_split_stream_frames() {
        let input="{\"status\":\"ダウンロード\",\"completed\":2,\"total\":10}\n{\"status\":\"verifying sha256 digest\"}\n{\"status\":\"success\"}";
        let mut stream = PullStream::default();
        let mut statuses = vec![];
        for chunk in input.as_bytes().chunks(1) {
            stream
                .feed(chunk, |frame| statuses.push(frame.status.unwrap()))
                .unwrap();
        }
        assert_eq!(statuses, vec!["ダウンロード", "verifying sha256 digest"]);
        assert!(stream.finish().is_ok());
        let mut incomplete = PullStream::default();
        incomplete
            .feed(
                b"{\"status\":\"pulling\",\"completed\":10,\"total\":10}\n",
                |_| {},
            )
            .unwrap();
        assert!(incomplete.finish().is_err());
        let mut failed = PullStream::default();
        assert!(failed
            .feed(
                b"{\"status\":\"verifying\"}\n{\"error\":\"digest mismatch\"}\n",
                |_| {}
            )
            .is_err());
        let mut oversized = PullStream::default();
        assert!(oversized
            .feed(&vec![b'x'; FRAME_LIMIT + 1], |_| {})
            .is_err());
    }
}

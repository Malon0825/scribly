//! A durable one-request mailbox. Only the main notebook window writes notes.
use crate::{database::DatabaseState, files, StartupTiming};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+N";
const TEXT_LIMIT: usize = 256 * 1024;
static WINDOW_CREATION: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Draft {
    title: String,
    text: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    id: String,
    title: String,
    text: String,
    created_at: String,
    open_after_save: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Mailbox {
    draft: Option<Draft>,
    pending: Option<Request>,
    last_saved_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    enabled: bool,
    shortcut: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            shortcut: DEFAULT_SHORTCUT.into(),
        }
    }
}

struct Capture {
    root: PathBuf,
    preferences: Preferences,
    mailbox: Mailbox,
    registered: bool,
    warning: Option<String>,
    load_error: Option<String>,
    diagnostic: bool,
}
pub(crate) struct QuickCaptureState(Mutex<Capture>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    enabled: bool,
    shortcut: String,
    registered: bool,
    warning: Option<String>,
    draft: Option<Draft>,
    pending: Option<Request>,
    last_saved_id: Option<String>,
}
impl Capture {
    fn status(&self) -> Status {
        Status {
            enabled: self.preferences.enabled,
            shortcut: self.preferences.shortcut.clone(),
            registered: self.registered,
            warning: self.warning.clone(),
            draft: self.mailbox.draft.clone(),
            pending: self.mailbox.pending.clone(),
            last_saved_id: self.mailbox.last_saved_id.clone(),
        }
    }
    fn save_mailbox(&mut self, next: Mailbox) -> Result<(), String> {
        if let Some(error) = &self.load_error {
            return Err(error.clone());
        }
        persist(&self.root.join("quick-capture-queue.json"), &next)?;
        self.mailbox = next;
        self.warning = None;
        Ok(())
    }
}

fn persist(path: &Path, value: &impl Serialize) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid capture path")?).map_err(|e| e.to_string())?;
    files::replace(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
fn load<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, String> {
    // The mailbox contains both draft and pending text; JSON escaping can
    // expand each input byte sixfold even while UTF-8 input stays bounded.
    match files::read_bounded(path, 4 * 1024 * 1024) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            format!(
                "Capture data could not be read; preserve {}: {e}",
                path.display()
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(format!(
            "Capture data could not be read; preserve {}: {error}",
            path.display()
        )),
    }
}
fn valid_shortcut(shortcut: &str) -> Result<(), String> {
    if matches!(shortcut, "Ctrl+Alt+N" | "Ctrl+Shift+Space" | "Alt+Shift+N") {
        Ok(())
    } else {
        Err("Choose one of the available capture shortcuts".into())
    }
}
fn validate_text(title: &str, text: &str, allow_blank: bool) -> Result<(), String> {
    if title.chars().count() > 120 {
        return Err("Capture titles must be at most 120 characters".into());
    }
    if text.len() > TEXT_LIMIT {
        return Err("Capture text must be at most 256 KiB".into());
    }
    if !allow_blank && title.trim().is_empty() && text.trim().is_empty() {
        return Err("Write a title or some text before saving".into());
    }
    Ok(())
}
fn validate_request(request: &Request) -> Result<(), String> {
    validate_text(&request.title, &request.text, false)?;
    uuid::Uuid::parse_str(&request.id).map_err(|_| "Invalid capture ID")?;
    // PostgreSQL's timestamp parser is not involved in this file; accept the
    // exact ISO UTC format emitted by Date.toISOString, with bounded fields.
    let timestamp = regex::Regex::new(
        r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$",
    )
    .unwrap();
    if !timestamp.is_match(&request.created_at) {
        return Err("Invalid capture timestamp".into());
    }
    Ok(())
}
fn authorize(window: &tauri::WebviewWindow, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err("This command is not available in this window".into())
    }
}
fn known_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "quick-capture") {
        Ok(())
    } else {
        Err("Unknown capture caller".into())
    }
}

pub(crate) fn initialize(app: &tauri::AppHandle, diagnostic: bool) -> Result<(), String> {
    let test_shortcuts = app.state::<StartupTiming>().benchmark_root.is_some()
        && std::env::args().any(|arg| arg == "--test-capture-shortcuts");
    let root = app
        .state::<StartupTiming>()
        .benchmark_root
        .clone()
        .unwrap_or(app.path().app_local_data_dir().map_err(|e| e.to_string())?);
    let loaded = (|| {
        let preferences: Preferences = load(&root.join("quick-capture-preferences.json"))?;
        valid_shortcut(&preferences.shortcut)?;
        let mailbox: Mailbox = load(&root.join("quick-capture-queue.json"))?;
        if let Some(draft) = &mailbox.draft {
            validate_text(&draft.title, &draft.text, true)?;
        }
        if let Some(pending) = &mailbox.pending {
            validate_request(pending)?;
        }
        if let Some(id) = &mailbox.last_saved_id {
            uuid::Uuid::parse_str(id).map_err(|_| "Invalid saved capture ID")?;
        }
        Ok::<_, String>((preferences, mailbox))
    })();
    let (preferences, mailbox, error) = match loaded {
        Ok((preferences, mailbox)) => (preferences, mailbox, None),
        Err(error) => (Preferences::default(), Mailbox::default(), Some(error)),
    };
    app.manage(QuickCaptureState(Mutex::new(Capture {
        root,
        preferences,
        mailbox,
        registered: false,
        warning: error.clone(),
        load_error: error,
        diagnostic: diagnostic && !test_shortcuts,
    })));
    Ok(())
}

// Called once the database is open, from the startup worker. Diagnostics do
// not reserve global shortcuts unless explicitly testing in an isolated root.
pub(crate) fn restore_registration(app: &tauri::AppHandle) {
    let state = app.state::<QuickCaptureState>();
    let Ok(mut capture) = state.0.lock() else {
        return;
    };
    if capture.diagnostic || !capture.preferences.enabled || capture.registered {
        return;
    }
    match app
        .global_shortcut()
        .register(capture.preferences.shortcut.as_str())
    {
        Ok(()) => capture.registered = true,
        Err(error) => {
            capture.warning = Some(format!(
                "Shortcut unavailable: {error}. Choose another shortcut in Settings."
            ))
        }
    }
    let _ = app.emit_to("main", "quick-capture-status", capture.status());
}

#[tauri::command]
pub(crate) fn quick_capture_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Status, String> {
    known_window(&window)?;
    Ok(app
        .state::<QuickCaptureState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .status())
}

#[tauri::command]
pub(crate) async fn set_quick_capture_preferences(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    enabled: bool,
    shortcut: String,
) -> Result<Status, String> {
    authorize(&window, "main")?;
    valid_shortcut(&shortcut)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<QuickCaptureState>();
        let mut capture = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &capture.load_error {
            return Err(error.clone());
        }
        let old = capture.preferences.clone();
        let change = old.shortcut != shortcut;
        let added = enabled && !capture.diagnostic && (!capture.registered || change);
        if added {
            if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
                capture.warning = Some(format!(
                    "Shortcut unavailable: {error}. Previous preference was kept."
                ));
                return Ok(capture.status());
            }
        }
        let next = Preferences {
            enabled,
            shortcut: shortcut.clone(),
        };
        if let Err(error) = persist(&capture.root.join("quick-capture-preferences.json"), &next) {
            if added {
                let _ = app.global_shortcut().unregister(shortcut.as_str());
            }
            return Err(error);
        }
        if capture.registered && (!enabled || change) {
            if let Err(error) = app.global_shortcut().unregister(old.shortcut.as_str()) {
                if added {
                    let _ = app.global_shortcut().unregister(shortcut.as_str());
                }
                let rollback = persist(&capture.root.join("quick-capture-preferences.json"), &old);
                capture.warning = Some(format!(
                    "Could not release previous shortcut: {error}; preference rollback: {}",
                    rollback.err().unwrap_or_else(|| "saved".into())
                ));
                return Ok(capture.status());
            }
        }
        capture.preferences = next;
        capture.registered = enabled && !capture.diagnostic;
        capture.warning = if enabled && capture.diagnostic {
            Some("Global shortcuts are not registered in diagnostic profiles".into())
        } else {
            None
        };
        let status = capture.status();
        let _ = app.emit_to("quick-capture", "quick-capture-status", &status);
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn show_capture(app: &tauri::AppHandle) -> Result<(), String> {
    // Window construction runs on a worker to avoid WebView2's documented
    // synchronous-command/event-handler deadlock. Serialize repeated opens.
    let _opening = WINDOW_CREATION.lock().map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("quick-capture") {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        let _ = window.emit("quick-capture-focus", ());
        return Ok(());
    }
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "quick-capture",
        tauri::WebviewUrl::App("index.html?capture=1".into()),
    )
    .title("Scribly · Quick capture")
    .inner_size(520.0, 480.0)
    .min_inner_size(360.0, 360.0)
    .decorations(true)
    .transparent(false)
    .disable_drag_drop_handler()
    .center();
    if let Some(root) = &app.state::<StartupTiming>().benchmark_root {
        builder = builder.data_directory(root.join("webview"));
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub(crate) async fn open_quick_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    authorize(&window, "main")?;
    tauri::async_runtime::spawn_blocking(move || show_capture(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn write_capture_draft(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    title: String,
    text: String,
) -> Result<Status, String> {
    authorize(&window, "quick-capture")?;
    validate_text(&title, &text, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<QuickCaptureState>();
        let mut capture = state.0.lock().map_err(|e| e.to_string())?;
        if capture.mailbox.pending.is_some() {
            return Err(
                "This capture is awaiting notebook saving. Retry it before editing.".into(),
            );
        }
        let mut next = capture.mailbox.clone();
        next.draft = Some(Draft { title, text });
        capture.save_mailbox(next)?;
        Ok(capture.status())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn enqueue(mailbox: &Mailbox, request: Request) -> Result<Mailbox, String> {
    validate_request(&request)?;
    if mailbox.last_saved_id.as_deref() == Some(&request.id) {
        return Ok(mailbox.clone());
    }
    if let Some(pending) = &mailbox.pending {
        if *pending == request {
            return Ok(mailbox.clone());
        }
        return Err("Another capture is awaiting notebook saving".into());
    }
    let mut next = mailbox.clone();
    next.draft = Some(Draft {
        title: request.title.clone(),
        text: request.text.clone(),
    });
    next.pending = Some(request);
    Ok(next)
}

#[tauri::command]
pub(crate) async fn submit_quick_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    title: String,
    text: String,
    created_at: String,
    open_after_save: bool,
) -> Result<Status, String> {
    authorize(&window, "quick-capture")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<QuickCaptureState>();
        let mut capture = state.0.lock().map_err(|e| e.to_string())?;
        let next = enqueue(
            &capture.mailbox,
            Request {
                id,
                title,
                text,
                created_at,
                open_after_save,
            },
        )?;
        capture.save_mailbox(next)?;
        if let Some(request) = &capture.mailbox.pending {
            let _ = app.emit_to("main", "quick-capture-pending", request);
        }
        Ok(capture.status())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn canonical_body(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            let escaped = line
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
                .replace('\'', "&#39;");
            format!(
                "<p>{}</p>",
                if escaped.is_empty() { "<br>" } else { &escaped }
            )
        })
        .collect()
}
#[tauri::command]
pub(crate) async fn finish_quick_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<Status, String> {
    authorize(&window, "main")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<QuickCaptureState>();
        let mut capture = state.0.lock().map_err(|e| e.to_string())?;
        if capture.mailbox.last_saved_id.as_deref() == Some(&id) {
            return Ok(capture.status());
        }
        let pending = capture
            .mailbox
            .pending
            .as_ref()
            .filter(|p| p.id == id)
            .ok_or("No matching pending capture")?;
        let db = app.state::<DatabaseState>();
        let body = canonical_body(&pending.text);
        let matches =
            db.0.lock()
                .map_err(|e| e.to_string())?
                .as_mut()
                .ok_or("Notebook is not open")?
                .capture_matches(&id, &pending.title, &body)?;
        if !matches {
            return Err("The capture has not been durably saved in the notebook".into());
        }
        let next = Mailbox {
            draft: None,
            pending: None,
            last_saved_id: Some(id),
        };
        capture.save_mailbox(next)?;
        let status = capture.status();
        let _ = app.emit_to("quick-capture", "quick-capture-status", &status);
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn report_quick_capture_error(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    error: String,
) -> Result<Status, String> {
    authorize(&window, "main")?;
    let state = app.state::<QuickCaptureState>();
    let mut capture = state.0.lock().map_err(|e| e.to_string())?;
    if !capture.mailbox.pending.as_ref().is_some_and(|p| p.id == id) {
        return Err("No matching pending capture".into());
    }
    capture.warning = Some(error.chars().take(2000).collect());
    let status = capture.status();
    let _ = app.emit_to("quick-capture", "quick-capture-status", &status);
    Ok(status)
}
#[tauri::command]
pub(crate) fn open_capture_note(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    known_window(&window)?;
    if app
        .state::<QuickCaptureState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .mailbox
        .last_saved_id
        .as_deref()
        != Some(&id)
    {
        return Err("Save the capture before opening it".into());
    }
    let main = app
        .get_webview_window("main")
        .ok_or("Notebook window is unavailable")?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    main.emit("quick-capture-open", id)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Request {
        Request {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Quick note".into(),
            text: "<&\"'\n\nlast".into(),
            created_at: "2026-10-04T10:12:34.000Z".into(),
            open_after_save: false,
        }
    }
    #[test]
    fn mailbox_preserves_pending_and_retries_idempotently() {
        let request = request();
        let pending = enqueue(&Mailbox::default(), request.clone()).unwrap();
        assert_eq!(
            enqueue(&pending, request.clone()).unwrap().pending,
            pending.pending
        );
        let mut changed = request.clone();
        changed.text = "changed".into();
        assert!(enqueue(&pending, changed).is_err());
        let saved = Mailbox {
            last_saved_id: Some(request.id.clone()),
            ..Mailbox::default()
        };
        assert!(enqueue(&saved, request).unwrap().pending.is_none());
        assert_eq!(
            canonical_body("<&\"'\n\nlast"),
            "<p>&lt;&amp;&quot;&#39;</p><p><br></p><p>last</p>"
        );
    }
    #[test]
    fn validates_limits_before_queue_mutation() {
        let mut invalid = request();
        invalid.id = "bad".into();
        assert!(validate_request(&invalid).is_err());
        invalid = request();
        invalid.created_at = "tomorrow".into();
        assert!(validate_request(&invalid).is_err());
        assert!(validate_text(&"🙂".repeat(120), "text", false).is_ok());
        assert!(validate_text(&"🙂".repeat(121), "text", false).is_err());
        assert!(validate_text("", &"é".repeat(TEXT_LIMIT / 2 + 1), false).is_err());
        assert!(validate_text(" ", "\n", false).is_err());
    }
}

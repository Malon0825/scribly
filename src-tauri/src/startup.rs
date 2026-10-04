//! Recoverable, current-user Windows startup registration.
use crate::StartupTiming;
use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};
use tauri::Manager;
pub(crate) struct StartupRegistration(Result<AutoLaunch, String>);
impl StartupRegistration {
    pub(crate) fn new(name: &str) -> Self {
        Self(startup_registration(name))
    }
    pub(crate) fn get(&self) -> Result<&AutoLaunch, String> {
        self.0.as_ref().map_err(Clone::clone)
    }
}
pub(crate) fn startup_registration(name: &str) -> Result<AutoLaunch, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Could not locate Scribly for Windows startup: {e}"))?;
    // Use the same startup library as Tauri's plugin, explicitly scoped to this
    // Windows user. Quote the executable so custom install paths with spaces work.
    AutoLaunchBuilder::new()
        .set_app_name(name)
        .set_app_path(&format!("\"{}\"", exe.display()))
        .set_args(&["--autostart"])
        .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|e| format!("Could not configure Windows startup: {e}"))
}

// Preserve the opt-in preference when upgrading the brand. Enable the new
// current-executable entry first, so a failure cannot remove working startup.
pub(crate) fn migrate_startup(current: &AutoLaunch, previous: &AutoLaunch) -> Result<(), String> {
    if previous.is_enabled().map_err(|e| e.to_string())? {
        current.enable().map_err(|e| e.to_string())?;
        previous.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn startup_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<StartupRegistration>()
            .get()?
            .is_enabled()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn set_startup(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    if app.state::<StartupTiming>().benchmark_root.is_some() {
        return Err("Startup changes are unavailable during a diagnostic run.".into());
    }
    if cfg!(debug_assertions) {
        return Err("Use the installed release app to change Windows startup.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let registration = app.state::<StartupRegistration>();
        let manager = registration.get()?;
        if enabled {
            manager.enable()
        } else {
            manager.disable()
        }
        .map_err(|e| e.to_string())?;
        manager.is_enabled().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

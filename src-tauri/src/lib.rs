#![deny(unsafe_op_in_unsafe_fn)]
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;
mod app_icon;
mod attachments;
mod commands;
mod database;
mod diagnostics;
mod files;
mod json_size;
mod startup;
mod workspace;
mod workspace_delta;
use commands::*;
use database::DatabaseState;
use diagnostics::database_self_test;
use startup::*;
#[cfg(test)]
use workspace::validate_workspace;

struct StartupTiming {
    started: Instant,
    benchmark_root: Option<PathBuf>,
    database_ready_ms: Mutex<Option<u128>>,
    reported: Mutex<bool>,
}

#[tauri::command]
async fn frontend_ready(app: tauri::AppHandle, frontend_ms: f64) -> Result<(), String> {
    if !frontend_ms.is_finite() || frontend_ms < 0.0 {
        return Err("Invalid startup measurement".into());
    }
    tauri::async_runtime::spawn_blocking(move || report_ready(app, frontend_ms))
        .await
        .map_err(|e| e.to_string())?
}

fn report_ready(app: tauri::AppHandle, frontend_ms: f64) -> Result<(), String> {
    let timing = app.state::<StartupTiming>();
    let mut reported = timing.reported.lock().map_err(|e| e.to_string())?;
    if *reported {
        return Ok(());
    }
    let database_ms = *timing.database_ready_ms.lock().map_err(|e| e.to_string())?;
    if database_ms.is_none() {
        return Err("Notebook not ready".into());
    }
    if let Some(root) = &timing.benchmark_root {
        let report = json!({"version":app.package_info().version.to_string(),
            "pid":std::process::id(), "readyMs":timing.started.elapsed().as_millis(),
            "databaseReadyMs":database_ms,"frontendMs":frontend_ms});
        files::replace(
            &root.join("ready.json"),
            &serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(20));
            handle.exit(0);
        });
    }
    *reported = true;
    Ok(())
}

pub fn run() {
    let started = Instant::now();
    if let Some(arg) = std::env::args().find(|a| a.starts_with("--self-test=")) {
        let root = PathBuf::from(arg.trim_start_matches("--self-test="));
        let exe = std::env::current_exe().unwrap();
        let bundled = exe.parent().unwrap().join("postgres");
        let runtime = if bundled.exists() {
            bundled
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/postgres")
        };
        let result = database_self_test(root.clone(), runtime);
        let report = match &result {
            Ok(v) => v.clone(),
            Err(e) => json!({"ok":false,"error":e}),
        };
        let _ = fs::create_dir_all(&root);
        let _ = fs::write(
            root.join("self-test.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        );
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    let benchmark_root =
        std::env::args().find_map(|a| a.strip_prefix("--benchmark=").map(PathBuf::from));
    let startup_test_root =
        std::env::args().find_map(|a| a.strip_prefix("--startup-self-test=").map(PathBuf::from));
    let diagnostic = benchmark_root.is_some() || startup_test_root.is_some();
    let mut context = tauri::generate_context!();
    let mut benchmark_window = None;
    if let Some(root) = &benchmark_root {
        fs::create_dir_all(root).expect("Could not create diagnostic profile");
        // Config data_directory only accepts relative paths; the builder is
        // required for an absolute, genuinely isolated WebView2 profile.
        let mut window = context.config_mut().app.windows.remove(0);
        window.title = "Scribly · isolated performance measurement".into();
        benchmark_window = Some((window, root.join("webview")));
    }
    if startup_test_root.is_some() {
        context.config_mut().app.windows.clear();
    }
    let startup_name = if diagnostic {
        format!("Scribly diagnostic {}", uuid::Uuid::new_v4().simple())
    } else {
        "Scribly".into()
    };
    let mut builder = tauri::Builder::default();
    if !diagnostic {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    let app = builder
        .manage(app_icon::AppIcons::default())
        .manage(StartupRegistration::new(&startup_name))
        .plugin(tauri_plugin_dialog::init())
        .manage(DatabaseState(Mutex::new(None)))
        .manage(StartupTiming { started, benchmark_root, database_ready_ms: Mutex::new(None), reported: Mutex::new(false) })
        .setup(move |app| {
            if let Some((config, profile)) = &benchmark_window {
                tauri::WebviewWindowBuilder::from_config(app, config)?.data_directory(profile.clone()).build()?;
            }
            if let Some(root) = &startup_test_root {
                let registration = app.state::<StartupRegistration>();
                let manager = registration.get()?;
                let previous = startup_registration(&format!("Scribly legacy diagnostic {}", uuid::Uuid::new_v4().simple()))?;
                let result = (|| -> Result<(), String> {
                    manager.enable().map_err(|e| e.to_string())?;
                    if !manager.is_enabled().map_err(|e| e.to_string())? { return Err("Startup registration failed".into()); }
                    manager.disable().map_err(|e| e.to_string())?;
                    if manager.is_enabled().map_err(|e| e.to_string())? { return Err("Startup removal failed".into()); }
                    previous.enable().map_err(|e| e.to_string())?;
                    migrate_startup(manager, &previous)?;
                    if !manager.is_enabled().map_err(|e| e.to_string())? || previous.is_enabled().map_err(|e| e.to_string())? {
                        return Err("Startup rename migration failed".into());
                    }
                    Ok(())
                })();
                let _ = previous.disable();
                let _ = manager.disable();
                let _ = fs::create_dir_all(root);
                let _ = fs::write(root.join("startup-test.json"), serde_json::to_vec_pretty(&json!({"ok":result.is_ok(),"error":result.err(),"isolatedRegistration":true})).unwrap());
                std::process::exit(0);
            }
            if !diagnostic && !cfg!(debug_assertions) {
                let registration = app.state::<StartupRegistration>();
                let result = (|| -> Result<(), String> {
                    migrate_startup(registration.get()?, &startup_registration("Notify")?)
                })();
                if let Err(error) = result {
                    eprintln!("Could not migrate the Windows startup preference: {error}");
                }
            }
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(window) = app.get_webview_window("main") { let _ = window.minimize(); }
            }
            // Begin opening the notebook while WebView2 loads the UI, instead of
            // waiting for JavaScript to request the first database connection.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { let _ = open_workspace(handle, false).await; });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            save_workspace_delta,
            store_attachment,
            read_attachment,
            export_attachment,
            prune_attachments,
            export_file,
            export_binary_file,
            startup_enabled,
            set_startup,
            app_icon::set_app_theme_icon,
            frontend_ready
        ])
        .build(context)
        .expect("Could not start Scribly");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let database = app
                .state::<DatabaseState>()
                .0
                .lock()
                .ok()
                .and_then(|mut db| db.take());
            // Release managed state before process shutdown; report teardown
            // errors instead of silently discarding them in a destructor.
            if let Some(db) = database {
                if let Err(error) = db.close() {
                    eprintln!("Notebook database shutdown failed: {error}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_orphan_notes() {
        let doc = json!({"folders":[],"notes":[{"id":"n","folderId":"missing","title":"x","content":"","createdAt":"x","updatedAt":"x","archived":false}],"theme":"light"});
        assert!(validate_workspace(&doc).is_err());
    }
    #[test]
    fn invalid_automatic_titles_cannot_enter_native_storage() {
        let mut doc = json!({"theme":"light","activeId":"n","referenceId":null,"folders":[],"notes":[{"id":"n","folderId":null,"title":"x","content":"","createdAt":"x","updatedAt":"x","archived":false}]});
        for title in [
            json!({"folderId":null,"day":"2026-10-03","ordinal":-1}),
            json!({"folderId":null,"day":"bad","ordinal":0}),
            json!(42),
        ] {
            doc["notes"][0]["autoTitle"] = title;
            assert!(validate_workspace(&doc).is_err());
        }
        doc["notes"][0]["autoTitle"] = json!({"folderId":null,"day":"2026-10-03","ordinal":0});
        assert!(validate_workspace(&doc).is_ok());
    }
    #[test]
    fn rejects_duplicate_folders() {
        assert!(validate_workspace(&json!({"folders":[{"id":"f","name":"a"},{"id":"f","name":"b"}],"notes":[],"theme":"light"})).is_err());
    }
}

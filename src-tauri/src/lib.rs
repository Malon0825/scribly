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
mod backups;
mod commands;
mod database;
mod diagnostics;
mod files;
mod history;
mod json_size;
mod notepad;
mod notepad_plus;
mod quick_capture;
mod sources;
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
        // Interactive integration tests own shutdown; ordinary startup/RAM
        // benchmarks keep their existing twenty-second measurement window.
        if !std::env::args().any(|arg| arg == "--keep-diagnostic-open") {
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                handle.exit(0);
            });
        }
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let handle = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = quick_capture::show_capture(&handle) {
                        eprintln!("Could not open quick capture: {error}");
                    }
                });
            }
        }).build())
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
            quick_capture::initialize(&handle, diagnostic)?;
            tauri::async_runtime::spawn(async move {
                if open_workspace(handle.clone(), false).await.is_ok() {
                    tauri::async_runtime::spawn_blocking(move || quick_capture::restore_registration(&handle));
                }
            });
            Ok(())
        })
        .invoke_handler(|invoke| {
            // Application commands are otherwise globally callable. Keep the
            // capture WebView out of notebook persistence and source access.
            if invoke.message.webview().label() != "main" && !matches!(invoke.message.command(),
                "quick_capture_status" | "write_capture_draft" | "submit_quick_capture" | "open_capture_note") {
                invoke.resolver.reject("This command is only available in the notebook window");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            commands::open_external_link,
            commands::list_history,
            commands::read_history,
            commands::checkpoint_history,
            commands::backup_status,
            commands::choose_backup_directory,
            commands::set_backup_enabled,
            commands::commit_backup,
            commands::read_backup_chunk,
            load_workspace,
            save_workspace,
            save_workspace_delta,
            store_attachment,
            read_attachment,
            export_attachment,
            prune_attachments,
            export_file,
            open_releases,
            export_binary_file,
            begin_source,
            append_source_chunk,
            finish_source,
            abort_source,
            remove_source,
            read_source_chunk,
            export_source,
            startup_enabled,
            set_startup,
            app_icon::set_app_theme_icon,
            frontend_ready,
            notepad::scan_notepad_tabs,
            notepad_plus::scan_notepad_plus_tabs,
            quick_capture::quick_capture_status,
            quick_capture::set_quick_capture_preferences,
            quick_capture::open_quick_capture,
            quick_capture::write_capture_draft,
            quick_capture::submit_quick_capture,
            quick_capture::finish_quick_capture,
            quick_capture::report_quick_capture_error,
            quick_capture::open_capture_note
        ];
            handler(invoke)
        })
        .build(context)
        .expect("Could not start Scribly");
    app.run(|app, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } = &event
        {
            if label == "quick-capture" {
                // The frontend drains its serialized draft writes before hiding.
                // Keep the WebView alive so closing never discards unsent text.
                api.prevent_close();
            }
        }
        if matches!(&event, tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main") {
            // Main destroys itself only after its frontend persistence drain.
            // Capture's retained window must not keep that session alive.
            app.exit(0);
        }
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

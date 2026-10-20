#[tauri::command]
pub(crate) async fn render_note_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    html: String,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main" {
        return Err("PDF export is only available from the notebook.".into());
    }
    if html.is_empty() || html.len() > 96 * 1024 * 1024 {
        return Err("The PDF document is empty or exceeds the export limit.".into());
    }
    #[cfg(windows)]
    return windows_pdf::render(app, html).await;
    #[cfg(not(windows))]
    {
        let _ = (app, html);
        Err("Direct PDF export requires Windows. Use Print to save a PDF instead.".into())
    }
}

#[cfg(windows)]
mod windows_pdf {
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::Duration,
    };
    use tauri::{webview::PageLoadEvent, Manager, WebviewUrl, WebviewWindowBuilder};
    use tokio::sync::oneshot;
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};

    static RENDERING: AtomicBool = AtomicBool::new(false);
    struct RenderGuard;
    impl Drop for RenderGuard {
        fn drop(&mut self) {
            RENDERING.store(false, Ordering::Release);
        }
    }
    struct TempDocument(PathBuf);
    impl Drop for TempDocument {
        fn drop(&mut self) {
            let _ = fs::remove_file(self.0.join("note.html"));
            let _ = fs::remove_file(self.0.join("note.pdf"));
            let _ = fs::remove_dir(&self.0);
        }
    }

    pub(super) async fn render(
        app: tauri::AppHandle,
        html: String,
    ) -> Result<tauri::ipc::Response, String> {
        if RENDERING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("A PDF is already being prepared. Try again when it finishes.".into());
        }
        let _guard = RenderGuard;
        let id = uuid::Uuid::new_v4();
        let folder = std::env::temp_dir().join(format!("scribly-pdf-{id}"));
        fs::create_dir(&folder).map_err(|e| format!("PDF preparation failed: {e}"))?;
        let temp = TempDocument(folder);
        // Enforce an inert, offline document even if an IPC caller bypasses the
        // frontend sanitizer. The renderer has no notebook capabilities or JS.
        let policy = "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'\">";
        fs::write(temp.0.join("note.html"), format!("{policy}{html}"))
            .map_err(|e| format!("The PDF document could not be prepared: {e}"))?;
        let url = tauri::Url::from_file_path(temp.0.join("note.html"))
            .map_err(|_| "The PDF document path is invalid.")?;
        let allowed_url = url.clone();
        let loaded_url = url.clone();
        let pdf_path = temp.0.join("note.pdf");
        let (tx, rx) = oneshot::channel();
        let completion = Arc::new(Mutex::new(Some(tx)));
        let started = Arc::new(AtomicBool::new(false));
        let mut builder =
            WebviewWindowBuilder::new(&app, format!("pdf-{id}"), WebviewUrl::External(url))
                .title("Preparing PDF")
                .visible(false)
                .focused(false)
                .skip_taskbar(true)
                .inner_size(794.0, 1123.0)
                .disable_javascript()
                .disable_drag_drop_handler()
                .on_navigation(move |url| url == &allowed_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_page_load(move |window, payload| {
                    if payload.event() != PageLoadEvent::Finished
                        || payload.url() != &loaded_url
                        || started.swap(true, Ordering::AcqRel)
                    {
                        return;
                    }
                    let complete = completion.clone();
                    let failed = completion.clone();
                    let path = HSTRING::from(pdf_path.as_os_str());
                    let queued = window.with_webview(move |webview| {
                        // All COM calls and callbacks stay on WebView2's UI thread.
                        let result = (|| -> windows::core::Result<()> {
                            unsafe {
                                let core: ICoreWebView2_7 =
                                    webview.controller().CoreWebView2()?.cast()?;
                                let environment: ICoreWebView2Environment6 =
                                    webview.environment().cast()?;
                                let settings = environment.CreatePrintSettings()?;
                                settings.SetPageWidth(210.0 / 25.4)?;
                                settings.SetPageHeight(297.0 / 25.4)?;
                                settings.SetShouldPrintBackgrounds(true)?;
                                settings.SetShouldPrintHeaderAndFooter(false)?;
                                let done = complete.clone();
                                core.PrintToPdf(
                                    &path,
                                    &settings,
                                    &PrintToPdfCompletedHandler::create(Box::new(
                                        move |status, success| {
                                            let result =
                                                status.map_err(|e| e.to_string()).and_then(|_| {
                                                    if success {
                                                        Ok(())
                                                    } else {
                                                        Err("Windows could not create the PDF."
                                                            .into())
                                                    }
                                                });
                                            if let Ok(mut sender) = done.lock() {
                                                if let Some(sender) = sender.take() {
                                                    let _ = sender.send(result);
                                                }
                                            }
                                            Ok(())
                                        },
                                    )),
                                )
                            }
                        })();
                        if let Err(error) = result {
                            if let Ok(mut sender) = complete.lock() {
                                if let Some(sender) = sender.take() {
                                    let _ = sender.send(Err(error.to_string()));
                                }
                            }
                        }
                    });
                    if let Err(error) = queued {
                        if let Ok(mut sender) = failed.lock() {
                            if let Some(sender) = sender.take() {
                                let _ = sender.send(Err(error.to_string()));
                            }
                        }
                    }
                });
        // Match the main window's isolated WebView2 environment in diagnostics,
        // just as Quick capture does. Never open the user's normal profile.
        if let Some(root) = &app.state::<crate::StartupTiming>().benchmark_root {
            builder = builder.data_directory(root.join("webview"));
        }
        let renderer = builder
            .build()
            .map_err(|e| format!("The PDF renderer could not open: {e}"))?;
        let rendered = tokio::time::timeout(Duration::from_secs(60), rx).await;
        // Destroy the hidden renderer before reading or deleting its files.
        renderer
            .destroy()
            .map_err(|e| format!("The PDF renderer could not close: {e}"))?;
        rendered
            .map_err(|_| "PDF preparation timed out. Try exporting fewer notes.")?
            .map_err(|_| "The PDF renderer stopped before finishing.")??;
        let length = fs::metadata(temp.0.join("note.pdf"))
            .map_err(|e| e.to_string())?
            .len();
        if length > 96 * 1024 * 1024 {
            return Err("The PDF exceeds 96 MiB. Export fewer notes.".into());
        }
        let bytes = fs::read(temp.0.join("note.pdf"))
            .map_err(|e| format!("The PDF could not be read: {e}"))?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("Windows did not return a valid PDF.".into());
        }
        Ok(tauri::ipc::Response::new(bytes))
    }
}

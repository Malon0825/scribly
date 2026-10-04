//! Keep caption, large window, and Shell taskbar-group icons in sync with the
//! resolved theme. Retain owned handles and on-disk Shell resources for reuse.
#[derive(Default)]
pub struct AppIcons {
    #[cfg(windows)]
    icons: std::sync::Mutex<Option<windows::IconCache>>,
}

#[tauri::command]
pub async fn set_app_theme_icon(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(windows::update(&target, dark));
            })
            .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, dark);
        Ok(())
    }
}

#[cfg(windows)]
mod windows {
    use super::AppIcons;
    use ::windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, PROPERTYKEY, WPARAM},
            Storage::EnhancedStorage::{
                PKEY_AppUserModel_ID, PKEY_AppUserModel_RelaunchCommand,
                PKEY_AppUserModel_RelaunchDisplayNameResource,
                PKEY_AppUserModel_RelaunchIconResource,
            },
            System::{
                Com::StructuredStorage::{
                    PropVariantClear, PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0,
                    PROPVARIANT_0_0_0,
                },
                Variant::VT_LPWSTR,
            },
            UI::Shell::{
                DefSubclassProc,
                PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
                RemoveWindowSubclass, SHStrDupW, SetWindowSubclass,
            },
        },
    };
    use std::{mem::ManuallyDrop, os::windows::ffi::OsStrExt};
    use tauri::Manager;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, DestroyIcon, GetSystemMetrics, SendMessageW, HICON, SM_CXICON,
        WM_NCDESTROY, WM_SETICON,
    };

    const SUBCLASS_ID: usize = 0x53435249;
    const SHELL_KEYS: [PROPERTYKEY; 4] = [
        PKEY_AppUserModel_RelaunchCommand,
        PKEY_AppUserModel_RelaunchDisplayNameResource,
        PKEY_AppUserModel_RelaunchIconResource,
        PKEY_AppUserModel_ID,
    ];

    pub(super) struct IconCache {
        themes: [ThemeIcons; 2],
        resources: [String; 2],
        relaunch: Vec<u16>,
    }

    impl IconCache {
        fn load(window: &tauri::WebviewWindow) -> Result<Self, String> {
            let bytes = [
                include_bytes!("../icons/icon.ico").as_slice(),
                include_bytes!("../icons/icon-dark.ico").as_slice(),
            ];
            let themes = [ThemeIcons::load(bytes[0])?, ThemeIcons::load(bytes[1])?];
            let root = match &window.state::<crate::StartupTiming>().benchmark_root {
                Some(root) => root.clone(),
                None => window
                    .path()
                    .app_local_data_dir()
                    .map_err(|e| e.to_string())?,
            };
            // Shell needs an actual file. Version the resource path so Explorer
            // cannot retain artwork from a previous release at the same path.
            let root = root
                .join("branding")
                .join(window.package_info().version.to_string());
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            let mut resources = [String::new(), String::new()];
            for (index, name) in ["scribly-light.ico", "scribly-dark.ico"].iter().enumerate() {
                let path = root.join(name);
                if crate::files::read_bounded(&path, bytes[index].len())
                    .ok()
                    .as_deref()
                    != Some(bytes[index])
                {
                    crate::files::replace(&path, bytes[index]).map_err(|e| e.to_string())?;
                }
                resources[index] = format!("{},0", path.display());
            }
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let relaunch = std::iter::once(b'"' as u16)
                .chain(exe.as_os_str().encode_wide())
                .chain([b'"' as u16, 0])
                .collect();
            Ok(Self {
                themes,
                resources,
                relaunch,
            })
        }
    }

    fn set_shell_text(
        store: &IPropertyStore,
        key: &PROPERTYKEY,
        text: &[u16],
    ) -> Result<(), String> {
        // Use the COM allocator expected by Shell's property normalization.
        // Never expose Rust-owned memory as a writable Windows string variant.
        let string = unsafe { SHStrDupW(PCWSTR(text.as_ptr())) }.map_err(|e| e.to_string())?;
        let mut value = PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_LPWSTR,
                    Anonymous: PROPVARIANT_0_0_0 { pwszVal: string },
                    ..Default::default()
                }),
            },
        };
        // SAFETY: the variant owns a Windows-allocated NUL-terminated string;
        // SetValue copies it. Clear that owned variant on success and failure.
        unsafe {
            let result = store.SetValue(key, &value).map_err(|e| e.to_string());
            let cleared = PropVariantClear(&mut value).map_err(|e| e.to_string());
            result.and(cleared)
        }
    }

    // Clear the window property store while HWND is still valid, on every
    // destruction path (including app.exit and a successful frontend close).
    unsafe extern "system" fn cleanup_shell_properties(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        _: usize,
    ) -> LRESULT {
        // SAFETY: Windows invokes the subclass on the owning UI thread with a
        // live HWND. Clear before forwarding its final destruction message.
        unsafe {
            if message == WM_NCDESTROY {
                if let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd) {
                    for key in SHELL_KEYS {
                        let _ = store.SetValue(&key, &PROPVARIANT::default());
                    }
                }
                let _ = RemoveWindowSubclass(hwnd, Some(cleanup_shell_properties), id);
            }
            DefSubclassProc(hwnd, message, wparam, lparam)
        }
    }

    // Store owned handles as integers so managed state is Send + Sync. All icon
    // creation/assignment runs on the UI thread; the mutex guards their lifetime.
    struct OwnedIcon(usize);
    impl Drop for OwnedIcon {
        fn drop(&mut self) {
            // SAFETY: this non-null handle was created by CreateIconFromResourceEx,
            // belongs to this wrapper, and is destroyed once after cached use.
            unsafe {
                DestroyIcon(self.0 as HICON);
            }
        }
    }

    pub(super) struct ThemeIcons {
        small: OwnedIcon,
        large: OwnedIcon,
    }
    impl ThemeIcons {
        fn load(bytes: &[u8]) -> Result<Self, String> {
            // SAFETY: GetSystemMetrics has no pointer/lifetime preconditions.
            Ok(Self {
                // Windows 11 can ignore a caption-sized ICON_SMALL for its
                // taskbar, even when ICON_BIG and Shell metadata are updated.
                // Use the bundled 256px frame here; Windows downsamples it for
                // the caption/taskbar. Cache both themes instead of decoding
                // or allocating a new icon on every appearance change.
                small: create_icon(bytes, 256)?,
                large: create_icon(bytes, unsafe { GetSystemMetrics(SM_CXICON) })?,
            })
        }
    }

    // ICO files contain an image directory followed by individual DIB/PNG
    // resources. Pick the nearest frame at least as large as the Windows metric.
    fn icon_resource(bytes: &[u8], size: i32) -> Result<&[u8], String> {
        let invalid = || "Invalid bundled app icon".to_string();
        if bytes.get(..4) != Some(&[0, 0, 1, 0]) {
            return Err(invalid());
        }
        let count =
            u16::from_le_bytes(bytes.get(4..6).ok_or_else(invalid)?.try_into().unwrap()) as usize;
        let entries = bytes.get(6..6 + count * 16).ok_or_else(invalid)?;
        let entry = entries
            .as_chunks::<16>()
            .0
            .iter()
            .min_by_key(|entry| {
                let width = if entry[0] == 0 {
                    256
                } else {
                    i32::from(entry[0])
                };
                (width < size, (width - size).abs())
            })
            .ok_or_else(invalid)?;
        let length = u32::from_le_bytes(entry[8..12].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(entry[12..16].try_into().unwrap()) as usize;
        let end = offset.checked_add(length).ok_or_else(invalid)?;
        bytes
            .get(offset..end)
            .filter(|image| !image.is_empty())
            .ok_or_else(invalid)
    }

    fn create_icon(bytes: &[u8], size: i32) -> Result<OwnedIcon, String> {
        let resource = icon_resource(bytes, size)?;
        // Win32 requires a DWORD-aligned resource; ICO file offsets need not be.
        let aligned: Vec<u32> = resource
            .chunks(4)
            .map(|chunk| {
                let mut word = [0; 4];
                word[..chunk.len()].copy_from_slice(chunk);
                u32::from_ne_bytes(word)
            })
            .collect();
        let handle = unsafe {
            // SAFETY: the resource is bounded and DWORD-aligned; the allocation
            // remains alive for the synchronous call. Win32 copies the resource.
            CreateIconFromResourceEx(
                aligned.as_ptr().cast(),
                resource.len() as u32,
                1,
                0x00030000,
                size,
                size,
                0,
            )
        };
        if handle.is_null() {
            Err(format!(
                "Could not load the app icon: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(OwnedIcon(handle as usize))
        }
    }

    pub(super) fn update(window: &tauri::WebviewWindow, dark: bool) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let state = window.state::<AppIcons>();
        let mut cache = state.icons.lock().map_err(|e| e.to_string())?;
        if cache.is_none() {
            let loaded = IconCache::load(window)?;
            // SAFETY: update is on the HWND's UI thread. The callback has no
            // borrowed context, and removes itself during WM_NCDESTROY.
            if !unsafe { SetWindowSubclass(hwnd, Some(cleanup_shell_properties), SUBCLASS_ID, 0) }
                .as_bool()
            {
                return Err("Could not attach taskbar icon cleanup".into());
            }
            *cache = Some(loaded);
        }
        let cache = cache.as_ref().unwrap();
        let theme = usize::from(dark);
        let icons = &cache.themes[theme];
        // Set the relaunch fields before the explicit AppUserModelID; without
        // that ID Windows ignores RelaunchIconResource for the taskbar group.
        // SetValue publishes immediately; Commit is unnecessary for this store.
        let store = unsafe {
            // SAFETY: hwnd is live and this runs on its UI/COM thread.
            SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd)
        }
        .map_err(|e| e.to_string())?;
        set_shell_text(&store, &SHELL_KEYS[0], &cache.relaunch)?;
        for (key, text) in [
            (&SHELL_KEYS[1], "Scribly"),
            (&SHELL_KEYS[2], cache.resources[theme].as_str()),
            (&SHELL_KEYS[3], window.config().identifier.as_str()),
        ] {
            let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
            set_shell_text(&store, key, &wide)?;
        }
        // ICON_SMALL = 0, ICON_BIG = 1. Keep handles alive across switches;
        // WM_SETICON does not take ownership and returns the previous handle.
        unsafe {
            // SAFETY: update runs on the window's UI thread, hwnd comes from the
            // live Tauri window, and cached icon handles outlive both assignments.
            SendMessageW(hwnd.0 as _, WM_SETICON, 0, icons.small.0 as isize);
            SendMessageW(hwnd.0 as _, WM_SETICON, 1, icons.large.0 as isize);
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn shell_values_are_copied_and_cleared_before_window_destruction() {
            use ::windows::{
                core::w,
                Win32::{
                    System::{
                        Com::{
                            CoInitializeEx, CoUninitialize, StructuredStorage::PropVariantClear,
                            COINIT_APARTMENTTHREADED,
                        },
                        Variant::VT_EMPTY,
                    },
                    UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow},
                },
            };
            struct Apartment;
            impl Drop for Apartment {
                fn drop(&mut self) {
                    unsafe {
                        CoUninitialize();
                    }
                }
            }
            struct TestWindow(Option<HWND>);
            impl Drop for TestWindow {
                fn drop(&mut self) {
                    if let Some(hwnd) = self.0 {
                        let _ = unsafe { DestroyWindow(hwnd) };
                    }
                }
            }
            // SAFETY: this test owns its hidden window and COM apartment on the
            // current thread. Returned variants are cleared and HWND destroyed.
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
                let _apartment = Apartment;
                let hwnd = CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!("Scribly icon test"),
                    Default::default(),
                    0,
                    0,
                    1,
                    1,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap();
                let mut window = TestWindow(Some(hwnd));
                assert!(
                    SetWindowSubclass(hwnd, Some(cleanup_shell_properties), SUBCLASS_ID, 0)
                        .as_bool()
                );
                let store = SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd).unwrap();
                for key in SHELL_KEYS {
                    let text: Vec<u16> = "Scribly test".encode_utf16().chain([0]).collect();
                    set_shell_text(&store, &key, &text).unwrap();
                    drop(text);
                    let mut value = store.GetValue(&key).unwrap();
                    assert_eq!(value.Anonymous.Anonymous.vt, VT_LPWSTR);
                    assert_eq!(
                        value
                            .Anonymous
                            .Anonymous
                            .Anonymous
                            .pwszVal
                            .to_string()
                            .unwrap(),
                        "Scribly test"
                    );
                    PropVariantClear(&mut value).unwrap();
                }
                DestroyWindow(hwnd).unwrap();
                window.0 = None;
                for key in SHELL_KEYS {
                    let mut value = store.GetValue(&key).unwrap();
                    assert_eq!(value.Anonymous.Anonymous.vt, VT_EMPTY);
                    PropVariantClear(&mut value).unwrap();
                }
            }
        }
        #[test]
        fn bundled_themes_load_at_windows_icon_sizes() {
            for bytes in [
                include_bytes!("../icons/icon.ico").as_slice(),
                include_bytes!("../icons/icon-dark.ico").as_slice(),
            ] {
                ThemeIcons::load(bytes).unwrap();
                assert_ne!(create_icon(bytes, 48).unwrap().0, 0);
            }
        }
        #[test]
        fn truncated_icon_directory_and_out_of_bounds_frame_are_rejected() {
            for bytes in [
                &[][..],
                &[0, 0, 1, 0, 1, 0][..],
                &[
                    0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 255, 255, 255, 255, 255, 255, 255,
                    255,
                ][..],
            ] {
                assert!(icon_resource(bytes, 16).is_err());
            }
        }
    }
}

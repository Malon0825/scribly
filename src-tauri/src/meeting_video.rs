//! Optional local screen/window video. AI receives only the transcript.
#[cfg(windows)]
mod native {
    use crate::{
        meeting_recorder::{Clock, Device},
        meetings::MAX_MEDIA,
    };
    use std::{
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::Duration,
    };
    use windows_capture::{
        capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
        encoder::{
            AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
        },
        frame::Frame,
        graphics_capture_api::InternalCaptureControl,
        monitor::Monitor,
        settings::{
            ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
            MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
        },
        window::Window,
    };
    pub(crate) fn sources() -> Result<Vec<Device>, String> {
        let mut items = vec![];
        for monitor in Monitor::enumerate().map_err(|e| e.to_string())? {
            items.push(Device::video(
                format!("monitor:{}", monitor.index().map_err(|e| e.to_string())?),
                format!(
                    "Screen · {}",
                    monitor.name().unwrap_or_else(|_| "Display".into())
                ),
            ));
        }
        // Use a window title rather than a transient enumeration index; ambiguous titles are rejected at start.
        for window in Window::enumerate().map_err(|e| e.to_string())? {
            if let Ok(title) = window.title() {
                if !title.trim().is_empty() {
                    items.push(Device::video(
                        format!("window:{title}"),
                        format!("Window · {title}"),
                    ));
                }
            }
        }
        Ok(items)
    }
    pub(crate) struct Flags {
        path: PathBuf,
        clock: Arc<Mutex<Clock>>,
        error: Arc<Mutex<Option<String>>>,
    }
    pub(crate) struct Handler {
        flags: Flags,
        encoder: Option<VideoEncoder>,
        size: Option<(u32, u32)>,
        last: f64,
        scratch: Vec<u8>,
        last_frame: Vec<u8>,
    }
    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Flags;
        type Error = String;
        fn new(ctx: Context<Flags>) -> Result<Self, String> {
            Ok(Self {
                flags: ctx.flags,
                encoder: None,
                size: None,
                last: -1.0,
                scratch: vec![],
                last_frame: vec![],
            })
        }
        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            control: InternalCaptureControl,
        ) -> Result<(), String> {
            let result = self.frame(frame);
            if let Err(error) = result {
                *self.flags.error.lock().map_err(|e| e.to_string())? = Some(error);
                control.stop();
            }
            Ok(())
        }
        fn on_closed(&mut self) -> Result<(), String> {
            *self.flags.error.lock().map_err(|e| e.to_string())? =
                Some("The selected window or display closed".into());
            Ok(())
        }
    }
    impl Handler {
        fn frame(&mut self, frame: &mut Frame) -> Result<(), String> {
            let clock = self.flags.clock.lock().map_err(|e| e.to_string())?;
            if clock.is_paused() {
                return Ok(());
            }
            let elapsed = clock.elapsed();
            drop(clock);
            if elapsed - self.last < 1.0 / 15.0 {
                return Ok(());
            }
            self.last = elapsed;
            let size = (frame.width(), frame.height());
            if size.0 == 0 || size.1 == 0 || size.0 > 7680 || size.1 > 4320 {
                return Err("Unsupported capture size".into());
            }
            if self.size.is_some_and(|previous| previous != size) {
                return Err("Capture dimensions changed. Video stopped; audio continued.".into());
            }
            if self.encoder.is_none() {
                let mut encoder = VideoEncoder::new(
                    VideoSettingsBuilder::new(size.0, size.1).frame_rate(15),
                    AudioSettingsBuilder::default().disabled(true),
                    ContainerSettingsBuilder::default(),
                    &self.flags.path,
                )
                .map_err(|e| e.to_string())?;
                // Seed timestamp zero so audio and video share the recording clock.
                encoder
                    .send_frame_buffer(&vec![0; size.0 as usize * size.1 as usize * 4], 0)
                    .map_err(|e| e.to_string())?;
                self.encoder = Some(encoder);
                self.size = Some(size);
            }
            if self
                .flags
                .path
                .metadata()
                .is_ok_and(|m| m.len() > MAX_MEDIA)
            {
                return Err("Video reached the 2 GiB limit".into());
            }
            let buffer = frame.buffer().map_err(|e| e.to_string())?;
            let pixels = buffer.as_nopadding_buffer(&mut self.scratch);
            // Raw Media Foundation input expects bottom-up BGRA.
            let stride = size.0 as usize * 4;
            let mut bottom_up = Vec::with_capacity(pixels.len());
            for row in pixels.chunks_exact(stride).rev() {
                bottom_up.extend_from_slice(row);
            }
            if let Some(encoder) = &mut self.encoder {
                encoder
                    .send_frame_buffer(&bottom_up, (elapsed * 10_000_000.0) as i64)
                    .map_err(|e| e.to_string())?;
            }
            self.last_frame = bottom_up;
            Ok(())
        }
    }
    pub(crate) struct Video {
        capture: Option<CaptureControl<Handler, String>>,
        error: Arc<Mutex<Option<String>>>,
    }
    impl Video {
        pub(crate) fn error(&self) -> Option<String> {
            self.error.lock().ok().and_then(|e| e.clone())
        }
        pub(crate) fn finish(mut self) -> Result<(), String> {
            self.finalize()
        }
        fn finalize(&mut self) -> Result<(), String> {
            let Some(capture) = self.capture.take() else {
                return Ok(());
            };
            let callback = capture.callback();
            let stopped = capture.stop().map_err(|e| e.to_string());
            let mut handler = callback.lock();
            let end = handler
                .flags
                .clock
                .lock()
                .map_err(|e| e.to_string())?
                .elapsed();
            let pixels = std::mem::take(&mut handler.last_frame);
            if self.error().is_none() && end > handler.last && !pixels.is_empty() {
                if let Some(encoder) = &mut handler.encoder {
                    encoder
                        .send_frame_buffer(&pixels, (end * 10_000_000.0) as i64)
                        .map_err(|e| e.to_string())?;
                }
            }
            let encoder = handler.encoder.take();
            drop(handler);
            let finalized = encoder
                .ok_or("No video frames were captured")?
                .finish()
                .map_err(|e| format!("Video could not be finalized: {e}"));
            stopped.and(finalized)
        }
    }
    impl Drop for Video {
        fn drop(&mut self) {
            let _ = self.finalize();
        }
    }
    pub(crate) fn start(
        source: &str,
        directory: &Path,
        clock: Arc<Mutex<Clock>>,
    ) -> Result<Video, String> {
        let error = Arc::new(Mutex::new(None));
        let flags = Flags {
            path: directory.join("video.mp4"),
            clock,
            error: error.clone(),
        };
        fn settings<T: TryInto<windows_capture::settings::GraphicsCaptureItemType>>(
            item: T,
            flags: Flags,
        ) -> Settings<Flags, T> {
            Settings::new(
                item,
                CursorCaptureSettings::WithCursor,
                DrawBorderSettings::WithBorder,
                SecondaryWindowSettings::Exclude,
                MinimumUpdateIntervalSettings::Custom(Duration::from_millis(66)),
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            )
        }
        let capture = if let Some(index) = source.strip_prefix("monitor:") {
            Handler::start_free_threaded(settings(
                Monitor::from_index(index.parse().map_err(|_| "Invalid display")?)
                    .map_err(|e| e.to_string())?,
                flags,
            ))
            .map_err(|e| e.to_string())?
        } else if let Some(title) = source.strip_prefix("window:") {
            let matches: Vec<_> = Window::enumerate()
                .map_err(|e| e.to_string())?
                .into_iter()
                .filter(|w| w.title().is_ok_and(|t| t == title))
                .collect();
            if matches.len() != 1 {
                return Err(
                    "The selected window disappeared or its title is ambiguous. Refresh sources."
                        .into(),
                );
            }
            Handler::start_free_threaded(settings(matches[0], flags)).map_err(|e| e.to_string())?
        } else {
            return Err("Invalid video source".into());
        };
        Ok(Video {
            capture: Some(capture),
            error,
        })
    }
}
#[cfg(windows)]
pub(crate) use native::*;
#[cfg(not(windows))]
pub(crate) fn sources() -> Result<Vec<crate::meeting_recorder::Device>, String> {
    Ok(vec![])
}

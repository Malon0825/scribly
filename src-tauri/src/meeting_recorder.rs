//! Capture runs outside the WebView. PCM tracks are flushed during recording and
//! kept until final WAVs have been written, so a crash never requires a WAV header.
use crate::meetings::{self, Meeting, MeetingState};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const RATE: u32 = 16_000;
const MAX_SECONDS: f64 = 4.0 * 3600.0;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Device {
    id: String,
    name: String,
    kind: String,
}
pub(crate) struct Clock {
    started: Instant,
    paused_at: Option<Instant>,
    paused: Duration,
    last_voice: f64,
    #[cfg(windows)]
    qpc: u64,
}
impl Clock {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            paused_at: None,
            paused: Duration::ZERO,
            last_voice: 0.0,
            #[cfg(windows)]
            qpc: qpc_time(),
        }
    }
    pub(crate) fn elapsed(&self) -> f64 {
        (self.paused_at.unwrap_or_else(Instant::now) - self.started - self.paused).as_secs_f64()
    }
    pub(crate) fn is_paused(&self) -> bool {
        self.paused_at.is_some()
    }
    pub(crate) fn voice(&mut self) {
        if !self.is_paused() {
            self.last_voice = self.elapsed();
        }
    }
    fn set_paused(&mut self, paused: bool) {
        match (paused, self.paused_at) {
            (true, None) => self.paused_at = Some(Instant::now()),
            (false, Some(start)) => {
                self.paused += start.elapsed();
                self.paused_at = None;
            }
            _ => {}
        }
    }
}
#[cfg(windows)]
fn qpc_time() -> u64 {
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
    let mut counter = 0i64;
    let mut frequency = 0i64;
    if unsafe { QueryPerformanceCounter(&mut counter) }.is_err()
        || unsafe { QueryPerformanceFrequency(&mut frequency) }.is_err()
        || frequency <= 0
    {
        return 0;
    }
    (counter as u128 * 10_000_000 / frequency as u128) as u64
}
pub(crate) struct Recorder {
    pub id: String,
    stop: Arc<AtomicBool>,
    clock: Arc<Mutex<Clock>>,
    thread: JoinHandle<Result<(), String>>,
    live: Option<crate::meeting_live::LiveHandle>,
}
#[tauri::command]
pub(crate) async fn meeting_devices() -> Result<Vec<Device>, String> {
    tauri::async_runtime::spawn_blocking(devices)
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(windows)]
fn devices() -> Result<Vec<Device>, String> {
    use wasapi::{DeviceEnumerator, Direction};
    wasapi::initialize_mta().ok().map_err(|e| e.to_string())?;
    let result = (|| {
        let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
        let mut items = vec![];
        for (direction, kind) in [
            (Direction::Capture, "microphone"),
            (Direction::Render, "system"),
        ] {
            let collection = enumerator
                .get_device_collection(&direction)
                .map_err(|e| e.to_string())?;
            for index in 0..collection.get_nbr_devices().map_err(|e| e.to_string())? {
                let device = collection
                    .get_device_at_index(index)
                    .map_err(|e| e.to_string())?;
                items.push(Device {
                    id: device.get_id().map_err(|e| e.to_string())?,
                    name: device.get_friendlyname().map_err(|e| e.to_string())?,
                    kind: kind.into(),
                });
            }
        }
        items.extend(crate::meeting_video::sources()?);
        Ok(items)
    })();
    wasapi::deinitialize();
    result
}
#[cfg(not(windows))]
fn devices() -> Result<Vec<Device>, String> {
    Err("Recording requires the Windows desktop app".into())
}
impl Device {
    pub(crate) fn video(id: String, name: String) -> Self {
        Self {
            id,
            name,
            kind: "video".into(),
        }
    }
}
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri keeps each recording option as a named IPC argument.
pub(crate) async fn meeting_start(
    app: tauri::AppHandle,
    title: String,
    note_id: Option<String>,
    microphone: Option<String>,
    system: Option<String>,
    video: Option<String>,
    consent: bool,
    language: Option<String>,
    auto_notes: Option<bool>,
    model: Option<String>,
    transcription_model: Option<String>,
) -> Result<Meeting, String> {
    if !consent {
        return Err("Confirm permission from participants before recording".into());
    }
    if microphone.is_none() && system.is_none() {
        return Err("Choose at least one audio source".into());
    }
    if model
        .as_ref()
        .is_some_and(|model| model.is_empty() || model.len() > 100)
    {
        return Err("Invalid meeting notes model".into());
    }
    let preferences = {
        let state = app.state::<MeetingState>();
        let _guard = state.credentials.lock().await;
        crate::meeting_auth::read(&app)?.preferences
    };
    let transcription_model = transcription_model.unwrap_or(preferences.transcription_model);
    if !crate::meeting_auth::valid_transcription_model(&transcription_model) {
        return Err("Invalid transcription model".into());
    }
    let model = model.or_else(|| {
        if preferences.request_provider == "gemini" {
            Some(crate::meeting_gemini::FLASH.into())
        } else if preferences.request_provider == "openrouter" {
            Some(crate::meeting_openrouter::MODEL.into())
        } else {
            preferences.chatgpt_model
        }
    });
    if transcription_model == "gemini-3.5-transcribe" {
        crate::meeting_auth::gemini_key(&app).await?;
    }
    let socket = if let Some(language) = language
        .as_deref()
        .filter(|_| transcription_model != "gemini-3.5-transcribe")
    {
        Some(crate::meeting_live::connect(&app, language, &transcription_model).await?)
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let mut active = state.recorder.lock().map_err(|e| e.to_string())?;
        if active
            .as_ref()
            .is_some_and(|recorder| recorder.thread.is_finished())
        {
            if let Some(recorder) = active.take() {
                let _ = recorder.thread.join();
            }
        }
        if active.is_some() {
            return Err("A recording is already active".into());
        }
        let mut meeting = Meeting::new(
            if title.trim().is_empty() {
                "Meeting".into()
            } else {
                title
            },
            note_id,
        );
        let directory = meetings::folder(&crate::commands::attachment_root(&app)?, &meeting.id)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        meeting.recording = "recording".into();
        meeting.live_transcription = socket.is_some();
        meeting.auto_notes = auto_notes.unwrap_or(false);
        meeting.notes_model = model;
        meeting.transcription_model = Some(transcription_model);
        meeting.transcription_language = language;
        meetings::save(&app, &meeting)?;
        let stop = Arc::new(AtomicBool::new(false));
        let clock = Arc::new(Mutex::new(Clock::new()));
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let handle = app.clone();
        let id = meeting.id.clone();
        let stop_thread = stop.clone();
        let clock_thread = clock.clone();
        let microphone_enabled = microphone.is_some();
        let system_enabled = system.is_some();
        let thread = std::thread::spawn(move || {
            let result = capture(
                &handle,
                &id,
                &directory,
                microphone,
                system,
                video,
                stop_thread,
                clock_thread,
                ready_tx,
            );
            if let Err(error) = &result {
                let _ = meetings::modify(&handle, &id, |saved| {
                    saved.recording = "interrupted".into();
                    saved.error = Some(format!("{error}. Recover any saved audio below."));
                    Ok(())
                });
            } else if meetings::load(&handle, &id)
                .is_ok_and(|meeting| meeting.stop_reason.as_deref() == Some("silence"))
            {
                let app = handle.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = crate::meeting_recorder::stop(&app);
                });
            }
            result
        });
        *active = Some(Recorder {
            id: meeting.id.clone(),
            stop,
            clock,
            thread,
            live: None,
        });
        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => {
                if let Some(socket) = socket {
                    if let Some(recorder) = active.as_mut() {
                        recorder.live = Some(crate::meeting_live::start(
                            app.clone(),
                            meeting.id.clone(),
                            &meetings::folder(
                                &crate::commands::attachment_root(&app)?,
                                &meeting.id,
                            )?,
                            microphone_enabled,
                            system_enabled,
                            recorder.clock.clone(),
                            socket,
                        ));
                    }
                }
                Ok(meeting)
            }
            outcome => {
                if let Some(recorder) = active.take() {
                    recorder.stop.store(true, Ordering::Relaxed);
                    let _ = recorder.thread.join();
                }
                Err(match outcome {
                    Ok(Err(error)) => error,
                    _ => "Recording could not start. Check your devices and Windows permissions."
                        .into(),
                })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_pause(
    app: tauri::AppHandle,
    id: String,
    paused: bool,
) -> Result<Meeting, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let active = state.recorder.lock().map_err(|e| e.to_string())?;
        let recorder = active
            .as_ref()
            .filter(|r| r.id == id)
            .ok_or("Recording is not active")?;
        if recorder.thread.is_finished() {
            return Err("Recording was interrupted. Stop and recover it.".into());
        }
        let mut clock = recorder.clock.lock().map_err(|e| e.to_string())?;
        let meeting = meetings::modify(&app, &id, |meeting| {
            meeting.recording = if paused { "paused" } else { "recording" }.into();
            meeting.duration = clock.elapsed();
            Ok(())
        })?;
        clock.set_paused(paused);
        Ok(meeting)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn stop(app: &tauri::AppHandle) -> Result<Option<Meeting>, String> {
    let state = app.state::<MeetingState>();
    let recorder = {
        let mut active = state.recorder.lock().map_err(|e| e.to_string())?;
        let mut finalizing = state.finalizing.lock().map_err(|e| e.to_string())?;
        if let Some(recorder) = active.as_ref() {
            finalizing.insert(recorder.id.clone());
        }
        active.take()
    };
    let Some(recorder) = recorder else {
        return Ok(None);
    };
    // Streaming completion can take seconds. List/recovery/delete must not
    // mistake a recorder being finalized for a recording lost in a crash.
    struct Finalizing<'a> {
        state: &'a MeetingState,
        id: &'a str,
    }
    impl Drop for Finalizing<'_> {
        fn drop(&mut self) {
            if let Ok(mut ids) = self.state.finalizing.lock() {
                ids.remove(self.id);
            }
        }
    }
    let _finalizing = Finalizing {
        state: &state,
        id: &recorder.id,
    };
    recorder.stop.store(true, Ordering::Relaxed);
    let result = recorder
        .thread
        .join()
        .map_err(|_| "Recording thread stopped unexpectedly")?;
    let live_error = recorder.live.and_then(|live| live.finish().err());
    let mut meeting = meetings::load(app, &recorder.id)?;
    let directory = meetings::folder(&crate::commands::attachment_root(app)?, &recorder.id)?;
    finalize(&directory, &mut meeting)?;
    meeting.recording = "saved".into();
    if meeting.stop_reason.is_none() {
        meeting.stop_reason = Some("manual".into());
    }
    if let Some(error) = live_error {
        meeting.error = Some(error);
    }
    if let Err(error) = result {
        meeting.error = Some(format!(
            "Recording ended early: {error}. Saved audio is available."
        ));
    }
    meetings::save(app, &meeting)?;
    if meeting.stop_reason.as_deref() == Some("silence") {
        crate::meeting_silence::notify(app, &meeting.id);
    }
    if meeting.auto_notes {
        if meeting.live_transcription && !meeting.live_complete {
            meeting.notes_status = "failed".into();
            meeting.error = Some("Live transcription was incomplete. Recording retained; transcribe explicitly before generating missing meeting notes.".into());
            meetings::save(app, &meeting)?;
        } else {
            crate::meeting_providers::launch_notes(app, &meeting.id)?;
        }
    }
    Ok(Some(meeting))
}
#[tauri::command]
pub(crate) async fn meeting_stop(app: tauri::AppHandle) -> Result<Option<Meeting>, String> {
    tauri::async_runtime::spawn_blocking(move || stop(&app))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_recover(app: tauri::AppHandle, id: String) -> Result<Meeting, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let mut active = state.recorder.lock().map_err(|e| e.to_string())?;
        if state
            .finalizing
            .lock()
            .map_err(|e| e.to_string())?
            .contains(&id)
        {
            return Err("Wait for recording to finish saving before recovery".into());
        }
        if active
            .as_ref()
            .is_some_and(|r| r.id == id && !r.thread.is_finished())
        {
            return Err("Stop the active recording first".into());
        }
        if active.as_ref().is_some_and(|r| r.id == id) {
            if let Some(recorder) = active.take() {
                let _ = recorder.thread.join();
            }
        }
        let mut meeting = meetings::load(&app, &id)?;
        if meeting.recording != "interrupted" {
            return Err("This recording does not need recovery".into());
        }
        finalize(
            &meetings::folder(&crate::commands::attachment_root(&app)?, &id)?,
            &mut meeting,
        )?;
        meeting.recording = "saved".into();
        meeting.error = Some(
            "Recovered audio up to the last saved packet. An interrupted video may be incomplete."
                .into(),
        );
        meetings::save(&app, &meeting)?;
        Ok(meeting)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn finalize(directory: &Path, meeting: &mut Meeting) -> Result<(), String> {
    let paths = [
        directory.join("microphone.pcm"),
        directory.join("system.pcm"),
    ];
    let lengths: Vec<u64> = paths
        .iter()
        .map(|p| fs::metadata(p).map_or(0, |m| m.len() / 2))
        .collect();
    let samples = *lengths.iter().max().unwrap_or(&0);
    if samples == 0 {
        return Err(
            "No audio packets were saved. Check devices before starting a new recording.".into(),
        );
    }
    if samples > RATE as u64 * MAX_SECONDS as u64 + RATE as u64 {
        return Err("Recovery audio exceeds the supported duration".into());
    }
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut readers: Vec<Option<File>> = paths.iter().map(|p| File::open(p).ok()).collect();
    let mut tracks: Vec<Option<hound::WavWriter<std::io::BufWriter<File>>>> = paths
        .iter()
        .enumerate()
        .map(|(i, _)| {
            if readers[i].is_some() {
                hound::WavWriter::create(
                    directory.join(if i == 0 {
                        "microphone.wav"
                    } else {
                        "system.wav"
                    }),
                    spec,
                )
                .map(Some)
                .map_err(|e| e.to_string())
            } else {
                Ok(None)
            }
        })
        .collect::<Result<_, String>>()?;
    let temporary = directory.join("audio-finalizing.wav");
    let mut mixed = hound::WavWriter::create(&temporary, spec).map_err(|e| e.to_string())?;
    // Bounded buffers keep long recordings out of memory.
    let mut buffers = [vec![0u8; 16_384], vec![0u8; 16_384]];
    let mut position = 0;
    while position < samples {
        let count = (samples - position).min(8192) as usize;
        for (index, reader) in readers.iter_mut().enumerate() {
            buffers[index][..count * 2].fill(0);
            let available = lengths[index].saturating_sub(position).min(count as u64) as usize;
            if let Some(reader) = reader {
                reader
                    .read_exact(&mut buffers[index][..available * 2])
                    .map_err(|e| e.to_string())?;
            }
        }
        for offset in 0..count {
            let a = i16::from_le_bytes([buffers[0][offset * 2], buffers[0][offset * 2 + 1]]);
            let b = i16::from_le_bytes([buffers[1][offset * 2], buffers[1][offset * 2 + 1]]);
            for (index, sample) in [a, b].into_iter().enumerate() {
                if let Some(track) = &mut tracks[index] {
                    track.write_sample(sample).map_err(|e| e.to_string())?;
                }
            }
            mixed
                .write_sample((a as i32 + b as i32).clamp(i16::MIN as i32, i16::MAX as i32) as i16)
                .map_err(|e| e.to_string())?;
        }
        position += count as u64;
    }
    mixed.finalize().map_err(|e| e.to_string())?;
    for track in tracks.into_iter().flatten() {
        track.finalize().map_err(|e| e.to_string())?;
    }
    crate::files::replace_with(&directory.join("audio.wav"), |target| {
        std::io::copy(&mut File::open(&temporary)?, target).map(|_| ())
    })
    .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(temporary);
    meeting.media = Some("audio.wav".into());
    meeting.duration = samples as f64 / RATE as f64;
    if meeting.video.is_none()
        && directory
            .join("video.mp4")
            .metadata()
            .is_ok_and(|file| file.len() > 0)
    {
        meeting.video = Some("video.mp4".into());
    }
    // PCM is deliberately retained as the recovery source until meeting deletion.
    Ok(())
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn capture(
    app: &tauri::AppHandle,
    id: &str,
    directory: &Path,
    microphone: Option<String>,
    system: Option<String>,
    video: Option<String>,
    stop: Arc<AtomicBool>,
    clock: Arc<Mutex<Clock>>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    wasapi::initialize_mta().ok().map_err(|e| e.to_string())?;
    let result = (|| {
        let mut tracks = vec![];
        for (selected, name) in [(microphone, "microphone"), (system, "system")] {
            let Some(selected) = selected else {
                continue;
            };
            let (client, capture, buffer_size) =
                crate::meeting_audio::native::open(&selected, name == "system")
                    .map_err(|e| format!("Cannot record {name}: {e}"))?;
            let file =
                File::create(directory.join(format!("{name}.pcm"))).map_err(|e| e.to_string())?;
            tracks.push((
                client,
                capture,
                file,
                0u64,
                name,
                vec![0u8; buffer_size],
                crate::meeting_silence::SpeechDetector::new(),
            ));
        }
        *clock.lock().map_err(|e| e.to_string())? = Clock::new();
        let mut video_capture = video
            .map(|source| crate::meeting_video::start(&source, directory, clock.clone()))
            .transpose()?;
        for (client, ..) in &tracks {
            client.start_stream().map_err(|e| e.to_string())?;
        }
        let _ = ready.send(Ok(()));
        let mut flushed = Instant::now();
        let mut feedback = Instant::now();
        let mut warning = None;
        let mut silence = crate::meeting_silence::SilenceWatchdog::new();
        let recording = (|| -> Result<(), String> {
            while !stop.load(Ordering::Relaxed) {
                let elapsed = clock.lock().map_err(|e| e.to_string())?.elapsed();
                let paused = clock.lock().map_err(|e| e.to_string())?.is_paused();
                silence.voice(clock.lock().map_err(|e| e.to_string())?.last_voice);
                if elapsed >= MAX_SECONDS {
                    return Err("Four-hour recording limit reached".into());
                }
                let mut levels = [0.0f32; 2];
                for (_, capture, file, written, name, buffer, detector) in &mut tracks {
                    while capture
                        .get_next_packet_size()
                        .map_err(|e| format!("{name} was disconnected: {e}"))?
                        .unwrap_or(0)
                        > 0
                    {
                        let (frames, info) = capture
                            .read_from_device(buffer)
                            .map_err(|e| e.to_string())?;
                        if paused {
                            continue;
                        }
                        let count = frames as usize / 3;
                        let timeline = clock.lock().map_err(|e| e.to_string())?;
                        let packet_seconds = if timeline.qpc > 0
                            && !info.flags.timestamp_error
                            && info.timestamp >= timeline.qpc
                        {
                            info.timestamp.saturating_sub(timeline.qpc) as f64 / 10_000_000.0
                                - timeline.paused.as_secs_f64()
                        } else {
                            elapsed - count as f64 / RATE as f64
                        };
                        drop(timeline);
                        let expected = (packet_seconds.max(0.0) * RATE as f64) as u64;
                        // Fill long silence/discontinuities; tolerate polling jitter without stretching audio.
                        if expected > written.saturating_add(RATE as u64 / 20) {
                            let gap = expected - *written;
                            let zeros = [0u8; 4096];
                            let mut bytes = gap * 2;
                            while bytes > 0 {
                                let n = bytes.min(zeros.len() as u64) as usize;
                                file.write_all(&zeros[..n]).map_err(|e| e.to_string())?;
                                let _ = detector.speech(&zeros[..n]);
                                bytes -= n as u64;
                            }
                            *written = expected;
                        }
                        let mut pcm = Vec::with_capacity(count * 2);
                        for frame in 0..count {
                            let mut value = 0.0;
                            if !info.flags.silent {
                                for sample in 0..6 {
                                    let offset = (frame * 6 + sample) * 4;
                                    value += f32::from_le_bytes(
                                        buffer[offset..offset + 4]
                                            .try_into()
                                            .map_err(|_| "Invalid device packet")?,
                                    ) / 6.0;
                                }
                            }
                            let value = if value.is_finite() {
                                value.clamp(-1.0, 1.0)
                            } else {
                                0.0
                            };
                            let channel = usize::from(*name == "system");
                            levels[channel] = levels[channel].max(value.abs());
                            pcm.extend_from_slice(
                                &((value * i16::MAX as f32) as i16).to_le_bytes(),
                            );
                        }
                        if detector.speech(&pcm) {
                            silence.voice(elapsed);
                        }
                        file.write_all(&pcm)
                            .map_err(|e| format!("Recording could not be saved: {e}"))?;
                        *written += count as u64;
                    }
                }
                if feedback.elapsed() >= Duration::from_millis(200) {
                    let _=app.emit("meeting-recording",serde_json::json!({"id":id,"duration":elapsed,"microphone":levels[0],"system":levels[1],"paused":paused,"silentFor":silence.silent_for(elapsed)}));
                    feedback = Instant::now();
                }
                if silence.expired(elapsed, paused) {
                    meetings::modify(app, id, |meeting| {
                        meeting.stop_reason = Some("silence".into());
                        Ok(())
                    })?;
                    break;
                }
                if flushed.elapsed() >= Duration::from_secs(1) {
                    for (_, _, file, written, _, _, detector) in &mut tracks {
                        // Loopback can deliver no packets during silence. Persist a
                        // conservative silence tail so even that session is recoverable.
                        let target = ((elapsed - 0.2).max(0.0) * RATE as f64) as u64;
                        let mut remaining = target.saturating_sub(*written) * 2;
                        let zeros = [0u8; 4096];
                        while remaining > 0 {
                            let count = remaining.min(zeros.len() as u64) as usize;
                            file.write_all(&zeros[..count]).map_err(|e| e.to_string())?;
                            let _ = detector.speech(&zeros[..count]);
                            remaining -= count as u64;
                        }
                        *written = (*written).max(target);
                        file.sync_data()
                            .map_err(|e| format!("Recording could not be saved: {e}"))?;
                    }
                    if let Some(video) = &mut video_capture {
                        if let Some(error) = video.error() {
                            warning = Some(error);
                        }
                    }
                    if directory
                        .join("video.mp4")
                        .metadata()
                        .is_ok_and(|m| m.len() > meetings::MAX_MEDIA)
                    {
                        if let Some(video) = video_capture.take() {
                            let _ = video.finish();
                        }
                        warning = Some("Video reached the 2 GiB limit; audio continued".into());
                    }
                    flushed = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(())
        })();
        let length = (clock.lock().map_err(|e| e.to_string())?.elapsed() * RATE as f64) as u64;
        for (client, _, file, written, ..) in &mut tracks {
            let _ = client.stop_stream();
            // Preserve trailing silence and system-only recordings with no packets.
            let zeros = [0u8; 4096];
            let mut remaining = length.saturating_sub(*written) * 2;
            while remaining > 0 {
                let count = remaining.min(zeros.len() as u64) as usize;
                file.write_all(&zeros[..count]).map_err(|e| e.to_string())?;
                remaining -= count as u64;
            }
            file.sync_all().map_err(|e| e.to_string())?;
        }
        if let Some(video) = video_capture {
            match video.finish() {
                Ok(()) => {
                    meetings::modify(app, id, |meeting| {
                        meeting.video = Some("video.mp4".into());
                        Ok(())
                    })?;
                }
                Err(error) => warning = Some(error),
            }
        }
        if let Some(error) = warning {
            meetings::modify(app, id, |meeting| {
                meeting.error = Some(format!("Video ended early: {error}. Audio was retained."));
                Ok(())
            })?;
        }
        recording
    })();
    if let Err(error) = &result {
        let _ = ready.send(Err(error.clone()));
    }
    wasapi::deinitialize();
    result
}
#[cfg(not(windows))]
#[allow(clippy::too_many_arguments)]
fn capture(
    _: &tauri::AppHandle,
    _: &str,
    _: &Path,
    _: Option<String>,
    _: Option<String>,
    _: Option<String>,
    _: Arc<AtomicBool>,
    _: Arc<Mutex<Clock>>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let error = "Recording requires Windows".to_string();
    let _ = ready.send(Err(error.clone()));
    Err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovers_headerless_tracks_and_clamps_mix() {
        let root =
            std::env::temp_dir().join(format!("scribly-meeting-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("microphone.pcm"),
            [30_000i16.to_le_bytes(), (-30_000i16).to_le_bytes()].concat(),
        )
        .unwrap();
        fs::write(
            root.join("system.pcm"),
            [20_000i16.to_le_bytes(), (-20_000i16).to_le_bytes()].concat(),
        )
        .unwrap();
        let mut meeting = Meeting::new("Recovery".into(), None);
        finalize(&root, &mut meeting).unwrap();
        let reader = hound::WavReader::open(root.join("audio.wav")).unwrap();
        assert_eq!(
            reader
                .into_samples::<i16>()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            vec![i16::MAX, i16::MIN]
        );
        assert_eq!(meeting.duration, 2.0 / RATE as f64);
        assert!(root.join("microphone.pcm").exists());
        fs::remove_dir_all(root).unwrap();
    }
}

//! Disk-fed native worker. Capture writes never wait on inference.
use crate::meetings::{
    self, Meeting, MeetingState, Provenance, Segment, SpeakerSpan, TranscriptWord,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
};
use tokio_util::sync::CancellationToken;

fn runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("moonshine");
    if bundled.join("scribly-moonshine.exe").is_file() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/moonshine");
        if dev.join("scribly-moonshine.exe").is_file() {
            return Ok(dev);
        }
    }
    Err(
        "The packaged Moonshine worker is missing. Reinstall a build with local speech support."
            .into(),
    )
}
fn assets(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("local-ai/moonshine-0.1.5"))
}
fn arch(model: &str) -> Result<u32, String> {
    match model {
        "moonshine" => Ok(5),
        "moonshine-small" => Ok(4),
        _ => Err("Invalid speech model".into()),
    }
}
#[derive(Deserialize)]
struct Manifest {
    speech: Groups,
    diarization: Groups,
}
#[derive(Deserialize)]
struct Groups {
    groups: Vec<Group>,
}
#[derive(Deserialize)]
struct Group {
    files: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    url: String,
    size: u64,
    checksum: String,
    checksum_type: String,
}
fn manifest(app: &tauri::AppHandle, architecture: u32) -> Result<Manifest, String> {
    serde_json::from_slice(
        &crate::files::read_bounded(
            &runtime(app)?.join(format!("assets-{architecture}.json")),
            64_000,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn installed(base: &Path, manifest: &Groups) -> bool {
    manifest.groups.iter().flat_map(|g| &g.files).all(|a| {
        base.join(&a.name)
            .metadata()
            .is_ok_and(|m| m.len() == a.size)
            && base.join(format!("{}.verified", a.name)).is_file()
    })
}
pub(crate) fn status(app: &tauri::AppHandle) -> Result<Value, String> {
    let base = assets(app)?;
    let ready = |n| -> bool {
        manifest(app, n).is_ok_and(|m| {
            installed(&base.join(n.to_string()), &m.speech)
                && installed(&base.join("diarization"), &m.diarization)
        })
    };
    Ok(
        json!({"runtime":runtime(app).is_ok(),"medium":ready(5),"small":ready(4),"version":"0.1.5","language":"English"}),
    )
}
#[tauri::command]
pub(crate) async fn local_speech_status(app: tauri::AppHandle) -> Result<Value, String> {
    status(&app)
}
fn crc32c(mut crc: u32, bytes: &[u8]) -> u32 {
    const fn table() -> [u32; 256] {
        let mut table = [0; 256];
        let mut i = 0;
        while i < 256 {
            let mut c = i as u32;
            let mut bit = 0;
            while bit < 8 {
                c = (c >> 1) ^ (0x82f63b78u32 & (0u32.wrapping_sub(c & 1)));
                bit += 1;
            }
            table[i] = c;
            i += 1;
        }
        table
    }
    const TABLE: [u32; 256] = table();
    for b in bytes {
        crc = TABLE[((crc ^ *b as u32) & 255) as usize] ^ (crc >> 8);
    }
    crc
}
#[tauri::command]
pub(crate) async fn local_speech_setup(
    app: tauri::AppHandle,
    model: String,
) -> Result<Value, String> {
    let state = app.state::<MeetingState>();
    let _setup = state
        .speech_setup
        .try_lock()
        .map_err(|_| "Speech setup is already running")?;
    if state.recorder.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Stop recording before changing speech assets".into());
    }
    let architecture = arch(&model)?;
    let manifest = manifest(&app, architecture)?;
    let base = assets(&app)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    for (folder, groups) in [
        (base.join(architecture.to_string()), manifest.speech),
        (base.join("diarization"), manifest.diarization),
    ] {
        tokio::fs::create_dir_all(&folder)
            .await
            .map_err(|e| e.to_string())?;
        for asset in groups.groups.into_iter().flat_map(|g| g.files) {
            if asset.name.contains(['/', '\\'])
                || asset.size > 200_000_000
                || asset.checksum_type != "crc32c"
                || !asset
                    .url
                    .starts_with("https://download.moonshine.ai/model/")
            {
                return Err("Unsupported speech asset manifest".into());
            }
            let path = folder.join(&asset.name);
            let marker = folder.join(format!("{}.verified", asset.name));
            if path.metadata().is_ok_and(|m| m.len() == asset.size) {
                let check = path.clone();
                let expected = asset.checksum.clone();
                let verified = tauri::async_runtime::spawn_blocking(move || {
                    use std::io::Read;
                    let mut file = std::fs::File::open(check).map_err(|e| e.to_string())?;
                    let mut buffer = [0u8; 65536];
                    let mut crc = u32::MAX;
                    loop {
                        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                        if n == 0 {
                            break;
                        }
                        crc = crc32c(crc, &buffer[..n]);
                    }
                    Ok::<_, String>(STANDARD.encode((!crc).to_be_bytes()) == expected)
                })
                .await
                .map_err(|e| e.to_string())??;
                if verified {
                    crate::files::replace(&marker, asset.checksum.as_bytes())
                        .map_err(|e| e.to_string())?;
                    continue;
                }
                let _ = std::fs::remove_file(&marker);
            }
            let temporary = path.with_extension("download");
            let outcome = async {
                let _ = app.emit(
                    "local-ai-setup",
                    json!({"file":asset.name,"message":"Downloading and verifying speech assets"}),
                );
                let mut response = client
                    .get(&asset.url)
                    .send()
                    .await
                    .map_err(|_| "Speech download failed. Retry setup explicitly.")?;
                if !response.status().is_success() {
                    return Err("Speech asset download was rejected".to_string());
                }
                let mut file = tokio::fs::File::create(&temporary)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut count = 0;
                let mut crc = u32::MAX;
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|_| "Speech download was interrupted")?
                {
                    count += chunk.len() as u64;
                    if count > asset.size {
                        return Err("Speech asset exceeded its size".into());
                    }
                    crc = crc32c(crc, &chunk);
                    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                }
                if count != asset.size || STANDARD.encode((!crc).to_be_bytes()) != asset.checksum {
                    return Err("Speech asset checksum mismatch".into());
                }
                file.sync_all().await.map_err(|e| e.to_string())?;
                drop(file);
                crate::files::replace_with(&path, |target| {
                    std::io::copy(&mut std::fs::File::open(&temporary)?, target).map(|_| ())
                })
                .map_err(|e| e.to_string())?;
                crate::files::replace(&marker, asset.checksum.as_bytes())
                    .map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            }
            .await;
            let _ = tokio::fs::remove_file(&temporary).await;
            outcome?;
        }
    }
    status(&app)
}
pub(crate) struct Worker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    session: String,
}
#[derive(Deserialize)]
struct Line {
    line: String,
    complete: bool,
    start: f64,
    end: f64,
    text: String,
    spans: Vec<SpeakerSpan>,
    words: Vec<TranscriptWord>,
}
impl Line {
    fn discard_unreliable_alignment(&mut self) {
        // The pinned SDK can return reversed/zero-length word intervals even
        // for completed English lines. Optional alignment must not prevent
        // retaining the canonical text or valid audio speaker spans. Its text
        // span offsets depend on that alignment, so use the API's unknown range.
        let mut previous = self.start;
        let reliable = self.words.iter().all(|word| {
            let valid = word.start.is_finite()
                && word.end.is_finite()
                && word.start >= self.start - 0.01
                && word.end <= self.end + 0.01
                && word.end > word.start
                && word.start >= previous - 0.01;
            previous = word.end;
            valid
        });
        if !reliable {
            self.words.clear();
            for span in &mut self.spans {
                span.text_start = 0;
                span.text_end = 0;
            }
        }
    }
}
impl Worker {
    pub(crate) async fn spawn(
        app: &tauri::AppHandle,
        model: &str,
        language: &str,
    ) -> Result<Self, String> {
        if language != "en" {
            return Err(
                "Local Moonshine speech currently supports English. Choose English explicitly."
                    .into(),
            );
        }
        let architecture = arch(model)?;
        let base = assets(app)?;
        let manifest = manifest(app, architecture)?;
        if !installed(&base.join(architecture.to_string()), &manifest.speech)
            || !installed(&base.join("diarization"), &manifest.diarization)
        {
            return Err("Install English speech and speaker assets in Settings → Meeting AI first. You can record without live transcription.".into());
        }
        let mut command = tokio::process::Command::new(runtime(app)?.join("scribly-moonshine.exe"));
        command
            .arg(base.join(architecture.to_string()))
            .arg(base.join("diarization"))
            .arg(architecture.to_string())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|_| "Moonshine worker could not start")?;
        let input = child.stdin.take().ok_or("Worker input unavailable")?;
        let output = BufReader::new(child.stdout.take().ok_or("Worker output unavailable")?);
        let mut worker = Self {
            child,
            input,
            output,
            session: uuid::Uuid::new_v4().to_string(),
        };
        let hello = worker.event().await?;
        if hello["type"] != "hello"
            || hello["protocol"] != 1
            || hello["header"] != 30000
            || hello["runtime"] != 30000
        {
            return Err("Moonshine worker/runtime version mismatch".into());
        }
        if worker.event().await?["type"] != "ready" {
            return Err("Moonshine could not initialize English speech and speaker models".into());
        }
        Ok(worker)
    }
    async fn event(&mut self) -> Result<Value, String> {
        let mut bytes = Vec::new();
        // fill_buf + consume bounds allocation before a hostile/buggy worker newline.
        loop {
            let buffer = tokio::time::timeout(Duration::from_secs(120), self.output.fill_buf())
                .await
                .map_err(|_| {
                    "Speech worker is unresponsive. Audio was retained; resume transcription."
                })?
                .map_err(|_| "Speech worker disconnected")?;
            if buffer.is_empty() {
                return Err(
                    "Speech worker stopped unexpectedly. Audio and completed text were retained."
                        .into(),
                );
            }
            let count = buffer
                .iter()
                .position(|b| *b == b'\n')
                .map_or(buffer.len(), |n| n + 1);
            let done = buffer[count - 1] == b'\n';
            if bytes.len() + count > 262_144 {
                return Err("Speech worker event exceeded its limit".into());
            }
            bytes.extend_from_slice(&buffer[..count]);
            self.output.consume(count);
            if done {
                break;
            }
        }
        serde_json::from_slice(&bytes).map_err(|_| "Speech worker returned malformed data".into())
    }
    async fn packet(&mut self, offset: u64, pcm: &[u8]) -> Result<(), String> {
        if pcm.len() > 32_000 || pcm.len() % 2 != 0 {
            return Err("Invalid speech packet".into());
        }
        self.input
            .write_all(&((pcm.len() + 8) as u32).to_le_bytes())
            .await
            .map_err(|_| "Speech worker input failed")?;
        self.input
            .write_all(&offset.to_le_bytes())
            .await
            .map_err(|_| "Speech worker input failed")?;
        self.input
            .write_all(pcm)
            .await
            .map_err(|_| "Speech worker input failed")?;
        self.input
            .flush()
            .await
            .map_err(|_| "Speech worker input failed".into())
    }
}
pub(crate) fn reduce(
    meeting: &mut Meeting,
    mut segment: Segment,
    replay: bool,
) -> Result<(), String> {
    let mut candidate = segment.clone();
    let provenance = segment
        .provenance
        .as_ref()
        .ok_or("Missing speech provenance")?;
    let exact = meeting.segments.iter().position(|s| {
        s.provenance
            .as_ref()
            .is_some_and(|p| p.session == provenance.session && p.line == provenance.line)
    });
    let existing = exact.or_else(|| {
        replay
            .then(|| {
                meeting.segments.iter().position(|s| {
                    (s.start - segment.start).abs() < 0.35 && (s.end - segment.end).abs() < 0.6
                })
            })
            .flatten()
    });
    if let Some(index) = existing {
        let saved = &meeting.segments[index];
        segment.id = saved.id;
        candidate.id = saved.id;
        if saved.corrected {
            return Ok(());
        }
        if replay && exact.is_none() {
            // New speaker clusters are uncertain: retain prior attribution/names.
            segment.speaker = saved.speaker.clone();
            segment.speaker_spans = saved.speaker_spans.clone();
            if saved.text != segment.text {
                if meeting.replay_candidates.len() < 1000
                    && !meeting
                        .replay_candidates
                        .iter()
                        .any(|s| s.start == candidate.start && s.text == candidate.text)
                {
                    meeting.replay_candidates.push(candidate);
                }
                return Ok(());
            }
        }
        if saved.text != segment.text
            || saved.start != segment.start
            || saved.end != segment.end
            || serde_json::to_value(&saved.speaker_spans).ok()
                != serde_json::to_value(&segment.speaker_spans).ok()
            || saved.speaker != segment.speaker
        {
            meeting.revision += 1;
        }
        meeting.segments[index] = segment;
    } else {
        if replay
            && meeting
                .segments
                .iter()
                .any(|s| s.start < segment.end && s.end > segment.start)
        {
            // Sentinel beyond the canonical transcript cap: an unmatched overlap
            // can only be appended after review, never replace source zero.
            segment.id = 100_000;
            if meeting.replay_candidates.len() < 1000 {
                meeting.replay_candidates.push(segment);
            }
            return Ok(());
        }
        segment.id = meeting.segments.len();
        meeting.segments.push(segment);
        meeting.revision += 1;
    }
    meeting.transcription_cursor = meeting
        .transcription_cursor
        .max((candidate.end * 16000.0) as u64);
    meeting.recovery = None;
    meeting.local_recovery = None;
    Ok(())
}
async fn run(
    app: &tauri::AppHandle,
    id: &str,
    files: &[PathBuf],
    mut worker: Worker,
    finish: CancellationToken,
    clock: Option<Arc<Mutex<crate::meeting_recorder::Clock>>>,
    replay: bool,
) -> Result<(), String> {
    let mut position = 0u64;
    let mut finishing = false;
    let mut interim = String::new();
    loop {
        if finish.is_cancelled() {
            finishing = true;
        }
        let bytes = crate::meeting_live::pcm_tail(files, position, finishing).await?;
        if bytes.is_empty() && !finishing {
            tokio::select! { _=finish.cancelled()=>finishing=true, _=tokio::time::sleep(Duration::from_millis(100))=>{} }
            continue;
        }
        let final_packet = bytes.is_empty();
        worker.packet(position, &bytes).await?;
        position += bytes.len() as u64 / 2;
        loop {
            let event = worker.event().await?;
            if event["type"] == "ack" {
                if event["position"].as_u64() != Some(position)
                    || event["final"].as_bool() != Some(final_packet)
                {
                    return Err("Speech worker cursor acknowledgement mismatch".into());
                }
                break;
            }
            if event["type"] != "line" {
                return Err("Unexpected speech worker event".into());
            }
            let mut line: Line =
                serde_json::from_value(event).map_err(|_| "Malformed speech line")?;
            line.discard_unreliable_alignment();
            if !line.complete {
                interim = line.text;
                let _ = app.emit("meeting-live", json!({"id":id,"interim":interim}));
                continue;
            }
            interim.clear();
            if line.text.trim().is_empty() {
                continue;
            }
            if let Some(clock) = &clock {
                clock.lock().map_err(|e| e.to_string())?.voice();
            }
            let speakers = line
                .spans
                .iter()
                .map(|s| s.speaker.as_str())
                .collect::<std::collections::HashSet<_>>();
            let speaker = if speakers.len() == 1 {
                *speakers.iter().next().unwrap()
            } else {
                "unknown"
            }
            .to_string();
            let segment = Segment {
                id: 0,
                start: line.start,
                end: line.end,
                text: line.text,
                speaker,
                words: line.words,
                speaker_spans: line.spans,
                corrected: false,
                original_text: None,
                provenance: Some(Provenance {
                    provider: "moonshine".into(),
                    session: worker.session.clone(),
                    line: line.line,
                }),
            };
            meetings::validate_segments(&[segment.clone()])?;
            let handle = app.clone();
            let meeting_id = id.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                meetings::modify(&handle, &meeting_id, |meeting| {
                    reduce(meeting, segment, replay)
                })
            })
            .await
            .map_err(|e| e.to_string())??;
        }
        let available = files
            .iter()
            .filter_map(|p| p.metadata().ok().map(|m| m.len() / 2))
            .min()
            .unwrap_or(position);
        let _=app.emit("meeting-live",json!({"id":id,"interim":interim,"lagSeconds":available.saturating_sub(position) as f64/16000.0}));
        if final_packet {
            let exit = tokio::time::timeout(Duration::from_secs(5), worker.child.wait())
                .await
                .map_err(|_| "Speech worker shutdown timed out")?
                .map_err(|e| e.to_string())?;
            if !exit.success() {
                return Err(
                    "Speech worker did not finish cleanly. Resume from retained audio.".into(),
                );
            }
            let handle = app.clone();
            let meeting_id = id.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                meetings::modify(&handle, &meeting_id, |m| {
                    m.live_complete = true;
                    m.transcription_cursor = position;
                    Ok(())
                })
            })
            .await
            .map_err(|e| e.to_string())??;
            return Ok(());
        }
    }
}
pub(crate) fn start(
    app: tauri::AppHandle,
    id: String,
    directory: &Path,
    microphone: bool,
    system: bool,
    clock: Arc<Mutex<crate::meeting_recorder::Clock>>,
    worker: Worker,
) -> crate::meeting_live::LiveHandle {
    let files = [(microphone, "microphone.pcm"), (system, "system.pcm")]
        .into_iter()
        .filter(|(enabled, _)| *enabled)
        .map(|(_, name)| directory.join(name))
        .collect::<Vec<_>>();
    let finish = CancellationToken::new();
    let token = finish.clone();
    let abort = CancellationToken::new();
    let cancel = abort.clone();
    let (sender, result) = std::sync::mpsc::sync_channel(1);
    if let Ok(mut jobs) = app.state::<MeetingState>().jobs.lock() {
        jobs.insert(id.clone(), abort.clone());
    }
    tauri::async_runtime::spawn(async move {
        let outcome = tokio::select! {_=cancel.cancelled()=>Err("Local transcription canceled. Resume from retained audio.".into()),result=run(&app,&id,&files,worker,token,Some(clock),false)=>result};
        if let Err(error) = &outcome {
            let handle = app.clone();
            let meeting_id = id.clone();
            let error = error.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                meetings::modify(&handle, &meeting_id, |m| {
                    m.live_complete = false;
                    m.error = Some(error);
                    Ok(())
                })
            })
            .await;
        }
        if let Ok(mut jobs) = app.state::<MeetingState>().jobs.lock() {
            jobs.remove(&id);
        }
        let _ = sender.send(outcome);
    });
    crate::meeting_live::LiveHandle {
        finish,
        result,
        abort: Some(abort),
        timeout: 600,
    }
}
pub(crate) async fn resume(
    app: &tauri::AppHandle,
    id: &str,
    model: &str,
    language: &str,
) -> Result<Meeting, String> {
    let worker = Worker::spawn(app, model, language).await?;
    let directory = meetings::folder(&crate::commands::attachment_root(app)?, id)?;
    let mut files = ["microphone.pcm", "system.pcm"]
        .into_iter()
        .map(|name| directory.join(name))
        .filter(|p| p.is_file())
        .collect::<Vec<_>>();
    struct TemporaryAudio(PathBuf);
    impl Drop for TemporaryAudio {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let mut temporary = None;
    if files.is_empty() {
        let m = meetings::load_async(app, id).await?;
        let name = m
            .media
            .as_deref()
            .ok_or("This meeting has no retained audio")?;
        if name != "audio.wav" {
            return Err("Local transcription accepts Scribly recordings and PCM WAV imports. Convert compressed recordings to WAV or choose a cloud transcription provider explicitly.".into());
        }
        let source = meetings::media_path(&crate::commands::attachment_root(app)?, &m, name)?;
        let output = directory.join("moonshine-input.pcm");
        temporary = Some(TemporaryAudio(output.clone()));
        let cancel = app
            .state::<MeetingState>()
            .jobs
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .cloned()
            .unwrap_or_default();
        let destination = output.clone();
        tauri::async_runtime::spawn_blocking(move || normalize_wav(&source, &destination, &cancel))
            .await
            .map_err(|e| e.to_string())??;
        files.push(output);
    }
    let model = model.to_string();
    meetings::modify_async(app, id, move |m| {
        m.live_complete = false;
        m.live_transcription = true;
        m.processing = "transcribing".into();
        m.transcription_model = Some(model);
        Ok(())
    })
    .await?;
    let finish = CancellationToken::new();
    finish.cancel();
    run(app, id, &files, worker, finish, None, true).await?;
    let mut m = meetings::load_async(app, id).await?;
    m.processing = "ready".into();
    drop(temporary);
    Ok(m)
}
fn normalize_wav(
    source: &Path,
    destination: &Path,
    cancel: &CancellationToken,
) -> Result<(), String> {
    use std::io::Write;
    if cancel.is_cancelled() {
        return Err("Local transcription canceled".into());
    }
    let mut reader =
        hound::WavReader::open(source).map_err(|_| "Choose a valid PCM WAV recording")?;
    let spec = reader.spec();
    if spec.channels == 0
        || spec.channels > 8
        || !(8000..=192000).contains(&spec.sample_rate)
        || !matches!(spec.bits_per_sample, 8 | 16 | 24 | 32)
        || (spec.sample_format == hound::SampleFormat::Float && spec.bits_per_sample != 32)
    {
        return Err("Unsupported WAV audio format".into());
    }
    let mut output =
        std::io::BufWriter::new(std::fs::File::create(destination).map_err(|e| e.to_string())?);
    let float = spec.sample_format == hound::SampleFormat::Float;
    let scale = (1u64 << (spec.bits_per_sample - 1)) as f64;
    let mut accumulator = 0u64;
    let mut channels = 0u16;
    let mut mixed = 0.0;
    let mut frames = 0u64;
    let mut sample = |value: f64| -> Result<(), String> {
        if !value.is_finite() {
            return Err("WAV contains non-finite audio samples".into());
        }
        mixed += value;
        channels += 1;
        if channels == spec.channels {
            frames += 1;
            if frames % 4096 == 0 && cancel.is_cancelled() {
                return Err("Local transcription canceled".into());
            }
            if frames > spec.sample_rate as u64 * 86400 {
                return Err("WAV exceeds the supported duration".into());
            }
            accumulator += 16000;
            let pcm = (mixed / spec.channels as f64 * 32768.0)
                .clamp(i16::MIN as f64, i16::MAX as f64) as i16;
            while accumulator >= spec.sample_rate as u64 {
                output
                    .write_all(&pcm.to_le_bytes())
                    .map_err(|e| e.to_string())?;
                accumulator -= spec.sample_rate as u64;
            }
            channels = 0;
            mixed = 0.0;
        }
        Ok(())
    };
    if float {
        for value in reader.samples::<f32>() {
            sample(value.map_err(|_| "Damaged WAV samples")? as f64)?;
        }
    } else {
        for value in reader.samples::<i32>() {
            sample(value.map_err(|_| "Damaged WAV samples")? as f64 / scale)?;
        }
    }
    if channels != 0 {
        return Err("WAV ends inside a channel frame".into());
    }
    output.flush().map_err(|e| e.to_string())?;
    output.get_ref().sync_all().map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn local_ai_final_drain_keeps_longer_track_tail() {
        let root = std::env::temp_dir().join(format!("scribly-pcm-tail-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let a = root.join("a.pcm");
        let b = root.join("b.pcm");
        std::fs::write(
            &a,
            [100i16, 200, 300, 400]
                .into_iter()
                .flat_map(i16::to_le_bytes)
                .collect::<Vec<_>>(),
        )
        .unwrap();
        std::fs::write(
            &b,
            [10i16, 20]
                .into_iter()
                .flat_map(i16::to_le_bytes)
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let files = [a, b];
        assert_eq!(
            crate::meeting_live::pcm_tail(&files, 0, false)
                .await
                .unwrap()
                .len(),
            4
        );
        let tail = crate::meeting_live::pcm_tail(&files, 0, true)
            .await
            .unwrap();
        let samples = tail
            .chunks_exact(2)
            .map(|p| i16::from_le_bytes([p[0], p[1]]))
            .collect::<Vec<_>>();
        assert_eq!(samples, vec![110, 220, 300, 400]);
        assert!(crate::meeting_live::pcm_tail(&files, 4, true)
            .await
            .unwrap()
            .is_empty());
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn local_ai_wav_normalization_and_cancellation() {
        let root = std::env::temp_dir().join(format!("scribly-local-wav-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("input.wav");
        let destination = root.join("output.pcm");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&source, spec).unwrap();
        for _ in 0..2400 {
            writer.write_sample(2000i16).unwrap();
            writer.write_sample(-1000i16).unwrap();
        }
        writer.finalize().unwrap();
        normalize_wav(&source, &destination, &CancellationToken::new()).unwrap();
        let bytes = std::fs::read(&destination).unwrap();
        assert_eq!(bytes.len(), 800 * 2);
        assert!(bytes
            .chunks_exact(2)
            .all(|b| i16::from_le_bytes([b[0], b[1]]) == 500));
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(normalize_wav(&source, &destination, &cancel)
            .unwrap_err()
            .contains("canceled"));
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn local_ai_crc_verifies_native_assets() {
        assert_eq!(!crc32c(u32::MAX, b"123456789"), 0xe3069283);
    }
    #[test]
    fn local_ai_invalid_sdk_word_alignment_keeps_text_and_audio_speakers() {
        let mut line: Line = serde_json::from_value(json!({
            "line":"1","complete":true,"start":1.472,"end":4.064,
            "text":"I will review the prototype on Tuesday",
            "spans":[{"speaker":"0","start":1.685,"end":3.845,"textStart":0,"textEnd":1}],
            "words":[{"text":"I","start":1.472,"end":2.768,"confidence":1},
                {"text":"will","start":2.768,"end":1.472,"confidence":1}]
        }))
        .unwrap();
        line.discard_unreliable_alignment();
        assert!(line.words.is_empty());
        assert_eq!(line.text, "I will review the prototype on Tuesday");
        assert_eq!(line.spans[0].speaker, "0");
        assert_eq!(line.spans[0].start, 1.685);
        assert_eq!(line.spans[0].text_start, 0);
        assert_eq!(line.spans[0].text_end, 0);
    }
    #[test]
    fn local_ai_replay_keeps_ids_corrections_and_names() {
        let mut m = Meeting::new("Replay".into(), None);
        let make = |session: &str, text: &str, speaker: &str| Segment {
            id: 0,
            start: 0.0,
            end: 1.0,
            text: text.into(),
            speaker: speaker.into(),
            words: vec![],
            speaker_spans: vec![],
            corrected: false,
            original_text: None,
            provenance: Some(Provenance {
                provider: "moonshine".into(),
                session: session.into(),
                line: "1".into(),
            }),
        };
        reduce(&mut m, make("old", "Hello", "0"), false).unwrap();
        m.speakers.insert("0".into(), "Sam".into());
        reduce(&mut m, make("new", "Hello", "8"), true).unwrap();
        assert_eq!(m.segments.len(), 1);
        assert_eq!(m.segments[0].speaker, "0");
        assert_eq!(m.speakers["0"], "Sam");
        reduce(&mut m, make("third", "Different", "9"), true).unwrap();
        assert_eq!(m.replay_candidates.len(), 1);
        assert_eq!(m.segments[0].text, "Hello");
        m.segments[0].corrected = true;
        reduce(&mut m, make("old", "Replacement", "9"), false).unwrap();
        assert_eq!(m.segments[0].text, "Hello");
    }
}

//! Streaming reads the same aligned PCM tracks used for recovery.
//! Gemini renews sessions before their cap; failures never replay paid audio.
use crate::{
    meeting_auth,
    meetings::{self, MeetingState, Segment},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    net::TcpStream,
};
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use tokio_util::sync::CancellationToken;

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
pub(crate) struct LiveConnection {
    socket: Socket,
    gemini: bool,
    language: String,
}
pub(crate) struct LiveHandle {
    finish: CancellationToken,
    result: mpsc::Receiver<Result<(), String>>,
}
impl LiveHandle {
    pub(crate) fn finish(self) -> Result<(), String> {
        self.finish.cancel();
        self.result
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| {
                "Live transcription did not finish. Recording and completed words were retained."
            })?
    }
}
impl Drop for LiveHandle {
    fn drop(&mut self) {
        self.finish.cancel();
    }
}
pub(crate) async fn connect(
    app: &tauri::AppHandle,
    language: &str,
    model: &str,
) -> Result<LiveConnection, String> {
    if language.is_empty()
        || language.len() > 12
        || !language
            .bytes()
            .all(|b| b.is_ascii_alphabetic() || b == b'-')
    {
        return Err("Choose a valid live transcription language".into());
    }
    if model == "gemini-3.5-transcribe-live" {
        return connect_gemini(app, language).await;
    }
    if model != "deepgram" {
        return Err("This transcription model does not support live recording".into());
    }
    let key = {
        let state = app.state::<MeetingState>();
        let _guard = state.credentials.lock().await;
        meeting_auth::read(app)?.deepgram
    };
    if key.is_empty() {
        return Err("Connect Deepgram in Settings → Meeting AI to transcribe live, or turn off live transcription to record locally.".into());
    }
    let mut url =
        reqwest::Url::parse("wss://api.deepgram.com/v1/listen").map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs([
        ("model", "nova-3"),
        ("language", language),
        ("encoding", "linear16"),
        ("sample_rate", "16000"),
        ("channels", "1"),
        ("diarize_model", "v1"),
        ("interim_results", "true"),
        ("punctuate", "true"),
        ("smart_format", "true"),
        ("endpointing", "500"),
        ("vad_events", "true"),
    ]);
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "Invalid streaming request")?;
    request.headers_mut().insert(
        "Authorization",
        format!("Token {key}")
            .parse()
            .map_err(|_| "Invalid Deepgram credential")?,
    );
    let config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
        .max_message_size(Some(12 * 1024 * 1024));
    tokio::time::timeout(Duration::from_secs(20), tokio_tungstenite::connect_async_with_config(request, Some(config), false)).await
        .map_err(|_| "Deepgram live connection timed out")?.map(|(socket, _)| LiveConnection { socket, gemini: false, language: language.into() })
        .map_err(|_| "Deepgram live connection failed. Check your key, credit and language. No recording was started.".into())
}
pub(crate) fn start(
    app: tauri::AppHandle,
    id: String,
    directory: &Path,
    microphone: bool,
    system: bool,
    clock: Arc<Mutex<crate::meeting_recorder::Clock>>,
    connection: LiveConnection,
) -> LiveHandle {
    let files = [(microphone, "microphone.pcm"), (system, "system.pcm")]
        .into_iter()
        .filter(|(enabled, _)| *enabled)
        .map(|(_, name)| directory.join(name))
        .collect();
    let finish = CancellationToken::new();
    let token = finish.clone();
    let (sender, result) = mpsc::sync_channel(1);
    tauri::async_runtime::spawn(async move {
        let outcome = if connection.gemini {
            stream_gemini(&app, &id, files, clock, connection, token).await
        } else {
            stream(&app, &id, files, clock, connection.socket, token).await
        };
        let handle = app.clone();
        let meeting_id = id.clone();
        let error = outcome.as_ref().err().cloned();
        let persisted = tauri::async_runtime::spawn_blocking(move || meetings::modify(&handle, &meeting_id, |meeting| {
            meeting.live_complete = error.is_none();
            if let Some(error) = error { meeting.error = Some(format!("{error} There is no automatic paid retry; transcribe the saved recording explicitly to recover missing speech.")); }
            Ok(())
        })).await.map_err(|e| e.to_string()).and_then(|r| r.map(|_| ()));
        let _ = app.emit("meeting-live", json!({"id":id,"interim":""}));
        let _ = sender.send(outcome.and(persisted));
    });
    LiveHandle { finish, result }
}
async fn send(socket: &mut Socket, message: Message) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(5), socket.send(message))
        .await
        .map_err(|_| "Live transcription upload timed out")?
        .map_err(|_| "Live transcription connection was interrupted".into())
}
async fn connect_gemini(app: &tauri::AppHandle, language: &str) -> Result<LiveConnection, String> {
    let key = meeting_auth::gemini_key(app).await?;
    let mut url = reqwest::Url::parse("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent").map_err(|_| "Invalid Gemini live endpoint")?;
    url.query_pairs_mut().append_pair("key", &key);
    let config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
        .max_message_size(Some(12 * 1024 * 1024));
    let (mut socket, _) = tokio::time::timeout(
        Duration::from_secs(20),
        tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), false),
    )
    .await
    .map_err(|_| "Gemini live connection timed out")?
    .map_err(|_| "Gemini live connection failed. Check key, model access and quota.")?;
    send(
        &mut socket,
        Message::Text(
            crate::meeting_gemini::live_setup(language)
                .to_string()
                .into(),
        ),
    )
    .await?;
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let value: Value = serde_json::from_str(&text)
                        .map_err(|_| "Invalid Gemini live setup response")?;
                    if value.get("error").is_some() {
                        return Err(
                            "Google rejected Gemini Live setup. Check model access and quota.",
                        );
                    }
                    if value.get("setupComplete").is_some() {
                        return Ok(());
                    }
                }
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                _ => return Err("Google closed Gemini Live during setup"),
            }
        }
    })
    .await
    .map_err(|_| "Gemini Live setup timed out")??;
    Ok(LiveConnection {
        socket,
        gemini: true,
        language: language.into(),
    })
}
async fn append_segments(
    app: &tauri::AppHandle,
    id: &str,
    mut segments: Vec<Segment>,
) -> Result<(), String> {
    let handle = app.clone();
    let meeting_id = id.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        meetings::modify(&handle, &meeting_id, |meeting| {
            for segment in &mut segments {
                segment.id = meeting.segments.len();
                meeting.segments.push(segment.clone());
            }
            meeting.revision += 1;
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("meeting-live", json!({"id":id,"interim":""}));
    Ok(())
}
#[derive(Default)]
struct GeminiTurns {
    end: f64,
    interim: String,
}
impl GeminiTurns {
    fn final_segment(&mut self, text: &str, sent_seconds: f64) -> Result<Option<Segment>, String> {
        if text.trim().is_empty() {
            return Ok(None);
        }
        if text.len() > 50_000 || !sent_seconds.is_finite() || sent_seconds < self.end {
            return Err("Invalid Gemini live transcript".into());
        }
        let segment = Segment {
            words: vec![],
            id: 0,
            start: self.end,
            end: sent_seconds,
            speaker: "unknown".into(),
            text: text.into(),
        };
        self.end = sent_seconds;
        self.interim.clear();
        Ok(Some(segment))
    }
}
// Dropping a pending handshake must also stop its task (ordinary JoinHandle drop detaches).
struct GeminiHandshake(tokio::task::JoinHandle<Result<LiveConnection, String>>);
impl Drop for GeminiHandshake {
    fn drop(&mut self) {
        self.0.abort();
    }
}
struct GeminiDrain {
    socket: Socket,
    turns: GeminiTurns,
    boundary: f64,
    acknowledged_at: Option<tokio::time::Instant>,
    deadline: tokio::time::Instant,
}
fn gemini_frame(
    message: Option<Result<Message, tokio_tungstenite::tungstenite::Error>>,
) -> Result<Option<Value>, String> {
    match message {
        Some(Ok(Message::Text(text))) => {
            let value: Value = serde_json::from_str(&text).map_err(|_| "Invalid Gemini live response")?;
            if value.get("error").is_some() { return Err("Google stopped Gemini Live; check quota and model access".into()); }
            Ok(Some(value))
        },
        Some(Ok(Message::Close(_))) | None => Err("Gemini Live closed before final transcription was drained. Recording and completed text were retained.".into()),
        Some(Err(_)) => Err("Gemini Live was interrupted. Recording continues locally; no automatic paid retry was made.".into()),
        _ => Ok(None),
    }
}
impl GeminiTurns {
    fn receive(
        &mut self,
        value: &Value,
        sent_seconds: f64,
        closing: bool,
        acknowledged_at: &mut Option<tokio::time::Instant>,
    ) -> Result<Option<Segment>, String> {
        let content = &value["serverContent"];
        if let Some(interim) = content["interimInputTranscription"]["text"].as_str() {
            if interim.len() > 50_000 {
                return Err("Gemini live text exceeded its limit".into());
            }
            self.interim = interim.into();
            if acknowledged_at.is_some() {
                *acknowledged_at = Some(tokio::time::Instant::now());
            }
        }
        let result = if let Some(text) = content["inputTranscription"]["text"].as_str() {
            if acknowledged_at.is_some() {
                *acknowledged_at = Some(tokio::time::Instant::now());
            }
            self.final_segment(text, sent_seconds)?
        } else {
            None
        };
        if closing && content["turnComplete"] == true {
            *acknowledged_at = Some(tokio::time::Instant::now());
        }
        Ok(result)
    }
    fn drained(&self, acknowledged_at: Option<tokio::time::Instant>) -> bool {
        self.drained_at(acknowledged_at, tokio::time::Instant::now())
    }
    fn acknowledged(&self, acknowledged_at: Option<tokio::time::Instant>) -> bool {
        self.interim.trim().is_empty() && acknowledged_at.is_some()
    }
    fn drained_at(
        &self,
        acknowledged_at: Option<tokio::time::Instant>,
        now: tokio::time::Instant,
    ) -> bool {
        self.interim.trim().is_empty()
            && acknowledged_at
                .is_some_and(|time| now.saturating_duration_since(time) >= Duration::from_secs(1))
    }
}
// New-session finals wait for the old tail. This also keeps persisted segment IDs stable.
#[derive(Default)]
struct GeminiHandoffText {
    pending: Vec<Segment>,
    bytes: usize,
}
impl GeminiHandoffText {
    fn push(&mut self, segment: Segment) -> Result<(), String> {
        // Retain the received final even when the bounded queue stops the live stream.
        self.bytes += segment.text.len();
        self.pending.push(segment);
        if self.bytes > 1_000_000 {
            return Err("Gemini session handoff exceeded its transcript buffer; completed text was retained".into());
        }
        Ok(())
    }
    fn take(&mut self) -> Vec<Segment> {
        self.bytes = 0;
        std::mem::take(&mut self.pending)
    }
}
fn gemini_closed(message: &Option<Result<Message, tokio_tungstenite::tungstenite::Error>>) -> bool {
    matches!(message, Some(Ok(Message::Close(_))) | None)
}
async fn stream_gemini(
    app: &tauri::AppHandle,
    id: &str,
    files: Vec<PathBuf>,
    clock: Arc<Mutex<crate::meeting_recorder::Clock>>,
    connection: LiveConnection,
    finish: CancellationToken,
) -> Result<(), String> {
    let mut socket = connection.socket;
    let language = connection.language;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    let mut position = 0u64;
    let mut turns = GeminiTurns::default();
    let mut finishing = false;
    let mut closing = false;
    let mut active_closed = false;
    let mut opened = tokio::time::Instant::now();
    let mut deadline = opened + Duration::from_secs(86_400);
    let mut acknowledged_at = None;
    let mut handshake: Option<GeminiHandshake> = None;
    let mut draining: Option<GeminiDrain> = None;
    let mut buffered = GeminiHandoffText::default();
    let outcome: Result<(), String> = async {
        loop {
            tokio::select! {
                _ = finish.cancelled(), if !finishing => {
                    finishing = true; handshake = None;
                    deadline = tokio::time::Instant::now() + Duration::from_secs(12);
                },
                _ = tokio::time::sleep_until(deadline), if finishing => return Err("Google did not finalize Gemini Live. Recording and completed text were retained.".into()),
                next = async { match &mut handshake { Some(task) => (&mut task.0).await, None => std::future::pending().await } }, if handshake.is_some() => {
                    let next = next.map_err(|_| "Gemini session renewal was interrupted")??;
                    handshake = None;
                    // The current session receives audio until its replacement acknowledges setup.
                    // The shared PCM cursor is unchanged, so no chunk is replayed across sessions.
                    send(&mut socket, Message::Text(r#"{"realtimeInput":{"audioStreamEnd":true}}"#.into())).await?;
                    let boundary = position as f64 / 16_000.0;
                    draining = Some(GeminiDrain {
                        socket: std::mem::replace(&mut socket, next.socket),
                        turns: std::mem::replace(&mut turns, GeminiTurns { end: boundary, interim: String::new() }),
                        boundary, acknowledged_at: None,
                        deadline: tokio::time::Instant::now() + Duration::from_secs(12),
                    });
                    opened = tokio::time::Instant::now(); acknowledged_at = None;
                },
                _ = tick.tick() => {
                    if let Some(old) = &draining {
                        if old.turns.drained(old.acknowledged_at) {
                            draining = None; // Drop only after trailing transcription has been received.
                            let finals = buffered.take();
                            if !finals.is_empty() { append_segments(app, id, finals).await?; }
                            let _ = app.emit("meeting-live", json!({"id":id,"interim":turns.interim}));
                        } else if tokio::time::Instant::now() >= old.deadline {
                            return Err("The previous Gemini session did not finalize during handoff; recover missing speech from saved audio".into());
                        }
                    }
                    if closing {
                        if draining.is_none() && (active_closed || turns.drained(acknowledged_at)) { return Ok(()); }
                        continue;
                    }
                    if !finishing && handshake.is_none() && draining.is_none() && opened.elapsed() >= Duration::from_secs(540) {
                        let handle = app.clone(); let next_language = language.clone();
                        handshake = Some(GeminiHandshake(tokio::spawn(async move { connect_gemini(&handle, &next_language).await })));
                    }
                    let bytes = pcm(&files, position).await?;
                    if !bytes.is_empty() {
                        for chunk in bytes.chunks(3200) {
                            send(&mut socket, Message::Text(crate::meeting_gemini::live_audio(chunk).to_string().into())).await?;
                            position += chunk.len() as u64 / 2;
                        }
                    } else if finishing {
                        send(&mut socket, Message::Text(r#"{"realtimeInput":{"audioStreamEnd":true}}"#.into())).await?;
                        closing = true;
                    }
                },
                message = socket.next(), if !active_closed => {
                    if gemini_closed(&message) && closing && turns.acknowledged(acknowledged_at) {
                        active_closed = true;
                        continue;
                    }
                    if let Some(value) = gemini_frame(message)? {
                        let segment = turns.receive(&value, position as f64 / 16_000.0, closing, &mut acknowledged_at)?;
                        if segment.is_some() || !turns.interim.trim().is_empty() { clock.lock().map_err(|e| e.to_string())?.voice(); }
                        if let Some(segment) = segment {
                            if draining.is_some() { buffered.push(segment)?; }
                            else { append_segments(app, id, vec![segment]).await?; }
                        }
                        let _ = app.emit("meeting-live", json!({"id":id,"interim":turns.interim}));
                    }
                },
                message = async { match &mut draining { Some(old) => old.socket.next().await, None => std::future::pending().await } }, if draining.is_some() => {
                    if gemini_closed(&message) && draining.as_ref().is_some_and(|old| old.turns.acknowledged(old.acknowledged_at)) {
                        draining = None;
                        let finals = buffered.take();
                        if !finals.is_empty() { append_segments(app, id, finals).await?; }
                        let _ = app.emit("meeting-live", json!({"id":id,"interim":turns.interim}));
                        continue;
                    }
                    if let Some(value) = gemini_frame(message)? {
                        let Some(old) = draining.as_mut() else { continue; };
                        if let Some(segment) = old.turns.receive(&value, old.boundary, true, &mut old.acknowledged_at)? {
                            append_segments(app, id, vec![segment]).await?;
                            // Saving old words must not hide the new session's active caption.
                            let _ = app.emit("meeting-live", json!({"id":id,"interim":turns.interim}));
                        }
                    }
                },
            }
        }
    }.await;
    // Even an interrupted old session must not discard finals already received from its successor.
    let finals = buffered.take();
    if !finals.is_empty() {
        append_segments(app, id, finals).await?;
    }
    outcome
}
async fn pcm(files: &[PathBuf], position: u64) -> Result<Vec<u8>, String> {
    let mut available = u64::MAX;
    for path in files {
        available = available.min(
            tokio::fs::metadata(path)
                .await
                .map_err(|_| "Recovery audio is unavailable for live transcription")?
                .len()
                / 2,
        );
    }
    let count = available.saturating_sub(position).min(16_000) as usize;
    if count == 0 {
        return Ok(vec![]);
    }
    let mut mixed = vec![0i32; count];
    for path in files {
        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(|e| e.to_string())?;
        file.seek(std::io::SeekFrom::Start(position * 2))
            .await
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![0; count * 2];
        file.read_exact(&mut bytes)
            .await
            .map_err(|e| e.to_string())?;
        for (index, sample) in bytes.as_chunks::<2>().0.iter().enumerate() {
            mixed[index] += i16::from_le_bytes([sample[0], sample[1]]) as i32;
        }
    }
    Ok(mixed
        .into_iter()
        .flat_map(|sample| (sample.clamp(i16::MIN as i32, i16::MAX as i32) as i16).to_le_bytes())
        .collect())
}
async fn stream(
    app: &tauri::AppHandle,
    id: &str,
    files: Vec<PathBuf>,
    clock: Arc<Mutex<crate::meeting_recorder::Clock>>,
    mut socket: Socket,
    finish: CancellationToken,
) -> Result<(), String> {
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    let mut last_sent = tokio::time::Instant::now();
    let mut position = 0u64;
    let mut finishing = false;
    let mut closed_audio = false;
    let mut deadline = tokio::time::Instant::now() + Duration::from_secs(86_400);
    let mut final_end = 0.0;
    loop {
        tokio::select! {
            _ = finish.cancelled(), if !finishing => { finishing = true; deadline = tokio::time::Instant::now() + Duration::from_secs(12); },
            _ = tokio::time::sleep_until(deadline), if finishing => return Err("Deepgram did not acknowledge the end of live transcription. Completed words were retained.".into()),
            _ = tick.tick(), if !closed_audio => {
                let bytes = pcm(&files, position).await?;
                if !bytes.is_empty() {
                    position += bytes.len() as u64 / 2; send(&mut socket, Message::Binary(bytes.into())).await?; last_sent = tokio::time::Instant::now();
                } else if finishing {
                    send(&mut socket, Message::Text(r#"{"type":"Finalize"}"#.into())).await?;
                    send(&mut socket, Message::Text(r#"{"type":"CloseStream"}"#.into())).await?;
                    closed_audio = true;
                } else if last_sent.elapsed() >= Duration::from_secs(3) {
                    send(&mut socket, Message::Text(r#"{"type":"KeepAlive"}"#.into())).await?; last_sent = tokio::time::Instant::now();
                }
            },
            message = socket.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        let value: Value = serde_json::from_str(&text).map_err(|_| "Invalid Deepgram streaming response")?;
                        if value["type"] == "Error" { return Err("Deepgram stopped live transcription. Check your key, credit and language.".into()); }
                        if value["type"] == "Metadata" && closed_audio { return Ok(()); }
                        if value["type"] == "SpeechStarted" { clock.lock().map_err(|e| e.to_string())?.voice(); }
                        if value["type"] != "Results" { continue; }
                        let interim = value["channel"]["alternatives"][0]["transcript"].as_str().unwrap_or("").chars().take(50_000).collect::<String>();
                        if !interim.trim().is_empty() { clock.lock().map_err(|e| e.to_string())?.voice(); }
                        if value["is_final"] != true { let _ = app.emit("meeting-live", json!({"id":id,"interim":interim})); continue; }
                        let mut segments = result_segments(&value, final_end)?;
                        if segments.is_empty() { continue; }
                        final_end = segments.last().map_or(final_end, |segment| segment.end);
                        let handle = app.clone(); let meeting_id = id.to_string();
                        tauri::async_runtime::spawn_blocking(move || meetings::modify(&handle, &meeting_id, |meeting| {
                            for segment in &mut segments { segment.id = meeting.segments.len(); meeting.segments.push(segment.clone()); }
                            meeting.revision += 1; Ok(())
                        })).await.map_err(|e| e.to_string())??;
                        let _ = app.emit("meeting-live", json!({"id":id,"interim":""}));
                    },
                    Some(Ok(Message::Close(_))) | None => return Err("Live transcription closed before its final acknowledgement. Completed words were retained.".into()),
                    Some(Err(_)) => return Err("Live transcription connection was interrupted. Recording continues locally.".into()),
                    _ => {},
                }
            }
        }
    }
}
// Word-level speaker IDs split a final result without duplicating prior words.
fn result_segments(value: &Value, final_end: f64) -> Result<Vec<Segment>, String> {
    let alternative = &value["channel"]["alternatives"][0];
    let mut segments: Vec<Segment> = vec![];
    if let Some(words) = alternative["words"]
        .as_array()
        .filter(|words| !words.is_empty())
    {
        for word in words {
            let start = word["start"]
                .as_f64()
                .ok_or("Missing live word timestamp")?;
            let end = word["end"].as_f64().ok_or("Missing live word timestamp")?;
            if !start.is_finite()
                || !end.is_finite()
                || start < 0.0
                || end < start
                || end > 86_400.0
            {
                return Err("Invalid live word timestamp".into());
            }
            if end <= final_end {
                continue;
            }
            let speaker = word["speaker"]
                .as_u64()
                .map_or_else(|| "unknown".into(), |id| id.to_string());
            let text = word["punctuated_word"]
                .as_str()
                .or_else(|| word["word"].as_str())
                .ok_or("Missing live word")?;
            if let Some(segment) = segments
                .last_mut()
                .filter(|segment| segment.speaker == speaker)
            {
                segment.text.push(' ');
                segment.text.push_str(text);
                segment.end = end;
            } else {
                segments.push(Segment {
                    words: vec![],
                    id: segments.len(),
                    start,
                    end,
                    speaker,
                    text: text.into(),
                });
            }
            if let (Some(segment), Some(confidence)) =
                (segments.last_mut(), word["confidence"].as_f64())
            {
                segment.words.push(crate::meetings::TranscriptWord {
                    text: text.into(),
                    start,
                    end,
                    confidence,
                });
            }
        }
    } else if let Some(text) = alternative["transcript"]
        .as_str()
        .filter(|text| !text.trim().is_empty())
    {
        let start = value["start"]
            .as_f64()
            .ok_or("Missing live result timestamp")?;
        let end = start
            + value["duration"]
                .as_f64()
                .ok_or("Missing live result duration")?;
        if end > final_end {
            segments.push(Segment {
                words: vec![],
                id: 0,
                start,
                end,
                speaker: "unknown".into(),
                text: text.into(),
            });
        }
    }
    meetings::validate_segments(&segments)?;
    Ok(segments)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gemini_handoff_keeps_late_old_finals_before_new_text_and_drains_after_ack() {
        let mut old = GeminiTurns {
            end: 539.0,
            interim: "Old tail".into(),
        };
        let mut next = GeminiTurns {
            end: 540.0,
            interim: String::new(),
        };
        let mut ack = None;
        let mut buffered = GeminiHandoffText::default();
        buffered
            .push(
                next.receive(
                    &json!({"serverContent":{"inputTranscription":{"text":"New words."}}}),
                    541.0,
                    false,
                    &mut None,
                )
                .unwrap()
                .unwrap(),
            )
            .unwrap();
        old.receive(
            &json!({"serverContent":{"turnComplete":true}}),
            540.0,
            true,
            &mut ack,
        )
        .unwrap();
        assert!(!old.drained_at(ack, tokio::time::Instant::now() + Duration::from_secs(2))); // Acknowledgement cannot discard an unresolved caption.
        let tail = old
            .receive(
                &json!({"serverContent":{"inputTranscription":{"text":"Old tail."}}}),
                540.0,
                true,
                &mut ack,
            )
            .unwrap()
            .unwrap();
        assert!(!old.drained(ack)); // Transcription can arrive after turnComplete.
        assert!(old.acknowledged(ack)); // A clean close confirms no more frames can arrive.
        old.interim = "Unresolved".into();
        assert!(!old.acknowledged(ack));
        old.interim.clear();
        assert!(old.drained_at(ack, tokio::time::Instant::now() + Duration::from_secs(1)));
        let mut saved = vec![tail];
        saved.extend(buffered.take());
        assert_eq!(
            saved.iter().map(|s| s.text.as_str()).collect::<Vec<_>>(),
            vec!["Old tail.", "New words."]
        );
        assert_eq!((saved[0].end, saved[1].start), (540.0, 540.0));
        assert!(buffered.take().is_empty());
        // Failure cleanup uses the same take path, retaining successor finals exactly once.
        buffered
            .push(
                next.final_segment("Retained after interruption.", 542.0)
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(buffered.take().len(), 1);
        assert!(buffered.take().is_empty());
    }
    #[test]
    fn gemini_live_finals_keep_unknown_voices_and_clear_only_committed_interim() {
        let mut turns = GeminiTurns {
            end: 1.0,
            interim: "Hey Mark".into(),
        };
        assert!(turns.final_segment("", 2.0).unwrap().is_none());
        assert_eq!(turns.interim, "Hey Mark");
        let final_text = turns.final_segment("Hey Mark.", 2.0).unwrap().unwrap();
        assert_eq!(final_text.speaker, "unknown");
        assert_eq!(final_text.start, 1.0);
        assert_eq!(final_text.end, 2.0);
        assert!(turns.interim.is_empty());
        assert!(turns.final_segment("Invalid time", 0.5).is_err());
        let next = turns
            .final_segment("Reply from another voice", 3.0)
            .unwrap()
            .unwrap();
        assert_eq!(next.start, 2.0);
        assert_eq!(next.speaker, "unknown");
    }
    #[tokio::test]
    async fn meeting_live_mix_waits_for_aligned_tracks_and_clips_pcm() {
        let root = std::env::temp_dir().join(format!("scribly-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let files = vec![root.join("mic.pcm"), root.join("system.pcm")];
        std::fs::write(
            &files[0],
            [20_000i16.to_le_bytes(), 100i16.to_le_bytes()].concat(),
        )
        .unwrap();
        std::fs::write(&files[1], 20_000i16.to_le_bytes()).unwrap();
        assert_eq!(pcm(&files, 0).await.unwrap(), i16::MAX.to_le_bytes());
        assert!(pcm(&files, 1).await.unwrap().is_empty());
        std::fs::write(
            &files[1],
            [20_000i16.to_le_bytes(), (-200i16).to_le_bytes()].concat(),
        )
        .unwrap();
        assert_eq!(pcm(&files, 1).await.unwrap(), (-100i16).to_le_bytes());
        for file in files {
            std::fs::remove_file(file).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn live_speakers_and_finalized_words_are_not_duplicated() {
        let value = json!({"channel":{"alternatives":[{"words":[{"start":0.,"end":1.,"speaker":0,"punctuated_word":"Hello."},{"start":1.,"end":2.,"speaker":1,"word":"Hi"}]}]}});
        let result = result_segments(&value, 0.).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[1].speaker, "1");
        assert_eq!(result_segments(&value, 1.).unwrap().len(), 1);
        assert!(result_segments(&value, 2.).unwrap().is_empty());
        assert!(result_segments(
            &json!({"start":-1,"duration":2,"channel":{"alternatives":[{"transcript":"Invalid"}]}}),
            0.
        )
        .is_err());
    }
}

//! Streaming reads the same aligned PCM tracks used for recovery.
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
}
pub(crate) struct LiveHandle {
    pub(crate) finish: CancellationToken,
    pub(crate) result: mpsc::Receiver<Result<(), String>>,
    pub(crate) abort: Option<CancellationToken>,
    pub(crate) timeout: u64,
}
impl LiveHandle {
    pub(crate) fn finish(self) -> Result<(), String> {
        self.finish.cancel();
        self.result
            .recv_timeout(Duration::from_secs(self.timeout))
            .map_err(|_| {
                "Live transcription did not finish. Recording and completed words were retained."
            })?
    }
}
impl Drop for LiveHandle {
    fn drop(&mut self) {
        self.finish.cancel();
        if let Some(abort) = &self.abort {
            abort.cancel();
        }
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
        .map_err(|_| "Deepgram live connection timed out")?.map(|(socket, _)| LiveConnection { socket })
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
        let outcome = stream(&app, &id, files, clock, connection.socket, token).await;
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
    LiveHandle {
        finish,
        result,
        abort: None,
        timeout: 20,
    }
}
async fn send(socket: &mut Socket, message: Message) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(5), socket.send(message))
        .await
        .map_err(|_| "Live transcription upload timed out")?
        .map_err(|_| "Live transcription connection was interrupted".into())
}
pub(crate) async fn pcm(files: &[PathBuf], position: u64) -> Result<Vec<u8>, String> {
    pcm_tail(files, position, false).await
}
pub(crate) async fn pcm_tail(
    files: &[PathBuf],
    position: u64,
    finalizing: bool,
) -> Result<Vec<u8>, String> {
    if files.is_empty() {
        return Err("No retained audio tracks".into());
    }
    let mut available = u64::MAX;
    let mut maximum = 0;
    for path in files {
        available = available.min(
            tokio::fs::metadata(path)
                .await
                .map_err(|_| "Recovery audio is unavailable for live transcription")?
                .len()
                / 2,
        );
        maximum = maximum.max(
            tokio::fs::metadata(path)
                .await
                .map_err(|e| e.to_string())?
                .len()
                / 2,
        );
    }
    if finalizing {
        available = maximum;
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
        let read_count = if finalizing {
            file.metadata()
                .await
                .map_err(|e| e.to_string())?
                .len()
                .saturating_sub(position * 2)
                .min(count as u64 * 2) as usize
        } else {
            count * 2
        };
        file.read_exact(&mut bytes[..read_count])
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
                    speaker_spans: vec![],
                    provenance: None,
                    corrected: false,
                    original_text: None,
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
                    confidence: Some(confidence),
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
                speaker_spans: vec![],
                provenance: None,
                corrected: false,
                original_text: None,
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

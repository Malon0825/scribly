//! Google requests stay in Rust; keys and recording bytes never enter the WebView.
use crate::{
    meeting_auth,
    meetings::{self, Segment},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, time::Duration};

pub(crate) const FLASH: &str = "gemini-3.8-flash";
pub(crate) fn language_codes(language: &str) -> Vec<&str> {
    match language {
        "multi" => vec![],
        "en" => vec!["en-US"],
        "es" => vec!["es-ES"],
        "fr" => vec!["fr-FR"],
        "de" => vec!["de-DE"],
        "ja" => vec!["ja-JP"],
        "zh" => vec!["cmn-Hans-CN"],
        other => vec![other],
    }
}
fn response_error(status: u16, operation: &str, bytes: &[u8], key: &str) -> String {
    let value = serde_json::from_slice::<Value>(bytes).ok();
    // Display only Google's structured explanation, never its raw response or request details.
    // Errors may echo a supplied key; redact before persisting or sending to the WebView.
    let detail = value
        .as_ref()
        .and_then(|value| value["error"]["message"].as_str())
        .map(|message| {
            if key.is_empty() {
                message.to_string()
            } else {
                message.replace(key, "[redacted]")
            }
        })
        .map(|message| {
            message
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .filter(|c| !c.is_control())
                .take(1200)
                .collect::<String>()
        })
        .filter(|message| !message.is_empty());
    let prefix = format!("{operation} failed (Google HTTP {status}).");
    match detail {
        Some(detail) => format!("{prefix} {detail} No automatic paid retry was made."),
        None => format!("{prefix} Google did not provide a readable error reason. No automatic paid retry was made."),
    }
}
async fn check_response(
    mut response: reqwest::Response,
    operation: &str,
    key: &str,
) -> Result<reqwest::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 64 * 1024 => {
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            _ => return Err(response_error(status.as_u16(), operation, &[], key)),
        }
    }
    Err(response_error(status.as_u16(), operation, &bytes, key))
}
pub(crate) async fn json_response(
    response: reqwest::Response,
    operation: &str,
    key: &str,
) -> Result<Value, String> {
    let mut response = check_response(response, operation, key).await?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Google response was interrupted; previous results were retained")?
    {
        if bytes.len() + chunk.len() > 12 * 1024 * 1024 {
            return Err("Google response exceeded the supported size".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Google returned invalid JSON".into())
}
pub(crate) fn analysis_body(instructions: &str, input: &str) -> Value {
    json!({"systemInstruction":{"parts":[{"text":instructions}]},"contents":[{"role":"user","parts":[{"text":input}]}],"generationConfig":{"responseMimeType":"application/json"},"store":false})
}
fn analysis_text(value: &Value) -> Result<String, String> {
    let candidate = &value["candidates"][0];
    if candidate["finishReason"] != "STOP" {
        return Err("Gemini did not complete the result. Previous results were retained.".into());
    }
    let parts = candidate["content"]["parts"]
        .as_array()
        .ok_or("Gemini returned no result text")?;
    let text: String = parts
        .iter()
        .filter(|part| part["thought"] != true)
        .filter_map(|part| part["text"].as_str())
        .collect();
    if text.trim().is_empty() {
        return Err("Gemini returned no result text".into());
    }
    Ok(text)
}
pub(crate) async fn analyze(key: &str, instructions: &str, input: &str) -> Result<String, String> {
    let response = meeting_auth::client()?.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent")
        .header("x-goog-api-key", key).json(&analysis_body(instructions, input)).send().await.map_err(|_| "Gemini could not be reached; previous results were retained")?;
    analysis_text(&json_response(response, "Gemini 3.8 Flash analysis", key).await?)
}
pub(crate) fn transcription_body(uri: &str, mime: &str, language: &str) -> Value {
    json!({"model":"gemini-3.5-transcribe","store":false,"input":[{"type":"audio","uri":uri,"mime_type":mime}],"generation_config":{"transcription_config":{"language_codes":language_codes(language),"mode":{"type":"verbatim","diarization_mode":"speaker","timestamp_granularities":["word"]}}}})
}
fn offset(value: &Value) -> Result<f64, String> {
    let seconds = value
        .as_str()
        .and_then(|text| text.strip_suffix('s'))
        .and_then(|text| text.parse::<f64>().ok());
    seconds
        .filter(|time| time.is_finite() && *time >= 0.0 && *time <= 1800.0)
        .ok_or_else(|| "Invalid Gemini word timestamp".into())
}
pub(crate) fn transcript(value: &Value) -> Result<Vec<Segment>, String> {
    if value["status"] != "completed" {
        return Err(
            "Google did not complete transcription. Existing transcript was retained.".into(),
        );
    }
    let mut segments: Vec<Segment> = Vec::new();
    let mut speaker_ids = HashMap::new();
    for step in value["steps"]
        .as_array()
        .ok_or("Google returned no transcription steps")?
    {
        if step["type"] != "model_output" {
            continue;
        }
        for content in step["content"].as_array().into_iter().flatten() {
            for word in content["annotations"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|word| word["type"] == "word_info")
            {
                let start = offset(&word["start_offset"])?;
                let end = offset(&word["end_offset"])?;
                let text = word["text"]
                    .as_str()
                    .filter(|text| !text.trim().is_empty())
                    .ok_or("Empty Gemini word")?;
                if end < start || text.len() > 50_000 {
                    return Err("Invalid Gemini word".into());
                }
                let speaker = match word["speaker"]
                    .as_str()
                    .filter(|speaker| !speaker.is_empty())
                {
                    Some(raw) => {
                        let next = speaker_ids.len().to_string();
                        speaker_ids.entry(raw.to_string()).or_insert(next).clone()
                    }
                    None => "unknown".into(),
                };
                if let Some(segment) = segments.last_mut().filter(|segment| {
                    segment.speaker == speaker
                        && start >= segment.start
                        && start <= segment.end + 2.0
                        && segment.text.len() + text.len() < 4000
                        && end - segment.start < 20.0
                }) {
                    segment.text.push(' ');
                    segment.text.push_str(text);
                    segment.end = segment.end.max(end);
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
            }
        }
    }
    meetings::validate_segments(&segments)?;
    if segments.is_empty() {
        return Err(
            "Google returned no timestamped speech. Existing transcript was retained.".into(),
        );
    }
    Ok(segments)
}
fn file_name(name: &str) -> bool {
    name.strip_prefix("files/").is_some_and(|id| {
        !id.is_empty()
            && id.len() < 200
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    })
}
// Dropping a canceled request also schedules deletion of an acknowledged upload.
struct UploadedFile {
    name: String,
    key: String,
}
impl Drop for UploadedFile {
    fn drop(&mut self) {
        let name = self.name.clone();
        let key = self.key.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(client) = meeting_auth::client() {
                let _ = client
                    .delete(format!(
                        "https://generativelanguage.googleapis.com/v1beta/{name}"
                    ))
                    .header("x-goog-api-key", key)
                    .timeout(Duration::from_secs(20))
                    .send()
                    .await;
            }
        });
    }
}
pub(crate) async fn transcribe(
    key: &str,
    media: &Path,
    language: &str,
    duration: f64,
) -> Result<Vec<Segment>, String> {
    if duration > 1800.0 {
        return Err("Gemini speaker transcription supports recordings up to 30 minutes. Use Deepgram for this longer recording.".into());
    }
    if media
        .extension()
        .is_some_and(|extension| extension == "wav")
    {
        let media = media.to_path_buf();
        let too_long = tauri::async_runtime::spawn_blocking(move || {
            let reader = hound::WavReader::open(media).map_err(|_| "WAV recording is damaged")?;
            Ok::<_, String>(reader.duration() as f64 / reader.spec().sample_rate as f64 > 1800.0)
        })
        .await
        .map_err(|_| "Recording duration could not be read")??;
        if too_long {
            return Err("Gemini speaker transcription supports audio up to 30 minutes. Use Deepgram for this recording.".into());
        }
    }
    let mime = match media.extension().and_then(|value| value.to_str()) {
        Some("wav") => "audio/wav", Some("mp3") => "audio/mp3", Some("m4a") => "audio/m4a", Some("flac") => "audio/flac", Some("ogg") => "audio/ogg", Some("webm") => "audio/webm",
        _ => return Err("Gemini Transcribe requires an audio file. Import WAV, MP3, M4A, FLAC, OGG or audio WebM; use Deepgram for MP4 recordings.".into()),
    };
    let file = tokio::fs::File::open(media)
        .await
        .map_err(|_| "Recording is unavailable")?;
    let size = file
        .metadata()
        .await
        .map_err(|_| "Recording is unavailable")?
        .len();
    if size == 0 || size > meetings::MAX_MEDIA {
        return Err("Invalid recording size".into());
    }
    let client = meeting_auth::client()?;
    let start = client
        .post("https://generativelanguage.googleapis.com/upload/v1beta/files")
        .header("x-goog-api-key", key)
        .header("X-Goog-Upload-Protocol", "resumable")
        .header("X-Goog-Upload-Command", "start")
        .header("X-Goog-Upload-Header-Content-Length", size)
        .header("X-Goog-Upload-Header-Content-Type", mime)
        .json(&json!({"file":{"display_name":"Scribly meeting audio"}}))
        .send()
        .await
        .map_err(|_| "Google upload could not start")?;
    let start = check_response(start, "Gemini audio upload setup", key).await?;
    let url = start
        .headers()
        .get("x-goog-upload-url")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| reqwest::Url::parse(value).ok())
        .filter(|url| {
            url.scheme() == "https"
                && url.host_str() == Some("generativelanguage.googleapis.com")
                && url.username().is_empty()
                && url.password().is_none()
        })
        .ok_or("Google returned an invalid upload destination")?;
    let uploaded = client.post(url).header("Content-Length", size).header("X-Goog-Upload-Offset", "0").header("X-Goog-Upload-Command", "upload, finalize")
        .body(reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file))).send().await.map_err(|_| "Google upload was interrupted; recording retained. Check provider usage before retrying.")?;
    let mut uploaded = json_response(uploaded, "Gemini audio upload", key).await?["file"].clone();
    let name = uploaded["name"]
        .as_str()
        .filter(|name| file_name(name))
        .ok_or("Google returned an invalid uploaded file")?
        .to_string();
    let _cleanup = UploadedFile {
        name: name.clone(),
        key: key.into(),
    };
    let ready_by = tokio::time::Instant::now() + Duration::from_secs(120);
    while uploaded["state"] == "PROCESSING" {
        if tokio::time::Instant::now() >= ready_by {
            return Err("Google is still preparing the audio. Recording retained; no transcription retry was made.".into());
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
        uploaded = json_response(
            client
                .get(format!(
                    "https://generativelanguage.googleapis.com/v1beta/{name}"
                ))
                .header("x-goog-api-key", key)
                .send()
                .await
                .map_err(|_| "Google file preparation was interrupted")?,
            "Gemini audio preparation",
            key,
        )
        .await?;
    }
    if uploaded["state"] != "ACTIVE" {
        return Err("Google could not prepare this audio file".into());
    }
    let uri = uploaded["uri"]
        .as_str()
        .ok_or("Google returned no file URI")?;
    let response = client.post("https://generativelanguage.googleapis.com/v1beta/interactions").header("x-goog-api-key", key)
        .json(&transcription_body(uri, mime, language)).send().await.map_err(|_| "Google transcription was interrupted; recording retained. Check provider usage before retrying.")?;
    transcript(&json_response(response, "Gemini 3.5 recorded transcription", key).await?)
}
pub(crate) fn live_setup(language: &str) -> Value {
    json!({"setup":{"model":"models/gemini-3.5-transcribe-live","generationConfig":{"responseModalities":["TEXT"]},"inputAudioTranscription":{"languageCodes":language_codes(language),"mode":"VERBATIM"}}})
}
pub(crate) fn live_audio(bytes: &[u8]) -> Value {
    json!({"realtimeInput":{"audio":{"data":STANDARD.encode(bytes),"mimeType":"audio/pcm;rate=16000"}}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transcription_preserves_turns_and_rejects_incomplete_or_invalid_evidence() {
        let mut value = json!({"status":"completed","steps":[{"type":"model_output","content":[{"annotations":[
            {"type":"word_info","text":"Hello","speaker":"spk_1","start_offset":"0.100s","end_offset":"0.450s"},
            {"type":"word_info","text":"Mark.","speaker":"spk_1","start_offset":"0.500s","end_offset":"0.850s"},
            {"type":"word_info","text":"Yes?","speaker":"spk_2","start_offset":"1.000s","end_offset":"1.400s"}]}]}]});
        let segments = transcript(&value).unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "Hello Mark.");
        assert_eq!(segments[1].speaker, "1");
        assert_eq!(segments[1].start, 1.0);
        value["status"] = json!("failed");
        assert!(transcript(&value).is_err());
        value["status"] = json!("completed");
        value["steps"][0]["content"][0]["annotations"][0]["end_offset"] = json!("NaNs");
        assert!(transcript(&value).is_err());
    }
    #[test]
    fn analysis_rejects_truncation_and_excludes_thoughts() {
        let mut value = json!({"candidates":[{"finishReason":"STOP","content":{"parts":[{"thought":true,"text":"private reasoning"},{"text":"{\"items\":[]}"}]}}]});
        assert_eq!(analysis_text(&value).unwrap(), "{\"items\":[]}");
        value["candidates"][0]["finishReason"] = json!("MAX_TOKENS");
        assert!(analysis_text(&value).is_err());
        assert_eq!(analysis_body("instructions", "transcript")["store"], false);
    }
}

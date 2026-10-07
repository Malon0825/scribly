//! Meeting records are independent of notebook autosave. Media never enters note JSON.
use crate::{commands::attachment_root, database::DatabaseState};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

pub(crate) const MAX_MEDIA: u64 = 2 * 1024 * 1024 * 1024;
pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Segment {
    pub id: usize,
    pub start: f64,
    pub end: f64,
    pub speaker: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<TranscriptWord>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalysisItem {
    pub text: String,
    pub sources: Vec<usize>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Analysis {
    pub id: String,
    pub kind: String,
    pub model: String,
    pub question: String,
    pub revision: u64,
    pub created_at: u64,
    pub items: Vec<AnalysisItem>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SpeakerIdentity {
    pub speaker_id: String,
    pub name: String,
    pub team: Option<String>,
    pub aliases: Vec<String>,
    pub confidence: String,
    pub sources: Vec<usize>,
    pub reason: String,
}
impl SpeakerIdentity {
    pub(crate) fn label(&self) -> String {
        match &self.team {
            Some(team) => format!("{} ({team})", self.name),
            None => self.name.clone(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Meeting {
    pub id: String,
    pub note_id: Option<String>,
    pub title: String,
    pub created_at: u64,
    pub duration: f64,
    pub media: Option<String>,
    pub video: Option<String>,
    pub recording: String,
    pub processing: String,
    pub error: Option<String>,
    pub revision: u64,
    pub segments: Vec<Segment>,
    pub speakers: HashMap<String, String>,
    #[serde(default)]
    pub speaker_identities: Vec<SpeakerIdentity>,
    #[serde(default)]
    pub speaker_identity_revision: Option<u64>,
    pub analyses: Vec<Analysis>,
    #[serde(default)]
    pub recovery: Option<crate::meeting_recovery::Progress>,
    #[serde(default)]
    pub speaker_warning: Option<String>,
    #[serde(default)]
    pub live_transcription: bool,
    #[serde(default)]
    pub live_complete: bool,
    #[serde(default)]
    pub transcription_model: Option<String>,
    #[serde(default)]
    pub transcription_language: Option<String>,
    #[serde(default)]
    pub auto_notes: bool,
    #[serde(default)]
    pub notes_status: String,
    #[serde(default)]
    pub notes_model: Option<String>,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<u64>,
    #[serde(default)]
    pub completed_actions: Vec<String>,
}
impl Meeting {
    pub(crate) fn new(title: String, note_id: Option<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            note_id,
            title: title.chars().take(200).collect(),
            created_at: now(),
            duration: 0.0,
            media: None,
            video: None,
            recording: "saved".into(),
            processing: "idle".into(),
            error: None,
            revision: 0,
            segments: vec![],
            speakers: HashMap::new(),
            speaker_identities: vec![],
            speaker_identity_revision: None,
            analyses: vec![],
            recovery: None,
            speaker_warning: None,
            live_transcription: false,
            live_complete: false,
            transcription_model: None,
            transcription_language: None,
            auto_notes: false,
            notes_status: String::new(),
            notes_model: None,
            stop_reason: None,
            deleted_at: None,
            completed_actions: vec![],
        }
    }
}
#[derive(Default)]
pub(crate) struct MeetingState {
    pub jobs: Mutex<HashMap<String, CancellationToken>>,
    pub notes_jobs: Mutex<HashMap<String, CancellationToken>>,
    pub recorder: Mutex<Option<crate::meeting_recorder::Recorder>>,
    pub finalizing: Mutex<HashSet<String>>,
    pub auth: Mutex<Option<CancellationToken>>,
    pub credentials: tokio::sync::Mutex<()>,
}
pub(crate) fn folder(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.len() != 36 || uuid::Uuid::parse_str(id).is_err() {
        return Err("Invalid meeting ID".into());
    }
    Ok(root.join("meetings").join(id))
}
pub(crate) fn media_path(root: &Path, meeting: &Meeting, name: &str) -> Result<PathBuf, String> {
    if !valid_media_name(name) {
        return Err("Invalid recording file".into());
    }
    let base = folder(root, &meeting.id)?;
    let path = base.join(name);
    let canonical = dunce::canonicalize(&path)
        .map_err(|_| "Recording is missing. Restore a meeting backup.")?;
    if !canonical
        .starts_with(dunce::canonicalize(root.join("meetings")).map_err(|e| e.to_string())?)
        || fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Invalid recording location".into());
    }
    Ok(canonical)
}
pub(crate) fn valid_media_name(name: &str) -> bool {
    matches!(
        name,
        "audio.wav"
            | "audio.mp3"
            | "audio.m4a"
            | "audio.flac"
            | "audio.ogg"
            | "audio.webm"
            | "audio.mp4"
            | "video.mp4"
            | "microphone.wav"
            | "system.wav"
            | "microphone.pcm"
            | "system.pcm"
    )
}
pub(crate) fn db<T>(
    app: &tauri::AppHandle,
    operation: impl FnOnce(&mut crate::database::Database) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<DatabaseState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let database = guard.as_mut().ok_or("Open the notebook first")?;
    database.client.batch_execute("CREATE TABLE IF NOT EXISTS scribly_meetings (id TEXT PRIMARY KEY, document JSONB NOT NULL)").map_err(|e| e.to_string())?;
    operation(database)
}
pub(crate) fn load(app: &tauri::AppHandle, id: &str) -> Result<Meeting, String> {
    db(app, |database| {
        let row = database
            .client
            .query_opt("SELECT document FROM scribly_meetings WHERE id=$1", &[&id])
            .map_err(|e| e.to_string())?
            .ok_or("Meeting no longer exists")?;
        serde_json::from_value(row.get(0)).map_err(|e| e.to_string())
    })
}
pub(crate) fn save(app: &tauri::AppHandle, meeting: &Meeting) -> Result<(), String> {
    crate::meeting_backup::validate(meeting)?;
    let value = serde_json::to_value(meeting).map_err(|e| e.to_string())?;
    db(app, |database| {
        database.client.execute("INSERT INTO scribly_meetings(id,document) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document", &[&meeting.id, &value]).map_err(|e| e.to_string())?;
        Ok(())
    })?;
    let _ = app.emit("meeting-changed", &meeting.id);
    Ok(())
}
// Capture state and live results share a record. Keep each update atomic so a
// pause or timer update cannot replace newly received transcript segments.
pub(crate) fn modify(
    app: &tauri::AppHandle,
    id: &str,
    change: impl FnOnce(&mut Meeting) -> Result<(), String>,
) -> Result<Meeting, String> {
    let meeting = db(app, |database| {
        let row = database
            .client
            .query_opt("SELECT document FROM scribly_meetings WHERE id=$1", &[&id])
            .map_err(|e| e.to_string())?
            .ok_or("Meeting no longer exists")?;
        let mut meeting: Meeting = serde_json::from_value(row.get(0)).map_err(|e| e.to_string())?;
        change(&mut meeting)?;
        crate::meeting_backup::validate(&meeting)?;
        let document = serde_json::to_value(&meeting).map_err(|e| e.to_string())?;
        database
            .client
            .execute(
                "UPDATE scribly_meetings SET document=$2 WHERE id=$1",
                &[&id, &document],
            )
            .map_err(|e| e.to_string())?;
        Ok(meeting)
    })?;
    let _ = app.emit("meeting-changed", id);
    Ok(meeting)
}
#[tauri::command]
pub(crate) async fn meeting_list(app: tauri::AppHandle) -> Result<Vec<Meeting>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let busy = app.state::<MeetingState>();
        let active = busy.recorder.lock().map_err(|e| e.to_string())?.as_ref().map(|r| r.id.clone());
        let finalizing = busy.finalizing.lock().map_err(|e| e.to_string())?.clone();
        let jobs = busy.jobs.lock().map_err(|e| e.to_string())?;
        let notes_jobs = busy.notes_jobs.lock().map_err(|e| e.to_string())?;
        let mut meetings: Vec<Meeting> = db(&app, |database| database.client.query("SELECT document FROM scribly_meetings ORDER BY (document->>'createdAt')::bigint DESC", &[]).map_err(|e| e.to_string())?.into_iter().map(|row| serde_json::from_value(row.get(0)).map_err(|e| e.to_string())).collect())?;
        for meeting in &mut meetings {
            let mut changed = false;
            if matches!(meeting.recording.as_str(), "recording" | "paused") && active.as_deref() != Some(&meeting.id) && !finalizing.contains(&meeting.id) {
                meeting.recording = "interrupted".into(); meeting.error = Some("Recording was interrupted. Recover the saved audio below.".into()); changed = true;
            }
            if matches!(meeting.processing.as_str(), "transcribing" | "analyzing") && !jobs.contains_key(&meeting.id) {
                meeting.processing = "failed".into(); meeting.error = Some("Processing was interrupted. Check provider usage before retrying transcription; the recording was retained.".into()); changed = true;
            }
            if meeting.notes_status == "processing" && !notes_jobs.contains_key(&meeting.id) {
                meeting.notes_status = "failed".into(); meeting.error = Some("Automatic notes were interrupted. Completed results were retained; generate missing sections explicitly.".into()); changed = true;
            }
            if changed { save(&app, meeting)?; }
        }
        Ok(meetings)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_import(
    app: tauri::AppHandle,
    title: String,
    note_id: Option<String>,
) -> Result<Option<Meeting>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter(
                "Recordings",
                &["wav", "mp3", "m4a", "flac", "ogg", "webm", "mp4"],
            )
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let source = file.into_path().map_err(|e| e.to_string())?;
        let extension = source
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let name = format!("audio.{extension}");
        if !valid_media_name(&name) {
            return Err("Choose a supported audio or video recording".into());
        }
        let size = fs::metadata(&source).map_err(|e| e.to_string())?.len();
        if size == 0 || size > MAX_MEDIA {
            return Err("Choose a nonempty recording smaller than 2 GiB".into());
        }
        let root = attachment_root(&app)?;
        let mut meeting = Meeting::new(
            if title.trim().is_empty() {
                source
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            } else {
                title
            },
            note_id,
        );
        let directory = folder(&root, &meeting.id)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        fs::copy(source, directory.join(&name)).map_err(|e| e.to_string())?;
        if matches!(extension.as_str(), "mp4" | "webm") {
            meeting.video = Some(name.clone());
        }
        meeting.media = Some(name);
        save(&app, &meeting)?;
        Ok(Some(meeting))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_update(
    app: tauri::AppHandle,
    id: String,
    title: String,
    speakers: HashMap<String, String>,
    segments: Vec<Segment>,
) -> Result<Meeting, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&id) {
            return Err("Cancel processing before editing the transcript".into());
        }
        if state
            .notes_jobs
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(&id)
        {
            return Err("Cancel automatic meeting notes before editing the transcript".into());
        }
        if state
            .finalizing
            .lock()
            .map_err(|e| e.to_string())?
            .contains(&id)
        {
            return Err("Wait for recording to finish saving before editing".into());
        }
        validate_segments(&segments)?;
        if title.trim().is_empty()
            || title.len() > 800
            || speakers.len() > 100
            || speakers
                .iter()
                .any(|(id, name)| id.len() > 40 || name.len() > 200)
        {
            return Err("Invalid meeting title or speaker name".into());
        }
        let mut meeting = load(&app, &id)?;
        if matches!(meeting.recording.as_str(), "recording" | "paused") {
            return Err("End recording before editing its transcript".into());
        }
        if meeting
            .segments
            .iter()
            .map(|s| (&s.text, &s.speaker, s.start.to_bits(), s.end.to_bits()))
            .collect::<Vec<_>>()
            != segments
                .iter()
                .map(|s| (&s.text, &s.speaker, s.start.to_bits(), s.end.to_bits()))
                .collect::<Vec<_>>()
            || meeting.speakers != speakers
        {
            meeting.revision += 1;
            meeting.recovery = None;
            meeting.speaker_warning = None;
        }
        if meeting.title != title {
            meeting.recovery = None;
        }
        meeting.title = title;
        // A changed name is a human correction and must no longer be treated as inferred.
        meeting.speaker_identities.retain(|identity| {
            meeting.speakers.get(&identity.speaker_id) == speakers.get(&identity.speaker_id)
        });
        meeting.speakers = speakers;
        meeting.segments = segments;
        save(&app, &meeting)?;
        Ok(meeting)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn validate_segments(segments: &[Segment]) -> Result<(), String> {
    let mut total = 0;
    for (index, segment) in segments.iter().enumerate() {
        total += segment.text.len();
        if segment.id != index
            || !segment.start.is_finite()
            || !segment.end.is_finite()
            || segment.start < 0.0
            || segment.end < segment.start
            || segment.end > 24.0 * 3600.0
            || segment.speaker.len() > 40
            || segment.text.len() > 50_000
            || segment.words.len() > 10_000
            || segment.words.iter().any(|word| {
                word.text.len() > 1000
                    || !word.start.is_finite()
                    || !word.end.is_finite()
                    || word.start < 0.0
                    || word.end < word.start
                    || word.end > 86_400.0
                    || !word.confidence.is_finite()
                    || !(0.0..=1.0).contains(&word.confidence)
            })
        {
            return Err("Invalid transcript segment".into());
        }
    }
    if segments.len() > 100_000 || total > 10 * 1024 * 1024 {
        return Err("Transcript is too large".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn meeting_trash(
    app: tauri::AppHandle,
    id: String,
    trashed: bool,
) -> Result<Meeting, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let notes_jobs = state.notes_jobs.lock().map_err(|e| e.to_string())?;
        let recording = state.recorder.lock().map_err(|e| e.to_string())?;
        let finalizing = state.finalizing.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&id)
            || notes_jobs.contains_key(&id)
            || recording.as_ref().is_some_and(|r| r.id == id)
            || finalizing.contains(&id)
        {
            return Err(
                "End recording and cancel processing before moving this meeting to Trash".into(),
            );
        }
        modify(&app, &id, |meeting| {
            meeting.deleted_at = if trashed { Some(now()) } else { None };
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_action(
    app: tauri::AppHandle,
    id: String,
    analysis_id: String,
    index: usize,
    completed: bool,
) -> Result<Meeting, String> {
    tauri::async_runtime::spawn_blocking(move || {
        modify(&app, &id, |meeting| {
            if meeting.deleted_at.is_some()
                || !meeting.analyses.iter().any(|analysis| {
                    analysis.id == analysis_id
                        && analysis.kind == "actions"
                        && index < analysis.items.len()
                })
            {
                return Err("This action item is unavailable".into());
            }
            let key = format!("{analysis_id}:{index}");
            meeting.completed_actions.retain(|item| item != &key);
            if completed {
                meeting.completed_actions.push(key);
            }
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_media(
    app: tauri::AppHandle,
    id: String,
    video: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meeting = load(&app, &id)?;
        let name = if video {
            meeting.video.as_ref()
        } else {
            meeting.media.as_ref()
        }
        .ok_or("Recording has not been finalized")?;
        let path = media_path(&attachment_root(&app)?, &meeting, name)?;
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn meeting_cancel(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if let Some(cancel) = app
        .state::<MeetingState>()
        .notes_jobs
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
    {
        cancel.cancel();
    }
    if let Some(cancel) = app
        .state::<MeetingState>()
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
    {
        cancel.cancel();
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn meeting_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        let recording = state.recorder.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&id)
            || state
                .notes_jobs
                .lock()
                .map_err(|e| e.to_string())?
                .contains_key(&id)
            || recording.as_ref().is_some_and(|r| r.id == id)
            || state
                .finalizing
                .lock()
                .map_err(|e| e.to_string())?
                .contains(&id)
        {
            return Err("Stop recording and cancel processing before deleting".into());
        }
        let root = attachment_root(&app)?;
        let directory = folder(&root, &id)?;
        // Check the resolved target before recursive deletion, including junctions.
        if directory.exists() {
            let target = dunce::canonicalize(&directory).map_err(|e| e.to_string())?;
            let base = dunce::canonicalize(root.join("meetings")).map_err(|e| e.to_string())?;
            if !target.starts_with(&base) || target == base {
                return Err("Invalid meeting directory".into());
            }
            fs::remove_dir_all(&directory)
                .map_err(|e| format!("Recording could not be deleted: {e}"))?;
        }
        db(&app, |database| {
            database
                .client
                .execute("DELETE FROM scribly_meetings WHERE id=$1", &[&id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })?;
        let _ = app.emit("meeting-changed", id);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn begin_job(app: &tauri::AppHandle, id: &str) -> Result<CancellationToken, String> {
    let state = app.state::<MeetingState>();
    let mut jobs = state.jobs.lock().map_err(|e| e.to_string())?;
    if jobs.contains_key(id) {
        return Err("This meeting is already processing".into());
    }
    let cancel = CancellationToken::new();
    jobs.insert(id.into(), cancel.clone());
    Ok(cancel)
}
pub(crate) fn end_job(
    app: &tauri::AppHandle,
    id: &str,
    result: Result<Meeting, String>,
) -> Result<Meeting, String> {
    let answer = match result {
        Ok(mut meeting) => {
            meeting.processing = "ready".into();
            meeting.error = None;
            save(app, &meeting).map(|()| meeting)
        }
        Err(error) => {
            if let Ok(mut meeting) = load(app, id) {
                meeting.processing = "failed".into();
                meeting.error = Some(error.clone());
                let _ = save(app, &meeting);
            }
            Err(error)
        }
    };
    app.state::<MeetingState>()
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(id);
    answer
}

#[tauri::command]
pub(crate) async fn meeting_archive(
    app: tauri::AppHandle,
    id: String,
    include_media: bool,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MeetingState>();
        let jobs = state.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.contains_key(&id) {
            return Err("Cancel processing before exporting a backup".into());
        }
        let meeting = load(&app, &id)?;
        drop(jobs);
        if matches!(meeting.recording.as_str(), "recording" | "paused") {
            return Err("Stop recording before exporting a backup".into());
        }
        let Some(destination) = app
            .dialog()
            .file()
            .set_file_name("Meeting.scribly-meeting")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        crate::meeting_backup::export(
            &meeting,
            &attachment_root(&app)?,
            &destination.into_path().map_err(|e| e.to_string())?,
            include_media,
        )?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn meeting_restore(app: tauri::AppHandle) -> Result<Option<Meeting>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(source) = app
            .dialog()
            .file()
            .add_filter("Meeting backup", &["scribly-meeting"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let root = attachment_root(&app)?;
        let meeting =
            crate::meeting_backup::restore(&source.into_path().map_err(|e| e.to_string())?, &root)?;
        if let Err(error) = save(&app, &meeting) {
            let _ = crate::meeting_backup::remove_directory(&root, &meeting.id);
            return Err(error);
        }
        Ok(Some(meeting))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transcript_and_media_boundaries() {
        assert!(folder(Path::new("root"), "../private").is_err());
        assert!(!valid_media_name("../audio.wav"));
        let mut segments = vec![Segment {
            id: 0,
            start: 0.0,
            end: 1.0,
            speaker: "0".into(),
            text: "Hello".into(),
        }];
        assert!(validate_segments(&segments).is_ok());
        segments[0].end = f64::NAN;
        assert!(validate_segments(&segments).is_err());
        segments[0].end = 1.0;
        segments[0].id = 4;
        assert!(validate_segments(&segments).is_err());
    }
}

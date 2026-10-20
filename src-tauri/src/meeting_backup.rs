use crate::{
    files,
    meetings::{self, Meeting, MAX_MEDIA},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::Path,
};
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    meeting: Meeting,
    #[serde(default)]
    conversations: Vec<crate::ai_conversations::Conversation>,
}
pub(crate) fn validate(meeting: &Meeting) -> Result<(), String> {
    meetings::validate_segments(&meeting.segments)?;
    crate::meeting_recovery::validate(meeting)?;
    crate::ai_conversations::validate_recovery(meeting)?;
    if meeting
        .diarization_warning
        .as_ref()
        .is_some_and(|warning| warning.len() > 2000)
    {
        return Err("Invalid diarization warning".into());
    }
    if meeting.replay_candidates.len() > 1000
        || meeting
            .replay_candidates
            .iter()
            .map(|s| s.text.len())
            .sum::<usize>()
            > 1_000_000
    {
        return Err("Too many replay candidates. Review them before resuming again.".into());
    }
    for candidate in &meeting.replay_candidates {
        if candidate.id >= meeting.segments.len() && candidate.id != 100_000 {
            return Err("Invalid replay source".into());
        }
        let mut payload = candidate.clone();
        payload.id = 0;
        meetings::validate_segments(&[payload])?;
    }
    crate::meeting_providers::validate_speaker_identities(
        &meeting.speaker_identities,
        &meeting.segments,
        meeting.speaker_identity_revision == Some(meeting.revision),
    )?;
    if meeting.title.trim().is_empty()
        || meeting.title.len() > 800
        || !meeting.duration.is_finite()
        || !(0.0..=86_400.0).contains(&meeting.duration)
        || meeting.speakers.len() > 100
        || meeting
            .speakers
            .iter()
            .any(|(key, name)| key.len() > 40 || name.len() > 200)
        || meeting.analyses.len() > 1000
        || meeting.completed_actions.len() > 300_000
        || meeting.completed_actions.iter().any(|key| key.len() > 120)
        || meeting
            .speaker_identity_revision
            .is_some_and(|revision| revision > meeting.revision)
        || meeting
            .chatgpt_speaker_revision
            .is_some_and(|revision| revision > meeting.revision)
        || (!meeting.speaker_identities.is_empty() && meeting.speaker_identity_revision.is_none())
        || !matches!(
            meeting.notes_status.as_str(),
            "" | "processing" | "ready" | "failed"
        )
        || meeting
            .notes_model
            .as_ref()
            .is_some_and(|model| model.is_empty() || model.len() > 100)
        || meeting.transcription_model.as_ref().is_some_and(|model| {
            !crate::meeting_auth::valid_transcription_model(model)
                && !matches!(
                    model.as_str(),
                    "gemini-3.5-transcribe" | "gemini-3.5-transcribe-live"
                )
        })
        || meeting
            .transcription_language
            .as_ref()
            .is_some_and(|language| {
                language.is_empty()
                    || language.len() > 12
                    || !language
                        .bytes()
                        .all(|b| b.is_ascii_alphabetic() || b == b'-')
            })
        || meeting
            .stop_reason
            .as_ref()
            .is_some_and(|reason| !matches!(reason.as_str(), "manual" | "silence" | "shutdown"))
    {
        return Err("Invalid meeting metadata".into());
    }
    if meeting
        .media
        .as_ref()
        .is_some_and(|n| !meetings::valid_media_name(n))
        || meeting
            .video
            .as_ref()
            .is_some_and(|n| !matches!(n.as_str(), "video.mp4" | "audio.mp4" | "audio.webm"))
    {
        return Err("Invalid meeting media reference".into());
    }
    let mut text_bytes = 0usize;
    for analysis in &meeting.analyses {
        if !matches!(
            analysis.kind.as_str(),
            "summary" | "minutes" | "actions" | "study" | "flashcards" | "quiz" | "question"
        ) || analysis.model.len() > 100
            || analysis.question.len() > 4000
            || analysis.items.len() > 300
        {
            return Err("Invalid meeting analysis".into());
        }
        for item in &analysis.items {
            text_bytes += item.text.len();
            if item.text.len() > 20_000
                || item.sources.is_empty()
                || item.sources.len() > 100
                || item.owner.as_ref().is_some_and(|v| v.len() > 200)
                || item.deadline.as_ref().is_some_and(|v| v.len() > 200)
                || (analysis.revision == meeting.revision
                    && item.sources.iter().any(|source| {
                        !meeting.segments.iter().any(|segment| segment.id == *source)
                    }))
            {
                return Err("Invalid analysis evidence".into());
            }
        }
    }
    if text_bytes > 16 * 1024 * 1024 {
        return Err("Meeting analysis history is too large. Export the existing results before adding more.".into());
    }
    Ok(())
}
pub(crate) fn export(
    meeting: &Meeting,
    root: &Path,
    path: &Path,
    include_media: bool,
    conversations: Vec<crate::ai_conversations::Conversation>,
) -> Result<(), String> {
    validate(meeting)?;
    if conversations.len() > 50 {
        return Err("Too many conversations in backup".into());
    }
    for c in &conversations {
        crate::ai_conversations::validate(c)?;
        if c.scope != "meeting" || c.parent_id != meeting.id {
            return Err("Invalid meeting conversation backup scope".into());
        }
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let mut exported = meeting.clone();
        if !include_media {
            exported.media = None;
            exported.video = None;
            exported.recording = "saved".into();
        }
        archive
            .start_file("meeting.json", options)
            .map_err(|e| e.to_string())?;
        let manifest = serde_json::to_vec(&Manifest {
            version: 2,
            meeting: exported,
            conversations,
        })
        .map_err(|e| e.to_string())?;
        if manifest.len() > 32 * 1024 * 1024 {
            return Err("Meeting backup metadata is too large".into());
        }
        archive.write_all(&manifest).map_err(|e| e.to_string())?;
        if include_media {
            for reference in [meeting.media.as_ref(), meeting.video.as_ref()]
                .into_iter()
                .flatten()
            {
                meetings::media_path(root, meeting, reference)?;
            }
            let directory = meetings::folder(root, &meeting.id)?;
            if directory.exists() {
                for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !meetings::valid_media_name(&name) {
                        continue;
                    }
                    let source = meetings::media_path(root, meeting, &name)?;
                    if source.metadata().map_err(|e| e.to_string())?.len() > MAX_MEDIA {
                        return Err("Recording exceeds the meeting backup size limit".into());
                    }
                    archive
                        .start_file(name, options)
                        .map_err(|e| e.to_string())?;
                    std::io::copy(
                        &mut fs::File::open(source).map_err(|e| e.to_string())?,
                        &mut archive,
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
        archive
            .finish()
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        files::replace_with(path, |target| {
            std::io::copy(&mut fs::File::open(&temporary)?, target).map(|_| ())
        })
        .map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temporary);
    result
}
pub(crate) fn remove_directory(root: &Path, id: &str) -> Result<(), String> {
    let directory = meetings::folder(root, id)?;
    if !directory.exists() {
        return Ok(());
    }
    let target = dunce::canonicalize(&directory).map_err(|e| e.to_string())?;
    let base = dunce::canonicalize(root.join("meetings")).map_err(|e| e.to_string())?;
    if !target.starts_with(&base) || target == base {
        return Err("Invalid meeting directory".into());
    }
    fs::remove_dir_all(directory).map_err(|e| e.to_string())
}
pub(crate) fn restore(
    path: &Path,
    root: &Path,
) -> Result<(Meeting, Vec<crate::ai_conversations::Conversation>), String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if archive.len() > 20 {
        return Err("Invalid meeting backup".into());
    }
    let mut bytes = vec![];
    archive
        .by_name("meeting.json")
        .map_err(|e| e.to_string())?
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Meeting backup metadata is too large".into());
    }
    let Manifest {
        version,
        mut meeting,
        mut conversations,
    } = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if !matches!(version, 1 | 2) {
        return Err("Unsupported meeting backup version".into());
    }
    validate(&meeting)?;
    if conversations.len() > 50 {
        return Err("Too many conversations in meeting backup".into());
    }
    for c in &conversations {
        crate::ai_conversations::validate(c)?;
        if c.scope != "meeting" || c.parent_id != meeting.id {
            return Err("Invalid conversation parent in backup".into());
        }
    }
    let interrupted = matches!(
        meeting.recording.as_str(),
        "recording" | "paused" | "interrupted"
    );
    meeting.id = uuid::Uuid::new_v4().to_string();
    let mut remap = std::collections::HashMap::new();
    for c in &mut conversations {
        let fresh = uuid::Uuid::new_v4().to_string();
        remap.insert(c.id.clone(), fresh.clone());
        c.id = fresh;
        c.parent_id = meeting.id.clone();
        c.memory = None;
        for message in &mut c.messages {
            let fresh = uuid::Uuid::new_v4().to_string();
            remap.insert(message.id.clone(), fresh.clone());
            message.id = fresh;
            if message.status == "pending" {
                message.status = "failed".into();
            }
        }
    }
    for analysis in &mut meeting.analyses {
        if let Some(id) = &analysis.conversation_id {
            analysis.conversation_id = Some(
                remap
                    .get(id)
                    .ok_or("Missing conversation referenced by backup")?
                    .clone(),
            );
        }
        if let Some(id) = remap.get(&analysis.id) {
            analysis.id = id.clone();
        }
    }
    meeting.note_id = None;
    meeting.deleted_at = None;
    meeting.auto_notes = false;
    meeting.notes_status.clear();
    meeting.processing = "idle".into();
    meeting.recording = if interrupted && meeting.media.is_none() {
        "interrupted"
    } else {
        "saved"
    }
    .into();
    meeting.error = None;
    let directory = meetings::folder(root, &meeting.id)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut total = 0u64;
        let mut seen = HashSet::new();
        for index in 0..archive.len() {
            let entry = archive.by_index(index).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if !seen.insert(name.clone()) {
                return Err("Duplicate meeting backup entry".into());
            }
            if name == "meeting.json" {
                continue;
            }
            let size = entry.size();
            total = total.checked_add(size).ok_or("Oversized meeting backup")?;
            if !meetings::valid_media_name(&name) || size > MAX_MEDIA || total > 8 * MAX_MEDIA {
                return Err("Invalid or oversized meeting backup entry".into());
            }
            let mut target = fs::File::create(directory.join(name)).map_err(|e| e.to_string())?;
            if std::io::copy(&mut entry.take(size + 1), &mut target).map_err(|e| e.to_string())?
                != size
            {
                return Err("Meeting backup size did not match".into());
            }
            target.sync_all().map_err(|e| e.to_string())?;
        }
        for name in [meeting.media.as_ref(), meeting.video.as_ref()]
            .into_iter()
            .flatten()
        {
            meetings::media_path(root, &meeting, name)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = remove_directory(root, &meeting.id);
    }
    result.map(|()| (meeting, conversations))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_ai_backup_remaps_history_and_preserves_sources() {
        use crate::ai_conversations::{complete, pending, Conversation, Memory};
        let root =
            std::env::temp_dir().join(format!("scribly-local-backup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let mut meeting = Meeting::new("Local conversation".into(), None);
        meeting.segments.push(meetings::Segment {
            id: 0,
            start: 0.0,
            end: 1.0,
            speaker: "0".into(),
            text: "Sam will test tomorrow.".into(),
            words: vec![meetings::TranscriptWord {
                text: "Sam".into(),
                start: 0.0,
                end: 0.2,
                confidence: None,
            }],
            speaker_spans: vec![meetings::SpeakerSpan {
                speaker: "0".into(),
                start: 0.0,
                end: 1.0,
                text_start: 0,
                text_end: 23,
            }],
            corrected: false,
            original_text: Some("sam will test tomorrow".into()),
            provenance: Some(meetings::Provenance {
                provider: "moonshine".into(),
                session: uuid::Uuid::new_v4().to_string(),
                line: "12345678901234567890".into(),
            }),
        });
        let model = crate::meeting_ollama::Model {
            id: "gemma4:e4b".into(),
            name: String::new(),
            digest: "digest".into(),
            quantization: "Q4_K_M".into(),
            thinking: true,
        };
        let mut c = Conversation {
            version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            scope: "meeting".into(),
            parent_id: meeting.id.clone(),
            created_at: 0,
            messages: vec![],
            memory: None,
        };
        let request = pending(&mut c, "Those tasks?", 0, &model);
        complete(&mut c, "Sam will test".into(), vec![0], None);
        c.memory = Some(Memory {
            text: "User prefers concise tasks".into(),
            covered_ids: c.messages.iter().map(|m| m.id.clone()).collect(),
            revision: 0,
        });
        meeting.analyses.push(meetings::Analysis {
            id: request.clone(),
            kind: "question".into(),
            model: model.id,
            question: "Those tasks?".into(),
            revision: 0,
            created_at: 0,
            items: vec![meetings::AnalysisItem {
                text: "Sam will test".into(),
                sources: vec![0],
                owner: Some("Sam".into()),
                deadline: None,
                section: None,
            }],
            provider: Some("ollama".into()),
            model_digest: Some(model.digest),
            quantization: Some(model.quantization),
            conversation_id: Some(c.id.clone()),
        });
        let archive = root.join("local.scribly-meeting");
        export(&meeting, &root, &archive, false, vec![c.clone()]).unwrap();
        let (restored, conversations) = restore(&archive, &root).unwrap();
        let saved = &conversations[0];
        assert_ne!(saved.id, c.id);
        assert_eq!(saved.parent_id, restored.id);
        assert_ne!(saved.messages[1].id, request);
        assert_eq!(restored.analyses[0].id, saved.messages[1].id);
        assert_eq!(
            restored.analyses[0].conversation_id.as_deref(),
            Some(saved.id.as_str())
        );
        assert_eq!(saved.messages[1].sources, vec![0]);
        assert!(saved.memory.is_none());
        assert_eq!(restored.segments[0].words[0].confidence, None);
        assert_eq!(
            restored.segments[0].original_text.as_deref(),
            Some("sam will test tomorrow")
        );
        assert_eq!(
            restored.segments[0].provenance.as_ref().unwrap().line,
            "12345678901234567890"
        );
        let file = fs::File::create(&archive).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("meeting.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        let mut legacy = serde_json::to_value(Manifest {
            version: 1,
            meeting: Meeting::new("Legacy".into(), None),
            conversations: vec![],
        })
        .unwrap();
        legacy.as_object_mut().unwrap().remove("conversations");
        zip.write_all(&serde_json::to_vec(&legacy).unwrap())
            .unwrap();
        zip.finish().unwrap();
        assert!(restore(&archive, &root).unwrap().1.is_empty());
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn meeting_archive_roundtrip_and_traversal_rejection() {
        let root =
            std::env::temp_dir().join(format!("scribly-meeting-backup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let mut meeting = Meeting::new("Meeting backup".into(), Some("old-note".into()));
        meeting.transcription_model = Some("gemini-3.5-transcribe".into());
        meeting.transcription_language = Some("multi".into());
        meeting.notes_model = Some("gemini-3.8-flash".into());
        // Older records remain readable; current inference metadata survives a backup.
        let mut legacy = serde_json::to_value(&meeting).unwrap();
        legacy.as_object_mut().unwrap().remove("speakerIdentities");
        legacy
            .as_object_mut()
            .unwrap()
            .remove("speakerIdentityRevision");
        legacy
            .as_object_mut()
            .unwrap()
            .remove("chatgptSpeakerRevision");
        assert!(serde_json::from_value::<Meeting>(legacy)
            .unwrap()
            .speaker_identities
            .is_empty());
        meeting.segments.push(meetings::Segment {
            speaker_spans: vec![],
            provenance: None,
            corrected: false,
            original_text: None,
            id: 0,
            start: 0.0,
            end: 1.0,
            speaker: "0".into(),
            text: "I am Mark from DBA.".into(),
            words: vec![],
        });
        meeting.speaker_identity_revision = Some(meeting.revision);
        meeting.chatgpt_speaker_revision = Some(meeting.revision);
        meeting.speaker_identities.push(meetings::SpeakerIdentity {
            speaker_id: "0".into(),
            name: "Mark".into(),
            team: Some("DBA".into()),
            aliases: vec!["Marc".into()],
            confidence: "strong".into(),
            sources: vec![0],
            reason: "Self-introduction".into(),
        });
        let mut invalid = meeting.clone();
        invalid.speaker_identities[0].sources = vec![99];
        assert!(validate(&invalid).is_err());
        let mut invalid = meeting.clone();
        invalid.chatgpt_speaker_revision = Some(meeting.revision + 1);
        assert!(validate(&invalid).is_err());
        meeting.media = Some("audio.wav".into());
        let directory = meetings::folder(&root, &meeting.id).unwrap();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("audio.wav"), b"owned recording").unwrap();
        let destination = root.join("meeting.scribly-meeting");
        export(&meeting, &root, &destination, true, vec![]).unwrap();
        let restored = restore(&destination, &root).unwrap().0;
        assert_ne!(restored.id, meeting.id);
        assert_eq!(restored.note_id, None);
        assert_eq!(
            restored.transcription_model.as_deref(),
            Some("gemini-3.5-transcribe")
        );
        assert_eq!(restored.notes_model.as_deref(), Some("gemini-3.8-flash"));
        assert_eq!(restored.speaker_identities[0].label(), "Mark (DBA)");
        assert_eq!(restored.speaker_identities[0].sources, vec![0]);
        assert_eq!(restored.chatgpt_speaker_revision, Some(restored.revision));
        assert_eq!(
            fs::read(
                meetings::folder(&root, &restored.id)
                    .unwrap()
                    .join("audio.wav")
            )
            .unwrap(),
            b"owned recording"
        );
        export(&meeting, &root, &destination, false, vec![]).unwrap();
        assert!(restore(&destination, &root).unwrap().0.media.is_none());
        let file = fs::File::create(&destination).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        archive.start_file("meeting.json", options).unwrap();
        let mut metadata = meeting.clone();
        metadata.media = None;
        archive
            .write_all(
                &serde_json::to_vec(&Manifest {
                    conversations: vec![],
                    version: 1,
                    meeting: metadata,
                })
                .unwrap(),
            )
            .unwrap();
        archive.start_file("../outside.wav", options).unwrap();
        archive.write_all(b"unsafe").unwrap();
        archive.finish().unwrap();
        assert!(restore(&destination, &root).is_err());
        assert!(!root.join("outside.wav").exists());
        let target = dunce::canonicalize(&root).unwrap();
        assert!(target.starts_with(dunce::canonicalize(std::env::temp_dir()).unwrap()));
        fs::remove_dir_all(target).unwrap();
    }
}

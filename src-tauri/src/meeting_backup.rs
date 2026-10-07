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
}
pub(crate) fn validate(meeting: &Meeting) -> Result<(), String> {
    meetings::validate_segments(&meeting.segments)?;
    crate::meeting_recovery::validate(meeting)?;
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
        || (!meeting.speaker_identities.is_empty() && meeting.speaker_identity_revision.is_none())
        || !matches!(
            meeting.notes_status.as_str(),
            "" | "processing" | "ready" | "failed"
        )
        || meeting
            .notes_model
            .as_ref()
            .is_some_and(|model| model.is_empty() || model.len() > 100)
        || meeting
            .transcription_model
            .as_ref()
            .is_some_and(|model| !crate::meeting_auth::valid_transcription_model(model))
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
) -> Result<(), String> {
    validate(meeting)?;
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
            version: 1,
            meeting: exported,
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
pub(crate) fn restore(path: &Path, root: &Path) -> Result<Meeting, String> {
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
    } = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if version != 1 {
        return Err("Unsupported meeting backup version".into());
    }
    validate(&meeting)?;
    let interrupted = matches!(
        meeting.recording.as_str(),
        "recording" | "paused" | "interrupted"
    );
    meeting.id = uuid::Uuid::new_v4().to_string();
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
    result.map(|()| meeting)
}
#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(serde_json::from_value::<Meeting>(legacy)
            .unwrap()
            .speaker_identities
            .is_empty());
        meeting.segments.push(meetings::Segment {
            id: 0,
            start: 0.0,
            end: 1.0,
            speaker: "0".into(),
            text: "I am Mark from DBA.".into(),
        });
        meeting.speaker_identity_revision = Some(meeting.revision);
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
        meeting.media = Some("audio.wav".into());
        let directory = meetings::folder(&root, &meeting.id).unwrap();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("audio.wav"), b"owned recording").unwrap();
        let destination = root.join("meeting.scribly-meeting");
        export(&meeting, &root, &destination, true).unwrap();
        let restored = restore(&destination, &root).unwrap();
        assert_ne!(restored.id, meeting.id);
        assert_eq!(restored.note_id, None);
        assert_eq!(
            restored.transcription_model.as_deref(),
            Some("gemini-3.5-transcribe")
        );
        assert_eq!(restored.notes_model.as_deref(), Some("gemini-3.8-flash"));
        assert_eq!(restored.speaker_identities[0].label(), "Mark (DBA)");
        assert_eq!(restored.speaker_identities[0].sources, vec![0]);
        assert_eq!(
            fs::read(
                meetings::folder(&root, &restored.id)
                    .unwrap()
                    .join("audio.wav")
            )
            .unwrap(),
            b"owned recording"
        );
        export(&meeting, &root, &destination, false).unwrap();
        assert!(restore(&destination, &root).unwrap().media.is_none());
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

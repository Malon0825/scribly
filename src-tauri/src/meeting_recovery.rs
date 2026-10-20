//! Legacy recovery metadata retained only for reading existing records and backups.
use crate::{
    meeting_providers,
    meetings::{self, Meeting},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

const MAX_CHECKPOINTS: usize = 512;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Checkpoint {
    key: String,
    field: String,
    output: Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Progress {
    pub kind: String,
    pub model: String,
    pub revision: u64,
    pub title: String,
    pub question: String,
    pub notes: String,
    checkpoints: Vec<Checkpoint>,
    splits: Vec<String>,
}

pub(crate) fn validate(meeting: &Meeting) -> Result<(), String> {
    if meeting
        .speaker_warning
        .as_ref()
        .is_some_and(|text| text.len() > 2000)
    {
        return Err("Invalid speaker warning".into());
    }
    let Some(progress) = &meeting.recovery else {
        return Ok(());
    };
    meeting_providers::analysis_instructions(&progress.kind)?;
    if progress.model != "nvidia/nemotron-3.5-lightning:free"
        || progress.revision != meeting.revision
        || progress.title.len() > 800
        || progress.question.len() > 4000
        || progress.notes.len() > 20_000
        || progress.checkpoints.len() > MAX_CHECKPOINTS
        || progress.splits.len() > MAX_CHECKPOINTS
    {
        return Err("Invalid meeting recovery state".into());
    }
    let valid_key = |key: &str| key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit());
    let mut keys = HashSet::new();
    let mut bytes = 0;
    for checkpoint in &progress.checkpoints {
        if !valid_key(&checkpoint.key) || !keys.insert(&checkpoint.key) {
            return Err("Invalid recovery checkpoint key".into());
        }
        let text = checkpoint.output.to_string();
        bytes += text.len();
        if bytes > 8 * 1024 * 1024 {
            return Err("Meeting recovery data is too large".into());
        }
        match checkpoint.field.as_str() {
            "items" => {
                meeting_providers::analysis_items(&text, &meeting.segments)?;
            }
            "speakers" => {
                let identities: Vec<meetings::SpeakerIdentity> =
                    serde_json::from_value(checkpoint.output["speakers"].clone())
                        .map_err(|_| "Invalid speaker checkpoint")?;
                meeting_providers::validate_speaker_identities(
                    &identities,
                    &meeting.segments,
                    progress.revision == meeting.revision,
                )?;
            }
            _ => return Err("Invalid recovery checkpoint type".into()),
        }
    }
    keys.clear();
    if progress
        .splits
        .iter()
        .any(|key| !valid_key(key) || !keys.insert(key))
    {
        return Err("Invalid recovery split plan".into());
    }
    Ok(())
}

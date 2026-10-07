//! OpenRouter-only recovery. Subscription model requests never enter this module.
use crate::{
    meeting_openrouter, meeting_providers,
    meetings::{self, Analysis, Meeting, Segment},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::{Emitter, Manager};

const MAX_REQUESTS: usize = 48;
const MAX_RECOVERY_REQUESTS: usize = 8;
const MAX_DEPTH: usize = 3;
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
    if progress.model != meeting_openrouter::MODEL
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

struct Session<'a> {
    app: &'a tauri::AppHandle,
    id: &'a str,
    token: &'a str,
    cancel: tokio_util::sync::CancellationToken,
    progress: Progress,
    requests: usize,
    recovery_requests: usize,
}
struct Findings {
    values: Vec<Value>,
    leaves: usize,
}
impl Session<'_> {
    fn emit(&self, message: &str, text: &str) {
        let _ = self.app.emit(
            "meeting-analysis-stream",
            json!({
                "id":self.id,"kind":self.progress.kind,"part":0,"parts":0,
                "message":message,"texts":meeting_openrouter::draft_texts(text),"done":false
            }),
        );
    }
    async fn persist(&self) -> Result<(), String> {
        let app = self.app.clone();
        let id = self.id.to_string();
        let progress = self.progress.clone();
        let cancel = self.cancel.clone();
        tauri::async_runtime::spawn_blocking(move || meetings::modify(&app, &id, |meeting| {
            if cancel.is_cancelled() || meeting.processing != "analyzing" || meeting.revision != progress.revision {
                return Err("Processing stopped or the transcript changed. Saved progress was retained.".into());
            }
            meeting.recovery = Some(progress);
            Ok(())
        })).await.map_err(|error| error.to_string())??;
        Ok(())
    }
    fn checkpoint_key(instructions: &str, input: &Value, field: &str) -> String {
        let mut hash = Sha256::new();
        for part in [
            "meeting-recovery-v1",
            meeting_openrouter::MODEL,
            instructions,
            field,
            &input.to_string(),
        ] {
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part.as_bytes());
        }
        format!("{:x}", hash.finalize())
    }
    // Only terminal, validated JSON is cached. Reasoning and truncated drafts
    // never become checkpoint content or completed meeting notes.
    async fn request(
        &mut self,
        instructions: &str,
        input: Value,
        field: &str,
        label: &str,
        segments: &[Segment],
    ) -> Result<Findings, String> {
        let mut pending = vec![(input, 0usize)];
        let mut findings = vec![];
        let mut leaves = 0;
        while let Some((input, depth)) = pending.pop() {
            if self.cancel.is_cancelled() {
                return Err("Processing canceled. Saved progress can be resumed.".into());
            }
            let key = Self::checkpoint_key(instructions, &input, field);
            if let Some(checkpoint) = self
                .progress
                .checkpoints
                .iter()
                .find(|checkpoint| checkpoint.key == key)
            {
                let values = validate_output(&checkpoint.output, &input, field, segments)?;
                findings.extend(values);
                leaves += 1;
                self.emit(&format!("{label} · Reusing saved progress"), "");
                continue;
            }
            let was_split = self.progress.splits.contains(&key);
            if !was_split {
                if self.requests >= MAX_REQUESTS
                    || (depth > 0 && self.recovery_requests >= MAX_RECOVERY_REQUESTS)
                {
                    return Err("Processing paused at the request limit. Validated parts were saved; choose Resume processing to continue. No paid fallback was made.".into());
                }
                self.requests += 1;
                if depth > 0 {
                    self.recovery_requests += 1;
                }
                self.emit(
                    &format!(
                        "{label} · {} validated parts saved",
                        self.progress.checkpoints.len()
                    ),
                    "",
                );
                let operation = format!("Nemotron {label}");
                let result = meeting_openrouter::analyze(
                    self.token,
                    &operation,
                    instructions,
                    &input.to_string(),
                    |text| {
                        if field == "items" {
                            self.emit(label, text);
                        }
                    },
                )
                .await;
                match result {
                    Ok(text) => {
                        let output: Value = serde_json::from_str(&text).map_err(|_| {
                            "AI result was not valid JSON. Saved progress was retained."
                        })?;
                        let values = validate_output(&output, &input, field, segments)?;
                        if self.progress.checkpoints.len() >= MAX_CHECKPOINTS {
                            return Err("This meeting reached the saved-part limit. Completed notes were retained.".into());
                        }
                        self.progress.checkpoints.push(Checkpoint {
                            key,
                            field: field.into(),
                            output,
                        });
                        self.persist().await?;
                        findings.extend(values);
                        leaves += 1;
                        continue;
                    }
                    Err(error) if error.token_limit && depth < MAX_DEPTH => {
                        if split_input(&input).is_none() {
                            return Err(format!("{} This part cannot be split further. Saved progress was retained.", error.message));
                        }
                        if self.progress.splits.len() >= MAX_CHECKPOINTS {
                            return Err("This meeting reached the recovery limit. Saved progress was retained.".into());
                        }
                        self.progress.splits.push(key);
                        self.persist().await?;
                    }
                    Err(error) => {
                        return Err(format!("{} Saved progress can be resumed.", error.message))
                    }
                }
            }
            let (left, right) = split_input(&input)
                .ok_or("This part cannot be split further. Saved progress was retained.")?;
            if depth >= MAX_DEPTH {
                return Err("This part reached the recovery depth limit. Saved progress was retained; use a more focused request.".into());
            }
            self.emit("This section needs smaller parts—continuing", "");
            pending.push((right, depth + 1));
            pending.push((left, depth + 1));
        }
        Ok(Findings {
            values: findings,
            leaves,
        })
    }

    async fn consolidate(
        &mut self,
        instructions: &str,
        mut findings: Vec<Value>,
        field: &str,
        base: Value,
        segments: &[Segment],
    ) -> Result<Vec<Value>, String> {
        if findings.is_empty() {
            return Ok(findings);
        }
        let input_field = if field == "speakers" {
            "candidates"
        } else {
            "sectionResults"
        };
        // Bound each consolidation input and reduce in stages, retaining source IDs.
        for level in 0..8 {
            let groups = finding_groups(&findings);
            let final_group = groups.len() == 1;
            let mut completed_whole_group = true;
            let mut merged = vec![];
            for (index, range) in groups.into_iter().enumerate() {
                let mut input = base.clone();
                input[input_field] = json!(&findings[range]);
                let label = if field == "speakers" {
                    "Reconciling speaker names".to_string()
                } else {
                    format!(
                        "Combining meeting findings · stage {}, part {}",
                        level + 1,
                        index + 1
                    )
                };
                let result = self
                    .request(instructions, input, field, &label, segments)
                    .await?;
                completed_whole_group &= result.leaves == 1;
                merged.extend(result.values);
            }
            if final_group
                && completed_whole_group
                && merged.len() <= output_limit(field, &self.progress.kind)
            {
                if field == "speakers" {
                    // Duplicate voice IDs from separate recovery branches require
                    // reconciliation, never picking a convenient winning name.
                    let mut ids = HashSet::new();
                    if merged
                        .iter()
                        .all(|value| ids.insert(value["speakerId"].as_str().unwrap_or("")))
                    {
                        return Ok(merged);
                    }
                } else {
                    return Ok(merged);
                }
            }
            if level > 0 && merged.len() >= findings.len() {
                return Err("The model could not condense the findings within the result limit. Saved parts were retained; use a more focused request.".into());
            }
            findings = merged;
        }
        Err("Consolidation reached its recovery limit. Saved progress was retained.".into())
    }
}

fn output_limit(field: &str, kind: &str) -> usize {
    if field == "speakers" {
        return 100;
    }
    match kind {
        "summary" => 8,
        "minutes" => 30,
        "actions" => 30,
        "study" => 12,
        "flashcards" => 15,
        "quiz" => 10,
        "question" => 6,
        _ => 300,
    }
}
fn finding_groups(values: &[Value]) -> Vec<std::ops::Range<usize>> {
    if values.is_empty() {
        return vec![0..0];
    }
    let mut groups = vec![];
    let mut from = 0;
    let mut bytes = 0;
    for (index, value) in values.iter().enumerate() {
        let size = value.to_string().len();
        if index > from && (bytes + size > 60_000 || index - from >= 40) {
            groups.push(from..index);
            from = index;
            bytes = 0;
        }
        bytes += size;
    }
    groups.push(from..values.len());
    groups
}
fn split_input(input: &Value) -> Option<(Value, Value)> {
    let field = ["transcript", "sectionResults", "candidates"]
        .into_iter()
        .find(|field| {
            input[*field]
                .as_array()
                .is_some_and(|items| items.len() > 1)
        })?;
    let values = input[field].as_array()?;
    let middle = values.len() / 2;
    let mut left = input.clone();
    let mut right = input.clone();
    left[field] = json!(&values[..middle]);
    right[field] = json!(&values[middle..]);
    if field == "transcript" {
        // Adjacent turns clarify address/reply pairs but cannot introduce source
        // citations outside the current part's transcript.
        left["followingContext"] = json!(&values[middle..(middle + 2).min(values.len())]);
        right["precedingContext"] = json!(&values[middle.saturating_sub(2)..middle]);
    }
    Some((left, right))
}
fn validate_output(
    output: &Value,
    input: &Value,
    field: &str,
    segments: &[Segment],
) -> Result<Vec<Value>, String> {
    let text = output.to_string();
    let allowed: HashSet<usize> = if let Some(transcript) = input["transcript"].as_array() {
        transcript
            .iter()
            .filter_map(|segment| {
                segment["id"]
                    .as_u64()
                    .and_then(|id| usize::try_from(id).ok())
            })
            .collect()
    } else {
        let source_field = if field == "speakers" {
            "candidates"
        } else {
            "sectionResults"
        };
        input[source_field]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|value| value["sources"].as_array().into_iter().flatten())
            .filter_map(|id| id.as_u64().and_then(|id| usize::try_from(id).ok()))
            .collect()
    };
    if field == "speakers" {
        meeting_providers::speaker_identities(&text, segments)?;
    } else {
        meeting_providers::analysis_items(&text, segments)?;
    }
    let values = output[field]
        .as_array()
        .ok_or("Invalid recovered result format")?;
    if values
        .iter()
        .flat_map(|value| value["sources"].as_array().into_iter().flatten())
        .any(|source| {
            source
                .as_u64()
                .and_then(|id| usize::try_from(id).ok())
                .is_none_or(|id| !allowed.contains(&id))
        })
    {
        return Err("Recovered result cited evidence outside the supplied part. Saved progress was retained.".into());
    }
    Ok(values.clone())
}

pub(crate) async fn analyze(
    app: &tauri::AppHandle,
    mut meeting: Meeting,
    token: &str,
    kind: &str,
    question: &str,
    notes: &str,
) -> Result<Meeting, String> {
    let instructions = meeting_providers::analysis_instructions(kind)?;
    let cancel = app
        .state::<meetings::MeetingState>()
        .jobs
        .lock()
        .map_err(|error| error.to_string())?
        .get(&meeting.id)
        .cloned()
        .ok_or("Meeting processing is no longer active")?;
    let progress = meeting
        .recovery
        .take()
        .filter(|progress| {
            progress.revision == meeting.revision
                && progress.title == meeting.title
                && progress.kind == kind
                && progress.question == question
                && progress.notes == notes
                && progress.model == meeting_openrouter::MODEL
        })
        .unwrap_or_else(|| Progress {
            kind: kind.into(),
            model: meeting_openrouter::MODEL.into(),
            revision: meeting.revision,
            title: meeting.title.clone(),
            question: question.into(),
            notes: notes.into(),
            checkpoints: vec![],
            splits: vec![],
        });
    let id = meeting.id.clone();
    let mut session = Session {
        app,
        id: &id,
        token,
        cancel,
        progress,
        requests: 0,
        recovery_requests: 0,
    };
    session.persist().await?;
    if meeting.speaker_identity_revision != Some(meeting.revision)
        && !meeting
            .segments
            .iter()
            .all(|segment| segment.speaker == "unknown")
    {
        let result = resolve_speakers(&mut session, &meeting).await;
        if session.cancel.is_cancelled() {
            return Err("Processing canceled. Saved progress can be resumed.".into());
        }
        match result {
            Ok(identities) => {
                let prior = meeting.speakers.clone();
                meeting_providers::apply_speaker_identities(&mut meeting, identities);
                if prior != meeting.speakers {
                    meeting.revision += 1;
                }
                meeting.speaker_warning = None;
            }
            Err(error) => {
                // An edited transcript can invalidate prior inferred identities.
                // Preserve human corrections, but do not promote stale inference
                // evidence to the new revision when name resolution fails.
                let prior = meeting.speakers.clone();
                for identity in &meeting.speaker_identities {
                    if identity.confidence == "strong"
                        && meeting.speakers.get(&identity.speaker_id) == Some(&identity.label())
                    {
                        meeting.speakers.remove(&identity.speaker_id);
                    }
                }
                meeting.speaker_identities.clear();
                if prior != meeting.speakers {
                    meeting.revision += 1;
                }
                meeting.speaker_warning = Some(format!("Speaker names could not be resolved. The recap uses existing or numbered speaker labels. {}", error.chars().take(1400).collect::<String>()));
            }
        }
        meeting.speaker_identity_revision = Some(meeting.revision);
        session.progress.revision = meeting.revision;
        meeting.recovery = Some(session.progress.clone());
        let app = app.clone();
        let saved = meeting.clone();
        let cancel = session.cancel.clone();
        tauri::async_runtime::spawn_blocking(move || {
            meetings::modify(&app, &saved.id, |current| {
                if cancel.is_cancelled() || current.processing != "analyzing" {
                    return Err("Processing canceled".to_string());
                }
                current.revision = saved.revision;
                current.speakers = saved.speakers;
                current.speaker_identities = saved.speaker_identities;
                current.speaker_identity_revision = saved.speaker_identity_revision;
                current.speaker_warning = saved.speaker_warning;
                current.recovery = saved.recovery;
                Ok(())
            })
            .map(|_| ())
        })
        .await
        .map_err(|error| error.to_string())??;
    }
    let scoped_instructions = format!("{instructions}\nContext fields only clarify adjoining turns. Cite only IDs in the transcript array of this part. Keep the result concise; do not repeat the transcript.");
    let groups = meeting_providers::transcript_parts(&meeting.segments);
    let total = groups.len();
    let mut findings = vec![];
    for (index, range) in groups.into_iter().enumerate() {
        let evidence: Vec<Value> = meeting.segments[range.clone()].iter().map(|segment| {
            let speaker = meeting.speakers.get(&segment.speaker).cloned().unwrap_or_else(|| segment.speaker.parse::<u64>().ok().and_then(|id| id.checked_add(1)).map_or_else(|| "Speaker unknown".into(), |id| format!("Speaker {id}")));
            let origin = if meeting.speaker_identities.iter().any(|identity| identity.speaker_id == segment.speaker && identity.confidence == "strong") { "AI inferred" } else if meeting.speakers.get(&segment.speaker).is_some_and(|name| !name.trim().is_empty()) { "user supplied" } else { "unnamed" };
            json!({"id":segment.id,"start":segment.start,"end":segment.end,"timestamp":format!("{}:{:02}",segment.start.floor() as u64 / 60,segment.start.floor() as u64 % 60),"speaker":speaker,"speakerNameOrigin":origin,"text":segment.text})
        }).collect();
        let input = json!({"title":meeting.title,"question":question,"notes":notes,"transcript":evidence,
            "precedingContext":&meeting.segments[range.start.saturating_sub(2)..range.start],
            "followingContext":&meeting.segments[range.end..(range.end + 2).min(meeting.segments.len())]});
        findings.extend(
            session
                .request(
                    &scoped_instructions,
                    input,
                    "items",
                    &format!("Processing part {} of {total}", index + 1),
                    &meeting.segments,
                )
                .await?
                .values,
        );
    }
    if total > 1
        || !session.progress.splits.is_empty()
        || findings.len() > output_limit("items", kind)
    {
        let consolidation = format!("{instructions}\nConsolidate only supplied sectionResults from consecutive parts of one meeting. Retain original source IDs. Remove duplicates and preserve chronological order, proposals, disagreements, uncertain owners and deadlines. Do not invent facts or merge distinct people. A later explicitly agreed decision can update a prior proposal; retain supporting evidence. Apply the requested item limit to the whole meeting.");
        findings = session
            .consolidate(
                &consolidation,
                findings,
                "items",
                json!({"title":meeting.title,"question":question}),
                &meeting.segments,
            )
            .await?;
    }
    let items = meeting_providers::analysis_items(
        &json!({"items":findings}).to_string(),
        &meeting.segments,
    )?;
    meeting.analyses.push(Analysis {
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.into(),
        model: meeting_openrouter::MODEL.into(),
        question: question.into(),
        revision: meeting.revision,
        created_at: meetings::now(),
        items,
    });
    meeting.recovery = None;
    Ok(meeting)
}

async fn resolve_speakers(
    session: &mut Session<'_>,
    meeting: &Meeting,
) -> Result<Vec<meetings::SpeakerIdentity>, String> {
    let mut known = meeting.speakers.clone();
    for identity in &meeting.speaker_identities {
        if identity.confidence == "strong"
            && known.get(&identity.speaker_id) == Some(&identity.label())
        {
            known.remove(&identity.speaker_id);
        }
    }
    known.retain(|_, name| !name.trim().is_empty());
    if meeting
        .segments
        .iter()
        .all(|segment| known.contains_key(&segment.speaker))
    {
        return Ok(vec![]);
    }
    let instructions = format!("{}\nContext fields clarify adjoining conversation only. Cite evidence exclusively from IDs in the supplied transcript array.", meeting_providers::SPEAKER_INSTRUCTIONS);
    let groups = meeting_providers::transcript_parts(&meeting.segments);
    let total = groups.len();
    let mut candidates = vec![];
    for (index, range) in groups.into_iter().enumerate() {
        let input = json!({"knownSpeakers":known,"transcript":&meeting.segments[range.clone()],
            "precedingContext":&meeting.segments[range.start.saturating_sub(2)..range.start],
            "followingContext":&meeting.segments[range.end..(range.end + 2).min(meeting.segments.len())]});
        candidates.extend(
            session
                .request(
                    &instructions,
                    input,
                    "speakers",
                    &format!("Identifying speakers · part {} of {total}", index + 1),
                    &meeting.segments,
                )
                .await?
                .values,
        );
    }
    if !candidates.is_empty() && (total > 1 || !session.progress.splits.is_empty()) {
        candidates = session
            .consolidate(
                meeting_providers::SPEAKER_INSTRUCTIONS,
                candidates,
                "speakers",
                json!({"knownSpeakers":known}),
                &meeting.segments,
            )
            .await?;
    }
    meeting_providers::speaker_identities(
        &json!({"speakers":candidates}).to_string(),
        &meeting.segments,
    )
}

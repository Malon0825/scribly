//! Speech detection stays local and works even without a transcription account.
pub(crate) struct SilenceWatchdog {
    last_voice: f64,
}
impl SilenceWatchdog {
    pub(crate) fn new() -> Self {
        Self { last_voice: 0.0 }
    }
    pub(crate) fn voice(&mut self, elapsed: f64) {
        self.last_voice = self.last_voice.max(elapsed);
    }
    pub(crate) fn silent_for(&self, elapsed: f64) -> f64 {
        (elapsed - self.last_voice).max(0.0)
    }
    pub(crate) fn expired(&self, elapsed: f64, paused: bool) -> bool {
        !paused && self.silent_for(elapsed) >= 180.0
    }
}
#[cfg(windows)]
pub(crate) struct SpeechDetector {
    vad: webrtc_vad::Vad,
    pending: Vec<i16>,
    voice_frames: usize,
}
#[cfg(windows)]
impl SpeechDetector {
    pub(crate) fn new() -> Self {
        Self {
            vad: webrtc_vad::Vad::new_with_rate_and_mode(
                webrtc_vad::SampleRate::Rate16kHz,
                webrtc_vad::VadMode::Aggressive,
            ),
            pending: vec![],
            voice_frames: 0,
        }
    }
    pub(crate) fn speech(&mut self, bytes: &[u8]) -> bool {
        self.pending.extend(
            bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|sample| i16::from_le_bytes([sample[0], sample[1]])),
        );
        let complete = self.pending.len() / 320 * 320;
        let mut voice = false;
        for frame in self.pending[..complete].as_chunks::<320>().0 {
            // Invalid frames conservatively count as speech rather than stopping
            // an active meeting because the detector could not classify audio.
            if self.vad.is_voice_segment(frame).unwrap_or(true)
                && frame.iter().any(|sample| *sample != 0)
            {
                self.voice_frames = self.voice_frames.saturating_add(1);
            } else {
                self.voice_frames = 0;
            }
            // Require 400 ms of local speech so brief notification chimes do
            // not keep an unattended recording alive. Deepgram speech events
            // and recognized words still reset the timer immediately.
            voice |= self.voice_frames >= 20;
        }
        self.pending.drain(..complete);
        voice
    }
}
pub(crate) fn notify(app: &tauri::AppHandle, id: &str) {
    use tauri::Emitter;
    use tauri_plugin_notification::NotificationExt;
    let message = "No speech detected for 3 minutes. Recording ended and your audio was saved. Meeting notes are being prepared when a transcript is available.";
    let _ = app.emit(
        "meeting-silence",
        serde_json::json!({"id":id,"message":message}),
    );
    let _ = app
        .notification()
        .builder()
        .title("Meeting recording ended")
        .body(message)
        .show();
    #[cfg(windows)]
    {
        use windows::{core::PCWSTR, Win32::Media::Multimedia::mciSendStringW};
        if let Ok(root) = crate::commands::attachment_root(app) {
            let directory = root.join("meeting-credentials");
            let path = directory.join("silence-reminder.mp3");
            if std::fs::create_dir_all(directory).is_ok()
                && crate::files::replace(
                    &path,
                    include_bytes!("../../public/sounds/meeting-silence.mp3"),
                )
                .is_ok()
            {
                // Fixed alias; the only interpolated value is a managed local path.
                let commands = [
                    "close scribly_meeting_reminder".to_string(),
                    format!(
                        "open \"{}\" type mpegvideo alias scribly_meeting_reminder",
                        path.to_string_lossy()
                    ),
                    "play scribly_meeting_reminder".into(),
                ];
                for command in commands {
                    let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
                    unsafe {
                        mciSendStringW(PCWSTR(wide.as_ptr()), None, None);
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn meeting_silence_requires_three_unpaused_minutes_since_last_voice() {
        let mut watch = SilenceWatchdog::new();
        assert!(!watch.expired(179.9, false));
        assert!(watch.expired(180., false));
        watch.voice(175.);
        assert!(!watch.expired(180., false));
        assert!(watch.expired(355., false));
        assert!(!watch.expired(355., true));
    }
    #[cfg(windows)]
    #[test]
    fn meeting_silence_detector_accepts_packet_boundaries_and_silent_audio() {
        let mut detector = SpeechDetector::new();
        for _ in 0..100 {
            assert!(!detector.speech(&[0; 86]));
        }
        assert!(!detector.speech(&[0; 640]));
    }
    #[cfg(windows)]
    #[test]
    fn meeting_silence_ignores_short_tones_and_resets_between_notifications() {
        let mut detector = SpeechDetector::new();
        let tone: Vec<u8> = (0..4800)
            .flat_map(|sample| {
                let value = ((sample as f64 * 440.0 * std::f64::consts::TAU / 16000.0).sin()
                    * 8000.0) as i16;
                value.to_le_bytes()
            })
            .collect();
        for _ in 0..3 {
            for packet in tone.chunks(1600) {
                assert!(!detector.speech(packet));
            }
            for _ in 0..10 {
                assert!(!detector.speech(&[0; 6400]));
            }
        }
    }
}

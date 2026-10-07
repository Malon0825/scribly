//! WASAPI packet boundary: silent buffers may have a null pointer. Never
//! dereference them, and always release a borrowed packet even on size errors.
#[cfg(windows)]
pub(crate) mod native {
    use windows::{
        core::PCWSTR,
        Win32::{
            Media::Audio::*,
            System::Com::{CoCreateInstance, CLSCTX_ALL},
        },
    };
    pub(crate) struct Client {
        audio: IAudioClient,
    }
    pub(crate) struct Capture {
        capture: IAudioCaptureClient,
    }
    pub(crate) fn open(id: &str, system: bool) -> Result<(Client, Capture, usize), String> {
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|e| e.to_string())?;
        let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        let device = if id.is_empty() {
            unsafe {
                enumerator
                    .GetDefaultAudioEndpoint(if system { eRender } else { eCapture }, eConsole)
            }
        } else {
            unsafe { enumerator.GetDevice(PCWSTR(wide.as_ptr())) }
        }
        .map_err(|e| e.to_string())?;
        let audio: IAudioClient =
            unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|e| e.to_string())?;
        let format = wasapi::WaveFormat::new(32, 32, &wasapi::SampleType::Float, 48_000, 2, None);
        let flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
            | if system {
                AUDCLNT_STREAMFLAGS_LOOPBACK
            } else {
                0
            };
        unsafe {
            audio.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                flags,
                1_000_000,
                0,
                format.as_waveformatex_ref(),
                None,
            )
        }
        .map_err(|e| e.to_string())?;
        let frames = unsafe { audio.GetBufferSize() }.map_err(|e| e.to_string())? as usize;
        let capture = unsafe { audio.GetService() }.map_err(|e| e.to_string())?;
        Ok((Client { audio }, Capture { capture }, frames * 8))
    }
    impl Client {
        pub(crate) fn start_stream(&self) -> Result<(), String> {
            unsafe { self.audio.Start() }.map_err(|e| e.to_string())
        }
        pub(crate) fn stop_stream(&self) -> Result<(), String> {
            unsafe { self.audio.Stop() }.map_err(|e| e.to_string())
        }
    }
    impl Drop for Client {
        fn drop(&mut self) {
            let _ = self.stop_stream();
        }
    }
    impl Capture {
        pub(crate) fn get_next_packet_size(&self) -> Result<Option<u32>, String> {
            unsafe { self.capture.GetNextPacketSize() }
                .map(Some)
                .map_err(|e| e.to_string())
        }
        pub(crate) fn read_from_device(
            &self,
            buffer: &mut [u8],
        ) -> Result<(u32, wasapi::BufferInfo), String> {
            let mut pointer = std::ptr::null_mut();
            let mut frames = 0;
            let mut flags = 0;
            let mut position = 0;
            let mut timestamp = 0;
            unsafe {
                self.capture.GetBuffer(
                    &mut pointer,
                    &mut frames,
                    &mut flags,
                    Some(&mut position),
                    Some(&mut timestamp),
                )
            }
            .map_err(|e| e.to_string())?;
            let info = wasapi::BufferInfo::new(flags, position, timestamp);
            let result = (|| {
                let bytes = frames as usize * 8;
                if bytes > buffer.len() {
                    return Err("Device packet exceeds its negotiated buffer size".into());
                }
                if info.flags.silent {
                    buffer[..bytes].fill(0);
                } else if bytes > 0 {
                    if pointer.is_null() {
                        return Err("Device returned an invalid audio buffer".into());
                    }
                    // WASAPI owns exactly `frames` negotiated stereo float frames until ReleaseBuffer.
                    buffer[..bytes]
                        .copy_from_slice(unsafe { std::slice::from_raw_parts(pointer, bytes) });
                }
                Ok(())
            })();
            unsafe { self.capture.ReleaseBuffer(frames) }.map_err(|e| e.to_string())?;
            result.map(|()| (frames, info))
        }
    }
}

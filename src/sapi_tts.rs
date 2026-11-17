use anyhow::Result;
use base64::prelude::*;
use crate::types::{VoiceCatalogEntry, WordBoundary};
use crate::azure_tts::SpeechSynthesisResult;

/// Constructs a valid 44-byte RIFF/WAVE header for standard 16-bit PCM audio.
pub fn prepend_riff_wav_header(
    pcm_data: &[u8],
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = channels * (bits_per_sample / 8);
    let data_len = pcm_data.len() as u32;
    let riff_chunk_size = 36u32.saturating_add(data_len);

    let mut wav = Vec::with_capacity(44 + pcm_data.len());
    // "RIFF"
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&riff_chunk_size.to_le_bytes());
    // "WAVE"
    wav.extend_from_slice(b"WAVE");
    // "fmt " chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size for PCM
    wav.extend_from_slice(&1u16.to_le_bytes());  // AudioFormat: 1 = PCM
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());
    // "data" chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    // PCM Payload
    wav.extend_from_slice(pcm_data);

    wav
}

/// Estimates approximate word boundaries based on text token lengths and total audio duration.
pub fn estimate_word_boundaries(text: &str, duration_secs: f64) -> Vec<WordBoundary> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() || duration_secs <= 0.0 {
        return Vec::new();
    }

    let total_chars: usize = words.iter().map(|w| w.chars().count()).sum();
    if total_chars == 0 {
        return Vec::new();
    }

    let mut boundaries = Vec::with_capacity(words.len());
    let mut current_offset = 0.0;

    for word in words.iter() {
        let count = word.chars().count();
        let fraction = count as f64 / total_chars as f64;
        let word_dur = fraction * duration_secs;

        boundaries.push(WordBoundary {
            text: word.to_string(),
            audio_offset: (current_offset * 1000.0f64).round() / 1000.0f64,
            duration: (word_dur * 1000.0f64).round() / 1000.0f64,
            text_offset: None,
        });

        current_offset += word_dur;
    }

    boundaries
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use anyhow::{bail, Context, Result};
    use windows::{
        core::*,
        Win32::Foundation::RPC_E_CHANGED_MODE,
        Win32::Media::Audio::WAVEFORMATEX,
        Win32::Media::Speech::*,
        Win32::System::Com::*,
    };

    struct ComGuard {
        should_uninit: bool,
    }
    impl ComGuard {
        fn new() -> Result<Self> {
            unsafe {
                // Initialize COM on the current blocking thread
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                if hr.is_ok() {
                    Ok(Self { should_uninit: true })
                } else if hr == RPC_E_CHANGED_MODE {
                    Ok(Self { should_uninit: false })
                } else {
                    hr.ok().context("Failed to initialize COM on thread")?;
                    Ok(Self { should_uninit: false })
                }
            }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninit {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    pub fn get_installed_voices_sync() -> Result<Vec<VoiceCatalogEntry>> {
        let _guard = ComGuard::new()?;

        unsafe {
            let cat: ISpObjectTokenCategory = CoCreateInstance(
                &SpObjectTokenCategory,
                None,
                CLSCTX_ALL,
            ).context("Failed to create SpObjectTokenCategory")?;

            cat.SetId(SPCAT_VOICES, false)?;

            let tokens: IEnumSpObjectTokens = cat.EnumTokens(None, None)?;
            let mut count = 0u32;
            tokens.GetCount(&mut count)?;

            let mut catalog = Vec::new();

            for i in 0..count {
                let token: ISpObjectToken = tokens.Item(i)?;

                // ISpObjectToken dereferences to ISpDataKey; reading the default value retrieves the friendly name
                let display_name = if let Ok(desc_ptr) = token.GetStringValue(PCWSTR::null()) {
                    if !desc_ptr.is_null() {
                        let desc = desc_ptr.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(desc_ptr.0 as _));
                        desc
                    } else {
                        format!("Voice {}", i)
                    }
                } else {
                    format!("Voice {}", i)
                };

                // GetId returns Result<PWSTR> directly in windows-rs
                let short_name = if let Ok(token_id_ptr) = token.GetId() {
                    if !token_id_ptr.is_null() {
                        let id_str = token_id_ptr.to_string().unwrap_or_else(|_| display_name.clone());
                        CoTaskMemFree(Some(token_id_ptr.0 as _));
                        id_str
                    } else {
                        display_name.clone()
                    }
                } else {
                    display_name.clone()
                };

                catalog.push(VoiceCatalogEntry {
                    short_name,
                    display_name: display_name.clone(),
                    local_name: Some(display_name),
                    locale: "en-US".to_string(), // SAPI voice default or fallback
                    locale_name: Some("Windows SAPI".to_string()),
                    gender: None,
                    voice_type: Some("Standard".to_string()),
                    status: Some("Available".to_string()),
                    style_list: None,
                    secondary_locale_list: None,
                });
            }

            Ok(catalog)
        }
    }

    pub fn synthesize_sync(
        text: &str,
        voice_desc: &str,
        rate: i32,
        volume: u32,
    ) -> Result<SpeechSynthesisResult> {
        let _guard = ComGuard::new()?;

        unsafe {
            let voice: ISpVoice = CoCreateInstance(&SpVoice, None, CLSCTX_ALL)
                .context("Failed to create SpVoice COM instance")?;

            // Set voice if specific voice requested
            if !voice_desc.is_empty() && voice_desc != "default" {
                let cat_res: windows::core::Result<ISpObjectTokenCategory> =
                    CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL);
                if let Ok(cat) = cat_res {
                    if cat.SetId(SPCAT_VOICES, false).is_ok() {
                        if let Ok(tokens) = cat.EnumTokens(None, None) {
                            let mut count = 0u32;
                            if tokens.GetCount(&mut count).is_ok() {
                                for i in 0..count {
                                    if let Ok(token) = tokens.Item(i) {
                                        let matched = if let Ok(desc_ptr) = token.GetStringValue(PCWSTR::null()) {
                                            if !desc_ptr.is_null() {
                                                let desc = desc_ptr.to_string().unwrap_or_default();
                                                CoTaskMemFree(Some(desc_ptr.0 as _));
                                                desc.eq_ignore_ascii_case(voice_desc)
                                            } else {
                                                false
                                            }
                                        } else {
                                            false
                                        };

                                        let id_matched = if let Ok(id_ptr) = token.GetId() {
                                            if !id_ptr.is_null() {
                                                let id_str = id_ptr.to_string().unwrap_or_default();
                                                CoTaskMemFree(Some(id_ptr.0 as _));
                                                id_str.eq_ignore_ascii_case(voice_desc)
                                            } else {
                                                false
                                            }
                                        } else {
                                            false
                                        };

                                        if matched || id_matched {
                                            let _ = voice.SetVoice(&token);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Set rate (-10 to 10)
            let _ = voice.SetRate(rate.clamp(-10, 10));

            // Set volume (0 to 100)
            let _ = voice.SetVolume(volume.min(100) as u16);

            // Create in-memory stream for audio
            let mem_stream: ISpStream = CoCreateInstance(&SpMemoryStream, None, CLSCTX_ALL)
                .context("Failed to create SpMemoryStream COM instance")?;

            // Bind voice output directly to the memory stream.
            // true = allow voice to adapt stream format automatically
            voice.SetOutput(&mem_stream, true)
                .context("Failed to set ISpVoice output stream")?;

            // Speak text (SPF_IS_NOT_XML to avoid parsing issues with plain YouTube chat)
            let wide_text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let _ = voice.Speak(
                PCWSTR(wide_text.as_ptr()),
                SPF_IS_NOT_XML.0 as u32,
                None,
            )?;

            // Read raw PCM bytes from the IStream interface of the memory stream
            let istream: IStream = mem_stream.cast()?;
            
            // Seek to beginning
            let mut new_pos = 0u64;
            let _ = istream.Seek(0, STREAM_SEEK_SET, Some(&mut new_pos));

            let mut pcm_bytes = Vec::new();
            let mut buffer = [0u8; 4096];

            loop {
                let mut bytes_read = 0u32;
                let hr = istream.Read(
                    buffer.as_mut_ptr() as *mut _,
                    buffer.len() as u32,
                    Some(&mut bytes_read),
                );

                if hr.is_err() || bytes_read == 0 {
                    break;
                }
                pcm_bytes.extend_from_slice(&buffer[..bytes_read as usize]);
            }

            if pcm_bytes.is_empty() {
                bail!("SAPI produced empty PCM buffer");
            }

            // Query negotiated stream format or fallback to 22050Hz 16-bit mono
            let format_guid = GUID::zeroed();
            let (sample_rate, channels, bits_per_sample) = if let Ok(fmt_ptr) = mem_stream.GetFormat(&format_guid) {
                if !fmt_ptr.is_null() {
                    let wave_fmt: WAVEFORMATEX = *fmt_ptr;
                    CoTaskMemFree(Some(fmt_ptr as _));
                    (
                        if wave_fmt.nSamplesPerSec > 0 { wave_fmt.nSamplesPerSec } else { 22050 },
                        if wave_fmt.nChannels > 0 { wave_fmt.nChannels } else { 1 },
                        if wave_fmt.wBitsPerSample > 0 { wave_fmt.wBitsPerSample } else { 16 },
                    )
                } else {
                    (22050u32, 1u16, 16u16)
                }
            } else {
                (22050u32, 1u16, 16u16)
            };

            let wav_bytes = prepend_riff_wav_header(&pcm_bytes, sample_rate, channels, bits_per_sample);
            let encoded = BASE64_STANDARD.encode(&wav_bytes);
            let audio_data_uri = format!("data:audio/wav;base64,{}", encoded);

            let duration_secs = pcm_bytes.len() as f64 / (sample_rate as f64 * channels as f64 * (bits_per_sample as f64 / 8.0));
            let word_boundaries = estimate_word_boundaries(text, duration_secs);
            let size_kb = wav_bytes.len() as f64 / 1024.0;

            Ok(SpeechSynthesisResult {
                audio_data_uri,
                word_boundaries,
                size_kb,
            })
        }
    }
}

pub async fn get_installed_voices() -> Result<Vec<VoiceCatalogEntry>> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(windows_impl::get_installed_voices_sync).await?
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![
            VoiceCatalogEntry {
                short_name: "default".to_string(),
                display_name: "Default Windows SAPI Voice (Simulation)".to_string(),
                local_name: Some("Default Windows Voice".to_string()),
                locale: "en-US".to_string(),
                locale_name: Some("English (United States)".to_string()),
                gender: Some("Neutral".to_string()),
                voice_type: Some("Standard".to_string()),
                status: Some("Available".to_string()),
                style_list: None,
                secondary_locale_list: None,
            }
        ])
    }
}

pub async fn synthesize(
    text: &str,
    voice_desc: &str,
    rate: i32,
    volume: u32,
) -> Result<SpeechSynthesisResult> {
    let text = text.to_string();
    let voice_desc = voice_desc.to_string();

    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(move || {
            windows_impl::synthesize_sync(&text, &voice_desc, rate, volume)
        })
        .await?
    }
    #[cfg(not(target_os = "windows"))]
    {
        // On non-Windows platforms (e.g. Linux development / CI), generate a short valid silent PCM WAV
        // so integration tests and headless pipelines can run without a Windows machine.
        let sample_rate = 22050u32;
        let channels = 1u16;
        let bits_per_sample = 16u16;
        let num_samples = (sample_rate as f64 * 0.5) as usize; // 0.5 sec silent audio
        let pcm_bytes = vec![0u8; num_samples * 2];

        let wav_bytes = prepend_riff_wav_header(&pcm_bytes, sample_rate, channels, bits_per_sample);
        let encoded = BASE64_STANDARD.encode(&wav_bytes);
        let audio_data_uri = format!("data:audio/wav;base64,{}", encoded);
        let duration_secs = 0.5;
        let word_boundaries = estimate_word_boundaries(&text, duration_secs);
        let size_kb = wav_bytes.len() as f64 / 1024.0;

        let _ = (voice_desc, rate, volume);

        Ok(SpeechSynthesisResult {
            audio_data_uri,
            word_boundaries,
            size_kb,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_riff_wav_header_length_and_structure() {
        let pcm = vec![0u8; 100];
        let wav = prepend_riff_wav_header(&pcm, 22050, 1, 16);
        assert_eq!(wav.len(), 44 + 100);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");

        // Subchunk2Size should be 100
        let data_size = u32::from_le_bytes(wav[40..44].try_into().unwrap());
        assert_eq!(data_size, 100);

        // ChunkSize should be 36 + 100 = 136
        let chunk_size = u32::from_le_bytes(wav[4..8].try_into().unwrap());
        assert_eq!(chunk_size, 136);
    }

    #[test]
    fn test_estimate_word_boundaries() {
        let text = "Hello world from SAPI";
        let boundaries = estimate_word_boundaries(text, 2.0);
        assert_eq!(boundaries.len(), 4);
        assert_eq!(boundaries[0].text, "Hello");
        assert_eq!(boundaries[3].text, "SAPI");
        assert!(boundaries[0].text_offset.is_none());
        assert!(boundaries.last().unwrap().audio_offset < 2.0);
    }

    #[tokio::test]
    async fn test_synthesize_fallback_produces_valid_wav() {
        let result = synthesize("Testing 1 2 3", "default", 0, 100).await.unwrap();
        assert!(result.audio_data_uri.starts_with("data:audio/wav;base64,"));
        assert!(!result.word_boundaries.is_empty());
        assert!(result.size_kb > 0.0);
    }

    #[tokio::test]
    async fn test_get_installed_voices_returns_entries() {
        let voices = get_installed_voices().await.unwrap();
        assert!(!voices.is_empty());
        assert_eq!(voices[0].short_name, "default");
    }
}

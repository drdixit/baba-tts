use crate::types::WordBoundary;
use anyhow::{bail, Context, Result};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{debug, info};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct AzureMetadataWrapper {
    #[serde(rename = "Metadata")]
    metadata: Option<Vec<AzureMetadataItem>>,
}

#[derive(Debug, Deserialize)]
struct AzureMetadataItem {
    #[serde(rename = "Type")]
    item_type: String,
    #[serde(rename = "Data")]
    data: Option<AzureWordBoundaryData>,
}

#[derive(Debug, Deserialize)]
struct AzureWordBoundaryData {
    #[serde(rename = "Offset")]
    offset_ticks: u64,
    #[serde(rename = "Duration")]
    duration_ticks: u64,
    text: Option<AzureWordText>,
}

#[derive(Debug, Deserialize)]
struct AzureWordText {
    #[serde(rename = "Text")]
    text: String,
}

#[derive(Debug, Clone)]
pub struct SpeechSynthesisResult {
    pub audio_data_uri: String,
    pub audio_bytes: Vec<u8>,
    pub word_boundaries: Vec<WordBoundary>,
    #[allow(dead_code)]
    pub size_kb: f64,
}

pub fn is_valid_azure_region(region: &str) -> bool {
    let normalized = region.trim().to_ascii_lowercase();
    (2..=32).contains(&normalized.len())
        && normalized.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && normalized.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && normalized.chars().last().is_some_and(|c| c.is_ascii_alphanumeric())
}

pub struct AzureTtsClient {
    key: String,
    region: String,
}

impl AzureTtsClient {
    pub fn new(key: String, region: String) -> Self {
        Self { key, region }
    }

    pub async fn synthesize(&self, text: &str, voice_name: &str) -> Result<SpeechSynthesisResult> {
        if self.key.is_empty() || self.region.is_empty() {
            bail!("Azure speech key or region is not configured");
        }

        if !is_valid_azure_region(&self.region) {
            bail!("Invalid Azure speech region format: '{}'", self.region);
        }

        let url = format!(
            "wss://{}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key={}",
            self.region, self.key
        );

        let connect_fut = connect_async(&url);
        let (mut ws_stream, _) = timeout(Duration::from_secs(8), connect_fut)
            .await
            .context("Connection to Azure TTS WebSocket timed out")?
            .context("Failed to connect to Azure TTS WebSocket")?;

        let request_id = Uuid::new_v4().simple().to_string().to_uppercase();
        let timestamp = get_iso_timestamp();

        // 1. Send speech.config
        let config_json = serde_json::json!({
            "context": {
                "system": {
                    "name": "SpeechSDK",
                    "version": "1.30.0",
                    "build": "JavaScript",
                    "lang": "JavaScript"
                }
            }
        });

        let config_message = format!(
            "Path: speech.config\r\nX-RequestId: {}\r\nX-Timestamp: {}\r\nContent-Type: application/json\r\n\r\n{}",
            request_id, timestamp, config_json
        );
        ws_stream.send(Message::Text(config_message.into())).await?;

        // 2. Send synthesis.context
        let synth_context = serde_json::json!({
            "synthesis": {
                "audio": {
                    "metadataOptions": {
                        "sentenceBoundaryEnabled": "false",
                        "wordBoundaryEnabled": "true"
                    },
                    "outputFormat": "audio-48khz-96kbitrate-mono-mp3"
                }
            }
        });
        let synth_message = format!(
            "Path: synthesis.context\r\nX-RequestId: {}\r\nX-Timestamp: {}\r\nContent-Type: application/json\r\n\r\n{}",
            request_id, timestamp, synth_context
        );
        ws_stream.send(Message::Text(synth_message.into())).await?;

        // 3. Build SSML payload and send
        let ssml = build_ssml(text, voice_name);
        let ssml_message = format!(
            "Path: ssml\r\nX-RequestId: {}\r\nX-Timestamp: {}\r\nContent-Type: application/ssml+xml\r\n\r\n{}",
            request_id, timestamp, ssml
        );
        ws_stream.send(Message::Text(ssml_message.into())).await?;

        // 4. Collect response frames until turn.end
        let mut audio_bytes = Vec::new();
        let mut word_boundaries = Vec::new();

        let stream_timeout = Duration::from_secs(15);
        let receive_loop = async {
            while let Some(msg_result) = ws_stream.next().await {
                let msg = msg_result?;
                match msg {
                    Message::Binary(bin) => {
                        debug!("Azure binary frame: len {}", bin.len());
                        if bin.len() >= 2 {
                            let header_len = u16::from_be_bytes([bin[0], bin[1]]) as usize;
                            let audio_start = 2 + header_len;
                            if bin.len() > audio_start {
                                audio_bytes.extend_from_slice(&bin[audio_start..]);
                            }
                        }
                    }
                    Message::Text(txt) => {
                        debug!("Azure text frame: {}", txt);
                        if txt.contains("Path:turn.end") {
                            debug!("Azure TTS turn.end received");
                            break;
                        }

                        if txt.contains("Path:audio.metadata") {
                            if let Some((_, json_body)) = txt.split_once("\r\n\r\n") {
                                if let Ok(wrapper) = serde_json::from_str::<AzureMetadataWrapper>(json_body) {
                                    if let Some(items) = wrapper.metadata {
                                        for item in items {
                                            if item.item_type == "WordBoundary" {
                                                if let Some(data) = item.data {
                                                    let word_text = data
                                                        .text
                                                        .map(|t| t.text)
                                                        .unwrap_or_default();
                                                    word_boundaries.push(WordBoundary {
                                                        text: word_text,
                                                        // 10,000,000 ticks per second = 10,000 ticks per millisecond
                                                        audio_offset: data.offset_ticks as f64 / 10_000_000.0,
                                                        duration: data.duration_ticks as f64 / 10_000_000.0,
                                                        text_offset: None,
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Message::Close(_) => {
                        break;
                    }
                    _ => {}
                }
            }
            Ok::<(), anyhow::Error>(())
        };

        timeout(stream_timeout, receive_loop)
            .await
            .context("Azure TTS stream timed out")??;

        if audio_bytes.is_empty() {
            bail!("Azure TTS returned empty audio stream");
        }

        let size_kb = audio_bytes.len() as f64 / 1024.0;
        let base64_audio = base64::engine::general_purpose::STANDARD.encode(&audio_bytes);
        let audio_data_uri = format!("data:audio/mpeg;base64,{}", base64_audio);

        info!(
            "Synthesized {} words, size: {:.2} KB",
            word_boundaries.len(),
            size_kb
        );

        Ok(SpeechSynthesisResult {
            audio_data_uri,
            audio_bytes,
            word_boundaries,
            size_kb,
        })
    }
}

pub fn get_iso_timestamp() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now();
    let since_epoch = now.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    let total_secs = since_epoch.as_secs();
    let millis = since_epoch.subsec_millis();

    let days = total_secs / 86400;
    let rem_secs = total_secs % 86400;
    let hours = rem_secs / 3600;
    let mins = (rem_secs % 3600) / 60;
    let secs = rem_secs % 60;

    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, m, d, hours, mins, secs, millis)
}

pub fn build_ssml(text: &str, voice_name: &str) -> String {
    let escaped_text = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");

    format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>\
           <voice name='{}'>\
             <prosody rate='0%' pitch='0%'>{}</prosody>\
           </voice>\
         </speak>",
        voice_name, escaped_text
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_ssml_escaping() {
        let text = "Tom & Jerry <cartoon> \"great\" 'show'";
        let ssml = build_ssml(text, "hi-IN-MadhurNeural");

        assert!(ssml.contains("&amp;"));
        assert!(ssml.contains("&lt;cartoon&gt;"));
        assert!(ssml.contains("&quot;great&quot;"));
        assert!(ssml.contains("&apos;show&apos;"));
        assert!(ssml.contains("<voice name='hi-IN-MadhurNeural'>"));
    }

    #[tokio::test]
    async fn test_live_azure_synthesis() {
        dotenvy::dotenv().ok();
        let key = std::env::var("AZURE_SPEECH_KEY").unwrap_or_default();
        let region = std::env::var("AZURE_SPEECH_REGION").unwrap_or_default();
        if key.is_empty() || region.is_empty() {
            println!("Skipping live azure test: missing credentials");
            return;
        }

        let client = AzureTtsClient::new(key, region);
        match client.synthesize("Hello world", "hi-IN-MadhurNeural").await {
            Ok(res) => {
                println!("Synthesized successfully! Audio len: {}, Word boundaries: {}", res.audio_data_uri.len(), res.word_boundaries.len());
                assert!(!res.audio_data_uri.is_empty());
            }
            Err(e) => {
                println!("Synthesis failed with error: {:?}", e);
            }
        }
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordBoundary {
    pub text: String,
    pub audio_offset: f64, // In milliseconds
    pub duration: f64,     // In milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub message_id: String,
    pub author_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_profile_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_color: Option<String>,
    pub text: String,
    pub status: MessageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_boundaries: Option<Vec<WordBoundary>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Default,
    Queued,
    Processing,
    Skipped,
    Speaking,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BannedUser {
    pub author_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_image_url: Option<String>,
    pub banned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub azure_speech_key: String,
    pub azure_speech_region: String,
    pub azure_speech_voice: String,
    pub youtube_channel_id: String,
    pub youtube_live_id: Option<String>,
    pub enable_youtube: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            azure_speech_key: String::new(),
            azure_speech_region: "centralindia".to_string(),
            azure_speech_voice: "hi-IN-MadhurNeural".to_string(),
            youtube_channel_id: "UCiz4lqlVpaB4PpK-1aecMgQ".to_string(),
            youtube_live_id: None,
            enable_youtube: true,
        }
    }
}

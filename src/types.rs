use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};

pub const DEFAULT_SEEN_CACHE_CAPACITY: usize = 4096;

#[derive(Debug)]
pub struct SeenMessageCache {
    set: HashSet<String>,
    queue: VecDeque<String>,
    capacity: usize,
}

impl SeenMessageCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            set: HashSet::with_capacity(capacity),
            queue: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// Inserts a message ID. Returns true if the message was NOT already present (new message).
    pub fn insert(&mut self, id: String) -> bool {
        if id.is_empty() {
            return true;
        }
        if self.set.contains(&id) {
            return false;
        }
        if self.queue.len() >= self.capacity {
            if let Some(oldest) = self.queue.pop_front() {
                self.set.remove(&oldest);
            }
        }
        self.set.insert(id.clone());
        self.queue.push_back(id);
        true
    }

    #[allow(dead_code)]
    pub fn contains(&self, id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        self.set.contains(id)
    }

    pub fn clear(&mut self) {
        self.set.clear();
        self.queue.clear();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordBoundary {
    pub text: String,
    pub audio_offset: f64, // Seconds from the start of the audio.
    pub duration: f64,     // Seconds.
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_superchat: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
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
    #[serde(default = "default_tts_provider")]
    pub tts_provider: String,
    pub azure_speech_key: String,
    pub azure_speech_region: String,
    pub azure_speech_voice: String,
    #[serde(default)]
    pub azure_speech_voices: Vec<String>,
    #[serde(default)]
    pub azure_speech_voice_rotation: bool,
    #[serde(default = "default_sapi_voice")]
    pub sapi_voice: String,
    #[serde(default)]
    pub sapi_voices: Vec<String>,
    #[serde(default)]
    pub sapi_voice_rotation: bool,
    #[serde(default)]
    pub sapi_rate: i32,
    #[serde(default = "default_sapi_volume")]
    pub sapi_volume: u32,
    #[serde(default = "default_master_volume")]
    pub master_volume: u32,
    pub youtube_channel_id: String,
    pub youtube_live_id: Option<String>,
    pub enable_youtube: bool,
    #[serde(default = "default_youtube_chat_mode")]
    pub youtube_chat_mode: String,
    #[serde(default)]
    pub enable_facebook: bool,
    #[serde(default)]
    pub facebook_access_token: String,
    #[serde(default = "default_facebook_target_id")]
    pub facebook_target_id: String,
    #[serde(default)]
    pub facebook_live_id: Option<String>,
    #[serde(default)]
    pub enable_instagram: bool,
    #[serde(default)]
    pub instagram_access_token: String,
    #[serde(default)]
    pub instagram_user_id: String,
    #[serde(default)]
    pub instagram_live_id: Option<String>,
}

fn default_tts_provider() -> String {
    "azure".to_string()
}

fn default_sapi_voice() -> String {
    "default".to_string()
}

fn default_sapi_volume() -> u32 {
    100
}

fn default_master_volume() -> u32 {
    100
}

fn default_youtube_chat_mode() -> String {
    "live".to_string()
}

fn default_facebook_target_id() -> String {
    "me".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tts_provider: "azure".to_string(),
            azure_speech_key: String::new(),
            azure_speech_region: "centralindia".to_string(),
            azure_speech_voice: "hi-IN-MadhurNeural".to_string(),
            azure_speech_voices: vec!["hi-IN-MadhurNeural".to_string()],
            azure_speech_voice_rotation: false,
            sapi_voice: "default".to_string(),
            sapi_voices: vec!["default".to_string()],
            sapi_voice_rotation: false,
            sapi_rate: 0,
            sapi_volume: 100,
            master_volume: 100,
            youtube_channel_id: "UCiz4lqlVpaB4PpK-1aecMgQ".to_string(),
            youtube_live_id: None,
            enable_youtube: true,
            youtube_chat_mode: "live".to_string(),
            enable_facebook: false,
            facebook_access_token: String::new(),
            facebook_target_id: "me".to_string(),
            facebook_live_id: None,
            enable_instagram: false,
            instagram_access_token: String::new(),
            instagram_user_id: String::new(),
            instagram_live_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCatalogEntry {
    pub short_name: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_name: Option<String>,
    pub locale: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_list: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_locale_list: Option<Vec<String>>,
}


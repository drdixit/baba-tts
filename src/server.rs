use crate::colors::get_deterministic_color;
use crate::db::Db;
use crate::tts_queue::{TtsHandle, WsBroadcastMessage};
use crate::types::{AppSettings, ChatMessage, MessageStatus, VoiceCatalogEntry};
use crate::ws::handle_websocket;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::sync::broadcast;

#[derive(RustEmbed)]
#[folder = "frontend/dist/"]
struct Asset;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub tts_handle: TtsHandle,
    pub broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    pub shutdown_tx: tokio::sync::mpsc::Sender<()>,
    pub port: u16,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/info", get(get_info_handler))
        .route("/api/last-banned", get(get_last_banned_handler))
        .route("/api/restart", post(restart_handler))
        .route("/api/skip-current", post(skip_current_handler))
        .route("/api/skip-ban-current", post(skip_ban_current_handler))
        .route("/api/baba-say", post(baba_say_handler))
        .route("/api/speak-as-banned", post(speak_as_banned_post_handler))
        .route("/api/settings", get(get_settings_handler).post(save_settings_handler))
        .route("/api/voices", get(get_voices_handler))
        .route("/api/meta/test-facebook", post(test_facebook_handler))
        .route("/api/meta/test-instagram", post(test_instagram_handler))
        .route("/api/volume", get(get_volume_handler).post(set_volume_handler))
        .route("/api/volume/toggle-mute", post(toggle_mute_handler))
        .route("/api/pause-hotkeys", post(pause_hotkeys_handler))
        .route("/api/resume-hotkeys", post(resume_hotkeys_handler))
        .route_layer(middleware::from_fn(local_origin_guard))
        .fallback(static_handler)
        .with_state(state)
}

async fn local_origin_guard(request: Request, next: Next) -> Response {
    if !is_local_origin(request.headers()) {
        return (StatusCode::FORBIDDEN, "Requests from non-local origins are not allowed").into_response();
    }
    next.run(request).await
}

fn is_local_origin(headers: &HeaderMap) -> bool {
    if headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        == Some("cross-site")
    {
        return false;
    }

    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    if uri.scheme_str() != Some("http")
        || !uri.port_u16().is_some_and(|port| {
            (7060..=7100).contains(&port) || matches!(port, 3000 | 5173)
        })
    {
        return false;
    }

    let Some(host) = uri.host() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

async fn get_info_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let banned_count = state.db.get_banned_users().map(|u| u.len()).unwrap_or(0);
    Json(serde_json::json!({
        "port": state.port,
        "bannedCount": banned_count,
        "appUrl": format!("http://127.0.0.1:{}/", state.port),
        "obsChatUrl": format!("http://127.0.0.1:{}/chat", state.port),
        "obsDockUrl": format!("http://127.0.0.1:{}/", state.port),
    }))
}

async fn get_last_banned_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.get_last_banned_user() {
        Ok(user) => Json(serde_json::json!({ "user": user })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn restart_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    if !addr.ip().is_loopback() {
        tracing::warn!("Forbidden remote restart attempt from {}", addr);
        return (StatusCode::FORBIDDEN, "Restart is only permitted from localhost").into_response();
    }
    tracing::info!("Server restart requested via /api/restart from {}", addr);
    let shutdown_tx = state.shutdown_tx.clone();
    tokio::spawn(async move {
        // Sleep 300ms so the HTTP 200 response can be completely transmitted to the browser
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        crate::tray::restart_process();
        let _ = shutdown_tx.try_send(());
    });
    Json(serde_json::json!({
        "success": true,
        "message": "Server restart initiated..."
    })).into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        handle_websocket(socket, state.db, state.tts_handle, state.broadcast_tx)
    })
}

async fn skip_current_handler(State(state): State<AppState>) -> impl IntoResponse {
    state.tts_handle.skip_current().await;
    "Skipped"
}

async fn skip_ban_current_handler(State(state): State<AppState>) -> Response {
    let Some(current) = state.tts_handle.get_current_processing().await else {
        return "No active message to ban".into_response();
    };

    let author_name = current.author_name.clone();
    let message_id = current.message_id.clone();
    let author_id = current.author_id.filter(|id| !id.trim().is_empty());
    let mut ban_saved = false;

    if let Some(id) = author_id.as_deref() {
        match state
            .db
            .ban_user(id, &author_name, current.author_profile_image_url.as_deref())
        {
            Ok(()) => {
                ban_saved = true;
                if let Ok(banned) = state.db.get_banned_users() {
                    let _ = state.broadcast_tx.send(WsBroadcastMessage::BannedUsers(banned));
                }
            }
            Err(error) => tracing::warn!("Failed to ban current speaker {}: {}", author_name, error),
        }
    }

    let author_id_to_remove = if ban_saved { author_id.clone() } else { None };
    state
        .tts_handle
        .remove_user_and_skip_message(author_id_to_remove, message_id)
        .await;

    if ban_saved {
        format!("Banned and skipped: {author_name}").into_response()
    } else if author_id.is_some() {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Skipped the current message, but saving the ban failed",
        )
            .into_response()
    } else {
        format!("Skipped {author_name}; no author ID was available to save a ban").into_response()
    }
}

#[derive(Debug, Deserialize, Default)]
struct TextPayload {
    text: Option<String>,
}

async fn baba_say_handler(
    State(state): State<AppState>,
    Json(payload): Json<TextPayload>,
) -> Response {
    let Some(text) = payload.text else {
        return (StatusCode::BAD_REQUEST, "Missing text").into_response();
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return (StatusCode::BAD_REQUEST, "Empty text").into_response();
    }

    let msg = ChatMessage {
        message_id: format!("baba-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()),
        author_name: "BABA".to_string(),
        author_id: Some("baba-streamer".to_string()),
        author_profile_image_url: Some("/baba-800x800.jpg".to_string()),
        author_color: Some(get_deterministic_color("BABA").to_string()),
        text: trimmed.to_string(),
        status: MessageStatus::Queued,
        theme: Some("subtitle-karaoke".to_string()),
        word_boundaries: None,
        is_superchat: None,
        platform: Some("system".to_string()),
    };

    let _ = state.broadcast_tx.send(WsBroadcastMessage::Messages(vec![msg.clone()]));
    state.tts_handle.enqueue_priority(msg).await;

    Json(serde_json::json!({ "success": true, "text": trimmed })).into_response()
}

async fn speak_as_banned_post_handler(
    State(state): State<AppState>,
    body: axum::body::Bytes,
) -> Response {
    let text = if !body.is_empty() {
        serde_json::from_slice::<TextPayload>(&body).ok().and_then(|p| p.text)
    } else {
        None
    };
    execute_speak_as_banned(&state, text).await
}

async fn execute_speak_as_banned(state: &AppState, custom_text: Option<String>) -> Response {
    let Ok(Some(last_banned)) = state.db.get_last_banned_user() else {
        return (StatusCode::NOT_FOUND, "No banned users found").into_response();
    };

    let apologies = [
        "Bhai mujhe maaf kardo, ab main kabhi spam nahi karunga!",
        "Galti ho gayi streamer bhai, please mujhe unban kardo!",
        "Main to bas troll kar raha tha bhai, sach mein ban kar diya?!",
        "Alvida dosto, main ban ho gaya!",
        "Streamer bhai ek aakhri chance dedo please, ab sudhar gaya hu!",
    ];

    let text = custom_text
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| {
            use std::time::{SystemTime, UNIX_EPOCH};
            let seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as usize)
                .unwrap_or(0);
            apologies[seed % apologies.len()].to_string()
        });

    let msg = ChatMessage {
        message_id: format!("impersonate-{}", uuid::Uuid::new_v4()),
        author_name: last_banned.display_name.clone(),
        author_id: Some(last_banned.author_id),
        author_profile_image_url: last_banned.profile_image_url.or_else(|| {
            Some(format!(
                "https://api.dicebear.com/7.x/avataaars/svg?seed={}",
                last_banned.display_name
            ))
        }),
        author_color: Some(get_deterministic_color(&last_banned.display_name).to_string()),
        text: text.clone(),
        status: MessageStatus::Queued,
        theme: Some("subtitle-words".to_string()),
        word_boundaries: None,
        is_superchat: None,
        platform: Some("system".to_string()),
    };

    let _ = state.broadcast_tx.send(WsBroadcastMessage::Messages(vec![msg.clone()]));
    state.tts_handle.enqueue_priority(msg).await;

    Json(serde_json::json!({
        "success": true,
        "user": last_banned.display_name,
        "message": text
    }))
    .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResponse {
    tts_provider: String,
    azure_speech_key_configured: bool,
    azure_speech_region: String,
    azure_speech_voice: String,
    azure_speech_voices: Vec<String>,
    azure_speech_voice_rotation: bool,
    sapi_voice: String,
    sapi_voices: Vec<String>,
    sapi_voice_rotation: bool,
    sapi_rate: i32,
    sapi_volume: u32,
    master_volume: u32,
    youtube_channel_id: String,
    youtube_live_id: Option<String>,
    enable_youtube: bool,
    youtube_chat_mode: String,
    enable_facebook: bool,
    facebook_access_token_configured: bool,
    facebook_target_id: String,
    facebook_live_id: Option<String>,
    enable_instagram: bool,
    instagram_access_token_configured: bool,
    instagram_user_id: String,
    instagram_live_id: Option<String>,
}

impl From<&AppSettings> for SettingsResponse {
    fn from(settings: &AppSettings) -> Self {
        Self {
            tts_provider: settings.tts_provider.clone(),
            azure_speech_key_configured: !settings.azure_speech_key.trim().is_empty(),
            azure_speech_region: settings.azure_speech_region.clone(),
            azure_speech_voice: settings.azure_speech_voice.clone(),
            azure_speech_voices: settings.azure_speech_voices.clone(),
            azure_speech_voice_rotation: settings.azure_speech_voice_rotation,
            sapi_voice: settings.sapi_voice.clone(),
            sapi_voices: settings.sapi_voices.clone(),
            sapi_voice_rotation: settings.sapi_voice_rotation,
            sapi_rate: settings.sapi_rate,
            sapi_volume: settings.sapi_volume,
            master_volume: settings.master_volume,
            youtube_channel_id: settings.youtube_channel_id.clone(),
            youtube_live_id: settings.youtube_live_id.clone(),
            enable_youtube: settings.enable_youtube,
            youtube_chat_mode: settings.youtube_chat_mode.clone(),
            enable_facebook: settings.enable_facebook,
            facebook_access_token_configured: !settings.facebook_access_token.trim().is_empty(),
            facebook_target_id: settings.facebook_target_id.clone(),
            facebook_live_id: settings.facebook_live_id.clone(),
            enable_instagram: settings.enable_instagram,
            instagram_access_token_configured: !settings.instagram_access_token.trim().is_empty(),
            instagram_user_id: settings.instagram_user_id.clone(),
            instagram_live_id: settings.instagram_live_id.clone(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSettingsPayload {
    #[serde(default)]
    tts_provider: Option<String>,
    #[serde(default)]
    azure_speech_key: Option<String>,
    #[serde(default)]
    clear_azure_speech_key: bool,
    azure_speech_region: String,
    azure_speech_voice: String,
    #[serde(default)]
    azure_speech_voices: Option<Vec<String>>,
    #[serde(default)]
    azure_speech_voice_rotation: bool,
    #[serde(default)]
    sapi_voice: Option<String>,
    #[serde(default)]
    sapi_voices: Option<Vec<String>>,
    #[serde(default)]
    sapi_voice_rotation: Option<bool>,
    #[serde(default)]
    sapi_rate: Option<i32>,
    #[serde(default)]
    sapi_volume: Option<u32>,
    #[serde(default)]
    master_volume: Option<u32>,
    youtube_channel_id: String,
    youtube_live_id: Option<String>,
    enable_youtube: bool,
    #[serde(default)]
    youtube_chat_mode: Option<String>,
    #[serde(default)]
    enable_facebook: Option<bool>,
    #[serde(default)]
    facebook_access_token: Option<String>,
    #[serde(default)]
    clear_facebook_access_token: bool,
    #[serde(default)]
    facebook_target_id: Option<String>,
    #[serde(default)]
    facebook_live_id: Option<String>,
    #[serde(default)]
    enable_instagram: Option<bool>,
    #[serde(default)]
    instagram_access_token: Option<String>,
    #[serde(default)]
    clear_instagram_access_token: bool,
    #[serde(default)]
    instagram_user_id: Option<String>,
    #[serde(default)]
    instagram_live_id: Option<String>,
}

impl SaveSettingsPayload {
    fn into_settings(self, current: AppSettings) -> AppSettings {
        let tts_provider = self
            .tts_provider
            .filter(|p| p == "azure" || p == "sapi5")
            .unwrap_or(current.tts_provider);

        let azure_speech_key = if self.clear_azure_speech_key {
            String::new()
        } else {
            self.azure_speech_key
                .filter(|key| !key.trim().is_empty())
                .unwrap_or(current.azure_speech_key)
        };

        let mut azure_speech_voice = self.azure_speech_voice;
        let mut azure_speech_voices = self.azure_speech_voices.unwrap_or_else(|| {
            vec![azure_speech_voice.clone()]
        });
        azure_speech_voices = azure_speech_voices
            .into_iter()
            .map(|voice| voice.trim().to_string())
            .filter(|voice| !voice.is_empty())
            .fold(Vec::new(), |mut voices, voice| {
                if !voices.contains(&voice) {
                    voices.push(voice);
                }
                voices
            });
        if azure_speech_voices.is_empty() {
            azure_speech_voices.push(azure_speech_voice.clone());
        }
        if self.azure_speech_voice_rotation {
            azure_speech_voice = azure_speech_voices[0].clone();
        }

        let sapi_voice = self.sapi_voice.unwrap_or(current.sapi_voice);
        let mut sapi_voices = self.sapi_voices.unwrap_or_else(|| {
            vec![sapi_voice.clone()]
        });
        sapi_voices = sapi_voices
            .into_iter()
            .map(|voice| voice.trim().to_string())
            .filter(|voice| !voice.is_empty())
            .fold(Vec::new(), |mut voices, voice| {
                if !voices.contains(&voice) {
                    voices.push(voice);
                }
                voices
            });
        if sapi_voices.is_empty() {
            sapi_voices.push(sapi_voice.clone());
        }

        let sapi_voice_rotation = self.sapi_voice_rotation.unwrap_or(current.sapi_voice_rotation);
        let sapi_rate = self.sapi_rate.unwrap_or(current.sapi_rate).clamp(-10, 10);
        let sapi_volume = self.sapi_volume.unwrap_or(current.sapi_volume).min(100);
        let master_volume = self.master_volume.unwrap_or(current.master_volume).min(100);

        let youtube_chat_mode = self
            .youtube_chat_mode
            .filter(|m| m == "live" || m == "top")
            .unwrap_or(current.youtube_chat_mode);

        let enable_facebook = self.enable_facebook.unwrap_or(current.enable_facebook);
        let facebook_access_token = if self.clear_facebook_access_token {
            String::new()
        } else {
            self.facebook_access_token
                .filter(|k| !k.trim().is_empty())
                .unwrap_or(current.facebook_access_token)
        };
        let facebook_target_id = self.facebook_target_id.unwrap_or(current.facebook_target_id);
        let facebook_live_id = self.facebook_live_id.or(current.facebook_live_id);

        let enable_instagram = self.enable_instagram.unwrap_or(current.enable_instagram);
        let instagram_access_token = if self.clear_instagram_access_token {
            String::new()
        } else {
            self.instagram_access_token
                .filter(|k| !k.trim().is_empty())
                .unwrap_or(current.instagram_access_token)
        };
        let instagram_user_id = self.instagram_user_id.unwrap_or(current.instagram_user_id);
        let instagram_live_id = self.instagram_live_id.or(current.instagram_live_id);

        AppSettings {
            tts_provider,
            azure_speech_key,
            azure_speech_region: self.azure_speech_region,
            azure_speech_voice,
            azure_speech_voices,
            azure_speech_voice_rotation: self.azure_speech_voice_rotation,
            sapi_voice,
            sapi_voices,
            sapi_voice_rotation,
            sapi_rate,
            sapi_volume,
            master_volume,
            youtube_channel_id: self.youtube_channel_id,
            youtube_live_id: self.youtube_live_id,
            enable_youtube: self.enable_youtube,
            youtube_chat_mode,
            enable_facebook,
            facebook_access_token,
            facebook_target_id,
            facebook_live_id,
            enable_instagram,
            instagram_access_token,
            instagram_user_id,
            instagram_live_id,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestMetaPayload {
    token: Option<String>,
    target_id: Option<String>,
}

async fn test_facebook_handler(
    State(state): State<AppState>,
    Json(payload): Json<TestMetaPayload>,
) -> Response {
    let settings = state.db.load_settings().unwrap_or_default();
    let token = payload.token.filter(|t| !t.trim().is_empty()).unwrap_or(settings.facebook_access_token);
    let target = payload.target_id.filter(|t| !t.trim().is_empty()).unwrap_or(settings.facebook_target_id);
    let client = crate::meta_client::MetaClient::new();
    let result = client.test_facebook_token(&token, &target).await;
    Json(result).into_response()
}

async fn test_instagram_handler(
    State(state): State<AppState>,
    Json(payload): Json<TestMetaPayload>,
) -> Response {
    let settings = state.db.load_settings().unwrap_or_default();
    let token = payload.token.filter(|t| !t.trim().is_empty()).unwrap_or(settings.instagram_access_token);
    let user_id = payload.target_id.filter(|t| !t.trim().is_empty()).unwrap_or(settings.instagram_user_id);
    let client = crate::meta_client::MetaClient::new();
    let result = client.test_instagram_token(&token, &user_id).await;
    Json(result).into_response()
}

#[derive(Deserialize)]
struct VoiceQuery {
    region: Option<String>,
    provider: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceCatalogResponse {
    region: String,
    count: usize,
    voices: Vec<VoiceCatalogEntry>,
}

fn normalize_speech_region(region: &str) -> Option<String> {
    let normalized = region.trim().to_ascii_lowercase();
    let valid = (2..=64).contains(&normalized.len())
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        && normalized
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric())
        && normalized
            .chars()
            .last()
            .is_some_and(|character| character.is_ascii_alphanumeric());
    valid.then_some(normalized)
}

fn voice_catalog_entries(payload: serde_json::Value) -> Option<Vec<VoiceCatalogEntry>> {
    let voices = payload.as_array()?;
    Some(
        voices
            .iter()
            .filter_map(|voice| {
                let short_name = voice.get("ShortName")?.as_str()?.to_string();
                let value = |key: &str| {
                    voice
                        .get(key)
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                };
                let display_name = value("DisplayName")
                    .or_else(|| value("LocalName"))
                    .unwrap_or_else(|| short_name.clone());
                let string_list = |key: &str| {
                    voice
                        .get(key)
                        .and_then(serde_json::Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .map(str::to_string)
                                .collect()
                        })
                };
                Some(VoiceCatalogEntry {
                    short_name,
                    display_name,
                    local_name: value("LocalName"),
                    locale: value("Locale").unwrap_or_default(),
                    locale_name: value("LocaleName"),
                    gender: value("Gender"),
                    voice_type: value("VoiceType"),
                    status: value("Status"),
                    style_list: string_list("StyleList"),
                    secondary_locale_list: string_list("SecondaryLocaleList"),
                })
            })
            .collect(),
    )
}

async fn get_settings_handler(State(state): State<AppState>) -> Response {
    match state.db.load_settings() {
        Ok(settings) => Json(SettingsResponse::from(&settings)).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

async fn save_settings_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveSettingsPayload>,
) -> Response {
    let current = match state.db.load_settings() {
        Ok(settings) => settings,
        Err(error) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
    };
    let settings = payload.into_settings(current);
    if !settings.azure_speech_region.trim().is_empty()
        && normalize_speech_region(&settings.azure_speech_region).is_none()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Invalid Azure Speech region format." })),
        )
            .into_response();
    }
    if let Err(err) = state.db.save_settings(&settings) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save settings: {}", err)).into_response();
    }
    state.tts_handle.update_settings(settings.clone()).await;
    Json(serde_json::json!({
        "success": true,
        "settings": SettingsResponse::from(&settings)
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VolumePayload {
    volume: Option<u32>,
    #[serde(default)]
    is_muted: Option<bool>,
}

async fn get_volume_handler(State(state): State<AppState>) -> Response {
    let (volume, is_muted) = state.tts_handle.get_volume_state().await;
    Json(serde_json::json!({ "volume": volume, "isMuted": is_muted })).into_response()
}

async fn set_volume_handler(
    State(state): State<AppState>,
    Json(payload): Json<VolumePayload>,
) -> Response {
    if let Some(muted) = payload.is_muted {
        state.tts_handle.set_mute(muted).await;
    }
    if let Some(vol) = payload.volume {
        let vol = vol.min(100);
        if let Err(err) = state.db.set_setting("master_volume", &vol.to_string()) {
            tracing::error!("Failed to save master_volume setting: {}", err);
            return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
        }
        state.tts_handle.set_volume(vol as f32 / 100.0).await;
    }
    let (volume, is_muted) = state.tts_handle.get_volume_state().await;
    Json(serde_json::json!({ "success": true, "volume": volume, "isMuted": is_muted })).into_response()
}

async fn toggle_mute_handler(State(state): State<AppState>) -> Response {
    state.tts_handle.toggle_mute().await;
    let (volume, is_muted) = state.tts_handle.get_volume_state().await;
    Json(serde_json::json!({ "success": true, "volume": volume, "isMuted": is_muted })).into_response()
}

async fn pause_hotkeys_handler() -> Response {
    crate::tray::pause_hotkeys();
    Json(serde_json::json!({ "success": true })).into_response()
}

async fn resume_hotkeys_handler() -> Response {
    crate::tray::resume_hotkeys();
    Json(serde_json::json!({ "success": true })).into_response()
}

async fn get_voices_handler(
    State(state): State<AppState>,
    Query(query): Query<VoiceQuery>,
) -> Response {
    let settings = match state.db.load_settings() {
        Ok(settings) => settings,
        Err(error) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response();
        }
    };

    let is_sapi = query.provider.as_deref() == Some("sapi5")
        || (query.provider.is_none() && settings.tts_provider == "sapi5");

    if is_sapi {
        return match crate::sapi_tts::get_installed_voices().await {
            Ok(voices) => Json(VoiceCatalogResponse {
                region: "local".to_string(),
                count: voices.len(),
                voices,
            })
            .into_response(),
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to retrieve SAPI voices: {}", err) })),
            )
                .into_response(),
        };
    }

    if settings.azure_speech_key.trim().is_empty() {
        return (
            StatusCode::PRECONDITION_REQUIRED,
            Json(serde_json::json!({ "error": "Enter and save an Azure Speech key to load voices." })),
        )
            .into_response();
    }

    let requested_region = query.region.as_deref().unwrap_or(&settings.azure_speech_region);
    let Some(region) = normalize_speech_region(requested_region) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Enter a valid Azure Speech region." })),
        )
            .into_response();
    };
    let endpoint = format!(
        "https://{}.tts.speech.microsoft.com/cognitiveservices/voices/list",
        region
    );

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::error!("Failed to create Azure voice catalog client: {}", error);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Could not start the Azure voice request." })),
            )
                .into_response();
        }
    };

    let response = match client
        .get(endpoint)
        .header("Ocp-Apim-Subscription-Key", settings.azure_speech_key)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("Azure voice catalog request failed for region {}: {}", region, error);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": "Could not reach Azure Speech. Check the region and network connection." })),
            )
                .into_response();
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        tracing::warn!("Azure voice catalog returned {} for region {}", status, region);
        let message = if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            "Azure rejected the saved Speech key or region. Check both settings and try again."
        } else {
            "Azure Speech could not return voices for this region. Check the region and try again."
        };
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": message })),
        )
            .into_response();
    }

    let payload = match response.json::<serde_json::Value>().await {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!("Azure returned an invalid voice catalog for region {}: {}", region, error);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": "Azure Speech returned an unreadable voice list." })),
            )
                .into_response();
        }
    };
    let Some(mut voices) = voice_catalog_entries(payload) else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": "Azure Speech returned an invalid voice list." })),
        )
            .into_response();
    };
    voices.sort_by(|left, right| {
        left.locale_name
            .as_deref()
            .unwrap_or(&left.locale)
            .cmp(right.locale_name.as_deref().unwrap_or(&right.locale))
            .then_with(|| left.short_name.cmp(&right.short_name))
    });
    let catalog = VoiceCatalogResponse {
        region,
        count: voices.len(),
        voices,
    };
    Json(catalog).into_response()
}

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() || path == "chat" || path == "dock" || path == "settings" || path == "popup" || path == "overlay" {
        path = "index.html".to_string();
    }

    match Asset::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            // SPA fallback: return index.html for non-asset routes
            if let Some(index) = Asset::get("index.html") {
                ([(header::CONTENT_TYPE, "text/html")], index.data).into_response()
            } else {
                (StatusCode::NOT_FOUND, "404 Not Found").into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts_queue::TtsActor;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_static_and_spa_routing() {
        let db = Db::open_in_memory().unwrap();
        db.set_setting("azure_speech_key", "").unwrap();
        let (broadcast_tx, _) = broadcast::channel(10);
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel(1);
        let tts_handle = TtsActor::spawn(broadcast_tx.clone(), AppSettings::default());
        let state = AppState {
            db: db.clone(),
            tts_handle,
            broadcast_tx,
            shutdown_tx,
            port: 7060,
        };
        let app = create_router(state);

        // Test GET /
        let response = app
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Test GET /api/info
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/info")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let info_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(info_json["port"], 7060);
        assert_eq!(info_json["obsChatUrl"], "http://127.0.0.1:7060/chat");
        assert_eq!(info_json["obsDockUrl"], "http://127.0.0.1:7060/");
        assert_eq!(info_json["appUrl"], "http://127.0.0.1:7060/");

        // Test OBS overlay and SPA routes serve embedded SPA index.html with 200 OK and text/html
        for route in &["/chat", "/overlay", "/popup", "/settings", "/dock"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(*route).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let content_type = response
                .headers()
                .get(header::CONTENT_TYPE)
                .expect("content-type header should be present")
                .to_str()
                .unwrap();
            assert!(
                content_type.starts_with("text/html"),
                "expected text/html for {}, got {}",
                route,
                content_type
            );
            let body = response.into_body().collect().await.unwrap().to_bytes();
            let html_str = String::from_utf8_lossy(&body);
            assert!(
                html_str.contains("<html") || html_str.contains("<!DOCTYPE") || html_str.contains("<!doctype"),
                "expected HTML index content for {}, got: {}",
                route,
                html_str
            );
        }

        // Test GET /api/settings
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/settings")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let settings: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(settings["azureSpeechRegion"], "centralindia");
        assert_eq!(settings["azureSpeechKeyConfigured"], false);
        assert_eq!(settings["youtubeChatMode"], "live");
        assert!(settings.get("azureSpeechKey").is_none());

        // Test POST /api/settings
        let updated = AppSettings {
            tts_provider: "sapi5".to_string(),
            azure_speech_key: "new_key".to_string(),
            azure_speech_region: "centralus".to_string(),
            azure_speech_voice: "hi-IN-SwaraNeural".to_string(),
            azure_speech_voices: vec!["hi-IN-SwaraNeural".to_string()],
            azure_speech_voice_rotation: false,
            sapi_voice: "Microsoft David Desktop".to_string(),
            sapi_voices: vec!["Microsoft David Desktop".to_string()],
            sapi_voice_rotation: false,
            sapi_rate: 2,
            sapi_volume: 90,
            master_volume: 85,
            youtube_channel_id: "test_channel".to_string(),
            youtube_live_id: Some("live123".to_string()),
            enable_youtube: false,
            youtube_chat_mode: "top".to_string(),
            enable_facebook: false,
            facebook_access_token: String::new(),
            facebook_target_id: "me".to_string(),
            facebook_live_id: None,
            enable_instagram: false,
            instagram_access_token: String::new(),
            instagram_user_id: String::new(),
            instagram_live_id: None,
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/settings")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_vec(&updated).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let save_body = response.into_body().collect().await.unwrap().to_bytes();
        let save_response: serde_json::Value = serde_json::from_slice(&save_body).unwrap();
        assert_eq!(save_response["settings"]["azureSpeechKeyConfigured"], true);
        assert!(save_response["settings"].get("azureSpeechKey").is_none());
        let reloaded = db.load_settings().unwrap();
        assert_eq!(reloaded.tts_provider, "sapi5");
        assert_eq!(reloaded.azure_speech_region, "centralus");
        assert_eq!(reloaded.azure_speech_voice, "hi-IN-SwaraNeural");
        assert_eq!(reloaded.sapi_voice, "Microsoft David Desktop");
        assert_eq!(reloaded.sapi_rate, 2);
        assert_eq!(reloaded.sapi_volume, 90);
        assert_eq!(reloaded.master_volume, 85);
        assert_eq!(reloaded.youtube_chat_mode, "top");

        // Test POST /api/baba-say
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/baba-say")
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"text":"Hello from BABA!"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Test POST /api/skip-current
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/skip-current")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Test POST /api/speak-as-banned with no banned user (should 404)
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/speak-as-banned")
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"text":"Ghost message"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // Test GET /api/last-banned before banning (should return user: null)
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/last-banned")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let last_banned_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(last_banned_json["user"].is_null());

        // Ban a user and test POST /api/speak-as-banned (should succeed)
        db.ban_user("spammer-1", "SpamGuy", None).unwrap();

        // Test GET /api/last-banned after banning
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/last-banned")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let last_banned_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(last_banned_json["user"]["displayName"], "SpamGuy");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/speak-as-banned")
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"text":"I repent!"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // State-changing endpoints reject GET requests.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/speak-as-banned")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);

        // Test POST /api/restart from non-loopback IP (should be 403 Forbidden)
        let mut remote_req = Request::builder()
            .method("POST")
            .uri("/api/restart")
            .body(Body::empty())
            .unwrap();
        remote_req.extensions_mut().insert(ConnectInfo(SocketAddr::from(([192, 168, 1, 100], 55555))));
        let response = app.clone().oneshot(remote_req).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        // Test GET /api/volume and POST /api/volume
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/volume")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let vol_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(vol_json["volume"], 85);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/volume")
                    .header("Content-Type", "application/json")
                    .body(Body::from(r#"{"volume":42}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let vol_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(vol_json["success"], true);
        assert_eq!(vol_json["volume"], 42);

        let reloaded = db.load_settings().unwrap();
        assert_eq!(reloaded.master_volume, 42);

        // Test POST /api/volume/toggle-mute
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/volume/toggle-mute")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let toggle_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(toggle_json["success"], true);
        assert_eq!(toggle_json["isMuted"], true);

        // Test POST /api/pause-hotkeys and POST /api/resume-hotkeys
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/pause-hotkeys")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/resume-hotkeys")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Test POST /api/restart from loopback IP (should succeed)
        let mut local_req = Request::builder()
            .method("POST")
            .uri("/api/restart")
            .body(Body::empty())
            .unwrap();
        local_req.extensions_mut().insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 55555))));
        let response = app.clone().oneshot(local_req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        assert!(shutdown_rx.try_recv().is_ok());
    }

    #[tokio::test]
    async fn test_obs_overlay_endpoints_serve_spa_html() {
        let db = Db::open_in_memory().unwrap();
        let (broadcast_tx, _) = broadcast::channel(10);
        let (shutdown_tx, _) = tokio::sync::mpsc::channel(1);
        let tts_handle = TtsActor::spawn(broadcast_tx.clone(), AppSettings::default());
        let state = AppState {
            db,
            tts_handle,
            broadcast_tx,
            shutdown_tx,
            port: 7060,
        };
        let app = create_router(state);

        let obs_routes = ["/overlay", "/popup", "/chat"];
        for route in obs_routes {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(route).body(Body::empty()).unwrap())
                .await
                .unwrap();

            assert_eq!(
                response.status(),
                StatusCode::OK,
                "OBS route {} must return 200 OK",
                route
            );

            let content_type = response
                .headers()
                .get(header::CONTENT_TYPE)
                .expect("Content-Type header must be present")
                .to_str()
                .unwrap();

            assert!(
                content_type.starts_with("text/html"),
                "OBS route {} Content-Type must be text/html, got {}",
                route,
                content_type
            );

            let body = response.into_body().collect().await.unwrap().to_bytes();
            let html_str = String::from_utf8_lossy(&body);
            assert!(
                html_str.contains("<html") || html_str.contains("<!doctype") || html_str.contains("<!DOCTYPE"),
                "OBS route {} must serve the index.html SPA content",
                route
            );
        }
    }
}


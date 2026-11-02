use crate::colors::get_deterministic_color;
use crate::db::Db;
use crate::tts_queue::{TtsHandle, WsBroadcastMessage};
use crate::types::{AppSettings, ChatMessage, MessageStatus};
use crate::ws::handle_websocket;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::State;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::Deserialize;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

#[derive(RustEmbed)]
#[folder = "frontend/dist/"]
struct Asset;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub tts_handle: TtsHandle,
    pub broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/skip-current", get(skip_current_handler))
        .route("/api/skip-ban-current", get(skip_ban_current_handler))
        .route("/api/baba-say", post(baba_say_handler))
        .route("/api/speak-as-banned", post(speak_as_banned_handler))
        .route("/api/settings", get(get_settings_handler).post(save_settings_handler))
        .fallback(static_handler)
        .layer(CorsLayer::permissive())
        .with_state(state)
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

async fn skip_ban_current_handler(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(current) = state.tts_handle.get_current_processing().await {
        if let Some(aid) = current.author_id {
            let _ = state.db.ban_user(&aid, &current.author_name, current.author_profile_image_url.as_deref());
            state.tts_handle.remove_user(aid).await;
            if let Ok(banned) = state.db.get_banned_users() {
                let _ = state.broadcast_tx.send(WsBroadcastMessage::BannedUsers(banned));
            }
            return format!("Banned and skipped: {}", current.author_name);
        }
    }
    "No active message to ban".to_string()
}

#[derive(Debug, Deserialize)]
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
    };

    let _ = state.broadcast_tx.send(WsBroadcastMessage::Messages(vec![msg.clone()]));
    state.tts_handle.enqueue_priority(msg).await;

    Json(serde_json::json!({ "success": true, "text": trimmed })).into_response()
}

async fn speak_as_banned_handler(
    State(state): State<AppState>,
    Json(payload): Json<TextPayload>,
) -> Response {
    let Some(text) = payload.text else {
        return (StatusCode::BAD_REQUEST, "Missing text").into_response();
    };

    let Ok(Some(last_banned)) = state.db.get_last_banned_user() else {
        return (StatusCode::NOT_FOUND, "No banned users found").into_response();
    };

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

async fn get_settings_handler(State(state): State<AppState>) -> Json<AppSettings> {
    let settings = state.db.load_settings().unwrap_or_default();
    Json(settings)
}

async fn save_settings_handler(
    State(state): State<AppState>,
    Json(settings): Json<AppSettings>,
) -> Response {
    if let Err(err) = state.db.save_settings(&settings) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to save settings: {}", err)).into_response();
    }
    state.tts_handle.update_settings(settings.clone()).await;
    Json(serde_json::json!({ "success": true, "settings": settings })).into_response()
}

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() || path == "chat" || path == "dock" {
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
        let (broadcast_tx, _) = broadcast::channel(10);
        let tts_handle = TtsActor::spawn(broadcast_tx.clone(), AppSettings::default());
        let state = AppState {
            db: db.clone(),
            tts_handle,
            broadcast_tx,
        };
        let app = create_router(state);

        // Test GET /
        let response = app
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Test GET /chat (SPA overlay route)
        let response = app
            .clone()
            .oneshot(Request::builder().uri("/chat").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

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
        let settings: AppSettings = serde_json::from_slice(&body).unwrap();
        assert_eq!(settings.azure_speech_region, "centralindia");

        // Test POST /api/settings
        let updated = AppSettings {
            azure_speech_key: "new_key".to_string(),
            azure_speech_region: "centralus".to_string(),
            azure_speech_voice: "hi-IN-SwaraNeural".to_string(),
            youtube_channel_id: "test_channel".to_string(),
            youtube_live_id: Some("live123".to_string()),
            enable_youtube: false,
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
        let reloaded = db.load_settings().unwrap();
        assert_eq!(reloaded.azure_speech_region, "centralus");
        assert_eq!(reloaded.azure_speech_voice, "hi-IN-SwaraNeural");

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

        // Test GET /api/skip-current
        let response = app
            .clone()
            .oneshot(
                Request::builder()
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

        // Ban a user and test POST /api/speak-as-banned (should succeed)
        db.ban_user("spammer-1", "SpamGuy", None).unwrap();
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
    }
}


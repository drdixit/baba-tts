use crate::colors::get_deterministic_color;
use crate::db::Db;
use crate::spam_filter::SpamFilter;
use crate::tts_queue::{TtsHandle, WsBroadcastMessage};
use crate::types::{ChatMessage, MessageStatus};
use anyhow::{bail, Context, Result};
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT_LANGUAGE, USER_AGENT};
use reqwest::Client;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::time::sleep;
use tracing::{info, warn};

pub struct YouTubePoller {
    client: Client,
    db: Db,
    spam_filter: SpamFilter,
    tts_handle: TtsHandle,
    broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    stop_signal: Arc<AtomicBool>,
}

impl YouTubePoller {
    pub fn new(
        db: Db,
        spam_filter: SpamFilter,
        tts_handle: TtsHandle,
        broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    ) -> (Self, Arc<AtomicBool>) {
        let stop_signal = Arc::new(AtomicBool::new(false));
        let mut default_headers = HeaderMap::new();
        default_headers.insert(
            ACCEPT_LANGUAGE,
            HeaderValue::from_static("en-US,en;q=0.9"),
        );
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ),
        );

        let poller = Self {
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .default_headers(default_headers)
                .build()
                .unwrap_or_default(),
            db,
            spam_filter,
            tts_handle,
            broadcast_tx,
            stop_signal: stop_signal.clone(),
        };
        (poller, stop_signal)
    }

    pub fn start(self) {
        tokio::spawn(async move {
            self.run_loop().await;
        });
    }

    async fn run_loop(&self) {
        while !self.stop_signal.load(Ordering::Relaxed) {
            let settings = match self.db.load_settings() {
                Ok(s) => s,
                Err(err) => {
                    warn!("[YouTube] Failed to load settings: {}. Retrying in 10s...", err);
                    sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };

            if !settings.enable_youtube {
                info!("[YouTube] Polling disabled in settings. Checking again in 10s...");
                sleep(Duration::from_secs(10)).await;
                continue;
            }

            info!("[YouTube] Discovering live stream...");
            let retry_delay = match self
                .poll_stream_session(
                    &settings.youtube_channel_id,
                    settings.youtube_live_id.as_deref(),
                    &settings.youtube_chat_mode,
                )
                .await
            {
                Ok(_) => {
                    info!("[YouTube] Live stream ended or disconnected. Waiting 30s before re-checking...");
                    // Preserving existing queued chat messages so in-flight TTS isn't abruptly wiped out
                    Duration::from_secs(30)
                }
                Err(err) => {
                    warn!("[YouTube] Polling error: {}. Retrying in 30s...", err);
                    Duration::from_secs(30)
                }
            };

            sleep(retry_delay).await;
        }
    }

    async fn resolve_video_id(
        &self,
        channel_id: &str,
        live_id_override: Option<&str>,
    ) -> Result<(String, String)> {
        if let Some(live_id) = live_id_override {
            let trimmed = live_id.trim();
            if !trimmed.is_empty() {
                return Ok((trimmed.to_string(), String::new()));
            }
        }

        let channel_url = if !channel_id.is_empty() {
            format!("https://www.youtube.com/channel/{}/live", channel_id.trim())
        } else {
            "https://www.youtube.com/@baba%E0%A4%9C%E0%A5%80/live".to_string()
        };

        info!("[YouTube] Resolving active live stream from: {}", channel_url);
        let resp = self.client.get(&channel_url).send().await?.text().await?;

        if let Some(vid) = extract_video_id_from_html(&resp) {
            return Ok((vid, resp));
        }

        bail!("Channel is not currently live (no active video ID found)");
    }

    async fn poll_stream_session(
        &self,
        channel_id: &str,
        live_id_override: Option<&str>,
        chat_mode: &str,
    ) -> Result<()> {
        let (video_id, channel_html) = self.resolve_video_id(channel_id, live_id_override).await?;

        let chat_url = format!("https://www.youtube.com/live_chat?v={}", video_id);
        info!("[YouTube] Fetching live chat standalone page: {}", chat_url);
        let chat_resp = match self.client.get(&chat_url).send().await {
            Ok(r) => r.text().await.unwrap_or_default(),
            Err(err) => {
                warn!("[YouTube] Failed to fetch live chat page: {}. Retrying in 15s...", err);
                bail!("Failed to fetch live chat page: {}", err);
            }
        };

        let api_key = extract_innertube_api_key(&chat_resp)
            .or_else(|| extract_innertube_api_key(&channel_html))
            .context("Could not find INNERTUBE_API_KEY")?;

        let data = extract_yt_initial_data(&chat_resp)
            .or_else(|| extract_yt_initial_data(&channel_html));

        let mut continuation = data
            .as_ref()
            .and_then(|d| extract_continuation_token(d, chat_mode))
            .or_else(|| {
                let cont_re = Regex::new(r#""continuation":"([^"]+)""#).ok()?;
                cont_re
                    .captures(&chat_resp)
                    .or_else(|| cont_re.captures(&channel_html))
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
            })
            .context("Live stream is not currently active (no continuation found)")?;

        info!(
            "[YouTube] Connected to live stream (mode: {})! Starting chat poll loop for video {}...",
            if chat_mode.eq_ignore_ascii_case("top") {
                "Top Chat"
            } else {
                "Live Chat (All Messages)"
            },
            video_id
        );

        let themes = ["subtitle-sweep", "subtitle-karaoke", "subtitle-words", "pro-clean"];
        let mut theme_index = 0;
        let mut missing_token_retries: usize = 0;

        while !self.stop_signal.load(Ordering::Relaxed) {
            let api_endpoint = format!(
                "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key={}",
                api_key
            );

            let body = serde_json::json!({
                "context": {
                    "client": {
                        "clientName": "WEB",
                        "clientVersion": "2.20240101.00.00"
                    }
                },
                "continuation": continuation
            });

            let poll_resp = match self.client.post(&api_endpoint).json(&body).send().await {
                Ok(r) => r,
                Err(err) => {
                    warn!("[YouTube] HTTP request failed: {}. Retrying in 5s...", err);
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };

            let json: Value = poll_resp.json().await.unwrap_or(Value::Null);

            // Parse actions
            if let Some(actions) = json
                .pointer("/continuationContents/liveChatContinuation/actions")
                .and_then(|v| v.as_array())
            {
                let mut new_messages = Vec::new();

                for act in actions {
                    let Some(parsed) = parse_chat_action(act) else {
                        continue;
                    };

                    // Check banned
                    if let Some(ref aid) = parsed.author_id {
                        if self.db.is_user_banned(aid) {
                            continue;
                        }
                    }

                    // Spam filter check
                    let user_key = parsed.author_id.as_deref().unwrap_or(&parsed.author_name);
                    let spam_check = self.spam_filter.is_spam(user_key, &parsed.text);
                    if spam_check.is_spam {
                        info!(
                            "[Spam Filter] Blocked message from {}: {:?}",
                            parsed.author_name, spam_check.reason
                        );
                        continue;
                    }

                    let theme = themes[theme_index % themes.len()].to_string();
                    theme_index += 1;

                    let author_color = get_deterministic_color(&parsed.author_name).to_string();

                    let chat_msg = ChatMessage {
                        message_id: if parsed.msg_id.is_empty() {
                            format!("msg-{}", uuid::Uuid::new_v4())
                        } else {
                            parsed.msg_id
                        },
                        author_name: parsed.author_name,
                        author_id: parsed.author_id,
                        author_profile_image_url: parsed.author_avatar,
                        author_color: Some(author_color),
                        text: parsed.text,
                        status: MessageStatus::Queued,
                        theme: Some(theme),
                        word_boundaries: None,
                    };

                    new_messages.push(chat_msg);
                }

                if !new_messages.is_empty() {
                    let _ = self
                        .broadcast_tx
                        .send(WsBroadcastMessage::Messages(new_messages.clone()));

                    for m in new_messages {
                        self.tts_handle.enqueue(m).await;
                    }
                }
            }

            // Extract next continuation and server timeoutMs
            let next_node = json
                .pointer("/continuationContents/liveChatContinuation/continuations/0/invalidationContinuationData")
                .or_else(|| json.pointer("/continuationContents/liveChatContinuation/continuations/0/timedContinuationData"));

            if let Some(node) = next_node {
                if let Some(next_token) = node.get("continuation").and_then(|v| v.as_str()) {
                    continuation = next_token.to_string();
                    missing_token_retries = 0;
                } else if missing_token_retries < 3 {
                    missing_token_retries += 1;
                    warn!(
                        "[YouTube] Stream continuation token missing (attempt {}/3). Retrying in 3s...",
                        missing_token_retries
                    );
                    sleep(Duration::from_secs(3)).await;
                    continue;
                } else {
                    warn!("[YouTube] Stream continuation token missing after 3 retries");
                    break;
                }

                let timeout_ms = node
                    .get("timeoutMs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3000)
                    .clamp(1000, 5000);

                sleep(Duration::from_millis(timeout_ms)).await;
            } else if missing_token_retries < 3 {
                missing_token_retries += 1;
                warn!(
                    "[YouTube] Stream continuation node missing (attempt {}/3). Retrying in 3s...",
                    missing_token_retries
                );
                sleep(Duration::from_secs(3)).await;
                continue;
            } else {
                warn!("[YouTube] Stream continuation ended after 3 failed attempts");
                break;
            }
        }

        Ok(())
    }
}

pub fn extract_video_id_from_html(html: &str) -> Option<String> {
    let canonical_re =
        Regex::new(r#"<link\s+rel="canonical"\s+href="https://www\.youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})""#).ok()?;
    if let Some(cap) = canonical_re.captures(html) {
        if let Some(vid) = cap.get(1) {
            return Some(vid.as_str().to_string());
        }
    }

    let vid_re = Regex::new(r#""videoId":"([a-zA-Z0-9_-]{11})""#).ok()?;
    if let Some(cap) = vid_re.captures(html) {
        if let Some(vid) = cap.get(1) {
            return Some(vid.as_str().to_string());
        }
    }

    None
}

pub fn extract_continuation_token(data: &Value, chat_mode: &str) -> Option<String> {
    let lcr = data
        .pointer("/contents/liveChatRenderer")
        .or_else(|| data.pointer("/contents/twoColumnWatchNextResults/conversationBar/liveChatRenderer"))
        .or_else(|| data.pointer("/liveChatRenderer"));

    let is_top_mode = chat_mode.eq_ignore_ascii_case("top");

    if let Some(renderer) = lcr {
        let sub_menu_items = renderer
            .pointer("/header/liveChatHeaderRenderer/viewSelector/sortFilterSubMenuRenderer/subMenuItems")
            .and_then(|v| v.as_array());

        if let Some(items) = sub_menu_items {
            if is_top_mode {
                for item in items {
                    let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    if title.eq_ignore_ascii_case("top chat") {
                        if let Some(token) = item
                            .pointer("/continuation/reloadContinuationData/continuation")
                            .and_then(|v| v.as_str())
                        {
                            return Some(token.to_string());
                        }
                    }
                }
                // Fallback to first item for top chat
                if let Some(first) = items.first() {
                    if let Some(token) = first
                        .pointer("/continuation/reloadContinuationData/continuation")
                        .and_then(|v| v.as_str())
                    {
                        return Some(token.to_string());
                    }
                }
            } else {
                // "live" mode (unfiltered live chat)
                for item in items {
                    let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    if title.eq_ignore_ascii_case("live chat") {
                        if let Some(token) = item
                            .pointer("/continuation/reloadContinuationData/continuation")
                            .and_then(|v| v.as_str())
                        {
                            return Some(token.to_string());
                        }
                    }
                }
                // In live mode if title not found, pick item with selected == false or second item
                for item in items {
                    let selected = item.get("selected").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !selected {
                        if let Some(token) = item
                            .pointer("/continuation/reloadContinuationData/continuation")
                            .and_then(|v| v.as_str())
                        {
                            return Some(token.to_string());
                        }
                    }
                }
                if items.len() >= 2 {
                    if let Some(token) = items[1]
                        .pointer("/continuation/reloadContinuationData/continuation")
                        .and_then(|v| v.as_str())
                    {
                        return Some(token.to_string());
                    }
                }
            }
        }

        // Fallback to continuations array
        if let Some(token) = renderer
            .pointer("/continuations/0/reloadContinuationData/continuation")
            .and_then(|v| v.as_str())
        {
            return Some(token.to_string());
        }
        if let Some(token) = renderer
            .pointer("/continuations/0/invalidationContinuationData/continuation")
            .and_then(|v| v.as_str())
        {
            return Some(token.to_string());
        }
        if let Some(token) = renderer
            .pointer("/continuations/0/timedContinuationData/continuation")
            .and_then(|v| v.as_str())
        {
            return Some(token.to_string());
        }
    }

    None
}

pub fn extract_innertube_api_key(html: &str) -> Option<String> {
    let api_key_re = Regex::new(r#""INNERTUBE_API_KEY":"([^"]+)""#).ok()?;
    api_key_re
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

pub fn extract_yt_initial_data(html: &str) -> Option<Value> {
    let json_start_marker = if let Some(pos) = html.find(r#"window["ytInitialData"] = "#) {
        pos + r#"window["ytInitialData"] = "#.len()
    } else if let Some(pos) = html.find("var ytInitialData = ") {
        pos + "var ytInitialData = ".len()
    } else if let Some(pos) = html.find("ytInitialData = ") {
        pos + "ytInitialData = ".len()
    } else {
        return None;
    };

    let remaining = &html[json_start_marker..];
    let mut end_idx = remaining.len();
    if let Some(pos) = remaining.find(";</script>") {
        end_idx = pos;
    } else if let Some(pos) = remaining.find("</script>") {
        end_idx = pos;
    } else if let Some(pos) = remaining.find(";\n") {
        end_idx = pos;
    } else if let Some(pos) = remaining.find(';') {
        end_idx = pos;
    }

    let json_str = remaining[..end_idx].trim();
    serde_json::from_str(json_str).ok()
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParsedChatAction {
    pub msg_id: String,
    pub author_name: String,
    pub author_id: Option<String>,
    pub author_avatar: Option<String>,
    pub text: String,
}

pub fn parse_chat_action(action: &Value) -> Option<ParsedChatAction> {
    let text_renderer = action.pointer("/addChatItemAction/item/liveChatTextMessageRenderer");
    let paid_renderer = action.pointer("/addChatItemAction/item/liveChatPaidMessageRenderer");

    if let Some(renderer) = text_renderer {
        let msg_id = renderer.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let author_name = renderer
            .pointer("/authorName/simpleText")
            .and_then(|v| v.as_str())
            .unwrap_or("Anonymous")
            .to_string();
        let author_id = renderer
            .get("authorExternalChannelId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let author_avatar = renderer
            .pointer("/authorPhoto/thumbnails/0/url")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.starts_with("//") {
                    format!("https:{}", s)
                } else {
                    s.to_string()
                }
            });

        let mut text = String::new();
        if let Some(runs) = renderer.pointer("/message/runs").and_then(|v| v.as_array()) {
            for r in runs {
                if let Some(t) = r.get("text").and_then(|v| v.as_str()) {
                    text.push_str(t);
                } else if let Some(e) = r.pointer("/emoji/shortcuts/0").and_then(|v| v.as_str()) {
                    text.push_str(e);
                }
            }
        }

        let trimmed_text = text.trim();
        if trimmed_text.is_empty() {
            return None;
        }

        return Some(ParsedChatAction {
            msg_id,
            author_name,
            author_id,
            author_avatar,
            text: trimmed_text.to_string(),
        });
    }

    if let Some(renderer) = paid_renderer {
        let msg_id = renderer.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let author_name = renderer
            .pointer("/authorName/simpleText")
            .and_then(|v| v.as_str())
            .unwrap_or("Anonymous")
            .to_string();
        let author_id = renderer
            .get("authorExternalChannelId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let author_avatar = renderer
            .pointer("/authorPhoto/thumbnails/0/url")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.starts_with("//") {
                    format!("https:{}", s)
                } else {
                    s.to_string()
                }
            });

        let purchase_amount = renderer
            .pointer("/purchaseAmountText/simpleText")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        let mut user_text = String::new();
        if let Some(runs) = renderer.pointer("/message/runs").and_then(|v| v.as_array()) {
            for r in runs {
                if let Some(t) = r.get("text").and_then(|v| v.as_str()) {
                    user_text.push_str(t);
                } else if let Some(e) = r.pointer("/emoji/shortcuts/0").and_then(|v| v.as_str()) {
                    user_text.push_str(e);
                }
            }
        }
        let trimmed_user_text = user_text.trim();

        let final_text = match (!purchase_amount.is_empty(), !trimmed_user_text.is_empty()) {
            (true, true) => format!("Super Chat ({}): {}", purchase_amount, trimmed_user_text),
            (true, false) => format!("Super Chat: {}", purchase_amount),
            (false, true) => trimmed_user_text.to_string(),
            (false, false) => return None,
        };

        return Some(ParsedChatAction {
            msg_id,
            author_name,
            author_id,
            author_avatar,
            text: final_text,
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_video_id_from_html() {
        let canonical_html = r#"<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></head></html>"#;
        assert_eq!(extract_video_id_from_html(canonical_html).as_deref(), Some("dQw4w9WgXcQ"));

        let json_html = r#"<html><script>var x = {"videoId":"abcdefghijk"};</script></html>"#;
        assert_eq!(extract_video_id_from_html(json_html).as_deref(), Some("abcdefghijk"));
    }

    #[test]
    fn test_extract_continuation_token_live_mode() {
        let payload = json!({
            "contents": {
                "liveChatRenderer": {
                    "continuations": [
                        {
                            "reloadContinuationData": {
                                "continuation": "TOP_CONTINUATION_TOKEN"
                            }
                        }
                    ],
                    "header": {
                        "liveChatHeaderRenderer": {
                            "viewSelector": {
                                "sortFilterSubMenuRenderer": {
                                    "subMenuItems": [
                                        {
                                            "title": "Top chat",
                                            "selected": true,
                                            "continuation": {
                                                "reloadContinuationData": {
                                                    "continuation": "TOP_CONTINUATION_TOKEN"
                                                }
                                            }
                                        },
                                        {
                                            "title": "Live chat",
                                            "selected": false,
                                            "continuation": {
                                                "reloadContinuationData": {
                                                    "continuation": "LIVE_ALL_CHAT_TOKEN_123"
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        });

        // "live" mode should return the Live chat token
        let token = extract_continuation_token(&payload, "live");
        assert_eq!(token.as_deref(), Some("LIVE_ALL_CHAT_TOKEN_123"));

        // Default or empty should also default to "live"
        let token_default = extract_continuation_token(&payload, "");
        assert_eq!(token_default.as_deref(), Some("LIVE_ALL_CHAT_TOKEN_123"));
    }

    #[test]
    fn test_extract_continuation_token_top_mode() {
        let payload = json!({
            "contents": {
                "liveChatRenderer": {
                    "header": {
                        "liveChatHeaderRenderer": {
                            "viewSelector": {
                                "sortFilterSubMenuRenderer": {
                                    "subMenuItems": [
                                        {
                                            "title": "Top chat",
                                            "selected": true,
                                            "continuation": {
                                                "reloadContinuationData": {
                                                    "continuation": "TOP_TOKEN_999"
                                                }
                                            }
                                        },
                                        {
                                            "title": "Live chat",
                                            "selected": false,
                                            "continuation": {
                                                "reloadContinuationData": {
                                                    "continuation": "LIVE_TOKEN_888"
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        });

        let token = extract_continuation_token(&payload, "top");
        assert_eq!(token.as_deref(), Some("TOP_TOKEN_999"));
    }

    #[test]
    fn test_extract_continuation_token_fallback_when_submenu_missing() {
        let payload = json!({
            "contents": {
                "liveChatRenderer": {
                    "continuations": [
                        {
                            "reloadContinuationData": {
                                "continuation": "FALLBACK_CONTINUATION_TOKEN"
                            }
                        }
                    ]
                }
            }
        });

        let token = extract_continuation_token(&payload, "live");
        assert_eq!(token.as_deref(), Some("FALLBACK_CONTINUATION_TOKEN"));
    }

    #[test]
    fn test_extract_innertube_api_key_from_html() {
        let html = r#"<!DOCTYPE html><html><script>var x = {"INNERTUBE_API_KEY":"AIzaSyD_TEST_KEY_456"};</script></html>"#;
        assert_eq!(extract_innertube_api_key(html).as_deref(), Some("AIzaSyD_TEST_KEY_456"));
    }

    #[test]
    fn test_extract_yt_initial_data_json() {
        let html = r#"<!DOCTYPE html><html><script>window["ytInitialData"] = {"testKey":"testValue"};</script></html>"#;
        let data = extract_yt_initial_data(html).expect("must parse ytInitialData");
        assert_eq!(data["testKey"], "testValue");
    }

    #[test]
    fn test_parse_chat_action_text_and_super_chat() {
        // 1. Text message
        let text_action = json!({
            "addChatItemAction": {
                "item": {
                    "liveChatTextMessageRenderer": {
                        "id": "msg-1",
                        "authorName": { "simpleText": "Chatter1" },
                        "authorExternalChannelId": "channel-1",
                        "authorPhoto": { "thumbnails": [{ "url": "https://example.com/avatar.png" }] },
                        "message": {
                            "runs": [
                                { "text": "Hello " },
                                { "text": "world!" }
                            ]
                        }
                    }
                }
            }
        });

        let parsed_text = parse_chat_action(&text_action).expect("should parse text message");
        assert_eq!(parsed_text.msg_id, "msg-1");
        assert_eq!(parsed_text.author_name, "Chatter1");
        assert_eq!(parsed_text.author_id.as_deref(), Some("channel-1"));
        assert_eq!(parsed_text.text, "Hello world!");

        // 2. Paid Super Chat
        let super_chat_action = json!({
            "addChatItemAction": {
                "item": {
                    "liveChatPaidMessageRenderer": {
                        "id": "paid-1",
                        "authorName": { "simpleText": "SuperDonor" },
                        "authorExternalChannelId": "channel-donor",
                        "purchaseAmountText": { "simpleText": "₹500" },
                        "message": {
                            "runs": [
                                { "text": "Keep up the awesome streams!" }
                            ]
                        }
                    }
                }
            }
        });

        let parsed_paid = parse_chat_action(&super_chat_action).expect("should parse paid Super Chat");
        assert_eq!(parsed_paid.msg_id, "paid-1");
        assert_eq!(parsed_paid.author_name, "SuperDonor");
        assert_eq!(parsed_paid.text, "Super Chat (₹500): Keep up the awesome streams!");
    }
}


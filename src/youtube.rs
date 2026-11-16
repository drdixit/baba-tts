use crate::colors::get_deterministic_color;
use crate::db::Db;
use crate::spam_filter::SpamFilter;
use crate::tts_queue::{TtsHandle, WsBroadcastMessage};
use crate::types::{ChatMessage, MessageStatus};
use anyhow::{Context, Result};
use regex::Regex;
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
        let poller = Self {
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
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
                .poll_stream_session(&settings.youtube_channel_id, settings.youtube_live_id.as_deref())
                .await
            {
                Ok(_) => {
                    info!("[YouTube] Live stream ended or completed. Waiting 60s before re-checking...");
                    if !self.stop_signal.load(Ordering::Relaxed) {
                        self.tts_handle.clear_pending_queue().await;
                    }
                    Duration::from_secs(60)
                }
                Err(err) => {
                    warn!("[YouTube] Polling error: {}. Retrying in 30s...", err);
                    Duration::from_secs(30)
                }
            };

            sleep(retry_delay).await;
        }
    }

    async fn poll_stream_session(&self, channel_id: &str, live_id_override: Option<&str>) -> Result<()> {
        let live_url = if let Some(live_id) = live_id_override {
            format!("https://www.youtube.com/watch?v={}", live_id)
        } else if !channel_id.is_empty() {
            format!("https://www.youtube.com/channel/{}/live", channel_id)
        } else {
            "https://www.youtube.com/@baba%E0%A4%9C%E0%A5%80/live".to_string()
        };

        info!("[YouTube] Fetching page: {}", live_url);
        let resp = self.client.get(&live_url).send().await?.text().await?;

        // 1. Extract INNERTUBE_API_KEY
        let api_key_re = Regex::new(r#""INNERTUBE_API_KEY":"([^"]+)""#)?;
        let api_key = api_key_re
            .captures(&resp)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .context("Could not find INNERTUBE_API_KEY on live page")?;

        // 2. Extract initial continuation token
        let cont_re = Regex::new(r#""continuation":"([^"]+)""#)?;
        let mut continuation = cont_re
            .captures(&resp)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .context("Live stream is not currently active (no continuation found)")?;

        info!("[YouTube] Connected to live stream! Starting chat poll loop...");

        let themes = ["subtitle-sweep", "subtitle-karaoke", "subtitle-words", "pro-clean"];
        let mut theme_index = 0;

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
                    let Some(renderer) = act.pointer("/addChatItemAction/item/liveChatTextMessageRenderer") else {
                        continue;
                    };

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

                    // Check banned
                    if let Some(ref aid) = author_id {
                        if self.db.is_user_banned(aid) {
                            continue;
                        }
                    }

                    // Extract message text from runs
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
                        continue;
                    }

                    // Spam filter check
                    let user_key = author_id.as_deref().unwrap_or(&author_name);
                    let spam_check = self.spam_filter.is_spam(user_key, trimmed_text);
                    if spam_check.is_spam {
                        info!(
                            "[Spam Filter] Blocked message from {}: {:?}",
                            author_name, spam_check.reason
                        );
                        continue;
                    }

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

                    let theme = themes[theme_index % themes.len()].to_string();
                    theme_index += 1;

                    let author_color = get_deterministic_color(&author_name).to_string();

                    let chat_msg = ChatMessage {
                        message_id: if msg_id.is_empty() {
                            format!("msg-{}", uuid::Uuid::new_v4())
                        } else {
                            msg_id
                        },
                        author_name,
                        author_id,
                        author_profile_image_url: author_avatar,
                        author_color: Some(author_color),
                        text: trimmed_text.to_string(),
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

            // Next continuation token
            if let Some(next_cont) = json
                .pointer("/continuationContents/liveChatContinuation/continuations/0/invalidationContinuationData/continuation")
                .or_else(|| json.pointer("/continuationContents/liveChatContinuation/continuations/0/timedContinuationData/continuation"))
                .and_then(|v| v.as_str())
            {
                continuation = next_cont.to_string();
            } else {
                warn!("[YouTube] Stream continuation ended");
                break;
            }

            // Delay between polls (default ~3 seconds)
            sleep(Duration::from_millis(3500)).await;
        }

        Ok(())
    }
}

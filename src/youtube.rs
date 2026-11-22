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
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use tokio::time::sleep;
use tracing::{info, warn};

pub const DEFAULT_SEEN_CACHE_CAPACITY: usize = 4096;
pub const SUPERCHAT_GRACE_WINDOW_USEC: u64 = 60_000_000; // 60 seconds

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

pub struct YouTubePoller {
    client: Client,
    db: Db,
    spam_filter: SpamFilter,
    tts_handle: TtsHandle,
    broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    stop_signal: Arc<AtomicBool>,
    seen_messages: Arc<Mutex<SeenMessageCache>>,
    active_video_id: Arc<Mutex<Option<String>>>,
    active_watermark_usec: Arc<AtomicU64>,
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
            seen_messages: Arc::new(Mutex::new(SeenMessageCache::new(DEFAULT_SEEN_CACHE_CAPACITY))),
            active_video_id: Arc::new(Mutex::new(None)),
            active_watermark_usec: Arc::new(AtomicU64::new(0)),
        };
        (poller, stop_signal)
    }

    pub fn start(self) {
        tokio::spawn(async move {
            self.run_loop().await;
        });
    }

    async fn run_loop(&self) {
        let mut offline_attempts: u32 = 0;
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
                offline_attempts = 0;
                *self.active_video_id.lock().unwrap() = None;
                self.active_watermark_usec.store(0, Ordering::SeqCst);
                self.seen_messages.lock().unwrap().clear();
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
                    offline_attempts = 0;
                    info!("[YouTube] Live stream ended or disconnected. Waiting 30s before re-checking...");
                    // Preserving existing queued chat messages so in-flight TTS isn't abruptly wiped out
                    Duration::from_secs(30)
                }
                Err(err) => {
                    offline_attempts = offline_attempts.saturating_add(1);
                    let secs = match offline_attempts {
                        1 => 30,
                        2 => 60,
                        _ => 120,
                    };
                    warn!(
                        "[YouTube] Polling error: {}. Retrying in {}s (attempt {})...",
                        err, secs, offline_attempts
                    );
                    Duration::from_secs(secs)
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

        // Reset watermark and seen cache if targeting a different video stream
        {
            let mut current_vid = self.active_video_id.lock().unwrap();
            if current_vid.as_deref() != Some(&video_id) {
                info!(
                    "[YouTube] Target video ID changed from {:?} to {}. Resetting watermark and seen cache.",
                    *current_vid, video_id
                );
                *current_vid = Some(video_id.clone());
                self.active_watermark_usec.store(0, Ordering::SeqCst);
                self.seen_messages.lock().unwrap().clear();
            }
        }

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
        let mut is_initial_poll = true;

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
                Ok(r) => {
                    if !r.status().is_success() {
                        warn!(
                            "[YouTube] Polling returned HTTP status: {}. Retrying in 5s...",
                            r.status()
                        );
                        sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                    r
                }
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
                let current_watermark = self.active_watermark_usec.load(Ordering::SeqCst);
                let is_cold_start = is_initial_poll && current_watermark == 0;

                // If this is the initial poll of a fresh video session, establish the watermark
                // from the highest timestamp in this backlog batch (or current system time).
                if is_cold_start {
                    let max_batch_time = actions
                        .iter()
                        .filter_map(|act| {
                            let text_time = act
                                .pointer("/addChatItemAction/item/liveChatTextMessageRenderer/timestampUsec")
                                .and_then(|v| {
                                    v.as_str()
                                        .and_then(|s| s.parse::<u64>().ok())
                                        .or_else(|| v.as_u64())
                                });
                            let paid_time = act
                                .pointer("/addChatItemAction/item/liveChatPaidMessageRenderer/timestampUsec")
                                .and_then(|v| {
                                    v.as_str()
                                        .and_then(|s| s.parse::<u64>().ok())
                                        .or_else(|| v.as_u64())
                                });
                            text_time.or(paid_time)
                        })
                        .max()
                        .unwrap_or(0);

                    let now_usec = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_micros() as u64;

                    let initial_watermark = if max_batch_time > 0 {
                        max_batch_time
                    } else {
                        now_usec
                    };

                    self.active_watermark_usec.store(initial_watermark, Ordering::SeqCst);
                    info!(
                        "[YouTube] Established initial chat watermark at {} usec across {} actions",
                        initial_watermark,
                        actions.len()
                    );
                }

                let watermark = self.active_watermark_usec.load(Ordering::SeqCst);
                let mut new_messages = Vec::new();

                for act in actions {
                    let Some(parsed) = parse_chat_action(act) else {
                        continue;
                    };

                    // Deduplication via seen_messages cache
                    let is_new_id = {
                        let mut seen = self.seen_messages.lock().unwrap();
                        seen.insert(parsed.msg_id.clone())
                    };
                    if !is_new_id {
                        continue;
                    }

                    // Check banned
                    if let Some(ref aid) = parsed.author_id {
                        if self.db.is_user_banned(aid) {
                            continue;
                        }
                    }

                    // Spam filter check (exempt paid superchats)
                    if !parsed.is_superchat {
                        let user_key = parsed.author_id.as_deref().unwrap_or(&parsed.author_name);
                        let spam_check = self.spam_filter.is_spam(user_key, &parsed.text);
                        if spam_check.is_spam {
                            info!(
                                "[Spam Filter] Blocked message from {}: {:?}",
                                parsed.author_name, spam_check.reason
                            );
                            continue;
                        }
                    }

                    let status = classify_message(
                        parsed.timestamp_usec,
                        parsed.is_superchat,
                        is_initial_poll,
                        is_cold_start,
                        watermark,
                    );

                    // Advance watermark for genuinely newer messages
                    if parsed.timestamp_usec > watermark {
                        self.active_watermark_usec
                            .fetch_max(parsed.timestamp_usec, Ordering::SeqCst);
                    }

                    let theme = themes[theme_index % themes.len()].to_string();
                    theme_index += 1;

                    let author_color = get_deterministic_color(&parsed.author_name).to_string();

                    let is_superchat = parsed.is_superchat;
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
                        status,
                        theme: Some(theme),
                        word_boundaries: None,
                        is_superchat: Some(is_superchat),
                    };

                    new_messages.push(chat_msg);
                }

                if !new_messages.is_empty() {
                    let _ = self
                        .broadcast_tx
                        .send(WsBroadcastMessage::Messages(new_messages.clone()));

                    for m in new_messages {
                        if m.status == MessageStatus::Queued {
                            if m.is_superchat.unwrap_or(false) {
                                self.tts_handle.enqueue_priority(m).await;
                            } else {
                                self.tts_handle.enqueue(m).await;
                            }
                        }
                    }
                }

                is_initial_poll = false;
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
    } else {
        let pos = html.find("ytInitialData = ")?;
        pos + "ytInitialData = ".len()
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
    pub is_superchat: bool,
    pub timestamp_usec: u64,
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

        let timestamp_usec = renderer
            .get("timestampUsec")
            .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()))
            .unwrap_or(0);

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
            is_superchat: false,
            timestamp_usec,
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

        let timestamp_usec = renderer
            .get("timestampUsec")
            .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()))
            .unwrap_or(0);

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
            is_superchat: true,
            timestamp_usec,
        });
    }

    None
}

/// Pure classification function to determine whether a message should be queued for TTS speech
/// or tagged as historical backlog.
///
/// Rules:
/// 1. Cold start (`is_cold_start == true`):
///    - Messages with timestamp <= watermark are historical (`MessageStatus::Default`).
///    - Paid Superchats within the 60s grace window (`timestamp + 60s >= watermark`) are queued (`MessageStatus::Queued`).
/// 2. Reconnect (`is_initial_poll == true && is_cold_start == false`):
///    - Backlog messages with timestamp <= watermark are historical (`MessageStatus::Default`).
///    - Genuine new messages with timestamp > watermark are queued (`MessageStatus::Queued`).
/// 3. Live streaming polls (`is_initial_poll == false`):
///    - All unseen messages delivered in live continuation batches are active (`MessageStatus::Queued`).
pub fn classify_message(
    timestamp_usec: u64,
    is_superchat: bool,
    is_initial_poll: bool,
    is_cold_start: bool,
    watermark: u64,
) -> MessageStatus {
    if is_initial_poll {
        if is_cold_start {
            if is_superchat
                && timestamp_usec > 0
                && timestamp_usec.saturating_add(SUPERCHAT_GRACE_WINDOW_USEC) >= watermark
            {
                MessageStatus::Queued
            } else if timestamp_usec > 0 && timestamp_usec <= watermark {
                MessageStatus::Default
            } else if timestamp_usec > watermark {
                MessageStatus::Queued
            } else {
                MessageStatus::Default
            }
        } else {
            // Reconnect to an active stream session with an established watermark
            if timestamp_usec > 0 && timestamp_usec <= watermark {
                MessageStatus::Default
            } else {
                MessageStatus::Queued
            }
        }
    } else {
        // Subsequent polls: live events from timed/invalidation continuations are active
        MessageStatus::Queued
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_seen_message_cache() {
        let mut cache = SeenMessageCache::new(3);
        assert!(cache.insert("msg-1".to_string()));
        assert!(!cache.insert("msg-1".to_string())); // duplicate
        assert!(cache.contains("msg-1"));

        assert!(cache.insert("msg-2".to_string()));
        assert!(cache.insert("msg-3".to_string()));
        assert!(cache.contains("msg-1"));
        assert!(cache.contains("msg-2"));
        assert!(cache.contains("msg-3"));

        // Capacity is 3, inserting 4th item should evict msg-1
        assert!(cache.insert("msg-4".to_string()));
        assert!(!cache.contains("msg-1"));
        assert!(cache.contains("msg-2"));
        assert!(cache.contains("msg-3"));
        assert!(cache.contains("msg-4"));

        // Clear cache
        cache.clear();
        assert!(!cache.contains("msg-2"));
        assert!(cache.insert("msg-2".to_string()));
    }

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
                        "timestampUsec": "1710000000000000",
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
        assert_eq!(parsed_text.timestamp_usec, 1710000000000000);
        assert!(!parsed_text.is_superchat);

        // 2. Paid Super Chat
        let super_chat_action = json!({
            "addChatItemAction": {
                "item": {
                    "liveChatPaidMessageRenderer": {
                        "id": "paid-1",
                        "authorName": { "simpleText": "SuperDonor" },
                        "authorExternalChannelId": "channel-donor",
                        "timestampUsec": "1710000005000000",
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
        assert_eq!(parsed_paid.timestamp_usec, 1710000005000000);
        assert!(parsed_paid.is_superchat);
    }

    #[test]
    fn test_classify_message_cold_start_backlog_suppressed() {
        let watermark = 1_000_000_000_000;
        // Normal chat message older than or equal to watermark is historical
        let status = classify_message(watermark - 5_000_000, false, true, true, watermark);
        assert_eq!(status, MessageStatus::Default);

        let status_equal = classify_message(watermark, false, true, true, watermark);
        assert_eq!(status_equal, MessageStatus::Default);

        // Normal chat message newer than watermark in initial batch is queued
        let status_new = classify_message(watermark + 1_000_000, false, true, true, watermark);
        assert_eq!(status_new, MessageStatus::Queued);
    }

    #[test]
    fn test_classify_message_cold_start_superchat_grace_window() {
        let watermark = 1_000_000_000_000;
        // Superchat within 60s (SUPERCHAT_GRACE_WINDOW_USEC = 60_000_000) is queued
        let recent_ts = watermark - 30_000_000; // 30s ago
        let status = classify_message(recent_ts, true, true, true, watermark);
        assert_eq!(status, MessageStatus::Queued);

        // Superchat older than 60s is historical
        let old_ts = watermark - 61_000_000; // 61s ago
        let old_status = classify_message(old_ts, true, true, true, watermark);
        assert_eq!(old_status, MessageStatus::Default);
    }

    #[test]
    fn test_classify_message_reconnect() {
        let watermark = 1_000_000_000_000;
        // On reconnect (is_initial_poll: true, is_cold_start: false)
        // Message with timestamp <= watermark is historical
        let old_status = classify_message(watermark - 10_000_000, false, true, false, watermark);
        assert_eq!(old_status, MessageStatus::Default);

        // New message arrived during disconnect (timestamp > watermark) is queued
        let new_status = classify_message(watermark + 2_000_000, false, true, false, watermark);
        assert_eq!(new_status, MessageStatus::Queued);
    }

    #[test]
    fn test_classify_message_live_subsequent_poll() {
        let watermark = 1_000_000_000_000;
        // Live polling (is_initial_poll: false) always queues unseen messages
        let live_status = classify_message(watermark + 100_000, false, false, false, watermark);
        assert_eq!(live_status, MessageStatus::Queued);

        // Even with millisecond network timestamp jitter, live poll messages are queued
        let jitter_status = classify_message(watermark - 50_000, false, false, false, watermark);
        assert_eq!(jitter_status, MessageStatus::Queued);
    }
}


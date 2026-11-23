use crate::colors::get_deterministic_color;
use crate::db::Db;
use crate::meta_client::MetaClient;
use crate::spam_filter::SpamFilter;
use crate::tts_queue::{TtsHandle, WsBroadcastMessage};
use crate::types::{ChatMessage, MessageStatus, SeenMessageCache, DEFAULT_SEEN_CACHE_CAPACITY};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use tokio::time::sleep;
use tracing::{debug, info, warn};

pub struct FacebookPoller {
    meta_client: MetaClient,
    db: Db,
    spam_filter: SpamFilter,
    tts_handle: TtsHandle,
    broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    stop_signal: Arc<AtomicBool>,
    seen_messages: Arc<Mutex<SeenMessageCache>>,
    active_video_id: Arc<Mutex<Option<String>>>,
    active_watermark_usec: Arc<AtomicU64>,
}

impl FacebookPoller {
    pub fn new(
        db: Db,
        spam_filter: SpamFilter,
        tts_handle: TtsHandle,
        broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    ) -> (Self, Arc<AtomicBool>) {
        let stop_signal = Arc::new(AtomicBool::new(false));
        (
            Self {
                meta_client: MetaClient::new(),
                db,
                spam_filter,
                tts_handle,
                broadcast_tx,
                stop_signal: stop_signal.clone(),
                seen_messages: Arc::new(Mutex::new(SeenMessageCache::new(DEFAULT_SEEN_CACHE_CAPACITY))),
                active_video_id: Arc::new(Mutex::new(None)),
                active_watermark_usec: Arc::new(AtomicU64::new(0)),
            },
            stop_signal,
        )
    }

    pub fn start(self) {
        tokio::spawn(async move {
            info!("[FacebookPoller] Starting Facebook Live polling worker...");

            let themes = [
                "subtitle-sweep",
                "subtitle-karaoke",
                "subtitle-words",
                "pro-clean",
            ];
            let mut theme_index = 0usize;

            while !self.stop_signal.load(Ordering::Relaxed) {
                let settings = match self.db.load_settings() {
                    Ok(s) => s,
                    Err(e) => {
                        warn!("[FacebookPoller] Failed to load settings: {}", e);
                        sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                };

                if !settings.enable_facebook {
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }

                let token = settings.facebook_access_token.trim().to_string();
                if token.is_empty() {
                    debug!("[FacebookPoller] Facebook enabled but access token is empty, waiting...");
                    sleep(Duration::from_secs(10)).await;
                    continue;
                }

                let target_id = settings.facebook_target_id.trim().to_string();

                // 1. Resolve active live video ID
                let resolved_video_id = if let Some(ref manual_id) = settings.facebook_live_id {
                    let trimmed = manual_id.trim();
                    if !trimmed.is_empty() {
                        Some(trimmed.to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let video_id = match resolved_video_id {
                    Some(id) => id,
                    None => {
                        // Auto-discover live video
                        match self.meta_client.get_facebook_live_video(&token, &target_id).await {
                            Ok((Some(live_id), _)) => {
                                info!("[FacebookPoller] Discovered active Facebook Live video: {}", live_id);
                                live_id
                            }
                            Ok((None, _)) => {
                                debug!("[FacebookPoller] No active Facebook Live video found for {}, sleeping...", target_id);
                                sleep(Duration::from_secs(20)).await;
                                continue;
                            }
                            Err(e) => {
                                let err_str = e.to_string();
                                if err_str.contains("OAuthException") || err_str.contains("Code 190") {
                                    warn!("[FacebookPoller] Token invalid or expired: {}", err_str);
                                    let _ = self.broadcast_tx.send(WsBroadcastMessage::PlatformStatus {
                                        platform: "facebook".to_string(),
                                        status: "token_expired".to_string(),
                                        message: "Facebook access token expired or invalid. Please update it in Settings.".to_string(),
                                    });
                                    sleep(Duration::from_secs(60)).await;
                                } else {
                                    warn!("[FacebookPoller] Error discovering live video: {}", err_str);
                                    sleep(Duration::from_secs(15)).await;
                                }
                                continue;
                            }
                        }
                    }
                };

                // Check for stream session transition
                let is_new_stream = {
                    let mut current = self.active_video_id.lock().unwrap();
                    if current.as_deref() != Some(&video_id) {
                        *current = Some(video_id.clone());
                        true
                    } else {
                        false
                    }
                };

                if is_new_stream {
                    info!("[FacebookPoller] Binding to Facebook Live stream: {}", video_id);
                    self.seen_messages.lock().unwrap().clear();
                    self.active_watermark_usec.store(0, Ordering::SeqCst);
                }

                // 2. Fetch comments with optional since query parameter
                let current_watermark = self.active_watermark_usec.load(Ordering::SeqCst);
                let since_sec = if current_watermark > 0 {
                    Some((current_watermark / 1_000_000).saturating_sub(5))
                } else {
                    None
                };

                let (comments, usage) = match self.meta_client.get_facebook_comments(&token, &video_id, since_sec).await {
                    Ok(res) => res,
                    Err(e) => {
                        let err_str = e.to_string();
                        if err_str.contains("OAuthException") || err_str.contains("Code 190") {
                            warn!("[FacebookPoller] Token expired during comment polling: {}", err_str);
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::PlatformStatus {
                                platform: "facebook".to_string(),
                                status: "token_expired".to_string(),
                                message: "Facebook access token expired. Please update it in Settings.".to_string(),
                            });
                            sleep(Duration::from_secs(60)).await;
                        } else {
                            warn!("[FacebookPoller] Error polling comments for {}: {}", video_id, err_str);
                            sleep(Duration::from_secs(10)).await;
                        }
                        continue;
                    }
                };

                // 3. Process comments through watermark and SeenMessageCache
                let now_usec = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_micros() as u64)
                    .unwrap_or(0);

                let is_cold_start = current_watermark == 0;
                let mut max_batch_time = 0u64;

                for c in &comments {
                    let ts = c.timestamp_usec();
                    if ts > max_batch_time {
                        max_batch_time = ts;
                    }
                }

                let effective_watermark = if is_cold_start {
                    let initial_wm = max_batch_time.max(now_usec);
                    self.active_watermark_usec.store(initial_wm, Ordering::SeqCst);
                    initial_wm
                } else {
                    current_watermark
                };

                let mut new_messages: Vec<ChatMessage> = Vec::new();

                for c in comments.into_iter().rev() {
                    let msg_id = c.id.clone();
                    if msg_id.is_empty() {
                        continue;
                    }

                    let is_new = self.seen_messages.lock().unwrap().insert(msg_id.clone());
                    if !is_new {
                        continue;
                    }

                    let ts = c.timestamp_usec();
                    let author = c.author_name();
                    let author_id = c.author_id().unwrap_or_else(|| author.to_lowercase());

                    if self.db.is_user_banned(&author_id) {
                        debug!("[FacebookPoller] Skipping banned user message from: {}", author);
                        continue;
                    }

                    let text = c.text_content();
                    if self.spam_filter.is_spam(&author_id, &text).is_spam {
                        debug!("[FacebookPoller] Spam filtered message from: {}", author);
                        continue;
                    }

                    // Classify message: historical cold-start backlog vs live arrival
                    let status = if is_cold_start || (ts > 0 && ts <= effective_watermark) {
                        MessageStatus::Done
                    } else {
                        MessageStatus::Queued
                    };

                    let theme = themes[theme_index % themes.len()].to_string();
                    theme_index += 1;

                    let author_color = get_deterministic_color(&author).to_string();

                    let chat_msg = ChatMessage {
                        message_id: msg_id,
                        author_name: author,
                        author_id: Some(author_id),
                        author_profile_image_url: c.author_avatar(),
                        author_color: Some(author_color),
                        text,
                        status,
                        theme: Some(theme),
                        word_boundaries: None,
                        is_superchat: None,
                        platform: Some("facebook".to_string()),
                    };

                    new_messages.push(chat_msg);
                }

                if !new_messages.is_empty() {
                    let _ = self
                        .broadcast_tx
                        .send(WsBroadcastMessage::Messages(new_messages.clone()));

                    for msg in new_messages {
                        if msg.status == MessageStatus::Queued {
                            self.tts_handle.enqueue(msg).await;
                        }
                    }
                }

                if max_batch_time > 0 {
                    self.active_watermark_usec.fetch_max(max_batch_time, Ordering::SeqCst);
                }

                // 4. Adaptive sleep based on rate limit headers
                let base_cadence = if usage.max_percentage >= 80 {
                    warn!("[FacebookPoller] High Meta API usage detected ({}%), throttling to 10s", usage.max_percentage);
                    Duration::from_millis(10_000)
                } else if usage.max_percentage >= 60 {
                    Duration::from_millis(6_000)
                } else {
                    Duration::from_millis(3_500)
                };

                sleep(base_cadence).await;
            }

            info!("[FacebookPoller] Stopped Facebook Live poller worker.");
        });
    }
}

use crate::azure_tts::AzureTtsClient;
use crate::types::{AppSettings, ChatMessage, WordBoundary};
use std::collections::{HashSet, VecDeque};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::time::sleep;
use tracing::{info, warn};

#[derive(Debug, Clone)]
pub enum WsBroadcastMessage {
    Messages(Vec<ChatMessage>),
    TtsState {
        message_id: String,
        state: String,
    },
    PlayAudio {
        message_id: String,
        audio_data: String,
        word_boundaries: Vec<WordBoundary>,
    },
    KillAudio,
    BannedUsers(Vec<crate::types::BannedUser>),
}

#[derive(Debug)]
pub enum TtsCommand {
    Enqueue(ChatMessage),
    EnqueuePriority(ChatMessage),
    AudioFinished(Option<String>),
    SkipCurrent,
    ClearQueue,
    RemoveUser(String),
    GetCurrentProcessing(oneshot::Sender<Option<ChatMessage>>),
    UpdateSettings(AppSettings),
    SynthesisComplete {
        message_id: String,
        result: Result<crate::azure_tts::SpeechSynthesisResult, String>,
    },
}

#[derive(Clone)]
pub struct TtsHandle {
    sender: mpsc::Sender<TtsCommand>,
}

impl TtsHandle {
    pub async fn enqueue(&self, msg: ChatMessage) {
        let _ = self.sender.send(TtsCommand::Enqueue(msg)).await;
    }

    pub async fn enqueue_priority(&self, msg: ChatMessage) {
        let _ = self.sender.send(TtsCommand::EnqueuePriority(msg)).await;
    }

    pub async fn audio_finished(&self, message_id: Option<String>) {
        let _ = self.sender.send(TtsCommand::AudioFinished(message_id)).await;
    }

    pub async fn skip_current(&self) {
        let _ = self.sender.send(TtsCommand::SkipCurrent).await;
    }

    pub async fn clear_queue(&self) {
        let _ = self.sender.send(TtsCommand::ClearQueue).await;
    }

    pub async fn remove_user(&self, author_id: String) {
        let _ = self.sender.send(TtsCommand::RemoveUser(author_id)).await;
    }

    pub async fn get_current_processing(&self) -> Option<ChatMessage> {
        let (tx, rx) = oneshot::channel();
        if self.sender.send(TtsCommand::GetCurrentProcessing(tx)).await.is_ok() {
            rx.await.unwrap_or(None)
        } else {
            None
        }
    }

    pub async fn update_settings(&self, settings: AppSettings) {
        let _ = self.sender.send(TtsCommand::UpdateSettings(settings)).await;
    }
}

pub struct TtsActor {
    receiver: mpsc::Receiver<TtsCommand>,
    queue: VecDeque<ChatMessage>,
    current: Option<ChatMessage>,
    is_processing: bool,
    broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    settings: AppSettings,
    self_handle: mpsc::Sender<TtsCommand>,
    recent_cache: HashSet<String>,
}

impl TtsActor {
    pub fn spawn(
        broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
        initial_settings: AppSettings,
    ) -> TtsHandle {
        let (tx, rx) = mpsc::channel(100);
        let actor = Self {
            receiver: rx,
            queue: VecDeque::new(),
            current: None,
            is_processing: false,
            broadcast_tx,
            settings: initial_settings,
            self_handle: tx.clone(),
            recent_cache: HashSet::new(),
        };

        tokio::spawn(actor.run());
        TtsHandle { sender: tx }
    }

    async fn run(mut self) {
        while let Some(cmd) = self.receiver.recv().await {
            match cmd {
                TtsCommand::Enqueue(msg) => {
                    let text_lower = msg.text.trim().to_lowercase();
                    if self.recent_cache.contains(&text_lower) {
                        info!("[TTS] Skipping duplicate message: {}", msg.text);
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: msg.message_id.clone(),
                            state: "skipped".to_string(),
                        });
                        continue;
                    }
                    self.recent_cache.insert(text_lower);
                    self.queue.push_back(msg);
                    self.process_next();
                }
                TtsCommand::EnqueuePriority(msg) => {
                    self.queue.push_front(msg);
                    self.process_next();
                }
                TtsCommand::AudioFinished(message_id) => {
                    if let Some(id) = message_id {
                        if let Some(curr) = &self.current {
                            if curr.message_id == id {
                                let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                    message_id: id,
                                    state: "done".to_string(),
                                });
                                self.current = None;
                                self.is_processing = false;
                                self.process_next();
                            }
                        }
                    } else {
                        self.current = None;
                        self.is_processing = false;
                        self.process_next();
                    }
                }
                TtsCommand::SkipCurrent => {
                    if let Some(curr) = self.current.take() {
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: curr.message_id,
                            state: "skipped".to_string(),
                        });
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::KillAudio);
                    }
                    self.is_processing = false;
                    self.process_next();
                }
                TtsCommand::ClearQueue => {
                    for msg in self.queue.drain(..) {
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: msg.message_id,
                            state: "skipped".to_string(),
                        });
                    }
                    if let Some(curr) = self.current.take() {
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: curr.message_id,
                            state: "skipped".to_string(),
                        });
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::KillAudio);
                    }
                    self.is_processing = false;
                }
                TtsCommand::RemoveUser(author_id) => {
                    self.queue.retain(|msg| {
                        if msg.author_id.as_deref() == Some(&author_id) {
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                message_id: msg.message_id.clone(),
                                state: "skipped".to_string(),
                            });
                            false
                        } else {
                            true
                        }
                    });

                    if let Some(curr) = &self.current {
                        if curr.author_id.as_deref() == Some(&author_id) {
                            let id = curr.message_id.clone();
                            self.current = None;
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                message_id: id,
                                state: "skipped".to_string(),
                            });
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::KillAudio);
                            self.is_processing = false;
                            self.process_next();
                        }
                    }
                }
                TtsCommand::GetCurrentProcessing(tx) => {
                    let _ = tx.send(self.current.clone());
                }
                TtsCommand::UpdateSettings(new_settings) => {
                    self.settings = new_settings;
                }
                TtsCommand::SynthesisComplete { message_id, result } => {
                    if let Some(curr) = &self.current {
                        if curr.message_id == message_id {
                            match result {
                                Ok(synthesis) => {
                                    let _ = self.broadcast_tx.send(WsBroadcastMessage::PlayAudio {
                                        message_id: message_id.clone(),
                                        audio_data: synthesis.audio_data_uri,
                                        word_boundaries: synthesis.word_boundaries.clone(),
                                    });

                                    // Dynamic watchdog timer based on audio length
                                    let last_offset = synthesis
                                        .word_boundaries
                                        .last()
                                        .map(|b| b.audio_offset + b.duration)
                                        .unwrap_or(7.0);
                                    let timeout_secs = ((last_offset + 4.0).clamp(5.0, 25.0)) as u64;

                                    let watchdog_id = message_id.clone();
                                    let watchdog_handle = self.self_handle.clone();
                                    tokio::spawn(async move {
                                        sleep(Duration::from_secs(timeout_secs)).await;
                                        warn!("[TTS] Watchdog timeout for message {}. Auto-finishing.", watchdog_id);
                                        let _ = watchdog_handle.send(TtsCommand::AudioFinished(Some(watchdog_id))).await;
                                    });
                                }
                                Err(err) => {
                                    warn!("[TTS] Azure synthesis failed for {}: {}", message_id, err);
                                    let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                        message_id,
                                        state: "error".to_string(),
                                    });
                                    self.current = None;
                                    self.is_processing = false;
                                    self.process_next();
                                }
                            }
                        } else {
                            info!("[TTS] Synthesis finished for {}, but message was cancelled/replaced. Discarding.", message_id);
                        }
                    } else {
                        info!("[TTS] Synthesis finished for {}, but queue was cancelled/cleared. Discarding.", message_id);
                    }
                }
            }
        }
    }

    fn process_next(&mut self) {
        if self.is_processing || self.queue.is_empty() {
            return;
        }

        let Some(msg) = self.queue.pop_front() else {
            return;
        };

        self.is_processing = true;
        self.current = Some(msg.clone());

        info!("[TTS] Processing message {}: {}", msg.message_id, msg.text);
        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
            message_id: msg.message_id.clone(),
            state: "processing".to_string(),
        });

        let key = self.settings.azure_speech_key.clone();
        let region = self.settings.azure_speech_region.clone();
        let voice = if self.settings.azure_speech_voice.trim().is_empty() || self.settings.azure_speech_voice == "default" {
            const HINDI_VOICES: [&str; 3] = ["hi-IN-MadhurNeural", "hi-IN-SwaraNeural", "hi-IN-AnanyaNeural"];
            let idx = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos() as usize)
                % HINDI_VOICES.len();
            HINDI_VOICES[idx].to_string()
        } else {
            self.settings.azure_speech_voice.clone()
        };
        let self_handle = self.self_handle.clone();

        tokio::spawn(async move {
            let client = AzureTtsClient::new(key, region);
            let text_to_speak = format!("{} says {}", msg.author_name, msg.text);

            let res = client.synthesize(&text_to_speak, &voice).await.map_err(|e| e.to_string());
            let _ = self_handle.send(TtsCommand::SynthesisComplete {
                message_id: msg.message_id,
                result: res,
            }).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MessageStatus;

    fn make_test_msg(id: &str, author: &str, text: &str) -> ChatMessage {
        ChatMessage {
            message_id: id.to_string(),
            author_name: author.to_string(),
            author_id: Some(author.to_lowercase()),
            author_profile_image_url: None,
            author_color: None,
            text: text.to_string(),
            status: MessageStatus::Queued,
            theme: None,
            word_boundaries: None,
        }
    }

    #[tokio::test]
    async fn test_tts_queue_priority_and_remove_user() {
        let (broadcast_tx, mut broadcast_rx) = broadcast::channel(100);
        let settings = AppSettings {
            azure_speech_key: String::new(), // synthesis will fail fast and not hang
            ..Default::default()
        };
        let handle = TtsActor::spawn(broadcast_tx, settings);

        // Enqueue regular message
        let msg1 = make_test_msg("m1", "Alice", "Hello from Alice");
        handle.enqueue(msg1).await;

        // Duplicate of Alice's message should be skipped
        let msg1_dup = make_test_msg("m2", "Alice", "Hello from Alice");
        handle.enqueue(msg1_dup).await;

        // Check broadcast received
        let mut got_skipped = false;
        while let Ok(msg) = tokio::time::timeout(Duration::from_millis(100), broadcast_rx.recv()).await {
            if let Ok(WsBroadcastMessage::TtsState { message_id, state }) = msg {
                if message_id == "m2" && state == "skipped" {
                    got_skipped = true;
                    break;
                }
            }
        }
        assert!(got_skipped, "Duplicate message should be marked skipped");

        // Clear queue
        handle.clear_queue().await;
        let current = handle.get_current_processing().await;
        assert!(current.is_none());
    }
}

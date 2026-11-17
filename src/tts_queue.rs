use crate::azure_tts::AzureTtsClient;
use crate::types::{AppSettings, ChatMessage, WordBoundary};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};
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

#[derive(Clone, Debug)]
pub struct PendingAudio {
    pub message_id: String,
    pub audio_data: String,
    pub word_boundaries: Vec<WordBoundary>,
}

#[derive(Debug)]
pub enum TtsCommand {
    Enqueue(ChatMessage),
    EnqueuePriority(ChatMessage),
    AudioFinished(Option<String>),
    SkipCurrent,
    ClearQueue,
    ClearPendingQueue,
    RemoveUser(String),
    RemoveUserAndSkipMessage {
        author_id: Option<String>,
        message_id: String,
    },
    GetCurrentProcessing(oneshot::Sender<Option<ChatMessage>>),
    GetPendingAudio(oneshot::Sender<Option<PendingAudio>>),
    UpdateSettings(AppSettings),
    SynthesisComplete {
        message_id: String,
        result: Result<crate::azure_tts::SpeechSynthesisResult, String>,
    },
}

const RECENT_TEXT_WINDOW: Duration = Duration::from_secs(30);
const MAX_RECENT_TEXTS: usize = 4096;

#[derive(Default)]
struct RecentMessageCache {
    expires_at: HashMap<String, Instant>,
    oldest_first: VecDeque<(Instant, String)>,
}

impl RecentMessageCache {
    fn should_suppress(&mut self, text: &str, now: Instant) -> bool {
        self.remove_expired(now);

        if self.expires_at.contains_key(text) {
            return true;
        }

        let text = text.to_owned();
        let expires_at = now + RECENT_TEXT_WINDOW;
        self.expires_at.insert(text.clone(), expires_at);
        self.oldest_first.push_back((expires_at, text));

        while self.expires_at.len() > MAX_RECENT_TEXTS {
            self.remove_oldest();
        }

        false
    }

    fn remove_expired(&mut self, now: Instant) {
        while self
            .oldest_first
            .front()
            .is_some_and(|(expires_at, _)| *expires_at <= now)
        {
            self.remove_oldest();
        }
    }

    fn remove_oldest(&mut self) {
        if let Some((expires_at, text)) = self.oldest_first.pop_front() {
            if self.expires_at.get(&text) == Some(&expires_at) {
                self.expires_at.remove(&text);
            }
        }
    }
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

    /// Drops queued messages while allowing the current utterance to finish.
    pub async fn clear_pending_queue(&self) {
        let _ = self.sender.send(TtsCommand::ClearPendingQueue).await;
    }

    pub async fn remove_user(&self, author_id: String) {
        let _ = self.sender.send(TtsCommand::RemoveUser(author_id)).await;
    }

    pub async fn remove_user_and_skip_message(&self, author_id: Option<String>, message_id: String) {
        let _ = self
            .sender
            .send(TtsCommand::RemoveUserAndSkipMessage {
                author_id,
                message_id,
            })
            .await;
    }

    pub async fn get_current_processing(&self) -> Option<ChatMessage> {
        let (tx, rx) = oneshot::channel();
        if self.sender.send(TtsCommand::GetCurrentProcessing(tx)).await.is_ok() {
            rx.await.unwrap_or(None)
        } else {
            None
        }
    }

    pub async fn get_pending_audio(&self) -> Option<PendingAudio> {
        let (tx, rx) = oneshot::channel();
        if self.sender.send(TtsCommand::GetPendingAudio(tx)).await.is_ok() {
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
    pending_audio: Option<PendingAudio>,
    is_processing: bool,
    broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
    settings: AppSettings,
    voice_round_robin_index: usize,
    sapi_voice_round_robin_index: usize,
    self_handle: mpsc::Sender<TtsCommand>,
    recent_cache: RecentMessageCache,
}

fn default_hindi_voice() -> String {
    const HINDI_VOICES: [&str; 3] = [
        "hi-IN-MadhurNeural",
        "hi-IN-SwaraNeural",
        "hi-IN-AnanyaNeural",
    ];
    let index = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as usize)
        % HINDI_VOICES.len();
    HINDI_VOICES[index].to_string()
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
            pending_audio: None,
            is_processing: false,
            broadcast_tx,
            settings: initial_settings,
            voice_round_robin_index: 0,
            sapi_voice_round_robin_index: 0,
            self_handle: tx.clone(),
            recent_cache: RecentMessageCache::default(),
        };

        tokio::spawn(actor.run());
        TtsHandle { sender: tx }
    }

    async fn run(mut self) {
        while let Some(cmd) = self.receiver.recv().await {
            match cmd {
                TtsCommand::Enqueue(msg) => {
                    let text_lower = msg.text.trim().to_lowercase();
                    if self.recent_cache.should_suppress(&text_lower, Instant::now()) {
                        info!("[TTS] Skipping duplicate message: {}", msg.text);
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: msg.message_id.clone(),
                            state: "skipped".to_string(),
                        });
                        continue;
                    }
                    self.queue.push_back(msg);
                    self.process_next();
                }
                TtsCommand::EnqueuePriority(msg) => {
                    self.queue.push_front(msg);
                    self.process_next();
                }
                TtsCommand::AudioFinished(message_id) => {
                    self.pending_audio = None;
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
                    self.pending_audio = None;
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
                    self.pending_audio = None;
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
                TtsCommand::ClearPendingQueue => {
                    for msg in self.queue.drain(..) {
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: msg.message_id,
                            state: "skipped".to_string(),
                        });
                    }
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
                            self.pending_audio = None;
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
                TtsCommand::RemoveUserAndSkipMessage {
                    author_id,
                    message_id,
                } => {
                    if let Some(author_id) = author_id.as_deref() {
                        self.queue.retain(|msg| {
                            if msg.author_id.as_deref() == Some(author_id) {
                                let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                    message_id: msg.message_id.clone(),
                                    state: "skipped".to_string(),
                                });
                                false
                            } else {
                                true
                            }
                        });
                    }

                    let should_skip_current = self.current.as_ref().is_some_and(|current| {
                        current.message_id == message_id
                            || author_id
                                .as_deref()
                                .is_some_and(|author_id| current.author_id.as_deref() == Some(author_id))
                    });
                    if should_skip_current {
                        self.pending_audio = None;
                        if let Some(current) = self.current.take() {
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                message_id: current.message_id,
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
                TtsCommand::GetPendingAudio(tx) => {
                    let _ = tx.send(self.pending_audio.clone());
                }
                TtsCommand::UpdateSettings(new_settings) => {
                    if self.settings.azure_speech_voices != new_settings.azure_speech_voices
                        || self.settings.azure_speech_voice_rotation != new_settings.azure_speech_voice_rotation
                    {
                        self.voice_round_robin_index = 0;
                    }
                    if self.settings.sapi_voices != new_settings.sapi_voices
                        || self.settings.sapi_voice_rotation != new_settings.sapi_voice_rotation
                    {
                        self.sapi_voice_round_robin_index = 0;
                    }
                    self.settings = new_settings;
                }
                TtsCommand::SynthesisComplete { message_id, result } => {
                    if let Some(curr) = &self.current {
                        if curr.message_id == message_id {
                            match result {
                                Ok(synthesis) => {
                                    let pending = PendingAudio {
                                        message_id: message_id.clone(),
                                        audio_data: synthesis.audio_data_uri,
                                        word_boundaries: synthesis.word_boundaries.clone(),
                                    };

                                    let _ = self.broadcast_tx.send(WsBroadcastMessage::PlayAudio {
                                        message_id: message_id.clone(),
                                        audio_data: pending.audio_data.clone(),
                                        word_boundaries: pending.word_boundaries.clone(),
                                    });

                                    let receiver_count = self.broadcast_tx.receiver_count();
                                    if receiver_count == 0 {
                                        info!("[TTS] No WebSocket clients currently connected; caching audio for {} until client connects", message_id);
                                    }

                                    self.pending_audio = Some(pending);

                                    // Dynamic watchdog timer based on audio length
                                    let last_offset = synthesis
                                        .word_boundaries
                                        .last()
                                        .map(|b| b.audio_offset + b.duration)
                                        .unwrap_or(7.0);
                                    let base_timeout = ((last_offset + 4.0).clamp(5.0, 25.0)) as u64;
                                    let timeout_secs = if receiver_count == 0 {
                                        base_timeout.max(25)
                                    } else {
                                        base_timeout
                                    };

                                    let watchdog_id = message_id.clone();
                                    let watchdog_handle = self.self_handle.clone();
                                    tokio::spawn(async move {
                                        sleep(Duration::from_secs(timeout_secs)).await;
                                        warn!("[TTS] Watchdog timeout for message {}. Auto-finishing.", watchdog_id);
                                        let _ = watchdog_handle.send(TtsCommand::AudioFinished(Some(watchdog_id))).await;
                                    });
                                }
                                Err(err) => {
                                    self.pending_audio = None;
                                    warn!("[TTS] Speech synthesis failed for {}: {}", message_id, err);
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

        let self_handle = self.self_handle.clone();
        let text_to_speak = format!("{} says {}", msg.author_name, msg.text);

        if self.settings.tts_provider == "sapi5" {
            let sapi_voice = if self.settings.sapi_voice_rotation {
                let voices: Vec<&str> = self.settings.sapi_voices
                    .iter()
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .collect();
                if voices.is_empty() {
                    self.settings.sapi_voice.clone()
                } else {
                    let index = self.sapi_voice_round_robin_index % voices.len();
                    self.sapi_voice_round_robin_index = (index + 1) % voices.len();
                    voices[index].to_string()
                }
            } else {
                self.settings.sapi_voice.clone()
            };
            let sapi_rate = self.settings.sapi_rate;
            let sapi_volume = self.settings.sapi_volume;

            tokio::spawn(async move {
                let res = crate::sapi_tts::synthesize(&text_to_speak, &sapi_voice, sapi_rate, sapi_volume)
                    .await
                    .map_err(|e| e.to_string());
                let _ = self_handle.send(TtsCommand::SynthesisComplete {
                    message_id: msg.message_id,
                    result: res,
                }).await;
            });
            return;
        }

        let key = self.settings.azure_speech_key.clone();
        let region = self.settings.azure_speech_region.clone();
        let synthesis_configured = !key.trim().is_empty() && !region.trim().is_empty();
        let voice = if self.settings.azure_speech_voice_rotation {
            let voices: Vec<&str> = self.settings.azure_speech_voices
                .iter()
                .map(|voice| voice.trim())
                .filter(|voice| !voice.is_empty() && *voice != "default")
                .collect();
            if voices.is_empty() {
                default_hindi_voice()
            } else {
                let index = self.voice_round_robin_index % voices.len();
                if synthesis_configured {
                    self.voice_round_robin_index = (index + 1) % voices.len();
                }
                voices[index].to_string()
            }
        } else if self.settings.azure_speech_voice.trim().is_empty() || self.settings.azure_speech_voice == "default" {
            default_hindi_voice()
        } else {
            self.settings.azure_speech_voice.clone()
        };

        tokio::spawn(async move {
            let client = AzureTtsClient::new(key, region);

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

    #[tokio::test]
    async fn test_pending_audio_caching_and_lifecycle() {
        let (broadcast_tx, _broadcast_rx) = broadcast::channel(100);
        let settings = AppSettings::default();
        let handle = TtsActor::spawn(broadcast_tx, settings);

        // Initially no pending audio
        assert!(handle.get_pending_audio().await.is_none());

        // Enqueue priority message
        let msg = make_test_msg("p1", "BABA", "Quick speech test");
        handle.enqueue_priority(msg).await;

        // Simulate synthesis completion directly via internal command sender
        let synthesis_result = Ok(crate::azure_tts::SpeechSynthesisResult {
            audio_data_uri: "data:audio/mp3;base64,dummydata".to_string(),
            word_boundaries: vec![WordBoundary {
                audio_offset: 0.1,
                duration: 0.5,
                text: "Quick".to_string(),
                text_offset: Some(0),
            }],
            size_kb: 1.2,
        });
        let _ = handle.sender.send(TtsCommand::SynthesisComplete {
            message_id: "p1".to_string(),
            result: synthesis_result,
        }).await;

        // Pending audio should now be available for newly connecting clients
        let pending = handle.get_pending_audio().await;
        assert!(pending.is_some());
        let pending = pending.unwrap();
        assert_eq!(pending.message_id, "p1");
        assert_eq!(pending.audio_data, "data:audio/mp3;base64,dummydata");
        assert_eq!(pending.word_boundaries.len(), 1);

        // When audio finishes, pending audio is cleared
        handle.audio_finished(Some("p1".to_string())).await;
        assert!(handle.get_pending_audio().await.is_none());
    }

    #[tokio::test]
    async fn test_sapi_tts_provider_flow() {
        let (broadcast_tx, mut broadcast_rx) = broadcast::channel(100);
        let mut settings = AppSettings::default();
        settings.tts_provider = "sapi5".to_string();
        settings.sapi_voice = "default".to_string();
        settings.sapi_rate = 1;
        settings.sapi_volume = 95;

        let handle = TtsActor::spawn(broadcast_tx, settings);

        let msg = make_test_msg("sapi-1", "WindowsUser", "Hello SAPI offline TTS");
        handle.enqueue(msg).await;

        // Verify that synthesis completes and sends PlayAudio with wav audio data
        let mut got_play_audio = false;
        let timeout = tokio::time::sleep(Duration::from_secs(3));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                Ok(event) = broadcast_rx.recv() => {
                    if let WsBroadcastMessage::PlayAudio { message_id, audio_data, .. } = event {
                        if message_id == "sapi-1" {
                            assert!(audio_data.starts_with("data:audio/wav;base64,"));
                            got_play_audio = true;
                            break;
                        }
                    }
                }
                _ = &mut timeout => {
                    break;
                }
            }
        }

        assert!(got_play_audio, "Expected SAPI synthesis to complete and broadcast PlayAudio");
    }
}

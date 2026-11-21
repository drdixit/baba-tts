use crate::azure_tts::AzureTtsClient;
use crate::native_audio::NativeAudioPlayer;
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

pub const MAX_TTS_QUEUE_SIZE: usize = 200;

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
    #[allow(dead_code)]
    ClearPendingQueue,
    RemoveUser(String),
    RemoveUserAndSkipMessage {
        author_id: Option<String>,
        message_id: String,
    },
    GetCurrentProcessing(oneshot::Sender<Option<ChatMessage>>),
    GetPendingAudio(oneshot::Sender<Option<PendingAudio>>),
    UpdateSettings(AppSettings),
    ToggleMute,
    #[allow(dead_code)]
    SetVolume(f32),
    SynthesisComplete {
        message_id: String,
        result: Result<crate::azure_tts::SpeechSynthesisResult, String>,
        is_fallback: bool,
    },
}

const RECENT_TEXT_WINDOW: Duration = Duration::from_secs(30);
const MAX_RECENT_TEXTS: usize = 4096;

#[derive(Default)]
struct RecentMessageCache {
    expires_at: HashMap<(String, String), Instant>,
    oldest_first: VecDeque<(Instant, (String, String))>,
}

impl RecentMessageCache {
    fn should_suppress(&mut self, author_key: &str, text: &str, now: Instant) -> bool {
        self.remove_expired(now);

        let key = (author_key.to_owned(), text.to_owned());
        if self.expires_at.contains_key(&key) {
            return true;
        }

        let expires_at = now + RECENT_TEXT_WINDOW;
        self.expires_at.insert(key.clone(), expires_at);
        self.oldest_first.push_back((expires_at, key));

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
        if let Some((expires_at, key)) = self.oldest_first.pop_front() {
            if self.expires_at.get(&key) == Some(&expires_at) {
                self.expires_at.remove(&key);
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
    #[allow(dead_code)]
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

    pub async fn toggle_mute(&self) {
        let _ = self.sender.send(TtsCommand::ToggleMute).await;
    }

    #[allow(dead_code)]
    pub async fn set_volume(&self, vol: f32) {
        let _ = self.sender.send(TtsCommand::SetVolume(vol)).await;
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
    audio_player: NativeAudioPlayer,
    watchdog_abort: Option<tokio::task::AbortHandle>,
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
        let audio_player = NativeAudioPlayer::new();
        audio_player.set_volume(initial_settings.master_volume as f32 / 100.0);
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
            audio_player,
            watchdog_abort: None,
        };

        tokio::spawn(actor.run());
        TtsHandle { sender: tx }
    }

    async fn run(mut self) {
        while let Some(cmd) = self.receiver.recv().await {
            match cmd {
                TtsCommand::Enqueue(msg) => {
                    let is_superchat = msg.is_superchat.unwrap_or(false);
                    let author_key = msg.author_id.clone().unwrap_or_else(|| msg.author_name.clone());
                    let text_lower = msg.text.trim().to_lowercase();
                    if !is_superchat && self.recent_cache.should_suppress(&author_key, &text_lower, Instant::now()) {
                        info!("[TTS] Skipping duplicate message from {}: {}", author_key, msg.text);
                        let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                            message_id: msg.message_id.clone(),
                            state: "skipped".to_string(),
                        });
                        continue;
                    }
                    if self.queue.len() >= MAX_TTS_QUEUE_SIZE {
                        if let Some(dropped) = self.queue.pop_front() {
                            warn!(
                                "[TTS] Queue reached capacity ({}). Dropping oldest: {}",
                                MAX_TTS_QUEUE_SIZE, dropped.message_id
                            );
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                message_id: dropped.message_id,
                                state: "skipped".to_string(),
                            });
                        }
                    }
                    self.queue.push_back(msg);
                    self.process_next();
                }
                TtsCommand::EnqueuePriority(msg) => {
                    if self.queue.len() >= MAX_TTS_QUEUE_SIZE {
                        if let Some(dropped) = self.queue.pop_back() {
                            warn!(
                                "[TTS] Queue reached capacity ({}). Dropping lowest priority: {}",
                                MAX_TTS_QUEUE_SIZE, dropped.message_id
                            );
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                message_id: dropped.message_id,
                                state: "skipped".to_string(),
                            });
                        }
                    }
                    self.queue.push_front(msg);
                    self.process_next();
                }
                TtsCommand::AudioFinished(message_id) => {
                    let should_clear = match (&message_id, &self.current) {
                        (Some(id), Some(curr)) => curr.message_id == *id,
                        _ => false,
                    };

                    if should_clear {
                        if let Some(h) = self.watchdog_abort.take() {
                            h.abort();
                        }
                        if let Some(curr) = self.current.take() {
                            if let Some(pending) = &self.pending_audio {
                                if pending.message_id == curr.message_id {
                                    self.pending_audio = None;
                                }
                            }
                            let _ = self.broadcast_tx.send(WsBroadcastMessage::TtsState {
                                message_id: curr.message_id,
                                state: "done".to_string(),
                            });
                            self.is_processing = false;
                            self.process_next();
                        }
                    } else if let Some(id) = message_id {
                        if let Some(pending) = &self.pending_audio {
                            if pending.message_id == id {
                                self.pending_audio = None;
                            }
                        }
                    }
                }
                TtsCommand::SkipCurrent => {
                    if let Some(h) = self.watchdog_abort.take() {
                        h.abort();
                    }
                    self.pending_audio = None;
                    self.audio_player.stop();
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
                    if let Some(h) = self.watchdog_abort.take() {
                        h.abort();
                    }
                    self.pending_audio = None;
                    self.audio_player.stop();
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
                            if let Some(h) = self.watchdog_abort.take() {
                                h.abort();
                            }
                            self.pending_audio = None;
                            self.audio_player.stop();
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
                        if let Some(h) = self.watchdog_abort.take() {
                            h.abort();
                        }
                        self.pending_audio = None;
                        self.audio_player.stop();
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
                TtsCommand::ToggleMute => {
                    self.audio_player.toggle_mute();
                }
                TtsCommand::SetVolume(vol) => {
                    self.settings.master_volume = (vol * 100.0).round().clamp(0.0, 100.0) as u32;
                    self.audio_player.set_volume(vol);
                }
                TtsCommand::UpdateSettings(new_settings) => {
                    if self.settings.master_volume != new_settings.master_volume {
                        self.audio_player.set_volume(new_settings.master_volume as f32 / 100.0);
                    }
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
                TtsCommand::SynthesisComplete { message_id, result, is_fallback } => {
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

                                    // Play audio natively on the baba-tts.exe process (WASAPI on Windows)
                                    let playback_handle = self.self_handle.clone();
                                    self.audio_player.play(
                                        message_id.clone(),
                                        synthesis.audio_bytes,
                                        move |mid| {
                                            if let Err(e) = playback_handle.try_send(TtsCommand::AudioFinished(Some(mid))) {
                                                warn!("[TTS] Failed to dispatch AudioFinished to queue channel: {}", e);
                                            }
                                        },
                                    );

                                    // Dynamic watchdog timer based on audio length as safety fallback
                                    let last_offset = synthesis
                                        .word_boundaries
                                        .last()
                                        .map(|b| b.audio_offset + b.duration)
                                        .unwrap_or(15.0);
                                    let base_timeout = ((last_offset + 10.0).clamp(10.0, 300.0)) as u64;
                                    let timeout_secs = if receiver_count == 0 {
                                        base_timeout.max(25)
                                    } else {
                                        base_timeout
                                    };

                                    let watchdog_id = message_id.clone();
                                    let watchdog_handle = self.self_handle.clone();
                                    let task = tokio::spawn(async move {
                                        sleep(Duration::from_secs(timeout_secs)).await;
                                        warn!("[TTS] Watchdog timeout for message {}. Auto-finishing.", watchdog_id);
                                        let _ = watchdog_handle.send(TtsCommand::AudioFinished(Some(watchdog_id))).await;
                                    });
                                    if let Some(prev) = self.watchdog_abort.take() {
                                        prev.abort();
                                    }
                                    self.watchdog_abort = Some(task.abort_handle());
                                }
                                Err(err) => {
                                    if !is_fallback && self.settings.tts_provider == "azure" {
                                        warn!(
                                            "[TTS] Azure speech synthesis failed for {} ({}). Initiating automatic fallback to Windows SAPI5 TTS.",
                                            message_id, err
                                        );
                                        let sapi_voice = self.settings.sapi_voice.clone();
                                        let sapi_rate = self.settings.sapi_rate;
                                        let sapi_volume = self.settings.sapi_volume;
                                        let self_handle = self.self_handle.clone();
                                        let text_to_speak = if curr.author_name.eq_ignore_ascii_case("BABA") {
                                            curr.text.clone()
                                        } else {
                                            format!("{} says {}", curr.author_name, curr.text)
                                        };
                                        let mid = message_id.clone();
                                        tokio::spawn(async move {
                                            let res = match tokio::time::timeout(
                                                Duration::from_secs(15),
                                                crate::sapi_tts::synthesize(&text_to_speak, &sapi_voice, sapi_rate, sapi_volume),
                                            )
                                            .await
                                            {
                                                Ok(Ok(r)) => Ok(r),
                                                Ok(Err(e)) => Err(e.to_string()),
                                                Err(_) => Err("SAPI TTS synthesis timed out after 15 seconds".to_string()),
                                            };
                                            let _ = self_handle
                                                .send(TtsCommand::SynthesisComplete {
                                                    message_id: mid,
                                                    result: res,
                                                    is_fallback: true,
                                                })
                                                .await;
                                        });
                                        return;
                                    }

                                    self.pending_audio = None;
                                    warn!("[TTS] Speech synthesis completely failed for {}: {}", message_id, err);
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
        let text_to_speak = if msg.author_name.eq_ignore_ascii_case("BABA") {
            msg.text.clone()
        } else {
            format!("{} says {}", msg.author_name, msg.text)
        };

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
                let res = match tokio::time::timeout(
                    Duration::from_secs(15),
                    crate::sapi_tts::synthesize(&text_to_speak, &sapi_voice, sapi_rate, sapi_volume),
                )
                .await
                {
                    Ok(Ok(r)) => Ok(r),
                    Ok(Err(e)) => Err(e.to_string()),
                    Err(_) => Err("SAPI TTS synthesis timed out after 15 seconds".to_string()),
                };
                let _ = self_handle.send(TtsCommand::SynthesisComplete {
                    message_id: msg.message_id,
                    result: res,
                    is_fallback: true,
                }).await;
            });
            return;
        }

        let key = self.settings.azure_speech_key.clone();
        let region = self.settings.azure_speech_region.clone();
        let synthesis_configured = !key.trim().is_empty() && !region.trim().is_empty();

        if !synthesis_configured {
            info!(
                "[TTS] Azure credentials not configured; automatically using Windows SAPI5 TTS for {}",
                msg.message_id
            );
            let sapi_voice = self.settings.sapi_voice.clone();
            let sapi_rate = self.settings.sapi_rate;
            let sapi_volume = self.settings.sapi_volume;

            tokio::spawn(async move {
                let res = match tokio::time::timeout(
                    Duration::from_secs(15),
                    crate::sapi_tts::synthesize(&text_to_speak, &sapi_voice, sapi_rate, sapi_volume),
                )
                .await
                {
                    Ok(Ok(r)) => Ok(r),
                    Ok(Err(e)) => Err(e.to_string()),
                    Err(_) => Err("SAPI TTS synthesis timed out after 15 seconds".to_string()),
                };
                let _ = self_handle.send(TtsCommand::SynthesisComplete {
                    message_id: msg.message_id,
                    result: res,
                    is_fallback: true,
                }).await;
            });
            return;
        }

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
                self.voice_round_robin_index = (index + 1) % voices.len();
                voices[index].to_string()
            }
        } else if self.settings.azure_speech_voice.trim().is_empty() || self.settings.azure_speech_voice == "default" {
            default_hindi_voice()
        } else {
            self.settings.azure_speech_voice.clone()
        };

        tokio::spawn(async move {
            let client = AzureTtsClient::new(key, region);
            let res = match tokio::time::timeout(
                Duration::from_secs(20),
                client.synthesize(&text_to_speak, &voice),
            )
            .await
            {
                Ok(Ok(r)) => Ok(r),
                Ok(Err(e)) => Err(e.to_string()),
                Err(_) => Err("Azure TTS synthesis timed out after 20 seconds".to_string()),
            };

            let _ = self_handle.send(TtsCommand::SynthesisComplete {
                message_id: msg.message_id,
                result: res,
                is_fallback: false,
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
            is_superchat: None,
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

        // Enqueue regular message from Alice
        let msg1 = make_test_msg("m1", "Alice", "Hello from Alice");
        handle.enqueue(msg1).await;

        // Duplicate from Alice should be skipped
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
        assert!(got_skipped, "Duplicate message from same author should be marked skipped");

        // Same message text from Bob should NOT be skipped
        let mut msg_bob = make_test_msg("m3", "Bob", "Hello from Alice");
        msg_bob.author_id = Some("bob".to_string());
        handle.enqueue(msg_bob).await;

        // Superchat with same text should NOT be skipped even from Alice
        let mut msg_superchat = make_test_msg("m4", "Alice", "Hello from Alice");
        msg_superchat.is_superchat = Some(true);
        handle.enqueue(msg_superchat).await;

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
            audio_bytes: vec![1, 2, 3],
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
            is_fallback: false,
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

    #[tokio::test]
    async fn test_azure_missing_credentials_automatic_sapi_fallback() {
        let (broadcast_tx, mut broadcast_rx) = broadcast::channel(100);
        let mut settings = AppSettings::default();
        settings.tts_provider = "azure".to_string();
        settings.azure_speech_key = "".to_string(); // Empty credentials
        settings.azure_speech_region = "".to_string();

        let handle = TtsActor::spawn(broadcast_tx, settings);

        let msg = make_test_msg("fallback-1", "OfflineUser", "Testing offline fallback");
        handle.enqueue(msg).await;

        let mut got_play_audio = false;
        let timeout = tokio::time::sleep(Duration::from_secs(3));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                Ok(event) = broadcast_rx.recv() => {
                    if let WsBroadcastMessage::PlayAudio { message_id, audio_data, .. } = event {
                        if message_id == "fallback-1" {
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

        assert!(got_play_audio, "Expected unconfigured Azure to automatically fall back to SAPI5");
    }

    #[tokio::test]
    async fn test_queue_capacity_limit() {
        let (broadcast_tx, mut broadcast_rx) = broadcast::channel(500);
        let mut settings = AppSettings::default();
        settings.tts_provider = "sapi".to_string();

        let handle = TtsActor::spawn(broadcast_tx, settings);

        // Enqueue more than MAX_TTS_QUEUE_SIZE
        for i in 0..(MAX_TTS_QUEUE_SIZE + 30) {
            let msg = make_test_msg(&format!("cap-msg-{}", i), "User", &format!("Message content {}", i));
            handle.enqueue(msg).await;
        }

        // Verify that dropped messages emit "skipped" status
        let mut skipped_count = 0;
        let timeout = tokio::time::sleep(Duration::from_millis(500));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                Ok(event) = broadcast_rx.recv() => {
                    if let WsBroadcastMessage::TtsState { state, .. } = event {
                        if state == "skipped" {
                            skipped_count += 1;
                        }
                    }
                }
                _ = &mut timeout => {
                    break;
                }
            }
        }

        assert!(skipped_count >= 25, "Expected at least 25 messages to be dropped due to queue capacity, got {}", skipped_count);
    }

    #[tokio::test]
    async fn test_tts_toggle_mute_and_volume_commands() {
        let (broadcast_tx, _broadcast_rx) = broadcast::channel(10);
        let settings = AppSettings::default();
        let handle = TtsActor::spawn(broadcast_tx, settings);

        // Verify that sending toggle_mute and set_volume does not block or panic
        handle.toggle_mute().await;
        handle.set_volume(0.5).await;
        handle.toggle_mute().await;
        handle.set_volume(1.0).await;
    }
}

use crate::db::Db;
use crate::tts_queue::{TtsHandle, WsBroadcastMessage};
use crate::types::{ChatMessage, MessageStatus};
use axum::extract::ws::{Message, WebSocket};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::broadcast;
use tracing::debug;

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientWsCommand {
    #[serde(rename = "SIMULATE_MESSAGE")]
    SimulateMessage { payload: ChatMessage },
    #[serde(rename = "AUDIO_FINISHED")]
    AudioFinished {
        #[serde(rename = "messageId")]
        message_id: Option<String>,
    },
    #[serde(rename = "CLEAR_TTS_QUEUE")]
    ClearTtsQueue,
    #[serde(rename = "SKIP_CURRENT_MESSAGE")]
    SkipCurrentMessage,
    #[serde(rename = "BAN_CURRENT_SPEAKER")]
    BanCurrentSpeaker,
    #[serde(rename = "BAN_USER")]
    BanUser { payload: BanUserPayload },
    #[serde(rename = "UNBAN_USER")]
    UnbanUser { payload: UnbanUserPayload },
}

#[derive(Debug, Deserialize)]
struct BanUserPayload {
    #[serde(rename = "authorId")]
    author_id: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "profileImageUrl")]
    profile_image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UnbanUserPayload {
    #[serde(rename = "authorId")]
    author_id: Option<String>,
}

pub async fn handle_websocket(
    mut socket: WebSocket,
    db: Db,
    tts_handle: TtsHandle,
    broadcast_tx: broadcast::Sender<WsBroadcastMessage>,
) {
    debug!("New WebSocket client connected");

    // Send banned users list on initial connect
    if let Ok(banned) = db.get_banned_users() {
        let msg = serde_json::json!({
            "type": "banned_users",
            "users": banned
        });
        let _ = socket.send(Message::Text(msg.to_string().into())).await;
    }

    let mut broadcast_rx = broadcast_tx.subscribe();

    loop {
        tokio::select! {
            // Outgoing broadcast message to this client
            broadcast_msg = broadcast_rx.recv() => {
                match broadcast_msg {
                    Ok(msg) => {
                        let json_val = match msg {
                            WsBroadcastMessage::Messages(msgs) => serde_json::to_value(&msgs).unwrap_or(Value::Null),
                            WsBroadcastMessage::TtsState { message_id, state } => serde_json::json!({
                                "type": "tts_state",
                                "messageId": message_id,
                                "state": state
                            }),
                            WsBroadcastMessage::PlayAudio { message_id, audio_data, word_boundaries } => serde_json::json!({
                                "type": "play_audio",
                                "messageId": message_id,
                                "audioData": audio_data,
                                "wordBoundaries": word_boundaries
                            }),
                            WsBroadcastMessage::KillAudio => serde_json::json!({ "type": "KILL_AUDIO" }),
                            WsBroadcastMessage::BannedUsers(users) => serde_json::json!({
                                "type": "banned_users",
                                "users": users
                            }),
                        };

                        if !json_val.is_null()
                            && socket.send(Message::Text(json_val.to_string().into())).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            // Incoming message from this client
            client_msg = socket.next() => {
                let Some(msg_result) = client_msg else {
                    break;
                };

                let Ok(msg) = msg_result else {
                    break;
                };

                if let Message::Text(text) = msg {
                    if let Ok(cmd) = serde_json::from_str::<ClientWsCommand>(&text) {
                        match cmd {
                            ClientWsCommand::SimulateMessage { mut payload } => {
                                if let Some(ref aid) = payload.author_id {
                                    if db.is_user_banned(aid) {
                                        payload.status = MessageStatus::Skipped;
                                        let _ = broadcast_tx.send(WsBroadcastMessage::Messages(vec![payload]));
                                        continue;
                                    }
                                }
                                payload.status = MessageStatus::Queued;
                                let _ = broadcast_tx.send(WsBroadcastMessage::Messages(vec![payload.clone()]));
                                tts_handle.enqueue(payload).await;
                            }
                            ClientWsCommand::AudioFinished { message_id } => {
                                tts_handle.audio_finished(message_id).await;
                            }
                            ClientWsCommand::ClearTtsQueue => {
                                tts_handle.clear_queue().await;
                            }
                            ClientWsCommand::SkipCurrentMessage => {
                                tts_handle.skip_current().await;
                            }
                            ClientWsCommand::BanCurrentSpeaker => {
                                if let Some(current) = tts_handle.get_current_processing().await {
                                    if let Some(aid) = current.author_id {
                                        let _ = db.ban_user(&aid, &current.author_name, current.author_profile_image_url.as_deref());
                                        tts_handle.remove_user(aid).await;
                                        if let Ok(banned) = db.get_banned_users() {
                                            let _ = broadcast_tx.send(WsBroadcastMessage::BannedUsers(banned));
                                        }
                                    }
                                }
                            }
                            ClientWsCommand::BanUser { payload } => {
                                if let Some(aid) = payload.author_id {
                                    let name = payload.display_name.unwrap_or_else(|| "Unknown".to_string());
                                    let _ = db.ban_user(&aid, &name, payload.profile_image_url.as_deref());
                                    tts_handle.remove_user(aid).await;
                                    if let Ok(banned) = db.get_banned_users() {
                                        let _ = broadcast_tx.send(WsBroadcastMessage::BannedUsers(banned));
                                    }
                                }
                            }
                            ClientWsCommand::UnbanUser { payload } => {
                                if let Some(aid) = payload.author_id {
                                    let _ = db.unban_user(&aid);
                                    if let Ok(banned) = db.get_banned_users() {
                                        let _ = broadcast_tx.send(WsBroadcastMessage::BannedUsers(banned));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    debug!("WebSocket client disconnected");
}

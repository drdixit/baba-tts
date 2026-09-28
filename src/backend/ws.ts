import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ChatMessage } from '../shared/types.js';

import { db, banUser, unbanUser, getBannedUsers } from './db.js';

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    
    // Tell client if we are currently authenticated
    try {
      const row = db.prepare('SELECT count(*) as count FROM oauth_accounts').get() as { count: number };
      const isConnected = row.count > 0;
      ws.send(JSON.stringify({ type: 'auth_status', connected: isConnected }));
      
      const banned = getBannedUsers();
      ws.send(JSON.stringify({ type: 'banned_users', users: banned }));
    } catch (err) {
      console.error('Failed to check auth status on connect', err);
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'SIMULATE_MESSAGE') {
          const msg = message.payload;
          const { isUserBanned } = await import('./db.js');
          if (isUserBanned(msg.authorId)) {
            msg.status = 'skipped';
            broadcastMessages([msg]);
          } else {
            msg.status = 'queued';
            broadcastMessages([msg]);
            const { enqueueMessageForTTS } = await import('./tts.js');
            enqueueMessageForTTS(msg);
          }
        }
        if (message.type === 'AUDIO_FINISHED') {
          const { markAudioFinished } = await import('./tts.js');
          markAudioFinished(message.messageId);
        }
        if (message.type === 'CLEAR_TTS_QUEUE') {
          const { clearTTSQueue } = await import('./tts.js');
          clearTTSQueue();
        }
        
        if (message.type === 'BAN_CURRENT_SPEAKER') {
          const { getCurrentProcessingMessage, removeUserFromQueue } = await import('./tts.js');
          const currentMsg = getCurrentProcessingMessage();
          if (currentMsg && currentMsg.authorId) {
            banUser(currentMsg.authorId, currentMsg.authorName, currentMsg.authorProfileImageUrl);
            broadcastBannedUsers();
            removeUserFromQueue(currentMsg.authorId);
          }
        }
        if (message.type === 'BAN_USER') {
          const { authorId, displayName, profileImageUrl } = message.payload;
          if (authorId) {
            banUser(authorId, displayName || 'Unknown', profileImageUrl);
            // Broadcast new banned list
            broadcastBannedUsers();
            
            // Instantly kill from TTS
            const { removeUserFromQueue } = await import('./tts.js');
            removeUserFromQueue(authorId);
          }
        }
        if (message.type === 'UNBAN_USER') {
          const { authorId } = message.payload;
          if (authorId) {
            unbanUser(authorId);
            broadcastBannedUsers();
          }
        }
      } catch (err) {
        console.error('Failed to process incoming WebSocket message:', err);
      }
    });

    ws.on('error', console.error);
    ws.on('close', () => { console.log('Client disconnected'); });
  });
}

export function broadcastMessages(msgs: ChatMessage[]) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  
  if (msgs.length === 0) return;
  
  const data = JSON.stringify(msgs);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function broadcastMessageDelete(messageId: string) {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  
  const data = JSON.stringify({ type: 'delete', messageId });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function broadcastAuthError() {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  
  const data = JSON.stringify({ type: 'auth_error' });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function broadcastQuotaExhausted() {
  if (!wss) {
    console.warn('WebSocket server not initialized');
    return;
  }
  
  const data = JSON.stringify({ type: 'quota_exhausted' });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function broadcastPlayAudio(messageId: string, audioData: string, wordBoundaries: { text: string, audioOffset: number, duration: number }[]) {
  if (!wss) return;
  const data = JSON.stringify({ type: 'play_audio', messageId, audioData, wordBoundaries });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

export function broadcastTTSState(messageId: string, state: 'processing' | 'skipped' | 'error') {
  if (!wss) return;
  const data = JSON.stringify({ type: 'tts_state', messageId, state });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

export function broadcastBannedUsers() {
  if (!wss) return;
  try {
    const banned = getBannedUsers();
    const data = JSON.stringify({ type: 'banned_users', users: banned });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  } catch (err) {
    console.error('Failed to broadcast banned users:', err);
  }
}

export function broadcastKillAudio() {
  if (!wss) return;
  const data = JSON.stringify({ type: 'KILL_AUDIO' });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

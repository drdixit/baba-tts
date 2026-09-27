import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ChatMessage } from '../shared/types.js';

import { db } from './db.js';
import { generateSpeech } from './tts.js';

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
    } catch (err) {
      console.error('Failed to check auth status on connect', err);
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'TEST_AZURE_TTS') {
          const result = await generateSpeech("Hi, this is a test from Azure.", "hi-IN-AnanyaNeural");
          if (typeof result === 'string' && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'play_audio', audioData: result }));
          }
        }
      } catch (err) {
        console.error('Failed to process incoming WebSocket message:', err);
      }
    });

    ws.on('error', console.error);
    ws.on('close', () => {
      console.log('Client disconnected');
    });
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

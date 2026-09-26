import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ChatMessage } from '../shared/types.js';

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
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

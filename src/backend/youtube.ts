import { google } from 'googleapis';
import { db } from './db.js';
import { getOAuth2Client } from './auth.js';
import { broadcastMessages, broadcastAuthError } from './ws.js';
import { enqueueMessageForTTS } from './tts.js';
import type { ChatMessage } from '../shared/types.js';

const activePollers = new Set<string>();
const pollerTimeouts = new Map<string, NodeJS.Timeout>();
const discoveryTimeouts = new Map<string, NodeJS.Timeout>();

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function _testSetActivePoller(accountId: string) {
  activePollers.add(`${accountId}:chat-123`);
}

export async function startYouTubePoller(accountId: string) {
  const row = db.prepare('SELECT refresh_token FROM oauth_accounts WHERE id = ?').get(accountId) as { refresh_token: string } | undefined;
  if (!row || !row.refresh_token) {
    console.error('No refresh token found for account:', accountId);
    return;
  }
  
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: row.refresh_token });
  
  const youtube = google.youtube({ version: 'v3', auth: client });
  
  try {
    const broadcastRes = await youtube.liveBroadcasts.list({
      part: ['snippet'],
      broadcastStatus: 'active',
      broadcastType: 'all'
    });
    
    const items = broadcastRes.data.items;
    if (!items || items.length === 0) {
      console.log('No active broadcasts found for account:', accountId);
      return;
    }
    
    for (const item of items) {
      const liveChatId = item.snippet?.liveChatId;
      if (!liveChatId) continue;
      
      const pollerKey = `${accountId}:${liveChatId}`;
      if (activePollers.has(pollerKey)) continue;

      activePollers.add(pollerKey);
      pollLiveChat(accountId, youtube, liveChatId, '');
    }
    
  } catch (error: any) {
    console.error(`Error starting YouTube poller for account ${accountId}:`, error);
    const statusCode = error.code || error.status;
    if (statusCode === 401) {
      broadcastAuthError();
    }
  } finally {
    const existing = discoveryTimeouts.get(accountId);
    if (existing) clearTimeout(existing);
    
    discoveryTimeouts.set(
      accountId,
      setTimeout(() => startYouTubePoller(accountId), 60000)
    );
  }
}


export async function pollLiveChat(accountId: string, youtube: any, liveChatId: string, pageToken: string) {
  const pollerKey = `${accountId}:${liveChatId}`;
  if (!activePollers.has(pollerKey)) return;
  
  try {
    const chatRes = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken: pageToken || undefined,
    });
    
    const nextToken = chatRes.data.nextPageToken || '';
    const pollingInterval = chatRes.data.pollingIntervalMillis || 5000;
    
    const items = chatRes.data.items || [];
    const messages: ChatMessage[] = items.map((item: any) => {
      const msgId = item.id || '';
      if (msgId) {
        try {
          db.prepare(`
            INSERT OR IGNORE INTO messages (id, live_chat_id, author_channel_id)
            VALUES (?, ?, ?)
          `).run(msgId, liveChatId, item.snippet?.authorChannelId || '');
        } catch (err) {
          console.error('Failed to store message metadata:', err);
        }
      }
      return {
        messageId: msgId,
        authorName: escapeHtml(item.authorDetails?.displayName || 'Unknown'),
        text: escapeHtml(item.snippet?.displayMessage || ''),
        status: 'default'
      };
    });
    
    if (messages.length > 0) {
      broadcastMessages(messages);
      messages.forEach(msg => enqueueMessageForTTS(msg));
    }
    
    const timeout = setTimeout(() => pollLiveChat(accountId, youtube, liveChatId, nextToken), pollingInterval);
    pollerTimeouts.set(pollerKey, timeout);
    
  } catch (error: any) {
    console.error(`Error polling live chat for account ${accountId}:`, error.message || error);
    
    const statusCode = error.code || error.status;
    
    let isFatal = statusCode === 401 || statusCode === 404;
    
    if (statusCode === 403) {
      const reason = error.errors?.[0]?.reason || '';
      if (reason === 'liveChatEnded' || reason === 'forbidden') {
        isFatal = true;
      }
    }
    
    if (isFatal) {
      console.error(`Fatal error ${statusCode}. Stopping poller for chat ${pollerKey}.`);
      activePollers.delete(pollerKey);
      pollerTimeouts.delete(pollerKey);
      if (statusCode === 401) {
        broadcastAuthError();
      }
      return;
    }
    
    let retryWait = 5000;
    if (statusCode === 429 || statusCode === 403 || statusCode === 500) {
      console.log('Rate limit or server error. Waiting 10 seconds before retrying...');
      retryWait = 10000;
    }
    
    // Retry with the same pageToken
    const timeout = setTimeout(() => pollLiveChat(accountId, youtube, liveChatId, pageToken), retryWait);
    pollerTimeouts.set(pollerKey, timeout);
  }
}

export function stopYouTubePoller(accountId?: string) {
  if (accountId) {
    const prefix = `${accountId}:`;
    for (const key of activePollers) {
      if (key.startsWith(prefix)) activePollers.delete(key);
    }
    for (const [key, timeout] of pollerTimeouts.entries()) {
      if (key.startsWith(prefix)) {
        clearTimeout(timeout);
        pollerTimeouts.delete(key);
      }
    }
    
    const discTimeout = discoveryTimeouts.get(accountId);
    if (discTimeout) {
      clearTimeout(discTimeout);
      discoveryTimeouts.delete(accountId);
    }
  } else {
    activePollers.clear();
    for (const timeout of pollerTimeouts.values()) {
      clearTimeout(timeout);
    }
    pollerTimeouts.clear();
    
    for (const timeout of discoveryTimeouts.values()) {
      clearTimeout(timeout);
    }
    discoveryTimeouts.clear();
  }
}

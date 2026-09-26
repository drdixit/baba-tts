import { google } from 'googleapis';
import { db } from './db.js';
import { getOAuth2Client } from './auth.js';
import { broadcastMessages, broadcastAuthError } from './ws.js';
import { enqueueMessageForTTS } from './tts.js';
import type { ChatMessage } from '../shared/types.js';

const activePollers = new Set<string>();
const pollerTimeouts = new Map<string, NodeJS.Timeout>();

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function _testSetActivePoller(accountId: string) {
  activePollers.add(accountId);
}

export async function startYouTubePoller(accountId: string) {
  if (activePollers.has(accountId)) return;
  
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
    
    const liveChatId = items[0].snippet?.liveChatId;
    if (!liveChatId) {
      console.log('No live chat ID found for the broadcast.');
      return;
    }
    
    activePollers.add(accountId);
    pollLiveChat(accountId, youtube, liveChatId, '');
    
  } catch (error: any) {
    console.error(`Error starting YouTube poller for account ${accountId}:`, error);
    const statusCode = error.code || error.status;
    if (statusCode === 401 || statusCode === 403) {
      broadcastAuthError();
    }
  }
}


export async function pollLiveChat(accountId: string, youtube: any, liveChatId: string, pageToken: string) {
  if (!activePollers.has(accountId)) return;
  
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
    pollerTimeouts.set(accountId, timeout);
    
  } catch (error: any) {
    console.error(`Error polling live chat for account ${accountId}:`, error.message || error);
    
    const statusCode = error.code || error.status;
    
    // Non-retriable errors
    if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
      console.error(`Fatal error ${statusCode}. Stopping poller for account ${accountId}.`);
      activePollers.delete(accountId);
      pollerTimeouts.delete(accountId);
      if (statusCode === 401 || statusCode === 403) {
        broadcastAuthError();
      }
      return;
    }
    
    let retryWait = 5000;
    if (statusCode === 429 || statusCode === 500) {
      console.log('Rate limit or server error. Waiting 10 seconds before retrying...');
      retryWait = 10000;
    }
    
    // Retry with the same pageToken
    const timeout = setTimeout(() => pollLiveChat(accountId, youtube, liveChatId, pageToken), retryWait);
    pollerTimeouts.set(accountId, timeout);
  }
}

export function stopYouTubePoller(accountId?: string) {
  if (accountId) {
    activePollers.delete(accountId);
    const timeout = pollerTimeouts.get(accountId);
    if (timeout) {
      clearTimeout(timeout);
      pollerTimeouts.delete(accountId);
    }
  } else {
    activePollers.clear();
    for (const timeout of pollerTimeouts.values()) {
      clearTimeout(timeout);
    }
    pollerTimeouts.clear();
  }
}

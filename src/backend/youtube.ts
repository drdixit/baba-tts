import { google } from 'googleapis';
import { db, isUserBanned } from './db.js';
import { getOAuth2Client } from './auth.js';
import { broadcastMessages, broadcastAuthError, broadcastQuotaExhausted } from './ws.js';
import { enqueueMessageForTTS } from './tts.js';
import type { ChatMessage } from '../shared/types.js';
import { getDeterministicColor } from '../shared/colors.js';

const activePollers = new Set<string>();
const pollerTimeouts = new Map<string, NodeJS.Timeout>();
const discoveryTimeouts = new Map<string, NodeJS.Timeout>();
const discoveryRunning = new Set<string>();
const youtubeClients = new Map<string, any>(); // cache Google API clients

// Per-stream retry state for the 4-tier error handling
const retryState = new Map<string, { errorCount: number; gracefulEndCount: number }>();

/** Exponential backoff with jitter. Returns delay in ms. */
function backoffDelay(attempt: number, baseMs: number, capMs: number): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), capMs);
  const jitter = exponential * 0.5 * Math.random(); // 0–50% jitter
  return exponential + jitter;
}

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

export async function discoverActiveBroadcasts(accountId: string) {
  discoveryRunning.add(accountId);
  
  try {
    const row = db.prepare('SELECT refresh_token FROM oauth_accounts WHERE id = ?').get(accountId) as { refresh_token: string } | undefined;
    if (!row || !row.refresh_token) {
      console.error('No refresh token found for account:', accountId);
      discoveryRunning.delete(accountId);
      return;
    }
    
    let youtube = youtubeClients.get(accountId);
    if (!youtube) {
      const client = getOAuth2Client();
      client.setCredentials({ refresh_token: row.refresh_token });
      youtube = google.youtube({ version: 'v3', auth: client });
      youtubeClients.set(accountId, youtube);
    }
    // YouTube API forbids combining 'mine: true' with 'broadcastStatus'.
    // We must fetch mine: true, include the 'status' part, and filter locally.
    const broadcastRes = await youtube.liveBroadcasts.list({
      part: ['snippet', 'status'],
      broadcastType: 'all',
      mine: true,
      maxResults: 50
    });
    
    // Any stream that has a liveChatId and is not completed/revoked should be tracked.
    const items = (broadcastRes.data.items || []).filter((item: any) => {
      const status = item.status?.lifeCycleStatus;
      return item.snippet?.liveChatId && status !== 'complete' && status !== 'revoked';
    });
    if (!items || items.length === 0) {
      console.log('No active broadcasts found for account:', accountId);
      return;
    }
    
    for (const item of items) {
      // Security/Validation: Only proceed if the broadcast belongs to our configured channel
      if (process.env.YOUTUBE_CHANNEL_ID && item.snippet?.channelId !== process.env.YOUTUBE_CHANNEL_ID) {
        continue;
      }
      
      const liveChatId = item.snippet?.liveChatId;
      if (!liveChatId) continue;
      
      const pollerKey = `${accountId}:${liveChatId}`;
      if (activePollers.has(pollerKey)) continue;

      activePollers.add(pollerKey);
      streamLiveChat(accountId, liveChatId, '');
    }
    
  } catch (error: any) {
    console.error(`Error discovering active broadcasts for account ${accountId}:`, error);
    const statusCode = error.code || error.status;
    const errorMsg = error.message || '';
    if (statusCode === 401 || (statusCode === 400 && errorMsg.includes('invalid_grant'))) {
      broadcastAuthError();
      try {
        db.prepare('DELETE FROM oauth_accounts WHERE id = ?').run(accountId);
      } catch(e) {}
      return; // Handled below in finally
    }
  } finally {
    discoveryRunning.delete(accountId);

    const row = db.prepare('SELECT count(*) as c FROM oauth_accounts WHERE id = ?').get(accountId) as { c: number };
    if (row && row.c === 0) {
      console.log('Account deleted due to auth failure, stopping discovery loop.');
      return;
    }
    const existing = discoveryTimeouts.get(accountId);
    if (existing) clearTimeout(existing);

    // Only poll discovery if we don't currently have an active stream, to save quota!
    let hasActiveStream = false;
    for (const key of activePollers.keys()) {
      if (key.startsWith(accountId + ':')) {
        hasActiveStream = true;
        break;
      }
    }
    
    if (!hasActiveStream) {
      discoveryTimeouts.set(
        accountId,
        setTimeout(() => discoverActiveBroadcasts(accountId), 60000)
      );
    }
  }
}


export async function streamLiveChat(accountId: string, liveChatId: string, pageToken: string) {
  const pollerKey = `${accountId}:${liveChatId}`;
  if (!activePollers.has(pollerKey)) return;
  
  const row = db.prepare('SELECT refresh_token FROM oauth_accounts WHERE id = ?').get(accountId) as { refresh_token: string } | undefined;
  if (!row || !row.refresh_token) {
    activePollers.delete(pollerKey);
    return;
  }

  let delay = 5000;

  try {
    let youtube = youtubeClients.get(accountId);
    if (!youtube) {
      const client = getOAuth2Client();
      client.setCredentials({ refresh_token: row.refresh_token });
      youtube = google.youtube({ version: 'v3', auth: client });
      youtubeClients.set(accountId, youtube);
    }
    
    const res = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken: pageToken || undefined,
      maxResults: 200
    });

    const data = res.data;
    delay = data.pollingIntervalMillis || 5000;
    let nextToken = data.nextPageToken || pageToken;

    if (data.items && data.items.length > 0) {
      retryState.set(pollerKey, { errorCount: 0, gracefulEndCount: 0 });
      
      const messages: ChatMessage[] = data.items.map((item: any) => {
        const rawName = item.authorDetails?.displayName || 'Unknown';
        const authorId = item.authorDetails?.channelId || '';
        const banned = isUserBanned(authorId);
        
        const themes = ['subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean'];
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];
        const profileImg = item.authorDetails?.profileImageUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${rawName}`;

        return {
          messageId: item.id || '',
          authorName: escapeHtml(rawName),
          authorId: authorId,
          authorProfileImageUrl: profileImg,
          authorColor: getDeterministicColor(rawName),
          text: escapeHtml(item.snippet?.displayMessage || ''),
          status: banned ? 'skipped' : 'queued',
          theme: randomTheme as any
        } as ChatMessage;
      });
      
      // Filter out duplicate or empty messages if needed (handled by enqueue cache in tts.ts mostly)
      const validMessages = messages.filter(m => m.text.trim().length > 0);
      if (validMessages.length > 0) {
        broadcastMessages(validMessages);
        validMessages.forEach(msg => {
          if (msg.status === 'queued') {
            enqueueMessageForTTS(msg);
          }
        });
      }
    }

    if (activePollers.has(pollerKey)) {
      const timeout = setTimeout(() => streamLiveChat(accountId, liveChatId, nextToken), delay);
      pollerTimeouts.set(pollerKey, timeout);
    }
    return;

  } catch (error: any) {
    const statusCode = error.code || error.status || 500;
    const errorMsg = error.message || '';
    
    const state = retryState.get(pollerKey) || { errorCount: 0, gracefulEndCount: 0 };
    
    if (statusCode === 401 || (statusCode === 400 && errorMsg.includes('invalid_grant'))) {
      console.error(`Auth error (HTTP 401/400) from liveChatMessages. Stopping stream.`);
      activePollers.delete(pollerKey);
      retryState.delete(pollerKey);
      broadcastAuthError();
      try {
        db.prepare('DELETE FROM oauth_accounts WHERE id = ?').run(accountId);
      } catch(e) {}
      return;
    }
    
    if (statusCode === 403) {
      const reason = error.errors?.[0]?.reason || '';
      if (reason === 'liveChatEnded' || reason === 'liveChatDisabled') {
        console.log(`Stream ended or chat disabled (${reason}) for ${pollerKey}. Stopping.`);
        activePollers.delete(pollerKey);
        retryState.delete(pollerKey);
        resumeBroadcastDiscovery(accountId);
        return;
      }
      
      if (errorMsg.includes('quotaExceeded')) {
        console.error(`Quota exhausted. Stopping all retries for ${pollerKey}.`);
        activePollers.delete(pollerKey);
        retryState.delete(pollerKey);
        broadcastQuotaExhausted();
        return;
      }
      if (errorMsg.includes('rateLimitExceeded')) {
        state.errorCount++;
        retryState.set(pollerKey, state);
        const backoff = backoffDelay(state.errorCount, 30_000, 300_000);
        console.warn(`Rate limited. Backing off ${Math.round(backoff / 1000)}s for ${pollerKey}.`);
        if (activePollers.has(pollerKey)) {
          const timeout = setTimeout(() => streamLiveChat(accountId, liveChatId, pageToken), backoff);
          pollerTimeouts.set(pollerKey, timeout);
        }
        return;
      }
      console.error(`Fatal HTTP 403 from liveChatMessages: ${errorMsg}. Stopping.`);
      activePollers.delete(pollerKey);
      retryState.delete(pollerKey);
      resumeBroadcastDiscovery(accountId);
      return;
    }
    
    if (statusCode === 404) {
      console.error(`Live chat not found (404) for ${pollerKey}. Stopping.`);
      activePollers.delete(pollerKey);
      retryState.delete(pollerKey);
      resumeBroadcastDiscovery(accountId);
      return;
    }

    state.errorCount++;
    retryState.set(pollerKey, state);
    const backoff = backoffDelay(state.errorCount, 5_000, 60_000);
    console.error(`Error in streamLiveChat (attempt ${state.errorCount}): ${errorMsg}. Retrying in ${Math.round(backoff / 1000)}s.`);
    if (activePollers.has(pollerKey)) {
      const timeout = setTimeout(() => streamLiveChat(accountId, liveChatId, pageToken), backoff);
      pollerTimeouts.set(pollerKey, timeout);
    }
  }
}


export function resumeBroadcastDiscovery(accountId: string) {
  if (!discoveryTimeouts.has(accountId) && !discoveryRunning.has(accountId)) {
    console.log('Resuming discovery for account:', accountId);
    discoverActiveBroadcasts(accountId);
  }
}

export function stopBroadcastDiscovery(accountId?: string) {
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
    for (const key of retryState.keys()) {
      if (key.startsWith(prefix)) retryState.delete(key);
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
    retryState.clear();
    
    for (const timeout of discoveryTimeouts.values()) {
      clearTimeout(timeout);
    }
    discoveryTimeouts.clear();
  }
  youtubeClients.clear();
  discoveryRunning.clear();
}

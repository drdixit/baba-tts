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
      broadcastType: 'all',
      mine: true
    });
    
    const items = broadcastRes.data.items;
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
    if (statusCode === 401) {
      broadcastAuthError();
    }
  } finally {
    const existing = discoveryTimeouts.get(accountId);
    if (existing) clearTimeout(existing);
    
    discoveryTimeouts.set(
      accountId,
      setTimeout(() => discoverActiveBroadcasts(accountId), 60000)
    );
  }
}


export async function streamLiveChat(accountId: string, liveChatId: string, pageToken: string) {
  const pollerKey = `${accountId}:${liveChatId}`;
  if (!activePollers.has(pollerKey)) return;
  
  const row = db.prepare('SELECT refresh_token FROM oauth_accounts WHERE id = ?').get(accountId) as { refresh_token: string } | undefined;
  if (!row || !row.refresh_token) return;

  try {
    const client = getOAuth2Client();
    client.setCredentials({ refresh_token: row.refresh_token });
    const { token } = await client.getAccessToken();
    
    if (!token) throw new Error("No access token obtained");

    let url = `https://youtube.googleapis.com/youtube/v3/liveChatMessages/streamList?part=snippet,authorDetails&liveChatId=${liveChatId}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const state = retryState.get(pollerKey) || { errorCount: 0, gracefulEndCount: 0 };
      
      // Tier 1: Auth error — stop immediately
      if (res.status === 401) {
        console.error(`Auth error (HTTP 401) from streamList. Stopping stream.`);
        activePollers.delete(pollerKey);
        retryState.delete(pollerKey);
        broadcastAuthError();
        return;
      }
      
      // Tier 4: Quota exhausted — stop retrying, surface to user
      if (res.status === 403) {
        const body = await res.text().catch(() => '');
        if (body.includes('quotaExceeded')) {
          console.error(`Quota exhausted. Stopping all retries for ${pollerKey}.`);
          activePollers.delete(pollerKey);
          retryState.delete(pollerKey);
          broadcastQuotaExhausted();
          return;
        }
        // Tier 3: Rate limited (403 but not quota) — aggressive backoff
        if (body.includes('rateLimitExceeded')) {
          state.errorCount++;
          retryState.set(pollerKey, state);
          const delay = backoffDelay(state.errorCount, 30_000, 300_000); // 30s base, 5min cap
          console.warn(`Rate limited. Backing off ${Math.round(delay / 1000)}s for ${pollerKey}.`);
          throw new Error(`rateLimitExceeded`);
        }
        // Other 403 (e.g., liveChatDisabled, liveChatEnded) — stop
        console.error(`Fatal HTTP 403 from streamList: ${body.substring(0, 200)}. Stopping.`);
        activePollers.delete(pollerKey);
        retryState.delete(pollerKey);
        return;
      }
      
      // Tier 3: Rate limited via 429
      if (res.status === 429) {
        const state2 = retryState.get(pollerKey) || { errorCount: 0, gracefulEndCount: 0 };
        state2.errorCount++;
        retryState.set(pollerKey, state2);
        console.warn(`HTTP 429 rate limited for ${pollerKey}.`);
        throw new Error(`rateLimitExceeded`);
      }
      
      // Tier 2: Transient server errors (500, 503, etc.) — exponential backoff
      state.errorCount++;
      retryState.set(pollerKey, state);
      throw new Error(`streamList HTTP ${res.status}: ${res.statusText}`);
    }

    if (!res.body) throw new Error('No body in streamList response');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (activePollers.has(pollerKey)) {
      const { done, value } = await reader.read();
      if (done) {
        // Graceful stream end — track how often this happens consecutively
        const state = retryState.get(pollerKey) || { errorCount: 0, gracefulEndCount: 0 };
        state.gracefulEndCount++;
        retryState.set(pollerKey, state);
        console.log(`Stream ended gracefully for ${pollerKey} (consecutive: ${state.gracefulEndCount})`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || ''; // Keep the incomplete line in the buffer

      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          // Google's stream endpoints sometimes wrap lines in weird formats, but typically they are pure JSON objects or arrays.
          // In case it's Server-Sent Events, it might be `data: {...}`
          let rawJson = line.trim();
          if (rawJson.startsWith('data: ')) {
            rawJson = rawJson.substring(6);
          }
          
          const data = JSON.parse(rawJson);
          
          if (data.items && data.items.length > 0) {
            // Successfully received data — reset all retry counters
            retryState.set(pollerKey, { errorCount: 0, gracefulEndCount: 0 });
            
            const messages: ChatMessage[] = data.items.map((item: any) => {
              const rawName = item.authorDetails?.displayName || 'Unknown';
              const authorId = item.authorDetails?.channelId || '';
              const banned = isUserBanned(authorId);
              
              return {
                messageId: item.id || '',
                authorName: escapeHtml(rawName),
                authorId: authorId,
                authorProfileImageUrl: item.authorDetails?.profileImageUrl,
                authorColor: getDeterministicColor(rawName),
                text: escapeHtml(item.snippet?.displayMessage || ''),
                status: banned ? 'skipped' : 'queued'
              } as ChatMessage;
            });
            
            if (messages.length > 0) {
              broadcastMessages(messages);
              messages.forEach(msg => {
                if (msg.status === 'queued') {
                  enqueueMessageForTTS(msg);
                }
              });
            }
          }
          
          if (data.nextPageToken) {
            pageToken = data.nextPageToken;
          }
        } catch (err) {
          // Ignore parse errors from heartbeat/keep-alive empty arrays or weird chunks
        }
      }
    }
  } catch (error: any) {
    const errorMsg = error.message || '';
    const state = retryState.get(pollerKey) || { errorCount: 0, gracefulEndCount: 0 };
    
    if (errorMsg === 'rateLimitExceeded') {
      // Tier 3: Rate limit — aggressive backoff (30s base, 5min cap)
      const delay = backoffDelay(state.errorCount, 30_000, 300_000);
      console.warn(`Rate limited. Waiting ${Math.round(delay / 1000)}s before reconnecting ${pollerKey}.`);
      if (activePollers.has(pollerKey)) {
        const timeout = setTimeout(() => streamLiveChat(accountId, liveChatId, pageToken), delay);
        pollerTimeouts.set(pollerKey, timeout);
      }
      return;
    }
    
    // Tier 2: Network/transient error — exponential backoff (5s base, 60s cap)
    state.errorCount++;
    retryState.set(pollerKey, state);
    const delay = backoffDelay(state.errorCount, 5_000, 60_000);
    console.error(`Error in streamLiveChat (attempt ${state.errorCount}): ${errorMsg}. Retrying in ${Math.round(delay / 1000)}s.`);
    if (activePollers.has(pollerKey)) {
      const timeout = setTimeout(() => streamLiveChat(accountId, liveChatId, pageToken), delay);
      pollerTimeouts.set(pollerKey, timeout);
    }
    return;
  }

  // If the stream ended gracefully (not via error), reconnect with backoff if it keeps happening
  if (activePollers.has(pollerKey)) {
    const state = retryState.get(pollerKey) || { errorCount: 0, gracefulEndCount: 0 };
    // First graceful end: quick 5s reconnect. Repeated: back off up to 60s.
    const delay = state.gracefulEndCount <= 1
      ? 5_000
      : backoffDelay(state.gracefulEndCount, 5_000, 60_000);
    console.log(`Reconnecting ${pollerKey} in ${Math.round(delay / 1000)}s (graceful end #${state.gracefulEndCount}).`);
    const timeout = setTimeout(() => streamLiveChat(accountId, liveChatId, pageToken), delay);
    pollerTimeouts.set(pollerKey, timeout);
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
}

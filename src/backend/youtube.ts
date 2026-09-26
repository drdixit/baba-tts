import { google } from 'googleapis';
import { db } from './db.js';
import { getOAuth2Client } from './auth.js';
import { broadcastMessage } from './ws.js';
import type { ChatMessage } from '../shared/types.js';

let isPolling = false;
let currentTimeout: NodeJS.Timeout | null = null;

export async function startYouTubePoller(accountId: string) {
  if (isPolling) return;
  
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
    
    isPolling = true;
    pollLiveChat(youtube, liveChatId, '');
    
  } catch (error) {
    console.error('Error starting YouTube poller:', error);
  }
}

async function pollLiveChat(youtube: any, liveChatId: string, pageToken: string) {
  if (!isPolling) return;
  
  try {
    const chatRes = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken: pageToken || undefined,
    });
    
    const nextToken = chatRes.data.nextPageToken || '';
    const pollingInterval = chatRes.data.pollingIntervalMillis || 5000;
    
    const messages = chatRes.data.items || [];
    for (const item of messages) {
      const msg: ChatMessage = {
        messageId: item.id || '',
        authorName: item.authorDetails?.displayName || 'Unknown',
        text: item.snippet?.displayMessage || '',
        status: 'default'
      };
      
      broadcastMessage(msg);
    }
    
    currentTimeout = setTimeout(() => pollLiveChat(youtube, liveChatId, nextToken), pollingInterval);
    
  } catch (error: any) {
    console.error('Error polling live chat:', error.message || error);
    
    let retryWait = 5000;
    if (error.code === 429 || error.code === 500 || error.status === 429 || error.status === 500) {
      console.log('Rate limit or server error. Waiting 10 seconds before retrying...');
      retryWait = 10000;
    }
    
    // Retry with the same pageToken
    currentTimeout = setTimeout(() => pollLiveChat(youtube, liveChatId, pageToken), retryWait);
  }
}

export function stopYouTubePoller() {
  isPolling = false;
  if (currentTimeout) {
    clearTimeout(currentTimeout);
    currentTimeout = null;
  }
}

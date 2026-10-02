import { LiveChat } from 'youtube-chat-next';
import { isUserBanned } from './db.js';
import { broadcastMessages } from './ws.js';
import { enqueueMessageForTTS, clearTTSQueue } from './tts.js';
import { ChatMessage } from '../../src/shared/types.js';
import { getDeterministicColor } from '../../src/shared/colors.js';
import { isSpamMessage } from './spamFilter.js';


function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let unofficialLiveChat: LiveChat | null = null;
let unofficialRetryTimeout: NodeJS.Timeout | null = null;

export function startUnofficialPolling() {
  if (unofficialLiveChat) return;

  const liveIdOverride = process.env.YOUTUBE_LIVE_ID;
  if (liveIdOverride) {
    console.log(`[Unofficial API] Starting YouTube polling for liveId override: ${liveIdOverride}...`);
    unofficialLiveChat = new LiveChat({ liveId: liveIdOverride }, 5000, 'live');
  } else {
    console.log('[Unofficial API] Starting YouTube polling for @babaonpc...');
    unofficialLiveChat = new LiveChat({ handle: '@babaonpc' }, 5000, 'live');
  }

  unofficialLiveChat.on("start", (liveId: string) => {
    console.log(`[Unofficial API] Connected to live stream: ${liveId}`);
    clearTTSQueue(); // Flush old backlog!
  });

  unofficialLiveChat.on("chat", (chatItem: any) => {
    const rawName = chatItem.author.name;
    const authorId = chatItem.author.channelId;
    
    if (isUserBanned(authorId)) return;

    const rawText = chatItem.message.map((m: any) => m.text).join('') || '';
    
    const spamCheck = isSpamMessage(authorId, rawText);
    if (spamCheck.isSpam) {
      console.log(`[Spam Filter] Blocked message from ${rawName}: ${spamCheck.reason}`);
      return;
    }

    const themes = ['subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean'];
    const randomTheme = themes[Math.floor(Math.random() * themes.length)];

    const msg: ChatMessage = {
      messageId: chatItem.id || `msg-${Date.now()}-${Math.random()}`,
      authorName: escapeHtml(rawName),
      authorId: authorId,
      authorProfileImageUrl: chatItem.author.thumbnail?.url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${rawName}`,
      authorColor: getDeterministicColor(rawName),
      text: escapeHtml(rawText),
      status: 'queued',
      theme: randomTheme as any
    };

    if (msg.text.trim().length > 0) {
      broadcastMessages([msg]);
      enqueueMessageForTTS(msg);
    }
  });

  unofficialLiveChat.on("end", (reason: any) => {
    console.log(`[Unofficial API] Stream ended: ${reason}`);
    unofficialLiveChat = null;
    if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
    unofficialRetryTimeout = setTimeout(() => startUnofficialPolling(), 60000);
  });

  unofficialLiveChat.on("error", (err: any) => {
    if (err.name === 'ScrapeError') {
      console.error('[Unofficial API] YouTube changed page structure. Stopping.');
    } else if (err.name === 'RateLimitError') {
      console.warn('[Unofficial API] Rate limited. Backing off...');
    } else {
      console.error('[Unofficial API] Error:', err.message);
    }
  });

  unofficialLiveChat.start().then((ok: boolean) => {
    if (!ok) {
        console.log('[Unofficial API] Failed to start. User might not be live right now. Will retry in 60s.');
        unofficialLiveChat = null;
        if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
        unofficialRetryTimeout = setTimeout(() => startUnofficialPolling(), 60000);
    }
  }).catch((e: any) => {
    console.error('[Unofficial API] Catch block:', e.message);
    unofficialLiveChat = null;
    if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
    unofficialRetryTimeout = setTimeout(() => startUnofficialPolling(), 60000);
  });
}

export function stopBroadcastDiscovery() {
  if (unofficialLiveChat) {
    unofficialLiveChat.stop('Stopped by backend');
    unofficialLiveChat = null;
  }
  if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
}

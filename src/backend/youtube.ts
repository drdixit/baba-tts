import { LiveChat } from 'youtube-chat-next';
import { getAppSettings, isUserBanned } from './db.js';
import { broadcastMessages } from './ws.js';
import { enqueueMessageForTTS, clearTTSQueue } from './tts.js';
import { ChatMessage } from '../../src/shared/types.js';
import { getDeterministicColor } from '../../src/shared/colors.js';
import { isSpamMessage } from './spamFilter.js';


let unofficialLiveChat: LiveChat | null = null;
let unofficialRetryTimeout: NodeJS.Timeout | null = null;

const moderationQueue: any[] = [];
let isModerating = false;

async function processModerationQueue() {
  if (isModerating) return;
  isModerating = true;

  try {
    while (moderationQueue.length > 0) {
      const item = moderationQueue.shift();
      if (!item) continue;
      
      try {
        const { chatItem, rawName, authorId, rawText } = item;
        
        try {
          const modRes = await fetch('http://127.0.0.1:7065/moderate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: rawText }),
            signal: AbortSignal.timeout(1000)
          });
          
          if (modRes.ok) {
            const modData = await modRes.json();
            if (modData.speak === false) {
              console.log(`[Moderation] AI blocked toxic message from ${rawName}`);
              continue;
            }
          }
        } catch (err) {
          console.log(`[Moderation] API offline/timeout, gracefully skipping moderation`);
        }

        const themes = ['subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean'];
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];

        let avatarUrl = chatItem.author.thumbnail?.url;
        if (avatarUrl && avatarUrl.startsWith('//')) {
          avatarUrl = 'https:' + avatarUrl;
        }

        const msg: ChatMessage = {
          messageId: chatItem.id || `msg-${Date.now()}-${Math.random()}`,
          authorName: rawName,
          authorId: authorId,
          authorProfileImageUrl: avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(rawName)}`,
          authorColor: getDeterministicColor(rawName),
          text: rawText,
          status: 'queued',
          theme: randomTheme as any
        };

        if (msg.text.trim().length > 0) {
          broadcastMessages([msg]);
          enqueueMessageForTTS(msg);
        }
      } catch (innerErr) {
        console.error("[Queue] Error processing individual message:", innerErr);
      }
    }
  } finally {
    isModerating = false;
  }
}

export function startUnofficialPolling() {
  const settings = getAppSettings();
  if (!settings.enableYoutube || unofficialLiveChat) return;

  const liveIdOverride = settings.youtubeLiveId;
  const channelId = settings.youtubeChannelId || 'UCiz4lqlVpaB4PpK-1aecMgQ';
  let liveChat: LiveChat;

  if (liveIdOverride) {
    console.log(`[Unofficial API] Starting YouTube polling for liveId override: ${liveIdOverride}...`);
    liveChat = new LiveChat({ liveId: liveIdOverride }, 5000, 'live');
  } else if (channelId) {
    console.log(`[Unofficial API] Starting YouTube polling for channelId: ${channelId}...`);
    liveChat = new LiveChat({ channelId }, 5000, 'live');
  } else {
    console.log('[Unofficial API] Starting YouTube polling for @babaજી...');
    liveChat = new LiveChat({ handle: '@babaજી' }, 5000, 'live');
  }
  unofficialLiveChat = liveChat;

  liveChat.on("start", (liveId: string) => {
    if (unofficialLiveChat !== liveChat) return;
    console.log(`[Unofficial API] Connected! Polling started. Using liveId: ${liveId}`);
    clearTTSQueue(); // Flush old backlog!
    moderationQueue.length = 0;
  });

  liveChat.on("chat", (chatItem: any) => {
    if (unofficialLiveChat !== liveChat) return;
    try {
      const rawName = chatItem.author.name;
    const authorId = chatItem.author.channelId;
    
    if (isUserBanned(authorId)) return;

    const rawText = chatItem.message.map((m: any) => {
      if ("text" in m) return m.text;
      return m.emojiText || m.alt || '';
    }).join('');
    
    if (!rawText || rawText.trim().length === 0) return;

    const spamCheck = isSpamMessage(authorId, rawText);
    if (spamCheck.isSpam) {
      console.log(`[Spam Filter] Blocked message from ${rawName}: ${spamCheck.reason}`);
      return;
    }

    moderationQueue.push({ chatItem, rawName, authorId, rawText });
    processModerationQueue();
    } catch (err) {
      console.error("[Unofficial API] Error parsing chat item:", err);
    }
  });

  liveChat.on("end", (reason: any) => {
    if (unofficialLiveChat !== liveChat) return;
    console.log(`[Unofficial API] Stream ended: ${reason}`);
    unofficialLiveChat = null;
    if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
    unofficialRetryTimeout = setTimeout(() => startUnofficialPolling(), 60000);
  });

  liveChat.on("error", (err: any) => {
    if (err.name === 'ScrapeError') {
      console.error('[Unofficial API] YouTube changed page structure. Stopping.');
    } else if (err.name === 'RateLimitError') {
      console.warn('[Unofficial API] Rate limited. Backing off...');
    } else {
      console.error('[Unofficial API] Error:', err.message);
    }
  });

  liveChat.start().then((ok: boolean) => {
    if (unofficialLiveChat !== liveChat) return;
    if (!ok) {
        console.log('[Unofficial API] Failed to start. User might not be live right now. Will retry in 60s.');
        unofficialLiveChat = null;
        if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
        unofficialRetryTimeout = setTimeout(() => startUnofficialPolling(), 60000);
    }
  }).catch((e: any) => {
    if (unofficialLiveChat !== liveChat) return;
    console.error('[Unofficial API] Catch block:', e.message);
    unofficialLiveChat = null;
    if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
    unofficialRetryTimeout = setTimeout(() => startUnofficialPolling(), 60000);
  });
}

export function stopBroadcastDiscovery() {
  const liveChat = unofficialLiveChat;
  unofficialLiveChat = null;
  if (liveChat) liveChat.stop('Stopped by backend');
  if (unofficialRetryTimeout) clearTimeout(unofficialRetryTimeout);
  unofficialRetryTimeout = null;
}

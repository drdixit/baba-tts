import 'dotenv/config';
import { initWebSocketServer } from './ws.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { startUnofficialPolling } from './youtube.js';

const app = new Hono();

app.get('/', (c) => c.text('Baba TTS Server Running'));
app.get('/api/skip-current', async (c) => {
  const { skipCurrentMessage } = await import('./tts.js');
  skipCurrentMessage();
  return c.text('Skipped');
});

app.get('/api/skip-ban-current', async (c) => {
  const { getCurrentProcessingMessage, removeUserFromQueue } = await import('./tts.js');
  const { banUser } = await import('./db.js');
  const { broadcastBannedUsers } = await import('./ws.js');
  
  const currentMsg = getCurrentProcessingMessage();
  if (currentMsg && currentMsg.authorId) {
    banUser(currentMsg.authorId, currentMsg.authorName, currentMsg.authorProfileImageUrl);
    broadcastBannedUsers();
    removeUserFromQueue(currentMsg.authorId);
    return c.text(`Banned and skipped: ${currentMsg.authorName}`);
  }
  return c.text('No active message to ban');
});

app.post('/api/baba-say', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.text || typeof body.text !== 'string') {
    return c.json({ error: 'Missing or invalid "text" field' }, 400);
  }
  const { enqueuePriorityMessage } = await import('./tts.js');
  enqueuePriorityMessage(body.text);
  return c.json({ success: true, text: body.text });
});

app.post('/api/speak-as-banned', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.text || typeof body.text !== 'string') {
    return c.json({ error: 'Missing or invalid "text" field' }, 400);
  }

  const { getLastBannedUser } = await import('./db.js');
  const { enqueuePriorityCustomMessage } = await import('./tts.js');
  const { getDeterministicColor } = await import('../shared/colors.js');

  const lastBanned = getLastBannedUser();
  if (!lastBanned) {
    return c.json({ error: 'No banned users found' }, 404);
  }

  const themes = ['subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean'];
  const randomTheme = themes[Math.floor(Math.random() * themes.length)];

  enqueuePriorityCustomMessage({
    messageId: `impersonate-${Date.now()}-${Math.random()}`,
    authorName: lastBanned.displayName,
    authorId: lastBanned.authorId,
    authorProfileImageUrl: lastBanned.profileImageUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${lastBanned.displayName}`,
    authorColor: getDeterministicColor(lastBanned.displayName),
    text: body.text,
    status: 'queued',
    theme: randomTheme as any,
  });

  return c.json({ success: true, user: lastBanned.displayName, message: body.text });
});

const port = 7060;
console.log(`Server is running on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port
});

initWebSocketServer(server as any);

// No startup DB cleanup needed anymore (app is 100% read-only)

// Start Unofficial YouTube Polling directly if enabled
if (process.env.ENABLE_YOUTUBE === 'true') {
  startUnofficialPolling();
} else {
  console.log('[TTS] YouTube polling disabled via ENABLE_YOUTUBE flag.');
}

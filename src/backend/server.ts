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

app.post('/api/baba-say', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.text || typeof body.text !== 'string') {
    return c.json({ error: 'Missing or invalid "text" field' }, 400);
  }
  const { enqueuePriorityMessage } = await import('./tts.js');
  enqueuePriorityMessage(body.text);
  return c.json({ success: true, text: body.text });
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

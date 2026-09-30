import 'dotenv/config';
import { initWebSocketServer } from './ws.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRouter } from './auth.js';

import { db } from './db.js';
import { discoverActiveBroadcasts } from './youtube.js';

const app = new Hono();

app.route('/auth', authRouter);

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

// Resume polling for existing accounts
const accounts = db.prepare('SELECT id FROM oauth_accounts').all() as { id: string }[];
for (const acc of accounts) {
  console.log(`Resuming discovery for account: ${acc.id}`);
  discoverActiveBroadcasts(acc.id).catch(err => {
    console.error(`Failed to resume discovery for ${acc.id}:`, err);
  });
}

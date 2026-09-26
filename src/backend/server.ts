import { initWebSocketServer } from './ws.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRouter } from './auth.js';
import { moderationRouter } from './moderation.js';

import { db } from './db.js';
import { startYouTubePoller } from './youtube.js';

const app = new Hono();

app.route('/auth', authRouter);
app.route('/api', moderationRouter);

app.get('/', (c) => c.text('Baba TTS Server Running'));

const port = 7060;
console.log(`Server is running on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port
});

initWebSocketServer(server as any);

// Resume polling for existing accounts
const accounts = db.prepare('SELECT id FROM oauth_accounts').all() as { id: string }[];
for (const acc of accounts) {
  console.log(`Resuming poller for account: ${acc.id}`);
  startYouTubePoller(acc.id).catch(err => {
    console.error(`Failed to resume poller for ${acc.id}:`, err);
  });
}

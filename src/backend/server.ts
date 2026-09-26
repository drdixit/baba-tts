import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authRouter } from './auth.js';

const app = new Hono();

app.route('/auth', authRouter);

app.get('/', (c) => c.text('Baba TTS Server Running'));

const port = 7060;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});

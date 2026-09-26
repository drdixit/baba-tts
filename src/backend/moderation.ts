import { Hono } from 'hono';
import { z } from 'zod';
import { google } from 'googleapis';
import { getCookie } from 'hono/cookie';
import { db } from './db.js';
import { getOAuth2Client } from './auth.js';
import { broadcastMessageDelete } from './ws.js';

export const moderationRouter = new Hono();

import { ModerationActionSchema } from '../shared/types.js';

moderationRouter.post('/moderate', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionRow = db.prepare('SELECT account_id FROM sessions WHERE id = ?').get(sessionId) as { account_id: string } | undefined;
  if (!sessionRow) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const accountId = sessionRow.account_id;
  const accountRow = db.prepare('SELECT refresh_token FROM oauth_accounts WHERE id = ?').get(accountId) as { refresh_token: string } | undefined;
  if (!accountRow || !accountRow.refresh_token) {
    return c.json({ error: 'OAuth account not found or not connected' }, 401);
  }

  let body;
  try {
    const rawBody = await c.req.json();
    body = ModerationActionSchema.parse(rawBody);
  } catch (error) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { messageId, action, durationSeconds } = body;
  
  const cached = db.prepare('SELECT live_chat_id, author_channel_id FROM messages WHERE id = ?').get(messageId) as { live_chat_id: string; author_channel_id: string } | undefined;

  if (action === 'timeout' || action === 'ban') {
    if (!cached) {
      return c.json({ error: 'Message details not found in cache to perform ban' }, 404);
    }
  }

  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: accountRow.refresh_token });
  const youtube = google.youtube({ version: 'v3', auth: client });

  try {
    if (action === 'delete') {
      await youtube.liveChatMessages.delete({ id: messageId });
    } else if (action === 'timeout' || action === 'ban') {
      const type = action === 'timeout' ? 'temporary' : 'permanent';
      const banDurationSeconds = action === 'timeout' ? (durationSeconds || 300) : undefined;

      await youtube.liveChatBans.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            liveChatId: cached!.live_chat_id,
            type,
            banDurationSeconds: banDurationSeconds ? String(banDurationSeconds) : undefined,
            bannedUserDetails: {
              channelId: cached!.author_channel_id
            }
          }
        }
      });
    }

    broadcastMessageDelete(messageId);

    return c.json({ success: true });
  } catch (error: any) {
    console.error('Moderation action failed:', error);
    return c.json({ error: 'Moderation action failed', details: error.message }, 500);
  }
});

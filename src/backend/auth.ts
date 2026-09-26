import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { google } from 'googleapis';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { db } from './db.js';

const authRouter = new Hono();

let oauth2Client: any = null;

function getOAuth2Client() {
  if (oauth2Client) return oauth2Client;
  
  const files = readdirSync(process.cwd()).filter(f => f.startsWith('client_secret_') && f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error('No client_secret_*.json found in project root');
  }
  
  const filePath = join(process.cwd(), files[0]);
  const content = JSON.parse(readFileSync(filePath, 'utf-8'));
  
  // Handle both "web" and "installed" types of OAuth credentials
  const creds = content.web || content.installed;
  if (!creds) {
    throw new Error('Invalid client secret format');
  }
  
  oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris?.[0] || 'http://localhost:7060/auth/google/callback'
  );
  
  return oauth2Client;
}

authRouter.get('/google', (c) => {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ]
  });
  return c.redirect(url);
});

authRouter.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('No code provided', 400);
  }
  
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  
  client.setCredentials(tokens);
  
  const youtube = google.youtube({
    version: 'v3',
    auth: client
  });
  
  let accountId: string = randomUUID();
  let channelId = null;
  
  try {
    const channelRes = await youtube.channels.list({ part: ['id'], mine: true });
    if (channelRes.data.items && channelRes.data.items.length > 0) {
      channelId = channelRes.data.items[0].id;
      if (channelId) {
        accountId = channelId; // Use channel ID as the account ID if available
      }
    }
  } catch (err) {
    console.error('Failed to fetch youtube channel:', err);
  }
  
  if (tokens.refresh_token) {
    const insertAccount = db.prepare(`
      INSERT INTO oauth_accounts (id, refresh_token, channel_id) 
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET refresh_token=excluded.refresh_token, channel_id=excluded.channel_id
    `);
    insertAccount.run(accountId, tokens.refresh_token, channelId);
  } else {
    const exists = db.prepare('SELECT id FROM oauth_accounts WHERE id = ?').get(accountId);
    if (!exists) {
      const insertAccount = db.prepare(`
        INSERT INTO oauth_accounts (id, refresh_token, channel_id)
        VALUES (?, ?, ?)
      `);
      insertAccount.run(accountId, '', channelId);
    }
  }
  
  const sessionId = randomUUID();
  db.prepare(`
    INSERT INTO sessions (id, account_id) VALUES (?, ?)
  `).run(sessionId, accountId);
  
  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    path: '/',
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7
  });
  
  return c.text('Authentication successful! You can close this window.');
});

export { authRouter };

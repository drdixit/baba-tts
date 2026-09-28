import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { google } from 'googleapis';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { db } from './db.js';
import { discoverActiveBroadcasts } from './youtube.js';

const authRouter = new Hono();

let cachedCreds: { client_id: string; client_secret: string; redirect_uris?: string[] } | null = null;

export function getOAuth2Client() {
  if (!cachedCreds) {
    const files = readdirSync(process.cwd()).filter(f => f.startsWith('client_secret_') && f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error('No client_secret_*.json found in project root');
    }
    
    const filePath = join(process.cwd(), files[0]);
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    
    // Handle both "web" and "installed" types of OAuth credentials
    cachedCreds = content.web || content.installed;
    if (!cachedCreds) {
      throw new Error('Invalid client secret format');
    }
  }
  
  return new google.auth.OAuth2(
    cachedCreds.client_id,
    cachedCreds.client_secret,
    cachedCreds.redirect_uris?.[0] || 'http://localhost:7060/auth/google/callback'
  );
}

authRouter.get('/google', (c) => {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly'
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
  
  // Since this is a single-user local app, we use your fixed YouTube Channel ID
  // to avoid querying the API to figure out who you are (saving 1 quota unit).
  const accountId = process.env.YOUTUBE_CHANNEL_ID || 'UCHEiIMMqN9LFoBHbnykg0KQ';
  
  if (tokens.refresh_token) {
    db.prepare('DELETE FROM oauth_accounts').run();
    db.prepare(`
      INSERT INTO oauth_accounts (id, refresh_token, channel_id) 
      VALUES (?, ?, ?)
    `).run(accountId, tokens.refresh_token, null);
  } else {
    // If we didn't get a refresh token (e.g., already authorized), just ensure the row exists
    const exists = db.prepare('SELECT id FROM oauth_accounts WHERE id = ?').get(accountId);
    if (!exists) {
      console.error('No refresh token provided by Google and no existing account found.');
      return c.text('Authorization failed: No refresh token provided by Google. Please try connecting again and ensure you grant full access.', 400);
    }
  }
  
  setCookie(c, 'session', 'dummy-session-id', {
    httpOnly: true,
    secure: true,
    path: '/',
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7
  });
  
  discoverActiveBroadcasts(accountId);
  
  return c.redirect('http://localhost:7061/');
});

export { authRouter };

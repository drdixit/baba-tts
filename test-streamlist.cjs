const { google } = require('googleapis');
const db = require('better-sqlite3')('baba.db');
const fs = require('fs');

async function test() {
  const accounts = db.prepare('SELECT id, refresh_token FROM oauth_accounts LIMIT 1').all();
  if (!accounts.length) return console.log("no accounts");
  const account = accounts[0];
  
  const files = fs.readdirSync('.');
  const secretFile = files.find(f => f.startsWith('client_secret_') && f.endsWith('.json'));
  const creds = JSON.parse(fs.readFileSync(secretFile, 'utf8')).web;
  
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris[0]
  );
  
  oauth2Client.setCredentials({ refresh_token: account.refresh_token });
  const res = await oauth2Client.getAccessToken();
  const token = res.token;
  console.log("Got access token!");
  
  const response = await fetch(`https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const broadcasts = await response.json();
  if (broadcasts.error) {
     console.error(broadcasts.error.message);
     return;
  }
  if (!broadcasts.items || !broadcasts.items.length) {
     console.log("No active broadcast to get liveChatId");
     return;
  }
  const liveChatId = broadcasts.items[0].snippet.liveChatId;
  console.log("Got liveChatId:", liveChatId);
  
  // Now try streamList
  console.log("Testing streamList endpoint...");
  const streamRes = await fetch(`https://youtube.googleapis.com/youtube/v3/liveChatMessages/streamList?part=snippet,authorDetails&liveChatId=${liveChatId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  console.log(streamRes.status, streamRes.statusText);
  if (streamRes.status !== 200) {
     const errorBody = await streamRes.text();
     console.log(errorBody);
  } else {
     console.log("streamList request successful. It is a valid endpoint!");
  }
}
test();

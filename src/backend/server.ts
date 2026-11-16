import 'dotenv/config';
import { initWebSocketServer, isLocalDevOrigin } from './ws.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { startUnofficialPolling, stopBroadcastDiscovery } from './youtube.js';
import { getAppSettings, saveAppSettings, type AppSettings } from './db.js';

const app = new Hono();

app.use('/api/*', async (c, next) => {
  if (
    c.req.header('Sec-Fetch-Site') === 'cross-site' ||
    !isLocalDevOrigin(c.req.header('Origin'))
  ) {
    return c.text('Requests from non-local origins are not allowed', 403);
  }
  await next();
});

app.get('/', (c) => c.text('Baba TTS Server Running'));

function toSettingsResponse(settings: AppSettings) {
  return {
    azureSpeechKeyConfigured: Boolean(settings.azureSpeechKey.trim()),
    azureSpeechRegion: settings.azureSpeechRegion,
    azureSpeechVoice: settings.azureSpeechVoice,
    azureSpeechVoices: settings.azureSpeechVoices,
    azureSpeechVoiceRotation: settings.azureSpeechVoiceRotation,
    youtubeChannelId: settings.youtubeChannelId,
    youtubeLiveId: settings.youtubeLiveId,
    enableYoutube: settings.enableYoutube,
  };
}

app.get('/api/settings', (c) => c.json(toSettingsResponse(getAppSettings())));

app.post('/api/settings', async (c) => {
  const payload: unknown = await c.req.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return c.text('Invalid settings payload.', 400);
  }

  const values = payload as Record<string, unknown>;
  if (
    typeof values.azureSpeechRegion !== 'string' ||
    typeof values.azureSpeechVoice !== 'string' ||
    (values.azureSpeechVoices !== undefined && (!Array.isArray(values.azureSpeechVoices) || values.azureSpeechVoices.some((voice) => typeof voice !== 'string'))) ||
    (values.azureSpeechVoiceRotation !== undefined && typeof values.azureSpeechVoiceRotation !== 'boolean') ||
    typeof values.youtubeChannelId !== 'string' ||
    !(typeof values.youtubeLiveId === 'string' || values.youtubeLiveId === null || values.youtubeLiveId === undefined) ||
    typeof values.enableYoutube !== 'boolean' ||
    (values.azureSpeechKey !== undefined && typeof values.azureSpeechKey !== 'string') ||
    (values.clearAzureSpeechKey !== undefined && typeof values.clearAzureSpeechKey !== 'boolean')
  ) {
    return c.text('Invalid settings payload.', 400);
  }

  const current = getAppSettings();
  const submittedKey = typeof values.azureSpeechKey === 'string' ? values.azureSpeechKey.trim() : '';
  const submittedVoices = Array.isArray(values.azureSpeechVoices)
    ? [...new Set((values.azureSpeechVoices as string[]).map((voice) => voice.trim()).filter(Boolean))]
    : [values.azureSpeechVoice];
  const azureSpeechVoiceRotation = values.azureSpeechVoiceRotation === true;
  const azureSpeechVoices = submittedVoices.length > 0 ? submittedVoices : [values.azureSpeechVoice];
  const settings: AppSettings = {
    azureSpeechKey: values.clearAzureSpeechKey
      ? ''
      : submittedKey || current.azureSpeechKey,
    azureSpeechRegion: values.azureSpeechRegion,
    azureSpeechVoice: azureSpeechVoiceRotation ? azureSpeechVoices[0] : values.azureSpeechVoice,
    azureSpeechVoices,
    azureSpeechVoiceRotation,
    youtubeChannelId: values.youtubeChannelId,
    youtubeLiveId: typeof values.youtubeLiveId === 'string' ? values.youtubeLiveId : null,
    enableYoutube: values.enableYoutube,
  };

  saveAppSettings(settings);
  stopBroadcastDiscovery();
  if (settings.enableYoutube) startUnofficialPolling();
  return c.json({ success: true, settings: toSettingsResponse(settings) });
});

app.get('/api/voices', async (c) => {
  const settings = getAppSettings();
  if (!settings.azureSpeechKey.trim()) {
    return c.json({ error: 'Enter and save an Azure Speech key to load voices.' }, 428);
  }

  const requestedRegion = c.req.query('region') ?? settings.azureSpeechRegion;
  const region = requestedRegion.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$/.test(region)) {
    return c.json({ error: 'Enter a valid Azure Speech region.' }, 400);
  }

  let response: Response;
  try {
    response = await fetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      {
        headers: { 'Ocp-Apim-Subscription-Key': settings.azureSpeechKey },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    console.warn(`[Azure] Voice catalog request failed for region ${region}:`, error);
    return c.json({ error: 'Could not reach Azure Speech. Check the region and network connection.' }, 502);
  }

  if (!response.ok) {
    const error = response.status === 401 || response.status === 403
      ? 'Azure rejected the saved Speech key or region. Check both settings and try again.'
      : 'Azure Speech could not return voices for this region. Check the region and try again.';
    return c.json({ error }, 502);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return c.json({ error: 'Azure Speech returned an invalid voice list.' }, 502);
  }

  const voices = payload.flatMap((voice: unknown) => {
    if (!voice || typeof voice !== 'object' || Array.isArray(voice)) return [];
    const raw = voice as Record<string, unknown>;
    if (typeof raw.ShortName !== 'string') return [];
    const value = (key: string) => typeof raw[key] === 'string' ? raw[key] as string : undefined;
    const list = (key: string) => Array.isArray(raw[key])
      ? (raw[key] as unknown[]).filter((item): item is string => typeof item === 'string')
      : undefined;
    return [{
      shortName: raw.ShortName,
      displayName: value('DisplayName') ?? value('LocalName') ?? raw.ShortName,
      localName: value('LocalName'),
      locale: value('Locale') ?? '',
      localeName: value('LocaleName'),
      gender: value('Gender'),
      voiceType: value('VoiceType'),
      status: value('Status'),
      styleList: list('StyleList'),
      secondaryLocaleList: list('SecondaryLocaleList'),
    }];
  });
  voices.sort((left, right) =>
    (left.localeName ?? left.locale).localeCompare(right.localeName ?? right.locale) ||
    left.shortName.localeCompare(right.shortName),
  );

  return c.json({ region, count: voices.length, voices });
});

app.post('/api/skip-current', async (c) => {
  const { skipCurrentMessage } = await import('./tts.js');
  skipCurrentMessage();
  return c.text('Skipped');
});

app.post('/api/skip-ban-current', async (c) => {
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
  port,
  hostname: '127.0.0.1'
});

initWebSocketServer(server as any);

// Start polling from the persisted application settings.
if (getAppSettings().enableYoutube) {
  startUnofficialPolling();
} else {
  console.log('[TTS] YouTube polling disabled in settings.');
}

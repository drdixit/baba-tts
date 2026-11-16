import Database from 'better-sqlite3';
import { join } from 'path';

import type { Database as DatabaseType } from 'better-sqlite3';

// Initialize the database in the project root.
const dbPath = join(process.cwd(), 'baba.db');

export const db: DatabaseType = new Database(dbPath);

export function initDb() {
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      channel_id TEXT
    );
    CREATE TABLE IF NOT EXISTS banned_users (
      author_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      profile_image_url TEXT,
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// Automatically initialize tables
initDb();

export interface BannedUser {
  authorId: string;
  displayName: string;
  profileImageUrl?: string;
  bannedAt: string;
}

export function banUser(authorId: string, displayName: string, profileImageUrl?: string) {
  const stmt = db.prepare('INSERT OR REPLACE INTO banned_users (author_id, display_name, profile_image_url) VALUES (?, ?, ?)');
  stmt.run(authorId, displayName, profileImageUrl || null);
}

export function unbanUser(authorId: string) {
  const stmt = db.prepare('DELETE FROM banned_users WHERE author_id = ?');
  stmt.run(authorId);
}

export function getBannedUsers(): BannedUser[] {
  const stmt = db.prepare('SELECT author_id as authorId, display_name as displayName, profile_image_url as profileImageUrl, banned_at as bannedAt FROM banned_users ORDER BY banned_at DESC');
  return stmt.all() as BannedUser[];
}

export function getLastBannedUser(): BannedUser | null {
  const stmt = db.prepare('SELECT author_id as authorId, display_name as displayName, profile_image_url as profileImageUrl, banned_at as bannedAt FROM banned_users ORDER BY banned_at DESC LIMIT 1');
  const result = stmt.get();
  return result ? (result as BannedUser) : null;
}

export function isUserBanned(authorId: string): boolean {
  if (!authorId) return false;
  const stmt = db.prepare('SELECT 1 FROM banned_users WHERE author_id = ? LIMIT 1');
  return !!stmt.get(authorId);
}

export interface AppSettings {
  azureSpeechKey: string;
  azureSpeechRegion: string;
  azureSpeechVoice: string;
  azureSpeechVoices: string[];
  azureSpeechVoiceRotation: boolean;
  youtubeChannelId: string;
  youtubeLiveId: string | null;
  enableYoutube: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  azureSpeechKey: '',
  azureSpeechRegion: 'centralindia',
  azureSpeechVoice: 'hi-IN-MadhurNeural',
  azureSpeechVoices: ['hi-IN-MadhurNeural'],
  azureSpeechVoiceRotation: false,
  youtubeChannelId: 'UCiz4lqlVpaB4PpK-1aecMgQ',
  youtubeLiveId: null,
  enableYoutube: true,
};

function getSetting(key: string): string | undefined {
  return db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as string | undefined;
}

function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getAppSettings(): AppSettings {
  const saved = (key: string, envKey?: string) => {
    const value = getSetting(key);
    return value !== undefined ? value : (envKey ? process.env[envKey] : undefined);
  };
  const liveId = saved('youtube_live_id', 'YOUTUBE_LIVE_ID');
  const azureSpeechVoice = saved('azure_speech_voice') ?? DEFAULT_SETTINGS.azureSpeechVoice;
  let azureSpeechVoices = [azureSpeechVoice];
  try {
    const parsed = JSON.parse(saved('azure_speech_voices') ?? 'null') as unknown;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((voice): voice is string => typeof voice === 'string' && voice.trim().length > 0)
        .map((voice) => voice.trim());
      if (valid.length > 0) azureSpeechVoices = [...new Set(valid)];
    }
  } catch {
    // Older or malformed values fall back to the saved single voice.
  }

  return {
    azureSpeechKey: saved('azure_speech_key', 'AZURE_SPEECH_KEY') ?? DEFAULT_SETTINGS.azureSpeechKey,
    azureSpeechRegion: saved('azure_speech_region', 'AZURE_SPEECH_REGION') ?? DEFAULT_SETTINGS.azureSpeechRegion,
    azureSpeechVoice,
    azureSpeechVoices,
    azureSpeechVoiceRotation: ['true', '1'].includes(saved('azure_speech_voice_rotation') ?? 'false'),
    youtubeChannelId: saved('youtube_channel_id', 'YOUTUBE_CHANNEL_ID') ?? DEFAULT_SETTINGS.youtubeChannelId,
    youtubeLiveId: liveId?.trim() ? liveId : null,
    enableYoutube: ['true', '1'].includes(
      saved('enable_youtube', 'ENABLE_YOUTUBE') ?? String(DEFAULT_SETTINGS.enableYoutube),
    ),
  };
}

export function saveAppSettings(settings: AppSettings): void {
  const save = db.transaction(() => {
    setSetting('azure_speech_key', settings.azureSpeechKey);
    setSetting('azure_speech_region', settings.azureSpeechRegion);
    setSetting('azure_speech_voice', settings.azureSpeechVoice);
    setSetting('azure_speech_voices', JSON.stringify(settings.azureSpeechVoices));
    setSetting('azure_speech_voice_rotation', settings.azureSpeechVoiceRotation ? 'true' : 'false');
    setSetting('youtube_channel_id', settings.youtubeChannelId);
    setSetting('youtube_live_id', settings.youtubeLiveId ?? '');
    setSetting('enable_youtube', settings.enableYoutube ? 'true' : 'false');
  });
  save();
}

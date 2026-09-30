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

export function isUserBanned(authorId: string): boolean {
  if (!authorId) return false;
  const stmt = db.prepare('SELECT 1 FROM banned_users WHERE author_id = ? LIMIT 1');
  return !!stmt.get(authorId);
}

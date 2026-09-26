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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES oauth_accounts(id)
    );
  `);
}

// Automatically initialize tables
initDb();

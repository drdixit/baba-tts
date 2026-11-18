use crate::types::{AppSettings, BannedUser};
use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("Failed to open SQLite database at {}", path))?;

        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS banned_users (
                author_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                profile_image_url TEXT,
                banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS moderation_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                action TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS banned_users (
                author_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                profile_image_url TEXT,
                banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS moderation_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                action TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn default_db_path() -> std::path::PathBuf {
        #[cfg(windows)]
        {
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let dir = std::path::PathBuf::from(local_app_data).join("baba-tts");
                let _ = std::fs::create_dir_all(&dir);
                return dir.join("baba.db");
            }
        }

        if let Ok(home) = std::env::var("HOME") {
            let dir = std::path::PathBuf::from(home).join(".baba-tts");
            let _ = std::fs::create_dir_all(&dir);
            return dir.join("baba.db");
        }

        std::path::PathBuf::from("baba.db")
    }

    fn acquire_conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| {
            tracing::warn!("[DB] Recovering from poisoned mutex");
            poisoned.into_inner()
        })
    }

    pub fn ban_user(&self, author_id: &str, display_name: &str, profile_image_url: Option<&str>) -> Result<()> {
        let conn = self.acquire_conn();
        conn.execute(
            "INSERT OR REPLACE INTO banned_users (author_id, display_name, profile_image_url, banned_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)",
            params![author_id, display_name, profile_image_url],
        )?;
        Ok(())
    }

    pub fn unban_user(&self, author_id: &str) -> Result<()> {
        let conn = self.acquire_conn();
        conn.execute("DELETE FROM banned_users WHERE author_id = ?1", params![author_id])?;
        Ok(())
    }

    pub fn is_user_banned(&self, author_id: &str) -> bool {
        if author_id.is_empty() {
            return false;
        }
        let conn = self.acquire_conn();
        let mut stmt = match conn.prepare("SELECT 1 FROM banned_users WHERE author_id = ?1 LIMIT 1") {
            Ok(s) => s,
            Err(_) => return false,
        };
        stmt.exists(params![author_id]).unwrap_or(false)
    }

    pub fn get_banned_users(&self) -> Result<Vec<BannedUser>> {
        let conn = self.acquire_conn();
        let mut stmt = conn.prepare(
            "SELECT author_id, display_name, profile_image_url, banned_at FROM banned_users ORDER BY banned_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BannedUser {
                author_id: row.get(0)?,
                display_name: row.get(1)?,
                profile_image_url: row.get(2)?,
                banned_at: row.get(3)?,
            })
        })?;

        let mut users = Vec::new();
        for r in rows {
            users.push(r?);
        }
        Ok(users)
    }

    pub fn get_last_banned_user(&self) -> Result<Option<BannedUser>> {
        let conn = self.acquire_conn();
        let mut stmt = conn.prepare(
            "SELECT author_id, display_name, profile_image_url, banned_at FROM banned_users ORDER BY banned_at DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], |row| {
            Ok(BannedUser {
                author_id: row.get(0)?,
                display_name: row.get(1)?,
                profile_image_url: row.get(2)?,
                banned_at: row.get(3)?,
            })
        })?;

        if let Some(user) = rows.next() {
            Ok(Some(user?))
        } else {
            Ok(None)
        }
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.acquire_conn();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get(0))?;
        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.acquire_conn();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> Result<AppSettings> {
        let mut settings = AppSettings::default();

        if let Some(val) = self.get_setting("tts_provider")? {
            if val == "sapi5" || val == "azure" {
                settings.tts_provider = val;
            }
        }

        if let Some(val) = self.get_setting("azure_speech_key")? {
            settings.azure_speech_key = val;
        } else if let Ok(env_val) = std::env::var("AZURE_SPEECH_KEY") {
            settings.azure_speech_key = env_val;
        }

        if let Some(val) = self.get_setting("azure_speech_region")? {
            settings.azure_speech_region = val;
        } else if let Ok(env_val) = std::env::var("AZURE_SPEECH_REGION") {
            settings.azure_speech_region = env_val;
        }

        if let Some(val) = self.get_setting("azure_speech_voice")? {
            settings.azure_speech_voice = val;
        }

        let mut has_saved_voice_pool = false;
        if let Some(val) = self.get_setting("azure_speech_voices")? {
            if let Ok(voices) = serde_json::from_str::<Vec<String>>(&val) {
                let voices: Vec<String> = voices
                    .into_iter()
                    .map(|voice| voice.trim().to_string())
                    .filter(|voice| !voice.is_empty())
                    .collect();
                if !voices.is_empty() {
                    settings.azure_speech_voices = voices;
                    has_saved_voice_pool = true;
                }
            }
        }
        if !has_saved_voice_pool {
            settings.azure_speech_voices = vec![settings.azure_speech_voice.clone()];
        }

        if let Some(val) = self.get_setting("azure_speech_voice_rotation")? {
            settings.azure_speech_voice_rotation = val == "true" || val == "1";
        }

        if let Some(val) = self.get_setting("sapi_voice")? {
            settings.sapi_voice = val;
        }

        let mut has_saved_sapi_pool = false;
        if let Some(val) = self.get_setting("sapi_voices")? {
            if let Ok(voices) = serde_json::from_str::<Vec<String>>(&val) {
                let voices: Vec<String> = voices
                    .into_iter()
                    .map(|voice| voice.trim().to_string())
                    .filter(|voice| !voice.is_empty())
                    .collect();
                if !voices.is_empty() {
                    settings.sapi_voices = voices;
                    has_saved_sapi_pool = true;
                }
            }
        }
        if !has_saved_sapi_pool {
            settings.sapi_voices = vec![settings.sapi_voice.clone()];
        }

        if let Some(val) = self.get_setting("sapi_voice_rotation")? {
            settings.sapi_voice_rotation = val == "true" || val == "1";
        }

        if let Some(val) = self.get_setting("sapi_rate")? {
            if let Ok(rate) = val.parse::<i32>() {
                settings.sapi_rate = rate.clamp(-10, 10);
            }
        }

        if let Some(val) = self.get_setting("sapi_volume")? {
            if let Ok(vol) = val.parse::<u32>() {
                settings.sapi_volume = vol.min(100);
            }
        }

        if let Some(val) = self.get_setting("master_volume")? {
            if let Ok(vol) = val.parse::<u32>() {
                settings.master_volume = vol.min(100);
            }
        }

        if let Some(val) = self.get_setting("youtube_channel_id")? {
            settings.youtube_channel_id = val;
        } else if let Ok(env_val) = std::env::var("YOUTUBE_CHANNEL_ID") {
            settings.youtube_channel_id = env_val;
        }

        if let Some(val) = self.get_setting("youtube_live_id")? {
            settings.youtube_live_id = if val.trim().is_empty() { None } else { Some(val) };
        } else if let Ok(env_val) = std::env::var("YOUTUBE_LIVE_ID") {
            settings.youtube_live_id = if env_val.trim().is_empty() { None } else { Some(env_val) };
        }

        if let Some(val) = self.get_setting("enable_youtube")? {
            settings.enable_youtube = val == "true" || val == "1";
        } else if let Ok(env_val) = std::env::var("ENABLE_YOUTUBE") {
            settings.enable_youtube = env_val == "true" || env_val == "1";
        }

        if let Some(val) = self.get_setting("youtube_chat_mode")? {
            if val == "top" || val == "live" {
                settings.youtube_chat_mode = val;
            }
        }

        Ok(settings)
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        self.set_setting("tts_provider", &settings.tts_provider)?;
        self.set_setting("azure_speech_key", &settings.azure_speech_key)?;
        self.set_setting("azure_speech_region", &settings.azure_speech_region)?;
        self.set_setting("azure_speech_voice", &settings.azure_speech_voice)?;
        self.set_setting("azure_speech_voices", &serde_json::to_string(&settings.azure_speech_voices)?)?;
        self.set_setting(
            "azure_speech_voice_rotation",
            if settings.azure_speech_voice_rotation { "true" } else { "false" },
        )?;
        self.set_setting("sapi_voice", &settings.sapi_voice)?;
        self.set_setting("sapi_voices", &serde_json::to_string(&settings.sapi_voices)?)?;
        self.set_setting(
            "sapi_voice_rotation",
            if settings.sapi_voice_rotation { "true" } else { "false" },
        )?;
        self.set_setting("sapi_rate", &settings.sapi_rate.to_string())?;
        self.set_setting("sapi_volume", &settings.sapi_volume.to_string())?;
        self.set_setting("master_volume", &settings.master_volume.to_string())?;
        self.set_setting("youtube_channel_id", &settings.youtube_channel_id)?;
        self.set_setting("youtube_live_id", settings.youtube_live_id.as_deref().unwrap_or(""))?;
        self.set_setting("enable_youtube", if settings.enable_youtube { "true" } else { "false" })?;
        self.set_setting("youtube_chat_mode", &settings.youtube_chat_mode)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_banned_users() {
        let db = Db::open_in_memory().unwrap();
        assert!(!db.is_user_banned("u123"));

        db.ban_user("u123", "TrollUser", None).unwrap();
        assert!(db.is_user_banned("u123"));

        let banned = db.get_banned_users().unwrap();
        assert_eq!(banned.len(), 1);
        assert_eq!(banned[0].display_name, "TrollUser");

        let last = db.get_last_banned_user().unwrap().unwrap();
        assert_eq!(last.author_id, "u123");

        db.unban_user("u123").unwrap();
        assert!(!db.is_user_banned("u123"));
    }

    #[test]
    fn test_db_settings() {
        let db = Db::open_in_memory().unwrap();
        let mut settings = db.load_settings().unwrap();
        assert_eq!(settings.youtube_chat_mode, "live");

        settings.azure_speech_key = "test_key_123".to_string();
        settings.enable_youtube = false;
        settings.youtube_chat_mode = "top".to_string();

        db.save_settings(&settings).unwrap();

        let loaded = db.load_settings().unwrap();
        assert_eq!(loaded.azure_speech_key, "test_key_123");
        assert!(!loaded.enable_youtube);
        assert_eq!(loaded.youtube_chat_mode, "top");
    }
}

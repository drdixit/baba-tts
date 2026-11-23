use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub const META_GRAPH_API_BASE: &str = "https://graph.facebook.com/v21.0";

#[derive(Debug, Clone, Deserialize)]
pub struct MetaErrorWrapper {
    pub error: MetaErrorDetails,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct MetaErrorDetails {
    pub message: String,
    #[serde(rename = "type")]
    pub error_type: Option<String>,
    pub code: i64,
    pub error_subcode: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct MetaUsage {
    pub max_percentage: u32,
}

impl MetaUsage {
    pub fn parse_from_headers(headers: &HeaderMap) -> Self {
        let mut max_pct = 0u32;
        for header_name in ["x-app-usage", "x-page-usage", "x-business-use-case-usage"] {
            if let Some(val) = headers.get(header_name).and_then(|v| v.to_str().ok()) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(val) {
                    if let Some(obj) = json.as_object() {
                        for (_, v) in obj {
                            if let Some(num) = v.as_u64() {
                                max_pct = max_pct.max(num as u32);
                            }
                        }
                    }
                }
            }
        }
        Self {
            max_percentage: max_pct,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaValidationResult {
    pub valid: bool,
    pub id: Option<String>,
    pub name: Option<String>,
    pub username: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaDataResponse<T> {
    pub data: Vec<T>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct MetaLiveVideoItem {
    pub id: String,
    pub status: Option<String>,
    pub title: Option<String>,
    pub creation_time: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct MetaLiveMediaItem {
    pub id: String,
    pub status: Option<String>,
    pub broadcast_status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaCommentItem {
    pub id: String,
    pub message: Option<String>,
    pub text: Option<String>, // Instagram uses "text"
    pub created_time: Option<String>,
    pub timestamp: Option<String>, // Instagram uses "timestamp"
    pub from: Option<MetaCommentFrom>,
}

impl MetaCommentItem {
    pub fn text_content(&self) -> String {
        if let Some(ref m) = self.message {
            if !m.is_empty() {
                return m.clone();
            }
        }
        self.text.clone().unwrap_or_default()
    }

    pub fn author_name(&self) -> String {
        if let Some(ref from) = self.from {
            if let Some(ref name) = from.name {
                if !name.is_empty() {
                    return name.clone();
                }
            }
            if let Some(ref username) = from.username {
                if !username.is_empty() {
                    return username.clone();
                }
            }
        }
        "Anonymous".to_string()
    }

    pub fn author_id(&self) -> Option<String> {
        self.from.as_ref().and_then(|f| f.id.clone())
    }

    pub fn author_avatar(&self) -> Option<String> {
        self.from
            .as_ref()
            .and_then(|f| f.picture.as_ref())
            .and_then(|p| p.data.as_ref())
            .and_then(|d| d.url.clone())
    }

    pub fn timestamp_usec(&self) -> u64 {
        if let Some(ref t) = self.created_time {
            if let Some(usec) = parse_meta_timestamp_to_usec(t) {
                return usec;
            }
        }
        if let Some(ref t) = self.timestamp {
            if let Some(usec) = parse_meta_timestamp_to_usec(t) {
                return usec;
            }
        }
        0
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaCommentFrom {
    pub id: Option<String>,
    pub name: Option<String>,
    pub username: Option<String>,
    pub picture: Option<MetaPictureWrapper>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaPictureWrapper {
    pub data: Option<MetaPictureData>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MetaPictureData {
    pub url: Option<String>,
}

#[derive(Clone)]
pub struct MetaClient {
    client: Client,
    base_url: String,
}

impl Default for MetaClient {
    fn default() -> Self {
        Self::new()
    }
}

impl MetaClient {
    pub fn new() -> Self {
        let mut default_headers = HeaderMap::new();
        default_headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        default_headers.insert(
            USER_AGENT,
            HeaderValue::from_static("BabaTTS-Desktop/0.0.4-beta (Windows NT 10.0; Win64; x64)"),
        );

        let client = Client::builder()
            .default_headers(default_headers)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            client,
            base_url: META_GRAPH_API_BASE.to_string(),
        }
    }

    #[allow(dead_code)]
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }

    pub fn is_token_expired_code(code: i64) -> bool {
        code == 190
    }

    /// Validates a Facebook user/page access token by calling `GET /{target_id}`.
    pub async fn test_facebook_token(&self, token: &str, target_id: &str) -> MetaValidationResult {
        let token = token.trim();
        if token.is_empty() {
            return MetaValidationResult {
                valid: false,
                id: None,
                name: None,
                username: None,
                error_message: Some("Access token is empty".to_string()),
            };
        }

        let target = if target_id.trim().is_empty() {
            "me"
        } else {
            target_id.trim()
        };

        let url = format!("{}/{}?fields=id,name&access_token={}", self.base_url, target, token);
        match self.client.get(&url).send().await {
            Ok(resp) => {
                let status = resp.status();
                let body_text = resp.text().await.unwrap_or_default();
                if status.is_success() {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        return MetaValidationResult {
                            valid: true,
                            id: val.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            name: val.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            username: None,
                            error_message: None,
                        };
                    }
                }

                if let Ok(err_wrap) = serde_json::from_str::<MetaErrorWrapper>(&body_text) {
                    MetaValidationResult {
                        valid: false,
                        id: None,
                        name: None,
                        username: None,
                        error_message: Some(format!(
                            "Meta API Error {}: {}",
                            err_wrap.error.code, err_wrap.error.message
                        )),
                    }
                } else {
                    MetaValidationResult {
                        valid: false,
                        id: None,
                        name: None,
                        username: None,
                        error_message: Some(format!("HTTP {} error validating token", status)),
                    }
                }
            }
            Err(e) => MetaValidationResult {
                valid: false,
                id: None,
                name: None,
                username: None,
                error_message: Some(format!("Network error: {}", e)),
            },
        }
    }

    /// Discovers active Facebook Live video ID by calling `GET /{target_id}/live_videos?status=LIVE`.
    pub async fn get_facebook_live_video(
        &self,
        token: &str,
        target_id: &str,
    ) -> Result<(Option<String>, MetaUsage)> {
        let token = token.trim();
        let target = if target_id.trim().is_empty() {
            "me"
        } else {
            target_id.trim()
        };

        let url = format!(
            "{}/{}/live_videos?status=LIVE&fields=id,title,creation_time&limit=1&access_token={}",
            self.base_url, target, token
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .with_context(|| format!("Failed to query Facebook live_videos for {}", target))?;

        let usage = MetaUsage::parse_from_headers(resp.headers());
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            if let Ok(err_wrap) = serde_json::from_str::<MetaErrorWrapper>(&body) {
                if Self::is_token_expired_code(err_wrap.error.code) {
                    return Err(anyhow!("OAuthException: Token expired or invalidated (Code 190)"));
                }
                return Err(anyhow!(
                    "Meta API error {}: {}",
                    err_wrap.error.code,
                    err_wrap.error.message
                ));
            }
            return Err(anyhow!("HTTP error {} querying live video", status));
        }

        let parsed: MetaDataResponse<MetaLiveVideoItem> = serde_json::from_str(&body)
            .with_context(|| "Failed to parse Facebook live_videos payload")?;

        let active_id = parsed.data.into_iter().next().map(|v| v.id);
        Ok((active_id, usage))
    }

    /// Queries live comments for a given Facebook live video ID.
    pub async fn get_facebook_comments(
        &self,
        token: &str,
        live_video_id: &str,
        since_sec: Option<u64>,
    ) -> Result<(Vec<MetaCommentItem>, MetaUsage)> {
        let token = token.trim();
        let mut url = format!(
            "{}/{}/comments?fields=from{{id,name,picture}},message,created_time&order=reverse_chronological&filter=stream&limit=50&access_token={}",
            self.base_url, live_video_id, token
        );

        if let Some(since) = since_sec {
            if since > 0 {
                url.push_str(&format!("&since={}", since));
            }
        }

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .with_context(|| format!("Failed to fetch comments for Facebook video {}", live_video_id))?;

        let usage = MetaUsage::parse_from_headers(resp.headers());
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            if let Ok(err_wrap) = serde_json::from_str::<MetaErrorWrapper>(&body) {
                if Self::is_token_expired_code(err_wrap.error.code) {
                    return Err(anyhow!("OAuthException: Token expired or invalidated (Code 190)"));
                }
                return Err(anyhow!(
                    "Meta API error {}: {}",
                    err_wrap.error.code,
                    err_wrap.error.message
                ));
            }
            return Err(anyhow!("HTTP error {} fetching Facebook comments", status));
        }

        let parsed: MetaDataResponse<MetaCommentItem> = serde_json::from_str(&body)
            .with_context(|| "Failed to parse Facebook comments payload")?;

        Ok((parsed.data, usage))
    }

    /// Validates an Instagram user token by calling `GET /{user_id}` or `GET /me`.
    pub async fn test_instagram_token(&self, token: &str, user_id: &str) -> MetaValidationResult {
        let token = token.trim();
        if token.is_empty() {
            return MetaValidationResult {
                valid: false,
                id: None,
                name: None,
                username: None,
                error_message: Some("Access token is empty".to_string()),
            };
        }

        let target = if user_id.trim().is_empty() {
            "me"
        } else {
            user_id.trim()
        };

        let url = format!("{}/{}?fields=id,username,name&access_token={}", self.base_url, target, token);
        match self.client.get(&url).send().await {
            Ok(resp) => {
                let status = resp.status();
                let body_text = resp.text().await.unwrap_or_default();
                if status.is_success() {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        return MetaValidationResult {
                            valid: true,
                            id: val.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            name: val.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            username: val.get("username").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            error_message: None,
                        };
                    }
                }

                if let Ok(err_wrap) = serde_json::from_str::<MetaErrorWrapper>(&body_text) {
                    MetaValidationResult {
                        valid: false,
                        id: None,
                        name: None,
                        username: None,
                        error_message: Some(format!(
                            "Meta API Error {}: {}",
                            err_wrap.error.code, err_wrap.error.message
                        )),
                    }
                } else {
                    MetaValidationResult {
                        valid: false,
                        id: None,
                        name: None,
                        username: None,
                        error_message: Some(format!("HTTP {} error validating token", status)),
                    }
                }
            }
            Err(e) => MetaValidationResult {
                valid: false,
                id: None,
                name: None,
                username: None,
                error_message: Some(format!("Network error: {}", e)),
            },
        }
    }

    /// Discovers active Instagram Live broadcast ID by calling `GET /{user_id}/live_media?status=LIVE`.
    pub async fn get_instagram_live_media(
        &self,
        token: &str,
        user_id: &str,
    ) -> Result<(Option<String>, MetaUsage)> {
        let token = token.trim();
        let target = if user_id.trim().is_empty() {
            "me"
        } else {
            user_id.trim()
        };

        let url = format!(
            "{}/{}/live_media?status=LIVE&fields=id,status,broadcast_status&limit=1&access_token={}",
            self.base_url, target, token
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .with_context(|| format!("Failed to query Instagram live_media for {}", target))?;

        let usage = MetaUsage::parse_from_headers(resp.headers());
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            if let Ok(err_wrap) = serde_json::from_str::<MetaErrorWrapper>(&body) {
                if Self::is_token_expired_code(err_wrap.error.code) {
                    return Err(anyhow!("OAuthException: Token expired or invalidated (Code 190)"));
                }
                return Err(anyhow!(
                    "Meta API error {}: {}",
                    err_wrap.error.code,
                    err_wrap.error.message
                ));
            }
            return Err(anyhow!("HTTP error {} querying Instagram live media", status));
        }

        let parsed: MetaDataResponse<MetaLiveMediaItem> = serde_json::from_str(&body)
            .with_context(|| "Failed to parse Instagram live_media payload")?;

        let active_id = parsed.data.into_iter().next().map(|v| v.id);
        Ok((active_id, usage))
    }

    /// Queries live comments for a given Instagram live media ID.
    pub async fn get_instagram_comments(
        &self,
        token: &str,
        live_media_id: &str,
    ) -> Result<(Vec<MetaCommentItem>, MetaUsage)> {
        let token = token.trim();
        let url = format!(
            "{}/{}/comments?fields=id,from,text,timestamp&order=reverse_chronological&limit=50&access_token={}",
            self.base_url, live_media_id, token
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .with_context(|| format!("Failed to fetch comments for Instagram media {}", live_media_id))?;

        let usage = MetaUsage::parse_from_headers(resp.headers());
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            if let Ok(err_wrap) = serde_json::from_str::<MetaErrorWrapper>(&body) {
                if Self::is_token_expired_code(err_wrap.error.code) {
                    return Err(anyhow!("OAuthException: Token expired or invalidated (Code 190)"));
                }
                return Err(anyhow!(
                    "Meta API error {}: {}",
                    err_wrap.error.code,
                    err_wrap.error.message
                ));
            }
            return Err(anyhow!("HTTP error {} fetching Instagram comments", status));
        }

        let parsed: MetaDataResponse<MetaCommentItem> = serde_json::from_str(&body)
            .with_context(|| "Failed to parse Instagram comments payload")?;

        Ok((parsed.data, usage))
    }
}

/// Converts a civil date (year, month, day) into days since Unix Epoch (1970-01-01).
/// Based on Howard Hinnant's algorithm.
fn days_from_civil(y: i64, m: u64, d: u64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

/// Parses an ISO 8601 string (e.g. `2026-11-23T16:30:00+0000`, `2026-11-23T16:30:00Z`)
/// into Unix epoch microseconds.
pub fn parse_meta_timestamp_to_usec(s: &str) -> Option<u64> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try parsing as raw integer timestamp (in seconds or ms or usec)
    if let Ok(val) = trimmed.parse::<u64>() {
        if val > 1_000_000_000_000_000 {
            return Some(val); // already usec
        } else if val > 1_000_000_000_000 {
            return Some(val * 1_000); // ms to usec
        } else if val > 1_000_000_000 {
            return Some(val * 1_000_000); // sec to usec
        }
    }

    // Expected format: YYYY-MM-DDTHH:MM:SS[Z or +HHMM or +HH:MM]
    if trimmed.len() < 19 {
        return None;
    }

    let year: i64 = trimmed.get(0..4)?.parse().ok()?;
    let month: u64 = trimmed.get(5..7)?.parse().ok()?;
    let day: u64 = trimmed.get(8..10)?.parse().ok()?;
    let hour: u64 = trimmed.get(11..13)?.parse().ok()?;
    let min: u64 = trimmed.get(14..16)?.parse().ok()?;
    let sec: u64 = trimmed.get(17..19)?.parse().ok()?;

    let days = days_from_civil(year, month, day);
    let mut total_sec = days * 86400 + (hour as i64) * 3600 + (min as i64) * 60 + (sec as i64);

    // Parse timezone offset if present
    if trimmed.len() > 19 {
        let rest = &trimmed[19..];
        if rest != "Z" && !rest.is_empty() {
            let (sign, offset_str) = if let Some(stripped) = rest.strip_prefix('+') {
                (1, stripped)
            } else if let Some(stripped) = rest.strip_prefix('-') {
                (-1, stripped)
            } else {
                (1, rest)
            };

            let clean_offset = offset_str.replace(':', "");
            if clean_offset.len() >= 4 {
                let off_h: i64 = clean_offset.get(0..2)?.parse().ok()?;
                let off_m: i64 = clean_offset.get(2..4)?.parse().ok()?;
                let offset_sec = sign * (off_h * 3600 + off_m * 60);
                total_sec -= offset_sec; // Convert local time to UTC
            }
        }
    }

    if total_sec < 0 {
        return None;
    }

    Some((total_sec as u64).saturating_mul(1_000_000))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_meta_timestamp() {
        // 2026-03-30T21:23:07+0000
        let usec = parse_meta_timestamp_to_usec("2026-03-30T21:23:07+0000").unwrap();
        assert_eq!(usec / 1_000_000, 1774905787);

        // UTC Z format
        let usec_z = parse_meta_timestamp_to_usec("2026-03-30T21:23:07Z").unwrap();
        assert_eq!(usec_z, usec);

        // With offset +05:30 (IST)
        // 2026-03-30T21:23:07+05:30 -> UTC is 15:53:07
        let usec_ist = parse_meta_timestamp_to_usec("2026-03-30T21:23:07+05:30").unwrap();
        assert_eq!(usec_ist / 1_000_000, 1774905787 - (5 * 3600 + 30 * 60));

        // Epoch string
        let usec_epoch = parse_meta_timestamp_to_usec("1774905787").unwrap();
        assert_eq!(usec_epoch / 1_000_000, 1774905787);
    }

    #[test]
    fn test_meta_usage_parsing() {
        let mut headers = HeaderMap::new();
        headers.insert("x-app-usage", HeaderValue::from_static("{\"call_count\":45,\"total_cputime\":12,\"total_time\":25}"));
        headers.insert("x-page-usage", HeaderValue::from_static("{\"call_count\":82,\"total_cputime\":5}"));

        let usage = MetaUsage::parse_from_headers(&headers);
        assert_eq!(usage.max_percentage, 82);
    }
}

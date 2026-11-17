use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_REPEATED_CHARS: usize = 4;
const MAX_REPEATED_WORDS: usize = 4;
const MAX_REPEATED_PATTERNS: usize = 3;
const MAX_PUNCTUATION: usize = 8;
const GIBBERISH_MIN_LEN: usize = 12;
const DUPLICATE_WINDOW: Duration = Duration::from_secs(30);

#[derive(Debug, PartialEq, Eq)]
pub struct SpamCheckResult {
    pub is_spam: bool,
    pub reason: Option<&'static str>,
}

#[derive(Clone)]
pub struct SpamFilter {
    recent_messages: Arc<Mutex<HashMap<String, (String, Instant)>>>,
}

impl Default for SpamFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl SpamFilter {
    pub fn new() -> Self {
        Self {
            recent_messages: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn is_spam(&self, user_id: &str, message: &str) -> SpamCheckResult {
        let msg = message.trim();
        if msg.is_empty() {
            return SpamCheckResult { is_spam: false, reason: None };
        }

        // 1. Emoji Spam
        if count_emojis(msg) > 3 {
            return SpamCheckResult { is_spam: true, reason: Some("too_many_emojis") };
        }

        // 2. Excessive Punctuation
        if count_punctuation(msg) > MAX_PUNCTUATION {
            return SpamCheckResult { is_spam: true, reason: Some("excessive_punctuation") };
        }

        let compact = remove_non_alphanumeric(msg).to_lowercase();

        if !compact.is_empty() {
            // 3. Repeated Characters
            if has_repeated_characters(msg, MAX_REPEATED_CHARS) {
                return SpamCheckResult { is_spam: true, reason: Some("repeated_characters") };
            }

            // 4. Repeated Words
            if has_repeated_words(msg, MAX_REPEATED_WORDS) {
                return SpamCheckResult { is_spam: true, reason: Some("repeated_words") };
            }

            // 5. Repeated Pattern
            if has_repeated_pattern(&compact, MAX_REPEATED_PATTERNS) {
                return SpamCheckResult { is_spam: true, reason: Some("repeated_pattern") };
            }

            // 6. Gibberish
            if looks_like_gibberish(msg) {
                return SpamCheckResult { is_spam: true, reason: Some("gibberish") };
            }
        }

        // 30-second duplicate check
        let dedupe_key = if !compact.is_empty() {
            compact
        } else {
            msg.to_lowercase()
        };

        let now = Instant::now();
        let mut store = self.recent_messages.lock().unwrap_or_else(|p| p.into_inner());

        if let Some((last_compact, last_time)) = store.get(user_id) {
            if last_compact == &dedupe_key && now.duration_since(*last_time) < DUPLICATE_WINDOW {
                return SpamCheckResult { is_spam: true, reason: Some("duplicate_message") };
            }
        }

        // Cleanup stale entries
        if store.len() > 1000 {
            store.retain(|_, (_, time)| now.duration_since(*time) < DUPLICATE_WINDOW);
        }

        store.insert(user_id.to_string(), (dedupe_key, now));

        SpamCheckResult { is_spam: false, reason: None }
    }
}

fn remove_non_alphanumeric(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).collect()
}

fn count_emojis(text: &str) -> usize {
    let mut count = 0;
    for c in text.chars() {
        let u = c as u32;
        // Standard emoji ranges
        if (0x1F300..=0x1F9FF).contains(&u)
            || (0x2600..=0x26FF).contains(&u)
            || (0x2700..=0x27BF).contains(&u)
            || (0x1F1E6..=0x1F1FF).contains(&u)
            || (0x1FA70..=0x1FAFF).contains(&u)
            || (0x1F600..=0x1F64F).contains(&u)
            || (0x1F680..=0x1F6FF).contains(&u)
            || u == 0x2B50
            || u == 0x2B55
        {
            count += 1;
        }
    }

    // Custom YouTube emojis e.g. [:xyz:]
    let mut pos = 0;
    while let Some(start) = text[pos..].find("[:") {
        let abs_start = pos + start;
        if let Some(end) = text[abs_start + 2..].find(":]") {
            count += 1;
            pos = abs_start + 2 + end + 2;
        } else {
            break;
        }
    }

    count
}

fn count_punctuation(text: &str) -> usize {
    text.chars().filter(|c| "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".contains(*c)).count()
}

fn has_repeated_characters(text: &str, max_allowed: usize) -> bool {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return false;
    }

    let mut repeat_count = 1;
    for i in 1..chars.len() {
        let current = chars[i].to_ascii_lowercase();
        let prev = chars[i - 1].to_ascii_lowercase();

        if current.is_whitespace() {
            repeat_count = 1;
            continue;
        }

        if current == prev {
            repeat_count += 1;
            if repeat_count > max_allowed {
                return true;
            }
        } else {
            repeat_count = 1;
        }
    }
    false
}

fn has_repeated_words(text: &str, max_allowed: usize) -> bool {
    let words: Vec<String> = text
        .split_whitespace()
        .map(|w| remove_non_alphanumeric(w).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();

    if words.len() < max_allowed {
        return false;
    }

    let mut repeat_count = 1;
    for i in 1..words.len() {
        if words[i] == words[i - 1] {
            repeat_count += 1;
            if repeat_count >= max_allowed {
                return true;
            }
        } else {
            repeat_count = 1;
        }
    }
    false
}

fn has_repeated_pattern(text: &str, max_repeats: usize) -> bool {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 6 {
        return false;
    }

    for pattern_len in 2..=3 {
        let mut start = 0;
        while start + pattern_len * max_repeats <= chars.len() {
            let pattern = &chars[start..start + pattern_len];
            let mut repeats = 1;
            let mut pos = start + pattern_len;

            while pos + pattern_len <= chars.len() {
                let current = &chars[pos..pos + pattern_len];
                if current != pattern {
                    break;
                }
                repeats += 1;
                pos += pattern_len;
            }

            if repeats >= max_repeats {
                return true;
            }
            start += 1;
        }
    }
    false
}

fn looks_like_gibberish(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() != 1 {
        return false; // Only inspect single long token
    }

    let word = remove_non_alphanumeric(words[0]).to_lowercase();
    if word.len() < GIBBERISH_MIN_LEN {
        return false;
    }

    let chars: Vec<char> = word.chars().collect();
    let mut letter_count = 0;
    let mut digit_count = 0;
    let mut repeated_chars = 0;

    for i in 0..chars.len() {
        let c = chars[i];
        if c.is_ascii_alphabetic() {
            letter_count += 1;
        }
        if c.is_ascii_digit() {
            digit_count += 1;
        }
        if i > 0 && c == chars[i - 1] {
            repeated_chars += 1;
        }
    }

    if letter_count == 0 {
        return false;
    }

    let unique_count = chars.iter().collect::<HashSet<_>>().len();
    let unique_ratio = unique_count as f64 / chars.len() as f64;

    // Very low character diversity
    if unique_ratio < 0.45 {
        return true;
    }

    // Long random-looking Latin token
    if letter_count >= 12 && digit_count == 0 && unique_ratio < 0.55 && repeated_chars >= 3 {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spam_detection() {
        let filter = SpamFilter::new();

        // Normal message
        let res = filter.is_spam("user1", "Hello world this is a normal message");
        assert!(!res.is_spam);

        // Emoji spam
        let res = filter.is_spam("user1", "Hello 😂🔥🎉🚀😎");
        assert!(res.is_spam);
        assert_eq!(res.reason, Some("too_many_emojis"));

        // Repeated characters
        let res = filter.is_spam("user2", "Bhaaaaaai kya haal");
        assert!(res.is_spam);
        assert_eq!(res.reason, Some("repeated_characters"));

        // Repeated words
        let res = filter.is_spam("user3", "spam spam spam spam message");
        assert!(res.is_spam);
        assert_eq!(res.reason, Some("repeated_words"));

        // Repeated pattern
        let res = filter.is_spam("user4", "hahahahahaha");
        assert!(res.is_spam);
        assert_eq!(res.reason, Some("repeated_pattern"));

        // Excessive punctuation
        let res = filter.is_spam("user5", "Wait what?????????!!");
        assert!(res.is_spam);
        assert_eq!(res.reason, Some("excessive_punctuation"));

        // Duplicate message within 30s
        let res1 = filter.is_spam("user6", "Unique first message");
        assert!(!res1.is_spam);
        let res2 = filter.is_spam("user6", "Unique first message");
        assert!(res2.is_spam);
        assert_eq!(res2.reason, Some("duplicate_message"));
    }
}

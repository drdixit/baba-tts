interface SpamCheckResult {
  isSpam: boolean;
  reason?: string;
}

// In-memory store for the 30-second duplicate check
const lastMessageStore = new Map<string, { compact: string, timestamp: number }>();

// Spam thresholds
const MAX_REPEATED_CHARS = 4;
const MAX_REPEATED_WORDS = 4;
const MAX_REPEATED_PATTERNS = 3;
const MAX_PUNCTUATION = 8;
const GIBBERISH_MIN_LEN = 12;

export function isSpamMessage(userId: string, message: string): SpamCheckResult {
  if (!message || message.trim() === '') {
    return { isSpam: false };
  }
  
  const msg = message.trim();
  
  // Ignore explicit commands
  if (msg.startsWith('!')) {
    return { isSpam: false };
  }
  
  const compact = removeNonAlphaNumeric(msg).toLowerCase();
  if (compact === '') {
    return { isSpam: false };
  }
  
  // 1. Emoji Spam
  if (countEmojis(msg) > 4) {
    return { isSpam: true, reason: 'too_many_emojis' };
  }
  
  // 2. Repeated Characters
  if (hasRepeatedCharacters(msg, MAX_REPEATED_CHARS)) {
    return { isSpam: true, reason: 'repeated_characters' };
  }
  
  // 3. Repeated Words
  if (hasRepeatedWords(msg, MAX_REPEATED_WORDS)) {
    return { isSpam: true, reason: 'repeated_words' };
  }
  
  // 4. Repeated Pattern
  if (hasRepeatedPattern(compact, MAX_REPEATED_PATTERNS)) {
    return { isSpam: true, reason: 'repeated_pattern' };
  }
  
  // 5. Excessive Punctuation
  if (countPunctuation(msg) > MAX_PUNCTUATION) {
    return { isSpam: true, reason: 'excessive_punctuation' };
  }
  
  // 6. Gibberish
  if (looksLikeGibberish(msg)) {
    return { isSpam: true, reason: 'gibberish' };
  }
  
  // 30-second duplicate check
  const now = Date.now();
  const duplicateWindow = 30 * 1000;
  
  const lastMsg = lastMessageStore.get(userId);
  if (lastMsg && lastMsg.compact === compact && (now - lastMsg.timestamp) < duplicateWindow) {
    return { isSpam: true, reason: 'duplicate_message' };
  }
  
  // Clean up the map occasionally to prevent memory leaks in long streams
  if (lastMessageStore.size > 1000) {
    for (const [key, val] of lastMessageStore.entries()) {
      if (now - val.timestamp > duplicateWindow) {
        lastMessageStore.delete(key);
      }
    }
  }
  
  // Save accepted message
  lastMessageStore.set(userId, { compact, timestamp: now });
  
  return { isSpam: false };
}

// =========================================================
// HELPERS
// =========================================================

function removeNonAlphaNumeric(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, '');
}

function normalizeWord(word: string): string {
  return removeNonAlphaNumeric(word).toLowerCase();
}

function countEmojis(text: string): number {
  // Standard Unicode emojis roughly matching C# detection
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2B50}\u{2B55}]/gu;
  const standardEmojis = text.match(emojiRegex)?.length || 0;
  
  // YouTube custom emojis e.g. [:xyz:]
  let customEmojis = 0;
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('[:', pos);
    if (start < 0) break;
    const end = text.indexOf(':]', start + 2);
    if (end < 0) break;
    if (end > start + 2) customEmojis++;
    pos = end + 2;
  }
  
  return standardEmojis + customEmojis;
}

function hasRepeatedCharacters(text: string, maxAllowed: number): boolean {
  if (!text) return false;
  let repeatCount = 1;
  for (let i = 1; i < text.length; i++) {
    const current = text[i].toLowerCase();
    const previous = text[i - 1].toLowerCase();
    
    if (/\s/.test(current)) {
      repeatCount = 1;
      continue;
    }
    
    if (current === previous) {
      repeatCount++;
      if (repeatCount > maxAllowed) return true;
    } else {
      repeatCount = 1;
    }
  }
  return false;
}

function hasRepeatedWords(text: string, maxAllowed: number): boolean {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length < maxAllowed) return false;
  
  let repeatCount = 1;
  for (let i = 1; i < words.length; i++) {
    const current = normalizeWord(words[i]);
    const previous = normalizeWord(words[i - 1]);
    
    if (!current) continue;
    
    if (current === previous) {
      repeatCount++;
      if (repeatCount >= maxAllowed) return true;
    } else {
      repeatCount = 1;
    }
  }
  return false;
}

function hasRepeatedPattern(text: string, maxRepeats: number): boolean {
  if (!text || text.length < 6) return false;
  
  for (let patternLen = 2; patternLen <= 3; patternLen++) {
    for (let start = 0; start + patternLen * maxRepeats <= text.length; start++) {
      const pattern = text.substring(start, start + patternLen);
      let repeats = 1;
      let pos = start + patternLen;
      
      while (pos + patternLen <= text.length) {
        const current = text.substring(pos, pos + patternLen);
        if (current.toLowerCase() !== pattern.toLowerCase()) break;
        repeats++;
        pos += patternLen;
      }
      
      if (repeats >= maxRepeats) return true;
    }
  }
  return false;
}

function countPunctuation(text: string): number {
  const punctuationRegex = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
  return text.match(punctuationRegex)?.length || 0;
}

function countUniqueCharacters(text: string): number {
  const seen = new Set();
  for (const c of text) {
    seen.add(c.toLowerCase());
  }
  return seen.size;
}

function looksLikeGibberish(text: string): boolean {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length !== 1) return false; // Only inspect single long token
  
  const word = normalizeWord(words[0]);
  if (word.length < GIBBERISH_MIN_LEN) return false;
  
  let letterCount = 0;
  let digitCount = 0;
  let repeatedChars = 0;
  
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (/[a-zA-Z]/.test(c)) letterCount++;
    if (/[0-9]/.test(c)) digitCount++;
    
    if (i > 0 && c.toLowerCase() === word[i - 1].toLowerCase()) {
      repeatedChars++;
    }
  }
  
  if (letterCount === 0) return false;
  
  const uniqueRatio = countUniqueCharacters(word) / word.length;
  
  // Very low character diversity
  if (uniqueRatio < 0.45) return true;
  
  // Long random-looking Latin token
  if (letterCount >= 12 && digitCount === 0 && uniqueRatio < 0.55 && repeatedChars >= 3) {
    return true;
  }
  
  return false;
}

package com.babatts.overlay.youtube

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.Locale

/**
 * Pure YouTube Live Chat HTML/InnerTube JSON parser, backlog classifier, deduplication cache,
 * and lightweight spam filter matching the desktop Rust implementation (`src/youtube.rs`, `src/spam_filter.rs`).
 */
object YouTubeMessageParser {

    const val SUPERCHAT_GRACE_WINDOW_USEC: Long = 60_000_000L
    const val DEFAULT_SEEN_CACHE_CAPACITY: Int = 2000
    const val CHAT_MODE_LIVE = "live"
    const val CHAT_MODE_TOP = "top"
    private const val ASCII_PUNCTUATION = "!\"#\$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    private const val GIBBERISH_MIN_LEN = 12

    private val CANONICAL_VIDEO_REGEX = Regex(
        """<link\s+rel="canonical"\s+href="https://www\.youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})""""
    )
    private val CANONICAL_CHANNEL_PAGE_REGEX = Regex(
        """<link\s+rel="canonical"\s+href="https://www\.youtube\.com/channel/UC[a-zA-Z0-9_-]{22}""""
    )
    private val CHANNEL_ID_REGEX = Regex("""^UC[a-zA-Z0-9_-]{22}$""")
    private val CANONICAL_CHANNEL_LINK_REGEX = Regex(
        """<link\s+rel="canonical"\s+href="https://www\.youtube\.com/channel/(UC[a-zA-Z0-9_-]{22})""""
    )
    private val META_CHANNEL_ID_FORWARD_REGEX = Regex(
        """<meta\b[^>]*\bitemprop="(?:identifier|channelId)"[^>]*\bcontent="(UC[a-zA-Z0-9_-]{22})""""
    )
    private val META_CHANNEL_ID_REVERSE_REGEX = Regex(
        """<meta\b[^>]*\bcontent="(UC[a-zA-Z0-9_-]{22})"[^>]*\bitemprop="(?:identifier|channelId)""""
    )
    private val EXTERNAL_CHANNEL_ID_REGEX = Regex(""""externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"""")
    private val RSS_CHANNEL_ID_REGEX = Regex("""channel_id=(UC[a-zA-Z0-9_-]{22})""")
    private val VIDEO_ID_JSON_REGEX = Regex(""""videoId":"([a-zA-Z0-9_-]{11})"""")
    private val INNERTUBE_KEY_REGEX = Regex(""""INNERTUBE_API_KEY":"([^"]+)"""")
    private val CONTINUATION_FALLBACK_REGEX = Regex(""""continuation":"([^"]+)"""")

    data class ParsedChatAction(
        val msgId: String,
        val authorName: String,
        val authorId: String?,
        val text: String,
        val isSuperchat: Boolean,
        val timestampUsec: Long
    )

    enum class Classification {
        QUEUED,
        HISTORICAL
    }

    /**
     * Bounded FIFO deduplication cache matching `SeenMessageCache`.
     */
    class SeenMessageCache(private val capacity: Int = DEFAULT_SEEN_CACHE_CAPACITY) {
        private val map = object : LinkedHashMap<String, Boolean>(capacity, 0.75f, false) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean {
                return size > capacity
            }
        }

        @Synchronized
        fun insert(id: String): Boolean {
            if (id.isEmpty()) return true
            if (map.containsKey(id)) return false
            map[id] = true
            return true
        }

        @Synchronized
        fun contains(id: String): Boolean = map.containsKey(id)

        @Synchronized
        fun clear() {
            map.clear()
        }
    }

    /**
     * Lightweight spam filter matching `src/spam_filter.rs` rules:
     * - Blocks >3 emojis, >8 ASCII punctuation chars, >=5 repeated chars, >=4 repeated words,
     *   >=3 repeated patterns, single-token gibberish runs, and 30s per-user duplicates.
     */
    class SpamFilter(
        private val nowMsProvider: () -> Long = { System.currentTimeMillis() }
    ) {
        private val recentMessages = HashMap<String, Pair<String, Long>>()

        @Synchronized
        fun isSpam(userKey: String, message: String): Boolean {
            val msg = message.trim()
            if (msg.isEmpty()) return false

            if (countEmojis(msg) > 3) return true
            if (countPunctuation(msg) > 8) return true

            val compact = msg.filter { it.isLetterOrDigit() }.lowercase(Locale.ROOT)
            if (compact.isNotEmpty()) {
                if (hasRepeatedCharacters(msg, 4)) return true
                if (hasRepeatedWords(msg, 4)) return true
                if (hasRepeatedPattern(compact, 3)) return true
                if (looksLikeGibberish(msg)) return true
            }

            val dedupeKey = compact.ifEmpty { msg.lowercase(Locale.ROOT) }
            val now = nowMsProvider()
            val prev = recentMessages[userKey]
            if (prev != null && prev.first == dedupeKey && (now - prev.second) < 30_000L) {
                return true
            }

            if (recentMessages.size > 1000) {
                recentMessages.entries.removeAll { (_, v) -> (now - v.second) >= 30_000L }
            }
            recentMessages[userKey] = dedupeKey to now
            return false
        }

        @Synchronized
        fun clear() {
            recentMessages.clear()
        }

        private fun countEmojis(text: String): Int {
            var count = 0
            var i = 0
            while (i < text.length) {
                val cp = text.codePointAt(i)
                i += Character.charCount(cp)
                if (cp in 0x1F300..0x1F9FF ||
                    cp in 0x2600..0x26FF ||
                    cp in 0x2700..0x27BF ||
                    cp in 0x1F1E6..0x1F1FF ||
                    cp in 0x1FA70..0x1FAFF ||
                    cp in 0x1F600..0x1F64F ||
                    cp in 0x1F680..0x1F6FF ||
                    cp == 0x2B50 ||
                    cp == 0x2B55
                ) {
                    count++
                }
            }

            // Custom YouTube emoji shortcodes like [:xyz:]
            var pos = 0
            while (pos < text.length) {
                val start = text.indexOf("[:", pos)
                if (start < 0) break
                val end = text.indexOf(":]", start + 2)
                if (end < 0) break
                count++
                pos = end + 2
            }
            return count
        }

        private fun countPunctuation(text: String): Int {
            return text.count { it in ASCII_PUNCTUATION }
        }

        private fun hasRepeatedCharacters(text: String, maxAllowed: Int): Boolean {
            var run = 1
            var prev: Char? = null
            for (ch in text.lowercase(Locale.ROOT)) {
                if (ch.isWhitespace()) {
                    run = 1
                    prev = null
                    continue
                }
                if (ch == prev) {
                    run++
                    if (run > maxAllowed) return true
                } else {
                    run = 1
                    prev = ch
                }
            }
            return false
        }

        private fun hasRepeatedWords(text: String, maxAllowed: Int): Boolean {
            val words = text.trim()
                .split(Regex("\\s+"))
                .map { w -> w.filter { it.isLetterOrDigit() }.lowercase(Locale.ROOT) }
                .filter { it.isNotEmpty() }

            if (words.size < maxAllowed) return false

            var run = 1
            var prev = words[0]
            for (i in 1 until words.size) {
                val cur = words[i]
                if (cur == prev) {
                    run++
                    if (run >= maxAllowed) return true
                } else {
                    run = 1
                    prev = cur
                }
            }
            return false
        }

        private fun hasRepeatedPattern(compact: String, maxRepeats: Int): Boolean {
            if (compact.length < 6) return false
            for (patLen in 2..3) {
                if (compact.length < patLen * maxRepeats) continue
                for (start in 0..(compact.length - patLen * maxRepeats)) {
                    val pat = compact.substring(start, start + patLen)
                    var repeats = 1
                    var pos = start + patLen
                    while (pos + patLen <= compact.length && compact.substring(pos, pos + patLen) == pat) {
                        repeats++
                        if (repeats >= maxRepeats) return true
                        pos += patLen
                    }
                }
            }
            return false
        }

        private fun looksLikeGibberish(text: String): Boolean {
            val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (words.size != 1) return false

            val word = words[0].filter { it.isLetterOrDigit() }.lowercase(Locale.ROOT)
            if (word.length < GIBBERISH_MIN_LEN) return false

            var letterCount = 0
            var digitCount = 0
            var vowelCount = 0
            for (ch in word) {
                if (ch in 'a'..'z') {
                    letterCount++
                    if (ch == 'a' || ch == 'e' || ch == 'i' || ch == 'o' || ch == 'u') {
                        vowelCount++
                    }
                } else if (ch in '0'..'9') {
                    digitCount++
                }
            }
            if (letterCount == 0) return false

            val collapsed = StringBuilder()
            for (ch in word) {
                if (collapsed.isEmpty() || collapsed[collapsed.length - 1] != ch) {
                    collapsed.append(ch)
                }
            }

            val uniqueCount = word.toSet().size
            val uniqueRatio = uniqueCount.toDouble() / word.length.toDouble()
            val collapsedUniqueRatio = uniqueCount.toDouble() / collapsed.length.toDouble()

            if (uniqueRatio < 0.25 || (uniqueRatio < 0.45 && collapsedUniqueRatio < 0.55 && uniqueCount < 4)) {
                return true
            }
            if (letterCount >= 12 && vowelCount == 0) return true
            if (letterCount >= 14 && digitCount == 0 && (vowelCount.toDouble() / letterCount.toDouble()) < 0.08) {
                return true
            }
            return false
        }
    }

    fun isCanonicalChannelId(input: String?): Boolean {
        val trimmed = input?.trim().orEmpty()
        return CHANNEL_ID_REGEX.matches(trimmed)
    }

    fun looksLikeUrlInput(input: String?): Boolean {
        val trimmed = input?.trim().orEmpty()
        if (trimmed.isEmpty()) return false
        return trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true) ||
            trimmed.contains("youtube.com", ignoreCase = true) ||
            trimmed.contains("youtu.be", ignoreCase = true) ||
            trimmed.contains('/')
    }

    private fun encodePathSegment(segment: String): String {
        return URLEncoder.encode(segment, "UTF-8").replace("+", "%20")
    }

    /**
     * Builds ordered YouTube channel page URLs to resolve a username or `@handle` into a canonical `UC...` ID.
     */
    fun buildChannelLookupUrls(channelInput: String?): List<String> {
        val trimmed = channelInput?.trim().orEmpty()
        if (trimmed.isEmpty() || isCanonicalChannelId(trimmed) || looksLikeUrlInput(trimmed)) {
            return emptyList()
        }
        return if (trimmed.startsWith("@")) {
            val handleBody = trimmed.drop(1).trim()
            if (handleBody.isEmpty()) {
                emptyList()
            } else {
                listOf("https://www.youtube.com/@${encodePathSegment(handleBody)}")
            }
        } else {
            val encoded = encodePathSegment(trimmed)
            listOf(
                "https://www.youtube.com/@$encoded",
                "https://www.youtube.com/c/$encoded",
                "https://www.youtube.com/user/$encoded"
            )
        }
    }

    /**
     * Builds the canonical `/channel/UC.../live` URL from a resolved YouTube channel ID.
     */
    fun buildCanonicalChannelLiveUrl(channelId: String): String {
        return "https://www.youtube.com/channel/${channelId.trim()}/live"
    }

    /**
     * Extracts the canonical `UC...` YouTube channel ID from a channel HTML page using
     * authoritative page-owner metadata only (ignoring unrelated sidebar channels).
     */
    fun extractChannelIdFromHtml(html: String): String? {
        CANONICAL_CHANNEL_LINK_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        META_CHANNEL_ID_FORWARD_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        META_CHANNEL_ID_REVERSE_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        EXTERNAL_CHANNEL_ID_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        RSS_CHANNEL_ID_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        return null
    }

    /**
     * Extracts the active live stream `videoId` from `/channel/UC.../live` HTML.
     * Avoids matching trailers or VODs on offline channel pages.
     */
    fun extractVideoIdFromHtml(html: String): String? {
        CANONICAL_VIDEO_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        if (CANONICAL_CHANNEL_PAGE_REGEX.containsMatchIn(html)) {
            return null
        }
        val hasLiveIndicator = html.contains("\"isLive\":true") ||
            html.contains("\"isLiveNow\":true") ||
            html.contains("liveStreamabilityRenderer")
        if (hasLiveIndicator) {
            VIDEO_ID_JSON_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { return it }
        }
        return null
    }

    fun extractInnertubeApiKey(html: String): String? {
        return INNERTUBE_KEY_REGEX.find(html)?.groupValues?.getOrNull(1)
    }

    fun extractYtInitialData(html: String): JSONObject? {
        val markers = listOf(
            """window["ytInitialData"] = """,
            "var ytInitialData = ",
            "ytInitialData = "
        )
        var jsonStart = -1
        for (marker in markers) {
            val idx = html.indexOf(marker)
            if (idx >= 0) {
                jsonStart = idx + marker.length
                break
            }
        }
        if (jsonStart < 0) return null

        val remaining = html.substring(jsonStart).trimStart()
        val jsonStr = extractBalancedJsonObject(remaining) ?: run {
            // Ordered priority fallback matching src/youtube.rs (never min-index across ';')
            val endIdx = listOf(";</script>", "</script>", ";\n", ";")
                .firstNotNullOfOrNull { marker -> remaining.indexOf(marker).takeIf { it > 0 } }
                ?: remaining.length
            remaining.substring(0, endIdx).trim()
        }
        return try {
            JSONObject(jsonStr)
        } catch (_: Exception) {
            null
        }
    }

    private fun extractBalancedJsonObject(text: String): String? {
        if (!text.startsWith("{")) return null
        var depth = 0
        var inString = false
        var escaped = false
        for (i in text.indices) {
            val ch = text[i]
            if (inString) {
                if (escaped) {
                    escaped = false
                } else if (ch == '\\') {
                    escaped = true
                } else if (ch == '"') {
                    inString = false
                }
                continue
            }
            when (ch) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) {
                        return text.substring(0, i + 1)
                    }
                }
            }
        }
        return null
    }

    private fun JSONObject.optNonNullString(key: String): String {
        return if (isNull(key)) "" else optString(key, "")
    }

    fun extractContinuationToken(
        data: JSONObject?,
        chatMode: String,
        fallbackHtml: String = ""
    ): String? {
        if (data != null) {
            val lcr = data.optJSONObject("contents")?.optJSONObject("liveChatRenderer")
                ?: data.optJSONObject("contents")
                    ?.optJSONObject("twoColumnWatchNextResults")
                    ?.optJSONObject("conversationBar")
                    ?.optJSONObject("liveChatRenderer")
                ?: data.optJSONObject("liveChatRenderer")

            if (lcr != null) {
                val isTopMode = chatMode.equals(CHAT_MODE_TOP, ignoreCase = true)
                val subMenuItems = lcr.optJSONObject("header")
                    ?.optJSONObject("liveChatHeaderRenderer")
                    ?.optJSONObject("viewSelector")
                    ?.optJSONObject("sortFilterSubMenuRenderer")
                    ?.optJSONArray("subMenuItems")

                if (subMenuItems != null && subMenuItems.length() > 0) {
                    val targetTitle = if (isTopMode) "top chat" else "live chat"
                    for (i in 0 until subMenuItems.length()) {
                        val item = subMenuItems.optJSONObject(i) ?: continue
                        val title = item.optNonNullString("title")
                        if (title.equals(targetTitle, ignoreCase = true)) {
                            extractReloadContinuation(item)?.let { return it }
                        }
                    }
                    if (isTopMode) {
                        subMenuItems.optJSONObject(0)?.let { item ->
                            extractReloadContinuation(item)?.let { return it }
                        }
                    } else {
                        for (i in 0 until subMenuItems.length()) {
                            val item = subMenuItems.optJSONObject(i) ?: continue
                            if (!item.optBoolean("selected", false)) {
                                extractReloadContinuation(item)?.let { return it }
                            }
                        }
                        if (subMenuItems.length() >= 2) {
                            subMenuItems.optJSONObject(1)?.let { item ->
                                extractReloadContinuation(item)?.let { return it }
                            }
                        }
                    }
                }

                val continuations = lcr.optJSONArray("continuations")
                if (continuations != null && continuations.length() > 0) {
                    val first = continuations.optJSONObject(0)
                    if (first != null) {
                        val token = first.optJSONObject("reloadContinuationData")?.optNonNullString("continuation")
                            ?.takeIf { it.isNotEmpty() }
                            ?: first.optJSONObject("invalidationContinuationData")?.optNonNullString("continuation")
                                ?.takeIf { it.isNotEmpty() }
                            ?: first.optJSONObject("timedContinuationData")?.optNonNullString("continuation")
                                ?.takeIf { it.isNotEmpty() }
                        if (token != null) return token
                    }
                }
            }
        }

        if (fallbackHtml.isNotEmpty()) {
            return CONTINUATION_FALLBACK_REGEX.find(fallbackHtml)?.groupValues?.getOrNull(1)
        }
        return null
    }

    private fun extractReloadContinuation(item: JSONObject): String? {
        return item.optJSONObject("continuation")
            ?.optJSONObject("reloadContinuationData")
            ?.optNonNullString("continuation")
            ?.takeIf { it.isNotEmpty() }
    }

    fun shortcodeToUnicode(shortcut: String): String {
        return when (shortcut) {
            ":smile:", ":-)", ":)" -> "😄"
            ":grinning:", ":D", ":-D" -> "😀"
            ":joy:" -> "😂"
            ":rofl:" -> "🤣"
            ":heart:", "<3" -> "❤️"
            ":fire:" -> "🔥"
            ":thumbsup:", ":+1:" -> "👍"
            ":thumbsdown:", ":-1:" -> "👎"
            ":clap:" -> "👏"
            ":pray:" -> "🙏"
            ":eyes:" -> "👀"
            ":thinking:" -> "🤔"
            ":sob:", ":'(" -> "😭"
            ":skull:" -> "💀"
            ":100:" -> "💯"
            ":tada:", ":party:" -> "🎉"
            ":partying_face:" -> "🥳"
            ":sparkles:" -> "✨"
            ":star:" -> "⭐"
            ":wave:" -> "👋"
            ":wink:", ";)", ";-)" -> "😉"
            ":sunglasses:", "B)", "B-)" -> "😎"
            ":heart_eyes:" -> "😍"
            ":kissing_heart:", ":*" -> "😘"
            ":neutral_face:", ":|" -> "😐"
            ":rolling_eyes:" -> "🙄"
            ":sweat_smile:" -> "😅"
            ":cry:" -> "😢"
            ":angry:", ">:(" -> "😠"
            ":rage:" -> "😡"
            ":scream:" -> "😱"
            ":flushed:" -> "😳"
            ":raised_hands:" -> "🙌"
            ":muscle:" -> "💪"
            ":ok_hand:" -> "👌"
            ":peace:", ":v:" -> "✌️"
            ":salute:" -> "🫡"
            ":point_up:" -> "☝️"
            ":cat:", ":cat_face:" -> "🐱"
            ":dog:", ":dog_face:" -> "🐶"
            ":check:", ":heavy_check_mark:" -> "✅"
            ":x:", ":cross_mark:" -> "❌"
            else -> shortcut
        }
    }

    fun extractRunTextOrEmoji(run: JSONObject): String? {
        if (run.has("text") && !run.isNull("text")) {
            return run.optNonNullString("text")
        }

        val emojiObj = run.optJSONObject("emoji") ?: return null
        val emojiId = emojiObj.optNonNullString("emojiId")
        if (emojiId.isNotEmpty() && !emojiId.startsWith("UC") && emojiId.any { it.code > 0x7F }) {
            return emojiId
        }

        val label = emojiObj.optJSONObject("image")
            ?.optJSONObject("accessibility")
            ?.optJSONObject("accessibilityData")
            ?.optNonNullString("label")
            .orEmpty()
        if (label.isNotEmpty() && label.any { it.code > 0x7F } && label.codePointCount(0, label.length) <= 2) {
            return label
        }

        val shortcut = emojiObj.optJSONArray("shortcuts")
            ?.let { arr -> if (arr.length() > 0 && !arr.isNull(0)) arr.optString(0, "") else "" }
            .orEmpty()
        if (shortcut.isNotEmpty()) {
            return shortcodeToUnicode(shortcut)
        }
        return null
    }

    private fun extractMessageText(runs: JSONArray?): String {
        if (runs == null) return ""
        val sb = StringBuilder()
        for (i in 0 until runs.length()) {
            val run = runs.optJSONObject(i) ?: continue
            extractRunTextOrEmoji(run)?.let { sb.append(it) }
        }
        return sb.toString().trim()
    }

    fun parseTimestampUsec(renderer: JSONObject): Long {
        val raw = renderer.opt("timestampUsec") ?: return 0L
        return when (raw) {
            is Number -> raw.toLong().coerceAtLeast(0L)
            is String -> raw.toLongOrNull()?.coerceAtLeast(0L) ?: 0L
            else -> 0L
        }
    }

    fun parseChatAction(action: JSONObject): ParsedChatAction? {
        val item = action.optJSONObject("addChatItemAction")?.optJSONObject("item") ?: return null

        val textRenderer = item.optJSONObject("liveChatTextMessageRenderer")
        if (textRenderer != null) {
            val msgId = textRenderer.optNonNullString("id")
            val authorName = textRenderer.optJSONObject("authorName")
                ?.optNonNullString("simpleText")
                ?.takeIf { it.isNotBlank() }
                ?: "Anonymous"
            val authorId = textRenderer.optNonNullString("authorExternalChannelId").takeIf { it.isNotEmpty() }
            val timestampUsec = parseTimestampUsec(textRenderer)
            val text = extractMessageText(textRenderer.optJSONObject("message")?.optJSONArray("runs"))
            if (text.isEmpty()) return null

            return ParsedChatAction(
                msgId = msgId,
                authorName = authorName,
                authorId = authorId,
                text = text,
                isSuperchat = false,
                timestampUsec = timestampUsec
            )
        }

        val paidRenderer = item.optJSONObject("liveChatPaidMessageRenderer")
        if (paidRenderer != null) {
            val msgId = paidRenderer.optNonNullString("id")
            val authorName = paidRenderer.optJSONObject("authorName")
                ?.optNonNullString("simpleText")
                ?.takeIf { it.isNotBlank() }
                ?: "Anonymous"
            val authorId = paidRenderer.optNonNullString("authorExternalChannelId").takeIf { it.isNotEmpty() }
            val timestampUsec = parseTimestampUsec(paidRenderer)
            val amount = paidRenderer.optJSONObject("purchaseAmountText")
                ?.optNonNullString("simpleText")
                ?.trim()
                .orEmpty()
            val userText = extractMessageText(paidRenderer.optJSONObject("message")?.optJSONArray("runs"))

            val finalText = when {
                amount.isNotEmpty() && userText.isNotEmpty() -> "Super Chat ($amount): $userText"
                amount.isNotEmpty() -> "Super Chat: $amount"
                userText.isNotEmpty() -> userText
                else -> return null
            }

            return ParsedChatAction(
                msgId = msgId,
                authorName = authorName,
                authorId = authorId,
                text = finalText,
                isSuperchat = true,
                timestampUsec = timestampUsec
            )
        }

        return null
    }

    /**
     * Classifies whether a parsed message should be queued for TTS speech or skipped as backlog.
     */
    fun classifyMessage(
        timestampUsec: Long,
        isSuperchat: Boolean,
        isInitialPoll: Boolean,
        isColdStart: Boolean,
        watermarkUsec: Long
    ): Classification {
        return if (isInitialPoll) {
            if (isColdStart) {
                when {
                    isSuperchat && timestampUsec > 0L &&
                        timestampUsec + SUPERCHAT_GRACE_WINDOW_USEC >= watermarkUsec -> Classification.QUEUED
                    timestampUsec in 1L..watermarkUsec -> Classification.HISTORICAL
                    timestampUsec > watermarkUsec -> Classification.QUEUED
                    else -> Classification.HISTORICAL
                }
            } else {
                if (timestampUsec in 1L..watermarkUsec) Classification.HISTORICAL else Classification.QUEUED
            }
        } else {
            Classification.QUEUED
        }
    }
}

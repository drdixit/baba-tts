package com.babatts.overlay.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Outline
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Rect
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.res.ResourcesCompat
import com.babatts.overlay.R
import com.babatts.overlay.model.ChatMessage
import com.babatts.overlay.model.WordBoundary
import com.babatts.overlay.tts.AzureTtsClient
import com.babatts.overlay.tts.BabaSpeechEngine
import com.babatts.overlay.ui.DualKawaseGlassDrawable
import com.babatts.overlay.ui.MainActivity
import com.babatts.overlay.ui.RoundedHighlightTextView
import com.babatts.overlay.youtube.YouTubeChatPoller
import com.babatts.overlay.youtube.YouTubeMessageParser
import kotlin.math.abs

/**
 * Foreground Service that hosts and manages the Baba TTS floating overlay.
 * Dark-mode composite Dual Kawase glass HUD with deterministic per-chatter colors,
 * 100% opaque white typography, selectable bundled fonts/sizes, rounded-pill active word
 * highlighting, safe-inset screen clamping, and default-hidden moderation controls.
 */
class FloatingOverlayService : Service(), BabaSpeechEngine.SpeechEventListener {

    internal data class AlignedToken(
        val startChar: Int,
        val endChar: Int,
        val startBoundaryIndex: Int,
        val endBoundaryIndex: Int
    )

    companion object {
        const val TAG = "FloatingOverlayService"
        const val CHANNEL_ID = "baba_overlay_channel"
        const val NOTIFICATION_ID = 2001
        const val PREFS_NAME = "baba_overlay_prefs"
        const val PREF_X = "overlay_x"
        const val PREF_Y = "overlay_y"
        const val PREF_FONT_SIZE = "overlay_font_size"
        const val PREF_FONT_STYLE = "overlay_font_style"
        const val PREF_ENGINE = "overlay_engine"
        const val PREF_SYSTEM_TTS_LANG = "overlay_system_tts_lang"
        const val PREF_AZURE_KEY = "overlay_azure_key"
        const val PREF_AZURE_REGION = "overlay_azure_region"
        const val PREF_AZURE_VOICE = "overlay_azure_voice"
        const val PREF_ENABLE_YOUTUBE = "overlay_enable_youtube"
        const val PREF_YT_CHANNEL_ID = "overlay_yt_channel_id"
        const val PREF_YT_RESOLVED_INPUT = "overlay_yt_resolved_input"
        const val PREF_YT_RESOLVED_CHANNEL_ID = "overlay_yt_resolved_channel_id"
        const val PREF_YT_CHAT_MODE = "overlay_yt_chat_mode"

        const val FONT_SIZE_SMALL = "small"
        const val FONT_SIZE_MEDIUM = "medium"
        const val FONT_SIZE_LARGE = "large"

        const val FONT_STYLE_PLUS_JAKARTA = "plus_jakarta"
        const val FONT_STYLE_INTER = "inter"
        const val FONT_STYLE_NUNITO = "nunito"
        const val FONT_STYLE_MONO = "jetbrains_mono"

        const val ACTION_START = "com.babatts.overlay.START"
        const val ACTION_STOP = "com.babatts.overlay.STOP"
        const val ACTION_ENQUEUE = "com.babatts.overlay.ENQUEUE"
        const val ACTION_SKIP = "com.babatts.overlay.SKIP"
        const val ACTION_BAN = "com.babatts.overlay.BAN"
        const val ACTION_MUTE = "com.babatts.overlay.MUTE"
        const val ACTION_UPDATE_CONFIG = "com.babatts.overlay.UPDATE_CONFIG"
        const val ACTION_YOUTUBE_STATUS_CHANGED = "com.babatts.overlay.YOUTUBE_STATUS_CHANGED"

        const val EXTRA_AUTHOR = "extra_author"
        const val EXTRA_AUTHOR_ID = "extra_author_id"
        const val EXTRA_TEXT = "extra_text"
        const val EXTRA_PLATFORM = "extra_platform"
        const val EXTRA_ENGINE = "extra_engine"
        const val EXTRA_SYSTEM_TTS_LANG = "extra_system_tts_lang"
        const val EXTRA_KEY = "extra_key"
        const val EXTRA_REGION = "extra_region"
        const val EXTRA_VOICE = "extra_voice"
        const val EXTRA_FONT_SIZE = "extra_font_size"
        const val EXTRA_FONT_STYLE = "extra_font_style"
        const val EXTRA_ENABLE_YOUTUBE = "extra_enable_youtube"
        const val EXTRA_YT_CHANNEL_ID = "extra_yt_channel_id"
        const val EXTRA_YT_CHAT_MODE = "extra_yt_chat_mode"

        // Pre-computed color constant (100% opaque white text on dark-mode composite glass)
        const val COLOR_TEXT_WHITE = 0xFFFFFFFF.toInt()

        // Preserve Unicode letters, combining marks (Devanagari/accented scripts), and digits
        private val NON_WORD_REGEX = Regex("[^\\p{L}\\p{M}\\p{N}]")
        private val WORD_SUBTOKEN_REGEX = Regex("[\\p{L}\\p{M}\\p{N}]+")

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var youtubeStatus: YouTubeChatPoller.Status = YouTubeChatPoller.Status(
            state = YouTubeChatPoller.State.DISABLED,
            summary = "YouTube Live Chat is off"
        )
            private set

        internal fun normalizeWordToken(token: String): String {
            return token.replace(NON_WORD_REGEX, "").lowercase()
        }

        private fun canCompleteSplitToken(
            normVisual: String,
            boundaries: List<WordBoundary>,
            startIdx: Int
        ): Boolean {
            var combined = normalizeWordToken(boundaries[startIdx].text)
            if (combined.isEmpty() || !normVisual.startsWith(combined)) return false
            var idx = startIdx + 1
            while (idx < boundaries.size && combined.length < normVisual.length) {
                val nextNorm = normalizeWordToken(boundaries[idx].text)
                if (nextNorm.isEmpty()) {
                    idx++
                    continue
                }
                val candidate = combined + nextNorm
                if (!normVisual.startsWith(candidate)) return false
                combined = candidate
                if (combined == normVisual) return true
                idx++
            }
            return combined == normVisual
        }

        /**
         * Locates the boundary corresponding to "says:" or "says".
         * Counts alphanumeric sub-tokens in [author] so punctuation-split usernames (e.g. "Simon-Says")
         * and emoji-only usernames do not cause false matches or skipped delimiters.
         */
        internal fun findSaysIndex(wordBoundaries: List<WordBoundary>, author: String? = null): Int {
            val expectedAuthorSubtokens = if (!author.isNullOrBlank()) {
                WORD_SUBTOKEN_REGEX.findAll(author).count()
            } else {
                0
            }

            var seenAuthorSubtokens = 0
            for (i in wordBoundaries.indices) {
                val raw = wordBoundaries[i].text.trim()
                val clean = raw.trimEnd(':', ',', '.', '!', '?')
                if (seenAuthorSubtokens >= expectedAuthorSubtokens && clean.equals("says", ignoreCase = true)) {
                    return i
                }
                seenAuthorSubtokens += WORD_SUBTOKEN_REGEX.findAll(raw).count()
            }

            return wordBoundaries.indexOfFirst {
                val clean = it.text.trim().trimEnd(':', ',', '.', '!', '?')
                clean.equals("says", ignoreCase = true)
            }
        }

        /**
         * Returns the starting index in [wordBoundaries] for message words after "says:"
         * (skipping a standalone ":" boundary if Azure split "says" and ":").
         */
        internal fun findMessageStartIndex(wordBoundaries: List<WordBoundary>, saysIndex: Int): Int {
            if (saysIndex < 0) return 0
            var idx = saysIndex + 1
            while (idx < wordBoundaries.size && normalizeWordToken(wordBoundaries[idx].text).isEmpty()) {
                idx++
            }
            return idx
        }

        /**
         * Aligns spoken [messageBoundaries] onto visual whitespace-delimited tokens in [fullText],
         * preserving original punctuation, apostrophes, spacing, and emojis.
         */
        internal fun alignBoundariesToText(
            fullText: String,
            messageBoundaries: List<WordBoundary>
        ): List<AlignedToken> {
            val visualMatches = Regex("\\S+").findAll(fullText).toList()
            if (visualMatches.isEmpty()) return emptyList()
            if (messageBoundaries.isEmpty()) {
                return visualMatches.map {
                    AlignedToken(it.range.first, it.range.last + 1, -1, -1)
                }
            }

            val result = ArrayList<AlignedToken>(visualMatches.size)
            var boundIdx = 0
            var lastStartBoundary = -1
            var lastEndBoundary = -1

            for (match in visualMatches) {
                val startChar = match.range.first
                val endChar = match.range.last + 1
                val normVisual = normalizeWordToken(match.value)

                if (normVisual.isEmpty()) {
                    // Pure emoji/punctuation: light up alongside the preceding spoken word (or first word if leading)
                    val firstWordIdx = messageBoundaries.indexOfFirst { normalizeWordToken(it.text).isNotEmpty() }
                        .let { if (it >= 0) it else 0 }
                    val anchor = if (lastStartBoundary >= 0) lastStartBoundary else firstWordIdx
                    val anchorEnd = if (lastEndBoundary >= 0) lastEndBoundary else firstWordIdx
                    result.add(AlignedToken(startChar, endChar, anchor, anchorEnd))
                    continue
                }

                // Scan up to 6 non-empty word boundaries so punctuation bursts do not exhaust lookahead
                var matchedStart = -1
                var nonEmptyChecked = 0
                var j = boundIdx
                while (j < messageBoundaries.size && nonEmptyChecked < 6) {
                    val normBound = normalizeWordToken(messageBoundaries[j].text)
                    if (normBound.isEmpty()) {
                        j++
                        continue
                    }
                    nonEmptyChecked++
                    val isMatch = normVisual == normBound ||
                        (minOf(normVisual.length, normBound.length) >= 3 &&
                            (normVisual.contains(normBound) || normBound.contains(normVisual))) ||
                        (normBound.length < normVisual.length && canCompleteSplitToken(normVisual, messageBoundaries, j))
                    if (isMatch) {
                        matchedStart = j
                        break
                    }
                    j++
                }

                if (matchedStart >= 0) {
                    var matchedEnd = matchedStart
                    var combinedNorm = normalizeWordToken(messageBoundaries[matchedStart].text)
                    var nextIdx = matchedStart + 1

                    // Consume split sub-tokens (e.g., "isn" + "'" + "t" -> "isnt") so they don't shift later words
                    while (nextIdx < messageBoundaries.size && combinedNorm.length < normVisual.length) {
                        val nextNorm = normalizeWordToken(messageBoundaries[nextIdx].text)
                        if (nextNorm.isEmpty()) {
                            nextIdx++
                            continue
                        }
                        val candidate = combinedNorm + nextNorm
                        if (normVisual.startsWith(candidate)) {
                            combinedNorm = candidate
                            matchedEnd = nextIdx
                            nextIdx++
                        } else {
                            break
                        }
                    }

                    boundIdx = matchedEnd + 1
                    lastStartBoundary = matchedStart
                    lastEndBoundary = matchedEnd
                    result.add(AlignedToken(startChar, endChar, matchedStart, matchedEnd))
                } else {
                    // Advance fallback linearly across consecutive unmatched tokens (e.g. "$50 $60" -> words)
                    var fallback = (lastEndBoundary + 1).coerceAtMost(messageBoundaries.lastIndex)
                    while (fallback < messageBoundaries.lastIndex && normalizeWordToken(messageBoundaries[fallback].text).isEmpty()) {
                        fallback++
                    }
                    lastStartBoundary = fallback
                    lastEndBoundary = fallback
                    boundIdx = (fallback + 1).coerceAtMost(messageBoundaries.size)
                    result.add(AlignedToken(startChar, endChar, fallback, fallback))
                }
            }

            return result
        }

        internal fun shouldCollapseToIdle(activeMessageId: String?): Boolean = activeMessageId == null

        /**
         * Returns the combined `[startChar, endChar]` character span covering all tokens matching [relActiveIndex],
         * or null when no token is active.
         */
        internal fun computeActiveHighlightRange(
            alignedTokens: List<AlignedToken>,
            relActiveIndex: Int
        ): Pair<Int, Int>? {
            if (relActiveIndex < 0 || alignedTokens.isEmpty()) return null
            var minStart = Int.MAX_VALUE
            var maxEnd = -1
            for (token in alignedTokens) {
                if (token.startBoundaryIndex >= 0 && relActiveIndex in token.startBoundaryIndex..token.endBoundaryIndex) {
                    if (token.startChar < minStart) minStart = token.startChar
                    if (token.endChar > maxEnd) maxEnd = token.endChar
                }
            }
            return if (maxEnd > minStart) Pair(minStart, maxEnd) else null
        }
    }

    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private lateinit var layoutParams: WindowManager.LayoutParams
    private lateinit var prefs: SharedPreferences

    private lateinit var speechEngine: BabaSpeechEngine
    private var youtubePoller: YouTubeChatPoller? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    // UI View References
    private var rootPill: LinearLayout? = null
    private var glassDrawable: DualKawaseGlassDrawable? = null
    private var waveContainer: LinearLayout? = null
    private var waveBar1: View? = null
    private var waveBar2: View? = null
    private var waveBar3: View? = null
    private var textAuthor: TextView? = null
    private var textSubtitles: RoundedHighlightTextView? = null
    private var controlsContainer: LinearLayout? = null
    private var btnSkip: TextView? = null
    private var btnBan: TextView? = null
    private var btnMute: TextView? = null

    // Saved anchor coordinates so wide messages don't permanently shift a right-docked idle badge
    private var anchorX: Int = 0
    private var anchorY: Int = 0

    // Active Message & Alignment Cache (keyed on original wordBoundaries reference, not transient subList)
    private var currentFontSize: String = FONT_SIZE_MEDIUM
    private var currentFontStyle: String = FONT_STYLE_PLUS_JAKARTA
    private var activeWordHighlightBg: Int = DualKawaseGlassDrawable.DEFAULT_THEME.activeWordBg
    private var activeMessageId: String? = null
    private var cachedText: String? = null
    private var cachedAuthor: String? = null
    private var cachedBoundariesRef: List<WordBoundary>? = null
    private var cachedSaysIndex: Int = -1
    private var cachedMessageStartIdx: Int = 0
    private var cachedAlignedTokens: List<AlignedToken> = emptyList()

    // Auto-Collapse Timer
    private val idleCollapseRunnable = Runnable {
        if (shouldCollapseToIdle(activeMessageId)) {
            transitionToIdle()
        }
    }

    private var touchSlop: Int = 0

    private fun hasOverlayPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        touchSlop = ViewConfiguration.get(this).scaledTouchSlop

        createNotificationChannel()
        startForegroundWithNotification()

        if (!hasOverlayPermission()) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW permission missing; stopping FloatingOverlayService")
            isRunning = false
            stopSelf()
            return
        }

        currentFontSize = prefs.getString(PREF_FONT_SIZE, FONT_SIZE_MEDIUM) ?: FONT_SIZE_MEDIUM
        currentFontStyle = prefs.getString(PREF_FONT_STYLE, FONT_STYLE_PLUS_JAKARTA) ?: FONT_STYLE_PLUS_JAKARTA

        speechEngine = BabaSpeechEngine(this, this).apply {
            activeEngine = prefs.getString(PREF_ENGINE, BabaSpeechEngine.ENGINE_SYSTEM) ?: BabaSpeechEngine.ENGINE_SYSTEM
            systemLanguageMode = prefs.getString(PREF_SYSTEM_TTS_LANG, BabaSpeechEngine.SYSTEM_LANG_HINGLISH)
                ?: BabaSpeechEngine.SYSTEM_LANG_HINGLISH
            azureClient.key = prefs.getString(PREF_AZURE_KEY, AzureTtsClient.DEFAULT_KEY) ?: AzureTtsClient.DEFAULT_KEY
            azureClient.region = prefs.getString(PREF_AZURE_REGION, AzureTtsClient.DEFAULT_REGION) ?: AzureTtsClient.DEFAULT_REGION
            azureClient.defaultVoice = prefs.getString(PREF_AZURE_VOICE, AzureTtsClient.DEFAULT_VOICE) ?: AzureTtsClient.DEFAULT_VOICE
        }

        initWindowManager()
        if (!initOverlayViews()) {
            isRunning = false
            return
        }
        setupTouchListener()

        youtubePoller = YouTubeChatPoller(object : YouTubeChatPoller.Listener {
            override fun onMessageReceived(message: ChatMessage, isPriority: Boolean) {
                speechEngine.enqueue(message, isPriority)
            }

            override fun onStatusChanged(status: YouTubeChatPoller.Status) {
                publishYouTubeStatus(status)
            }

            override fun isAuthorBanned(authorName: String, authorId: String?): Boolean {
                return speechEngine.isAuthorBanned(authorName, authorId)
            }
        })

        isRunning = true
        applyTypography(currentFontSize, currentFontStyle, requestLayout = false)
        transitionToIdle()
        if (!prefs.getBoolean(PREF_ENABLE_YOUTUBE, false)) {
            publishYouTubeStatus(
                YouTubeChatPoller.Status(
                    state = YouTubeChatPoller.State.DISABLED,
                    summary = "YouTube Live Chat is off"
                )
            )
        }
        configureYouTubeFromPrefs()
        Log.i(TAG, "FloatingOverlayService initialized with Dual Kawase dark glass HUD")
    }

    private fun publishYouTubeStatus(status: YouTubeChatPoller.Status) {
        youtubeStatus = status
        val resolvedId = status.resolvedChannelId
        val sourceInput = status.channelInput
        if (!resolvedId.isNullOrBlank() && !sourceInput.isNullOrBlank()) {
            val currentInput = prefs.getString(PREF_YT_CHANNEL_ID, "")?.trim() ?: ""
            if (sourceInput == currentInput) {
                val prevResolvedInput = prefs.getString(PREF_YT_RESOLVED_INPUT, "") ?: ""
                val prevResolvedId = prefs.getString(PREF_YT_RESOLVED_CHANNEL_ID, "") ?: ""
                if (sourceInput != prevResolvedInput || resolvedId != prevResolvedId) {
                    prefs.edit()
                        .putString(PREF_YT_RESOLVED_INPUT, sourceInput)
                        .putString(PREF_YT_RESOLVED_CHANNEL_ID, resolvedId)
                        .apply()
                }
            }
        }
        sendBroadcast(Intent(ACTION_YOUTUBE_STATUS_CHANGED).setPackage(packageName))
    }

    private fun configureYouTubeFromPrefs() {
        val enabled = prefs.getBoolean(PREF_ENABLE_YOUTUBE, false)
        val channelId = prefs.getString(PREF_YT_CHANNEL_ID, "") ?: ""
        val chatMode = prefs.getString(PREF_YT_CHAT_MODE, YouTubeMessageParser.CHAT_MODE_LIVE)
            ?: YouTubeMessageParser.CHAT_MODE_LIVE
        youtubePoller?.configure(enabled, channelId, chatMode)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (overlayView == null || !hasOverlayPermission()) {
            isRunning = false
            stopSelf()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_ENQUEUE -> {
                val author = intent.getStringExtra(EXTRA_AUTHOR) ?: "Viewer"
                val text = intent.getStringExtra(EXTRA_TEXT) ?: "Hello Baba!"
                val platform = intent.getStringExtra(EXTRA_PLATFORM) ?: "YouTube"
                speechEngine.enqueue(ChatMessage(author = author, platform = platform, text = text))
            }
            ACTION_SKIP -> speechEngine.skip()
            ACTION_BAN -> {
                val author = intent.getStringExtra(EXTRA_AUTHOR).orEmpty()
                val authorId = intent.getStringExtra(EXTRA_AUTHOR_ID)
                if (author.isNotBlank() || !authorId.isNullOrBlank()) {
                    speechEngine.banAuthor(author, authorId)
                }
            }
            ACTION_MUTE -> {
                val muted = speechEngine.toggleMute()
                btnMute?.text = if (muted) "🔊 Unmute" else "🔇 Mute"
            }
            ACTION_START, ACTION_UPDATE_CONFIG -> {
                val prefEditor = prefs.edit()
                intent.getStringExtra(EXTRA_ENGINE)?.let {
                    speechEngine.activeEngine = it
                    prefEditor.putString(PREF_ENGINE, it)
                }
                intent.getStringExtra(EXTRA_SYSTEM_TTS_LANG)?.let {
                    speechEngine.systemLanguageMode = it
                    prefEditor.putString(PREF_SYSTEM_TTS_LANG, it)
                }
                intent.getStringExtra(EXTRA_KEY)?.let {
                    speechEngine.azureClient.key = it
                    prefEditor.putString(PREF_AZURE_KEY, it)
                }
                intent.getStringExtra(EXTRA_REGION)?.let {
                    speechEngine.azureClient.region = it
                    prefEditor.putString(PREF_AZURE_REGION, it)
                }
                intent.getStringExtra(EXTRA_VOICE)?.let {
                    speechEngine.azureClient.defaultVoice = it
                    prefEditor.putString(PREF_AZURE_VOICE, it)
                }

                var youtubeConfigProvided = false
                if (intent.hasExtra(EXTRA_ENABLE_YOUTUBE)) {
                    prefEditor.putBoolean(PREF_ENABLE_YOUTUBE, intent.getBooleanExtra(EXTRA_ENABLE_YOUTUBE, false))
                    youtubeConfigProvided = true
                }
                intent.getStringExtra(EXTRA_YT_CHANNEL_ID)?.let {
                    prefEditor.putString(PREF_YT_CHANNEL_ID, it)
                    youtubeConfigProvided = true
                }
                intent.getStringExtra(EXTRA_YT_CHAT_MODE)?.let {
                    prefEditor.putString(PREF_YT_CHAT_MODE, it)
                    youtubeConfigProvided = true
                }

                val fontSize = intent.getStringExtra(EXTRA_FONT_SIZE)
                val fontStyle = intent.getStringExtra(EXTRA_FONT_STYLE)
                if (fontSize != null) {
                    currentFontSize = fontSize
                    prefEditor.putString(PREF_FONT_SIZE, fontSize)
                }
                if (fontStyle != null) {
                    currentFontStyle = fontStyle
                    prefEditor.putString(PREF_FONT_STYLE, fontStyle)
                }
                prefEditor.apply()

                if (fontSize != null || fontStyle != null) {
                    applyTypography(currentFontSize, currentFontStyle, requestLayout = true)
                }
                if (youtubeConfigProvided) {
                    configureYouTubeFromPrefs()
                }
            }
        }
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applySubtitleMaxWidth()
        if (activeMessageId == null && controlsContainer?.visibility != View.VISIBLE) {
            layoutParams.x = anchorX
            layoutParams.y = anchorY
        }
        updateOverlayLayout()
    }

    private fun initWindowManager() {
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val safeBounds = getSafeDisplayBounds()
        val defaultX = (safeBounds.right - dpToPx(300)).coerceAtLeast(safeBounds.left + dpToPx(16))
        val defaultY = safeBounds.top + dpToPx(16)
        anchorX = prefs.getInt(PREF_X, defaultX)
        anchorY = prefs.getInt(PREF_Y, defaultY)

        layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = anchorX
            y = anchorY
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            }
        }
    }

    private fun initOverlayViews(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW permission missing; stopping FloatingOverlayService")
            stopSelf()
            return false
        }

        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.overlay_bubble, null)
        overlayView = view

        rootPill = view.findViewById(R.id.overlay_root)
        val cornerRadiusPx = dpToPx(12).toFloat()
        val glass = DualKawaseGlassDrawable(cornerRadiusPx)
        glassDrawable = glass
        rootPill?.apply {
            background = glass
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(target: View, outline: Outline) {
                    outline.setRoundRect(0, 0, target.width, target.height, cornerRadiusPx)
                }
            }
            clipToOutline = true
        }
        waveContainer = view.findViewById(R.id.wave_container)
        waveBar1 = view.findViewById(R.id.wave_bar_1)
        waveBar2 = view.findViewById(R.id.wave_bar_2)
        waveBar3 = view.findViewById(R.id.wave_bar_3)
        textAuthor = view.findViewById(R.id.text_author)
        textSubtitles = view.findViewById(R.id.text_subtitles)
        controlsContainer = view.findViewById(R.id.controls_container)
        btnSkip = view.findViewById(R.id.btn_overlay_skip)
        btnBan = view.findViewById(R.id.btn_overlay_ban)
        btnMute = view.findViewById(R.id.btn_overlay_mute)

        resetWaveBarRestingPose()
        controlsContainer?.visibility = View.GONE
        applySubtitleMaxWidth()

        btnSkip?.setOnClickListener {
            speechEngine.skip()
            rescheduleIdleControlsTimeout()
        }
        btnBan?.setOnClickListener {
            val target = speechEngine.currentSpeakingMessage ?: speechEngine.lastSpokenMessage
            if (target != null && (target.author.isNotBlank() || !target.authorId.isNullOrBlank())) {
                speechEngine.banAuthor(target.author, target.authorId)
            }
            rescheduleIdleControlsTimeout()
        }
        btnMute?.setOnClickListener {
            val muted = speechEngine.toggleMute()
            btnMute?.text = if (muted) "🔊 Unmute" else "🔇 Mute"
            rescheduleIdleControlsTimeout()
        }

        return try {
            windowManager.addView(overlayView, layoutParams)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add overlay view: ${e.message}", e)
            overlayView = null
            stopSelf()
            false
        }
    }

    private fun applyTypography(size: String, style: String, requestLayout: Boolean) {
        applyFontSizeInternal(size)
        applyFontStyleInternal(style)
        if (requestLayout) {
            updateOverlayLayout()
        }
    }

    /**
     * Applies configurable font size to the overlay subtitle card and controls.
     */
    fun applyFontSize(size: String) {
        applyFontSizeInternal(size)
        updateOverlayLayout()
    }

    private fun applyFontSizeInternal(size: String) {
        currentFontSize = size
        when (size) {
            FONT_SIZE_SMALL -> {
                textSubtitles?.textSize = 12f
                textAuthor?.textSize = 12f
                btnSkip?.textSize = 9f
                btnBan?.textSize = 9f
                btnMute?.textSize = 9f
            }
            FONT_SIZE_LARGE -> {
                textSubtitles?.textSize = 19f
                textAuthor?.textSize = 16f
                btnSkip?.textSize = 11f
                btnBan?.textSize = 11f
                btnMute?.textSize = 11f
            }
            else -> {
                textSubtitles?.textSize = 15f
                textAuthor?.textSize = 13f
                btnSkip?.textSize = 10f
                btnBan?.textSize = 10f
                btnMute?.textSize = 10f
            }
        }
    }

    /**
     * Applies the selected bundled font family to the overlay username, subtitle text, and action chips.
     */
    fun applyFontStyle(style: String) {
        applyFontStyleInternal(style)
        updateOverlayLayout()
    }

    private fun applyFontStyleInternal(style: String) {
        currentFontStyle = style
        val fontResId = when (style) {
            FONT_STYLE_INTER -> R.font.font_inter
            FONT_STYLE_NUNITO -> R.font.font_nunito
            FONT_STYLE_MONO -> R.font.font_jetbrains_mono
            else -> R.font.font_plus_jakarta
        }
        val typeface = ResourcesCompat.getFont(this, fontResId)
        val letterSpacing = if (style == FONT_STYLE_MONO) 0f else 0.01f

        textAuthor?.apply {
            setTypeface(typeface, Typeface.BOLD)
            this.letterSpacing = letterSpacing
        }
        textSubtitles?.apply {
            setTypeface(typeface, Typeface.NORMAL)
            this.letterSpacing = letterSpacing
        }
        btnSkip?.setTypeface(typeface, Typeface.NORMAL)
        btnBan?.setTypeface(typeface, Typeface.NORMAL)
        btnMute?.setTypeface(typeface, Typeface.NORMAL)
    }

    private fun updateOverlayLayout() {
        overlayView?.let { view ->
            view.requestLayout()
            try {
                windowManager.updateViewLayout(view, layoutParams)
            } catch (e: Exception) {
                Log.w(TAG, "updateViewLayout failed: ${e.message}")
            }
            view.post { keepOverlayOnScreen() }
        }
    }

    /**
     * Caps subtitle width and maxHeight to the safe display area so long messages stay readable
     * and never push Skip/Ban/Mute controls off-screen.
     */
    private fun applySubtitleMaxWidth() {
        val safeBounds = getSafeDisplayBounds()
        val screenCap = (safeBounds.width() - dpToPx(48)).coerceAtLeast(dpToPx(120))
        val subtitleMax = screenCap.coerceAtMost(dpToPx(440))
        val subtitleMaxHeight = (safeBounds.height() * 0.55f).toInt().coerceAtLeast(dpToPx(96))
        textSubtitles?.maxWidth = subtitleMax
        textSubtitles?.maxHeight = subtitleMaxHeight
        textAuthor?.maxWidth = subtitleMax
    }

    /** Shifts the overlay so its full bounds stay inside the safe display insets. */
    private fun keepOverlayOnScreen() {
        val view = overlayView ?: return
        if (view.width == 0 || view.height == 0) return
        val safeBounds = getSafeDisplayBounds()
        val maxX = (safeBounds.right - view.width).coerceAtLeast(safeBounds.left)
        val maxY = (safeBounds.bottom - view.height).coerceAtLeast(safeBounds.top)
        val newX = layoutParams.x.coerceIn(safeBounds.left, maxX)
        val newY = layoutParams.y.coerceIn(safeBounds.top, maxY)
        if (newX != layoutParams.x || newY != layoutParams.y) {
            layoutParams.x = newX
            layoutParams.y = newY
            try {
                windowManager.updateViewLayout(view, layoutParams)
            } catch (e: Exception) {
                Log.w(TAG, "keepOverlayOnScreen failed: ${e.message}")
            }
        }
    }

    private fun setupTouchListener() {
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isClick = false

        rootPill?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    mainHandler.removeCallbacks(idleCollapseRunnable)
                    initialX = layoutParams.x
                    initialY = layoutParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isClick = true
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = (event.rawX - initialTouchX).toInt()
                    val deltaY = (event.rawY - initialTouchY).toInt()

                    if (isClick && (abs(deltaX) > touchSlop || abs(deltaY) > touchSlop)) {
                        isClick = false
                    }

                    if (!isClick) {
                        val safeBounds = getSafeDisplayBounds()
                        val viewWidth = overlayView?.width ?: dpToPx(60)
                        val viewHeight = overlayView?.height ?: dpToPx(60)

                        layoutParams.x = (initialX + deltaX).coerceIn(
                            safeBounds.left,
                            (safeBounds.right - viewWidth).coerceAtLeast(safeBounds.left)
                        )
                        layoutParams.y = (initialY + deltaY).coerceIn(
                            safeBounds.top,
                            (safeBounds.bottom - viewHeight).coerceAtLeast(safeBounds.top)
                        )
                        overlayView?.let {
                            try {
                                windowManager.updateViewLayout(it, layoutParams)
                            } catch (e: Exception) {
                                Log.w(TAG, "drag updateViewLayout failed: ${e.message}")
                            }
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (isClick) {
                        toggleControlsVisibility()
                    } else {
                        saveAnchorPosition()
                        rescheduleIdleControlsTimeout()
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    if (!isClick) {
                        saveAnchorPosition()
                    }
                    rescheduleIdleControlsTimeout()
                    true
                }
                else -> false
            }
        }
    }

    private fun saveAnchorPosition() {
        anchorX = layoutParams.x
        anchorY = layoutParams.y
        prefs.edit()
            .putInt(PREF_X, anchorX)
            .putInt(PREF_Y, anchorY)
            .apply()
        Log.d(TAG, "Custom overlay position saved: x=$anchorX, y=$anchorY")
    }

    private fun rescheduleIdleControlsTimeout() {
        if (activeMessageId == null && controlsContainer?.visibility == View.VISIBLE) {
            mainHandler.removeCallbacks(idleCollapseRunnable)
            mainHandler.postDelayed(idleCollapseRunnable, 4000)
        }
    }

    /**
     * Toggles visibility of the action buttons (Skip, Ban, Mute).
     * When idle, tapping reveals controls (and the last spoken message if any) temporarily,
     * and tapping again collapses immediately back to the compact wave badge.
     */
    private fun toggleControlsVisibility() {
        if (activeMessageId == null) {
            mainHandler.removeCallbacks(idleCollapseRunnable)
            if (controlsContainer?.visibility == View.VISIBLE) {
                transitionToIdle()
                return
            }
            rootPill?.alpha = 1.0f
            glassDrawable?.alpha = 255
            val last = speechEngine.lastSpokenMessage
            if (last != null) {
                applyGlassThemeForAuthor(last.author)
                rootPill?.gravity = Gravity.START
                waveContainer?.visibility = View.GONE
                textAuthor?.text = "@${last.author}"
                textAuthor?.background = null
                textAuthor?.alpha = 1.0f
                textAuthor?.setTextColor(COLOR_TEXT_WHITE)
                textSubtitles?.text = last.text
                textSubtitles?.clearHighlight()
                textSubtitles?.alpha = 1.0f
                textSubtitles?.setTextColor(COLOR_TEXT_WHITE)
                textAuthor?.visibility = View.VISIBLE
                textSubtitles?.visibility = View.VISIBLE
            } else {
                rootPill?.gravity = Gravity.CENTER
                waveContainer?.visibility = View.VISIBLE
                textAuthor?.visibility = View.GONE
                textSubtitles?.visibility = View.GONE
            }
            controlsContainer?.visibility = View.VISIBLE
            mainHandler.postDelayed(idleCollapseRunnable, 4000)
            updateOverlayLayout()
            return
        }

        val current = controlsContainer?.visibility ?: View.GONE
        controlsContainer?.visibility = if (current == View.VISIBLE) View.GONE else View.VISIBLE
        updateOverlayLayout()
    }

    // --- SpeechEventListener Callbacks ---

    override fun onSpeechStarted(message: ChatMessage, wordBoundaries: List<WordBoundary>) {
        mainHandler.post {
            transitionToSpeaking(message, wordBoundaries)
        }
    }

    override fun onWordHighlighted(message: ChatMessage, activeWordIndex: Int, wordBoundaries: List<WordBoundary>) {
        mainHandler.post {
            if (activeMessageId != message.id) return@post
            renderKaraokeSubtitles(message.text, activeWordIndex, wordBoundaries, message.author)
        }
    }

    override fun onSpeechCompleted(message: ChatMessage) {
        mainHandler.post {
            if (activeMessageId != message.id) return@post
            activeMessageId = null
            textAuthor?.background = null
            textAuthor?.alpha = 1.0f
            textAuthor?.setTextColor(COLOR_TEXT_WHITE)
            textSubtitles?.alpha = 1.0f
            textSubtitles?.setTextColor(COLOR_TEXT_WHITE)
            textSubtitles?.clearHighlight()
        }
    }

    override fun onQueueEmpty() {
        mainHandler.removeCallbacks(idleCollapseRunnable)
        mainHandler.postDelayed(idleCollapseRunnable, 2500)
    }

    override fun onStateChanged(isMuted: Boolean, bannedCount: Int) {
        mainHandler.post {
            btnMute?.text = if (isMuted) "🔊 Unmute" else "🔇 Mute"
        }
    }

    // --- Karaoke Subtitle Rendering ---

    private fun ensureMessageAlignmentCache(
        fullText: String,
        wordBoundaries: List<WordBoundary>,
        author: String?
    ) {
        if (cachedText != fullText ||
            cachedAuthor != author ||
            cachedBoundariesRef !== wordBoundaries
        ) {
            cachedText = fullText
            cachedAuthor = author
            cachedBoundariesRef = wordBoundaries
            cachedSaysIndex = findSaysIndex(wordBoundaries, author)
            cachedMessageStartIdx = findMessageStartIndex(wordBoundaries, cachedSaysIndex)
            val messageBoundaries = if (cachedMessageStartIdx in 0..wordBoundaries.size) {
                wordBoundaries.subList(cachedMessageStartIdx, wordBoundaries.size)
            } else {
                emptyList()
            }
            cachedAlignedTokens = alignBoundariesToText(fullText, messageBoundaries)
        }
    }

    /**
     * Updates the rounded-pill highlight range on [textSubtitles] without reallocating spans
     * or altering glyph advance widths (zero layout reflow jitter; 100% opaque white text).
     */
    private fun renderKaraokeSubtitles(
        fullText: String,
        activeWordIndex: Int,
        wordBoundaries: List<WordBoundary>,
        author: String? = null
    ) {
        ensureMessageAlignmentCache(fullText, wordBoundaries, author)
        val hasMessageBoundaries = cachedMessageStartIdx < wordBoundaries.size

        if ((cachedSaysIndex >= 0 && activeWordIndex < cachedMessageStartIdx) ||
            !hasMessageBoundaries ||
            activeWordIndex < 0
        ) {
            textSubtitles?.clearHighlight()
            return
        }

        val relActiveIndex = activeWordIndex - cachedMessageStartIdx
        val range = computeActiveHighlightRange(cachedAlignedTokens, relActiveIndex)
        if (range != null) {
            textSubtitles?.setHighlightRange(range.first, range.second, activeWordHighlightBg)
        } else {
            textSubtitles?.clearHighlight()
        }
    }

    // --- UI State Transitions ---

    private fun applyGlassThemeForAuthor(author: String?) {
        val theme = DualKawaseGlassDrawable.themeForAuthor(author)
        activeWordHighlightBg = theme.activeWordBg
        glassDrawable?.setTheme(theme)
    }

    private fun transitionToSpeaking(message: ChatMessage, wordBoundaries: List<WordBoundary>) {
        mainHandler.removeCallbacks(idleCollapseRunnable)
        activeMessageId = message.id
        cachedText = null
        cachedAuthor = null
        cachedBoundariesRef = null

        applyGlassThemeForAuthor(message.author)
        rootPill?.alpha = 1.0f
        glassDrawable?.alpha = 255
        rootPill?.gravity = Gravity.START
        waveContainer?.visibility = View.GONE
        textAuthor?.visibility = View.VISIBLE
        textSubtitles?.visibility = View.VISIBLE
        controlsContainer?.visibility = View.GONE

        applySubtitleMaxWidth()
        textAuthor?.background = null
        textAuthor?.alpha = 1.0f
        textAuthor?.setTextColor(COLOR_TEXT_WHITE)
        textAuthor?.text = "@${message.author}"

        textSubtitles?.alpha = 1.0f
        textSubtitles?.setTextColor(COLOR_TEXT_WHITE)
        textSubtitles?.text = message.text
        textSubtitles?.clearHighlight()

        ensureMessageAlignmentCache(message.text, wordBoundaries, message.author)
        val initialIndex = if (cachedSaysIndex >= 0) 0 else -1
        renderKaraokeSubtitles(message.text, initialIndex, wordBoundaries, message.author)

        updateOverlayLayout()
    }

    private fun transitionToIdle() {
        activeMessageId = null

        val defaultTheme = DualKawaseGlassDrawable.DEFAULT_THEME
        activeWordHighlightBg = defaultTheme.activeWordBg
        glassDrawable?.setTheme(defaultTheme)
        glassDrawable?.alpha = 184

        // Restore the user's saved anchor so right-docked badges don't permanently drift left
        layoutParams.x = anchorX
        layoutParams.y = anchorY

        rootPill?.alpha = 1.0f
        rootPill?.gravity = Gravity.CENTER
        waveContainer?.visibility = View.VISIBLE
        textAuthor?.visibility = View.GONE
        textSubtitles?.visibility = View.GONE
        textSubtitles?.clearHighlight()
        controlsContainer?.visibility = View.GONE

        textAuthor?.background = null
        textAuthor?.setTextColor(COLOR_TEXT_WHITE)
        updateOverlayLayout()
    }

    private fun resetWaveBarRestingPose() {
        val pivotPx = dpToPx(16).toFloat()
        waveBar1?.apply { pivotY = pivotPx; scaleY = 0.38f }
        waveBar2?.apply { pivotY = pivotPx; scaleY = 0.75f }
        waveBar3?.apply { pivotY = pivotPx; scaleY = 0.50f }
    }

    // --- Helpers ---

    private fun getSafeDisplayBounds(): Rect {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val metrics = windowManager.currentWindowMetrics
            val bounds = Rect(metrics.bounds)
            val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
            )
            bounds.left += insets.left
            bounds.top += insets.top
            bounds.right = (bounds.right - insets.right).coerceAtLeast(bounds.left + dpToPx(120))
            bounds.bottom = (bounds.bottom - insets.bottom).coerceAtLeast(bounds.top + dpToPx(120))
            bounds
        } else {
            val point = Point()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getSize(point)
            Rect(0, dpToPx(24), point.x.coerceAtLeast(dpToPx(120)), point.y.coerceAtLeast(dpToPx(120)))
        }
    }

    private fun dpToPx(dp: Int): Int {
        val metrics: DisplayMetrics = resources.displayMetrics
        return (dp * (metrics.densityDpi.toFloat() / DisplayMetrics.DENSITY_DEFAULT)).toInt()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.overlay_service_title),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.overlay_service_desc)
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun startForegroundWithNotification() {
        val mainIntent = Intent(this, MainActivity::class.java)
        val pendingMain = PendingIntent.getActivity(
            this, 0, mainIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val skipIntent = Intent(this, FloatingOverlayService::class.java).apply { action = ACTION_SKIP }
        val pendingSkip = PendingIntent.getService(this, 1, skipIntent, PendingIntent.FLAG_IMMUTABLE)

        val muteIntent = Intent(this, FloatingOverlayService::class.java).apply { action = ACTION_MUTE }
        val pendingMute = PendingIntent.getService(this, 2, muteIntent, PendingIntent.FLAG_IMMUTABLE)

        val stopIntent = Intent(this, FloatingOverlayService::class.java).apply { action = ACTION_STOP }
        val pendingStop = PendingIntent.getService(this, 3, stopIntent, PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.baba_mascot)
            .setContentTitle("Baba TTS Floating HUD")
            .setContentText("Active streaming overlay (Streamlabs audio capture ready)")
            .setContentIntent(pendingMain)
            .setOngoing(true)
            .addAction(R.drawable.baba_mascot, "Skip", pendingSkip)
            .addAction(R.drawable.baba_mascot, "Mute", pendingMute)
            .addAction(R.drawable.baba_mascot, "Stop", pendingStop)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        mainHandler.removeCallbacksAndMessages(null)
        youtubePoller?.shutdown()
        youtubePoller = null
        publishYouTubeStatus(
            YouTubeChatPoller.Status(
                state = YouTubeChatPoller.State.DISABLED,
                summary = "YouTube Live Chat is off"
            )
        )

        overlayView?.let {
            try {
                windowManager.removeView(it)
            } catch (e: Exception) {
                Log.w(TAG, "Error removing overlay view: ${e.message}")
            }
        }
        overlayView = null
        rootPill?.background = null
        glassDrawable?.callback = null
        glassDrawable = null
        DualKawaseGlassDrawable.clearCache()

        rootPill = null
        waveContainer = null
        waveBar1 = null
        waveBar2 = null
        waveBar3 = null
        textAuthor = null
        textSubtitles = null
        controlsContainer = null
        btnSkip = null
        btnBan = null
        btnMute = null

        if (::speechEngine.isInitialized) {
            speechEngine.shutdown()
        }
        Log.i(TAG, "FloatingOverlayService destroyed and cleaned up")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

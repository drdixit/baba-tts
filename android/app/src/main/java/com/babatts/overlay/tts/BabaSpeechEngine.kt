package com.babatts.overlay.tts

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.babatts.overlay.model.ChatMessage
import com.babatts.overlay.model.WordBoundary
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicLong

/**
 * Dual-Engine Speech Controller supporting Azure Neural TTS with real-time Word Boundary highlighting
 * and local Android TextToSpeech offline fallback.
 * Configured with ALLOW_CAPTURE_BY_ALL for Streamlabs Mobile broadcast capture.
 */
class BabaSpeechEngine(
    private val context: Context,
    private val listener: SpeechEventListener
) : TextToSpeech.OnInitListener {

    interface SpeechEventListener {
        fun onSpeechStarted(message: ChatMessage, wordBoundaries: List<WordBoundary>)
        fun onWordHighlighted(message: ChatMessage, activeWordIndex: Int, wordBoundaries: List<WordBoundary>)
        fun onSpeechCompleted(message: ChatMessage)
        fun onQueueEmpty()
        fun onStateChanged(isMuted: Boolean, bannedCount: Int)
    }

    companion object {
        const val TAG = "BabaSpeechEngine"
        const val ENGINE_AZURE = "azure"
        const val ENGINE_SYSTEM = "system"
        const val SYSTEM_LANG_HINGLISH = "hinglish"
        const val SYSTEM_LANG_EN_IN = "en_in"
        const val SYSTEM_LANG_HI_IN = "hi_in"
        const val SYSTEM_LANG_EN_US = "en_us"

        internal val LOCALE_HI_IN: Locale = Locale.forLanguageTag("hi-IN")
        internal val LOCALE_EN_IN: Locale = Locale.forLanguageTag("en-IN")

        private const val PREF_BANNED_AUTHORS = "banned_authors"
        private const val PREF_BANNED_AUTHOR_IDS = "banned_author_ids"
        private val ASCII_WORD_REGEX = Regex("[a-z]+")

        private val STRONG_HINGLISH_KEYWORDS = setOf(
            "kya", "hai", "hain", "nahi", "nhi", "bhai", "bhaiya", "yaar",
            "karo", "kardo", "krdo", "karna", "karke", "kaise", "kaisa", "kaisi",
            "kaun", "kyu", "kyun", "kyon", "kyunki", "matlab", "abey", "acha",
            "accha", "achha", "mast", "badhiya", "badiya", "chalo", "ruko",
            "dekho", "bolo", "batao", "suno", "samjho", "namaste", "dhanyawad",
            "shukriya", "tum", "tumhara", "aap", "aapka", "mera", "meri", "mere",
            "tera", "teri", "tere", "yahan", "wahan", "kahan", "abhi", "lekin",
            "toh", "raha", "rahi", "rahe", "gaya", "gayi", "gaye", "hogaya",
            "hogayi", "khelo", "bakwas", "jhakaas", "bilkul", "bohot", "bahut"
        )

        private val HINGLISH_KEYWORDS = STRONG_HINGLISH_KEYWORDS + setOf(
            "kr", "abe", "arre", "dost", "behen", "sahi", "thoda", "zyada",
            "jyada", "ruk", "dekh", "samajh", "pagal", "dimaag", "maza",
            "mazaa", "paisa", "paise", "khana", "paani", "ghar", "duniya",
            "zindagi", "pyaar", "jai", "wala", "wali", "wale", "waala",
            "waali", "waale", "hamara", "apna", "apni", "apne", "kuch",
            "kuchh", "sab", "sabko", "idhar", "udhar", "kidhar", "kab",
            "kal", "parso", "aaj", "raat", "subah", "shaam", "pehle",
            "baad", "magar", "bhi", "tha", "thi", "diya", "liya", "kiya",
            "hoga", "hogi", "honge", "mila", "milega", "jao", "aao",
            "maro", "maaro", "bachao", "jeeto", "haaro", "khel", "khelte",
            "bhejo", "likho", "padho", "kadak", "scene"
        )

        internal fun isHindiOrHinglishText(text: String): Boolean {
            if (text.any { it in '\u0900'..'\u097F' }) return true
            val words = ASCII_WORD_REGEX.findAll(text.lowercase(Locale.ROOT)).map { it.value }.toList()
            if (words.isEmpty()) return false
            var matches = 0
            for (word in words) {
                if (word in HINGLISH_KEYWORDS) {
                    matches++
                    if (word in STRONG_HINGLISH_KEYWORDS || matches >= 2) {
                        return true
                    }
                }
            }
            return false
        }

        internal fun chooseSystemTtsLocale(
            mode: String,
            utteranceText: String,
            hasHiIn: Boolean,
            hasEnIn: Boolean,
            hasEnUs: Boolean,
            defaultLocale: Locale = Locale.getDefault()
        ): Locale {
            return when (mode) {
                SYSTEM_LANG_HI_IN -> when {
                    hasHiIn -> LOCALE_HI_IN
                    hasEnIn -> LOCALE_EN_IN
                    hasEnUs -> Locale.US
                    else -> defaultLocale
                }
                SYSTEM_LANG_EN_IN -> when {
                    hasEnIn -> LOCALE_EN_IN
                    hasEnUs -> Locale.US
                    else -> defaultLocale
                }
                SYSTEM_LANG_EN_US -> if (hasEnUs) Locale.US else defaultLocale
                else -> {
                    val isHindi = isHindiOrHinglishText(utteranceText)
                    if (isHindi) {
                        when {
                            hasHiIn -> LOCALE_HI_IN
                            hasEnIn -> LOCALE_EN_IN
                            hasEnUs -> Locale.US
                            else -> defaultLocale
                        }
                    } else {
                        when {
                            hasEnIn -> LOCALE_EN_IN
                            hasEnUs -> Locale.US
                            else -> defaultLocale
                        }
                    }
                }
            }
        }

        /**
         * Returns the active word boundary index at [currentPosMs] without overlapping
         * onto the next word's onset.
         */
        internal fun findActiveBoundaryIndex(boundaries: List<WordBoundary>, currentPosMs: Long): Int {
            if (boundaries.isEmpty()) return -1
            return boundaries.indexOfLast { currentPosMs >= it.offsetMs }
        }

        /**
         * Maps a character offset from Android TextToSpeech.onRangeStart (which indexes into
         * the full spoken utterance "${author} says: ${text}") to the corresponding boundary index.
         */
        internal fun findBoundaryIndexForCharOffset(boundaries: List<WordBoundary>, charOffset: Int): Int {
            if (boundaries.isEmpty() || charOffset < 0) return -1
            return boundaries.indexOfLast { charOffset >= it.textOffset }
        }

        /**
         * Builds word boundaries with exact character offsets in [speechText] and proportional
         * fallback timestamps in case the device TTS engine does not emit onRangeStart.
         */
        internal fun buildSystemSpeechBoundaries(speechText: String): List<WordBoundary> {
            val wordCount = Regex("\\S+").findAll(speechText).count().coerceAtLeast(1)
            val estimatedDurationMs = (wordCount * 320L).coerceAtLeast(800L)
            return AzureTtsClient.generateProportionalBoundaries(speechText, estimatedDurationMs)
        }
    }

    @Volatile
    var activeEngine: String = ENGINE_AZURE

    @Volatile
    var systemLanguageMode: String = SYSTEM_LANG_HINGLISH

    @Volatile
    private var hasHiIn: Boolean = false
    @Volatile
    private var hasEnIn: Boolean = false
    @Volatile
    private var hasEnUs: Boolean = false
    private var lastAppliedTtsLocale: Locale? = null

    val azureClient = AzureTtsClient(context)
    private val bgExecutor = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val queueLock = Any()
    private val speechGeneration = AtomicLong(0L)

    private var tts: TextToSpeech? = null

    @Volatile
    private var isSystemTtsInitialized = false
    @Volatile
    private var mediaPlayer: MediaPlayer? = null
    @Volatile
    private var currentAudioFile: File? = null
    @Volatile
    private var hasEmittedSpeechStarted = false

    private val priorityQueue = ConcurrentLinkedDeque<ChatMessage>()
    private val queue = ConcurrentLinkedDeque<ChatMessage>()
    private val bannedAuthors = ConcurrentHashMap.newKeySet<String>()
    private val bannedAuthorIds = ConcurrentHashMap.newKeySet<String>()
    private val prefs = context.applicationContext.getSharedPreferences("baba_overlay_prefs", Context.MODE_PRIVATE)

    @Volatile
    private var isShutDown = false

    @Volatile
    var isMuted: Boolean = false
        private set

    @Volatile
    var currentSpeakingMessage: ChatMessage? = null
        private set

    @Volatile
    var lastSpokenMessage: ChatMessage? = null
        private set

    @Volatile
    private var currentWordBoundaries: List<WordBoundary> = emptyList()
    @Volatile
    private var lastHighlightedIndex = -1

    @Volatile
    private var systemTtsStartElapsedMs = 0L

    @Volatile
    private var systemRangeStartReceived = false

    // High-frequency word tracking runnable for Azure MediaPlayer playback
    private val wordTrackerRunnable = object : Runnable {
        override fun run() {
            val mp = mediaPlayer
            val msg = currentSpeakingMessage
            val boundaries = currentWordBoundaries
            if (mp != null && msg != null && boundaries.isNotEmpty()) {
                val currentPos = try {
                    if (mp.isPlaying) mp.currentPosition.toLong() else -1L
                } catch (_: IllegalStateException) {
                    -1L
                }
                if (currentPos >= 0L) {
                    val activeIndex = findActiveBoundaryIndex(boundaries, currentPos)
                    if (activeIndex != lastHighlightedIndex && activeIndex in boundaries.indices) {
                        lastHighlightedIndex = activeIndex
                        listener.onWordHighlighted(msg, activeIndex, boundaries)
                    }
                }
                if (mediaPlayer === mp) {
                    mainHandler.postDelayed(this, 25)
                }
            }
        }
    }

    // Fallback pacing runnable for System TTS engines that do not emit onRangeStart
    private val systemFallbackTrackerRunnable = object : Runnable {
        override fun run() {
            val msg = currentSpeakingMessage
            val boundaries = currentWordBoundaries
            if (msg != null && !systemRangeStartReceived && boundaries.isNotEmpty()) {
                val elapsedMs = (SystemClock.elapsedRealtime() - systemTtsStartElapsedMs).coerceAtLeast(0L)
                val activeIndex = findActiveBoundaryIndex(boundaries, elapsedMs)
                if (activeIndex != lastHighlightedIndex && activeIndex in boundaries.indices) {
                    lastHighlightedIndex = activeIndex
                    listener.onWordHighlighted(msg, activeIndex, boundaries)
                }
                mainHandler.postDelayed(this, 40)
            }
        }
    }

    init {
        prefs.getStringSet(PREF_BANNED_AUTHORS, null)?.forEach {
            if (it.isNotBlank()) bannedAuthors.add(it.lowercase(Locale.ROOT))
        }
        prefs.getStringSet(PREF_BANNED_AUTHOR_IDS, null)?.forEach {
            if (it.isNotBlank()) bannedAuthorIds.add(it)
        }
        tts = TextToSpeech(context.applicationContext, this)
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.let { engine ->
                hasHiIn = isLocaleSupported(engine, LOCALE_HI_IN)
                hasEnIn = isLocaleSupported(engine, LOCALE_EN_IN)
                hasEnUs = isLocaleSupported(engine, Locale.US)

                val initialLocale = chooseSystemTtsLocale(
                    mode = systemLanguageMode,
                    utteranceText = "",
                    hasHiIn = hasHiIn,
                    hasEnIn = hasEnIn,
                    hasEnUs = hasEnUs
                )
                val result = engine.setLanguage(initialLocale)
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    val fallback = Locale.getDefault()
                    engine.language = fallback
                    lastAppliedTtsLocale = fallback
                } else {
                    lastAppliedTtsLocale = initialLocale
                }

                val audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL)
                    .build()

                engine.setAudioAttributes(audioAttributes)

                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        mainHandler.post {
                            val msg = currentSpeakingMessage ?: return@post
                            if (utteranceId != null && utteranceId != msg.id) return@post
                            systemTtsStartElapsedMs = SystemClock.elapsedRealtime()
                            systemRangeStartReceived = false
                            hasEmittedSpeechStarted = true
                            listener.onSpeechStarted(msg, currentWordBoundaries)
                            mainHandler.removeCallbacks(systemFallbackTrackerRunnable)
                            mainHandler.postDelayed(systemFallbackTrackerRunnable, 40)
                        }
                    }

                    override fun onDone(utteranceId: String?) {
                        mainHandler.post {
                            val msg = currentSpeakingMessage ?: return@post
                            if (utteranceId != null && utteranceId != msg.id) return@post
                            handleSpeechDone()
                        }
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        Log.e(TAG, "System TTS error on utterance: $utteranceId")
                        mainHandler.post {
                            val msg = currentSpeakingMessage ?: return@post
                            if (utteranceId != null && utteranceId != msg.id) return@post
                            handleSpeechDone()
                        }
                    }

                    override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                        mainHandler.post {
                            val msg = currentSpeakingMessage ?: return@post
                            if (utteranceId != null && utteranceId != msg.id) return@post
                            if (!systemRangeStartReceived) {
                                systemRangeStartReceived = true
                                mainHandler.removeCallbacks(systemFallbackTrackerRunnable)
                            }
                            val boundaries = currentWordBoundaries
                            val index = findBoundaryIndexForCharOffset(boundaries, start)
                            if (index >= 0 && index != lastHighlightedIndex) {
                                lastHighlightedIndex = index
                                listener.onWordHighlighted(msg, index, boundaries)
                            }
                        }
                    }
                })

                isSystemTtsInitialized = true
                Log.i(TAG, "System TTS ready as fallback engine")
            }
        }
    }

    fun isAuthorBanned(author: String, authorId: String? = null): Boolean {
        val cleanId = authorId?.trim().orEmpty()
        if (cleanId.isNotEmpty() && bannedAuthorIds.contains(cleanId)) {
            return true
        }
        val cleanName = author.trim().lowercase(Locale.ROOT)
        return cleanName.isNotEmpty() && bannedAuthors.contains(cleanName)
    }

    private fun matchesBan(msg: ChatMessage, author: String, authorId: String?): Boolean {
        val targetId = authorId?.trim().orEmpty()
        if (targetId.isNotEmpty() && msg.authorId == targetId) return true
        val targetName = author.trim()
        return targetName.isNotEmpty() && msg.author.equals(targetName, ignoreCase = true)
    }

    private fun persistBans() {
        prefs.edit()
            .putStringSet(PREF_BANNED_AUTHORS, bannedAuthors.toSet())
            .putStringSet(PREF_BANNED_AUTHOR_IDS, bannedAuthorIds.toSet())
            .apply()
    }

    fun enqueue(message: ChatMessage, isPriority: Boolean = false) {
        if (isShutDown || isAuthorBanned(message.author, message.authorId)) {
            if (!isShutDown) {
                Log.d(TAG, "Ignoring banned author: ${message.author}")
            }
            return
        }

        val notifyQueueEmpty: Boolean
        synchronized(queueLock) {
            if (isShutDown) return
            if (isPriority) {
                priorityQueue.offerLast(message)
            } else {
                queue.offerLast(message)
            }
            notifyQueueEmpty = if (currentSpeakingMessage == null) {
                processNextInQueueLocked()
            } else {
                false
            }
        }
        if (notifyQueueEmpty) {
            listener.onQueueEmpty()
        }
    }

    fun skip() {
        skipInternal(clearPendingQueue = false)
    }

    private fun skipInternal(clearPendingQueue: Boolean) {
        val skipped: ChatMessage?
        val wasStarted: Boolean
        synchronized(queueLock) {
            if (clearPendingQueue) {
                priorityQueue.clear()
                queue.clear()
            }
            speechGeneration.incrementAndGet()
            stopCurrentPlaybackLocked()
            skipped = currentSpeakingMessage
            wasStarted = hasEmittedSpeechStarted
            currentSpeakingMessage = null
            hasEmittedSpeechStarted = false
            lastHighlightedIndex = -1
            currentWordBoundaries = emptyList()
            if (skipped != null && wasStarted) {
                lastSpokenMessage = skipped
            }
        }
        if (skipped != null && wasStarted) {
            mainHandler.post { listener.onSpeechCompleted(skipped) }
        }
        mainHandler.post { processNextInQueue() }
    }

    fun banAuthor(author: String, authorId: String? = null) {
        val cleanName = author.trim()
        if (cleanName.isNotEmpty()) {
            bannedAuthors.add(cleanName.lowercase(Locale.ROOT))
        }
        val cleanId = authorId?.trim().orEmpty()
        if (cleanId.isNotEmpty()) {
            bannedAuthorIds.add(cleanId)
        }
        persistBans()

        var skippedCurrent: ChatMessage? = null
        var skippedWasStarted = false
        synchronized(queueLock) {
            val pendingPriority = priorityQueue.toList()
            priorityQueue.clear()
            for (msg in pendingPriority) {
                if (!matchesBan(msg, cleanName, cleanId.ifEmpty { null })) {
                    priorityQueue.offerLast(msg)
                }
            }

            val pending = queue.toList()
            queue.clear()
            for (msg in pending) {
                if (!matchesBan(msg, cleanName, cleanId.ifEmpty { null })) {
                    queue.offerLast(msg)
                }
            }

            val current = currentSpeakingMessage
            if (current != null && matchesBan(current, cleanName, cleanId.ifEmpty { null })) {
                speechGeneration.incrementAndGet()
                stopCurrentPlaybackLocked()
                skippedCurrent = current
                skippedWasStarted = hasEmittedSpeechStarted
                currentSpeakingMessage = null
                hasEmittedSpeechStarted = false
                lastHighlightedIndex = -1
                currentWordBoundaries = emptyList()
                if (skippedWasStarted) {
                    lastSpokenMessage = current
                }
            }
        }

        if (skippedCurrent != null) {
            if (skippedWasStarted) {
                val doneMsg = skippedCurrent
                mainHandler.post { listener.onSpeechCompleted(doneMsg!!) }
            }
            mainHandler.post { processNextInQueue() }
        }

        val totalBanned = (bannedAuthors + bannedAuthorIds).size
        listener.onStateChanged(isMuted, totalBanned)
    }

    fun toggleMute(): Boolean {
        var stopped: ChatMessage? = null
        var wasStarted = false
        val newMuted: Boolean
        synchronized(queueLock) {
            isMuted = !isMuted
            newMuted = isMuted
            if (newMuted) {
                speechGeneration.incrementAndGet()
                stopCurrentPlaybackLocked()
                stopped = currentSpeakingMessage
                wasStarted = hasEmittedSpeechStarted
                currentSpeakingMessage = null
                hasEmittedSpeechStarted = false
                lastHighlightedIndex = -1
                currentWordBoundaries = emptyList()
                if (stopped != null && wasStarted) {
                    lastSpokenMessage = stopped
                }
            }
        }
        if (stopped != null && wasStarted) {
            mainHandler.post { listener.onSpeechCompleted(stopped!!) }
        }
        if (newMuted) {
            mainHandler.post { listener.onQueueEmpty() }
        } else {
            mainHandler.post { processNextInQueue() }
        }
        listener.onStateChanged(newMuted, (bannedAuthors + bannedAuthorIds).size)
        return newMuted
    }

    fun clearQueue() {
        skipInternal(clearPendingQueue = true)
    }

    private fun stopCurrentPlaybackLocked() {
        mainHandler.removeCallbacks(wordTrackerRunnable)
        mainHandler.removeCallbacks(systemFallbackTrackerRunnable)
        try {
            mediaPlayer?.setOnCompletionListener(null)
            mediaPlayer?.setOnErrorListener(null)
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping media player: ${e.message}")
        }
        mediaPlayer = null
        currentAudioFile?.delete()
        currentAudioFile = null
        tts?.stop()
    }

    private fun handleSpeechDone() {
        val finished: ChatMessage?
        val wasStarted: Boolean
        synchronized(queueLock) {
            mainHandler.removeCallbacks(wordTrackerRunnable)
            mainHandler.removeCallbacks(systemFallbackTrackerRunnable)
            currentAudioFile?.delete()
            currentAudioFile = null
            finished = currentSpeakingMessage
            wasStarted = hasEmittedSpeechStarted
            if (finished != null && wasStarted) {
                lastSpokenMessage = finished
            }
            currentSpeakingMessage = null
            hasEmittedSpeechStarted = false
            lastHighlightedIndex = -1
            currentWordBoundaries = emptyList()
        }

        if (finished != null && wasStarted) {
            mainHandler.post { listener.onSpeechCompleted(finished) }
        }
        mainHandler.post { processNextInQueue() }
    }

    private fun processNextInQueue() {
        val notifyQueueEmpty = synchronized(queueLock) {
            processNextInQueueLocked()
        }
        if (notifyQueueEmpty) {
            listener.onQueueEmpty()
        }
    }

    private fun processNextInQueueLocked(): Boolean {
        if (isShutDown || currentSpeakingMessage != null) {
            return false
        }
        if (isMuted) {
            return priorityQueue.isEmpty() && queue.isEmpty()
        }

        var next = priorityQueue.poll() ?: queue.poll()
        while (next != null && isAuthorBanned(next.author, next.authorId)) {
            next = priorityQueue.poll() ?: queue.poll()
        }
        if (next == null) {
            return true
        }

        val generation = speechGeneration.incrementAndGet()
        currentSpeakingMessage = next
        hasEmittedSpeechStarted = false
        lastHighlightedIndex = -1

        if (activeEngine == ENGINE_AZURE && azureClient.key.isNotBlank()) {
            synthesizeAndPlayAzure(next, generation)
        } else {
            speakViaSystemTts(next, generation)
        }
        return false
    }

    private fun synthesizeAndPlayAzure(message: ChatMessage, generation: Long) {
        if (isShutDown) return
        try {
            bgExecutor.execute {
                if (isShutDown || speechGeneration.get() != generation || isMuted) return@execute

                val speechText = "${message.author} says: ${message.text}"
                val result = azureClient.synthesize(speechText)

                if (result != null && result.audioFile.exists()) {
                    if (isShutDown || speechGeneration.get() != generation || isMuted) {
                        result.audioFile.delete()
                        return@execute
                    }
                    mainHandler.post {
                        playAudioFileWithBoundaries(message, result.audioFile, result.wordBoundaries, generation)
                    }
                } else {
                    Log.w(TAG, "Azure synthesis failed, falling back to System TTS")
                    mainHandler.post {
                        speakViaSystemTts(message, generation)
                    }
                }
            }
        } catch (e: RejectedExecutionException) {
            Log.d(TAG, "Ignoring Azure synth after engine shutdown: ${e.message}")
        }
    }

    private fun playAudioFileWithBoundaries(
        message: ChatMessage,
        file: File,
        boundaries: List<WordBoundary>,
        generation: Long
    ) {
        synchronized(queueLock) {
            if (speechGeneration.get() != generation || currentSpeakingMessage?.id != message.id || isMuted) {
                file.delete()
                return
            }
        }

        var localPlayer: MediaPlayer? = null
        try {
            synchronized(queueLock) {
                stopCurrentPlaybackLocked()
                currentAudioFile = file
                currentWordBoundaries = boundaries
                lastHighlightedIndex = -1
            }

            val mp = MediaPlayer()
            localPlayer = mp
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL)
                .build()

            mp.setAudioAttributes(audioAttributes)
            mp.setDataSource(file.absolutePath)
            mp.prepare()

            mp.setOnCompletionListener {
                if (speechGeneration.get() == generation && currentSpeakingMessage?.id == message.id) {
                    handleSpeechDone()
                } else {
                    file.delete()
                }
            }

            mp.setOnErrorListener { _, what, extra ->
                Log.e(TAG, "MediaPlayer error: $what, extra: $extra")
                if (speechGeneration.get() == generation && currentSpeakingMessage?.id == message.id) {
                    handleSpeechDone()
                } else {
                    file.delete()
                }
                true
            }

            synchronized(queueLock) {
                if (speechGeneration.get() != generation || currentSpeakingMessage?.id != message.id || isMuted) {
                    mp.setOnCompletionListener(null)
                    mp.setOnErrorListener(null)
                    mp.release()
                    file.delete()
                    currentAudioFile = null
                    return
                }
                mediaPlayer = mp
                hasEmittedSpeechStarted = true
            }

            mp.start()
            listener.onSpeechStarted(message, boundaries)
            mainHandler.post(wordTrackerRunnable)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to play Azure audio: ${e.message}")
            try {
                localPlayer?.setOnCompletionListener(null)
                localPlayer?.setOnErrorListener(null)
                localPlayer?.release()
            } catch (_: Exception) {
            }
            synchronized(queueLock) {
                mediaPlayer = null
                currentAudioFile = null
            }
            file.delete()
            speakViaSystemTts(message, generation)
        }
    }

    private fun speakViaSystemTts(message: ChatMessage, generation: Long) {
        val result: Int
        synchronized(queueLock) {
            if (isShutDown || speechGeneration.get() != generation || currentSpeakingMessage?.id != message.id) {
                return
            }
            if (!isSystemTtsInitialized || isMuted) {
                // Unlock before calling handleSpeechDone()
                result = -999
            } else {
                val speechText = "${message.author} says: ${message.text}"
                currentWordBoundaries = buildSystemSpeechBoundaries(speechText)
                lastHighlightedIndex = -1

                tts?.let { engine ->
                    val targetLocale = chooseSystemTtsLocale(
                        mode = systemLanguageMode,
                        utteranceText = message.text,
                        hasHiIn = hasHiIn,
                        hasEnIn = hasEnIn,
                        hasEnUs = hasEnUs
                    )
                    if (targetLocale != lastAppliedTtsLocale) {
                        val langRes = engine.setLanguage(targetLocale)
                        if (langRes != TextToSpeech.LANG_MISSING_DATA &&
                            langRes != TextToSpeech.LANG_NOT_SUPPORTED
                        ) {
                            lastAppliedTtsLocale = targetLocale
                        }
                    }
                }

                val params = Bundle().apply {
                    putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
                }

                result = tts?.speak(
                    speechText,
                    TextToSpeech.QUEUE_FLUSH,
                    params,
                    message.id
                ) ?: TextToSpeech.ERROR
            }
        }

        if (result == -999) {
            handleSpeechDone()
            return
        }

        if (result != TextToSpeech.SUCCESS) {
            Log.e(TAG, "Failed to speak via System TTS")
            handleSpeechDone()
        }
    }

    private fun isLocaleSupported(engine: TextToSpeech, locale: Locale): Boolean {
        return try {
            val availability = engine.isLanguageAvailable(locale)
            availability != TextToSpeech.LANG_MISSING_DATA &&
                availability != TextToSpeech.LANG_NOT_SUPPORTED
        } catch (_: Exception) {
            false
        }
    }

    fun shutdown() {
        isShutDown = true
        mainHandler.removeCallbacksAndMessages(null)
        synchronized(queueLock) {
            speechGeneration.incrementAndGet()
            stopCurrentPlaybackLocked()
            currentSpeakingMessage = null
            hasEmittedSpeechStarted = false
            priorityQueue.clear()
            queue.clear()
        }
        try {
            tts?.shutdown()
        } catch (e: Exception) {
            Log.w(TAG, "Error shutting down TTS: ${e.message}")
        }
        tts = null
        bgExecutor.shutdownNow()
    }
}

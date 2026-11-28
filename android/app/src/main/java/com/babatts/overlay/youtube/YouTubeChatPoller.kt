package com.babatts.overlay.youtube

import android.util.Log
import com.babatts.overlay.model.ChatMessage
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Background YouTube Live Chat poller using YouTube's public live chat InnerTube endpoint
 * (no OAuth or YouTube Data API key required), mirroring `src/youtube.rs`.
 */
class YouTubeChatPoller(
    private val listener: Listener,
    private val youtubeBaseUrl: String = "https://www.youtube.com"
) {

    interface Listener {
        fun onMessageReceived(message: ChatMessage, isPriority: Boolean)
        fun onStatusChanged(status: Status)
        fun isAuthorBanned(authorName: String, authorId: String?): Boolean
    }

    data class Status(
        val state: State,
        val summary: String,
        val videoId: String? = null,
        val resolvedChannelId: String? = null,
        val channelInput: String? = null
    )

    enum class State {
        DISABLED,
        CONNECTING,
        CONNECTED,
        OFFLINE,
        ERROR
    }

    data class Config(
        val enabled: Boolean,
        val channelId: String,
        val chatMode: String
    )

    sealed class ChannelLookupResult {
        data class Success(val channelId: String) : ChannelLookupResult()
        data class NotFound(val message: String) : ChannelLookupResult()
        data class NetworkError(val message: String) : ChannelLookupResult()
    }

    companion object {
        private const val TAG = "YouTubeChatPoller"
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        internal fun rewriteUrlForBase(url: String, youtubeBaseUrl: String): String {
            return if (youtubeBaseUrl != "https://www.youtube.com" && url.startsWith("https://www.youtube.com")) {
                youtubeBaseUrl.trimEnd('/') + url.removePrefix("https://www.youtube.com")
            } else {
                url
            }
        }

        fun lookupChannelId(
            client: OkHttpClient,
            youtubeBaseUrl: String,
            input: String,
            onCallCreated: ((Call) -> Unit)? = null,
            onCallFinished: ((Call) -> Unit)? = null,
            isCancelled: (() -> Boolean)? = null
        ): ChannelLookupResult {
            val rawInput = input.trim()
            if (rawInput.isEmpty() || YouTubeMessageParser.looksLikeUrlInput(rawInput)) {
                return ChannelLookupResult.NotFound("Invalid YouTube username or Channel ID")
            }
            if (YouTubeMessageParser.isCanonicalChannelId(rawInput)) {
                return ChannelLookupResult.Success(rawInput)
            }

            val lookupUrls = YouTubeMessageParser.buildChannelLookupUrls(rawInput)
            if (lookupUrls.isEmpty()) {
                return ChannelLookupResult.NotFound("Invalid YouTube username or Channel ID")
            }

            for (url in lookupUrls) {
                if (isCancelled?.invoke() == true) {
                    return ChannelLookupResult.NetworkError("Lookup cancelled")
                }
                val req = Request.Builder()
                    .url(rewriteUrlForBase(url, youtubeBaseUrl))
                    .header("User-Agent", USER_AGENT)
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .get()
                    .build()
                val call = client.newCall(req)
                onCallCreated?.invoke(call)
                try {
                    call.execute().use { resp ->
                        if (resp.code == 404 || resp.code == 410) {
                            return@use
                        }
                        if (!resp.isSuccessful) {
                            return ChannelLookupResult.NetworkError("HTTP ${resp.code}")
                        }
                        val html = resp.body?.string().orEmpty()
                        if (isCancelled?.invoke() == true) {
                            return ChannelLookupResult.NetworkError("Lookup cancelled")
                        }
                        val extracted = YouTubeMessageParser.extractChannelIdFromHtml(html)
                        if (extracted != null) {
                            return ChannelLookupResult.Success(extracted)
                        }
                    }
                } catch (e: IOException) {
                    return ChannelLookupResult.NetworkError(e.message ?: "Network error")
                } finally {
                    onCallFinished?.invoke(call)
                }
            }
            return ChannelLookupResult.NotFound("Channel not found for \"$rawInput\" — check username")
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private class NonRetryableHttpException(val code: Int) : IllegalStateException("HTTP $code")
    private class ChannelNotFoundException(message: String) : IllegalStateException(message)

    private val lifecycleLock = Any()
    private val statusLock = Any()
    private val sleepMonitor = Object()
    private val running = AtomicBoolean(false)
    private val configVersion = AtomicLong(0L)
    private val workerGeneration = AtomicLong(0L)
    private val currentConfig = AtomicReference(
        Config(enabled = false, channelId = "", chatMode = YouTubeMessageParser.CHAT_MODE_LIVE)
    )
    private val activeCall = AtomicReference<Call?>(null)
    private val resolvedCache = AtomicReference<Pair<String, String>?>(null)

    private val seenCache = YouTubeMessageParser.SeenMessageCache()
    private val spamFilter = YouTubeMessageParser.SpamFilter()
    private val activeWatermarkUsec = AtomicLong(0L)
    @Volatile
    private var activeVideoId: String? = null
    @Volatile
    private var workerThread: Thread? = null

    fun configure(enabled: Boolean, channelId: String, chatMode: String) {
        val normalizedMode = if (chatMode.equals(YouTubeMessageParser.CHAT_MODE_TOP, ignoreCase = true)) {
            YouTubeMessageParser.CHAT_MODE_TOP
        } else {
            YouTubeMessageParser.CHAT_MODE_LIVE
        }
        val next = Config(
            enabled = enabled,
            channelId = channelId.trim(),
            chatMode = normalizedMode
        )

        if (!next.enabled) {
            synchronized(lifecycleLock) {
                if (currentConfig.getAndSet(next) != next) {
                    configVersion.incrementAndGet()
                }
            }
            stop()
            emitGlobalStatus(State.DISABLED, "YouTube Live Chat is off")
            return
        }

        if (next.channelId.isEmpty()) {
            synchronized(lifecycleLock) {
                currentConfig.set(next)
                configVersion.incrementAndGet()
            }
            stop()
            emitGlobalStatus(State.ERROR, "Enter a YouTube username, @handle, or Channel ID")
            return
        }

        if (YouTubeMessageParser.looksLikeUrlInput(next.channelId)) {
            synchronized(lifecycleLock) {
                currentConfig.set(next)
                configVersion.incrementAndGet()
            }
            stop()
            emitGlobalStatus(
                State.ERROR,
                "Enter a username, @handle, or Channel ID (not a URL)",
                channelInput = next.channelId
            )
            return
        }

        val configChanged: Boolean
        synchronized(lifecycleLock) {
            val prev = currentConfig.getAndSet(next)
            configChanged = prev != next
            if (configChanged) {
                configVersion.incrementAndGet()
                activeCall.getAndSet(null)?.cancel()
                if (prev.channelId != next.channelId) {
                    resolvedCache.set(null)
                }
            }
            if (running.compareAndSet(false, true) || workerThread == null || workerThread?.isAlive != true) {
                running.set(true)
                val gen = workerGeneration.incrementAndGet()
                startWorkerLocked(gen)
            }
        }
        if (configChanged) {
            synchronized(sleepMonitor) {
                sleepMonitor.notifyAll()
            }
        }
    }

    fun stop() {
        val prevThread: Thread?
        synchronized(lifecycleLock) {
            running.set(false)
            configVersion.incrementAndGet()
            workerGeneration.incrementAndGet()
            activeCall.getAndSet(null)?.cancel()
            client.dispatcher.cancelAll()
            prevThread = workerThread
            workerThread = null
            activeVideoId = null
            activeWatermarkUsec.set(0L)
            resolvedCache.set(null)
            seenCache.clear()
            spamFilter.clear()
        }
        synchronized(sleepMonitor) {
            sleepMonitor.notifyAll()
        }
        // Barrier: ensure any in-flight emitSessionStatus finishes before returning
        synchronized(statusLock) {
        }
        if (prevThread != null && prevThread !== Thread.currentThread()) {
            try {
                prevThread.join(350)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }

    fun shutdown() {
        stop()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    private fun startWorkerLocked(workerGen: Long) {
        val thread = Thread({
            runLoop(workerGen)
        }, "BabaYouTubePoller-$workerGen")
        thread.isDaemon = true
        workerThread = thread
        thread.start()
    }

    private fun isSessionActive(expectedVersion: Long, expectedWorkerGen: Long): Boolean {
        return running.get() &&
            workerGeneration.get() == expectedWorkerGen &&
            configVersion.get() == expectedVersion
    }

    private fun getCachedChannelIdFor(channelInput: String): String? {
        if (YouTubeMessageParser.isCanonicalChannelId(channelInput)) return channelInput
        val pair = resolvedCache.get() ?: return null
        return pair.second.takeIf { pair.first == channelInput }
    }

    private fun emitGlobalStatus(
        state: State,
        summary: String,
        videoId: String? = null,
        resolvedChannelId: String? = null,
        channelInput: String? = null
    ) {
        synchronized(statusLock) {
            listener.onStatusChanged(
                Status(
                    state = state,
                    summary = summary,
                    videoId = videoId,
                    resolvedChannelId = resolvedChannelId,
                    channelInput = channelInput
                )
            )
        }
    }

    private fun emitSessionStatus(
        expectedVersion: Long,
        expectedWorkerGen: Long,
        state: State,
        summary: String,
        videoId: String? = null,
        resolvedChannelId: String? = null,
        channelInput: String? = null
    ) {
        synchronized(statusLock) {
            if (!isSessionActive(expectedVersion, expectedWorkerGen)) return
            listener.onStatusChanged(
                Status(
                    state = state,
                    summary = summary,
                    videoId = videoId,
                    resolvedChannelId = resolvedChannelId,
                    channelInput = channelInput
                )
            )
        }
    }

    private fun sleepInterruptibly(ms: Long, expectedVersion: Long, expectedWorkerGen: Long): Boolean {
        if (ms <= 0L) return isSessionActive(expectedVersion, expectedWorkerGen)
        val deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(ms)
        synchronized(sleepMonitor) {
            while (isSessionActive(expectedVersion, expectedWorkerGen)) {
                val remainingNs = deadlineNs - System.nanoTime()
                if (remainingNs <= 0L) break
                val waitMs = (remainingNs / 1_000_000L).coerceAtLeast(1L)
                try {
                    sleepMonitor.wait(waitMs)
                } catch (_: InterruptedException) {
                    return false
                }
            }
        }
        return isSessionActive(expectedVersion, expectedWorkerGen)
    }

    private fun runLoop(workerGen: Long) {
        var offlineAttempts = 0
        try {
            while (running.get() && workerGeneration.get() == workerGen) {
                Thread.interrupted()
                val (cfg, ver) = synchronized(lifecycleLock) {
                    currentConfig.get() to configVersion.get()
                }
                if (!cfg.enabled) {
                    if (workerGeneration.get() == workerGen) {
                        emitGlobalStatus(State.DISABLED, "YouTube Live Chat is off")
                    }
                    break
                }

                val initialResolved = getCachedChannelIdFor(cfg.channelId)
                emitSessionStatus(
                    ver,
                    workerGen,
                    State.CONNECTING,
                    if (initialResolved != null) {
                        "Checking active YouTube stream…"
                    } else {
                        "Fetching channel ID for ${cfg.channelId}…"
                    },
                    resolvedChannelId = initialResolved,
                    channelInput = cfg.channelId
                )

                val delaySec = try {
                    pollStreamSession(cfg, ver, workerGen)
                    offlineAttempts = 0
                    val chId = getCachedChannelIdFor(cfg.channelId)
                    emitSessionStatus(
                        ver,
                        workerGen,
                        State.OFFLINE,
                        "Stream ended — rechecking in 30s",
                        resolvedChannelId = chId,
                        channelInput = cfg.channelId
                    )
                    30L
                } catch (e: ChannelNotFoundException) {
                    emitSessionStatus(
                        ver,
                        workerGen,
                        State.ERROR,
                        e.message ?: "Channel not found — check username",
                        channelInput = cfg.channelId
                    )
                    break
                } catch (e: NonRetryableHttpException) {
                    if (e.code == 404 || e.code == 410) {
                        if (isSessionActive(ver, workerGen)) {
                            val currentCached = resolvedCache.get()
                            if (currentCached?.first == cfg.channelId) {
                                resolvedCache.compareAndSet(currentCached, null)
                            }
                        }
                        emitSessionStatus(
                            ver,
                            workerGen,
                            State.ERROR,
                            "Channel not found — check Channel ID (HTTP ${e.code})",
                            channelInput = cfg.channelId
                        )
                    } else {
                        emitSessionStatus(
                            ver,
                            workerGen,
                            State.ERROR,
                            "YouTube rejected request (HTTP ${e.code})",
                            resolvedChannelId = getCachedChannelIdFor(cfg.channelId),
                            channelInput = cfg.channelId
                        )
                    }
                    break
                } catch (e: IOException) {
                    if (!isSessionActive(ver, workerGen)) continue
                    offlineAttempts++
                    val backoff = when (offlineAttempts) {
                        1 -> 15L
                        2 -> 30L
                        else -> 60L
                    }
                    val msg = e.message ?: "Network error"
                    Log.w(TAG, "YouTube network error ($msg); retrying in ${backoff}s")
                    emitSessionStatus(
                        ver,
                        workerGen,
                        State.OFFLINE,
                        "$msg · retry in ${backoff}s",
                        resolvedChannelId = getCachedChannelIdFor(cfg.channelId),
                        channelInput = cfg.channelId
                    )
                    backoff
                } catch (e: Exception) {
                    if (!isSessionActive(ver, workerGen)) continue
                    offlineAttempts++
                    val backoff = when (offlineAttempts) {
                        1 -> 15L
                        2 -> 30L
                        else -> 60L
                    }
                    val msg = e.message ?: "Unable to connect"
                    Log.w(TAG, "YouTube polling error ($msg); retrying in ${backoff}s")
                    emitSessionStatus(
                        ver,
                        workerGen,
                        State.OFFLINE,
                        "$msg · retry in ${backoff}s",
                        resolvedChannelId = getCachedChannelIdFor(cfg.channelId),
                        channelInput = cfg.channelId
                    )
                    backoff
                }

                if (isSessionActive(ver, workerGen)) {
                    sleepInterruptibly(delaySec * 1000L, ver, workerGen)
                }
            }
        } finally {
            synchronized(lifecycleLock) {
                if (workerGeneration.get() == workerGen) {
                    running.set(false)
                    if (workerThread === Thread.currentThread()) {
                        workerThread = null
                    }
                }
            }
        }
    }

    private fun fetchText(url: String): String {
        val req = Request.Builder()
            .url(rewriteUrlForBase(url, youtubeBaseUrl))
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .get()
            .build()
        val call = client.newCall(req)
        activeCall.set(call)
        try {
            call.execute().use { resp ->
                if (!resp.isSuccessful) {
                    if (resp.code in listOf(400, 401, 403, 404, 410)) {
                        throw NonRetryableHttpException(resp.code)
                    }
                    throw IllegalStateException("HTTP ${resp.code}")
                }
                return resp.body?.string().orEmpty()
            }
        } finally {
            activeCall.compareAndSet(call, null)
        }
    }

    private fun postJson(url: String, body: JSONObject): JSONObject {
        val req = Request.Builder()
            .url(rewriteUrlForBase(url, youtubeBaseUrl))
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val call = client.newCall(req)
        activeCall.set(call)
        try {
            call.execute().use { resp ->
                if (!resp.isSuccessful) {
                    if (resp.code in listOf(400, 401, 403, 404, 410)) {
                        throw NonRetryableHttpException(resp.code)
                    }
                    throw IllegalStateException("HTTP ${resp.code}")
                }
                val raw = resp.body?.string().orEmpty()
                return if (raw.isNotEmpty()) JSONObject(raw) else JSONObject()
            }
        } finally {
            activeCall.compareAndSet(call, null)
        }
    }

    private fun resolveChannelId(cfg: Config, expectedVersion: Long, expectedWorkerGen: Long): String {
        val rawInput = cfg.channelId.trim()
        getCachedChannelIdFor(rawInput)?.let { cached ->
            resolvedCache.compareAndSet(null, rawInput to cached)
            return cached
        }

        val result = lookupChannelId(
            client = client,
            youtubeBaseUrl = youtubeBaseUrl,
            input = rawInput,
            onCallCreated = { call -> activeCall.set(call) },
            onCallFinished = { call -> activeCall.compareAndSet(call, null) },
            isCancelled = { !isSessionActive(expectedVersion, expectedWorkerGen) }
        )

        if (!isSessionActive(expectedVersion, expectedWorkerGen)) {
            throw InterruptedException()
        }

        return when (result) {
            is ChannelLookupResult.Success -> {
                if (isSessionActive(expectedVersion, expectedWorkerGen)) {
                    resolvedCache.set(rawInput to result.channelId)
                }
                result.channelId
            }
            is ChannelLookupResult.NotFound -> throw ChannelNotFoundException(result.message)
            is ChannelLookupResult.NetworkError -> throw IOException(result.message)
        }
    }

    private fun resolveVideoId(
        channelId: String,
        expectedVersion: Long,
        expectedWorkerGen: Long
    ): Pair<String, String> {
        if (!isSessionActive(expectedVersion, expectedWorkerGen)) {
            throw InterruptedException()
        }
        val channelUrl = YouTubeMessageParser.buildCanonicalChannelLiveUrl(channelId)
        val html = fetchText(channelUrl)
        val vid = YouTubeMessageParser.extractVideoIdFromHtml(html)
            ?: throw IllegalStateException("Channel is not live right now")
        return vid to html
    }

    private fun pollStreamSession(cfg: Config, expectedVersion: Long, expectedWorkerGen: Long) {
        val resolvedChannelId = resolveChannelId(cfg, expectedVersion, expectedWorkerGen)
        if (!isSessionActive(expectedVersion, expectedWorkerGen)) return

        emitSessionStatus(
            expectedVersion,
            expectedWorkerGen,
            State.CONNECTING,
            "Channel $resolvedChannelId · checking live stream…",
            resolvedChannelId = resolvedChannelId,
            channelInput = cfg.channelId
        )

        val (videoId, channelHtml) = resolveVideoId(resolvedChannelId, expectedVersion, expectedWorkerGen)
        if (!isSessionActive(expectedVersion, expectedWorkerGen)) return

        if (activeVideoId != videoId) {
            activeVideoId = videoId
            activeWatermarkUsec.set(0L)
            seenCache.clear()
            spamFilter.clear()
        }

        val chatHtml = fetchText("$youtubeBaseUrl/live_chat?v=$videoId")
        if (!isSessionActive(expectedVersion, expectedWorkerGen)) return

        val apiKey = YouTubeMessageParser.extractInnertubeApiKey(chatHtml)
            ?: YouTubeMessageParser.extractInnertubeApiKey(channelHtml)
            ?: throw IllegalStateException("YouTube chat API key missing")

        val initialData = YouTubeMessageParser.extractYtInitialData(chatHtml)
            ?: YouTubeMessageParser.extractYtInitialData(channelHtml)

        var continuation = YouTubeMessageParser.extractContinuationToken(
            initialData,
            cfg.chatMode,
            chatHtml
        ) ?: YouTubeMessageParser.extractContinuationToken(
            null,
            cfg.chatMode,
            channelHtml
        ) ?: throw IllegalStateException("Live chat unavailable for $videoId")

        val modeLabel = if (cfg.chatMode == YouTubeMessageParser.CHAT_MODE_TOP) "Top Chat" else "Live Chat"
        var deliveredCount = 0
        emitSessionStatus(
            expectedVersion,
            expectedWorkerGen,
            State.CONNECTED,
            "Connected ($videoId • $modeLabel)",
            videoId = videoId,
            resolvedChannelId = resolvedChannelId,
            channelInput = cfg.channelId
        )

        var missingTokenRetries = 0
        var consecutivePollErrors = 0
        var isInitialPoll = true

        while (isSessionActive(expectedVersion, expectedWorkerGen)) {
            val endpoint = "$youtubeBaseUrl/youtubei/v1/live_chat/get_live_chat?key=$apiKey"
            val payload = JSONObject().apply {
                put(
                    "context",
                    JSONObject().put(
                        "client",
                        JSONObject()
                            .put("clientName", "WEB")
                            .put("clientVersion", "2.20240101.00.00")
                    )
                )
                put("continuation", continuation)
            }

            val json = try {
                val res = postJson(endpoint, payload)
                consecutivePollErrors = 0
                res
            } catch (e: NonRetryableHttpException) {
                throw e
            } catch (e: Exception) {
                if (!isSessionActive(expectedVersion, expectedWorkerGen)) return
                consecutivePollErrors++
                Log.w(TAG, "YouTube poll request failed ($consecutivePollErrors/3): ${e.message}")
                if (consecutivePollErrors >= 3) {
                    throw e
                }
                if (!sleepInterruptibly(5000L, expectedVersion, expectedWorkerGen)) break
                continue
            }

            if (!isSessionActive(expectedVersion, expectedWorkerGen)) return

            val liveChatContinuation = json
                .optJSONObject("continuationContents")
                ?.optJSONObject("liveChatContinuation")

            val actions = liveChatContinuation?.optJSONArray("actions")
            if (actions != null) {
                val currentWatermark = activeWatermarkUsec.get()
                val isColdStart = isInitialPoll && currentWatermark == 0L

                if (isColdStart) {
                    var maxBatchTime = 0L
                    for (i in 0 until actions.length()) {
                        val act = actions.optJSONObject(i) ?: continue
                        val item = act.optJSONObject("addChatItemAction")?.optJSONObject("item") ?: continue
                        val renderer = item.optJSONObject("liveChatTextMessageRenderer")
                            ?: item.optJSONObject("liveChatPaidMessageRenderer")
                            ?: continue
                        val ts = YouTubeMessageParser.parseTimestampUsec(renderer)
                        if (ts > maxBatchTime) maxBatchTime = ts
                    }
                    val fallbackNowUsec = System.currentTimeMillis() * 1000L
                    val initialWatermark = if (maxBatchTime > 0L) maxBatchTime else fallbackNowUsec
                    activeWatermarkUsec.set(initialWatermark)
                }

                val watermark = activeWatermarkUsec.get()
                for (i in 0 until actions.length()) {
                    if (!isSessionActive(expectedVersion, expectedWorkerGen)) return
                    val act = actions.optJSONObject(i) ?: continue
                    val parsed = YouTubeMessageParser.parseChatAction(act) ?: continue

                    if (!seenCache.insert(parsed.msgId)) continue
                    if (listener.isAuthorBanned(parsed.authorName, parsed.authorId)) continue
                    if (!parsed.isSuperchat) {
                        val userKey = parsed.authorId ?: parsed.authorName
                        if (spamFilter.isSpam(userKey, parsed.text)) continue
                    }

                    val classification = YouTubeMessageParser.classifyMessage(
                        timestampUsec = parsed.timestampUsec,
                        isSuperchat = parsed.isSuperchat,
                        isInitialPoll = isInitialPoll,
                        isColdStart = isColdStart,
                        watermarkUsec = watermark
                    )

                    if (parsed.timestampUsec > watermark) {
                        var prev = activeWatermarkUsec.get()
                        while (parsed.timestampUsec > prev &&
                            !activeWatermarkUsec.compareAndSet(prev, parsed.timestampUsec)
                        ) {
                            prev = activeWatermarkUsec.get()
                        }
                    }

                    if (classification == YouTubeMessageParser.Classification.QUEUED) {
                        if (!isSessionActive(expectedVersion, expectedWorkerGen)) return
                        val msgId = parsed.msgId.ifEmpty { "yt-${UUID.randomUUID()}" }
                        val chatMsg = ChatMessage(
                            id = msgId,
                            author = parsed.authorName,
                            platform = "YouTube",
                            text = parsed.text,
                            authorId = parsed.authorId
                        )
                        listener.onMessageReceived(chatMsg, parsed.isSuperchat)
                        deliveredCount++
                        emitSessionStatus(
                            expectedVersion,
                            expectedWorkerGen,
                            State.CONNECTED,
                            "Live ($videoId • $modeLabel • $deliveredCount spoken)",
                            videoId = videoId,
                            resolvedChannelId = resolvedChannelId,
                            channelInput = cfg.channelId
                        )
                    }
                }
                isInitialPoll = false
            } else if (isInitialPoll) {
                activeWatermarkUsec.compareAndSet(0L, System.currentTimeMillis() * 1000L)
                isInitialPoll = false
            }

            val nextContObj = liveChatContinuation?.optJSONArray("continuations")?.optJSONObject(0)
            val nextNode = nextContObj?.optJSONObject("invalidationContinuationData")
                ?: nextContObj?.optJSONObject("timedContinuationData")

            if (nextNode != null) {
                val nextToken = if (nextNode.isNull("continuation")) "" else nextNode.optString("continuation", "")
                if (nextToken.isNotEmpty()) {
                    continuation = nextToken
                    missingTokenRetries = 0
                } else if (missingTokenRetries < 3) {
                    missingTokenRetries++
                    if (!sleepInterruptibly(3000L, expectedVersion, expectedWorkerGen)) break
                    continue
                } else {
                    break
                }

                val timeoutMs = nextNode.optLong("timeoutMs", 3000L).coerceIn(1000L, 5000L)
                if (!sleepInterruptibly(timeoutMs, expectedVersion, expectedWorkerGen)) break
            } else if (missingTokenRetries < 3) {
                missingTokenRetries++
                if (!sleepInterruptibly(3000L, expectedVersion, expectedWorkerGen)) break
                continue
            } else {
                break
            }
        }
    }
}

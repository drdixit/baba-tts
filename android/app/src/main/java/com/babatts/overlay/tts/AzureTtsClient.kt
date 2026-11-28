package com.babatts.overlay.tts

import android.content.Context
import android.media.MediaMetadataRetriever
import android.util.Log
import com.babatts.overlay.model.WordBoundary
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class AzureSynthesisResult(
    val audioFile: File,
    val wordBoundaries: List<WordBoundary>
)

/**
 * Azure Speech TTS Client supporting real-time Word Boundary event extraction
 * via the Azure Cognitive Services WebSocket & REST API.
 */
class AzureTtsClient(
    private val context: Context,
    @Volatile var key: String = DEFAULT_KEY,
    @Volatile var region: String = DEFAULT_REGION,
    @Volatile var defaultVoice: String = DEFAULT_VOICE
) {

    companion object {
        const val TAG = "AzureTtsClient"
        const val DEFAULT_KEY = ""
        const val DEFAULT_REGION = "centralindia"
        const val DEFAULT_VOICE = "hi-IN-MadhurNeural"

        private val PATH_AUDIO_METADATA_REGEX = Regex("(?im)^Path:\\s*audio\\.metadata\\s*$")
        private val PATH_TURN_END_REGEX = Regex("(?im)^Path:\\s*turn\\.end\\s*$")
        private val VOICE_LOCALE_REGEX = Regex("^([a-z]{2,3}-[A-Z]{2})")

        internal fun extractHeaderBlock(frameText: String): String {
            val sepIndex = frameText.indexOf("\r\n\r\n")
            return if (sepIndex >= 0) frameText.substring(0, sepIndex) else frameText
        }

        internal fun isAudioMetadataFrame(frameText: String): Boolean {
            return PATH_AUDIO_METADATA_REGEX.containsMatchIn(extractHeaderBlock(frameText))
        }

        internal fun isTurnEndFrame(frameText: String): Boolean {
            return PATH_TURN_END_REGEX.containsMatchIn(extractHeaderBlock(frameText))
        }

        internal fun extractSsmlLocale(voice: String): String {
            return VOICE_LOCALE_REGEX.find(voice.trim())?.groupValues?.get(1) ?: "en-US"
        }

        internal fun generateProportionalBoundaries(text: String, totalDurationMs: Long): List<WordBoundary> {
            val matches = Regex("\\S+").findAll(text).toList()
            if (matches.isEmpty()) return emptyList()

            val leadInMs = (totalDurationMs / 20L).coerceIn(0L, 60L).coerceAtMost(totalDurationMs / 3L)
            val tailOutMs = (totalDurationMs / 20L).coerceIn(0L, 60L).coerceAtMost(totalDurationMs / 3L)
            val speechDuration = (totalDurationMs - leadInMs - tailOutMs).coerceAtLeast(1L)

            // Allocate weights with a small per-word floor (+1) so short words aren't starved,
            // and derive offsets from cumulative weights to eliminate per-word drift.
            val weights = matches.map { it.value.length.coerceAtLeast(1) + 1 }
            val totalWeight = weights.sum().coerceAtLeast(1)

            val boundaries = ArrayList<WordBoundary>(matches.size)
            var cumulativeWeight = 0
            for (i in matches.indices) {
                val match = matches[i]
                val startMs = leadInMs + (speechDuration * cumulativeWeight) / totalWeight
                cumulativeWeight += weights[i]
                val endMs = leadInMs + (speechDuration * cumulativeWeight) / totalWeight
                boundaries.add(
                    WordBoundary(
                        text = match.value,
                        offsetMs = startMs,
                        durationMs = (endMs - startMs).coerceAtLeast(1L),
                        textOffset = match.range.first
                    )
                )
            }
            return boundaries
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()

    /**
     * Synthesizes speech and returns the audio file with word boundary timestamps.
     * Tries WebSocket first; if unavailable, falls back to REST with proportional word pacing.
     */
    fun synthesize(text: String, voice: String = defaultVoice): AzureSynthesisResult? {
        val trimmedKey = key.trim()
        val trimmedRegion = region.trim()

        if (trimmedKey.isBlank() || trimmedRegion.isBlank()) {
            Log.e(TAG, "Azure key or region is blank")
            return null
        }

        // 1. Try WebSocket synthesis
        try {
            val wsResult = synthesizeViaWebSocket(text, voice, trimmedKey, trimmedRegion)
            if (wsResult != null && wsResult.audioFile.length() > 0) {
                if (wsResult.wordBoundaries.isNotEmpty()) {
                    Log.i(TAG, "Azure WebSocket synthesis succeeded with ${wsResult.wordBoundaries.size} word boundaries")
                    return wsResult
                }
                // Reuse the already-synthesized WS audio with proportional boundaries instead of leaking it
                val durationMs = getAudioDurationMs(wsResult.audioFile)
                val fallbackBoundaries = generateProportionalBoundaries(text, durationMs)
                Log.i(TAG, "Azure WebSocket returned audio without WordBoundary events; using proportional fallback")
                return wsResult.copy(wordBoundaries = fallbackBoundaries)
            }
            wsResult?.audioFile?.delete()
        } catch (e: Exception) {
            Log.w(TAG, "Azure WebSocket exception: ${e.message}")
        }

        // 2. Fallback to Azure REST synthesis
        try {
            Log.i(TAG, "Attempting Azure REST synthesis fallback...")
            val restResult = synthesizeViaRest(text, voice, trimmedKey, trimmedRegion)
            if (restResult != null && restResult.audioFile.length() > 0) {
                Log.i(TAG, "Azure REST synthesis succeeded (${restResult.audioFile.length()} bytes)")
                return restResult
            }
            restResult?.audioFile?.delete()
        } catch (e: Exception) {
            Log.e(TAG, "Azure REST synthesis error: ${e.message}")
        }

        return null
    }

    private fun synthesizeViaWebSocket(text: String, voice: String, k: String, r: String): AzureSynthesisResult? {
        val url = "wss://$r.tts.speech.microsoft.com/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=$k"
        val request = Request.Builder()
            .url(url)
            .build()

        val stateLock = Any()
        val audioStream = ByteArrayOutputStream()
        val wordBoundaries = mutableListOf<WordBoundary>()
        val latch = CountDownLatch(1)
        val hasError = AtomicBoolean(false)
        val requestId = UUID.randomUUID().toString().replace("-", "").uppercase()
        val timestamp = getIsoTimestamp()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val configJson = JSONObject().apply {
                    put("context", JSONObject().apply {
                        put("system", JSONObject().apply {
                            put("name", "SpeechSDK")
                            put("version", "1.30.0")
                            put("build", "JavaScript")
                            put("lang", "JavaScript")
                        })
                    })
                }
                val configMsg = "Path: speech.config\r\nX-RequestId: $requestId\r\nX-Timestamp: $timestamp\r\nContent-Type: application/json\r\n\r\n$configJson"
                webSocket.send(configMsg)

                val synthJson = JSONObject().apply {
                    put("synthesis", JSONObject().apply {
                        put("audio", JSONObject().apply {
                            put("metadataOptions", JSONObject().apply {
                                put("sentenceBoundaryEnabled", "false")
                                put("wordBoundaryEnabled", "true")
                            })
                            put("outputFormat", "audio-16khz-32kbitrate-mono-mp3")
                        })
                    })
                }
                val synthMsg = "Path: synthesis.context\r\nX-RequestId: $requestId\r\nX-Timestamp: $timestamp\r\nContent-Type: application/json\r\n\r\n$synthJson"
                webSocket.send(synthMsg)

                val ssml = buildSsml(text, voice)
                val ssmlMsg = "Path: ssml\r\nX-RequestId: $requestId\r\nX-Timestamp: $timestamp\r\nContent-Type: application/ssml+xml\r\n\r\n$ssml"
                webSocket.send(ssmlMsg)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (isAudioMetadataFrame(text)) {
                    val split = text.split("\r\n\r\n", limit = 2)
                    if (split.size >= 2) {
                        try {
                            val json = JSONObject(split[1])
                            val metadataArray = json.optJSONArray("Metadata")
                            if (metadataArray != null) {
                                synchronized(stateLock) {
                                    for (i in 0 until metadataArray.length()) {
                                        val item = metadataArray.getJSONObject(i)
                                        if (item.optString("Type") == "WordBoundary") {
                                            val data = item.getJSONObject("Data")
                                            val offsetTicks = data.optLong("Offset", 0L)
                                            val durationTicks = data.optLong("Duration", 0L)
                                            val wordText = data.optJSONObject("text")?.optString("Text") ?: ""
                                            val textOffset = when {
                                                data.has("textOffset") -> data.optInt("textOffset", 0)
                                                data.has("TextOffset") -> data.optInt("TextOffset", 0)
                                                else -> 0
                                            }

                                            val offsetMs = offsetTicks / 10000L
                                            val durationMs = durationTicks / 10000L

                                            if (wordText.isNotBlank()) {
                                                wordBoundaries.add(
                                                    WordBoundary(
                                                        text = wordText,
                                                        offsetMs = offsetMs,
                                                        durationMs = durationMs,
                                                        textOffset = textOffset
                                                    )
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Error parsing WordBoundary metadata: ${e.message}")
                        }
                    }
                } else if (isTurnEndFrame(text)) {
                    webSocket.close(1000, "Done")
                    latch.countDown()
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val data = bytes.toByteArray()
                if (data.size >= 2) {
                    val headerLen = ((data[0].toInt() and 0xFF) shl 8) or (data[1].toInt() and 0xFF)
                    val audioStart = 2 + headerLen
                    if (data.size > audioStart) {
                        synchronized(stateLock) {
                            audioStream.write(data, audioStart, data.size - audioStart)
                        }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WebSocket failure: ${t.message}")
                hasError.set(true)
                latch.countDown()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                latch.countDown()
            }
        }

        val ws = httpClient.newWebSocket(request, listener)
        val success = latch.await(12, TimeUnit.SECONDS)

        val audioBytes: ByteArray
        val boundariesCopy: List<WordBoundary>
        synchronized(stateLock) {
            audioBytes = audioStream.toByteArray()
            boundariesCopy = wordBoundaries.toList()
        }

        if (!success || hasError.get() || audioBytes.isEmpty()) {
            ws.cancel()
            return null
        }

        val cacheFile = File(context.cacheDir, "azure_tts_${System.currentTimeMillis()}.mp3")
        FileOutputStream(cacheFile).use { it.write(audioBytes) }

        return AzureSynthesisResult(cacheFile, boundariesCopy)
    }

    private fun synthesizeViaRest(text: String, voice: String, k: String, r: String): AzureSynthesisResult? {
        val url = "https://$r.tts.speech.microsoft.com/cognitiveservices/v1"
        val ssml = buildSsml(text, voice)
        val requestBody = ssml.toRequestBody("application/ssml+xml".toMediaType())

        val request = Request.Builder()
            .url(url)
            .addHeader("Ocp-Apim-Subscription-Key", k)
            .addHeader("Content-Type", "application/ssml+xml")
            .addHeader("X-Microsoft-OutputFormat", "audio-16khz-32kbitrate-mono-mp3")
            .addHeader("User-Agent", "BabaTTSAndroid")
            .post(requestBody)
            .build()

        val bodyBytes = httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                Log.e(TAG, "Azure REST error code: ${response.code}")
                return null
            }
            response.body?.bytes() ?: return null
        }

        val cacheFile = File(context.cacheDir, "azure_rest_${System.currentTimeMillis()}.mp3")
        FileOutputStream(cacheFile).use { it.write(bodyBytes) }

        val durationMs = getAudioDurationMs(cacheFile)
        val wordBoundaries = generateProportionalBoundaries(text, durationMs)

        return AzureSynthesisResult(cacheFile, wordBoundaries)
    }

    private fun buildSsml(text: String, voice: String): String {
        val lang = extractSsmlLocale(voice)
        val cleanText = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$lang'><voice name='$voice'>$cleanText</voice></speak>"
    }

    private fun getAudioDurationMs(file: File): Long {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.absolutePath)
            val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            durationStr?.toLongOrNull() ?: 2500L
        } catch (e: Exception) {
            2500L
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
        }
    }

    private fun getIsoTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }
}

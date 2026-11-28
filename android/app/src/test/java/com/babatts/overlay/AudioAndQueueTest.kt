package com.babatts.overlay

import android.media.AudioAttributes
import com.babatts.overlay.model.ChatMessage
import com.babatts.overlay.model.WordBoundary
import com.babatts.overlay.service.FloatingOverlayService
import com.babatts.overlay.tts.AzureTtsClient
import com.babatts.overlay.tts.BabaSpeechEngine
import com.babatts.overlay.ui.DualKawaseGlassDrawable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioAndQueueTest {

    @Test
    fun testChatMessageCreation() {
        val msg = ChatMessage(
            author = "BabaStreamer",
            platform = "YouTube",
            text = "Clutch the match!"
        )
        assertNotNull(msg.id)
        assertEquals("BabaStreamer", msg.author)
        assertEquals("YouTube", msg.platform)
        assertEquals("Clutch the match!", msg.text)
        assertTrue(msg.timestamp > 0)
    }

    @Test
    fun testStreamlabsAudioConstants() {
        assertEquals(1, AudioAttributes.USAGE_MEDIA)
        assertEquals(1, AudioAttributes.CONTENT_TYPE_SPEECH)
        assertEquals(1, AudioAttributes.ALLOW_CAPTURE_BY_ALL)
    }

    @Test
    fun testBannedAuthorFilteringLogic() {
        val bannedSet = mutableSetOf("spammer", "troll123")
        val messages = listOf(
            ChatMessage(author = "LegitUser", text = "Good luck!"),
            ChatMessage(author = "spammer", text = "Buy followers!"),
            ChatMessage(author = "Troll123", text = "Spam spam")
        )

        val filtered = messages.filter {
            !bannedSet.contains(it.author.lowercase())
        }

        assertEquals(1, filtered.size)
        assertEquals("LegitUser", filtered[0].author)
    }

    @Test
    fun testQueueFifoOrdering() {
        val queue = java.util.concurrent.ConcurrentLinkedQueue<ChatMessage>()
        val msg1 = ChatMessage(author = "First", text = "First message")
        val msg2 = ChatMessage(author = "Second", text = "Second message")

        queue.offer(msg1)
        queue.offer(msg2)

        assertEquals("First", queue.poll()?.author)
        assertEquals("Second", queue.poll()?.author)
        assertTrue(queue.isEmpty())
    }

    @Test
    fun testSaysIndexAndSubtitleWordSplitting() {
        val boundaries = listOf(
            WordBoundary(text = "BabaFan99", offsetMs = 0, durationMs = 300),
            WordBoundary(text = "says:", offsetMs = 300, durationMs = 250),
            WordBoundary(text = "Hello", offsetMs = 600, durationMs = 200),
            WordBoundary(text = "there!", offsetMs = 800, durationMs = 250)
        )

        val saysIndex = FloatingOverlayService.findSaysIndex(boundaries, "BabaFan99")
        assertEquals(1, saysIndex)

        val startIdx = FloatingOverlayService.findMessageStartIndex(boundaries, saysIndex)
        val messageWords = boundaries.subList(startIdx, boundaries.size)
        assertEquals(2, messageWords.size)
        assertEquals("Hello", messageWords[0].text)
        assertEquals("there!", messageWords[1].text)
    }

    @Test
    fun testMultiWordAndHyphenatedSaysAuthorEdgeCases() {
        val multiWord = listOf(
            WordBoundary(text = "Tactical", offsetMs = 0, durationMs = 200),
            WordBoundary(text = "Sniper", offsetMs = 200, durationMs = 250),
            WordBoundary(text = "says", offsetMs = 450, durationMs = 200),
            WordBoundary(text = ":", offsetMs = 650, durationMs = 20),
            WordBoundary(text = "Watch", offsetMs = 700, durationMs = 200),
            WordBoundary(text = "out", offsetMs = 900, durationMs = 150)
        )
        val saysIdx = FloatingOverlayService.findSaysIndex(multiWord, "Tactical Sniper")
        assertEquals(2, saysIdx)
        assertEquals(4, FloatingOverlayService.findMessageStartIndex(multiWord, saysIdx))

        // Hyphenated author containing "Says" must not match early
        val hyphenated = listOf(
            WordBoundary("Simon", 0, 200),
            WordBoundary("-", 200, 20),
            WordBoundary("Says", 220, 200),
            WordBoundary("says", 420, 200),
            WordBoundary(":", 620, 20),
            WordBoundary("Hello", 650, 200)
        )
        val hyphenSaysIdx = FloatingOverlayService.findSaysIndex(hyphenated, "Simon-Says")
        assertEquals(3, hyphenSaysIdx)
        assertEquals(5, FloatingOverlayService.findMessageStartIndex(hyphenated, hyphenSaysIdx))

        // Emoji-only author still locates "says" at index 0
        val emojiAuthor = listOf(
            WordBoundary("says", 0, 200),
            WordBoundary("He", 200, 150),
            WordBoundary("says", 350, 150),
            WordBoundary("hi", 500, 150)
        )
        assertEquals(0, FloatingOverlayService.findSaysIndex(emojiAuthor, "🔥 🔥"))
    }

    @Test
    fun testFontSizeConstants() {
        assertEquals("small", FloatingOverlayService.FONT_SIZE_SMALL)
        assertEquals("medium", FloatingOverlayService.FONT_SIZE_MEDIUM)
        assertEquals("large", FloatingOverlayService.FONT_SIZE_LARGE)
    }

    @Test
    fun testFontStyleConstants() {
        assertEquals("plus_jakarta", FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA)
        assertEquals("inter", FloatingOverlayService.FONT_STYLE_INTER)
        assertEquals("nunito", FloatingOverlayService.FONT_STYLE_NUNITO)
        assertEquals("jetbrains_mono", FloatingOverlayService.FONT_STYLE_MONO)
    }

    @Test
    fun testOverlayTextIsFullOpacityWhiteAndDualKawaseBlurDiffuses() {
        assertEquals(0xFFFFFFFF.toInt(), FloatingOverlayService.COLOR_TEXT_WHITE)

        val width = 33
        val height = 17
        val input = IntArray(width * height) { idx ->
            val x = idx % width
            val y = idx / width
            if ((x + y) % 2 == 0) 0xFF1D4ED8.toInt() else 0xFF071229.toInt()
        }
        val output = DualKawaseGlassDrawable.dualKawaseBlur(input, width, height, passes = 3)
        assertEquals(input.size, output.size)
        for (pixel in output) {
            assertEquals(0xFF, (pixel ushr 24) and 0xFF)
        }
        // High-frequency checkerboard blue channel contrast must smooth down after blur
        val inBlueDiff = kotlin.math.abs((input[0] and 0xFF) - (input[1] and 0xFF))
        val outBlueDiff = kotlin.math.abs((output[0] and 0xFF) - (output[1] and 0xFF))
        assertTrue(outBlueDiff < inBlueDiff)

        // Degenerate dimensions and 0-pass return an unchanged copy
        val tiny = intArrayOf(0xFF112233.toInt(), 0xFF445566.toInt())
        assertEquals(tiny.toList(), DualKawaseGlassDrawable.dualKawaseBlur(tiny, 2, 1, passes = 3).toList())
        assertEquals(input.toList(), DualKawaseGlassDrawable.dualKawaseBlur(input, width, height, passes = 0).toList())
    }

    @Test
    fun testDeterministicChatGlassThemesAndFallback() {
        assertEquals(DualKawaseGlassDrawable.DEFAULT_THEME, DualKawaseGlassDrawable.themeForAuthor(null))
        assertEquals(DualKawaseGlassDrawable.DEFAULT_THEME, DualKawaseGlassDrawable.themeForAuthor(""))
        assertEquals(DualKawaseGlassDrawable.DEFAULT_THEME, DualKawaseGlassDrawable.themeForAuthor("   "))

        val t1 = DualKawaseGlassDrawable.themeForAuthor("BabaFan99")
        val t2 = DualKawaseGlassDrawable.themeForAuthor("BabaFan99")
        assertEquals(t1, t2)

        val distinctThemes = listOf("BabaFan99", "TacticalSniper", "Viewer1", "LiveGamer", "ProStreamer", "ModAlex", "NightOwl", "PixelQueen")
            .map { DualKawaseGlassDrawable.themeForAuthor(it).name }
            .toSet()
        assertTrue(distinctThemes.size >= 4)
        for (theme in DualKawaseGlassDrawable.CHAT_THEMES) {
            assertEquals(0xFF, (theme.baseTop ushr 24) and 0xFF)
            assertEquals(0xFF, (theme.baseBottom ushr 24) and 0xFF)
        }
    }

    @Test
    fun testComputeActiveHighlightRangeAndSharedPrefKeys() {
        val tokens = FloatingOverlayService.alignBoundariesToText(
            "isn't it awesome",
            listOf(
                WordBoundary("isn", 0, 100),
                WordBoundary("'", 100, 20),
                WordBoundary("t", 120, 80),
                WordBoundary("it", 200, 100),
                WordBoundary("awesome", 300, 200)
            )
        )
        assertEquals(Pair(0, 5), FloatingOverlayService.computeActiveHighlightRange(tokens, 0))
        assertEquals(Pair(6, 8), FloatingOverlayService.computeActiveHighlightRange(tokens, 3))
        assertEquals(Pair(9, 16), FloatingOverlayService.computeActiveHighlightRange(tokens, 4))
        assertEquals(null, FloatingOverlayService.computeActiveHighlightRange(tokens, -1))
        assertEquals(null, FloatingOverlayService.computeActiveHighlightRange(tokens, 99))

        assertTrue(FloatingOverlayService.alignBoundariesToText("", emptyList()).isEmpty())
        assertEquals("baba_overlay_prefs", FloatingOverlayService.PREFS_NAME)
        assertEquals("overlay_engine", FloatingOverlayService.PREF_ENGINE)
        assertEquals("overlay_font_style", FloatingOverlayService.PREF_FONT_STYLE)
        assertTrue(FloatingOverlayService.shouldCollapseToIdle(null))
        assertFalse(FloatingOverlayService.shouldCollapseToIdle("active-msg-1"))

        val drawable = DualKawaseGlassDrawable(cornerRadiusPx = 24f)
        drawable.setAlpha(184)
        assertEquals(184, drawable.alpha)
        drawable.setAlpha(255)
        assertEquals(255, drawable.alpha)
    }

    @Test
    fun testAzureWebSocketHeaderDetectionAndSsmlLocale() {
        val metadataFrame = "X-RequestId:ABC\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n{\"Metadata\":[]}"
        val metadataFrameSpaced = "Path: audio.metadata\r\n\r\n{\"Metadata\":[]}"
        val turnEndFrame = "X-RequestId:ABC\r\nPath:turn.end\r\n\r\n"
        val bodySpoof = "Path:none\r\n\r\nPath:turn.end"

        assertTrue(AzureTtsClient.isAudioMetadataFrame(metadataFrame))
        assertTrue(AzureTtsClient.isAudioMetadataFrame(metadataFrameSpaced))
        assertTrue(AzureTtsClient.isTurnEndFrame(turnEndFrame))
        assertFalse(AzureTtsClient.isTurnEndFrame(bodySpoof))

        assertEquals("hi-IN", AzureTtsClient.extractSsmlLocale("hi-IN-MadhurNeural"))
        assertEquals("en-GB", AzureTtsClient.extractSsmlLocale("en-GB-SoniaNeural"))
        assertEquals("ja-JP", AzureTtsClient.extractSsmlLocale("ja-JP-NanamiNeural"))
        assertEquals("en-US", AzureTtsClient.extractSsmlLocale("invalid"))
    }

    @Test
    fun testProportionalBoundariesFitWithinAudioDurationWithoutDrift() {
        val text = "BabaFan99 says: One two three four five six seven eight nine ten eleven twelve!"
        val totalMs = 4000L
        val boundaries = AzureTtsClient.generateProportionalBoundaries(text, totalMs)

        assertEquals(14, boundaries.size)
        for (i in 1 until boundaries.size) {
            assertTrue(boundaries[i].offsetMs > boundaries[i - 1].offsetMs)
        }
        val last = boundaries.last()
        assertTrue(last.offsetMs + last.durationMs <= totalMs)
    }

    @Test
    fun testActiveBoundaryIndexSwitchesExactlyAtOnset() {
        val boundaries = listOf(
            WordBoundary(text = "Baba", offsetMs = 50, durationMs = 150),
            WordBoundary(text = "says:", offsetMs = 250, durationMs = 200),
            WordBoundary(text = "Hello", offsetMs = 460, durationMs = 300)
        )

        assertEquals(-1, BabaSpeechEngine.findActiveBoundaryIndex(boundaries, 10))
        assertEquals(0, BabaSpeechEngine.findActiveBoundaryIndex(boundaries, 50))
        assertEquals(0, BabaSpeechEngine.findActiveBoundaryIndex(boundaries, 249))
        assertEquals(1, BabaSpeechEngine.findActiveBoundaryIndex(boundaries, 250))
        assertEquals(2, BabaSpeechEngine.findActiveBoundaryIndex(boundaries, 460))
    }

    @Test
    fun testSystemTtsCharOffsetMapsRepeatedWordsAndPunctuation() {
        val speechText = "BabaFan99 says: Hello there! Hello!"
        val boundaries = BabaSpeechEngine.buildSystemSpeechBoundaries(speechText)

        assertEquals(5, boundaries.size)
        assertEquals(0, BabaSpeechEngine.findBoundaryIndexForCharOffset(boundaries, speechText.indexOf("BabaFan99")))
        assertEquals(1, BabaSpeechEngine.findBoundaryIndexForCharOffset(boundaries, speechText.indexOf("says:")))
        assertEquals(2, BabaSpeechEngine.findBoundaryIndexForCharOffset(boundaries, speechText.indexOf("Hello")))
        assertEquals(3, BabaSpeechEngine.findBoundaryIndexForCharOffset(boundaries, speechText.indexOf("there")))
        assertEquals(4, BabaSpeechEngine.findBoundaryIndexForCharOffset(boundaries, speechText.lastIndexOf("Hello")))
    }

    @Test
    fun testAlignBoundariesToTextHandlesEdgeCases() {
        // 1. Contractions, punctuation, trailing emoji
        val englishText = "isn't it awesome? 🔥"
        val englishBoundaries = listOf(
            WordBoundary("isn", 0, 100),
            WordBoundary("'", 100, 20),
            WordBoundary("t", 120, 80),
            WordBoundary("it", 200, 100),
            WordBoundary("awesome", 300, 200),
            WordBoundary("?", 500, 20)
        )
        val aligned = FloatingOverlayService.alignBoundariesToText(englishText, englishBoundaries)
        assertEquals(4, aligned.size)
        assertEquals(0, aligned[0].startBoundaryIndex)
        assertEquals(2, aligned[0].endBoundaryIndex)
        assertEquals(3, aligned[1].startBoundaryIndex)
        assertEquals(4, aligned[2].startBoundaryIndex)
        assertEquals(4, aligned[3].startBoundaryIndex)

        // 2. Short-word ("a") must NOT steal unconsumed "and" via substring match
        val symbolText = "I & a cat"
        val symbolBoundaries = listOf(
            WordBoundary("I", 0, 100),
            WordBoundary("and", 100, 100),
            WordBoundary("a", 200, 100),
            WordBoundary("cat", 300, 150)
        )
        val symbolAligned = FloatingOverlayService.alignBoundariesToText(symbolText, symbolBoundaries)
        assertEquals(0, symbolAligned[0].startBoundaryIndex) // I
        assertEquals(0, symbolAligned[1].startBoundaryIndex) // &
        assertEquals(2, symbolAligned[2].startBoundaryIndex) // a -> boundary 2, NOT "and"
        assertEquals(3, symbolAligned[3].startBoundaryIndex) // cat -> boundary 3

        // 3. Punctuation burst >6 tokens must not break lookahead for next word
        val burstText = "wait?!?!?! what"
        val burstBoundaries = listOf(
            WordBoundary("wait", 0, 150),
            WordBoundary("?", 150, 10),
            WordBoundary("!", 160, 10),
            WordBoundary("?", 170, 10),
            WordBoundary("!", 180, 10),
            WordBoundary("?", 190, 10),
            WordBoundary("!", 200, 10),
            WordBoundary("what", 250, 150)
        )
        val burstAligned = FloatingOverlayService.alignBoundariesToText(burstText, burstBoundaries)
        assertEquals(0, burstAligned[0].startBoundaryIndex)
        assertEquals(7, burstAligned[1].startBoundaryIndex)

        // 4. Consecutive unmatched expanded tokens advance monotonically
        val numericText = "$50 $60"
        val numericBoundaries = listOf(
            WordBoundary("fifty", 0, 150),
            WordBoundary("dollars", 150, 150),
            WordBoundary("sixty", 300, 150),
            WordBoundary("dollars", 450, 150)
        )
        val numericAligned = FloatingOverlayService.alignBoundariesToText(numericText, numericBoundaries)
        assertTrue(numericAligned[1].startBoundaryIndex > numericAligned[0].startBoundaryIndex)

        // 5. Short split contraction ("I'm" -> ["I", "'", "m"]) merges cleanly
        val shortContractionText = "I'm ready"
        val shortContractionBoundaries = listOf(
            WordBoundary("I", 0, 80),
            WordBoundary("'", 80, 10),
            WordBoundary("m", 90, 60),
            WordBoundary("ready", 160, 200)
        )
        val shortContractionAligned = FloatingOverlayService.alignBoundariesToText(
            shortContractionText,
            shortContractionBoundaries
        )
        assertEquals(0, shortContractionAligned[0].startBoundaryIndex)
        assertEquals(2, shortContractionAligned[0].endBoundaryIndex)
        assertEquals(3, shortContractionAligned[1].startBoundaryIndex)

        // 6. Devanagari combining marks stay intact
        assertEquals("नमस्ते", FloatingOverlayService.normalizeWordToken("नमस्ते!"))
    }

    @Test
    fun testYouTubeChannelLookupAndHtmlExtraction() {
        val sampleChannelId = "UC1234567890abcdefghijkl"
        assertTrue(com.babatts.overlay.youtube.YouTubeMessageParser.isCanonicalChannelId(sampleChannelId))
        assertFalse(com.babatts.overlay.youtube.YouTubeMessageParser.isCanonicalChannelId("UCshort"))
        assertFalse(com.babatts.overlay.youtube.YouTubeMessageParser.isCanonicalChannelId("@BabaIsLive"))
        assertFalse(com.babatts.overlay.youtube.YouTubeMessageParser.isCanonicalChannelId("BabaIsLive"))
        assertTrue(com.babatts.overlay.youtube.YouTubeMessageParser.looksLikeUrlInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        assertTrue(com.babatts.overlay.youtube.YouTubeMessageParser.looksLikeUrlInput("youtu.be/dQw4w9WgXcQ"))
        assertTrue(com.babatts.overlay.youtube.YouTubeMessageParser.looksLikeUrlInput("youtube.com/@BabaIsLive"))
        assertFalse(com.babatts.overlay.youtube.YouTubeMessageParser.looksLikeUrlInput("BabaIsLive"))

        assertEquals(
            listOf("https://www.youtube.com/@BabaIsLive"),
            com.babatts.overlay.youtube.YouTubeMessageParser.buildChannelLookupUrls("@BabaIsLive")
        )
        assertEquals(
            listOf("https://www.youtube.com/@Baba%20Live"),
            com.babatts.overlay.youtube.YouTubeMessageParser.buildChannelLookupUrls("@Baba Live")
        )
        assertEquals(
            listOf(
                "https://www.youtube.com/@BabaIsLive",
                "https://www.youtube.com/c/BabaIsLive",
                "https://www.youtube.com/user/BabaIsLive"
            ),
            com.babatts.overlay.youtube.YouTubeMessageParser.buildChannelLookupUrls("BabaIsLive")
        )
        assertEquals(emptyList<String>(), com.babatts.overlay.youtube.YouTubeMessageParser.buildChannelLookupUrls("@"))
        assertEquals(
            emptyList<String>(),
            com.babatts.overlay.youtube.YouTubeMessageParser.buildChannelLookupUrls(sampleChannelId)
        )
        assertEquals(
            "https://www.youtube.com/channel/$sampleChannelId/live",
            com.babatts.overlay.youtube.YouTubeMessageParser.buildCanonicalChannelLiveUrl(sampleChannelId)
        )

        val channelHtmlWithSidebar = """
            <html>
            <head>
                <meta itemprop="identifier" content="$sampleChannelId">
                <link rel="canonical" href="https://www.youtube.com/channel/$sampleChannelId">
            </head>
            <body>
                <script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"externalId":"$sampleChannelId"}},"sidebar":{"channelId":"UCother9999999999999999"}};</script>
            </body>
            </html>
        """.trimIndent()
        assertEquals(
            sampleChannelId,
            com.babatts.overlay.youtube.YouTubeMessageParser.extractChannelIdFromHtml(channelHtmlWithSidebar)
        )

        val reversedMetaHtml = """
            <html><head><meta content="$sampleChannelId" itemprop="channelId"></head><body>{"channelId":"UCother9999999999999999"}</body></html>
        """.trimIndent()
        assertEquals(
            sampleChannelId,
            com.babatts.overlay.youtube.YouTubeMessageParser.extractChannelIdFromHtml(reversedMetaHtml)
        )

        val rssOnlyHtml = """
            <html><head><link rel="alternate" type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=$sampleChannelId"></head><body>{"channelId":"UCother9999999999999999"}</body></html>
        """.trimIndent()
        assertEquals(
            sampleChannelId,
            com.babatts.overlay.youtube.YouTubeMessageParser.extractChannelIdFromHtml(rssOnlyHtml)
        )

        val sidebarOnlyHtml = """<html><body>{"sidebar":{"channelId":"UCother9999999999999999"}}</body></html>"""
        assertEquals(
            null,
            com.babatts.overlay.youtube.YouTubeMessageParser.extractChannelIdFromHtml(sidebarOnlyHtml)
        )

        // Offline channel /live HTML with trailer VOD "videoId" must NOT match as live
        val offlineChannelHtml = """
            <html>
            <head><link rel="canonical" href="https://www.youtube.com/channel/$sampleChannelId"></head>
            <body><script>var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"videoId":"dQw4w9WgXcQ"}]}}};</script></body>
            </html>
        """.trimIndent()
        assertEquals(
            null,
            com.babatts.overlay.youtube.YouTubeMessageParser.extractVideoIdFromHtml(offlineChannelHtml)
        )

        val liveWatchFallbackHtml = """
            <html><script>var cfg={"isLive":true,"videoId":"dQw4w9WgXcQ"};</script></html>
        """.trimIndent()
        assertEquals(
            "dQw4w9WgXcQ",
            com.babatts.overlay.youtube.YouTubeMessageParser.extractVideoIdFromHtml(liveWatchFallbackHtml)
        )

        val htmlWithSemicolonsInJson = """
            <html>
            <link rel="canonical" href="https://www.youtube.com/watch?v=abcDEF12345">
            <script>"INNERTUBE_API_KEY":"AIzaTestKey123";</script>
            <script>var ytInitialData = {"tracking":"a=1&amp;b=2;c=3","contents":{"liveChatRenderer":{"header":{"liveChatHeaderRenderer":{"viewSelector":{"sortFilterSubMenuRenderer":{"subMenuItems":[{"title":"Top chat","selected":true,"continuation":{"reloadContinuationData":{"continuation":"TOP_CONT_TOKEN"}}},{"title":"Live chat","selected":false,"continuation":{"reloadContinuationData":{"continuation":"LIVE_CONT_TOKEN"}}}]}}}}}}};</script>
            </html>
        """.trimIndent()

        assertEquals("abcDEF12345", com.babatts.overlay.youtube.YouTubeMessageParser.extractVideoIdFromHtml(htmlWithSemicolonsInJson))
        assertEquals("AIzaTestKey123", com.babatts.overlay.youtube.YouTubeMessageParser.extractInnertubeApiKey(htmlWithSemicolonsInJson))
        val initialData = com.babatts.overlay.youtube.YouTubeMessageParser.extractYtInitialData(htmlWithSemicolonsInJson)
        assertTrue(initialData != null)
        assertEquals(
            "LIVE_CONT_TOKEN",
            com.babatts.overlay.youtube.YouTubeMessageParser.extractContinuationToken(
                initialData,
                com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE
            )
        )
        assertEquals(
            "TOP_CONT_TOKEN",
            com.babatts.overlay.youtube.YouTubeMessageParser.extractContinuationToken(
                initialData,
                com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_TOP
            )
        )

        // Fallback HTML continuation regex when initialData is null
        assertEquals(
            "FALLBACK_TOKEN",
            com.babatts.overlay.youtube.YouTubeMessageParser.extractContinuationToken(
                null,
                com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE,
                """{"continuation":"FALLBACK_TOKEN"}"""
            )
        )
    }

    @Test
    fun testYouTubeChatActionParsingAndColdStartClassification() {
        val textAction = org.json.JSONObject(
            """
            {
              "addChatItemAction": {
                "item": {
                  "liveChatTextMessageRenderer": {
                    "id": "msg-1",
                    "timestampUsec": "500000000",
                    "authorExternalChannelId": "UCauthor1",
                    "authorName": {"simpleText": "BabaFan"},
                    "message": {
                      "runs": [
                        {"text": "Clutch play "},
                        {"emoji": {"emojiId": ":fire:", "shortcuts": [":fire:"]}}
                      ]
                    }
                  }
                }
              }
            }
            """.trimIndent()
        )
        val parsedText = com.babatts.overlay.youtube.YouTubeMessageParser.parseChatAction(textAction)
        assertTrue(parsedText != null)
        assertEquals("msg-1", parsedText!!.msgId)
        assertEquals("BabaFan", parsedText.authorName)
        assertEquals("UCauthor1", parsedText.authorId)
        assertEquals("Clutch play 🔥", parsedText.text)
        assertFalse(parsedText.isSuperchat)
        assertEquals(500_000_000L, parsedText.timestampUsec)

        val superChatAction = org.json.JSONObject(
            """
            {
              "addChatItemAction": {
                "item": {
                  "liveChatPaidMessageRenderer": {
                    "id": "sc-1",
                    "timestampUsec": 470000000,
                    "authorExternalChannelId": null,
                    "purchaseAmountText": {"simpleText": "$5.00"}
                  }
                }
              }
            }
            """.trimIndent()
        )
        val parsedSuper = com.babatts.overlay.youtube.YouTubeMessageParser.parseChatAction(superChatAction)
        assertTrue(parsedSuper != null)
        assertTrue(parsedSuper!!.isSuperchat)
        assertEquals("Anonymous", parsedSuper.authorName)
        assertEquals(null, parsedSuper.authorId)
        assertEquals("Super Chat: $5.00", parsedSuper.text)

        val watermark = 500_000_000L
        assertEquals(
            com.babatts.overlay.youtube.YouTubeMessageParser.Classification.HISTORICAL,
            com.babatts.overlay.youtube.YouTubeMessageParser.classifyMessage(
                timestampUsec = 499_000_000L,
                isSuperchat = false,
                isInitialPoll = true,
                isColdStart = true,
                watermarkUsec = watermark
            )
        )
        assertEquals(
            com.babatts.overlay.youtube.YouTubeMessageParser.Classification.QUEUED,
            com.babatts.overlay.youtube.YouTubeMessageParser.classifyMessage(
                timestampUsec = 470_000_000L,
                isSuperchat = true,
                isInitialPoll = true,
                isColdStart = true,
                watermarkUsec = watermark
            )
        )
        assertEquals(
            com.babatts.overlay.youtube.YouTubeMessageParser.Classification.HISTORICAL,
            com.babatts.overlay.youtube.YouTubeMessageParser.classifyMessage(
                timestampUsec = 420_000_000L,
                isSuperchat = true,
                isInitialPoll = true,
                isColdStart = true,
                watermarkUsec = watermark
            )
        )
        // Reconnect without cold start skips older messages even for Super Chats
        assertEquals(
            com.babatts.overlay.youtube.YouTubeMessageParser.Classification.HISTORICAL,
            com.babatts.overlay.youtube.YouTubeMessageParser.classifyMessage(
                timestampUsec = 490_000_000L,
                isSuperchat = true,
                isInitialPoll = true,
                isColdStart = false,
                watermarkUsec = watermark
            )
        )
        // Subsequent live poll always queues
        assertEquals(
            com.babatts.overlay.youtube.YouTubeMessageParser.Classification.QUEUED,
            com.babatts.overlay.youtube.YouTubeMessageParser.classifyMessage(
                timestampUsec = 490_000_000L,
                isSuperchat = false,
                isInitialPoll = false,
                isColdStart = false,
                watermarkUsec = watermark
            )
        )
    }

    @Test
    fun testYouTubeSeenCacheAndSpamFilter() {
        val cache = com.babatts.overlay.youtube.YouTubeMessageParser.SeenMessageCache(capacity = 3)
        assertTrue(cache.insert("m1"))
        assertFalse(cache.insert("m1"))
        assertTrue(cache.insert("m2"))
        assertTrue(cache.insert("m3"))
        assertTrue(cache.insert("m4")) // evicts m1
        assertFalse(cache.contains("m1"))
        assertTrue(cache.contains("m4"))

        var nowMs = 1_000L
        val spamFilter = com.babatts.overlay.youtube.YouTubeMessageParser.SpamFilter { nowMs }
        assertFalse(spamFilter.isSpam("u1", "Nice aim!"))
        assertTrue(spamFilter.isSpam("u1", "Nice aim!")) // 30s duplicate blocked
        nowMs += 31_000L
        assertFalse(spamFilter.isSpam("u1", "Nice aim!")) // allowed after window

        assertTrue(spamFilter.isSpam("u2", "🔥🔥🔥🔥")) // >3 emojis
        assertTrue(spamFilter.isSpam("u2", "goooooood")) // >=5 repeated chars
        assertTrue(spamFilter.isSpam("u2", "spam, spam! spam? spam")) // >=4 repeated words
        assertTrue(spamFilter.isSpam("u2", "hahaha")) // >=3 repeated patterns
        assertTrue(spamFilter.isSpam("u2", "sdfghjklmnbv")) // zero-vowel keyboard mash
        assertTrue(spamFilter.isSpam("u2", "!!!!!!!!!")) // >8 ASCII punctuation
        assertFalse(spamFilter.isSpam("u2", "❤️❤️❤️ hello!")) // BMP hearts must not count as punctuation
        assertFalse(spamFilter.isSpam("u2", "नमस्ते भाई क्या हाल है ❤️")) // Indic combining marks allowed
    }

    @Test
    fun testYouTubePollerUsernameToChannelIdAndSessionAgainstLocalMockServer() {
        val expectedChannelId = "UC1234567890abcdefghijkl"
        val server = java.net.ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        val port = server.localPort
        val pollCount = java.util.concurrent.atomic.AtomicInteger(0)

        val serverThread = Thread {
            while (!server.isClosed) {
                val sock = try { server.accept() } catch (_: Exception) { break }
                try {
                    val reader = sock.getInputStream().bufferedReader()
                    val reqLine = reader.readLine() ?: ""
                    var contentLength = 0
                    while (true) {
                        val h = reader.readLine() ?: break
                        if (h.isEmpty()) break
                        if (h.startsWith("Content-Length:", ignoreCase = true)) {
                            contentLength = h.substringAfter(":").trim().toIntOrNull() ?: 0
                        }
                    }
                    if (contentLength > 0) {
                        val buf = CharArray(contentLength)
                        var read = 0
                        while (read < contentLength) {
                            val r = reader.read(buf, read, contentLength - read)
                            if (r <= 0) break
                            read += r
                        }
                    }

                    val (statusLine, body) = when {
                        reqLine.contains("GET /@BabaIsLive ") -> {
                            "HTTP/1.1 404 Not Found" to "<html>Not Found</html>"
                        }
                        reqLine.contains("GET /c/BabaIsLive ") -> {
                            "HTTP/1.1 200 OK" to """<html><meta itemprop="identifier" content="$expectedChannelId"><script>var y={"externalId":"$expectedChannelId"};</script></html>"""
                        }
                        reqLine.contains("GET /channel/$expectedChannelId/live ") -> {
                            "HTTP/1.1 200 OK" to """<html><link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></html>"""
                        }
                        reqLine.contains("/live_chat?v=dQw4w9WgXcQ") -> {
                            "HTTP/1.1 200 OK" to """<html><script>"INNERTUBE_API_KEY":"TESTKEY";</script><script>var ytInitialData = {"note":"a;b","contents":{"liveChatRenderer":{"header":{"liveChatHeaderRenderer":{"viewSelector":{"sortFilterSubMenuRenderer":{"subMenuItems":[{"title":"Top chat","selected":true,"continuation":{"reloadContinuationData":{"continuation":"TOP_TOK"}}},{"title":"Live chat","selected":false,"continuation":{"reloadContinuationData":{"continuation":"LIVE_TOK"}}}]}}}}}}};</script></html>"""
                        }
                        reqLine.contains("get_live_chat") -> {
                            val n = pollCount.incrementAndGet()
                            val json = if (n == 1) {
                                """{"continuationContents":{"liveChatContinuation":{"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"id":"old1","timestampUsec":"500000000","authorExternalChannelId":"UCold","authorName":{"simpleText":"OldUser"},"message":{"runs":[{"text":"Old backlog"}]}}}}},{"addChatItemAction":{"item":{"liveChatPaidMessageRenderer":{"id":"sc1","timestampUsec":"480000000","authorExternalChannelId":"UCdonor","authorName":{"simpleText":"Donor"},"purchaseAmountText":{"simpleText":"$10"},"message":{"runs":[{"text":"Hype!"}]}}}}}],"continuations":[{"timedContinuationData":{"continuation":"CONT_2","timeoutMs":100}}]}}}"""
                            } else {
                                """{"continuationContents":{"liveChatContinuation":{"actions":[{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"id":"live2","timestampUsec":"501000000","authorExternalChannelId":"UCbanned","authorName":{"simpleText":"Troll"},"message":{"runs":[{"text":"Should be banned"}]}}}}},{"addChatItemAction":{"item":{"liveChatTextMessageRenderer":{"id":"live3","timestampUsec":"502000000","authorExternalChannelId":"UClive","authorName":{"simpleText":"LiveChatter"},"message":{"runs":[{"text":"Hello stream!"}]}}}}}],"continuations":[{"timedContinuationData":{"continuation":"CONT_3","timeoutMs":100}}]}}}"""
                            }
                            "HTTP/1.1 200 OK" to json
                        }
                        else -> "HTTP/1.1 404 Not Found" to """<html></html>"""
                    }

                    val bytes = body.toByteArray(Charsets.UTF_8)
                    val out = sock.getOutputStream()
                    out.write("$statusLine\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(bytes)
                    out.flush()
                } finally {
                    try { sock.close() } catch (_: Exception) {}
                }
            }
        }
        serverThread.isDaemon = true
        serverThread.start()

        val received = java.util.Collections.synchronizedList(mutableListOf<Pair<com.babatts.overlay.model.ChatMessage, Boolean>>())
        val resolvedIds = java.util.Collections.synchronizedList(mutableListOf<String>())
        val latch = java.util.concurrent.CountDownLatch(2)
        val poller = com.babatts.overlay.youtube.YouTubeChatPoller(
            listener = object : com.babatts.overlay.youtube.YouTubeChatPoller.Listener {
                override fun onMessageReceived(message: com.babatts.overlay.model.ChatMessage, isPriority: Boolean) {
                    received.add(message to isPriority)
                    latch.countDown()
                }
                override fun onStatusChanged(status: com.babatts.overlay.youtube.YouTubeChatPoller.Status) {
                    status.resolvedChannelId?.let { resolvedIds.add(it) }
                }
                override fun isAuthorBanned(authorName: String, authorId: String?): Boolean {
                    return authorId == "UCbanned"
                }
            },
            youtubeBaseUrl = "http://127.0.0.1:$port"
        )

        try {
            poller.configure(
                enabled = true,
                channelId = "BabaIsLive",
                chatMode = com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE
            )
            assertTrue(latch.await(6, java.util.concurrent.TimeUnit.SECONDS))
            assertTrue(resolvedIds.contains(expectedChannelId))
            assertEquals(2, received.size)
            assertEquals("Donor", received[0].first.author)
            assertEquals("UCdonor", received[0].first.authorId)
            assertTrue(received[0].second)
            assertEquals("LiveChatter", received[1].first.author)
            assertFalse(received[1].second)
        } finally {
            poller.shutdown()
            server.close()
        }
    }

    @Test
    fun testYouTubePollerUserFallback404ErrorAndOfflineNetworkHandling() {
        val server = java.net.ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        val port = server.localPort
        val userChannelId = "UCuser999999999999999999"
        val requestLog = java.util.Collections.synchronizedList(mutableListOf<String>())

        val serverThread = Thread {
            while (!server.isClosed) {
                val sock = try { server.accept() } catch (_: Exception) { break }
                try {
                    val reqLine = sock.getInputStream().bufferedReader().readLine() ?: ""
                    requestLog.add(reqLine)
                    val (statusLine, body) = when {
                        reqLine.contains("GET /@LegacyUser ") -> "HTTP/1.1 404 Not Found" to "<html></html>"
                        reqLine.contains("GET /c/LegacyUser ") -> "HTTP/1.1 410 Gone" to "<html></html>"
                        reqLine.contains("GET /user/LegacyUser ") -> {
                            "HTTP/1.1 200 OK" to """<html><meta itemprop="identifier" content="$userChannelId"></html>"""
                        }
                        reqLine.contains("GET /channel/$userChannelId/live ") -> {
                            // Offline channel page with VOD videoId
                            "HTTP/1.1 200 OK" to """<html><link rel="canonical" href="https://www.youtube.com/channel/$userChannelId"><script>{"videoId":"dQw4w9WgXcQ"}</script></html>"""
                        }
                        else -> "HTTP/1.1 404 Not Found" to "<html></html>"
                    }
                    val bytes = body.toByteArray(Charsets.UTF_8)
                    val out = sock.getOutputStream()
                    out.write("$statusLine\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(bytes)
                    out.flush()
                } finally {
                    try { sock.close() } catch (_: Exception) {}
                }
            }
        }
        serverThread.isDaemon = true
        serverThread.start()

        val statuses = java.util.Collections.synchronizedList(mutableListOf<com.babatts.overlay.youtube.YouTubeChatPoller.Status>())
        val offlineLatch = java.util.concurrent.CountDownLatch(1)
        val errorLatch = java.util.concurrent.CountDownLatch(1)
        val poller = com.babatts.overlay.youtube.YouTubeChatPoller(
            listener = object : com.babatts.overlay.youtube.YouTubeChatPoller.Listener {
                override fun onMessageReceived(message: com.babatts.overlay.model.ChatMessage, isPriority: Boolean) {}
                override fun onStatusChanged(status: com.babatts.overlay.youtube.YouTubeChatPoller.Status) {
                    statuses.add(status)
                    if (status.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.OFFLINE) {
                        offlineLatch.countDown()
                    }
                    if (status.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.ERROR &&
                        status.channelInput == "MissingUser404"
                    ) {
                        errorLatch.countDown()
                    }
                }
                override fun isAuthorBanned(authorName: String, authorId: String?) = false
            },
            youtubeBaseUrl = "http://127.0.0.1:$port"
        )

        try {
            // 1. Bare username falls back /@ -> /c (410) -> /user (200), finds channel ID, then sees offline channel
            poller.configure(true, "LegacyUser", com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE)
            assertTrue(offlineLatch.await(5, java.util.concurrent.TimeUnit.SECONDS))
            val lastOffline = statuses.last { it.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.OFFLINE }
            assertEquals(userChannelId, lastOffline.resolvedChannelId)
            assertEquals("LegacyUser", lastOffline.channelInput)
            assertTrue(lastOffline.summary.contains("not live"))

            // 2. Switching username invalidates cache and all-404 lookup emits ERROR (and URL rejection works)
            poller.configure(true, "https://youtu.be/dQw4w9WgXcQ", com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE)
            assertTrue(statuses.any { it.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.ERROR && it.summary.contains("not a URL") })

            poller.configure(true, "MissingUser404", com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE)
            assertTrue(errorLatch.await(5, java.util.concurrent.TimeUnit.SECONDS))
            val notFoundStatus = statuses.last { it.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.ERROR }
            assertEquals("MissingUser404", notFoundStatus.channelInput)

            // 3. Direct non-existent UC... Channel ID -> ERROR (no infinite retry)
            val ucErrorLatch = java.util.concurrent.CountDownLatch(1)
            val ucPoller = com.babatts.overlay.youtube.YouTubeChatPoller(
                listener = object : com.babatts.overlay.youtube.YouTubeChatPoller.Listener {
                    override fun onMessageReceived(message: com.babatts.overlay.model.ChatMessage, isPriority: Boolean) {}
                    override fun onStatusChanged(status: com.babatts.overlay.youtube.YouTubeChatPoller.Status) {
                        if (status.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.ERROR) {
                            ucErrorLatch.countDown()
                        }
                    }
                    override fun isAuthorBanned(authorName: String, authorId: String?) = false
                },
                youtubeBaseUrl = "http://127.0.0.1:$port"
            )
            try {
                ucPoller.configure(true, "UCmissing000000000000000", com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE)
                assertTrue(ucErrorLatch.await(5, java.util.concurrent.TimeUnit.SECONDS))
            } finally {
                ucPoller.shutdown()
            }
        } finally {
            poller.shutdown()
            server.close()
        }

        // 4. Network IOException during channel lookup -> ChannelLookupResult.NetworkError & poller OFFLINE
        val deadServer = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val closedPort = deadServer.localPort
        deadServer.close()
        val offlineNetLatch = java.util.concurrent.CountDownLatch(1)
        val offlinePoller = com.babatts.overlay.youtube.YouTubeChatPoller(
            listener = object : com.babatts.overlay.youtube.YouTubeChatPoller.Listener {
                override fun onMessageReceived(message: com.babatts.overlay.model.ChatMessage, isPriority: Boolean) {}
                override fun onStatusChanged(status: com.babatts.overlay.youtube.YouTubeChatPoller.Status) {
                    if (status.state == com.babatts.overlay.youtube.YouTubeChatPoller.State.OFFLINE) {
                        offlineNetLatch.countDown()
                    }
                }
                override fun isAuthorBanned(authorName: String, authorId: String?) = false
            },
            youtubeBaseUrl = "http://127.0.0.1:$closedPort"
        )
        try {
            offlinePoller.configure(true, "@SomeStream", com.babatts.overlay.youtube.YouTubeMessageParser.CHAT_MODE_LIVE)
            assertTrue(offlineNetLatch.await(5, java.util.concurrent.TimeUnit.SECONDS))
        } finally {
            offlinePoller.shutdown()
        }
    }

    @Test
    fun testSystemTtsHinglishDetectionAndLocaleSelection() {
        val hiIn = BabaSpeechEngine.LOCALE_HI_IN
        val enIn = BabaSpeechEngine.LOCALE_EN_IN

        // Devanagari and Romanized Hinglish detected cleanly
        assertTrue(BabaSpeechEngine.isHindiOrHinglishText("नमस्ते भाई"))
        assertTrue(BabaSpeechEngine.isHindiOrHinglishText("bhai kya haal hai stream mast hai"))
        assertTrue(BabaSpeechEngine.isHindiOrHinglishText("nhi yaar aaj clutch kr"))

        // Pure English sentences stay English (avoiding false positives on "hi", "the", "main")
        assertFalse(BabaSpeechEngine.isHindiOrHinglishText("Hi chat! Welcome to the main stream!"))
        assertFalse(BabaSpeechEngine.isHindiOrHinglishText("What a clutch play in the tournament!"))

        // Hinglish Auto switches per utterance between hi-IN and en-IN when both packs are available
        assertEquals(
            hiIn,
            BabaSpeechEngine.chooseSystemTtsLocale(
                mode = BabaSpeechEngine.SYSTEM_LANG_HINGLISH,
                utteranceText = "bhai clutch kr de!",
                hasHiIn = true,
                hasEnIn = true,
                hasEnUs = true,
                defaultLocale = java.util.Locale.US
            )
        )
        assertEquals(
            enIn,
            BabaSpeechEngine.chooseSystemTtsLocale(
                mode = BabaSpeechEngine.SYSTEM_LANG_HINGLISH,
                utteranceText = "Clean headshot, nice shot!",
                hasHiIn = true,
                hasEnIn = true,
                hasEnUs = true,
                defaultLocale = java.util.Locale.US
            )
        )

        // Graceful fallback when hi-IN is missing -> en-IN -> en-US
        assertEquals(
            enIn,
            BabaSpeechEngine.chooseSystemTtsLocale(
                mode = BabaSpeechEngine.SYSTEM_LANG_HINGLISH,
                utteranceText = "kya scene hai bhai",
                hasHiIn = false,
                hasEnIn = true,
                hasEnUs = true,
                defaultLocale = java.util.Locale.US
            )
        )
        assertEquals(
            java.util.Locale.US,
            BabaSpeechEngine.chooseSystemTtsLocale(
                mode = BabaSpeechEngine.SYSTEM_LANG_EN_IN,
                utteranceText = "Hello",
                hasHiIn = false,
                hasEnIn = false,
                hasEnUs = true,
                defaultLocale = java.util.Locale.US
            )
        )
    }
}

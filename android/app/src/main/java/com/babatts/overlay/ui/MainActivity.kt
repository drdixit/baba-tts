package com.babatts.overlay.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Outline
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.view.View
import android.view.ViewOutlineProvider
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.content.res.ResourcesCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.widget.doAfterTextChanged
import com.babatts.overlay.R
import com.babatts.overlay.databinding.ActivityMainBinding
import com.babatts.overlay.service.FloatingOverlayService
import com.babatts.overlay.tts.AzureTtsClient
import com.babatts.overlay.tts.BabaSpeechEngine
import com.babatts.overlay.youtube.YouTubeChatPoller
import com.babatts.overlay.youtube.YouTubeMessageParser
import com.google.android.material.card.MaterialCardView
import okhttp3.Call
import okhttp3.OkHttpClient
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: SharedPreferences
    private val mainHandler = Handler(Looper.getMainLooper())

    private var previewGlassDrawable: DualKawaseGlassDrawable? = null
    private var previewThemeIndex: Int = 0
    private var askedNotificationPermission = false
    private var isUpdatingYouTubeUi = false
    private var isYoutubeReceiverRegistered = false

    private val lookupExecutor = Executors.newSingleThreadExecutor()
    private val lookupClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()
    private val lookupSeq = AtomicLong(0L)
    private val activeLookupCall = AtomicReference<Call?>(null)
    @Volatile
    private var isResolvingChannelStandalone = false
    @Volatile
    private var standaloneLookupError: Pair<String, String>? = null

    private val youtubeStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            updateOverlayServiceStatus()
            updateYouTubeStatusUi()
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* Service works regardless; notification shows if granted */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Enforce Light Mode strictly across the app controller
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)

        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyCircularMascotClip()
        applyEdgeToEdgeInsets()
        prefs = getSharedPreferences(FloatingOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
        migrateLegacySettingsIfNeeded()

        setupLivePreviewCard()
        loadSavedConfig()
        setupListeners()
    }

    override fun onStart() {
        super.onStart()
        if (!isYoutubeReceiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                youtubeStatusReceiver,
                IntentFilter(FloatingOverlayService.ACTION_YOUTUBE_STATUS_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            isYoutubeReceiverRegistered = true
        }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatus()
        updateOverlayServiceStatus()
        updateYouTubeStatusUi()
    }

    override fun onStop() {
        if (isYoutubeReceiverRegistered) {
            unregisterReceiver(youtubeStatusReceiver)
            isYoutubeReceiverRegistered = false
        }
        super.onStop()
    }

    override fun onDestroy() {
        super.onDestroy()
        lookupSeq.incrementAndGet()
        activeLookupCall.getAndSet(null)?.cancel()
        lookupExecutor.shutdownNow()
        lookupClient.dispatcher.cancelAll()
        lookupClient.connectionPool.evictAll()
        lookupClient.dispatcher.executorService.shutdown()
        mainHandler.removeCallbacksAndMessages(null)
        binding.previewOverlayPill.background = null
        previewGlassDrawable?.callback = null
        previewGlassDrawable = null
    }

    private fun applyCircularMascotClip() {
        binding.imgMascot.apply {
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setOval(0, 0, view.width, view.height)
                }
            }
            clipToOutline = true
        }
    }

    private fun applyEdgeToEdgeInsets() {
        val baseStart = dpToPx(16)
        val baseTop = dpToPx(12)
        val baseEnd = dpToPx(16)
        val baseBottom = dpToPx(24)

        ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { root, windowInsets ->
            val insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            // Keep top & side insets on the root container so scrolled content never overlaps status bar icons
            root.setPadding(insets.left, insets.top, insets.right, 0)
            binding.contentContainer.setPaddingRelative(
                baseStart,
                baseTop,
                baseEnd,
                baseBottom + insets.bottom
            )
            windowInsets
        }
        ViewCompat.requestApplyInsets(binding.rootContainer)
    }

    private fun migrateLegacySettingsIfNeeded() {
        if (prefs.contains(FloatingOverlayService.PREF_FONT_SIZE) ||
            prefs.contains(FloatingOverlayService.PREF_ENGINE)
        ) {
            return
        }
        val legacy = getSharedPreferences("baba_settings_prefs", Context.MODE_PRIVATE)
        if (legacy.all.isEmpty()) return
        val editor = prefs.edit()
        legacy.getString("engine", null)?.let { editor.putString(FloatingOverlayService.PREF_ENGINE, it) }
        legacy.getString("azure_region", null)?.let { editor.putString(FloatingOverlayService.PREF_AZURE_REGION, it) }
        legacy.getString("azure_voice", null)?.let { editor.putString(FloatingOverlayService.PREF_AZURE_VOICE, it) }
        legacy.getString("azure_key", null)?.let { editor.putString(FloatingOverlayService.PREF_AZURE_KEY, it) }
        legacy.getString("font_size", null)?.let { editor.putString(FloatingOverlayService.PREF_FONT_SIZE, it) }
        legacy.getString("font_style", null)?.let { editor.putString(FloatingOverlayService.PREF_FONT_STYLE, it) }
        editor.apply()
    }

    private fun setupLivePreviewCard() {
        val cornerRadiusPx = dpToPx(12).toFloat()
        val glass = DualKawaseGlassDrawable(cornerRadiusPx)
        previewGlassDrawable = glass
        binding.previewOverlayPill.apply {
            background = glass
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(target: View, outline: Outline) {
                    outline.setRoundRect(0, 0, target.width, target.height, cornerRadiusPx)
                }
            }
            clipToOutline = true
        }
        applyPreviewTheme(0)
    }

    private fun applyPreviewTheme(index: Int) {
        val themes = DualKawaseGlassDrawable.CHAT_THEMES
        previewThemeIndex = ((index % themes.size) + themes.size) % themes.size
        val theme = themes[previewThemeIndex]
        previewGlassDrawable?.setTheme(theme)

        val sample = getString(R.string.preview_message)
        val word = "Watch"
        val start = sample.indexOf(word)
        if (start >= 0) {
            binding.previewSubtitles.setHighlightRange(start, start + word.length, theme.activeWordBg)
        }
        binding.previewThemeLabel.text = "${theme.name} · Tap to cycle"
    }

    private fun loadSavedConfig() {
        val engine = prefs.getString(FloatingOverlayService.PREF_ENGINE, BabaSpeechEngine.ENGINE_SYSTEM)
        if (engine == BabaSpeechEngine.ENGINE_SYSTEM) {
            binding.toggleEngine.check(R.id.btn_engine_system)
            binding.azureConfigSection.visibility = View.GONE
            binding.systemTtsSection.visibility = View.VISIBLE
        } else {
            binding.toggleEngine.check(R.id.btn_engine_azure)
            binding.azureConfigSection.visibility = View.VISIBLE
            binding.systemTtsSection.visibility = View.GONE
        }

        val savedSystemLang = prefs.getString(
            FloatingOverlayService.PREF_SYSTEM_TTS_LANG,
            BabaSpeechEngine.SYSTEM_LANG_HINGLISH
        ) ?: BabaSpeechEngine.SYSTEM_LANG_HINGLISH
        updateSystemLangCardSelection(savedSystemLang)

        val region = prefs.getString(FloatingOverlayService.PREF_AZURE_REGION, AzureTtsClient.DEFAULT_REGION)
            ?: AzureTtsClient.DEFAULT_REGION
        val voice = prefs.getString(FloatingOverlayService.PREF_AZURE_VOICE, AzureTtsClient.DEFAULT_VOICE)
            ?: AzureTtsClient.DEFAULT_VOICE
        val key = prefs.getString(FloatingOverlayService.PREF_AZURE_KEY, AzureTtsClient.DEFAULT_KEY)
            ?: AzureTtsClient.DEFAULT_KEY

        binding.editAzureRegion.setText(region)
        binding.editAzureVoice.setText(voice)
        binding.editAzureKey.setText(key)
        updateAzureSummary(region, voice, key)

        val savedFontSize = prefs.getString(FloatingOverlayService.PREF_FONT_SIZE, FloatingOverlayService.FONT_SIZE_MEDIUM)
            ?: FloatingOverlayService.FONT_SIZE_MEDIUM
        val sizeBtnId = when (savedFontSize) {
            FloatingOverlayService.FONT_SIZE_SMALL -> R.id.btn_size_small
            FloatingOverlayService.FONT_SIZE_LARGE -> R.id.btn_size_large
            else -> R.id.btn_size_medium
        }
        binding.toggleFontSize.check(sizeBtnId)

        val savedFontStyle = prefs.getString(FloatingOverlayService.PREF_FONT_STYLE, FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA)
            ?: FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA
        updateFontStyleCardSelection(savedFontStyle)
        updateLivePreviewTypography(savedFontSize, savedFontStyle)

        val ytEnabled = prefs.getBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false)
        val ytChannel = prefs.getString(FloatingOverlayService.PREF_YT_CHANNEL_ID, "") ?: ""
        val ytMode = prefs.getString(FloatingOverlayService.PREF_YT_CHAT_MODE, YouTubeMessageParser.CHAT_MODE_LIVE)
            ?: YouTubeMessageParser.CHAT_MODE_LIVE

        isUpdatingYouTubeUi = true
        binding.switchYoutubeEnabled.isChecked = ytEnabled
        isUpdatingYouTubeUi = false
        binding.editYtChannelId.setText(ytChannel)
        val modeBtnId = if (ytMode.equals(YouTubeMessageParser.CHAT_MODE_TOP, ignoreCase = true)) {
            R.id.btn_yt_mode_top
        } else {
            R.id.btn_yt_mode_live
        }
        binding.toggleYtChatMode.check(modeBtnId)
        updateYouTubeStatusUi()
    }

    private fun updateSystemLangCardSelection(selectedMode: String) {
        val activeFill = ContextCompat.getColor(this, R.color.baba_primary_soft)
        val inactiveFill = ContextCompat.getColor(this, R.color.baba_card_light)
        val activeStroke = ContextCompat.getColor(this, R.color.baba_primary)
        val inactiveStroke = ContextCompat.getColor(this, R.color.baba_outline_input)
        val strokeActivePx = dpToPx(2)
        val strokeInactivePx = dpToPx(1)

        val cards: List<Pair<MaterialCardView, String>> = listOf(
            binding.cardLangHinglish to BabaSpeechEngine.SYSTEM_LANG_HINGLISH,
            binding.cardLangEnIn to BabaSpeechEngine.SYSTEM_LANG_EN_IN,
            binding.cardLangHiIn to BabaSpeechEngine.SYSTEM_LANG_HI_IN,
            binding.cardLangEnUs to BabaSpeechEngine.SYSTEM_LANG_EN_US
        )
        for ((card, modeKey) in cards) {
            val isSelected = modeKey == selectedMode
            card.isSelected = isSelected
            card.setCardBackgroundColor(if (isSelected) activeFill else inactiveFill)
            card.strokeColor = if (isSelected) activeStroke else inactiveStroke
            card.strokeWidth = if (isSelected) strokeActivePx else strokeInactivePx
        }
    }

    private fun getSelectedSystemLangMode(): String {
        return prefs.getString(
            FloatingOverlayService.PREF_SYSTEM_TTS_LANG,
            BabaSpeechEngine.SYSTEM_LANG_HINGLISH
        ) ?: BabaSpeechEngine.SYSTEM_LANG_HINGLISH
    }

    private fun updateAzureSummary(region: String, voice: String, key: String) {
        val keyState = if (key.isNotBlank()) "Key OK" else "No key"
        binding.textAzureSummary.text = "$region • $voice • $keyState"
    }

    private fun updateFontStyleCardSelection(selectedStyle: String) {
        val activeFill = ContextCompat.getColor(this, R.color.baba_primary_soft)
        val inactiveFill = ContextCompat.getColor(this, R.color.baba_card_light)
        val activeStroke = ContextCompat.getColor(this, R.color.baba_primary)
        val inactiveStroke = ContextCompat.getColor(this, R.color.baba_outline_input)
        val strokeActivePx = dpToPx(2)
        val strokeInactivePx = dpToPx(1)

        val cards: List<Pair<MaterialCardView, String>> = listOf(
            binding.cardFontPlusJakarta to FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA,
            binding.cardFontInter to FloatingOverlayService.FONT_STYLE_INTER,
            binding.cardFontNunito to FloatingOverlayService.FONT_STYLE_NUNITO,
            binding.cardFontMono to FloatingOverlayService.FONT_STYLE_MONO
        )
        for ((card, styleKey) in cards) {
            val isSelected = styleKey == selectedStyle
            card.isSelected = isSelected
            card.setCardBackgroundColor(if (isSelected) activeFill else inactiveFill)
            card.strokeColor = if (isSelected) activeStroke else inactiveStroke
            card.strokeWidth = if (isSelected) strokeActivePx else strokeInactivePx
        }
    }

    private fun updateLivePreviewTypography(size: String, style: String) {
        when (size) {
            FloatingOverlayService.FONT_SIZE_SMALL -> {
                binding.previewAuthor.textSize = 12f
                binding.previewSubtitles.textSize = 12f
            }
            FloatingOverlayService.FONT_SIZE_LARGE -> {
                binding.previewAuthor.textSize = 16f
                binding.previewSubtitles.textSize = 19f
            }
            else -> {
                binding.previewAuthor.textSize = 13f
                binding.previewSubtitles.textSize = 15f
            }
        }
        val fontResId = when (style) {
            FloatingOverlayService.FONT_STYLE_INTER -> R.font.font_inter
            FloatingOverlayService.FONT_STYLE_NUNITO -> R.font.font_nunito
            FloatingOverlayService.FONT_STYLE_MONO -> R.font.font_jetbrains_mono
            else -> R.font.font_plus_jakarta
        }
        val typeface = ResourcesCompat.getFont(this, fontResId)
        val letterSpacing = if (style == FloatingOverlayService.FONT_STYLE_MONO) 0f else 0.01f
        binding.previewAuthor.apply {
            setTypeface(typeface, Typeface.BOLD)
            this.letterSpacing = letterSpacing
        }
        binding.previewSubtitles.apply {
            setTypeface(typeface, Typeface.NORMAL)
            this.letterSpacing = letterSpacing
        }
    }

    private fun getSelectedFontSize(): String {
        return when (binding.toggleFontSize.checkedButtonId) {
            R.id.btn_size_small -> FloatingOverlayService.FONT_SIZE_SMALL
            R.id.btn_size_large -> FloatingOverlayService.FONT_SIZE_LARGE
            else -> FloatingOverlayService.FONT_SIZE_MEDIUM
        }
    }

    private fun getSelectedFontStyle(): String {
        return prefs.getString(FloatingOverlayService.PREF_FONT_STYLE, FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA)
            ?: FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA
    }

    private fun openOverlayPermissionSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (askedNotificationPermission || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            askedNotificationPermission = true
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun setupListeners() {
        binding.btnPermission.setOnClickListener {
            openOverlayPermissionSettings()
        }

        binding.previewStage.setOnClickListener {
            applyPreviewTheme(previewThemeIndex + 1)
        }

        binding.toggleEngine.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val engine = if (checkedId == R.id.btn_engine_azure) {
                binding.azureConfigSection.visibility = View.VISIBLE
                binding.systemTtsSection.visibility = View.GONE
                BabaSpeechEngine.ENGINE_AZURE
            } else {
                binding.azureConfigSection.visibility = View.GONE
                binding.systemTtsSection.visibility = View.VISIBLE
                BabaSpeechEngine.ENGINE_SYSTEM
            }
            prefs.edit().putString(FloatingOverlayService.PREF_ENGINE, engine).apply()
            broadcastConfigUpdate(includeAzureFields = false)
        }

        val langCards = listOf(
            binding.cardLangHinglish to BabaSpeechEngine.SYSTEM_LANG_HINGLISH,
            binding.cardLangEnIn to BabaSpeechEngine.SYSTEM_LANG_EN_IN,
            binding.cardLangHiIn to BabaSpeechEngine.SYSTEM_LANG_HI_IN,
            binding.cardLangEnUs to BabaSpeechEngine.SYSTEM_LANG_EN_US
        )
        for ((card, modeKey) in langCards) {
            card.setOnClickListener {
                prefs.edit().putString(FloatingOverlayService.PREF_SYSTEM_TTS_LANG, modeKey).apply()
                updateSystemLangCardSelection(modeKey)
                broadcastConfigUpdate(includeAzureFields = false)
            }
        }

        binding.btnInstallTtsVoices.setOnClickListener {
            try {
                startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA))
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(
                    this,
                    "Open Android Settings → Text-to-speech output to download voices",
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        binding.btnToggleAzureDetails.setOnClickListener {
            val show = binding.azureConfigContainer.visibility != View.VISIBLE
            binding.azureConfigContainer.visibility = if (show) View.VISIBLE else View.GONE
            binding.btnToggleAzureDetails.text = getString(
                if (show) R.string.btn_hide_azure else R.string.btn_configure_azure
            )
        }

        binding.toggleFontSize.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val fontSize = when (checkedId) {
                R.id.btn_size_small -> FloatingOverlayService.FONT_SIZE_SMALL
                R.id.btn_size_large -> FloatingOverlayService.FONT_SIZE_LARGE
                else -> FloatingOverlayService.FONT_SIZE_MEDIUM
            }
            prefs.edit().putString(FloatingOverlayService.PREF_FONT_SIZE, fontSize).apply()
            updateLivePreviewTypography(fontSize, getSelectedFontStyle())
            broadcastConfigUpdate(includeAzureFields = false)
        }

        val fontCards = listOf(
            binding.cardFontPlusJakarta to FloatingOverlayService.FONT_STYLE_PLUS_JAKARTA,
            binding.cardFontInter to FloatingOverlayService.FONT_STYLE_INTER,
            binding.cardFontNunito to FloatingOverlayService.FONT_STYLE_NUNITO,
            binding.cardFontMono to FloatingOverlayService.FONT_STYLE_MONO
        )
        for ((card, styleKey) in fontCards) {
            card.setOnClickListener {
                prefs.edit().putString(FloatingOverlayService.PREF_FONT_STYLE, styleKey).apply()
                updateFontStyleCardSelection(styleKey)
                updateLivePreviewTypography(getSelectedFontSize(), styleKey)
                broadcastConfigUpdate(includeAzureFields = false)
            }
        }

        binding.btnSaveConfig.setOnClickListener {
            val key = binding.editAzureKey.text?.toString()?.trim().orEmpty()
            val region = binding.editAzureRegion.text?.toString()?.trim().orEmpty()
                .ifEmpty { AzureTtsClient.DEFAULT_REGION }
            val voice = binding.editAzureVoice.text?.toString()?.trim().orEmpty()
                .ifEmpty { AzureTtsClient.DEFAULT_VOICE }

            binding.editAzureRegion.setText(region)
            binding.editAzureVoice.setText(voice)

            prefs.edit()
                .putString(FloatingOverlayService.PREF_AZURE_KEY, key)
                .putString(FloatingOverlayService.PREF_AZURE_REGION, region)
                .putString(FloatingOverlayService.PREF_AZURE_VOICE, voice)
                .apply()

            updateAzureSummary(region, voice, key)
            broadcastConfigUpdate(includeAzureFields = true)
            Toast.makeText(this, "Azure Speech configuration saved!", Toast.LENGTH_SHORT).show()
        }

        binding.btnToggleOverlay.setOnClickListener {
            if (!ensureOverlayPermissionForAction()) return@setOnClickListener

            if (FloatingOverlayService.isRunning) {
                stopOverlayService()
            } else {
                syncPendingChannelInputBeforeStart()
                requestNotificationPermissionIfNeeded()
                startOverlayService()
            }
            updateOverlayServiceStatus()
        }

        binding.btnSimGreeting.setOnClickListener {
            sendChatMessage(
                author = "BabaFan99",
                platform = "YouTube",
                text = "Hello there! Welcome to Baba TTS live streaming overlay!"
            )
        }

        binding.btnSimLong.setOnClickListener {
            sendChatMessage(
                author = "TacticalSniper",
                platform = "Twitch",
                text = "Watch out behind the blue warehouse! Two enemies are pushing the bridge from the left flank!"
            )
        }

        binding.btnSimBurst.setOnClickListener {
            if (!ensureOverlayPermissionForAction()) return@setOnClickListener
            sendChatMessage("Viewer1", "YouTube", "First blood! What a shot!")
            mainHandler.postDelayed({
                if (!isFinishing && !isDestroyed) {
                    sendChatMessage("LiveGamer", "TikTok", "Donated $5: Clutch this round for the chat!")
                }
            }, 600)
            mainHandler.postDelayed({
                if (!isFinishing && !isDestroyed) {
                    sendChatMessage("ProStreamer", "Kick", "POGGG! Baba is popping off on mobile!")
                }
            }, 1200)
        }

        binding.editCustomText.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                submitCustomText()
                true
            } else {
                false
            }
        }

        binding.btnSpeakCustom.setOnClickListener {
            submitCustomText()
        }

        binding.switchYoutubeEnabled.setOnCheckedChangeListener { _, isChecked ->
            if (isUpdatingYouTubeUi) return@setOnCheckedChangeListener
            if (isChecked) {
                applyYouTubeSettings(enable = true, startServiceIfStopped = true, showToast = true)
            } else {
                applyYouTubeSettings(enable = false, startServiceIfStopped = false, showToast = false)
            }
        }

        binding.toggleYtChatMode.addOnButtonCheckedListener { _, _, isChecked ->
            if (!isChecked || isUpdatingYouTubeUi) return@addOnButtonCheckedListener
            applyYouTubeSettings(
                enable = binding.switchYoutubeEnabled.isChecked,
                startServiceIfStopped = false,
                showToast = false
            )
        }

        binding.editYtChannelId.doAfterTextChanged {
            binding.inputLayoutYtChannel.error = null
            standaloneLookupError = null
            if (!isUpdatingYouTubeUi) {
                cancelStandaloneChannelLookup()
                updateYouTubeStatusUi()
            }
        }

        binding.editYtChannelId.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                applyYouTubeSettings(enable = true, startServiceIfStopped = true, showToast = true)
                true
            } else {
                false
            }
        }

        binding.btnApplyYoutube.setOnClickListener {
            applyYouTubeSettings(enable = true, startServiceIfStopped = true, showToast = true)
        }
    }

    private fun submitCustomText() {
        val text = binding.editCustomText.text?.toString()?.trim().orEmpty()
        if (text.isNotEmpty()) {
            if (sendChatMessage("CustomUser", "YouTube", text)) {
                binding.editCustomText.text?.clear()
            }
        } else {
            Toast.makeText(this, "Enter some text to speak", Toast.LENGTH_SHORT).show()
        }
    }

    private fun hasOverlayPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    private fun ensureOverlayPermissionForAction(): Boolean {
        if (hasOverlayPermission()) return true
        Toast.makeText(this, "Please grant Display Over Other Apps permission first!", Toast.LENGTH_SHORT).show()
        openOverlayPermissionSettings()
        return false
    }

    private fun updatePermissionStatus() {
        binding.cardPermission.visibility = if (hasOverlayPermission()) View.GONE else View.VISIBLE
    }

    private fun updateOverlayServiceStatus() {
        val running = FloatingOverlayService.isRunning
        if (running) {
            binding.textOverlayState.text = getString(R.string.hero_status_running)
            binding.btnToggleOverlay.text = getString(R.string.btn_stop_overlay)
            binding.btnToggleOverlay.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(this, R.color.baba_primary_dark)
            )
            binding.textHeaderStatus.text = getString(R.string.status_pill_live)
            binding.textHeaderStatus.setTextColor(ContextCompat.getColor(this, R.color.baba_green_text))
            binding.dotOverlayStatus.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(this, R.color.baba_green)
            )
            binding.pillOverlayStatus.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(this, R.color.baba_green_soft)
            )
        } else {
            binding.textOverlayState.text = getString(R.string.hero_status_stopped)
            binding.btnToggleOverlay.text = getString(R.string.btn_start_overlay)
            binding.btnToggleOverlay.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(this, R.color.baba_primary)
            )
            binding.textHeaderStatus.text = getString(R.string.status_pill_idle)
            binding.textHeaderStatus.setTextColor(ContextCompat.getColor(this, R.color.baba_text_secondary))
            binding.dotOverlayStatus.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(this, R.color.baba_text_muted)
            )
            binding.pillOverlayStatus.backgroundTintList = ColorStateList.valueOf(
                ContextCompat.getColor(this, R.color.baba_surface_subtle)
            )
        }
    }

    private fun getSelectedYouTubeChatMode(): String {
        return if (binding.toggleYtChatMode.checkedButtonId == R.id.btn_yt_mode_top) {
            YouTubeMessageParser.CHAT_MODE_TOP
        } else {
            YouTubeMessageParser.CHAT_MODE_LIVE
        }
    }

    private fun syncPendingChannelInputBeforeStart() {
        cancelStandaloneChannelLookup()
        standaloneLookupError = null
        binding.inputLayoutYtChannel.error = null
        val channelInput = binding.editYtChannelId.text?.toString()?.trim().orEmpty()
        if (channelInput.isNotEmpty() && !YouTubeMessageParser.looksLikeUrlInput(channelInput)) {
            val savedInput = prefs.getString(FloatingOverlayService.PREF_YT_CHANNEL_ID, "") ?: ""
            if (channelInput != savedInput) {
                val editor = prefs.edit().putString(FloatingOverlayService.PREF_YT_CHANNEL_ID, channelInput)
                if (YouTubeMessageParser.isCanonicalChannelId(channelInput)) {
                    editor.putString(FloatingOverlayService.PREF_YT_RESOLVED_INPUT, channelInput)
                    editor.putString(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID, channelInput)
                } else {
                    editor.remove(FloatingOverlayService.PREF_YT_RESOLVED_INPUT)
                    editor.remove(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID)
                }
                editor.apply()
            }
        }
    }

    private fun cancelStandaloneChannelLookup() {
        lookupSeq.incrementAndGet()
        activeLookupCall.getAndSet(null)?.cancel()
        isResolvingChannelStandalone = false
    }

    private fun startStandaloneChannelLookup(channelInput: String) {
        val cleanInput = channelInput.trim()
        if (cleanInput.isEmpty() ||
            YouTubeMessageParser.isCanonicalChannelId(cleanInput) ||
            YouTubeMessageParser.looksLikeUrlInput(cleanInput)
        ) {
            return
        }

        val seq = lookupSeq.incrementAndGet()
        activeLookupCall.getAndSet(null)?.cancel()
        isResolvingChannelStandalone = true
        standaloneLookupError = null
        updateYouTubeStatusUi()

        try {
            lookupExecutor.execute {
                val result = YouTubeChatPoller.lookupChannelId(
                    client = lookupClient,
                    youtubeBaseUrl = "https://www.youtube.com",
                    input = cleanInput,
                    onCallCreated = { call -> activeLookupCall.set(call) },
                    onCallFinished = { call -> activeLookupCall.compareAndSet(call, null) },
                    isCancelled = { lookupSeq.get() != seq }
                )
                mainHandler.post {
                    if (isFinishing || isDestroyed || lookupSeq.get() != seq) return@post
                    isResolvingChannelStandalone = false
                    when (result) {
                        is YouTubeChatPoller.ChannelLookupResult.Success -> {
                            prefs.edit()
                                .putString(FloatingOverlayService.PREF_YT_RESOLVED_INPUT, cleanInput)
                                .putString(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID, result.channelId)
                                .apply()
                            standaloneLookupError = null
                            if (binding.editYtChannelId.text?.toString()?.trim() == cleanInput) {
                                binding.inputLayoutYtChannel.error = null
                            }
                        }
                        is YouTubeChatPoller.ChannelLookupResult.NotFound -> {
                            standaloneLookupError = cleanInput to result.message
                            if (binding.editYtChannelId.text?.toString()?.trim() == cleanInput) {
                                binding.inputLayoutYtChannel.error = result.message
                            }
                        }
                        is YouTubeChatPoller.ChannelLookupResult.NetworkError -> {
                            standaloneLookupError = cleanInput to result.message
                        }
                    }
                    updateYouTubeStatusUi()
                }
            }
        } catch (_: Exception) {
            isResolvingChannelStandalone = false
        }
    }

    private fun applyYouTubeSettings(
        enable: Boolean,
        startServiceIfStopped: Boolean,
        showToast: Boolean
    ) {
        val channelInput = binding.editYtChannelId.text?.toString()?.trim().orEmpty()
        val chatMode = getSelectedYouTubeChatMode()

        binding.inputLayoutYtChannel.error = null
        standaloneLookupError = null

        if (channelInput.isEmpty()) {
            cancelStandaloneChannelLookup()
            isUpdatingYouTubeUi = true
            binding.switchYoutubeEnabled.isChecked = false
            isUpdatingYouTubeUi = false
            prefs.edit()
                .putBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false)
                .putString(FloatingOverlayService.PREF_YT_CHANNEL_ID, "")
                .putString(FloatingOverlayService.PREF_YT_CHAT_MODE, chatMode)
                .remove(FloatingOverlayService.PREF_YT_RESOLVED_INPUT)
                .remove(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID)
                .apply()
            if (FloatingOverlayService.isRunning) {
                broadcastConfigUpdate(includeAzureFields = false)
            }
            if (enable) {
                binding.inputLayoutYtChannel.error = "Enter a YouTube username, @handle, or Channel ID"
                binding.editYtChannelId.requestFocus()
            }
            updateYouTubeStatusUi()
            return
        }

        if (enable && YouTubeMessageParser.looksLikeUrlInput(channelInput)) {
            val savedEnabled = prefs.getBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false)
            isUpdatingYouTubeUi = true
            binding.switchYoutubeEnabled.isChecked = savedEnabled
            isUpdatingYouTubeUi = false
            binding.inputLayoutYtChannel.error = "Enter a username, @handle, or UC… Channel ID (no URL)"
            binding.editYtChannelId.requestFocus()
            return
        }

        val editor = prefs.edit()
            .putString(FloatingOverlayService.PREF_YT_CHANNEL_ID, channelInput)
            .putString(FloatingOverlayService.PREF_YT_CHAT_MODE, chatMode)

        val isCanonical = YouTubeMessageParser.isCanonicalChannelId(channelInput)
        val alreadyResolved = prefs.getString(FloatingOverlayService.PREF_YT_RESOLVED_INPUT, "") == channelInput &&
            !prefs.getString(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID, "").isNullOrEmpty()

        if (isCanonical) {
            cancelStandaloneChannelLookup()
            editor.putString(FloatingOverlayService.PREF_YT_RESOLVED_INPUT, channelInput)
            editor.putString(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID, channelInput)
        } else if (!alreadyResolved) {
            editor.remove(FloatingOverlayService.PREF_YT_RESOLVED_INPUT)
            editor.remove(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID)
        }

        if (enable && startServiceIfStopped && !FloatingOverlayService.isRunning && !hasOverlayPermission()) {
            isUpdatingYouTubeUi = true
            binding.switchYoutubeEnabled.isChecked = false
            isUpdatingYouTubeUi = false
            editor.putBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false).apply()
            if (!isCanonical && !alreadyResolved) {
                startStandaloneChannelLookup(channelInput)
            } else {
                updateYouTubeStatusUi()
            }
            ensureOverlayPermissionForAction()
            return
        }

        isUpdatingYouTubeUi = true
        binding.switchYoutubeEnabled.isChecked = enable
        isUpdatingYouTubeUi = false
        editor.putBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, enable).apply()

        if (FloatingOverlayService.isRunning) {
            cancelStandaloneChannelLookup()
            broadcastConfigUpdate(includeAzureFields = false)
            if (!enable && !isCanonical && !alreadyResolved && !YouTubeMessageParser.looksLikeUrlInput(channelInput)) {
                startStandaloneChannelLookup(channelInput)
            }
        } else if (enable && startServiceIfStopped) {
            cancelStandaloneChannelLookup()
            requestNotificationPermissionIfNeeded()
            startOverlayService()
        } else if (!isCanonical && !alreadyResolved && !YouTubeMessageParser.looksLikeUrlInput(channelInput)) {
            startStandaloneChannelLookup(channelInput)
        }

        updateYouTubeStatusUi()
        if (showToast && enable) {
            Toast.makeText(this, "YouTube Live Chat settings saved!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun updateYouTubeStatusUi() {
        val enabled = prefs.getBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false)
        val running = FloatingOverlayService.isRunning
        val rawStatus = FloatingOverlayService.youtubeStatus
        val savedInput = prefs.getString(FloatingOverlayService.PREF_YT_CHANNEL_ID, "") ?: ""
        val currentFieldText = binding.editYtChannelId.text?.toString()?.trim().orEmpty()
        val effectiveInput = currentFieldText.ifEmpty { savedInput }
        val savedResolvedInput = prefs.getString(FloatingOverlayService.PREF_YT_RESOLVED_INPUT, "") ?: ""
        val savedResolvedId = prefs.getString(FloatingOverlayService.PREF_YT_RESOLVED_CHANNEL_ID, "") ?: ""

        val status = if (rawStatus.channelInput == null || rawStatus.channelInput == savedInput) {
            rawStatus
        } else {
            null
        }

        val resolvedChannelId = when {
            currentFieldText.isEmpty() -> null
            status?.resolvedChannelId != null && currentFieldText == savedInput -> status.resolvedChannelId
            savedResolvedId.isNotEmpty() && savedResolvedInput == currentFieldText -> savedResolvedId
            else -> null
        }

        if (isResolvingChannelStandalone) {
            binding.textYtResolvedChannel.text = "Fetching channel ID…"
            binding.textYtResolvedChannel.setTextColor(ContextCompat.getColor(this, R.color.baba_text_secondary))
            binding.textYtResolvedChannel.visibility = View.VISIBLE
        } else if (!resolvedChannelId.isNullOrBlank() &&
            currentFieldText.isNotBlank() &&
            !YouTubeMessageParser.isCanonicalChannelId(currentFieldText)
        ) {
            binding.textYtResolvedChannel.text = "Channel ID: $resolvedChannelId"
            binding.textYtResolvedChannel.setTextColor(ContextCompat.getColor(this, R.color.baba_accent_text))
            binding.textYtResolvedChannel.visibility = View.VISIBLE
        } else {
            binding.textYtResolvedChannel.visibility = View.GONE
        }

        val standaloneErr = standaloneLookupError?.takeIf { it.first == currentFieldText }?.second
        if (status?.state == YouTubeChatPoller.State.ERROR &&
            status.channelInput == currentFieldText &&
            currentFieldText.isNotEmpty()
        ) {
            binding.inputLayoutYtChannel.error = status.summary
        } else if (standaloneErr != null && currentFieldText.isNotEmpty()) {
            binding.inputLayoutYtChannel.error = standaloneErr
        }

        val pillText: String
        val statusText: String
        val pillBgColor: Int
        val pillTextColor: Int

        if (isResolvingChannelStandalone) {
            pillText = getString(R.string.youtube_pill_connecting)
            statusText = "Fetching channel ID for ${effectiveInput}…"
            pillBgColor = R.color.baba_accent_soft
            pillTextColor = R.color.baba_accent_text
        } else if (standaloneErr != null && !running) {
            pillText = getString(R.string.youtube_pill_error)
            statusText = standaloneErr
            pillBgColor = R.color.baba_primary_soft
            pillTextColor = R.color.baba_primary_dark
        } else if (!enabled) {
            pillText = getString(R.string.youtube_pill_off)
            statusText = getString(R.string.youtube_status_off)
            pillBgColor = R.color.baba_surface_subtle
            pillTextColor = R.color.baba_text_secondary
        } else if (!running) {
            pillText = getString(R.string.youtube_pill_off)
            statusText = "Saved — start Floating Overlay to connect"
            pillBgColor = R.color.baba_accent_soft
            pillTextColor = R.color.baba_accent_text
        } else if (status == null) {
            pillText = getString(R.string.youtube_pill_connecting)
            statusText = "Connecting to $savedInput…"
            pillBgColor = R.color.baba_accent_soft
            pillTextColor = R.color.baba_accent_text
        } else {
            when (status.state) {
                YouTubeChatPoller.State.CONNECTED -> {
                    pillText = getString(R.string.youtube_pill_live)
                    statusText = status.summary
                    pillBgColor = R.color.baba_green_soft
                    pillTextColor = R.color.baba_green_text
                }
                YouTubeChatPoller.State.CONNECTING -> {
                    pillText = getString(R.string.youtube_pill_connecting)
                    statusText = status.summary
                    pillBgColor = R.color.baba_accent_soft
                    pillTextColor = R.color.baba_accent_text
                }
                YouTubeChatPoller.State.OFFLINE -> {
                    pillText = getString(R.string.youtube_pill_offline)
                    statusText = status.summary
                    pillBgColor = R.color.baba_warning_bg
                    pillTextColor = R.color.baba_warning_text
                }
                YouTubeChatPoller.State.ERROR -> {
                    pillText = getString(R.string.youtube_pill_error)
                    statusText = status.summary
                    pillBgColor = R.color.baba_primary_soft
                    pillTextColor = R.color.baba_primary_dark
                }
                YouTubeChatPoller.State.DISABLED -> {
                    pillText = getString(R.string.youtube_pill_off)
                    statusText = status.summary
                    pillBgColor = R.color.baba_surface_subtle
                    pillTextColor = R.color.baba_text_secondary
                }
            }
        }

        binding.pillYtStatus.text = pillText
        binding.pillYtStatus.setTextColor(ContextCompat.getColor(this, pillTextColor))
        binding.pillYtStatus.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this, pillBgColor))
        binding.textYtStatus.text = statusText
    }

    private fun broadcastConfigUpdate(includeAzureFields: Boolean) {
        if (!FloatingOverlayService.isRunning) return

        val engine = prefs.getString(FloatingOverlayService.PREF_ENGINE, BabaSpeechEngine.ENGINE_SYSTEM)
        val fontSize = getSelectedFontSize()
        val fontStyle = getSelectedFontStyle()
        val ytEnabled = prefs.getBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false)
        val ytChannel = prefs.getString(FloatingOverlayService.PREF_YT_CHANNEL_ID, "") ?: ""
        val ytMode = prefs.getString(FloatingOverlayService.PREF_YT_CHAT_MODE, YouTubeMessageParser.CHAT_MODE_LIVE)
            ?: YouTubeMessageParser.CHAT_MODE_LIVE

        val intent = Intent(this, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_UPDATE_CONFIG
            putExtra(FloatingOverlayService.EXTRA_ENGINE, engine)
            putExtra(FloatingOverlayService.EXTRA_SYSTEM_TTS_LANG, getSelectedSystemLangMode())
            putExtra(FloatingOverlayService.EXTRA_FONT_SIZE, fontSize)
            putExtra(FloatingOverlayService.EXTRA_FONT_STYLE, fontStyle)
            putExtra(FloatingOverlayService.EXTRA_ENABLE_YOUTUBE, ytEnabled)
            putExtra(FloatingOverlayService.EXTRA_YT_CHANNEL_ID, ytChannel)
            putExtra(FloatingOverlayService.EXTRA_YT_CHAT_MODE, ytMode)
            if (includeAzureFields) {
                putExtra(FloatingOverlayService.EXTRA_KEY, binding.editAzureKey.text?.toString()?.trim().orEmpty())
                putExtra(FloatingOverlayService.EXTRA_REGION, binding.editAzureRegion.text?.toString()?.trim().orEmpty())
                putExtra(FloatingOverlayService.EXTRA_VOICE, binding.editAzureVoice.text?.toString()?.trim().orEmpty())
            }
        }
        startService(intent)
    }

    private fun startOverlayService() {
        val engine = if (binding.toggleEngine.checkedButtonId == R.id.btn_engine_azure) {
            BabaSpeechEngine.ENGINE_AZURE
        } else {
            BabaSpeechEngine.ENGINE_SYSTEM
        }
        val key = prefs.getString(FloatingOverlayService.PREF_AZURE_KEY, AzureTtsClient.DEFAULT_KEY)
            ?: AzureTtsClient.DEFAULT_KEY
        val region = prefs.getString(FloatingOverlayService.PREF_AZURE_REGION, AzureTtsClient.DEFAULT_REGION)
            ?: AzureTtsClient.DEFAULT_REGION
        val voice = prefs.getString(FloatingOverlayService.PREF_AZURE_VOICE, AzureTtsClient.DEFAULT_VOICE)
            ?: AzureTtsClient.DEFAULT_VOICE
        val fontSize = getSelectedFontSize()
        val fontStyle = getSelectedFontStyle()
        val ytEnabled = prefs.getBoolean(FloatingOverlayService.PREF_ENABLE_YOUTUBE, false)
        val ytChannel = prefs.getString(FloatingOverlayService.PREF_YT_CHANNEL_ID, "") ?: ""
        val ytMode = prefs.getString(FloatingOverlayService.PREF_YT_CHAT_MODE, YouTubeMessageParser.CHAT_MODE_LIVE)
            ?: YouTubeMessageParser.CHAT_MODE_LIVE

        val intent = Intent(this, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_START
            putExtra(FloatingOverlayService.EXTRA_ENGINE, engine)
            putExtra(FloatingOverlayService.EXTRA_SYSTEM_TTS_LANG, getSelectedSystemLangMode())
            putExtra(FloatingOverlayService.EXTRA_KEY, key)
            putExtra(FloatingOverlayService.EXTRA_REGION, region)
            putExtra(FloatingOverlayService.EXTRA_VOICE, voice)
            putExtra(FloatingOverlayService.EXTRA_FONT_SIZE, fontSize)
            putExtra(FloatingOverlayService.EXTRA_FONT_STYLE, fontStyle)
            putExtra(FloatingOverlayService.EXTRA_ENABLE_YOUTUBE, ytEnabled)
            putExtra(FloatingOverlayService.EXTRA_YT_CHANNEL_ID, ytChannel)
            putExtra(FloatingOverlayService.EXTRA_YT_CHAT_MODE, ytMode)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        mainHandler.postDelayed({
            updateOverlayServiceStatus()
            updateYouTubeStatusUi()
        }, 300)
    }

    private fun stopOverlayService() {
        val intent = Intent(this, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_STOP
        }
        try {
            startService(intent)
        } catch (_: IllegalStateException) {
            // Service may already have been stopped by the OS
        }
        mainHandler.postDelayed({
            updateOverlayServiceStatus()
            updateYouTubeStatusUi()
        }, 300)
    }

    private fun sendChatMessage(author: String, platform: String, text: String): Boolean {
        if (!ensureOverlayPermissionForAction()) return false
        requestNotificationPermissionIfNeeded()

        val wasRunning = FloatingOverlayService.isRunning
        if (!wasRunning) {
            startOverlayService()
        }
        val intent = Intent(this, FloatingOverlayService::class.java).apply {
            action = FloatingOverlayService.ACTION_ENQUEUE
            putExtra(FloatingOverlayService.EXTRA_AUTHOR, author)
            putExtra(FloatingOverlayService.EXTRA_PLATFORM, platform)
            putExtra(FloatingOverlayService.EXTRA_TEXT, text)
        }
        try {
            if (!wasRunning && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        } catch (e: IllegalStateException) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            }
        }
        Toast.makeText(this, "Speaking as @$author...", Toast.LENGTH_SHORT).show()
        return true
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }
}

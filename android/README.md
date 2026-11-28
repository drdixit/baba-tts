# Baba TTS Android - Persistent Floating Overlay HUD

A native Android streaming companion app for **Baba TTS**, providing an always-on-top, non-intrusive floating HUD designed for mobile gaming and live broadcasting with **Streamlabs Mobile** and **Prism Live**.

---

## 🌟 Key Features

1. **Persistent Top-Right Floating Overlay (`SYSTEM_ALERT_WINDOW`):**
   - Managed via a dedicated `FloatingOverlayService` using `WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY`.
   - Anchored at `Gravity.TOP or Gravity.END` (x = 16dp, y = 64dp) with `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS` so landscape games never clip the HUD.
   - **Zero Game Interruption (`FLAG_NOT_FOCUSABLE` | `FLAG_NOT_TOUCH_MODAL`):** Does not steal keyboard focus, touch inputs, or virtual joystick controls in mobile games (PUBG Mobile, COD Mobile, Free Fire).
   - **Stealth Dock Mode:** When idle, auto-collapses to a compact 36dp docked badge at 40% opacity (`alpha = 0.4f`) so it never blocks the minimap or field of view.
   - **Active Speaking Mode:** Expands with spring physics to 95% opacity, showing a 💬 speech-bubble handle (no avatar or platform badge), pulsing status ring, live equalizer waveform bars, sender username, and the full message text. Long messages are never truncated: the overlay grows to fit and stays on screen.
   - **Draggable & Dockable:** Drag anywhere; releases snap with spring animation to the nearest screen edge.

2. **Streamlabs Mobile Audio Integration (`AudioPlaybackCapture`):**
   - Configured with `AudioAttributes.ALLOW_CAPTURE_BY_ALL`, `AudioAttributes.USAGE_MEDIA`, and `AudioAttributes.CONTENT_TYPE_SPEECH`.
   - Android 10+ internal screen audio capture in Streamlabs and Prism Live records the TTS voice directly into the live broadcast stream alongside mobile game audio.

3. **In-HUD Moderation & Quick Actions:**
   - ⏭️ **Skip:** Immediately halts current speech and advances the FIFO queue.
   - 🚫 **Ban:** Blacklists sender and purges all their messages from the queue.
   - 🔇 **Mute:** Instantly mutes audio output without stopping chat ingestion.

4. **Standalone Interactive Demo & Simulator:**
   - One-tap permission grant wizard.
   - Preset simulation triggers: Greeting, Long Subtitles, 3x Queue Burst, and Custom Text.
   - In-app interactive gaming canvas to verify touch pass-through directly under the floating HUD.

---

## 🏗️ Architecture

```
android/
├── app/
│   ├── src/main/
│   │   ├── AndroidManifest.xml          # Overlay & Foreground Service permissions
│   │   ├── java/com/babatts/overlay/
│   │   │   ├── model/ChatMessage.kt     # Chat data model
│   │   │   ├── service/FloatingOverlayService.kt # WindowManager overlay service
│   │   │   ├── tts/BabaSpeechEngine.kt  # Android TTS engine with stream capture
│   │   │   └── ui/MainActivity.kt       # Demo & interactive touch testing harness
│   │   └── res/
│   │       ├── layout/overlay_bubble.xml # Floating HUD layout (Bubble + Username + Message + Actions)
│   │       ├── layout/activity_main.xml  # Interactive controller dashboard
│   │       └── drawable/                # Glassmorphic shapes and Baba mascot
│   └── src/test/java/com/babatts/overlay/
│       └── AudioAndQueueTest.kt         # Streamlabs capture & queue unit tests
├── build.gradle.kts                     # Root build configuration
├── settings.gradle.kts                  # Project settings
└── local.properties                     # Android SDK path configuration
```

---

## 🚀 Building & Running

### Prerequisites
- Android SDK (API 26+)
- JDK 17+
- Gradle 9.3+ (included via Gradle Wrapper)

### Run Unit Tests
```bash
./gradlew test
```

### Build Debug APK
```bash
./gradlew assembleDebug
```
Output APK location:
`android/app/build/outputs/apk/debug/app-debug.apk`

### Install on Device
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

# Design Specification: Native Windows Software with Embedded Management & OBS Endpoints

**Date**: 2026-11-06  
**Topic**: Converting BABA TTS into a Dedicated Windows Desktop Application  
**Status**: Proposed

---

## 1. Intent & Context

BABA TTS is a YouTube Live Chat Text-to-Speech (TTS) engine and moderation suite for livestreamers. It polls live chat, synthesizes high-fidelity audio via Azure Cognitive Services Speech with word-level karaoke timing, and broadcasts events over WebSockets.

### The Current Problem
Currently, the Rust application (`baba-tts.exe`) controls the application lifecycle and system tray, but when users launch the app or click tray actions ("Open Dashboard", "Open Settings"), `tray.rs:open_desktop_app()` spawns an external process:
```rust
std::process::Command::new("msedge").arg(format!("--app={}", url)).spawn()
```
This forces the streamer to configure and monitor their stream through an external web browser (Microsoft Edge or Google Chrome). Even with `--app=`, Edge frequently displays browser UI, address bars on navigation, profile sync banners, browser context menus ("Inspect", "Back"), and browser settings. It feels like a website running on localhost rather than professional streaming software.

### The Target Vision
BABA TTS must be a **true Windows desktop software application**:
1. When launched, it opens directly as a **native desktop application window** with its own window frame, dark-themed title bar, and system taskbar/tray integration.
2. **All configuration, monitoring, and controls** (Azure credentials, voices, YouTube channel/stream ID, live chat feed, speaking spotlight, audio playback, ban list, moderation actions, and quick controls) are hosted **inside this Windows software app window**.
3. The application **always exposes local browser endpoints** in the background:
   - `http://localhost:7060/overlay` (9:16 vertical broadcast overlay for OBS)
   - `http://localhost:7060/popup` (speaking spotlight overlay for OBS)
   - `http://localhost:7060/chat` (transparent scrolling chat history for OBS)
   - `ws://localhost:7060/ws` (real-time WebSocket broadcast)
4. Streamers only touch a browser when pasting the overlay URL into an OBS Browser Source once. They never configure or interact with BABA TTS through a browser.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Self-Contained Windows Software**: Single executable or dedicated desktop window running the complete BABA TTS UI without spawning external browser processes (`msedge.exe` / `chrome.exe`).
- **Persistent Local Endpoints**: Background Axum/WebSocket server runs continuously on `localhost:7060` (or dynamically selected port) so OBS Studio browser sources retain real-time connection.
- **Unified In-App Control**: All settings (Azure Speech API, voices, YouTube channel/stream ID, toggles), moderation (banning/unbanning), and live audio playback live inside the desktop software window.
- **OBS URL Generation & Copy**: In-app UI provides one-click copy buttons for `/overlay`, `/popup`, and `/chat` URLs with port auto-detection.
- **Window Lifecycle**: Support minimizing to system tray, restoring from tray, remembering window position/size, and clean shutdown on exit.
- **Audio Responsibility**: Audio playback strictly occurs inside the primary desktop application window, keeping OBS overlay endpoints visual-only to prevent echo/duplicate audio in stream output.

### Non-Goals
- Changing the OBS Browser Source architecture: OBS requires standard HTTP/WebSocket browser sources; we will not replace OBS browser sources with custom virtual camera/audio drivers.
- Replacing the core Rust TTS actor and YouTube poller engine: The existing high-performance actor model for Azure TTS synthesis and InnerTube chat scraping remains unchanged.

### Anti-Goals
- Spawning external browsers via `open::that()` or `std::process::Command::new("msedge")` for dashboard or settings.
- Adding browser navigation controls (address bars, forward/backward buttons, browser settings) into the desktop window.

---

## 3. Approaches Considered

### Approach 1: Native Rust Win32 WebView2 Host (Recommended)
Embed Microsoft Edge WebView2 directly inside a Win32 application window (`HWND`) created and managed by `baba-tts.exe`.
- **How it works**:
  - `src/main.rs` and `src/tray.rs` initialize a Win32 top-level application window using the existing `windows-sys` dependency and the Microsoft WebView2 controller (`ICoreWebView2Controller`).
  - The WebView2 control is hosted inside the client area of the window, pointing to the local embedded server (`http://localhost:{port}/`).
  - Context menus, status bars, and default browser accelerators are disabled via WebView2 settings to provide a clean, native app feel.
  - The window is owned directly by the `baba-tts` process; no external Edge or Chrome processes are spawned.
- **Pros**:
  - Lightweight: Maintains the single-binary architecture (~15MB release size).
  - Native integration with existing `tray.rs` and `native_prompt.rs` Win32 loops.
  - Windows 10 and 11 have Edge WebView2 pre-installed natively.
  - Retains all existing Rust backend modules (Axum server, TTS actor, YouTube poller, SQLite).
- **Cons**:
  - Requires linking with the WebView2 loader or calling `CreateCoreWebView2EnvironmentWithOptions` dynamically via COM.

### Approach 2: Electron Desktop Wrapper
Wrap the frontend and backend inside an Electron desktop shell.
- **How it works**:
  - Electron main process manages the native window, tray icon, and spawns/bundles the backend.
  - The React frontend is loaded directly into an Electron `BrowserWindow`.
  - Electron handles packaging into an `.exe` installer via `electron-builder`.
- **Pros**:
  - Easy cross-platform window management and mature ecosystem for desktop packaging.
- **Cons**:
  - Heavy footprint (~120–150MB binary, higher RAM consumption).
  - Replaces or duplicates the existing optimized Rust engine.

### Approach 3: Wry + Tao (Tauri Windowing Stack)
Use the Tauri ecosystem's windowing (`tao`) and webview (`wry`) libraries in Rust.
- **How it works**:
  - Replaces raw Win32 message loops with Tao's event loop and Wry's WebView builder.
- **Pros**:
  - Clean idiomatic Rust API for native windows.
- **Cons**:
  - In Linux/WSL cross-compilation environments, Tao and Wry require Linux GUI dependencies (`gtk3`, `webkit2gtk`) that complicate local checking without full desktop environments.

### Decision
**Approach 1 (Native Win32 WebView2 Controller embedded in Rust)** is selected. It builds directly upon the existing Rust architecture, avoids binary bloat, and delivers a true native Windows software experience with zero browser chrome.

---

## 4. Detailed Architectural Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                   BABA TTS - Native Windows Software                  │
├────────────────────────────────────────────────────────────────────────┤
│ [Top-Level Window: "BABA TTS - Streamer Control Panel"]               │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Embedded WebView2 Viewport (Client Area)                         │  │
│  │                                                                  │  │
│  │  Tabs: [ Live Monitor ] [ Moderation ] [ Settings ] [ OBS Overlays] │
│  │                                                                  │  │
│  │  • Live Monitor: Speaking spotlight, karaoke words, manual input  │  │
│  │  • Moderation: Active/Banned user lists, one-click ban/unban     │  │
│  │  • Settings: Azure Speech API key/region/voice, YouTube live IDs  │  │
│  │  • OBS Overlays: Copy buttons for /overlay, /popup, /chat URLs   │  │
│  │                                                                  │  │
│  │  • Plays TTS Audio natively (`useAppWebSocket(true)`)            │  │
│  │  • Sends AUDIO_FINISHED to advance TTS queue                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
          │
          │ Background Services (Axum + Tokio)
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Exposed Endpoints on http://localhost:7060/                            │
│                                                                        │
│  • /overlay ──▶ OBS Browser Source (9:16 vertical broadcast layout)    │
│  • /popup   ──▶ OBS Browser Source (transparent spotlight only)        │
│  • /chat    ──▶ OBS Browser Source (scrolling chat history)            │
│  • /ws      ──▶ Real-time WebSocket Event Bus                          │
│  • /api/*   ──▶ REST API for settings, ban management, BABA speech    │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Window Management & Behavior
1. **Window Creation**:
   - On startup, `baba-tts.exe` creates a top-level native window (e.g. 1200×800, centered on screen, minimum size 960×640).
   - Window Title: `BABA TTS - Streamer Control Panel`.
   - Window Icon: Embedded `assets/icon.ico`.
2. **WebView2 Configuration**:
   - Host `http://localhost:{port}/` in the client area.
   - Disable browser status bar (`AreBrowserAcceleratorKeysEnabled = FALSE`, `IsStatusBarEnabled = FALSE`).
   - Prevent default browser context menus (replace with app-relevant actions or clean view).
3. **Tray & Close Interactions**:
   - Clicking window Close [X] minimizes the application window to the Windows system tray rather than killing the server (preventing OBS overlay disconnection mid-stream).
   - Double-clicking the system tray icon or selecting "Open Dashboard" restores and focuses the window.
   - Right-click tray menu option "Exit" completely shuts down the server and window.

### 4.2 Endpoint Preservation for OBS
The Axum router continues serving all current routes:
- `/overlay`, `/popup`, `/chat`, `/`
- The React SPA differentiates between the desktop application and OBS sources:
  - If loaded on `/overlay`, `/popup`, or `/chat` (or `?overlay=...`), it renders the transparent OBS layouts and **disables audio playback**.
  - If loaded on `/` inside the desktop app, it renders the rich `DesktopApp` with full controls and **enables audio playback**.

### 4.3 Settings & State Persistence
- Settings (Azure Speech Key, Azure Region, Default Voice, YouTube Channel ID, Live Stream ID Override, Polling Enabled) are stored in SQLite (`baba.db`).
- Changes saved in the desktop app's Settings tab immediately update the active `AppSettings` in `TtsActor` and `YouTubePoller` without requiring process restart.

---

## 5. Implementation Roadmap

1. **Native Window Module (`src/window.rs`)**:
   - Implement Win32 window creation and WebView2 environment initialization.
   - Attach WebView2 controller to client `HWND`.
   - Handle window resizing (`WM_SIZE`), minimize-to-tray on close (`WM_CLOSE`), and restore.
2. **Tray Integration (`src/tray.rs`)**:
   - Update tray menu commands ("Open Dashboard", "Open Settings") to bring the native app window to the foreground rather than calling `open_desktop_app()` with Edge/Chrome.
3. **Application Orchestration (`src/main.rs`)**:
   - Launch Axum server in background Tokio task.
   - Initialize and display the native application window on startup.
   - Coordinate graceful shutdown across native window, tray, and server.
4. **Frontend Refinements (`frontend/src/`)**:
   - Ensure the in-app desktop UI has a streamlined header without web browser artifacts.
   - Highlight the dedicated "OBS Overlays" copy links so streamers can easily grab URLs for OBS.
5. **Testing & Verification**:
   - Verify server endpoints remain reachable on `http://localhost:7060/overlay` and `http://localhost:7060/chat`.
   - Verify settings save/load through the in-app UI.
   - Verify single-instance focus handling.

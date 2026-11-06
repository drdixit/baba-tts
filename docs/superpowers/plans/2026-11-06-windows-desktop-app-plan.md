# Native Windows Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform BABA TTS into a self-contained Windows desktop software application with an embedded native control panel and persistent background browser endpoints for OBS Studio.

**Architecture:** A native Win32/WebView2 application window owned by `baba-tts.exe` hosts the rich React management dashboard for settings, moderation, and live monitoring with zero browser chrome, while Axum runs concurrently in Tokio to serve persistent `/overlay`, `/popup`, `/chat`, and `/ws` endpoints for OBS Studio.

**Tech Stack:** Rust (axum, tokio, rusqlite, windows-sys), Microsoft Edge WebView2, React 19, TypeScript, Tailwind CSS, Vite.

**Spec:** [`docs/superpowers/specs/2026-11-06-windows-desktop-app-design.md`](file:///mnt/c/projects/baba-tts/docs/superpowers/specs/2026-11-06-windows-desktop-app-design.md)

## Global Constraints

- Never launch external browsers (`msedge.exe`, `chrome.exe`, or `open::that`) for the dashboard or settings UI.
- All OBS endpoints (`/overlay`, `/popup`, `/chat`, `/ws`) must remain accessible over HTTP/WebSocket on `localhost:7060`.
- The native desktop app window must play TTS audio (`playAudio=true`), while OBS overlay endpoints remain visual-only (`playAudio=false`).
- Minimize-to-tray on window close [X] must keep the server running so live stream overlays never disconnect.
- Non-Windows targets (`#[cfg(not(windows))]`) must compile and pass all tests cleanly without warnings.

## Review Focus

1. **Port conflicts & dynamic binding**: If port 7060 is occupied and the server binds to 7061, the native window must navigate to `http://localhost:7061/` and display the updated port.
2. **Audio duplicate prevention**: Loading OBS overlays in multiple browser sources must not play audio; only the primary desktop window plays audio and sends `AUDIO_FINISHED`.
3. **Window close vs server exit**: Streamer clicks window [X] expecting stream to continue; window must hide to tray, not terminate the process.
4. **Single-instance activation**: Launching a second `baba-tts.exe` must focus the existing native desktop window without launching a new window or browser tab.
5. **Offline/Restart resilience**: Restarting server or changing settings must immediately update active in-memory actor configuration without crashing the UI.

---

### Task 1: Native Window Management (`src/window.rs`)

**Files:**
- Create: `src/window.rs`
- Modify: `src/main.rs:1-25`
- Test: `src/window.rs` (unit tests for geometry, configuration, and non-Windows stubs)

**Interfaces:**
- Produces: `pub struct DesktopWindow`, `pub fn create_desktop_window(port: u16) -> Result<DesktopWindow>`, `pub fn focus_existing_window() -> bool`

- [ ] **Step 1: Write tests for DesktopWindow creation and window message handling**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_desktop_window_url_generation() {
        assert_eq!(format_window_url(7060), "http://localhost:7060/");
        assert_eq!(format_window_url(7080), "http://localhost:7080/");
    }

    #[test]
    fn test_desktop_window_dimensions() {
        let (width, height) = default_window_size();
        assert!(width >= 960);
        assert!(height >= 600);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_desktop_window -- --nocapture`
Expected: FAIL with "module `window` not found"

- [ ] **Step 3: Implement `src/window.rs` with Win32 WebView2 window creation and non-Windows stubs**

Implement:
- `format_window_url(port: u16) -> String`
- `default_window_size() -> (i32, i32)` (1200, 800)
- `#[cfg(windows)]` module:
  - Register window class `BabaTtsMainWindowClass`
  - Create native window with `WS_OVERLAPPEDWINDOW`, dark caption support, and custom icon
  - Attach WebView2 controller navigating to `http://localhost:{port}/`
  - Disable browser status bar, default context menus, and accelerator keys
  - Handle `WM_CLOSE` by hiding the window (`ShowWindow(hwnd, SW_HIDE)`)
  - Handle `WM_USER + 101` (`WM_USER_FOCUS_WINDOW`) to restore and bring to foreground
- `#[cfg(not(windows))]` module with safe stubs returning mock handle

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test test_desktop_window -- --nocapture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/window.rs src/main.rs
git commit -m "feat(window): add native win32 desktop window module with webview2 support"
```

---

### Task 2: Update System Tray Navigation & Hotkeys (`src/tray.rs`)

**Files:**
- Modify: `src/tray.rs:18-40, 100-115`
- Test: `src/tray.rs` (unit tests for tray command execution)

**Interfaces:**
- Consumes: `DesktopWindow` from `src/window.rs`
- Produces: Updated `TrayCommand::OpenDashboard` and `TrayCommand::OpenSettings` routing to native window focus instead of `msedge --app=`

- [ ] **Step 1: Write test for tray command execution without external process spawn**

Add test verifying `TrayCommand::OpenDashboard` triggers window restore/focus rather than external browser launch.

- [ ] **Step 2: Run test to verify status**

Run: `cargo test test_tray_command_execution -- --nocapture`
Expected: PASS/FAIL depending on current execution

- [ ] **Step 3: Update `src/tray.rs`**

- Remove process spawning of `msedge` and `chrome` in `open_desktop_app()`.
- Replace with `window::restore_and_focus_window(port)`.
- Keep tray menu items: "Open Dashboard" (shows window), "Open Settings" (shows window on settings tab), "Exit" (shuts down app).
- Double-clicking the tray icon restores the native window.

- [ ] **Step 4: Run tests to verify**

Run: `cargo test test_tray -- --nocapture`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tray.rs
git commit -m "refactor(tray): connect tray actions directly to native desktop window"
```

---

### Task 3: Application Orchestration & Single-Instance Focus (`src/main.rs`)

**Files:**
- Modify: `src/main.rs:25-140`
- Test: `src/main.rs` (integration tests)

**Interfaces:**
- Consumes: `create_desktop_window` from `src/window.rs`, `start_tray` from `src/tray.rs`
- Produces: Integrated desktop startup lifecycle

- [ ] **Step 1: Write test for single-instance signaling**

Test that when a single instance is already active, `focus_existing_window()` is invoked.

- [ ] **Step 2: Update `src/main.rs`**

- In `main()` step 1: If another instance exists, call `window::focus_existing_window()` and exit 0.
- In `main()` step 10: Replace `crate::tray::open_desktop_app(...)` with `crate::window::create_desktop_window(port)`.
- Ensure graceful shutdown coordinates the native window, tray loop, and Axum server.

- [ ] **Step 3: Run cargo check and tests**

Run: `cargo test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat(main): orchestrate native desktop window on launch with single-instance focus"
```

---

### Task 4: Frontend UI Refinements & OBS Overlays Guide (`frontend/src/`)

**Files:**
- Modify: `frontend/src/App.tsx:1-120`
- Modify: `frontend/src/components/SettingsPanel.tsx`
- Test: `frontend/src/App.test.tsx` or build verification

**Interfaces:**
- Consumes: REST API on `http://localhost:{port}/api/*` and WebSocket on `/ws`
- Produces: Polished in-app dashboard with dedicated OBS Overlays panel and one-click URL copy buttons

- [ ] **Step 1: Check frontend build**

Run: `cd frontend && npm run build`
Verify current clean build.

- [ ] **Step 2: Enhance DesktopApp UI**

- Streamline the desktop app window header with app branding ("BABA TTS") and live status pill ("Connected to Port 7060").
- In the "OBS Overlays" tab, provide distinct copy buttons with visual feedback:
  - **9:16 Full Broadcast Overlay** (`http://localhost:{port}/overlay`) — 1080×1920 layout
  - **Speaking Spotlight Only** (`http://localhost:{port}/popup`) — transparent popup
  - **Live Chat Stream Only** (`http://localhost:{port}/chat`) — transparent scrolling chat
- Ensure Settings panel has clear save confirmation and validation.

- [ ] **Step 3: Build frontend and verify embedded assets**

Run: `cd frontend && npm run build`
Expected: Successful Vite build into `frontend/dist/`.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): streamline desktop app layout with enhanced OBS overlay guides"
```

---

### Task 5: End-to-End Verification & Verification Suite

**Files:**
- Test: `tests/integration_tests.rs` or `src/server.rs` tests

- [ ] **Step 1: Run full Rust test suite**

Run: `cargo test`
Expected: All unit and integration tests pass (server routing, DB settings, spam filter, tray IDs, window geometry).

- [ ] **Step 2: Verify OBS endpoints return correct content**

Run test ensuring `/overlay`, `/popup`, `/chat` routes serve the embedded SPA index.html with 200 OK.

- [ ] **Step 3: Verify build**

Run: `cargo check`
Expected: Clean compilation with 0 warnings.

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore: complete native windows desktop app implementation"
```

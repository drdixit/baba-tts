# Specification: Integrated App Dashboard & Native Win32 dmenu Prompt

**Date**: 2026-11-04  
**Topic**: Unified Desktop App Settings & Native Win32 Floating Input Prompt

---

## 1. Goal & Requirements

1. **Unified In-App Settings & Controls**:
   - The primary dashboard (`/`) served by the embedded Axum server is the dedicated control application for the streamer.
   - All management controls (TTS skip, ban current, clear queue, test simulations, OBS URL copy buttons) and the **Settings panel** (Azure credentials, voices, YouTube live IDs) must live directly inside this app as a seamless view/tab, rather than forcing the user to navigate out to a separate web page.
   - The `/chat` endpoint remains the clean, transparent browser source strictly for OBS.

2. **Native Win32 dmenu-Style Floating Prompt**:
   - When the user presses Num 2 (`Speak as Banned User`) or Num 4 (`Speak as User / BABA`), or selects them from the Windows tray, the system must **not** launch Edge/Chrome or open a browser tab.
   - It must display an ultra-fast, native Win32 window configured with `WS_EX_TOPMOST | WS_EX_TOOLWINDOW`, styled like a dark `dmenu` / Raycast / PowerToys Run floating prompt centered on the active screen.
   - **Keyboard behavior**:
     - Automatically focused upon display.
     - Pressing **Enter**: Sends the typed text directly to `/api/baba-say` (for User) or `/api/speak-as-banned` (for Banned User), then hides immediately.
     - Pressing **Escape**: Immediately cancels and hides.
   - Non-Windows systems maintain safe fallback stubs without compilation warnings.

---

## 2. Architecture & Component Changes

### A. Frontend (`frontend/src/`)
- **`App.tsx`**:
  - Add view state: `activeTab: 'dashboard' | 'settings'`.
  - Header displays active navigation buttons to switch seamlessly between Stream Moderation & Settings without page reloads.
  - Embed the settings form directly into a dedicated view inside the main layout.
- **`main.tsx`**:
  - Clean up routes: retain `/` (App) and `/chat` (OBS Overlay).

### B. Rust Native Win32 Prompt (`src/native_prompt.rs` & `src/tray.rs`)
- Implement a Win32 window class with a dark background brush (`COLOR_WINDOW` or dark gray `RGB(20, 24, 33)`), modern edit box, and prompt label (`[BABA]:` or `[Banned User]:`).
- Subclass the edit control (`SetWindowSubclass` or custom window proc) to capture `VK_RETURN` (submit) and `VK_ESCAPE` (dismiss).
- Connect directly to the local port using `reqwest` or `AppState` channels to trigger TTS instantly.
- Triggered directly from tray hotkeys `HOTKEY_SPEAK_AS_BANNED` (Num 2) and `HOTKEY_SPEAK_AS_USER` (Num 4).

### C. Server Routes (`src/server.rs`)
- Keep `/api/baba-say` and `/api/speak-as-banned` fast and responsive for local calls.
- Static fallback serves the unified React SPA seamlessly.

---

## 3. Testing & Verification

- Unit tests for Win32 prompt lifecycle and tray IDs.
- Verifying compilation with `cargo clippy` and `cargo test`.
- Building frontend with `npm run build` and checking assets embedding.

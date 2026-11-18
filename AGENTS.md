# Agent Instructions & Guidelines for Baba TTS

## 1. Release Policy & Versioning Rule (MANDATORY)

> [!IMPORTANT]
> **Every release is a beta release by default.**  
> Unless the user explicitly and specifically asks for a "stable release", all releases and version bumps must be formatted as beta releases (e.g. `v0.0.1-beta`, `v0.0.2-beta`).
> - Never publish a stable tag (e.g. `v1.0.0`) or release without explicit user confirmation.
> - Ensure Git tags and GitHub releases match this `-beta` suffix pattern.
> - Historical tags should not accumulate obsolete versions unless explicitly desired.

---

## 2. Numpad Hotkeys & Quick Prompt Behavior

- **Physical Key Mapping & Pass-Through:** Hotkeys `Numpad 0` through `Numpad 5` (`0x60` to `0x65`) use a low-level keyboard hook (`WH_KEYBOARD_LL`) with `CallNextHookEx` so keystrokes pass through to active applications (e.g. Notepad, games) without being swallowed, while triggering Baba TTS actions: Numpad 0 (Clear Queue), Numpad 1 (Ban Current), Numpad 2 (Speak as Banned), Numpad 3 (Skip Current), Numpad 4 (Speak as User), and Numpad 5 (Toggle Mute/Unmute mid-speech). Typematic auto-repeats are filtered via atomic key-down masks (`MOD_NOREPEAT` behavior), and modifier chords (Ctrl, Alt, Win) pass through untouched to preserve external application hotkeys.
- **Input Hotkey Suspension:** Whenever the floating prompt input window is opened (`WM_SHOW_PROMPT`), global hotkeys must be paused via `crate::tray::pause_hotkeys()`. Hotkeys must resume via `crate::tray::resume_hotkeys()` when the prompt is hidden, submitted (`VK_RETURN`), cancelled (`VK_ESCAPE`), or deactivated (`WM_ACTIVATE` / `WM_KILLFOCUS`).
- **Foreground Focus & UIPI:** Cross-thread focus handoff between the tray worker and the prompt window must allow foreground transitions (`AllowSetForegroundWindow(ASFW_ANY)`). If `SetForegroundWindow` is blocked by Windows UIPI, an Alt-key tap event (`keybd_event(VK_MENU)`) bypasses the restriction.

---

## 3. Core Architecture & Audio Pipeline

- **Dual-Engine Speech Synthesis & Native Playback:** Primary synthesis uses Azure Speech with local Windows SAPI5 (`ISpVoice`) fallback. Speech audio renders through a dedicated native WASAPI audio worker (`rodio`), guaranteeing session attribution to `baba-tts.exe` for clean OBS Application Audio Capture, real-time master volume attenuation, and mid-speech mute/unmute toggling. A loop guard (`is_fallback: bool`) ensures synthesis errors do not enter recursive fallback loops.
- **SQLite Database Path:** The database must never open relative to the current working directory (`baba.db`). It must always resolve to an explicit user application data path (e.g. `%APPDATA%/baba-tts/baba.db`) to avoid crashes when run from protected directories.
- **Single Instance:** Enforced using system mutex locking to prevent multiple overlapping tray or audio listeners.
- **Embedded Frontend:** The React 19 + Tailwind CSS dashboard is embedded into the binary at compile time via `rust-embed`.

---

## 4. Build & Distribution

- **Windows Cross-Compilation:** Built using `cargo-xwin` targeting `x86_64-pc-windows-msvc`.
- **Portable Distribution Archive:** Packaged in `dist/baba-tts-portable.zip` containing:
  - `baba-tts.exe`
  - `WebView2Loader.dll` (from `assets/x64/`)
  - `icon.ico` (official Baba mascot icon)
  - `README.md`
- **Checksums:** Verified with `SHA256SUMS.txt`.

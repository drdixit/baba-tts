# Native Win32 Bottom-Left Prompt & Single 9:16 Overlay Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Windows bottom-left floating always-on-top input prompt, integrate all controls and settings inside the desktop application, and streamline web routing so only a single 9:16 aspect ratio speaking animation overlay (`/chat`) is exposed externally for OBS.

**Architecture:** 
- In the Rust backend, create a dedicated Win32 native window module (`src/native_prompt.rs`) that creates an always-on-top, borderless dark-themed floating input window at the bottom-left of the screen (`WS_EX_TOPMOST | WS_EX_TOOLWINDOW`). It captures hotkeys (Num 2 for Banned User, Num 4 for Streamer/User), captures typing, auto-submits on Enter to the internal TTS queue/API, and dismisses on Esc.
- In the React frontend, make `/` the all-in-one desktop control app containing simulate buttons, spam test buttons, moderation controls, and settings form, while `/chat` is the single clean 9:16 vertical speaking overlay for OBS. Deprecate separate `/settings` and `/popup` routes.

**Tech Stack:** Rust (axum, windows-sys, tokio), React 19, Tailwind CSS, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-04-integrated-app-and-native-dmenu-prompt.md`

## Global Constraints
- Native prompt must appear at the bottom-left of the primary work area (above taskbar).
- Native prompt must be `WS_EX_TOPMOST` and never open a web browser.
- External web route for OBS must be strictly 9:16 portrait layout showing speaking avatars and word-level animated subtitles.
- Cross-platform build on Linux/WSL must compile cleanly without dead-code or missing-symbol warnings.

## Review Focus
- Hitting hotkey multiple times while window is open: must refocus and select text instead of spawning duplicate windows.
- Pressing Escape in the edit control: must dismiss the window immediately without submitting.
- Pressing Enter with empty or whitespace-only text: must dismiss without enqueuing empty TTS audio.
- Screen resolution / work area bounds: must calculate bottom-left positioning using `SystemParametersInfoW(SPI_GETWORKAREA)` so it does not overlap the Windows taskbar.
- Non-Windows execution: must compile with graceful mock/stub implementations.

---

### Task 1: Native Win32 Bottom-Left Floating Input Window

**Files:**
- Create: `src/native_prompt.rs`
- Modify: `src/main.rs`
- Modify: `src/tray.rs`
- Modify: `Cargo.toml`

**Interfaces:**
- Produces: `pub fn show_native_prompt(port: u16, mode: PromptMode)`
- Enum: `pub enum PromptMode { User, Banned }`

- [ ] **Step 1: Write unit tests for PromptMode and geometry positioning**
Add test module in `src/native_prompt.rs` testing geometry calculations and mode conversion.

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test native_prompt`
Expected: FAIL (module not defined).

- [ ] **Step 3: Implement `src/native_prompt.rs`**
Implement Win32 window creation using `windows-sys`:
- Class name: `"BabaNativePromptClass"`
- Window styles: `WS_POPUP | WS_VISIBLE`, Extended styles: `WS_EX_TOPMOST | WS_EX_TOOLWINDOW`
- Positioning: Query `SPI_GETWORKAREA` to get bottom-left coordinates (`x = workarea.left + 24`, `y = workarea.bottom - height - 24`, width = 480, height = 48).
- Dark styling with custom edit control subclass or message hook capturing `VK_RETURN` and `VK_ESCAPE`.
- On `VK_RETURN`: Fetch the text, dispatch HTTP POST to `http://127.0.0.1:{port}/api/baba-say` (mode User) or `/api/speak-as-banned` (mode Banned), then hide window.
- On `VK_ESCAPE`: Hide window.

- [ ] **Step 4: Wire `show_native_prompt` to Hotkeys and Tray commands in `src/tray.rs`**
Replace `open_popup_window` browser calls with `show_native_prompt(port, mode)` when Num 2 or Num 4 is pressed or selected from tray menu.

- [ ] **Step 5: Run tests and clippy**
Run: `cargo clippy && cargo test`
Expected: PASS with 0 warnings.

- [ ] **Step 6: Commit**
```bash
git add src/native_prompt.rs src/tray.rs src/main.rs Cargo.toml
git commit -m "feat(tray): add native win32 bottom-left floating prompt for tts input"
```

---

### Task 2: Streamline Frontend Routes to Single 9:16 OBS Overlay & In-App Settings

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/ChatPage.tsx`
- Delete: `frontend/src/QuickInputPopupPage.tsx`

**Interfaces:**
- Consumes: `/api/settings`, `/api/info`, `/api/baba-say`, `/ws`
- Routes exposed: `/` (Desktop App Hub), `/chat` (9:16 OBS Overlay)

- [ ] **Step 1: Update `ChatPage.tsx` to enforce 9:16 portrait aspect ratio**
Ensure container layout strictly formats as 9:16 (e.g. `w-[1080px] h-[1920px]` or responsive `aspect-[9/16]`) with transparent background, displaying only active speaker avatar and animated subtitles for OBS Browser Source.

- [ ] **Step 2: Integrate Settings directly into `App.tsx`**
Add tab state (`dashboard` vs `settings`) in `App.tsx` so users can configure Azure TTS and YouTube credentials directly within the desktop application interface without opening external web pages.
Ensure all action buttons (Simulate Normal, Simulate Spam, Skip, Ban, Clear Queue) remain directly accessible in the desktop app.

- [ ] **Step 3: Update `main.tsx` routing**
Remove `/settings` and `/popup` routes. Retain `/` and `/chat`.

- [ ] **Step 4: Build frontend and verify**
Run: `npm --prefix frontend run build`
Expected: Build succeeds and outputs to `frontend/dist/`.

- [ ] **Step 5: Run Rust backend test suite**
Run: `cargo test`
Expected: All 13 tests pass.

- [ ] **Step 6: Commit**
```bash
git add frontend/ src/server.rs
git commit -m "feat(ui): unify desktop app with in-app settings and single 9:16 obs overlay"
```

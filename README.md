# BABA TTS

BABA TTS is a high-performance Windows desktop application for multi-platform live chat moderation (YouTube Live, Facebook Live, and Instagram Live) and dual-engine text-to-speech (Azure Speech Neural TTS with Windows SAPI5 fallback).

The application backend, system tray, low-level keyboard hooks, audio pipeline, and local HTTP/WebSocket service are written in Rust. The React 19 + Tailwind CSS frontend is compiled into static assets and embedded directly into the standalone Windows executable (`baba-tts.exe`) via `rust-embed`; it is not a separate runtime server.

---

## Multi-Platform Chat & Bring Your Own Token (BYOT) Architecture

Baba TTS is built with a 100% local, offline-first philosophy: **zero external relay servers, zero middleman databases, and zero recurring subscription fees**.

All live chat connections, moderation heuristics, audio rendering, and token stores run strictly on your local machine. To connect to Meta's platforms (Facebook Live and Instagram Live), Baba TTS uses a **Bring Your Own Token** model:

- **100% Free & Direct:** Meta Graph API is free with no per-request charges. Baba TTS connects directly from your PC to Meta's endpoints over HTTPS.
- **Data Privacy & Security:** Your tokens, user IDs, and moderation rules are stored locally in `%APPDATA%/baba-tts/baba.db` and never leave your machine.
- **Independent Async Polling:** Each platform (YouTube, Facebook, Instagram) operates in an isolated Tokio background task. A network glitch or rate-limit throttle on one platform never affects the others.
- **Adaptive Backoff & Backlog Protection:** Both Facebook and Instagram pollers dynamically parse Meta rate limit headers (`X-App-Usage`, `X-Page-Usage`) and adapt polling cadence (3.5s normal, throttled to 10s–30s under load). Cold-start backlog watermarks prevent speech queue flooding when starting or reconnecting.
- **Multi-Platform Badges:** Chat history and spotlight displays distinguish platforms with visual badges (`[YT]`, `[FB]`, `[IG]`).

---

### Step-by-Step: Setting Up Bring Your Own Token (BYOT)

#### 1. Facebook Live Setup
Stream comments from your personal Facebook profile timeline (with Professional Mode enabled) or your Facebook Page.

1. **Create a Free Developer App:**
   - Go to [developers.facebook.com](https://developers.facebook.com/) and register or log in.
   - Click **My Apps** > **Create App**, select **Other** > **Business** (or consumer).
2. **Generate Your Access Token:**
   - Open the **[Graph API Explorer](https://developers.facebook.com/tools/explorer/)**.
   - Under **Meta App**, select your app.
   - Add permissions:
     - For Facebook Pages: `pages_read_engagement`, `pages_show_list`.
     - For Personal Timeline (Professional Mode): `user_videos`, `public_profile`.
   - Click **Generate Access Token** and approve the authorization prompt.
   - *(Recommended)* Convert to a 60-day Long-Lived Token using the Access Token Tool, or create a System User in Meta Business Suite for a permanent token.
3. **Configure Baba TTS:**
   - Open Baba TTS Settings.
   - In **Facebook Live Chat (Bring Your Own Token)**:
     - Check **Enabled**.
     - Paste your token into **Access Token**.
     - Set **Target ID**: Enter `me` for personal timeline streaming, or your numeric Page ID.
     - Leave **Live video ID** blank (Baba TTS automatically discovers your active broadcast).
     - Click **Test** to verify connection.

#### 2. Instagram Live Setup
Stream comments from your Instagram Live broadcasts directly through the Instagram Graph API.

1. **Verify Account Type:**
   - Ensure your Instagram account is set to a **Professional Account** (Creator or Business) in Instagram app settings.
2. **Generate Your Instagram Access Token:**
   - In the Meta Developer Portal or Graph API Explorer, select your app.
   - Add the `instagram_basic` permission.
   - Generate your User Access Token.
3. **Retrieve Your Instagram User ID:**
   - In Graph API Explorer, query `GET me?fields=id,name` (or `GET me/accounts` to find your connected Instagram business account ID).
4. **Configure Baba TTS:**
   - In Baba TTS Settings:
     - Check **Enabled** under **Instagram Live Chat (Bring Your Own Token)**.
     - Paste your token into **Access Token**.
     - Enter your numeric **Instagram User ID**.
     - Leave **Live media ID** blank for automatic broadcast detection.
     - Click **Test** to verify connection.

> [!NOTE]
> If a 60-day Meta token expires (OAuth code 190), Baba TTS notifies you on the dashboard via WebSocket and pauses the poller until you paste an updated token.

---

## Build the Windows app

Install Rust, Node.js with npm, and the Microsoft WebView2 Runtime. From the repository root, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
```

The script installs the frontend's locked dependencies, builds `frontend/dist`, then builds the Rust release executable. The result is `target/release/baba-tts.exe`.

To run the steps manually:

```powershell
npm ci --prefix frontend
npm run build --prefix frontend
cargo build --release
```

Cargo requires `frontend/dist/index.html` because those assets are embedded in the executable. If it is missing, the build stops with instructions to build the frontend first.

## Local development

Run the Rust service and the Vite frontend in separate terminals:

```powershell
cargo run
```

```powershell
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open `http://127.0.0.1:7061` for the Vite development UI. Vite proxies API and WebSocket requests to the Rust server on port 7060. If you choose another port, set `BABA_TTS_PORT` in the repository `.env` file; both Rust and Vite use that value. The allowed range is 7060–7100.

## Local configuration and data

Copy `.env.example` to `.env` to provide optional startup defaults. Settings and moderation data are stored in the local `baba.db` SQLite database. Keep `.env` and database files out of version control.

The Rust source is in `src/`, the Windows icon and WebView2 loader DLLs are in `assets/`, and frontend source/build tooling is in `frontend/`.

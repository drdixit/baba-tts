# BABA TTS

BABA TTS is a Windows desktop app for YouTube Live chat moderation and Azure Speech text-to-speech. The application backend, tray, hotkeys, and local HTTP/WebSocket service are Rust. The React frontend is built into static assets and embedded in the Rust executable; it is not a separate runtime server.

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

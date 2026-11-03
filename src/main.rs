mod azure_tts;
mod colors;
mod db;
mod server;
mod spam_filter;
mod tray;
mod tts_queue;
mod types;
mod ws;
mod youtube;

use crate::db::Db;
use crate::server::{create_router, AppState};
use crate::spam_filter::SpamFilter;
use crate::tts_queue::{TtsActor, WsBroadcastMessage};
use crate::youtube::YouTubePoller;
use anyhow::{Context, Result};
use single_instance::SingleInstance;
use std::net::SocketAddr;
use tokio::sync::broadcast;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // 1. Single-Instance Enforcement
    let instance = SingleInstance::new("baba-tts-singleton-lock")
        .map_err(|e| anyhow::anyhow!("Failed to check single instance lock: {}", e))?;

    if !instance.is_single() {
        eprintln!("[BABA TTS] Another instance is already running! Focusing existing instance in browser...");
        let _ = open::that("http://localhost:7060");
        std::process::exit(0);
    }

    // 2. Logging & Environment
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,baba_tts=debug".into()),
        )
        .init();

    dotenvy::dotenv().ok();

    info!("╔═════════════════════════════════════════════════╗");
    info!("║             BABA TTS - Rust Edition             ║");
    info!("╚═════════════════════════════════════════════════╝");

    // 3. Database
    let db = Db::open("baba.db")?;
    let settings = db.load_settings()?;
    info!("Database initialized: baba.db");
    info!("Active YouTube Channel: {}", settings.youtube_channel_id);
    info!("Active Azure Region: {}", settings.azure_speech_region);

    // 4. Concurrency Primitives
    let (broadcast_tx, _) = broadcast::channel::<WsBroadcastMessage>(100);
    let tts_handle = TtsActor::spawn(broadcast_tx.clone(), settings.clone());
    let spam_filter = SpamFilter::new();

    // 5. YouTube Poller
    let (youtube_poller, _stop_signal) = YouTubePoller::new(
        db.clone(),
        spam_filter,
        tts_handle.clone(),
        broadcast_tx.clone(),
    );
    youtube_poller.start();

    // 6. Concurrency & Graceful Shutdown Signaling
    let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);
    let port = 7060;

    // 7. System Tray (Windows Native / Resilient to Explorer restarts)
    let _tray_handle = crate::tray::start_tray(tts_handle.clone(), shutdown_tx, port);

    // 8. Embedded Axum Web Server & WebSockets
    let state = AppState {
        db,
        tts_handle,
        broadcast_tx,
    };

    let router = create_router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("Failed to bind server to port {}", port))?;

    info!("✓ Server running on http://localhost:{}", port);
    info!("  • OBS Chat Overlay:    http://localhost:{}/chat", port);
    info!("  • OBS Moderation Dock: http://localhost:{}/", port);
    info!("  • Settings API:        http://localhost:{}/api/settings", port);

    // 9. Run Server with Graceful Shutdown
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal(shutdown_rx))
        .await
        .context("Server error")?;

    info!("BABA TTS shutdown complete.");
    Ok(())
}

async fn shutdown_signal(mut shutdown_rx: tokio::sync::mpsc::Receiver<()>) {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
        _ = shutdown_rx.recv() => {
            info!("[Tray] Exit requested from system tray.");
        },
    }

    info!("Shutdown signal received, shutting down gracefully...");
}

#![cfg_attr(all(not(test), target_os = "windows"), windows_subsystem = "windows")]

mod azure_tts;
mod colors;
mod db;
mod native_prompt;
mod server;
mod spam_filter;
mod tray;
mod tts_queue;
mod types;
mod ws;
mod window;
mod youtube;

#[allow(unused_imports)]
pub use window::{create_desktop_window, focus_existing_window, DesktopWindow};

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

pub fn enforce_single_instance(instance: &SingleInstance) -> bool {
    if !instance.is_single() {
        eprintln!("[BABA TTS] Another instance is already running! Focusing existing window...");
        crate::window::restore_and_focus_window(7060);
        return false;
    }
    true
}

#[cfg(windows)]
unsafe fn attach_parent_console() {
    let kernel32 = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(
        [b'k' as u16, b'e' as u16, b'r' as u16, b'n' as u16, b'e' as u16, b'l' as u16, b'3' as u16, b'2' as u16, b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0].as_ptr()
    );
    if kernel32 != 0 {
        let proc = windows_sys::Win32::System::LibraryLoader::GetProcAddress(kernel32, b"AttachConsole\0".as_ptr());
        if let Some(attach_fn) = proc {
            type AttachConsoleFn = unsafe extern "system" fn(u32) -> i32;
            let func: AttachConsoleFn = std::mem::transmute(attach_fn);
            func(u32::MAX); // ATTACH_PARENT_PROCESS
        }
    }
}

#[cfg(windows)]
unsafe fn enable_dpi_awareness() {
    let user32 = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(
        [b'u' as u16, b's' as u16, b'e' as u16, b'r' as u16, b'3' as u16, b'2' as u16, b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0].as_ptr()
    );
    // 1. Try SetProcessDpiAwarenessContext (Windows 10 1703+) -> DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
    if user32 != 0 {
        let set_ctx = windows_sys::Win32::System::LibraryLoader::GetProcAddress(
            user32,
            b"SetProcessDpiAwarenessContext\0".as_ptr(),
        );
        if let Some(set_ctx_fn) = set_ctx {
            type SetProcessDpiAwarenessContextFn = unsafe extern "system" fn(isize) -> i32;
            let func: SetProcessDpiAwarenessContextFn = std::mem::transmute(set_ctx_fn);
            if func(-4) != 0 {
                return;
            }
        }
    }

    // 2. Try SetProcessDpiAwareness in shcore.dll (Windows 8.1+) -> PROCESS_PER_MONITOR_DPI_AWARE (2)
    let shcore = windows_sys::Win32::System::LibraryLoader::LoadLibraryW(
        [b's' as u16, b'h' as u16, b'c' as u16, b'o' as u16, b'r' as u16, b'e' as u16, b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0].as_ptr()
    );
    if shcore != 0 {
        let set_aware = windows_sys::Win32::System::LibraryLoader::GetProcAddress(
            shcore,
            b"SetProcessDpiAwareness\0".as_ptr(),
        );
        if let Some(set_aware_fn) = set_aware {
            type SetProcessDpiAwarenessFn = unsafe extern "system" fn(u32) -> i32;
            let func: SetProcessDpiAwarenessFn = std::mem::transmute(set_aware_fn);
            if func(2 /* PROCESS_PER_MONITOR_DPI_AWARE */) == 0 {
                return;
            }
        }
    }

    // 3. Fallback to SetProcessDPIAware in user32.dll (Windows Vista+)
    if user32 != 0 {
        let set_aware_legacy = windows_sys::Win32::System::LibraryLoader::GetProcAddress(
            user32,
            b"SetProcessDPIAware\0".as_ptr(),
        );
        if let Some(set_aware_legacy_fn) = set_aware_legacy {
            type SetProcessDPIAwareFn = unsafe extern "system" fn() -> i32;
            let func: SetProcessDPIAwareFn = std::mem::transmute(set_aware_legacy_fn);
            let _ = func();
        }
    }
}

#[tokio::main]
async fn main() {
    #[cfg(windows)]
    unsafe {
        attach_parent_console();
        enable_dpi_awareness();
    }

    std::panic::set_hook(Box::new(|panic_info| {
        let err_msg = format!("BABA TTS encountered an unexpected panic:\n\n{}", panic_info);
        eprintln!("{}", err_msg);
        #[cfg(windows)]
        unsafe {
            use std::os::windows::ffi::OsStrExt;
            let to_wide = |s: &str| -> Vec<u16> {
                std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
            };
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                0,
                to_wide(&err_msg).as_ptr(),
                to_wide("BABA TTS - Error").as_ptr(),
                windows_sys::Win32::UI::WindowsAndMessaging::MB_OK | windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
            );
        }
    }));

    if let Err(e) = real_main().await {
        eprintln!("[BABA TTS] Fatal error: {:?}", e);
        #[cfg(windows)]
        unsafe {
            use std::os::windows::ffi::OsStrExt;
            let to_wide = |s: &str| -> Vec<u16> {
                std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
            };
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                0,
                to_wide(&format!("BABA TTS failed to start:\n\n{:?}", e)).as_ptr(),
                to_wide("BABA TTS - Startup Error").as_ptr(),
                windows_sys::Win32::UI::WindowsAndMessaging::MB_OK | windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
            );
        }
        std::process::exit(1);
    }
}

async fn real_main() -> Result<()> {
    let is_restarting = std::env::args().any(|a| a == "--restarting");

    // 1. Single-Instance Enforcement
    let _instance = if is_restarting {
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(6);
        let mut acquired = None;
        while start.elapsed() < timeout {
            if let Ok(inst) = SingleInstance::new("baba-tts-singleton-lock") {
                if inst.is_single() {
                    acquired = Some(inst);
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        match acquired {
            Some(inst) => inst,
            None => {
                eprintln!("[BABA TTS] Restart timed out waiting for prior instance to exit.");
                std::process::exit(1);
            }
        }
    } else {
        let inst = SingleInstance::new("baba-tts-singleton-lock")
            .map_err(|e| anyhow::anyhow!("Failed to check single instance lock: {}", e))?;
        if !enforce_single_instance(&inst) {
            std::process::exit(0);
        }
        inst
    };

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

    // 6. Dynamic Port Selection & Server Binding
    // Default to port 7060. If restarting, allow port 7060 a few seconds to release TIME_WAIT.
    let mut port = 7060;
    let bind_start = std::time::Instant::now();
    let listener = loop {
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => break l,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                if is_restarting && port == 7060 && bind_start.elapsed() < std::time::Duration::from_secs(5) {
                    tracing::info!("Waiting for port 7060 to release after restart...");
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    continue;
                }
                tracing::warn!("Port {} in use, trying next port {}", port, port + 1);
                port += 1;
                if port > 7100 {
                    return Err(anyhow::anyhow!("Could not find available port in range 7060-7100"));
                }
            }
            Err(e) => return Err(e).context(format!("Failed to bind server to port {}", port)),
        }
    };
    let _ = db.set_setting("active_port", &port.to_string());

    // 7. Concurrency & Graceful Shutdown Signaling
    let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);

    // 8. System Tray & Native Prompt (Windows Native / Resilient to Explorer restarts)
    crate::native_prompt::init_runtime_handle(tokio::runtime::Handle::current());
    let _tray_handle = crate::tray::start_tray(tts_handle.clone(), shutdown_tx.clone(), port);

    // 9. Embedded Axum Web Server & WebSockets
    let state = AppState {
        db,
        tts_handle,
        broadcast_tx,
        shutdown_tx,
        port,
    };

    let router = create_router(state);

    info!("✓ Server running on http://localhost:{}", port);
    info!("  • OBS Chat Overlay:    http://localhost:{}/chat", port);
    info!("  • OBS Moderation Dock: http://localhost:{}/", port);
    info!("  • Settings API:        http://localhost:{}/api/settings", port);

    // 10. Automatically open Dashboard in native desktop window on launch
    let _desktop_window = crate::window::create_desktop_window(port);

    // 11. Run Server with Graceful Shutdown
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_instance_first_instance_allowed() {
        let lock_name = format!("baba-tts-test-lock-{}", uuid::Uuid::new_v4());
        {
            let instance = SingleInstance::new(&lock_name).unwrap();
            assert!(enforce_single_instance(&instance));
        }
        let _ = std::fs::remove_file(&lock_name);
    }

    #[test]
    fn test_single_instance_second_instance_signals_and_denied() {
        let lock_name = format!("baba-tts-test-lock-{}", uuid::Uuid::new_v4());
        {
            let first_instance = SingleInstance::new(&lock_name).unwrap();
            assert!(first_instance.is_single());

            let second_instance = SingleInstance::new(&lock_name).unwrap();
            assert!(!second_instance.is_single());

            let allowed = enforce_single_instance(&second_instance);
            assert!(!allowed);
        }
        let _ = std::fs::remove_file(&lock_name);
    }

    #[test]
    fn test_desktop_window_creation_and_shutdown() {
        let window = crate::window::create_desktop_window(7060);
        assert!(window.is_ok());
        drop(window);
    }

    #[test]
    fn test_main_no_open_desktop_app_references() {
        let main_source = include_str!("main.rs");
        let non_test_code = main_source.split("mod tests").next().unwrap_or(main_source);
        let forbidden = ["open", "_desktop", "_app"].concat();
        assert!(
            !non_test_code.contains(&forbidden),
            "main.rs must not contain any calls to deprecated helper"
        );
    }

    #[tokio::test]
    async fn test_port_fallback_when_in_use() {
        let initial_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let occupied_port = initial_listener.local_addr().unwrap().port();

        let mut try_port = occupied_port;
        let (found_listener, bound_port) = loop {
            let addr = SocketAddr::from(([127, 0, 0, 1], try_port));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => break (l, try_port),
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                    try_port += 1;
                }
                Err(e) => panic!("Unexpected error: {}", e),
            }
        };

        assert!(bound_port > occupied_port);
        assert_eq!(found_listener.local_addr().unwrap().port(), bound_port);
    }
}

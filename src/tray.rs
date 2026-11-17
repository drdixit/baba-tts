use crate::tts_queue::TtsHandle;
use tokio::sync::mpsc::Sender;

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayCommand {
    OpenDashboard,
    OpenSettings,
    OpenObs,
    SkipCurrent,
    BanCurrent,
    SpeakAsBanned,
    SpeakAsUser,
    ClearQueue,
    RestartServer,
    Exit,
}


pub fn restart_process() {
    tracing::info!("Initiating process restart...");
    if !cfg!(test) {
        if let Ok(exe) = std::env::current_exe() {
        let exe_str = exe.to_string_lossy().to_string();
        #[cfg(target_os = "windows")]
        let pid = std::process::id();
        #[cfg(target_os = "windows")]
        {
            // First attempt: use powershell to wait for current PID to exit, then launch with --restarting
            let ps_script = format!(
                "Wait-Process -Id {} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400; Start-Process -FilePath '{}' -ArgumentList '--restarting'",
                pid,
                exe_str.replace('\'', "''")
            );
            let spawned = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_script])
                .spawn();

            if spawned.is_err() {
                // Fallback: use cmd with timeout delay
                let _ = std::process::Command::new("cmd")
                    .args(["/C", &format!("ping 127.0.0.1 -n 3 > nul && start \"\" \"{}\" --restarting", exe_str)])
                    .spawn();
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("sh")
                .args(["-c", "sleep 0.8 && \"$0\" --restarting &", &exe_str])
                .spawn();
        }
    }
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
impl TrayCommand {
    pub fn from_id(id: usize) -> Option<Self> {
        match id {
            1001 => Some(Self::OpenDashboard),
            1002 => Some(Self::OpenSettings),
            1003 => Some(Self::OpenObs),
            1004 => Some(Self::SkipCurrent),
            1005 => Some(Self::BanCurrent),
            1006 => Some(Self::SpeakAsBanned),
            1007 => Some(Self::SpeakAsUser),
            1008 => Some(Self::ClearQueue),
            1009 => Some(Self::RestartServer),
            1010 => Some(Self::Exit),
            _ => None,
        }
    }

    pub fn to_id(self) -> usize {
        match self {
            Self::OpenDashboard => 1001,
            Self::OpenSettings => 1002,
            Self::OpenObs => 1003,
            Self::SkipCurrent => 1004,
            Self::BanCurrent => 1005,
            Self::SpeakAsBanned => 1006,
            Self::SpeakAsUser => 1007,
            Self::ClearQueue => 1008,
            Self::RestartServer => 1009,
            Self::Exit => 1010,
        }
    }

    pub fn execute(
        &self,
        port: u16,
        tts_handle: &TtsHandle,
        shutdown_tx: &Sender<()>,
        runtime: &tokio::runtime::Handle,
    ) {
        match self {
            Self::OpenDashboard => {
                crate::window::restore_and_focus_window(port);
            }
            Self::OpenSettings => {
                crate::window::restore_and_focus_window(port);
            }
            Self::OpenObs => {
                let url = format!("http://127.0.0.1:{}/chat", port);
                let _ = open::that(&url);
            }
            Self::SkipCurrent => {
                let handle = tts_handle.clone();
                runtime.spawn(async move {
                    handle.skip_current().await;
                });
            }
            Self::BanCurrent => {
                let url = format!("http://127.0.0.1:{}/api/skip-ban-current", port);
                runtime.spawn(async move {
                    let client = reqwest::Client::new();
                    let _ = client.post(&url).send().await;
                });
            }
            Self::SpeakAsBanned => {
                crate::native_prompt::show_native_prompt(port, crate::native_prompt::PromptMode::Banned);
            }
            Self::SpeakAsUser => {
                crate::native_prompt::show_native_prompt(port, crate::native_prompt::PromptMode::User);
            }
            Self::ClearQueue => {
                let handle = tts_handle.clone();
                runtime.spawn(async move {
                    handle.clear_queue().await;
                });
            }
            Self::RestartServer => {
                let tx = shutdown_tx.clone();
                runtime.spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    restart_process();
                    let _ = tx.try_send(());
                });
            }
            Self::Exit => {
                let _ = shutdown_tx.try_send(());
            }
        }
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn format_tray_tooltip(port: u16) -> String {
    format!("BABA TTS (Port {})", port)
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::mpsc::sync_channel;
    use tracing::{error, info, warn};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    };
    use windows_sys::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
        DispatchMessageW, GetCursorPos, GetMessageW, GetWindowLongPtrW, LoadIconW, LoadImageW,
        PostMessageW, PostQuitMessage, RegisterClassW, RegisterWindowMessageW, SetForegroundWindow,
        SetWindowLongPtrW, TrackPopupMenu, TranslateMessage, CREATESTRUCTW, GWLP_USERDATA,
        IDI_APPLICATION, IMAGE_ICON, LR_LOADFROMFILE, MF_SEPARATOR, MF_STRING, MSG,
        TPM_BOTTOMALIGN, TPM_RIGHTBUTTON, WM_CLOSE, WM_COMMAND, WM_CREATE, WM_DESTROY,
        WM_LBUTTONDBLCLK, WM_LBUTTONUP, WM_NCDESTROY, WM_NULL, WM_RBUTTONUP, WM_USER, WNDCLASSW,
        WS_EX_TOOLWINDOW, WS_POPUP,
    };

    const WM_USER_TRAY: u32 = WM_USER + 100;
    const WM_HOTKEY: u32 = 0x0312;
    const HOTKEY_BAN_CURRENT: i32 = 2001;
    const HOTKEY_SPEAK_AS_BANNED: i32 = 2002;
    const HOTKEY_SKIP_CURRENT: i32 = 2003;
    const HOTKEY_CLEAR_QUEUE: i32 = 2004;
    const HOTKEY_SPEAK_AS_USER: i32 = 2005;

    struct TrayState {
        port: u16,
        tts_handle: TtsHandle,
        shutdown_tx: Sender<()>,
        runtime: tokio::runtime::Handle,
        taskbar_created_msg: u32,
        nid: NOTIFYICONDATAW,
    }

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe fn load_icon() -> windows_sys::Win32::UI::WindowsAndMessaging::HICON {
        // 1. Try loading from assets/icon.ico on disk if running from repository
        let icon_path = "assets/icon.ico";
        if std::path::Path::new(icon_path).exists() {
            let wide_path = to_wide(icon_path);
            let handle = LoadImageW(
                0,
                wide_path.as_ptr(),
                IMAGE_ICON,
                32,
                32,
                LR_LOADFROMFILE,
            );
            if handle != 0 {
                return handle as _;
            }
        }

        // 2. Try loading embedded PE resource compiled via winres (Resource ID 1)
        let h_inst = GetModuleHandleW(std::ptr::null());
        let res_icon = LoadIconW(h_inst, 1 as _);
        if res_icon != 0 {
            return res_icon;
        }

        // 3. Fallback to standard application icon
        LoadIconW(0, IDI_APPLICATION)
    }

    unsafe extern "system" fn tray_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_CREATE {
            let create_struct = &*(lparam as *const CREATESTRUCTW);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create_struct.lpCreateParams as isize);
            return 0;
        }

        let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut TrayState;
        if state_ptr.is_null() {
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }

        let state = &mut *state_ptr;

        // Handle TaskbarCreated (e.g. Explorer restart in Windows 11 IoT Enterprise LTSC)
        if state.taskbar_created_msg != 0 && msg == state.taskbar_created_msg {
            info!("[Tray] TaskbarCreated broadcast received. Re-adding system tray icon.");
            Shell_NotifyIconW(NIM_ADD, &state.nid);
            return 0;
        }

        match msg {
            WM_USER_TRAY => {
                let event = (lparam & 0xFFFF) as u32;
                match event {
                    WM_LBUTTONUP | WM_LBUTTONDBLCLK => {
                        TrayCommand::OpenDashboard.execute(
                            state.port,
                            &state.tts_handle,
                            &state.shutdown_tx,
                            &state.runtime,
                        );
                    }
                    WM_RBUTTONUP => {
                        let mut pt = POINT { x: 0, y: 0 };
                        GetCursorPos(&mut pt);
                        SetForegroundWindow(hwnd);

                        let hmenu = CreatePopupMenu();
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::OpenDashboard.to_id(),
                            to_wide("Open Dashboard").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::OpenSettings.to_id(),
                            to_wide("Open Settings").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::OpenObs.to_id(),
                            to_wide("Open OBS Overlay (/chat)").as_ptr(),
                        );
                        AppendMenuW(hmenu, MF_SEPARATOR, 0, std::ptr::null());
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::BanCurrent.to_id(),
                            to_wide("Ban Current Speaker [Num 1]").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::SpeakAsBanned.to_id(),
                            to_wide("Speak as Banned User [Num 2]").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::SpeakAsUser.to_id(),
                            to_wide("Speak as User (BABA) [Num 4]").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::SkipCurrent.to_id(),
                            to_wide("Skip Current TTS [Num 3]").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::ClearQueue.to_id(),
                            to_wide("Clear TTS Queue [Num 0]").as_ptr(),
                        );
                        AppendMenuW(hmenu, MF_SEPARATOR, 0, std::ptr::null());
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::RestartServer.to_id(),
                            to_wide("Restart Server").as_ptr(),
                        );
                        AppendMenuW(
                            hmenu,
                            MF_STRING,
                            TrayCommand::Exit.to_id(),
                            to_wide("Exit BABA TTS").as_ptr(),
                        );

                        TrackPopupMenu(
                            hmenu,
                            TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
                            pt.x,
                            pt.y,
                            0,
                            hwnd,
                            std::ptr::null(),
                        );
                        PostMessageW(hwnd, WM_NULL, 0, 0);
                        DestroyMenu(hmenu);
                    }
                    _ => {}
                }
                0
            }
            WM_HOTKEY => {
                let hotkey_id = wparam as i32;
                match hotkey_id {
                    HOTKEY_BAN_CURRENT => {
                        TrayCommand::BanCurrent.execute(
                            state.port,
                            &state.tts_handle,
                            &state.shutdown_tx,
                            &state.runtime,
                        );
                    }
                    HOTKEY_SPEAK_AS_BANNED => {
                        TrayCommand::SpeakAsBanned.execute(
                            state.port,
                            &state.tts_handle,
                            &state.shutdown_tx,
                            &state.runtime,
                        );
                    }
                    HOTKEY_SPEAK_AS_USER => {
                        TrayCommand::SpeakAsUser.execute(
                            state.port,
                            &state.tts_handle,
                            &state.shutdown_tx,
                            &state.runtime,
                        );
                    }
                    HOTKEY_SKIP_CURRENT => {
                        TrayCommand::SkipCurrent.execute(
                            state.port,
                            &state.tts_handle,
                            &state.shutdown_tx,
                            &state.runtime,
                        );
                    }
                    HOTKEY_CLEAR_QUEUE => {
                        TrayCommand::ClearQueue.execute(
                            state.port,
                            &state.tts_handle,
                            &state.shutdown_tx,
                            &state.runtime,
                        );
                    }
                    _ => {}
                }
                0
            }
            WM_COMMAND => {
                let cmd_id = (wparam & 0xFFFF) as usize;
                if let Some(cmd) = TrayCommand::from_id(cmd_id) {
                    cmd.execute(
                        state.port,
                        &state.tts_handle,
                        &state.shutdown_tx,
                        &state.runtime,
                    );
                    if cmd == TrayCommand::Exit {
                        PostMessageW(hwnd, WM_CLOSE, 0, 0);
                    }
                }
                0
            }
            WM_CLOSE => {
                DestroyWindow(hwnd);
                0
            }
            WM_DESTROY => {
                UnregisterHotKey(hwnd, HOTKEY_BAN_CURRENT);
                UnregisterHotKey(hwnd, HOTKEY_SPEAK_AS_BANNED);
                UnregisterHotKey(hwnd, HOTKEY_SPEAK_AS_USER);
                UnregisterHotKey(hwnd, HOTKEY_SKIP_CURRENT);
                UnregisterHotKey(hwnd, HOTKEY_CLEAR_QUEUE);
                Shell_NotifyIconW(NIM_DELETE, &state.nid);
                PostQuitMessage(0);
                0
            }
            WM_NCDESTROY => {
                let _ = Box::from_raw(state_ptr);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub struct TrayHandle {
        hwnd: HWND,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for TrayHandle {
        fn drop(&mut self) {
            if self.hwnd != 0 {
                unsafe {
                    PostMessageW(self.hwnd, WM_CLOSE, 0, 0);
                }
            }
            if let Some(th) = self.thread.take() {
                let _ = th.join();
            }
        }
    }

    pub fn start_tray(
        tts_handle: TtsHandle,
        shutdown_tx: Sender<()>,
        port: u16,
    ) -> Option<TrayHandle> {
        let runtime = tokio::runtime::Handle::current();
        let (tx, rx) = sync_channel::<HWND>(1);

        let thread = std::thread::Builder::new()
            .name("baba-tray".to_string())
            .spawn(move || unsafe {
                let h_instance = GetModuleHandleW(std::ptr::null());
                let class_name = to_wide("BabaTtsTrayWindowClass");

                let wc = WNDCLASSW {
                    style: 0,
                    lpfnWndProc: Some(tray_wndproc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: h_instance,
                    hIcon: 0,
                    hCursor: 0,
                    hbrBackground: 0,
                    lpszMenuName: std::ptr::null(),
                    lpszClassName: class_name.as_ptr(),
                };

                RegisterClassW(&wc);

                let icon = load_icon();
                let taskbar_created_msg =
                    RegisterWindowMessageW(to_wide("TaskbarCreated").as_ptr());

                let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
                nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
                nid.uID = 1;
                nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
                nid.uCallbackMessage = WM_USER_TRAY;
                nid.hIcon = icon;

                let tooltip = format_tray_tooltip(port);
                let wide_tooltip = to_wide(&tooltip);
                let copy_len = wide_tooltip.len().min(nid.szTip.len());
                nid.szTip[..copy_len].copy_from_slice(&wide_tooltip[..copy_len]);

                let state = Box::new(TrayState {
                    port,
                    tts_handle,
                    shutdown_tx,
                    runtime,
                    taskbar_created_msg,
                    nid,
                });

                let state_raw = Box::into_raw(state);

                let hwnd = CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    class_name.as_ptr(),
                    to_wide("BABA TTS").as_ptr(),
                    WS_POPUP,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    h_instance,
                    state_raw as _,
                );

                if hwnd == 0 {
                    error!("[Tray] Failed to create hidden window for system tray");
                    let _ = Box::from_raw(state_raw);
                    let _ = tx.send(0);
                    return;
                }

                (*state_raw).nid.hWnd = hwnd;

                // Register global hotkeys with Ctrl+Alt modifiers (MOD_CONTROL | MOD_ALT | MOD_NOREPEAT)
                // so we don't hijack normal OS-wide numeric keypad typing
                let hotkey_mods = MOD_CONTROL | MOD_ALT | MOD_NOREPEAT;
                RegisterHotKey(hwnd, HOTKEY_BAN_CURRENT, hotkey_mods, 0x61); // Ctrl+Alt+Numpad1
                RegisterHotKey(hwnd, HOTKEY_SPEAK_AS_BANNED, hotkey_mods, 0x62); // Ctrl+Alt+Numpad2
                RegisterHotKey(hwnd, HOTKEY_SPEAK_AS_USER, hotkey_mods, 0x64); // Ctrl+Alt+Numpad4
                RegisterHotKey(hwnd, HOTKEY_SKIP_CURRENT, hotkey_mods, 0x63); // Ctrl+Alt+Numpad3
                RegisterHotKey(hwnd, HOTKEY_CLEAR_QUEUE, hotkey_mods, 0x60); // Ctrl+Alt+Numpad0

                if Shell_NotifyIconW(NIM_ADD, &(*state_raw).nid) == 0 {
                    warn!("[Tray] Shell_NotifyIconW failed to add tray icon");
                } else {
                    info!("[Tray] System tray icon registered successfully on port {}", port);
                }

                let _ = tx.send(hwnd);

                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                info!("[Tray] System tray message loop exited.");
            })
            .ok()?;

        let hwnd = rx.recv().unwrap_or(0);
        if hwnd == 0 {
            return None;
        }

        Some(TrayHandle {
            hwnd,
            thread: Some(thread),
        })
    }
}

#[cfg(not(windows))]
mod non_windows {
    use super::*;

    pub struct TrayHandle;

    pub fn start_tray(
        _tts_handle: TtsHandle,
        _shutdown_tx: Sender<()>,
        _port: u16,
    ) -> Option<TrayHandle> {
        tracing::info!("[Tray] System tray is only active on Windows systems.");
        Some(TrayHandle)
    }
}

#[cfg(windows)]
pub use win32::*;

#[cfg(not(windows))]
pub use non_windows::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_command_ids() {
        assert_eq!(TrayCommand::from_id(1001), Some(TrayCommand::OpenDashboard));
        assert_eq!(TrayCommand::from_id(1002), Some(TrayCommand::OpenSettings));
        assert_eq!(TrayCommand::from_id(1003), Some(TrayCommand::OpenObs));
        assert_eq!(TrayCommand::from_id(1004), Some(TrayCommand::SkipCurrent));
        assert_eq!(TrayCommand::from_id(1005), Some(TrayCommand::BanCurrent));
        assert_eq!(TrayCommand::from_id(1006), Some(TrayCommand::SpeakAsBanned));
        assert_eq!(TrayCommand::from_id(1007), Some(TrayCommand::SpeakAsUser));
        assert_eq!(TrayCommand::from_id(1008), Some(TrayCommand::ClearQueue));
        assert_eq!(TrayCommand::from_id(1009), Some(TrayCommand::RestartServer));
        assert_eq!(TrayCommand::from_id(1010), Some(TrayCommand::Exit));
        assert_eq!(TrayCommand::from_id(9999), None);

        assert_eq!(TrayCommand::OpenDashboard.to_id(), 1001);
        assert_eq!(TrayCommand::OpenSettings.to_id(), 1002);
        assert_eq!(TrayCommand::OpenObs.to_id(), 1003);
        assert_eq!(TrayCommand::SkipCurrent.to_id(), 1004);
        assert_eq!(TrayCommand::BanCurrent.to_id(), 1005);
        assert_eq!(TrayCommand::SpeakAsBanned.to_id(), 1006);
        assert_eq!(TrayCommand::SpeakAsUser.to_id(), 1007);
        assert_eq!(TrayCommand::ClearQueue.to_id(), 1008);
        assert_eq!(TrayCommand::RestartServer.to_id(), 1009);
        assert_eq!(TrayCommand::Exit.to_id(), 1010);
    }

    #[test]
    fn test_format_tray_tooltip() {
        assert_eq!(format_tray_tooltip(7060), "BABA TTS (Port 7060)");
        assert_eq!(format_tray_tooltip(8080), "BABA TTS (Port 8080)");
    }

    #[tokio::test]
    async fn test_tray_command_execution() {
        let (broadcast_tx, _) = tokio::sync::broadcast::channel(10);
        let settings = crate::types::AppSettings::default();
        let tts_handle = crate::tts_queue::TtsActor::spawn(broadcast_tx, settings);
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel(1);
        let runtime = tokio::runtime::Handle::current();

        // Test Exit command
        TrayCommand::Exit.execute(7060, &tts_handle, &shutdown_tx, &runtime);
        assert!(shutdown_rx.try_recv().is_ok());

        // Test RestartServer command sends shutdown signal
        let (restart_tx, mut restart_rx) = tokio::sync::mpsc::channel(1);
        TrayCommand::RestartServer.execute(7060, &tts_handle, &restart_tx, &runtime);
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        assert!(restart_rx.try_recv().is_ok());

        // Test OpenDashboard and OpenSettings execute window restore/focus without panic
        TrayCommand::OpenDashboard.execute(7060, &tts_handle, &shutdown_tx, &runtime);
        TrayCommand::OpenSettings.execute(7060, &tts_handle, &shutdown_tx, &runtime);

        // Test Skip and Clear commands on a bare OS thread with no thread-local Tokio runtime
        let tts_clone = tts_handle.clone();
        let shutdown_clone = shutdown_tx.clone();
        let rt_clone = runtime.clone();
        let th = std::thread::spawn(move || {
            TrayCommand::SkipCurrent.execute(7060, &tts_clone, &shutdown_clone, &rt_clone);
            TrayCommand::ClearQueue.execute(7060, &tts_clone, &shutdown_clone, &rt_clone);
        });
        th.join().expect("Bare OS thread execution should not panic");
    }

    #[test]
    fn test_tray_no_browser_process_spawning() {
        // Source-level invariant: tray.rs must not invoke external browser executables msedge or chrome
        let tray_source = include_str!("tray.rs");
        assert!(
            !tray_source.contains("\"msedge\""),
            "tray.rs must not spawn external msedge browser process"
        );
        assert!(
            !tray_source.contains("\"chrome\""),
            "tray.rs must not spawn external chrome browser process"
        );
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn test_non_windows_start_tray() {
        let (broadcast_tx, _) = tokio::sync::broadcast::channel(10);
        let settings = crate::types::AppSettings::default();
        let tts_handle = crate::tts_queue::TtsActor::spawn(broadcast_tx, settings);
        let (shutdown_tx, _) = tokio::sync::mpsc::channel(1);

        let handle = start_tray(tts_handle, shutdown_tx, 7060);
        assert!(handle.is_some());
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptMode {
    User,
    Banned,
}

#[allow(dead_code)]
impl PromptMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Banned => "banned",
        }
    }

    pub fn prompt_title(&self) -> &'static str {
        match self {
            Self::User => "BABA TTS - Speak as BABA",
            Self::Banned => "BABA TTS - Speak as Banned",
        }
    }

    pub fn prompt_prefix(&self) -> &'static str {
        match self {
            Self::User => "[Speak as BABA]: ",
            Self::Banned => "[Speak as Banned]: ",
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromptGeometry {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[allow(dead_code)]
pub fn calculate_bottom_left_geometry(
    workarea_left: i32,
    workarea_bottom: i32,
    width: i32,
    height: i32,
    margin_x: i32,
    margin_y: i32,
) -> PromptGeometry {
    PromptGeometry {
        x: workarea_left + margin_x,
        y: workarea_bottom - height - margin_y,
        width,
        height,
    }
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::{AtomicIsize, AtomicU16, AtomicU8, Ordering};
    use std::sync::{Once, OnceLock};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateSolidBrush, DeleteObject, GetStockObject, SetBkColor, SetTextColor,
        DEFAULT_GUI_FONT, HBRUSH, HDC,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{AttachThreadInput, SetFocus};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, CallWindowProcW, CreateWindowExW, DefWindowProcW, DispatchMessageW,
        GetForegroundWindow, GetMessageW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, PostMessageW, RegisterClassW, SendMessageW, SetForegroundWindow,
        SetWindowLongPtrW, SetWindowPos, SetWindowTextW, ShowWindow, SystemParametersInfoW,
        TranslateMessage, ES_AUTOHSCROLL, GWLP_WNDPROC, MSG, SPI_GETWORKAREA, SWP_SHOWWINDOW,
        SW_HIDE, SW_SHOW, WM_ACTIVATE, WM_CLOSE, WM_CTLCOLOREDIT, WM_CTLCOLORSTATIC, WM_DESTROY,
        WM_KEYDOWN, WM_KILLFOCUS, WM_USER, WNDCLASSW, WNDPROC, WS_CHILD, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_POPUP, WS_TABSTOP, WS_VISIBLE,
    };

    static ACTIVE_PORT: AtomicU16 = AtomicU16::new(7060);
    static PROMPT_HWND: AtomicIsize = AtomicIsize::new(0);
    static EDIT_HWND: AtomicIsize = AtomicIsize::new(0);
    static ORIG_EDIT_PROC: AtomicIsize = AtomicIsize::new(0);
    // 0 = User, 1 = Banned
    static CURRENT_MODE: AtomicU8 = AtomicU8::new(0);
    static INIT_ONCE: Once = Once::new();

    static TOKIO_HANDLE: OnceLock<tokio::runtime::Handle> = OnceLock::new();

    const WM_SHOW_PROMPT: u32 = WM_USER + 201;

    struct ThreadInputGuard {
        cur: u32,
        fg: u32,
    }

    impl Drop for ThreadInputGuard {
        fn drop(&mut self) {
            unsafe {
                AttachThreadInput(self.cur, self.fg, 0);
            }
        }
    }

    pub fn init_runtime_handle(handle: tokio::runtime::Handle) {
        let _ = TOKIO_HANDLE.set(handle);
    }

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe extern "system" fn edit_subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        // Enforce panic boundary over FFI
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if msg == WM_KEYDOWN {
                match wparam as i32 {
                    0x0D => {
                        // VK_RETURN
                        let len = GetWindowTextLengthW(hwnd);
                        if len > 0 {
                            let mut buf = vec![0u16; (len + 1) as usize];
                            GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
                            let text = String::from_utf16_lossy(&buf[..len as usize]);
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let port = ACTIVE_PORT.load(Ordering::Acquire);
                                let mode_u8 = CURRENT_MODE.load(Ordering::Acquire);
                                let is_user = mode_u8 == 0;
                                let text_to_send = trimmed.to_string();

                                // Non-blocking dispatch via Tokio Handle if initialized, or background OS thread
                                if let Some(handle) = TOKIO_HANDLE.get() {
                                    handle.spawn(async move {
                                        let client = reqwest::Client::new();
                                        let url = if is_user {
                                            format!("http://127.0.0.1:{}/api/baba-say", port)
                                        } else {
                                            format!("http://127.0.0.1:{}/api/speak-as-banned", port)
                                        };
                                        let _ = client
                                            .post(&url)
                                            .json(&serde_json::json!({ "text": text_to_send }))
                                            .send()
                                            .await;
                                    });
                                } else {
                                    std::thread::spawn(move || {
                                        if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                                            .enable_all()
                                            .build()
                                        {
                                            rt.block_on(async move {
                                                let client = reqwest::Client::new();
                                                let url = if is_user {
                                                    format!("http://127.0.0.1:{}/api/baba-say", port)
                                                } else {
                                                    format!("http://127.0.0.1:{}/api/speak-as-banned", port)
                                                };
                                                let _ = client
                                                    .post(&url)
                                                    .json(&serde_json::json!({ "text": text_to_send }))
                                                    .send()
                                                    .await;
                                            });
                                        }
                                    });
                                }
                            }
                        }

                        // Clear edit text and hide prompt window
                        SetWindowTextW(hwnd, to_wide("").as_ptr());
                        let parent = PROMPT_HWND.load(Ordering::Acquire);
                        if parent != 0 {
                            ShowWindow(parent, SW_HIDE);
                        }
                        return 0;
                    }
                    0x1B => {
                        // VK_ESCAPE: clear and hide
                        SetWindowTextW(hwnd, to_wide("").as_ptr());
                        let parent = PROMPT_HWND.load(Ordering::Acquire);
                        if parent != 0 {
                            ShowWindow(parent, SW_HIDE);
                        }
                        return 0;
                    }
                    _ => {}
                }
            }

            let orig_val = ORIG_EDIT_PROC.load(Ordering::Acquire);
            if orig_val != 0 {
                let orig: WNDPROC = std::mem::transmute(orig_val);
                CallWindowProcW(orig, hwnd, msg, wparam, lparam)
            } else {
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }));

        res.unwrap_or(0)
    }

    unsafe extern "system" fn prompt_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        static mut LIGHT_BRUSH: HBRUSH = 0;
        static mut EDIT_BRUSH: HBRUSH = 0;

        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match msg {
            windows_sys::Win32::UI::WindowsAndMessaging::WM_CREATE => {
                // Clean modern light theme background (#F8FAFC)
                LIGHT_BRUSH = CreateSolidBrush(0x00FCFAF8);
                EDIT_BRUSH = CreateSolidBrush(0x00FFFFFF);
                let h_instance = GetModuleHandleW(std::ptr::null());

                // Create inner Edit control
                let edit_hwnd = CreateWindowExW(
                    0,
                    to_wide("EDIT").as_ptr(),
                    to_wide("").as_ptr(),
                    WS_CHILD | WS_VISIBLE | (ES_AUTOHSCROLL as u32) | WS_TABSTOP,
                    12,
                    10,
                    456,
                    28,
                    hwnd,
                    101 as _,
                    h_instance,
                    std::ptr::null(),
                );

                if edit_hwnd != 0 {
                    let font = GetStockObject(DEFAULT_GUI_FONT as _);
                    SendMessageW(edit_hwnd, 0x0030 /* WM_SETFONT */, font as _, 1);
                    let orig = SetWindowLongPtrW(
                        edit_hwnd,
                        GWLP_WNDPROC,
                        edit_subclass_proc as *const () as usize as isize,
                    );
                    ORIG_EDIT_PROC.store(orig as isize, Ordering::Release);
                    EDIT_HWND.store(edit_hwnd, Ordering::Release);
                }
                0
            }
            WM_CTLCOLOREDIT => {
                let hdc = wparam as HDC;
                // Crisp dark slate text (#0F172A) on clean white input (#FFFFFF)
                SetTextColor(hdc, 0x002A170F);
                SetBkColor(hdc, 0x00FFFFFF);
                EDIT_BRUSH as LRESULT
            }
            WM_CTLCOLORSTATIC => {
                let hdc = wparam as HDC;
                SetTextColor(hdc, 0x00473322);
                SetBkColor(hdc, 0x00FCFAF8);
                LIGHT_BRUSH as LRESULT
            }
            WM_SHOW_PROMPT => {
                let mut workarea: RECT = std::mem::zeroed();
                SystemParametersInfoW(
                    SPI_GETWORKAREA,
                    0,
                    &mut workarea as *mut _ as _,
                    0,
                );

                let geom = calculate_bottom_left_geometry(
                    workarea.left,
                    workarea.bottom,
                    480,
                    48,
                    24,
                    24,
                );

                SetWindowPos(
                    hwnd,
                    -1 as HWND, // HWND_TOPMOST
                    geom.x,
                    geom.y,
                    geom.width,
                    geom.height,
                    SWP_SHOWWINDOW,
                );

                ShowWindow(hwnd, SW_SHOW);

                // Safely attach thread input with RAII guard to guarantee focus without freezing
                let fg = GetForegroundWindow();
                let cur_thread = GetCurrentThreadId();
                let fg_thread = if fg != 0 {
                    GetWindowThreadProcessId(fg, std::ptr::null_mut())
                } else {
                    0
                };

                if fg_thread != 0 && fg_thread != cur_thread {
                    let _guard = if AttachThreadInput(cur_thread, fg_thread, 1) != 0 {
                        Some(ThreadInputGuard {
                            cur: cur_thread,
                            fg: fg_thread,
                        })
                    } else {
                        None
                    };
                    SetForegroundWindow(hwnd);
                    BringWindowToTop(hwnd);
                } else {
                    SetForegroundWindow(hwnd);
                    BringWindowToTop(hwnd);
                }

                let edit = EDIT_HWND.load(Ordering::Acquire);
                if edit != 0 {
                    let mode_u8 = CURRENT_MODE.load(Ordering::Acquire);
                    let mode = if mode_u8 == 0 { PromptMode::User } else { PromptMode::Banned };
                    SetWindowTextW(hwnd, to_wide(mode.prompt_title()).as_ptr());
                    SetWindowTextW(edit, to_wide("").as_ptr());
                    SetFocus(edit);
                }
                0
            }
            WM_ACTIVATE => {
                // If losing focus (WA_INACTIVE = 0), auto-hide to avoid stuck prompt windows
                let state = (wparam & 0xFFFF) as u16;
                if state == 0 {
                    ShowWindow(hwnd, SW_HIDE);
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_KILLFOCUS => {
                ShowWindow(hwnd, SW_HIDE);
                0
            }
            WM_CLOSE => {
                ShowWindow(hwnd, SW_HIDE);
                0
            }
            WM_DESTROY => {
                if LIGHT_BRUSH != 0 {
                    DeleteObject(LIGHT_BRUSH as _);
                }
                if EDIT_BRUSH != 0 {
                    DeleteObject(EDIT_BRUSH as _);
                }
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }));

        res.unwrap_or(0)
    }

    pub fn ensure_window_initialized() {
        INIT_ONCE.call_once(|| {
            let (tx, rx) = std::sync::mpsc::sync_channel::<HWND>(1);

            std::thread::Builder::new()
                .name("baba-native-prompt".to_string())
                .spawn(move || unsafe {
                    let h_instance = GetModuleHandleW(std::ptr::null());
                    let class_name = to_wide("BabaNativePromptClass");

                    let wc = WNDCLASSW {
                        style: 0,
                        lpfnWndProc: Some(prompt_wndproc),
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

                    let hwnd = CreateWindowExW(
                        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                        class_name.as_ptr(),
                        to_wide("BABA TTS - Quick Input").as_ptr(),
                        WS_POPUP,
                        0,
                        0,
                        480,
                        48,
                        0,
                        0,
                        h_instance,
                        std::ptr::null(),
                    );

                    if hwnd != 0 {
                        let _ = tx.send(hwnd);
                        let mut msg: MSG = std::mem::zeroed();
                        while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                            TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    } else {
                        let _ = tx.send(0);
                    }
                })
                .expect("Failed to spawn native prompt thread");

            let hwnd = rx.recv().unwrap_or(0);
            if hwnd != 0 {
                PROMPT_HWND.store(hwnd, Ordering::Release);
            }
        });
    }

    pub fn show_native_prompt(port: u16, mode: PromptMode) {
        ACTIVE_PORT.store(port, Ordering::Release);
        let mode_u8 = match mode {
            PromptMode::User => 0,
            PromptMode::Banned => 1,
        };
        CURRENT_MODE.store(mode_u8, Ordering::Release);
        ensure_window_initialized();

        let hwnd = PROMPT_HWND.load(Ordering::Acquire);
        if hwnd != 0 {
            unsafe {
                PostMessageW(hwnd, WM_SHOW_PROMPT, 0, 0);
            }
        }
    }
}

#[cfg(not(windows))]
mod non_windows {
    use super::*;

    #[allow(dead_code)]
    pub fn init_runtime_handle(_handle: tokio::runtime::Handle) {}

    #[allow(dead_code)]
    pub fn show_native_prompt(_port: u16, _mode: PromptMode) {
        tracing::info!("[NativePrompt] Prompt requested on non-windows platform.");
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
    fn test_prompt_mode_properties() {
        assert_eq!(PromptMode::User.as_str(), "user");
        assert_eq!(PromptMode::Banned.as_str(), "banned");
        assert!(PromptMode::User.prompt_prefix().contains("BABA"));
        assert!(PromptMode::Banned.prompt_prefix().contains("Banned"));
    }

    #[test]
    fn test_calculate_bottom_left_geometry() {
        let geom = calculate_bottom_left_geometry(0, 1080, 480, 48, 24, 24);
        assert_eq!(geom.x, 24);
        assert_eq!(geom.y, 1080 - 48 - 24);
        assert_eq!(geom.width, 480);
        assert_eq!(geom.height, 48);
    }
}

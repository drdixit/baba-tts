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
    use std::sync::atomic::{AtomicU16, Ordering};
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateSolidBrush, GetStockObject, SetBkColor, SetTextColor, DEFAULT_GUI_FONT,
        HBRUSH, HDC,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
        PostMessageW, RegisterClassW, SendMessageW, SetForegroundWindow,
        SetWindowLongPtrW, SetWindowPos, SystemParametersInfoW, TranslateMessage,
        ES_AUTOHSCROLL, GWLP_WNDPROC, MSG, SPI_GETWORKAREA, SWP_SHOWWINDOW, SW_HIDE, SW_SHOW,
        WM_CLOSE, WM_CTLCOLOREDIT, WM_CTLCOLORSTATIC, WM_DESTROY, WM_KEYDOWN, WM_USER,
        WNDCLASSW, WNDPROC, WS_CHILD, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_TABSTOP,
        WS_VISIBLE,
    };

    static ACTIVE_PORT: AtomicU16 = AtomicU16::new(7060);
    static PROMPT_HWND: Mutex<Option<HWND>> = Mutex::new(None);
    static EDIT_HWND: Mutex<Option<HWND>> = Mutex::new(None);
    static ORIG_EDIT_PROC: Mutex<WNDPROC> = Mutex::new(None);
    static CURRENT_MODE: Mutex<PromptMode> = Mutex::new(PromptMode::User);

    const WM_SHOW_PROMPT: u32 = WM_USER + 201;

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
        if msg == WM_KEYDOWN {
            match wparam as i32 {
                0x0D => {
                    // VK_RETURN
                    let len = windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextLengthW(hwnd);
                    if len > 0 {
                        let mut buf = vec![0u16; (len + 1) as usize];
                        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextW(
                            hwnd,
                            buf.as_mut_ptr(),
                            len + 1,
                        );
                        let text = String::from_utf16_lossy(&buf[..len as usize]);
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            let port = ACTIVE_PORT.load(Ordering::Relaxed);
                            let mode = *CURRENT_MODE.lock().unwrap();
                            let text_to_send = trimmed.to_string();

                            tokio::spawn(async move {
                                let client = reqwest::Client::new();
                                if mode == PromptMode::User {
                                    let url = format!("http://127.0.0.1:{}/api/baba-say", port);
                                    let _ = client
                                        .post(&url)
                                        .json(&serde_json::json!({ "text": text_to_send }))
                                        .send()
                                        .await;
                                } else {
                                    let url = format!("http://127.0.0.1:{}/api/speak-as-banned", port);
                                    let _ = client
                                        .post(&url)
                                        .json(&serde_json::json!({ "text": text_to_send }))
                                        .send()
                                        .await;
                                }
                            });
                        }
                    }

                    // Clear edit text and hide
                    windows_sys::Win32::UI::WindowsAndMessaging::SetWindowTextW(
                        hwnd,
                        to_wide("").as_ptr(),
                    );
                    if let Some(parent) = PROMPT_HWND.lock().unwrap().as_ref() {
                        windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(*parent, SW_HIDE);
                    }
                    return 0;
                }
                0x1B => {
                    // VK_ESCAPE
                    windows_sys::Win32::UI::WindowsAndMessaging::SetWindowTextW(
                        hwnd,
                        to_wide("").as_ptr(),
                    );
                    if let Some(parent) = PROMPT_HWND.lock().unwrap().as_ref() {
                        windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(*parent, SW_HIDE);
                    }
                    return 0;
                }
                _ => {}
            }
        }

        let orig = *ORIG_EDIT_PROC.lock().unwrap();
        if orig.is_some() {
            CallWindowProcW(orig, hwnd, msg, wparam, lparam)
        } else {
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
    }

    unsafe extern "system" fn prompt_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        static mut DARK_BRUSH: HBRUSH = 0;

        match msg {
            windows_sys::Win32::UI::WindowsAndMessaging::WM_CREATE => {
                DARK_BRUSH = CreateSolidBrush(0x00151111); // Dark background #111115
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
                    *ORIG_EDIT_PROC.lock().unwrap() = std::mem::transmute(orig);
                    *EDIT_HWND.lock().unwrap() = Some(edit_hwnd);
                }
                0
            }
            WM_CTLCOLOREDIT | WM_CTLCOLORSTATIC => {
                let hdc = wparam as HDC;
                SetTextColor(hdc, 0x00F0F0F0); // White-ish text
                SetBkColor(hdc, 0x00151111);   // Dark background
                DARK_BRUSH as LRESULT
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

                windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, SW_SHOW);
                SetForegroundWindow(hwnd);

                if let Some(edit) = *EDIT_HWND.lock().unwrap() {
                    let mode = *CURRENT_MODE.lock().unwrap();
                    windows_sys::Win32::UI::WindowsAndMessaging::SetWindowTextW(
                        hwnd,
                        to_wide(mode.prompt_title()).as_ptr(),
                    );
                    windows_sys::Win32::UI::WindowsAndMessaging::SetWindowTextW(
                        edit,
                        to_wide("").as_ptr(),
                    );
                    SetFocus(edit);
                }
                0
            }
            WM_CLOSE => {
                windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, SW_HIDE);
                0
            }
            WM_DESTROY => {
                if DARK_BRUSH != 0 {
                    windows_sys::Win32::Graphics::Gdi::DeleteObject(DARK_BRUSH as _);
                }
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub fn ensure_window_initialized() {
        let mut guard = PROMPT_HWND.lock().unwrap();
        if guard.is_some() {
            return;
        }

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
            *guard = Some(hwnd);
        }
    }

    pub fn show_native_prompt(port: u16, mode: PromptMode) {
        ACTIVE_PORT.store(port, Ordering::Relaxed);
        *CURRENT_MODE.lock().unwrap() = mode;
        ensure_window_initialized();

        if let Some(hwnd) = *PROMPT_HWND.lock().unwrap() {
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

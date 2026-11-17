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
    use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
    use std::sync::{Once, OnceLock};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateFontW, CreateSolidBrush, DeleteObject, FillRect, FrameRect, GetDC, GetMonitorInfoW,
        GetStockObject, GetTextMetricsW, MonitorFromWindow, ReleaseDC, SelectObject, SetBkColor,
        SetTextColor, DEFAULT_GUI_FONT, HBRUSH, HDC, HFONT, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        TEXTMETRICW,
    };
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, SetFocus, KEYEVENTF_KEYUP};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, CallWindowProcW, CreateWindowExW, DefWindowProcW, DispatchMessageW,
        GetClientRect, GetForegroundWindow, GetMessageW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsChild, PostMessageW, RegisterClassW, SendMessageW,
        SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, SetWindowTextW, ShowWindow,
        SystemParametersInfoW, TranslateMessage, CS_DROPSHADOW, ES_AUTOHSCROLL, GWLP_WNDPROC, MSG,
        SPI_GETWORKAREA, SW_HIDE, SW_SHOW, SWP_NOACTIVATE, SWP_NOZORDER, SWP_NOSIZE, SWP_SHOWWINDOW,
        WM_ACTIVATE, WM_CHAR,
        WM_CLOSE, WM_CREATE, WM_CTLCOLOREDIT, WM_CTLCOLORSTATIC, WM_DESTROY, WM_ERASEBKGND,
        WM_KEYDOWN, WM_KILLFOCUS, WM_LBUTTONDOWN, WM_USER, WNDCLASSW, WNDPROC, WS_CHILD,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_TABSTOP, WS_VISIBLE,
    };

    // Bits 0..16: port (u16)
    // Bits 16..24: mode (0 = User, 1 = Banned)
    static PROMPT_STATE: AtomicU32 = AtomicU32::new(7060);
    static PROMPT_HWND: AtomicIsize = AtomicIsize::new(0);
    static EDIT_HWND: AtomicIsize = AtomicIsize::new(0);
    static ORIG_EDIT_PROC: AtomicIsize = AtomicIsize::new(0);
    static INIT_ONCE: Once = Once::new();

    static TOKIO_HANDLE: OnceLock<tokio::runtime::Handle> = OnceLock::new();
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

    const WM_SHOW_PROMPT: u32 = WM_USER + 201;
    const PROMPT_WIDTH: i32 = 480;
    const PROMPT_HEIGHT: i32 = 48;
    const PROMPT_INPUT_HEIGHT: i32 = 28;
    const PROMPT_HORIZONTAL_INSET: i32 = 10;
    const PROMPT_FONT_HEIGHT: i32 = 15;
    const PROMPT_TEXT_MARGIN: i32 = 8;
    const PROMPT_SCREEN_MARGIN: i32 = 24;

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

    fn get_http_client() -> &'static reqwest::Client {
        HTTP_CLIENT.get_or_init(reqwest::Client::new)
    }

    fn pack_prompt_state(port: u16, mode: PromptMode) -> u32 {
        let mode_u8 = match mode {
            PromptMode::User => 0u32,
            PromptMode::Banned => 1u32,
        };
        (port as u32) | (mode_u8 << 16)
    }

    fn unpack_prompt_state(state: u32) -> (u16, PromptMode) {
        let port = (state & 0xFFFF) as u16;
        let mode_u8 = ((state >> 16) & 0xFF) as u8;
        let mode = if mode_u8 == 0 {
            PromptMode::User
        } else {
            PromptMode::Banned
        };
        (port, mode)
    }

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe fn get_window_dpi(hwnd: HWND) -> u32 {
        let user32 = GetModuleHandleW(to_wide("user32.dll").as_ptr());
        if user32 != 0 {
            if let Some(proc) = GetProcAddress(user32, b"GetDpiForWindow\0".as_ptr()) {
                type GetDpiForWindowFn = unsafe extern "system" fn(HWND) -> u32;
                let func: GetDpiForWindowFn = std::mem::transmute(proc);
                let dpi = func(hwnd);
                if dpi > 0 {
                    return dpi;
                }
            }
        }
        96
    }

    unsafe fn get_font_line_height(hwnd: HWND, font: HFONT, fallback: i32) -> i32 {
        let hdc = GetDC(hwnd);
        if hdc == 0 {
            return fallback.max(1);
        }

        let previous_font = SelectObject(hdc, font as _);
        let font_selected = previous_font != 0 && previous_font != -1;
        let mut metrics: TEXTMETRICW = std::mem::zeroed();
        let line_height = if font_selected && GetTextMetricsW(hdc, &mut metrics) != 0 {
            metrics.tmHeight
        } else {
            fallback
        };

        if font_selected {
            SelectObject(hdc, previous_font);
        }
        ReleaseDC(hwnd, hdc);
        line_height.max(1)
    }

    unsafe fn apply_dwm_rounded_corners(hwnd: HWND) {
        let dwm = LoadLibraryW(to_wide("dwmapi.dll").as_ptr());
        if dwm != 0 {
            if let Some(proc) = GetProcAddress(dwm, b"DwmSetWindowAttribute\0".as_ptr()) {
                type DwmSetWindowAttributeFn = unsafe extern "system" fn(
                    HWND,
                    u32,
                    *const std::ffi::c_void,
                    u32,
                ) -> i32;
                let func: DwmSetWindowAttributeFn = std::mem::transmute(proc);
                let preference: u32 = 2; // DWMWCP_ROUND (Windows 11 rounded corners)
                let _ = func(
                    hwnd,
                    33, // DWMWA_WINDOW_CORNER_PREFERENCE
                    &preference as *const u32 as *const std::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
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
                                let (port, mode) = unpack_prompt_state(PROMPT_STATE.load(Ordering::Acquire));
                                let text_to_send = trimmed.to_string();
                                let client = get_http_client().clone();

                                let send_req = async move {
                                    let url = if mode == PromptMode::User {
                                        format!("http://127.0.0.1:{}/api/baba-say", port)
                                    } else {
                                        format!("http://127.0.0.1:{}/api/speak-as-banned", port)
                                    };
                                    match client
                                        .post(&url)
                                        .json(&serde_json::json!({ "text": text_to_send }))
                                        .send()
                                        .await
                                    {
                                        Ok(resp) => {
                                            if !resp.status().is_success() {
                                                tracing::warn!("[NativePrompt] Request to {} returned status {}", url, resp.status());
                                            } else {
                                                tracing::debug!("[NativePrompt] Queued speech successfully via {}", url);
                                            }
                                        }
                                        Err(e) => {
                                            tracing::error!("[NativePrompt] Failed to send prompt text to {}: {}", url, e);
                                        }
                                    }
                                };

                                // Non-blocking dispatch via Tokio Handle if initialized, or background OS thread
                                if let Some(handle) = TOKIO_HANDLE.get() {
                                    handle.spawn(send_req);
                                } else {
                                    std::thread::spawn(move || {
                                        if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                                            .enable_all()
                                            .build()
                                        {
                                            rt.block_on(send_req);
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
                        crate::tray::resume_hotkeys();
                        return 0;
                    }
                    0x1B => {
                        // VK_ESCAPE: clear and hide
                        SetWindowTextW(hwnd, to_wide("").as_ptr());
                        let parent = PROMPT_HWND.load(Ordering::Acquire);
                        if parent != 0 {
                            ShowWindow(parent, SW_HIDE);
                        }
                        crate::tray::resume_hotkeys();
                        return 0;
                    }
                    _ => {}
                }
            } else if msg == WM_CHAR && wparam == 0x0D {
                // Prevent acoustic beep on Enter in single-line edit control
                return 0;
            } else if msg == WM_KILLFOCUS {
                // If focus leaves the edit box to another window outside prompt hierarchy, auto-hide
                let new_focus = wparam as HWND;
                let parent = PROMPT_HWND.load(Ordering::Acquire);
                if parent != 0 && new_focus != parent && IsChild(parent, new_focus) == 0 {
                    ShowWindow(parent, SW_HIDE);
                    crate::tray::resume_hotkeys();
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
        static mut BORDER_BRUSH: HBRUSH = 0;
        static mut PROMPT_FONT: HFONT = 0;

        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match msg {
            WM_CREATE => {
                // Modern Windows 11 Flyout background (#F3F3F3) & White input box (#FFFFFF)
                LIGHT_BRUSH = CreateSolidBrush(0x00F3F3F3);
                EDIT_BRUSH = CreateSolidBrush(0x00FFFFFF);
                BORDER_BRUSH = CreateSolidBrush(0x00D0D0D0);
                apply_dwm_rounded_corners(hwnd);

                let h_instance = GetModuleHandleW(std::ptr::null());

                // Create inner Edit control
                let edit_hwnd = CreateWindowExW(
                    0,
                    to_wide("EDIT").as_ptr(),
                    to_wide("").as_ptr(),
                    WS_CHILD | WS_VISIBLE | (ES_AUTOHSCROLL as u32) | WS_TABSTOP,
                    PROMPT_HORIZONTAL_INSET + 1,
                    (PROMPT_HEIGHT - PROMPT_INPUT_HEIGHT) / 2 + 1,
                    PROMPT_WIDTH - (PROMPT_HORIZONTAL_INSET * 2) - 2,
                    PROMPT_FONT_HEIGHT + 4,
                    hwnd,
                    101 as _,
                    h_instance,
                    std::ptr::null(),
                );

                if edit_hwnd != 0 {
                    let seg_font = CreateFontW(
                        -15, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0,
                        to_wide("Segoe UI Variable Text").as_ptr(),
                    );
                    let font = if seg_font != 0 {
                        PROMPT_FONT = seg_font as _;
                        seg_font as _
                    } else {
                        GetStockObject(DEFAULT_GUI_FONT as _)
                    };
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
            WM_ERASEBKGND => {
                let hdc = wparam as HDC;
                let mut rect: RECT = std::mem::zeroed();
                GetClientRect(hwnd, &mut rect);
                FillRect(hdc, &rect, LIGHT_BRUSH);
                if BORDER_BRUSH != 0 {
                    FrameRect(hdc, &rect, BORDER_BRUSH);

                    // A single-line EDIT has no vertical-margin message. Draw its
                    // frame here, then center the borderless edit child to the font.
                    let dpi = get_window_dpi(hwnd);
                    let scale = |v: i32| -> i32 { (v * dpi as i32 + 48) / 96 };
                    let pad_x = scale(PROMPT_HORIZONTAL_INSET);
                    let input_height = scale(PROMPT_INPUT_HEIGHT);
                    let mut input_rect = RECT {
                        left: rect.left + pad_x,
                        top: rect.top + ((rect.bottom - rect.top - input_height) / 2),
                        right: rect.right - pad_x,
                        bottom: 0,
                    };
                    input_rect.bottom = input_rect.top + input_height;
                    FillRect(hdc, &input_rect, EDIT_BRUSH);
                    FrameRect(hdc, &input_rect, BORDER_BRUSH);
                }
                1
            }
            WM_CTLCOLOREDIT => {
                let hdc = wparam as HDC;
                SetTextColor(hdc, 0x001B1B1B);
                SetBkColor(hdc, 0x00FFFFFF);
                EDIT_BRUSH as LRESULT
            }
            WM_CTLCOLORSTATIC => {
                let hdc = wparam as HDC;
                SetTextColor(hdc, 0x005C5C5C);
                SetBkColor(hdc, 0x00F3F3F3);
                LIGHT_BRUSH as LRESULT
            }
            WM_SHOW_PROMPT => {
                crate::tray::pause_hotkeys();

                // Determine work area of active/foreground monitor for multi-monitor setups
                let fg = GetForegroundWindow();
                let mut monitor_info: MONITORINFO = std::mem::zeroed();
                monitor_info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

                let h_monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
                let workarea = if h_monitor != 0 && GetMonitorInfoW(h_monitor, &mut monitor_info) != 0 {
                    monitor_info.rcWork
                } else {
                    let mut wa: RECT = std::mem::zeroed();
                    SystemParametersInfoW(
                        SPI_GETWORKAREA,
                        0,
                        &mut wa as *mut _ as _,
                        0,
                    );
                    wa
                };

                // Move the window onto the foreground monitor first so its
                // per-monitor DPI query reflects the monitor the prompt will occupy.
                SetWindowPos(
                    hwnd,
                    0,
                    workarea.left,
                    workarea.top,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );

                // Scale dimensions according to Per-Monitor V2 DPI
                let dpi = get_window_dpi(hwnd);
                let scale = |v: i32| -> i32 { (v * dpi as i32 + 48) / 96 };

                let width = scale(PROMPT_WIDTH);
                let height = scale(PROMPT_HEIGHT);
                let margin_x = scale(PROMPT_SCREEN_MARGIN);
                let margin_y = scale(PROMPT_SCREEN_MARGIN);

                let geom = calculate_bottom_left_geometry(
                    workarea.left,
                    workarea.bottom,
                    width,
                    height,
                    margin_x,
                    margin_y,
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

                // Resize and reposition inner edit control for target DPI
                let edit = EDIT_HWND.load(Ordering::Acquire);
                if edit != 0 {
                    let pad_x = scale(PROMPT_HORIZONTAL_INSET);
                    let input_height = scale(PROMPT_INPUT_HEIGHT);
                    let border = scale(1).max(1);
                    let mut client_rect: RECT = std::mem::zeroed();
                    GetClientRect(hwnd, &mut client_rect);
                    let client_width = client_rect.right - client_rect.left;
                    let client_height = client_rect.bottom - client_rect.top;
                    let input_top = (client_height - input_height) / 2;
                    let inner_top = input_top + border;
                    let inner_height = input_height - (border * 2);
                    let edit_w = client_width - (pad_x * 2) - (border * 2);

                    let font_h = scale(PROMPT_FONT_HEIGHT);
                    let seg_font = CreateFontW(
                        -font_h, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0,
                        to_wide("Segoe UI Variable Text").as_ptr(),
                    );
                    if seg_font != 0 {
                        let previous_font = PROMPT_FONT;
                        PROMPT_FONT = seg_font as _;
                        SendMessageW(edit, 0x0030 /* WM_SETFONT */, PROMPT_FONT as _, 1);
                        if previous_font != 0 {
                            DeleteObject(previous_font as _);
                        }
                    }

                    let font = if PROMPT_FONT != 0 {
                        PROMPT_FONT
                    } else {
                        GetStockObject(DEFAULT_GUI_FONT as _) as HFONT
                    };
                    let text_h = get_font_line_height(edit, font, font_h).min(inner_height.max(1));
                    let edit_y = inner_top + ((inner_height - text_h) / 2);
                    SetWindowPos(
                        edit,
                        0,
                        pad_x + border,
                        edit_y,
                        edit_w,
                        text_h,
                        SWP_NOZORDER,
                    );

                    // Keep text and the caret comfortably inset from the edit edge.
                    let text_margin = scale(PROMPT_TEXT_MARGIN) as u32;
                    let margins = text_margin | (text_margin << 16);
                    SendMessageW(
                        edit,
                        0x00D3, // EM_SETMARGINS
                        0x0003,
                        margins as LPARAM,
                    );
                }

                ShowWindow(hwnd, SW_SHOW);

                // Safely attach thread input with RAII guard to guarantee focus without freezing
                let cur_thread = GetCurrentThreadId();
                let fg_thread = if fg != 0 {
                    GetWindowThreadProcessId(fg, std::ptr::null_mut())
                } else {
                    0
                };

                let _guard = if fg_thread != 0 && fg_thread != cur_thread && AttachThreadInput(cur_thread, fg_thread, 1) != 0 {
                    Some(ThreadInputGuard {
                        cur: cur_thread,
                        fg: fg_thread,
                    })
                } else {
                    None
                };

                if SetForegroundWindow(hwnd) == 0 {
                    keybd_event(0x12 /* VK_MENU */, 0, 0, 0);
                    keybd_event(0x12 /* VK_MENU */, 0, KEYEVENTF_KEYUP, 0);
                    SetForegroundWindow(hwnd);
                }
                BringWindowToTop(hwnd);

                if edit != 0 {
                    let (_, mode) = unpack_prompt_state(PROMPT_STATE.load(Ordering::Acquire));
                    SetWindowTextW(hwnd, to_wide(mode.prompt_title()).as_ptr());
                    SetWindowTextW(edit, to_wide("").as_ptr());
                    SetFocus(edit);
                    SendMessageW(edit, 0x00B1 /* EM_SETSEL */, 0, -1);
                }
                0
            }
            WM_LBUTTONDOWN => {
                // If user clicks the container margin, immediately refocus edit control
                let edit = EDIT_HWND.load(Ordering::Acquire);
                if edit != 0 {
                    SetFocus(edit);
                }
                0
            }
            WM_ACTIVATE => {
                let state = (wparam & 0xFFFF) as u16;
                if state == 0 {
                    // WA_INACTIVE: window losing activation to another top-level window
                    let activating_hwnd = lparam as HWND;
                    let edit_hwnd = EDIT_HWND.load(Ordering::Acquire);
                    if activating_hwnd != hwnd && activating_hwnd != edit_hwnd {
                        ShowWindow(hwnd, SW_HIDE);
                        crate::tray::resume_hotkeys();
                    }
                } else {
                    // Window becoming active: ensure edit control holds keyboard focus
                    let edit = EDIT_HWND.load(Ordering::Acquire);
                    if edit != 0 {
                        SetFocus(edit);
                    }
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_CLOSE => {
                ShowWindow(hwnd, SW_HIDE);
                crate::tray::resume_hotkeys();
                0
            }
            WM_DESTROY => {
                let edit_hwnd = EDIT_HWND.load(Ordering::Acquire);
                let orig_proc = ORIG_EDIT_PROC.load(Ordering::Acquire);
                if edit_hwnd != 0 && orig_proc != 0 {
                    SetWindowLongPtrW(edit_hwnd, GWLP_WNDPROC, orig_proc);
                }
                if PROMPT_FONT != 0 {
                    DeleteObject(PROMPT_FONT as _);
                    PROMPT_FONT = 0;
                }
                if LIGHT_BRUSH != 0 {
                    DeleteObject(LIGHT_BRUSH as _);
                    LIGHT_BRUSH = 0;
                }
                if EDIT_BRUSH != 0 {
                    DeleteObject(EDIT_BRUSH as _);
                    EDIT_BRUSH = 0;
                }
                if BORDER_BRUSH != 0 {
                    DeleteObject(BORDER_BRUSH as _);
                    BORDER_BRUSH = 0;
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
                        style: CS_DROPSHADOW,
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
                        PROMPT_WIDTH,
                        PROMPT_HEIGHT,
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
        PROMPT_STATE.store(pack_prompt_state(port, mode), Ordering::Release);
        ensure_window_initialized();

        let hwnd = PROMPT_HWND.load(Ordering::Acquire);
        if hwnd != 0 {
            unsafe {
                AllowSetForegroundWindow(0xFFFF_FFFF /* ASFW_ANY */);
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

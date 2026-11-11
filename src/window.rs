use anyhow::Result;

#[allow(dead_code)]
pub fn format_window_url(port: u16) -> String {
    format!("http://localhost:{}/", port)
}

#[allow(dead_code)]
pub fn default_window_size() -> (i32, i32) {
    (1200, 800)
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::mpsc::sync_channel;
    use tracing::{error, info, warn};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::CreateSolidBrush;
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowW,
        GetClientRect, GetMessageW, LoadCursorW, LoadIconW, LoadImageW, PostMessageW,
        PostQuitMessage, RegisterClassW, SetForegroundWindow, ShowWindow, TranslateMessage,
        CW_USEDEFAULT, IDC_ARROW, IDI_APPLICATION, IMAGE_ICON, LR_LOADFROMFILE, MSG, SW_HIDE,
        SW_RESTORE, SW_SHOW, WM_CLOSE, WM_CREATE, WM_DESTROY, WM_SIZE, WM_USER, WNDCLASSW,
        WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    pub const WINDOW_CLASS_NAME: &str = "BabaTtsMainWindowClass";
    pub const WINDOW_TITLE: &str = "BABA TTS - Streamer Control Panel";
    pub const WM_USER_FOCUS_WINDOW: u32 = WM_USER + 101;
    pub const WM_USER_CLOSE: u32 = WM_USER + 102;

    // Global controller storage for resizing and lifecycle
    static CONTROLLER_PTR: AtomicIsize = AtomicIsize::new(0);

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe fn load_icon() -> windows_sys::Win32::UI::WindowsAndMessaging::HICON {
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

        let h_inst = GetModuleHandleW(std::ptr::null());
        let res_icon = LoadIconW(h_inst, 1 as _);
        if res_icon != 0 {
            return res_icon;
        }

        LoadIconW(0, IDI_APPLICATION)
    }

    unsafe fn enable_dark_caption(hwnd: HWND) {
        let dwm = LoadLibraryW(to_wide("dwmapi.dll").as_ptr());
        if dwm != 0 {
            let proc = GetProcAddress(dwm, b"DwmSetWindowAttribute\0".as_ptr());
            if let Some(dwm_set_attr) = proc {
                type DwmSetWindowAttributeFn = unsafe extern "system" fn(
                    HWND,
                    u32,
                    *const std::ffi::c_void,
                    u32,
                ) -> i32;
                let func: DwmSetWindowAttributeFn = std::mem::transmute(dwm_set_attr);
                let dark_mode: i32 = 1;
                // DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (Windows 10 20H1+ and Windows 11)
                let _ = func(
                    hwnd,
                    20,
                    &dark_mode as *const i32 as *const std::ffi::c_void,
                    std::mem::size_of::<i32>() as u32,
                );
                // DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19 (Windows 10 1809 - 1909)
                let _ = func(
                    hwnd,
                    19,
                    &dark_mode as *const i32 as *const std::ffi::c_void,
                    std::mem::size_of::<i32>() as u32,
                );
            }
        }
    }

    // COM Virtual Method Tables for WebView2
    #[repr(C)]
    struct IUnknownVtbl {
        query_interface: unsafe extern "system" fn(*mut std::ffi::c_void, *const std::ffi::c_void, *mut *mut std::ffi::c_void) -> i32,
        add_ref: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
        release: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32,
    }

    // ICoreWebView2Settings terminates at slot 20 (put_is_built_in_error_page_enabled)
    #[repr(C)]
    struct ICoreWebView2SettingsVtbl {
        unknown: IUnknownVtbl,
        get_is_script_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_is_script_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_is_web_message_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_is_web_message_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_are_default_script_dialogs_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_are_default_script_dialogs_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_is_status_bar_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_is_status_bar_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_are_dev_tools_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_are_dev_tools_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_are_default_context_menus_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_are_default_context_menus_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_are_host_objects_allowed: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_are_host_objects_allowed: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_is_zoom_control_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_is_zoom_control_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_is_built_in_error_page_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_is_built_in_error_page_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
    }

    // ICoreWebView2Settings3: {FDB5AB74-AF33-4854-84F0-0A631DEB5EBA}
    #[repr(C)]
    struct ICoreWebView2Settings3Vtbl {
        settings: ICoreWebView2SettingsVtbl,
        get_user_agent: unsafe extern "system" fn(*mut std::ffi::c_void, *mut *mut u16) -> i32,
        put_user_agent: unsafe extern "system" fn(*mut std::ffi::c_void, *const u16) -> i32,
        get_are_browser_accelerator_keys_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_are_browser_accelerator_keys_enabled: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
    }

    #[repr(C)]
    struct ICoreWebView2Vtbl {
        unknown: IUnknownVtbl,
        get_settings: unsafe extern "system" fn(*mut std::ffi::c_void, *mut *mut std::ffi::c_void) -> i32,
        get_source: unsafe extern "system" fn(*mut std::ffi::c_void, *mut *mut u16) -> i32,
        navigate: unsafe extern "system" fn(*mut std::ffi::c_void, *const u16) -> i32,
    }

    #[repr(C)]
    struct ICoreWebView2ControllerVtbl {
        unknown: IUnknownVtbl,
        get_is_visible: unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> i32,
        put_is_visible: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        get_bounds: unsafe extern "system" fn(*mut std::ffi::c_void, *mut RECT) -> i32,
        put_bounds: unsafe extern "system" fn(*mut std::ffi::c_void, RECT) -> i32,
        get_zoom_factor: unsafe extern "system" fn(*mut std::ffi::c_void, *mut f64) -> i32,
        put_zoom_factor: unsafe extern "system" fn(*mut std::ffi::c_void, f64) -> i32,
        add_zoom_factor_changed: unsafe extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut i64) -> i32,
        remove_zoom_factor_changed: unsafe extern "system" fn(*mut std::ffi::c_void, i64) -> i32,
        set_bounds_and_zoom_factor: unsafe extern "system" fn(*mut std::ffi::c_void, RECT, f64) -> i32,
        move_focus: unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32,
        add_move_focus_requested: unsafe extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut i64) -> i32,
        remove_move_focus_requested: unsafe extern "system" fn(*mut std::ffi::c_void, i64) -> i32,
        add_got_focus: unsafe extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut i64) -> i32,
        remove_got_focus: unsafe extern "system" fn(*mut std::ffi::c_void, i64) -> i32,
        add_lost_focus: unsafe extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut i64) -> i32,
        remove_lost_focus: unsafe extern "system" fn(*mut std::ffi::c_void, i64) -> i32,
        add_accelerator_key_pressed: unsafe extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *mut i64) -> i32,
        remove_accelerator_key_pressed: unsafe extern "system" fn(*mut std::ffi::c_void, i64) -> i32,
        get_parent_window: unsafe extern "system" fn(*mut std::ffi::c_void, *mut HWND) -> i32,
        put_parent_window: unsafe extern "system" fn(*mut std::ffi::c_void, HWND) -> i32,
        notify_parent_window_position_changed: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
        close: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
        get_core_webview2: unsafe extern "system" fn(*mut std::ffi::c_void, *mut *mut std::ffi::c_void) -> i32,
    }

    #[repr(C)]
    struct ICoreWebView2EnvironmentVtbl {
        unknown: IUnknownVtbl,
        create_core_webview2_controller: unsafe extern "system" fn(
            *mut std::ffi::c_void,
            HWND,
            *mut std::ffi::c_void,
        ) -> i32,
    }

    // Handlers
    #[repr(C)]
    struct ControllerCompletedHandler {
        vtbl: &'static ControllerCompletedHandlerVtbl,
        hwnd: HWND,
        port: u16,
    }

    #[repr(C)]
    struct ControllerCompletedHandlerVtbl {
        unknown: IUnknownVtbl,
        invoke: unsafe extern "system" fn(*mut std::ffi::c_void, i32, *mut std::ffi::c_void) -> i32,
    }

    unsafe extern "system" fn controller_query_interface(
        this: *mut std::ffi::c_void,
        _riid: *const std::ffi::c_void,
        ppv: *mut *mut std::ffi::c_void,
    ) -> i32 {
        if ppv.is_null() {
            return 0x80004003u32 as i32; // E_POINTER
        }
        *ppv = this;
        0 // S_OK
    }

    unsafe extern "system" fn handler_add_ref(_this: *mut std::ffi::c_void) -> u32 {
        2
    }

    unsafe extern "system" fn handler_release(_this: *mut std::ffi::c_void) -> u32 {
        1
    }

    unsafe extern "system" fn controller_invoke(
        this: *mut std::ffi::c_void,
        error_code: i32,
        controller: *mut std::ffi::c_void,
    ) -> i32 {
        let handler = &*(this as *const ControllerCompletedHandler);
        if error_code < 0 || controller.is_null() {
            error!("[Window] Failed to create WebView2 controller: error_code = {:#x}. Opening in default browser.", error_code);
            ShowWindow(handler.hwnd, SW_HIDE);
            let url = format_window_url(handler.port);
            let _ = open::that(&url);
            return 0;
        }

        info!("[Window] WebView2 controller created successfully");
        let ctrl_vtbl = *(controller as *mut *mut ICoreWebView2ControllerVtbl);
        // Retain reference on controller for CONTROLLER_PTR global storage
        ((*ctrl_vtbl).unknown.add_ref)(controller);
        CONTROLLER_PTR.store(controller as isize, Ordering::SeqCst);
        ((*ctrl_vtbl).put_is_visible)(controller, 1);

        let mut rect: RECT = std::mem::zeroed();
        GetClientRect(handler.hwnd, &mut rect);
        ((*ctrl_vtbl).put_bounds)(controller, rect);

        let mut webview: *mut std::ffi::c_void = std::ptr::null_mut();
        ((*ctrl_vtbl).get_core_webview2)(controller, &mut webview);

        if !webview.is_null() {
            let webview_vtbl = *(webview as *mut *mut ICoreWebView2Vtbl);

            let mut settings: *mut std::ffi::c_void = std::ptr::null_mut();
            ((*webview_vtbl).get_settings)(webview, &mut settings);

            if !settings.is_null() {
                let settings_vtbl = *(settings as *mut *mut ICoreWebView2SettingsVtbl);
                ((*settings_vtbl).put_is_status_bar_enabled)(settings, 0);
                ((*settings_vtbl).put_are_default_context_menus_enabled)(settings, 0);

                // Query ICoreWebView2Settings3: {FDB5AB74-AF33-4854-84F0-0A631DEB5EBA}
                let mut settings3: *mut std::ffi::c_void = std::ptr::null_mut();
                let iid_settings3: [u8; 16] = [
                    0x74, 0xab, 0xb5, 0xfd, 0x33, 0xaf, 0x54, 0x48,
                    0x84, 0xf0, 0x0a, 0x63, 0x1d, 0xeb, 0x5e, 0xba,
                ];
                let qi_res = ((*settings_vtbl).unknown.query_interface)(
                    settings,
                    iid_settings3.as_ptr() as _,
                    &mut settings3,
                );
                if qi_res >= 0 && !settings3.is_null() {
                    let settings3_vtbl = *(settings3 as *mut *mut ICoreWebView2Settings3Vtbl);
                    ((*settings3_vtbl).put_are_browser_accelerator_keys_enabled)(settings3, 0);
                    ((*settings3_vtbl).settings.unknown.release)(settings3);
                }

                // Release ICoreWebView2Settings reference (+1 returned by get_settings)
                ((*settings_vtbl).unknown.release)(settings);
            }

            let url = format_window_url(handler.port);
            let wide_url = to_wide(&url);
            ((*webview_vtbl).navigate)(webview, wide_url.as_ptr());
            info!("[Window] WebView2 navigated to {}", url);

            // Release ICoreWebView2 reference (+1 returned by get_core_webview2)
            ((*webview_vtbl).unknown.release)(webview);
        }

        0
    }

    static CONTROLLER_HANDLER_VTBL: ControllerCompletedHandlerVtbl = ControllerCompletedHandlerVtbl {
        unknown: IUnknownVtbl {
            query_interface: controller_query_interface,
            add_ref: handler_add_ref,
            release: handler_release,
        },
        invoke: controller_invoke,
    };

    #[repr(C)]
    struct EnvCompletedHandler {
        vtbl: &'static EnvCompletedHandlerVtbl,
        hwnd: HWND,
        port: u16,
    }

    #[repr(C)]
    struct EnvCompletedHandlerVtbl {
        unknown: IUnknownVtbl,
        invoke: unsafe extern "system" fn(*mut std::ffi::c_void, i32, *mut std::ffi::c_void) -> i32,
    }

    unsafe extern "system" fn env_invoke(
        this: *mut std::ffi::c_void,
        error_code: i32,
        env: *mut std::ffi::c_void,
    ) -> i32 {
        let handler = &*(this as *const EnvCompletedHandler);
        if error_code < 0 || env.is_null() {
            error!("[Window] Failed to create WebView2 environment: error_code = {:#x}. Opening in default browser.", error_code);
            ShowWindow(handler.hwnd, SW_HIDE);
            let url = format_window_url(handler.port);
            let _ = open::that(&url);
            return 0;
        }

        info!("[Window] WebView2 environment created successfully");
        let env_vtbl = *(env as *mut *mut ICoreWebView2EnvironmentVtbl);

        let controller_handler = Box::new(ControllerCompletedHandler {
            vtbl: &CONTROLLER_HANDLER_VTBL,
            hwnd: handler.hwnd,
            port: handler.port,
        });

        ((*env_vtbl).create_core_webview2_controller)(
            env,
            handler.hwnd,
            Box::into_raw(controller_handler) as _,
        );

        0
    }

    static ENV_HANDLER_VTBL: EnvCompletedHandlerVtbl = EnvCompletedHandlerVtbl {
        unknown: IUnknownVtbl {
            query_interface: controller_query_interface,
            add_ref: handler_add_ref,
            release: handler_release,
        },
        invoke: env_invoke,
    };

    #[cfg(target_arch = "x86_64")]
    const WEBVIEW2_LOADER_BYTES: &[u8] = include_bytes!("../assets/x64/WebView2Loader.dll");

    #[cfg(target_arch = "x86")]
    const WEBVIEW2_LOADER_BYTES: &[u8] = include_bytes!("../assets/x86/WebView2Loader.dll");

    #[cfg(target_arch = "aarch64")]
    const WEBVIEW2_LOADER_BYTES: &[u8] = include_bytes!("../assets/arm64/WebView2Loader.dll");

    #[cfg(not(any(target_arch = "x86_64", target_arch = "x86", target_arch = "aarch64")))]
    const WEBVIEW2_LOADER_BYTES: &[u8] = include_bytes!("../assets/x64/WebView2Loader.dll");

    unsafe fn ensure_webview2_loader() -> windows_sys::Win32::Foundation::HMODULE {
        // 1. Try standard library search path (e.g. adjacent to binary or system PATH)
        let direct = LoadLibraryW(to_wide("WebView2Loader.dll").as_ptr());
        if direct != 0 {
            return direct;
        }

        // 2. Try adjacent to current executable (and extract if missing)
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join("WebView2Loader.dll");
                if candidate.exists() {
                    let h = LoadLibraryW(to_wide(&candidate.to_string_lossy()).as_ptr());
                    if h != 0 {
                        return h;
                    }
                }
                // Attempt self-extraction next to executable
                if std::fs::write(&candidate, WEBVIEW2_LOADER_BYTES).is_ok() {
                    let h = LoadLibraryW(to_wide(&candidate.to_string_lossy()).as_ptr());
                    if h != 0 {
                        return h;
                    }
                }
            }
        }

        // 3. Fallback extraction: %TEMP%\baba-tts\WebView2Loader.dll
        let temp_dir = std::env::temp_dir().join("baba-tts");
        let _ = std::fs::create_dir_all(&temp_dir);
        let temp_loader = temp_dir.join("WebView2Loader.dll");
        if temp_loader.exists() {
            let h = LoadLibraryW(to_wide(&temp_loader.to_string_lossy()).as_ptr());
            if h != 0 {
                return h;
            }
        }
        if std::fs::write(&temp_loader, WEBVIEW2_LOADER_BYTES).is_ok() {
            let h = LoadLibraryW(to_wide(&temp_loader.to_string_lossy()).as_ptr());
            if h != 0 {
                return h;
            }
        }

        0
    }

    unsafe fn attach_webview2(hwnd: HWND, port: u16) {
        let loader = ensure_webview2_loader();
        if loader == 0 {
            warn!("[Window] WebView2Loader.dll not available. Opening dashboard in default browser.");
            ShowWindow(hwnd, SW_HIDE);
            let url = format_window_url(port);
            let _ = open::that(&url);
            return;
        }

        let create_env = GetProcAddress(loader, b"CreateCoreWebView2EnvironmentWithOptions\0".as_ptr());
        let Some(proc) = create_env else {
            warn!("[Window] CreateCoreWebView2EnvironmentWithOptions symbol missing. Opening in default browser.");
            ShowWindow(hwnd, SW_HIDE);
            let url = format_window_url(port);
            let _ = open::that(&url);
            return;
        };

        type CreateEnvFn = unsafe extern "system" fn(
            *const u16,
            *const u16,
            *mut std::ffi::c_void,
            *mut std::ffi::c_void,
        ) -> i32;
        let func: CreateEnvFn = std::mem::transmute(proc);

        // Resolve writable user data directory in LOCALAPPDATA or TEMP to avoid permissions failures
        let user_data_dir = std::env::var("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("baba-tts")
            .join("WebView2Data");
        let _ = std::fs::create_dir_all(&user_data_dir);
        let wide_user_data = to_wide(&user_data_dir.to_string_lossy());

        let handler = Box::new(EnvCompletedHandler {
            vtbl: &ENV_HANDLER_VTBL,
            hwnd,
            port,
        });

        let res = func(
            std::ptr::null(),
            wide_user_data.as_ptr(),
            std::ptr::null_mut(),
            Box::into_raw(handler) as _,
        );
        if res < 0 {
            error!("[Window] CreateCoreWebView2EnvironmentWithOptions returned {:#x}. Opening in default browser.", res);
            ShowWindow(hwnd, SW_HIDE);
            let url = format_window_url(port);
            let _ = open::that(&url);
        }
    }

    unsafe extern "system" fn main_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_CREATE => {
                enable_dark_caption(hwnd);
                0
            }
            WM_SIZE => {
                let ctrl_ptr = CONTROLLER_PTR.load(Ordering::SeqCst) as *mut std::ffi::c_void;
                if !ctrl_ptr.is_null() {
                    let ctrl_vtbl = *(ctrl_ptr as *mut *mut ICoreWebView2ControllerVtbl);
                    let mut rect: RECT = std::mem::zeroed();
                    GetClientRect(hwnd, &mut rect);
                    ((*ctrl_vtbl).put_bounds)(ctrl_ptr, rect);
                }
                0
            }
            WM_USER_FOCUS_WINDOW => {
                ShowWindow(hwnd, SW_RESTORE);
                ShowWindow(hwnd, SW_SHOW);
                SetForegroundWindow(hwnd);
                0
            }
            WM_CLOSE => {
                // Minimize to tray on close [X]
                ShowWindow(hwnd, SW_HIDE);
                0
            }
            WM_USER_CLOSE => {
                // Proper window teardown requested on Drop
                DestroyWindow(hwnd);
                0
            }
            WM_DESTROY => {
                let ctrl_ptr = CONTROLLER_PTR.swap(0, Ordering::SeqCst) as *mut std::ffi::c_void;
                if !ctrl_ptr.is_null() {
                    let ctrl_vtbl = *(ctrl_ptr as *mut *mut ICoreWebView2ControllerVtbl);
                    ((*ctrl_vtbl).close)(ctrl_ptr);
                    ((*ctrl_vtbl).unknown.release)(ctrl_ptr);
                }
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    pub struct DesktopWindow {
        hwnd: HWND,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for DesktopWindow {
        fn drop(&mut self) {
            if self.hwnd != 0 {
                unsafe {
                    PostMessageW(self.hwnd, WM_USER_CLOSE, 0, 0);
                }
            }
            if let Some(th) = self.thread.take() {
                let _ = th.join();
            }
        }
    }

    pub fn create_desktop_window(port: u16) -> Result<DesktopWindow> {
        let (tx, rx) = sync_channel::<HWND>(1);

        let thread = std::thread::Builder::new()
            .name("baba-desktop-window".to_string())
            .spawn(move || unsafe {
                // Initialize Single-Threaded Apartment (STA) for WebView2 and COM
                let ole32 = LoadLibraryW(to_wide("ole32.dll").as_ptr());
                if ole32 != 0 {
                    let co_init = GetProcAddress(ole32, b"CoInitializeEx\0".as_ptr());
                    if let Some(co_init_fn) = co_init {
                        type CoInitializeExFn = unsafe extern "system" fn(*mut std::ffi::c_void, u32) -> i32;
                        let func: CoInitializeExFn = std::mem::transmute(co_init_fn);
                        func(std::ptr::null_mut(), 0x2 /* COINIT_APARTMENTTHREADED */);
                    }
                }

                let h_instance = GetModuleHandleW(std::ptr::null());
                let class_name = to_wide(WINDOW_CLASS_NAME);

                let wc = WNDCLASSW {
                    style: 0,
                    lpfnWndProc: Some(main_wndproc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: h_instance,
                    hIcon: load_icon(),
                    hCursor: LoadCursorW(0, IDC_ARROW),
                    hbrBackground: CreateSolidBrush(0x00190f0b),
                    lpszMenuName: std::ptr::null(),
                    lpszClassName: class_name.as_ptr(),
                };

                RegisterClassW(&wc);

                let (width, height) = default_window_size();
                let hwnd = CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    to_wide(WINDOW_TITLE).as_ptr(),
                    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    CW_USEDEFAULT,
                    CW_USEDEFAULT,
                    width,
                    height,
                    0,
                    0,
                    h_instance,
                    std::ptr::null(),
                );

                if hwnd == 0 {
                    error!("[Window] Failed to create main application window");
                    let _ = tx.send(0);
                    return;
                }

                attach_webview2(hwnd, port);
                let _ = tx.send(hwnd);

                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                // Uninitialize COM before thread exit
                if ole32 != 0 {
                    let co_uninit = GetProcAddress(ole32, b"CoUninitialize\0".as_ptr());
                    if let Some(co_uninit_fn) = co_uninit {
                        type CoUninitializeFn = unsafe extern "system" fn();
                        let func: CoUninitializeFn = std::mem::transmute(co_uninit_fn);
                        func();
                    }
                }
            })
            .map_err(|e| anyhow::anyhow!("Failed to spawn desktop window thread: {}", e))?;

        let hwnd = rx
            .recv()
            .map_err(|e| anyhow::anyhow!("Failed to receive main window handle: {}", e))?;

        if hwnd == 0 {
            return Err(anyhow::anyhow!("CreateWindowExW failed for desktop window"));
        }

        Ok(DesktopWindow {
            hwnd,
            thread: Some(thread),
        })
    }

    pub fn focus_existing_window() -> bool {
        unsafe {
            let class_name = to_wide(WINDOW_CLASS_NAME);
            let hwnd = FindWindowW(class_name.as_ptr(), std::ptr::null());
            if hwnd != 0 {
                PostMessageW(hwnd, WM_USER_FOCUS_WINDOW, 0, 0);
                SetForegroundWindow(hwnd);
                true
            } else {
                false
            }
        }
    }

    pub fn restore_and_focus_window(port: u16) -> bool {
        if focus_existing_window() {
            true
        } else {
            let url = format_window_url(port);
            let _ = open::that(&url);
            true
        }
    }
}

#[cfg(not(windows))]
mod non_windows {
    use super::*;

    pub struct DesktopWindow;

    pub fn create_desktop_window(port: u16) -> Result<DesktopWindow> {
        tracing::info!(
            "[Window] Desktop window is mocked on non-Windows platforms (URL: {})",
            format_window_url(port)
        );
        Ok(DesktopWindow)
    }

    pub fn focus_existing_window() -> bool {
        tracing::info!("[Window] focus_existing_window mocked on non-Windows");
        false
    }

    pub fn restore_and_focus_window(_port: u16) -> bool {
        tracing::info!("[Window] restore_and_focus_window mocked on non-Windows");
        false
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
    fn test_desktop_window_url_generation() {
        assert_eq!(format_window_url(7060), "http://localhost:7060/");
        assert_eq!(format_window_url(7080), "http://localhost:7080/");
    }

    #[test]
    fn test_desktop_window_dimensions() {
        let (width, height) = default_window_size();
        assert!(width >= 960);
        assert!(height >= 600);
        assert_eq!(width, 1200);
        assert_eq!(height, 800);
    }

    #[test]
    fn test_non_windows_desktop_window_stubs() {
        #[cfg(not(windows))]
        {
            let res = create_desktop_window(7060);
            assert!(res.is_ok());
            assert!(!focus_existing_window());
            assert!(!restore_and_focus_window(7060));
        }
    }
}

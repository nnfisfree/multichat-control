//! The main window's behaviour: see-through opacity, the close button, the tray icon, exiting.
//!
//! Closing is decided by the engine (it knows the "When closing the window" setting and can ask
//! the question in the app's own style). The core only reports the request and carries it out.

use crate::storage::log;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

const MIN_OPACITY: f64 = 0.05;
const TRAY_ID: &str = "main-tray";

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Brings the window back from the tray or the taskbar.
pub fn show(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Sends close requests (X button, Alt+F4, the taskbar) to the engine instead of closing.
pub fn watch_close(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = app.emit("app:close-requested", ());
        }
    });
}

/// See-through window, from 5% (never fully invisible) to 100%.
#[tauri::command]
pub fn window_opacity(app: AppHandle, value: f64) {
    let alpha = (value.clamp(MIN_OPACITY, 1.0) * 255.0).round() as u8;
    #[cfg(windows)]
    if let Some(Ok(hwnd)) = main_window(&app).map(|w| w.hwnd()) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED};
        let h = hwnd.0 as windows_sys::Win32::Foundation::HWND;
        unsafe {
            let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
            if style & WS_EX_LAYERED as isize == 0 {
                SetWindowLongPtrW(h, GWL_EXSTYLE, style | WS_EX_LAYERED as isize);
            }
            SetLayeredWindowAttributes(h, 0, alpha, LWA_ALPHA);
        }
    }
    #[cfg(not(windows))]
    let _ = (app, alpha);
}

fn ensure_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("NoName's Multichat Control")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show(app),
            "exit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Hides the window to the tray; chat stays connected in the background.
#[tauri::command]
pub fn window_to_tray(app: AppHandle) -> Result<(), String> {
    ensure_tray(&app).map_err(|e| e.to_string())?;
    if let Some(w) = main_window(&app) {
        let _ = w.hide();
    }
    Ok(())
}

/// Asks the engine to save what's waiting and exit. If it can't answer, the app exits anyway.
pub fn request_quit(app: &AppHandle) {
    let _ = app.emit("app:quit", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        app.exit(0);
    });
}

/// Called by the engine once everything is saved.
#[tauri::command]
pub fn app_exit(app: AppHandle) {
    log("app", "exit");
    app.exit(0);
}

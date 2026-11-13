//! The main window's behaviour: see-through opacity, the close button, the tray icon, exiting.
//!
//! Closing is decided by the engine (it knows the "When closing the window" setting and can ask
//! the question in the app's own style). The core only reports the request and carries it out.

use crate::placement;
use crate::storage::log;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
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
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = main_window(&handle) {
            let _ = w.unminimize();
            set_shown(&w, true);
            let _ = w.set_focus();
            apply_opacity(&w);
        }
    });
}

/// Shows or hides the window, and checks Windows really did it. Tauri only acts when its own
/// record of the window changes, and that record can drift from what is on screen (a hidden
/// window shown by Windows itself, for one): then hide() or show() silently does nothing, which
/// left the X button dead when it was set to the tray. Flipping the record and back makes Tauri
/// act again. Must run on the main thread, where hide() and show() take effect at once.
fn set_shown(w: &WebviewWindow, visible: bool) {
    let flip = |v: bool| if v { w.show() } else { w.hide() };
    let _ = flip(visible);
    if w.is_visible().unwrap_or(visible) != visible {
        log("window", &format!("{} did nothing, so the window state was resynced", if visible { "show" } else { "hide" }));
        let _ = flip(!visible);
        let _ = flip(visible);
    }
}

/// Sends close requests (X button, Alt+F4, the taskbar) to the engine instead of closing.
pub fn watch_close(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let win = window.clone();
    window.on_window_event(move |e| match e {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = app.emit("app:close-requested", ());
        }
        // Maximizing, restoring and similar changes rewrite the window's style and drop
        // see-through, so it is put back after each of them.
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            apply_opacity(&win);
            placement::changed(&win);
        }
        WindowEvent::Focused(_) => apply_opacity(&win),
        // The window's place is kept for the next start.
        WindowEvent::Moved(_) => placement::changed(&win),
        _ => {}
    });
}

/// The chosen opacity, 0 to 255. Kept here so it can be put back whenever Windows loses it.
static ALPHA: AtomicU8 = AtomicU8::new(255);

/// The chosen opacity, 0 to 255.
pub fn alpha() -> u8 {
    ALPHA.load(Ordering::Relaxed)
}

/// See-through window, from 5% (never fully invisible) to 100%.
#[tauri::command]
pub fn window_opacity(app: AppHandle, value: f64) {
    let alpha = (value.clamp(MIN_OPACITY, 1.0) * 255.0).round() as u8;
    ALPHA.store(alpha, Ordering::Relaxed);
    if let Some(w) = main_window(&app) {
        apply_opacity(&w);
    }
}

/// Set while the wobbly window effect draws the window: the real window is then almost fully
/// see-through (but still takes clicks) under the effect's picture.
static VEILED: AtomicBool = AtomicBool::new(false);

/// Sets the window's see-through level, adding the layered style if Windows dropped it.
fn apply_opacity(w: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        apply_alpha(hwnd.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = w;
}

/// Hides the window under the wobbly effect's picture, or brings it back. It stays clickable.
#[cfg(windows)]
pub fn veil(hwnd: isize, on: bool) {
    VEILED.store(on, Ordering::Relaxed);
    apply_alpha(hwnd);
}

#[cfg(windows)]
fn apply_alpha(hwnd: isize) {
    // 1, not 0: Windows sends no clicks to a fully see-through window.
    let alpha = if VEILED.load(Ordering::Relaxed) { 1 } else { ALPHA.load(Ordering::Relaxed) };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetLayeredWindowAttributes, GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED};
    let h = hwnd as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let layered = style & WS_EX_LAYERED as isize != 0;
        // Fully opaque and never made see-through: nothing to do.
        if alpha == 255 && !layered {
            return;
        }
        if !layered {
            SetWindowLongPtrW(h, GWL_EXSTYLE, style | WS_EX_LAYERED as isize);
        } else {
            let (mut key, mut current, mut flags) = (0u32, 0u8, 0u32);
            if GetLayeredWindowAttributes(h, &mut key, &mut current, &mut flags) != 0 && flags & LWA_ALPHA != 0 && current == alpha {
                return;
            }
        }
        SetLayeredWindowAttributes(h, 0, alpha, LWA_ALPHA);
    }
}

fn ensure_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Multichat Control")
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
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(w) = main_window(&handle) {
            set_shown(&w, false);
        }
    })
    .map_err(|e| e.to_string())
}

/// Asks the engine to save what's waiting and exit. If it can't answer, the app exits anyway.
pub fn request_quit(app: &AppHandle) {
    guard_quit(app);
    let _ = app.emit("app:quit", ());
}

/// However closing was started, the app is gone within a few seconds: if saving hangs or the
/// engine never answers, the process ends here.
fn guard_quit(app: &AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        log("app", "exit (forced: shutting down took too long)");
        placement::flush();
        app.exit(0);
        std::thread::sleep(std::time::Duration::from_secs(2));
        std::process::exit(0);
    });
}

/// The engine is about to save and exit: from here the app always closes.
#[tauri::command]
pub fn app_quitting(app: AppHandle) {
    guard_quit(&app);
}

/// The title bar's X, sent the same way as Alt+F4 so both always behave the same.
#[tauri::command]
pub fn window_close(app: AppHandle) {
    log("app", "close button");
    let _ = app.emit("app:close-requested", ());
}

/// Called by the engine once everything is saved. Exiting happens off the page's call, so the
/// page answering can never hold it up.
#[tauri::command]
pub fn app_exit(app: AppHandle) {
    log("app", "exit");
    placement::flush();
    guard_quit(&app);
    std::thread::spawn(move || app.exit(0));
}

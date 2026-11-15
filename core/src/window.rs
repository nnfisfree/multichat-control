//! Main window behaviour: opacity, the close button, the tray icon, quitting.
//!
//! What closing does is decided by the engine (it knows the "When closing the window" setting and
//! can ask in the app's own style). Rust just reports the request and carries out the answer.

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

/// Brings the window back from the tray or taskbar.
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

/// Shows/hides the window and checks that Windows actually did it. Tauri only acts when its own
/// idea of the window's visibility changes, and that can drift from what's really on screen (e.g.
/// Windows itself showing a hidden window). When it drifts, hide()/show() silently do nothing, which
/// left the X button dead with "close to tray" on. Flipping the state and back forces Tauri to act.
/// Must run on the main thread, where hide()/show() take effect immediately.
fn set_shown(w: &WebviewWindow, visible: bool) {
    let flip = |v: bool| if v { w.show() } else { w.hide() };
    let _ = flip(visible);
    if w.is_visible().unwrap_or(visible) != visible {
        log("window", &format!("{} did nothing, so the window state was resynced", if visible { "show" } else { "hide" }));
        let _ = flip(!visible);
        let _ = flip(visible);
    }
}

/// Routes close requests (X button, Alt+F4, taskbar) to the engine instead of closing.
pub fn watch_close(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let win = window.clone();
    window.on_window_event(move |e| match e {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = app.emit("app:close-requested", ());
        }
        // Maximize/restore and friends rewrite the window style and drop the layered (opacity)
        // flag, so put it back after each one.
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            apply_opacity(&win);
            placement::changed(&win);
        }
        WindowEvent::Focused(_) => apply_opacity(&win),
        // remember the placement for next start
        WindowEvent::Moved(_) => placement::changed(&win),
        _ => {}
    });
}

/// Chosen opacity, 0-255. Kept here so we can reapply it whenever Windows drops it.
static ALPHA: AtomicU8 = AtomicU8::new(255);

pub fn alpha() -> u8 {
    ALPHA.load(Ordering::Relaxed)
}

/// Window opacity, from 5% (never fully invisible) to 100%.
#[tauri::command]
pub fn window_opacity(app: AppHandle, value: f64) {
    let alpha = (value.clamp(MIN_OPACITY, 1.0) * 255.0).round() as u8;
    ALPHA.store(alpha, Ordering::Relaxed);
    if let Some(w) = main_window(&app) {
        apply_opacity(&w);
    }
}

/// Set while the wobbly effect is drawing the window: the real window is then almost fully
/// transparent (but still takes clicks) underneath the effect's snapshot.
static VEILED: AtomicBool = AtomicBool::new(false);

/// Applies the opacity, re-adding WS_EX_LAYERED if Windows dropped it.
fn apply_opacity(w: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = w.hwnd() {
        apply_alpha(hwnd.0 as isize);
    }
    #[cfg(not(windows))]
    let _ = w;
}

/// Hides the window under the wobbly effect's snapshot, or brings it back. Stays clickable.
#[cfg(windows)]
pub fn veil(hwnd: isize, on: bool) {
    VEILED.store(on, Ordering::Relaxed);
    apply_alpha(hwnd);
}

#[cfg(windows)]
fn apply_alpha(hwnd: isize) {
    // 1, not 0: Windows doesn't send clicks to a fully transparent window
    let alpha = if VEILED.load(Ordering::Relaxed) { 1 } else { ALPHA.load(Ordering::Relaxed) };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetLayeredWindowAttributes, GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED};
    let h = hwnd as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let layered = style & WS_EX_LAYERED as isize != 0;
        // fully opaque and never layered, nothing to do
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

/// Hides to the tray; chat stays connected in the background.
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

/// Asks the engine to flush and exit. If it doesn't answer, we exit anyway.
pub fn request_quit(app: &AppHandle) {
    guard_quit(app);
    let _ = app.emit("app:quit", ());
}

/// However quitting started, the process is gone within a few seconds. If saving hangs or the
/// engine never answers, we end it here.
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

/// Engine is about to flush and exit; from here on the app always closes.
#[tauri::command]
pub fn app_quitting(app: AppHandle) {
    guard_quit(&app);
}

/// Title bar X, sent the same way as Alt+F4 so they always behave the same.
#[tauri::command]
pub fn window_close(app: AppHandle) {
    log("app", "close button");
    let _ = app.emit("app:close-requested", ());
}

/// Called by the engine once everything is saved. The actual exit happens off the page's call, so
/// the page waiting for an answer can never hold it up.
#[tauri::command]
pub fn app_exit(app: AppHandle) {
    log("app", "exit");
    placement::flush();
    guard_quit(&app);
    std::thread::spawn(move || app.exit(0));
}

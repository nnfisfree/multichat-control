// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod kick;
mod legacy;
mod panel;
mod paths;
mod raid;
mod secrets;
mod sockets;
mod storage;
mod updater;
mod webview2;
mod window;
mod youtube;

use serde::Serialize;
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

/// WebView2 options. Tauri's own defaults are repeated, because setting any replaces them.
/// Chat must keep running while the window is hidden or in the tray, so nothing is throttled,
/// and the helper processes are merged where possible to save memory.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
    --disable-background-timer-throttling --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows --in-process-gpu --renderer-process-limit=1";

/// Development builds can open a debugging port for testing (NNF_DEBUG_PORT). Never in releases.
pub fn browser_args() -> String {
    match std::env::var("NNF_DEBUG_PORT") {
        Ok(port) if cfg!(debug_assertions) && port.chars().all(|c| c.is_ascii_digit()) => format!("{BROWSER_ARGS} --remote-debugging-port={port}"),
        _ => BROWSER_ARGS.to_string(),
    }
}

/// What the engine needs to know at start.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    demo: bool,
    version: String,
    data_dir: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        demo: std::env::args().any(|a| a == "--demo"),
        version: app.package_info().version.to_string(),
        data_dir: paths::data_dir().to_string_lossy().into_owned(),
    }
}

fn main() {
    // Without WebView2 there is no window to show: say so and offer Microsoft's installer.
    if !webview2::ensure() {
        return;
    }
    let result = tauri::Builder::default()
        // A second start just brings the open window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show(app);
            let _ = app.emit("app:second-instance", ());
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            legacy::remove_electron_leftovers();
            secrets::migrate_electron();
            updater::remove_old_exe();
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("NoName's Multichat Control")
                .inner_size(1000.0, 780.0)
                .min_inner_size(420.0, 420.0)
                .decorations(false)
                .data_directory(paths::webview_dir())
                // The font list in Settings reads the installed fonts without asking each time.
                .on_permission_request(|_, kind| match kind {
                    tauri::webview::PermissionKind::LocalFonts => tauri::webview::PermissionResponse::Allow,
                    _ => tauri::webview::PermissionResponse::Default,
                })
                .additional_browser_args(&browser_args())
                .build()?;
            window::watch_close(&main);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            storage::file_read,
            storage::file_write,
            storage::file_append,
            storage::file_remove,
            storage::folder_list,
            storage::history_clear,
            storage::log_line,
            secrets::secret_state,
            secrets::secret_save,
            auth::api_request,
            auth::net_fetch,
            auth::auth_login,
            auth::auth_cancel,
            auth::auth_logout,
            auth::auth_state,
            auth::built_in_logins,
            auth::socket_token,
            auth::obs_auth,
            kick::kick_via_page,
            youtube::youtube_stream_start,
            youtube::youtube_stream_stop,
            window::window_opacity,
            sockets::ws_open,
            sockets::ws_send,
            sockets::ws_close,
            panel::panel_show,
            panel::panel_hide,
            panel::panel_signed_in,
            raid::raid_page,
            raid::raid_now,
            window::window_to_tray,
            window::window_close,
            window::app_quitting,
            window::app_exit,
            updater::update_state,
            updater::update_check,
            updater::update_start,
            updater::update_download,
            updater::update_install,
            updater::update_open_page,
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        webview2::failed(&e.to_string());
    }
}

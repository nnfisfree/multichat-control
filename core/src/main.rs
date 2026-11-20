// no console window in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod kick;
mod legacy;
mod panel;
mod paths;
mod placement;
mod raid;
mod secrets;
mod sockets;
mod storage;
mod tiktok;
mod updater;
mod webview2;
mod window;
mod wobble;
mod youtube;

use serde::Serialize;
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

/// WebView2 flags. Tauri's defaults are repeated here because passing any flags replaces them.
/// Chat has to keep running while the window is hidden or in the tray, so nothing gets throttled,
/// and helper processes are merged where possible to save memory.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
    --disable-background-timer-throttling --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows --in-process-gpu --renderer-process-limit=1";

/// Dev builds can expose a debugging port (NNF_DEBUG_PORT). Never in release.
pub fn browser_args() -> String {
    match std::env::var("NNF_DEBUG_PORT") {
        Ok(port) if cfg!(debug_assertions) && port.chars().all(|c| c.is_ascii_digit()) => format!("{BROWSER_ARGS} --remote-debugging-port={port}"),
        _ => BROWSER_ARGS.to_string(),
    }
}

/// Handed to the engine on startup.
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
    // no WebView2 means no window at all, so say so and offer Microsoft's installer
    if !webview2::ensure() {
        return;
    }
    let result = tauri::Builder::default()
        // second launch just focuses the window that's already open
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
                .title("Multichat Control")
                .inner_size(1000.0, 780.0)
                .min_inner_size(420.0, 420.0)
                .decorations(false)
                // stays hidden until it's been moved back to its saved spot, so it never jumps
                .visible(false)
                .data_directory(paths::webview_dir())
                // let the Settings font list read installed fonts without prompting every time
                .on_permission_request(|_, kind| match kind {
                    tauri::webview::PermissionKind::LocalFonts => tauri::webview::PermissionResponse::Allow,
                    _ => tauri::webview::PermissionResponse::Default,
                })
                .additional_browser_args(&browser_args())
                .build()?;
            placement::restore(&main);
            window::watch_close(&main);
            wobble::install(&main);
            main.show()?;
            placement::shown(&main);
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
            auth::auth_set_token,
            auth::auth_cancel,
            auth::auth_logout,
            auth::auth_state,
            auth::built_in_logins,
            auth::socket_token,
            auth::obs_auth,
            auth::sb_auth,
            auth::slobs_auth,
            kick::kick_via_page,
            kick::kick_json_via_page,
            youtube::youtube_stream_start,
            youtube::youtube_stream_stop,
            tiktok::tiktok_room,
            tiktok::tiktok_key,
            tiktok::tiktok_connect,
            tiktok::tiktok_disconnect,
            window::window_opacity,
            wobble::window_wobble,
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

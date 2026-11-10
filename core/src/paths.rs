//! Where the app keeps its data: `user-data` beside the exe, so the app stays portable.

use std::path::PathBuf;
use std::sync::OnceLock;

const DATA_FOLDER: &str = "user-data";
/// The folder's name up to version 0.1.2 of the Electron app.
const OLD_FOLDER: &str = "nnf-data";

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The folder the exe is in. Development builds use the project folder instead of core/target.
pub fn exe_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn writable(dir: &PathBuf) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-test");
    let ok = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(probe);
    ok
}

/// The data folder. Development builds use a hidden `.user-data` in the project.
/// A read-only location (such as a locked USB drive) falls back to the user's AppData.
pub fn data_dir() -> &'static PathBuf {
    DATA_DIR.get_or_init(|| {
        let hidden = if cfg!(debug_assertions) { "." } else { "" };
        let base = exe_dir();
        let dir = base.join(format!("{hidden}{DATA_FOLDER}"));
        let old = base.join(format!("{hidden}{OLD_FOLDER}"));
        // People updating from Electron 0.1.2 or older keep everything under the new name.
        if !dir.exists() && old.exists() {
            let _ = std::fs::rename(&old, &dir);
        }
        if writable(&dir) {
            return dir;
        }
        let fallback = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("Multichat-Control");
        let _ = std::fs::create_dir_all(&fallback);
        fallback
    })
}

/// WebView2's own data (its cache and the Twitch panel's sign-in), kept inside the data folder.
pub fn webview_dir() -> PathBuf {
    data_dir().join("webview")
}

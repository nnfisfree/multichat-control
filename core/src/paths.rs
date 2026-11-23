//! Where the app keeps its data.
//!
//! Windows: `user-data` next to the exe, so the app stays portable.
//! Linux: `~/.local/share/multichat-control` (XDG). An AppImage with a `user-data` folder next to it
//! runs portable instead, like the Windows exe.

use std::path::PathBuf;
use std::sync::OnceLock;

const DATA_FOLDER: &str = "user-data";
/// Folder name used by the Electron app up to 0.1.2.
#[cfg(windows)]
const OLD_FOLDER: &str = "nnf-data";

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Folder the exe lives in. Dev builds use the project folder instead of core/target.
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

/// The running AppImage file, if we are one. Its own exe lives in a read-only mount, so this is
/// the path that matters for portable data and updates.
#[cfg(target_os = "linux")]
pub fn appimage() -> Option<PathBuf> {
    let path = PathBuf::from(std::env::var_os("APPIMAGE")?);
    (!cfg!(debug_assertions) && path.is_absolute() && path.is_file()).then_some(path)
}

/// The data folder. Dev builds use a hidden `.user-data` in the project.
pub fn data_dir() -> &'static PathBuf {
    DATA_DIR.get_or_init(|| {
        if cfg!(debug_assertions) {
            let dir = exe_dir().join(format!(".{DATA_FOLDER}"));
            if writable(&dir) {
                return dir;
            }
        }
        let dir = platform_dir();
        let _ = std::fs::create_dir_all(&dir);
        dir
    })
}

/// If the exe sits somewhere read-only (e.g. a locked USB stick) we fall back to AppData.
#[cfg(windows)]
fn platform_dir() -> PathBuf {
    let base = exe_dir();
    let dir = base.join(DATA_FOLDER);
    let old = base.join(OLD_FOLDER);
    // people upgrading from Electron 0.1.2 or older keep everything, just renamed
    if !dir.exists() && old.exists() {
        let _ = std::fs::rename(&old, &dir);
    }
    if writable(&dir) {
        return dir;
    }
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("Multichat-Control")
}

/// A `user-data` folder next to the AppImage makes it portable; otherwise the usual XDG place.
#[cfg(not(windows))]
fn platform_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    if let Some(portable) = appimage().and_then(|a| a.parent().map(|p| p.join(DATA_FOLDER))) {
        if portable.is_dir() && writable(&portable) {
            return portable;
        }
    }
    let home = || std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"));
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(home)
        .unwrap_or_else(std::env::temp_dir)
        .join("multichat-control")
}

/// The webview's own data (cache, the Twitch panel's sign-in), kept inside the data folder.
pub fn webview_dir() -> PathBuf {
    data_dir().join("webview")
}

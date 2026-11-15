//! The app's files in the data folder. The engine can only touch the files allowed below, by name,
//! so nothing in the webview can read or write anywhere else on the machine.

use crate::paths::data_dir;
use regex::Regex;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Files the engine may use, as patterns relative to the data folder.
fn allowed(name: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let re = PATTERN.get_or_init(|| {
        Regex::new(r"^(settings\.json|events\.json|events-removed\.json|bmc-state\.json|chat-history/stream-\d+\.jsonl|emote-cache/[A-Za-z0-9_-]{1,80}\.json)$").unwrap()
    });
    re.is_match(name)
}

fn path_of(name: &str) -> Result<PathBuf, String> {
    if !allowed(name) {
        return Err(format!("Not an app file: {name}"));
    }
    Ok(data_dir().join(name))
}

/// Writes to a temp file and renames, so a crash mid-write never leaves a half-written file.
pub fn write_atomic(path: &PathBuf, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_read(name: String) -> Result<Option<String>, String> {
    let path = path_of(&name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn file_write(name: String, text: String) -> Result<(), String> {
    write_atomic(&path_of(&name)?, &text)
}

#[tauri::command]
pub fn file_append(name: String, text: String) -> Result<(), String> {
    let path = path_of(&name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_remove(name: String) -> Result<(), String> {
    let path = path_of(&name)?;
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Lists one of our folders: saved chat history or the emote cache.
#[tauri::command]
pub fn folder_list(folder: String) -> Result<Vec<String>, String> {
    if folder != "chat-history" && folder != "emote-cache" {
        return Err(format!("Not an app folder: {folder}"));
    }
    let dir = data_dir().join(&folder);
    let Ok(entries) = fs::read_dir(dir) else { return Ok(vec![]) };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| format!("{folder}/{}", e.file_name().to_string_lossy()))
        .filter(|n| allowed(n))
        .collect();
    names.sort();
    Ok(names)
}

/// Deletes all saved chat history.
#[tauri::command]
pub fn history_clear() -> Result<(), String> {
    let dir = data_dir().join("chat-history");
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---- log ----

const MAX_LOG_BYTES: u64 = 1_000_000;

/// Anything that looks like a long token gets blanked out before it hits the log.
fn redact(text: &str) -> String {
    static LONG: OnceLock<Regex> = OnceLock::new();
    LONG.get_or_init(|| Regex::new(r"[A-Za-z0-9_\-.]{28,}").unwrap()).replace_all(text, "[hidden]").into_owned()
}

/// Small private log in the data folder. Statuses and errors only, never tokens or chat.
pub fn log(scope: &str, text: &str) {
    let dir = data_dir().join("logs");
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("app.log");
    if fs::metadata(&file).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(&file, dir.join("app.old.log"));
    }
    let now = time_stamp();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(f, "{now} [{scope}] {}", redact(text));
    }
}

/// UTC like 2026-11-10T00:15:24Z, without pulling in a date crate.
fn time_stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // civil date from days since 1970-01-01 (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Engine log lines land here too, so everything ends up in one file.
#[tauri::command]
pub fn log_line(scope: String, text: String) {
    let scope: String = scope.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(24).collect();
    log(&scope, &text.chars().take(500).collect::<String>());
}

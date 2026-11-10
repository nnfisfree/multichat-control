//! Updates from the project's GitHub releases. Only GitHub is contacted, and a download is only
//! installed when it matches the SHA-256 checksum GitHub publishes for it.
//!
//! The app is a single exe, so installing means: download the new exe beside the old one, swap
//! them (Windows allows renaming a running exe), start the new one and exit. The old exe is
//! deleted on the next start.

use crate::paths::{data_dir, exe_dir};
use crate::storage::log;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

const UPDATE_REPO: &str = "nnfisfree/multichat-control";
const FIRST_CHECK: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const EXE: &str = "Multichat-Control.exe";

struct Found { url: String, sha256: String }

struct Updater {
    state: Value,
    found: Option<Found>,
    ready: Option<PathBuf>,
}

fn updater() -> &'static Mutex<Updater> {
    static U: std::sync::OnceLock<Mutex<Updater>> = std::sync::OnceLock::new();
    U.get_or_init(|| Mutex::new(Updater {
        state: json!({ "status": "idle", "current": env!("CARGO_PKG_VERSION") }),
        found: None,
        ready: None,
    }))
}

fn set(app: &AppHandle, patch: Value) -> Value {
    let mut u = updater().lock().unwrap();
    if let (Some(state), Some(p)) = (u.state.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            if v.is_null() { state.remove(k); } else { state.insert(k.clone(), v.clone()); }
        }
    }
    let s = u.state.clone();
    let _ = app.emit("update:state", &s);
    s
}

fn setting_bool(name: &str, default: bool) -> bool {
    std::fs::read_to_string(data_dir().join("settings.json")).ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get(name).and_then(Value::as_bool))
        .unwrap_or(default)
}

/// "0.2.1" or "v0.3.0-beta.1" as comparable parts. A full release beats its pre-releases.
fn version_key(v: &str) -> (Vec<u64>, Option<String>) {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let (main, pre) = match v.split_once('-') { Some((m, p)) => (m, Some(p.to_string())), None => (v, None) };
    (main.split('.').map(|n| n.parse().unwrap_or(0)).collect(), pre)
}

fn newer(a: &str, b: &str) -> bool {
    let (x, xp) = version_key(a);
    let (y, yp) = version_key(b);
    for i in 0..3 {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q { return p > q; }
    }
    match (xp, yp) {
        (None, Some(_)) => true,
        (Some(p), Some(q)) => p > q,
        _ => false,
    }
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().user_agent("multichat-control-updater").timeout(Duration::from_secs(20)).build().expect("http client")
}

async fn check(app: &AppHandle, manual: bool) -> Value {
    {
        let u = updater().lock().unwrap();
        let status = u.state["status"].as_str().unwrap_or("");
        if status == "downloading" || status == "ready" { return u.state.clone(); }
    }
    set(app, json!({ "status": "checking", "error": null }));
    let result: Result<Option<(Value, Found)>, String> = async {
        let res = http().get(format!("https://api.github.com/repos/{UPDATE_REPO}/releases?per_page=15"))
            .header("Accept", "application/vnd.github+json").send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(if res.status().as_u16() == 404 { "No public releases found.".into() } else { format!("GitHub answered {}.", res.status().as_u16()) });
        }
        let releases: Vec<Value> = res.json().await.map_err(|e| e.to_string())?;
        let pre = setting_bool("updatePrereleases", false);
        let current = env!("CARGO_PKG_VERSION");
        let newest = releases.into_iter()
            .filter(|r| !r["draft"].as_bool().unwrap_or(false) && (pre || !r["prerelease"].as_bool().unwrap_or(false)))
            .filter(|r| newer(r["tag_name"].as_str().unwrap_or(""), current))
            .max_by(|a, b| if newer(a["tag_name"].as_str().unwrap_or(""), b["tag_name"].as_str().unwrap_or("")) { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less });
        let Some(r) = newest else { return Ok(None) };
        let asset = r["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| n.to_ascii_lowercase().ends_with("-portable.exe")))).cloned();
        let sha = asset.as_ref().and_then(|a| a["digest"].as_str()).and_then(|d| d.strip_prefix("sha256:")).map(str::to_ascii_lowercase).filter(|s| s.len() == 64);
        let url = asset.as_ref().and_then(|a| a["browser_download_url"].as_str()).map(String::from);
        let info = json!({
            "version": r["tag_name"].as_str().unwrap_or("").trim_start_matches(['v', 'V']),
            "notes": r["body"].as_str().unwrap_or("").chars().take(20000).collect::<String>(),
            "page": r["html_url"],
            // Only files with a checksum from GitHub may be installed automatically.
            "canInstall": url.is_some() && sha.is_some(),
            "size": asset.as_ref().map(|a| a["size"].clone()).unwrap_or(Value::Null),
        });
        Ok(Some((info, Found { url: url.unwrap_or_default(), sha256: sha.unwrap_or_default() })))
    }.await;
    match result {
        Ok(None) => set(app, json!({ "status": "none", "info": null, "checkedAt": now_ms() })),
        Ok(Some((info, found))) => {
            log("update", &format!("found {}", info["version"].as_str().unwrap_or("?")));
            updater().lock().unwrap().found = Some(found);
            set(app, json!({ "status": "available", "info": info, "checkedAt": now_ms() }))
        }
        Err(e) => {
            log("update", &format!("check failed: {e}"));
            // Background checks stay quiet; only a manual check shows the error.
            if manual { set(app, json!({ "status": "error", "error": e })) } else { set(app, json!({ "status": "idle" })) }
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[tauri::command]
pub fn update_state() -> Value {
    updater().lock().unwrap().state.clone()
}

#[tauri::command]
pub async fn update_check(app: AppHandle, manual: Option<bool>) -> Value {
    check(&app, manual.unwrap_or(true)).await
}

/// Checks shortly after start, then every few hours, when automatic checks are on.
#[tauri::command]
pub fn update_start(app: AppHandle) {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) { return; }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if setting_bool("autoUpdate", true) {
                let _ = check(&app, false).await;
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

fn fail(app: &AppHandle, msg: &str) -> Result<(), String> {
    log("update", msg);
    set(app, json!({ "status": "error", "error": msg }));
    Err(msg.to_string())
}

/// Downloads the new exe next to the current one and checks it against GitHub's checksum.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<(), String> {
    let found = { updater().lock().unwrap().found.as_ref().map(|f| (f.url.clone(), f.sha256.clone())) };
    let Some((url, sha)) = found.filter(|(u, s)| !u.is_empty() && !s.is_empty()) else {
        return fail(&app, "This update has to be installed from the download page.");
    };
    let target = exe_dir().join(format!("{EXE}.new"));
    if std::fs::write(&target, b"").is_err() {
        return fail(&app, "The app is in a protected folder, so it can't update itself. Use the download page, or move the app to a folder like Documents.");
    }
    set(&app, json!({ "status": "downloading", "progress": 0 }));
    let result: Result<(), String> = async {
        let mut res = http().get(&url).timeout(Duration::from_secs(600)).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() { return Err(format!("Download failed ({}).", res.status().as_u16())); }
        let total = res.content_length().unwrap_or(0);
        let mut hash = Sha256::new();
        let mut bytes = Vec::with_capacity(total as usize);
        let mut shown = 0;
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            hash.update(&chunk);
            bytes.extend_from_slice(&chunk);
            let pct = (bytes.len() as u64 * 100).checked_div(total).unwrap_or(0);
            if pct != shown { shown = pct; set(&app, json!({ "progress": pct })); }
        }
        let got: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if got != sha { return Err("The download doesn't match GitHub's checksum, so it was discarded.".into()); }
        std::fs::write(&target, &bytes).map_err(|e| e.to_string())
    }.await;
    match result {
        Ok(()) => {
            updater().lock().unwrap().ready = Some(target);
            log("update", "downloaded and verified");
            set(&app, json!({ "status": "ready", "progress": 100 }));
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&target);
            fail(&app, &e)
        }
    }
}

/// Swaps in the new exe, starts it, and exits. The engine saves what's waiting first.
#[tauri::command]
pub fn update_install(app: AppHandle) -> Result<(), String> {
    let Some(new) = updater().lock().unwrap().ready.clone() else { return Err("No update is ready.".into()) };
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let old = exe.with_extension("exe.old");
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&new, &exe) {
        // Put the current version back, so the app keeps working.
        let _ = std::fs::rename(&old, &exe);
        return Err(e.to_string());
    }
    log("update", "installed; restarting");
    std::process::Command::new(&exe).spawn().map_err(|e| e.to_string())?;
    crate::window::request_quit(&app);
    Ok(())
}

#[tauri::command]
pub fn update_open_page(app: AppHandle) {
    let page = updater().lock().unwrap().state["info"]["page"].as_str().map(String::from)
        .unwrap_or_else(|| format!("https://github.com/{UPDATE_REPO}/releases"));
    if page.starts_with("https://github.com/") {
        let _ = app.opener().open_url(page, None::<&str>);
    }
}

/// Deletes the exe an earlier update replaced.
pub fn remove_old_exe() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.old"));
    }
}

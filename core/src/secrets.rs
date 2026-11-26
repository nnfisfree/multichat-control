//! Saved logins and keys in `secrets.json`, encrypted with DPAPI so only this Windows user on this
//! machine can read them. They never leave Rust: the engine only learns whether a secret exists,
//! never its value.

use crate::paths::data_dir;
use crate::storage::write_atomic;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Prefix on values written by this version.
const PREFIX: &str = "dpapi:";

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> std::path::PathBuf {
    data_dir().join("secrets.json")
}

fn load() -> BTreeMap<String, String> {
    std::fs::read_to_string(file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(map: &BTreeMap<String, String>) {
    if let Ok(text) = serde_json::to_string_pretty(map) {
        let _ = write_atomic(&file(), &text);
    }
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        unsafe {
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(out.pbData as _);
            v
        }
    }

    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) };
        (ok != 0).then(|| take(out))
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) };
        (ok != 0).then(|| take(out))
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(_: &[u8]) -> Option<Vec<u8>> { None }
    pub fn unprotect(_: &[u8]) -> Option<Vec<u8>> { None }
}

fn encrypt(value: &str) -> Option<String> {
    dpapi::protect(value.as_bytes()).map(|b| format!("{PREFIX}{}", B64.encode(b)))
}

fn decrypt(stored: &str) -> Option<String> {
    let b = B64.decode(stored.strip_prefix(PREFIX)?).ok()?;
    String::from_utf8(dpapi::unprotect(&b)?).ok()
}

pub fn get(key: &str) -> Option<String> {
    let _guard = LOCK.lock().unwrap();
    load().get(key).and_then(|v| decrypt(v))
}

pub fn set(key: &str, value: Option<&str>) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap();
    let mut map = load();
    match value.filter(|v| !v.is_empty()) {
        Some(v) => {
            map.insert(key.to_string(), encrypt(v).ok_or("Windows secure storage is unavailable.")?);
        }
        None => {
            map.remove(key);
        }
    }
    save(&map);
    Ok(())
}

/// All the UI gets to know: whether each user-entered secret is saved.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretState {
    youtube_secret: bool,
    kick_secret: bool,
    obs_password: bool,
    sb_password: bool,
    sl_token: bool,
    tiktok_key: bool,
}

#[tauri::command]
pub fn secret_state() -> SecretState {
    let map = { let _guard = LOCK.lock().unwrap(); load() };
    SecretState {
        youtube_secret: map.contains_key("youtube.clientSecret"),
        kick_secret: map.contains_key("kick.clientSecret"),
        obs_password: map.contains_key("obs.password"),
        sb_password: map.contains_key("streamerbot.password"),
        sl_token: map.contains_key("streamlabs.token"),
        tiktok_key: map.contains_key("tiktok.eulerKey"),
    }
}

/// Saves a secret typed in Settings. Only these names can be set from the webview.
#[tauri::command]
pub fn secret_save(key: String, value: Option<String>) -> Result<SecretState, String> {
    let name = match key.as_str() {
        "youtubeSecret" => "youtube.clientSecret",
        "kickSecret" => "kick.clientSecret",
        "obsPassword" => "obs.password",
        "sbPassword" => "streamerbot.password",
        "slToken" => "streamlabs.token",
        _ => return Err("Unknown secret.".into()),
    };
    set(name, value.as_deref().map(str::trim))?;
    Ok(secret_state())
}

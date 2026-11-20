//! Saved logins and keys in `secrets.json`, encrypted with DPAPI so only this Windows user on this
//! machine can read them. They never leave Rust: the engine only learns whether a secret exists,
//! never its value.
//!
//! Logins saved by the old Electron build (0.1.x) get picked up too, so nobody has to log in again.
//! Electron used AES-256-GCM with a key that's itself DPAPI-protected and stored in
//! `session/Local State`. Each one is converted to our format the first time it's read.

use crate::paths::data_dir;
use crate::storage::{log, write_atomic};
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

/// Electron's AES key from `session/Local State`, unlocked with DPAPI.
fn electron_key() -> Option<Vec<u8>> {
    let text = std::fs::read_to_string(data_dir().join("session").join("Local State")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let wrapped = B64.decode(json.get("os_crypt")?.get("encrypted_key")?.as_str()?).ok()?;
    let blob = wrapped.strip_prefix(b"DPAPI")?;
    dpapi::unprotect(blob)
}

/// One Electron-encrypted value: "v10", a 12-byte nonce, then the AES-GCM ciphertext.
fn electron_decrypt(raw: &[u8], key: &[u8]) -> Option<String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    let body = raw.strip_prefix(b"v10")?;
    if body.len() < 12 + 16 {
        return None;
    }
    let (nonce, data) = body.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    String::from_utf8(cipher.decrypt(Nonce::from_slice(nonce), data).ok()?).ok()
}

fn encrypt(value: &str) -> Option<String> {
    dpapi::protect(value.as_bytes()).map(|b| format!("{PREFIX}{}", B64.encode(b)))
}

fn decrypt(stored: &str) -> Option<String> {
    let b = B64.decode(stored.strip_prefix(PREFIX)?).ok()?;
    String::from_utf8(dpapi::unprotect(&b)?).ok()
}

/// One-time conversion of everything the Electron build saved. Runs on startup.
pub fn migrate_electron() {
    let _guard = LOCK.lock().unwrap();
    let mut map = load();
    let old: Vec<String> = map.iter().filter(|(_, v)| !v.starts_with(PREFIX)).map(|(k, _)| k.clone()).collect();
    if old.is_empty() {
        return;
    }
    let key = electron_key();
    let mut moved = 0;
    for k in old {
        let plain = key.as_ref().and_then(|key| B64.decode(&map[&k]).ok().and_then(|raw| electron_decrypt(&raw, key)));
        match plain.and_then(|p| encrypt(&p)) {
            Some(v) => {
                map.insert(k, v);
                moved += 1;
            }
            // can't decrypt (different machine or Windows user): drop it, that login just asks again
            None => {
                map.remove(&k);
            }
        }
    }
    save(&map);
    log("secrets", &format!("kept {moved} saved logins from the previous version"));
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

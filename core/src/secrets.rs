//! Saved logins and keys, in `secrets.json`, encrypted with Windows' own protection (DPAPI), so
//! only this Windows user on this PC can read them. They never leave the Rust side: the engine
//! only learns whether a secret exists, never its value.
//!
//! Logins saved by the Electron version (0.1.x) are read too, so nobody has to log in again:
//! Electron encrypts with AES-256-GCM using a key that is itself protected by DPAPI and kept in
//! `session/Local State`. Each one is converted to the new format the first time it is read.

use crate::paths::data_dir;
use crate::storage::{log, write_atomic};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Marks values written by this version.
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

/// The AES key Electron used, from `session/Local State`, unlocked with DPAPI.
fn electron_key() -> Option<Vec<u8>> {
    let text = std::fs::read_to_string(data_dir().join("session").join("Local State")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let wrapped = B64.decode(json.get("os_crypt")?.get("encrypted_key")?.as_str()?).ok()?;
    let blob = wrapped.strip_prefix(b"DPAPI")?;
    dpapi::unprotect(blob)
}

/// Decrypts one value saved by Electron: "v10", a 12-byte nonce, then the AES-GCM ciphertext.
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

/// Converts every login the Electron version saved, once. Runs at start.
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
            // Unreadable (another PC or Windows user): dropped, so that login simply asks again.
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

/// What the interface may know: only whether each user-entered secret is saved.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretState {
    youtube_secret: bool,
    kick_secret: bool,
    obs_password: bool,
    sb_password: bool,
}

#[tauri::command]
pub fn secret_state() -> SecretState {
    let map = { let _guard = LOCK.lock().unwrap(); load() };
    SecretState {
        youtube_secret: map.contains_key("youtube.clientSecret"),
        kick_secret: map.contains_key("kick.clientSecret"),
        obs_password: map.contains_key("obs.password"),
        sb_password: map.contains_key("streamerbot.password"),
    }
}

/// Saves a secret the user typed in Settings. Only these can be set from the page.
#[tauri::command]
pub fn secret_save(key: String, value: Option<String>) -> Result<SecretState, String> {
    let name = match key.as_str() {
        "youtubeSecret" => "youtube.clientSecret",
        "kickSecret" => "kick.clientSecret",
        "obsPassword" => "obs.password",
        "sbPassword" => "streamerbot.password",
        _ => return Err("Unknown secret.".into()),
    };
    set(name, value.as_deref().map(str::trim))?;
    Ok(secret_state())
}

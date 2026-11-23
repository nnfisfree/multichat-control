//! Saved logins and keys in `secrets.json`. They never leave Rust: the engine only learns whether a
//! secret exists, never its value.
//!
//! Windows: each value is encrypted with DPAPI, so only this Windows user on this machine can read it.
//! Linux: each value is encrypted with AES-256-GCM. The key is random and lives in the desktop's
//! keyring (Secret Service: GNOME Keyring, KWallet, KeePassXC...). Without a keyring it goes into
//! `secrets.key` next to `secrets.json`, readable only by this user.
//!
//! Logins saved by the old Electron build (0.1.x, Windows only) get picked up too, so nobody has to
//! log in again. Electron used AES-256-GCM with a key that's itself DPAPI-protected and stored in
//! `session/Local State`. Each one is converted to our format the first time it's read.

use crate::paths::data_dir;
#[cfg(windows)]
use crate::storage::log;
use crate::storage::write_atomic;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// Prefix on values written by this version.
#[cfg(windows)]
const PREFIX: &str = "dpapi:";
#[cfg(not(windows))]
const PREFIX: &str = "aes:";

/// Shown when a secret can't be encrypted.
#[cfg(windows)]
const UNAVAILABLE: &str = "Windows secure storage is unavailable.";
#[cfg(not(windows))]
const UNAVAILABLE: &str = "Secure storage is unavailable: the system keyring couldn't be reached and no key file could be written.";

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> std::path::PathBuf {
    data_dir().join("secrets.json")
}

fn load() -> BTreeMap<String, String> {
    std::fs::read_to_string(file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(map: &BTreeMap<String, String>) {
    if let Ok(text) = serde_json::to_string_pretty(map) {
        if write_atomic(&file(), &text).is_ok() {
            private(&file());
        }
    }
}

/// Only this user may read the file.
#[cfg(unix)]
fn private(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn private(_: &std::path::Path) {}

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

#[cfg(target_os = "linux")]
mod vault {
    //! The AES key: in the keyring if there is one, otherwise in a private file.
    use super::PREFIX;
    use crate::paths::data_dir;
    use crate::storage::log;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use std::sync::Mutex;

    const SERVICE: &str = "multichat-control";
    const ACCOUNT: &str = "secrets-key";

    /// Cached once found, so the keyring is only asked once per run.
    static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);

    fn key_file() -> std::path::PathBuf {
        data_dir().join("secrets.key")
    }

    fn decode(text: &str) -> Option<[u8; 32]> {
        B64.decode(text.trim()).ok()?.try_into().ok()
    }

    enum Keyring {
        Found([u8; 32]),
        Empty,
        /// No Secret Service running, or it refused (locked and the unlock was cancelled).
        Unavailable(String),
    }

    fn entry() -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(SERVICE, ACCOUNT)
    }

    fn from_keyring() -> Keyring {
        match entry().and_then(|e| e.get_password()) {
            Ok(text) => decode(&text).map(Keyring::Found).unwrap_or(Keyring::Empty),
            Err(keyring::Error::NoEntry) => Keyring::Empty,
            Err(e) => Keyring::Unavailable(e.to_string()),
        }
    }

    fn to_keyring(key: &[u8; 32]) -> bool {
        let text = B64.encode(key);
        // only trust it once it reads back
        entry().and_then(|e| e.set_password(&text)).is_ok() && matches!(from_keyring(), Keyring::Found(k) if k == *key)
    }

    /// Anything already encrypted with a key we might not be able to reach right now.
    fn has_saved() -> bool {
        super::load().values().any(|v| v.starts_with(PREFIX))
    }

    fn find() -> Option<[u8; 32]> {
        let keyring = from_keyring();
        if let Keyring::Found(k) = keyring {
            return Some(k);
        }
        // a key file from a run without a keyring keeps being used, so nothing gets lost
        if let Some(k) = std::fs::read_to_string(key_file()).ok().and_then(|t| decode(&t)) {
            return Some(k);
        }
        if let Keyring::Unavailable(e) = &keyring {
            // the key may well be in there, just out of reach: don't replace it and lose every login
            if has_saved() {
                log("secrets", &format!("the system keyring can't be reached ({e}), so saved logins can't be read this time"));
                return None;
            }
        }
        let mut key = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut key);
        if matches!(keyring, Keyring::Empty) && to_keyring(&key) {
            log("secrets", "new encryption key saved in the system keyring");
            return Some(key);
        }
        if write_private(&key_file(), B64.encode(key).as_bytes()).is_err() {
            return None;
        }
        log("secrets", "no system keyring available: the encryption key is kept in secrets.key, readable only by you");
        Some(key)
    }

    /// Created 0600 from the start, so the key is never readable by others even for a moment.
    fn write_private(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
        f.write_all(data)?;
        f.sync_all()
    }

    fn key() -> Option<[u8; 32]> {
        let mut cached = KEY.lock().unwrap();
        if cached.is_none() {
            *cached = find();
        }
        *cached
    }

    /// Fetches the key early, off the main thread, so a keyring unlock prompt never stalls the window.
    pub fn warm() {
        std::thread::spawn(|| {
            let _ = key();
        });
    }

    /// 12-byte nonce, then the AES-GCM ciphertext.
    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};
        let cipher = Aes256Gcm::new_from_slice(&key()?).ok()?;
        let mut nonce = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce);
        let mut out = nonce.to_vec();
        out.extend(cipher.encrypt(Nonce::from_slice(&nonce), data).ok()?);
        Some(out)
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};
        if data.len() < 12 + 16 {
            return None;
        }
        let (nonce, body) = data.split_at(12);
        let cipher = Aes256Gcm::new_from_slice(&key()?).ok()?;
        cipher.decrypt(Nonce::from_slice(nonce), body).ok()
    }
}

#[cfg(windows)]
use dpapi as vault;

/// Gets the key ready at startup. Only Linux has anything to unlock.
pub fn warm() {
    #[cfg(target_os = "linux")]
    vault::warm();
}

#[cfg(not(any(windows, target_os = "linux")))]
mod vault {
    pub fn protect(_: &[u8]) -> Option<Vec<u8>> { None }
    pub fn unprotect(_: &[u8]) -> Option<Vec<u8>> { None }
}

/// Electron's AES key from `session/Local State`, unlocked with DPAPI.
#[cfg(windows)]
fn electron_key() -> Option<Vec<u8>> {
    let text = std::fs::read_to_string(data_dir().join("session").join("Local State")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let wrapped = B64.decode(json.get("os_crypt")?.get("encrypted_key")?.as_str()?).ok()?;
    let blob = wrapped.strip_prefix(b"DPAPI")?;
    dpapi::unprotect(blob)
}

/// One Electron-encrypted value: "v10", a 12-byte nonce, then the AES-GCM ciphertext.
#[cfg(windows)]
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
    vault::protect(value.as_bytes()).map(|b| format!("{PREFIX}{}", B64.encode(b)))
}

fn decrypt(stored: &str) -> Option<String> {
    let b = B64.decode(stored.strip_prefix(PREFIX)?).ok()?;
    String::from_utf8(vault::unprotect(&b)?).ok()
}

/// One-time conversion of everything the Electron build saved. Runs on startup.
#[cfg(windows)]
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
            map.insert(key.to_string(), encrypt(v).ok_or(UNAVAILABLE)?);
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

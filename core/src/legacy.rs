//! Cleanup after updating from the Electron build (0.1.x).
//!
//! The old updater copies the new files over the old ones, so Electron's ~70 files would be left
//! sitting next to the new exe. This deletes exactly those, by name, and only if Electron's own
//! `resources/app.asar` proves this folder really had the old version. `user-data` is never touched.

use crate::paths::exe_dir;
use crate::storage::log;
use std::fs;

const FILES: &[&str] = &[
    "LICENSE.electron.txt", "LICENSES.chromium.html", "chrome_100_percent.pak", "chrome_200_percent.pak",
    "d3dcompiler_47.dll", "dxcompiler.dll", "dxil.dll", "electron_wer.dll", "ffmpeg.dll", "icudtl.dat",
    "libEGL.dll", "libGLESv2.dll", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin",
    "vk_swiftshader.dll", "vk_swiftshader_icd.json", "vulkan-1.dll",
];
const FOLDERS: &[&str] = &["locales"];
const RESOURCES: &[&str] = &["app.asar", "elevate.exe", "icon.png"];

pub fn remove_electron_leftovers() {
    // dev builds run from the project folder, nothing to clean up there
    if cfg!(debug_assertions) {
        return;
    }
    let dir = exe_dir();
    let res = dir.join("resources");
    if !res.join("app.asar").is_file() {
        return;
    }
    let mut removed = 0;
    for f in FILES {
        if fs::remove_file(dir.join(f)).is_ok() {
            removed += 1;
        }
    }
    for d in FOLDERS {
        if fs::remove_dir_all(dir.join(d)).is_ok() {
            removed += 1;
        }
    }
    for f in RESOURCES {
        let _ = fs::remove_file(res.join(f));
    }
    let _ = fs::remove_dir_all(res.join("proto"));
    // only removes resources/ if it's empty now
    let _ = fs::remove_dir(&res);
    log("update", &format!("moved from the Electron version: removed {removed} old files"));
}

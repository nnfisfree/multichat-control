//! Official builds can include the app's own developer logins, so people just log in to YouTube,
//! Kick and the alert services. The values come from the private `.env.local` at the project root
//! (never committed) and are baked into the exe, as the Electron version did.

fn main() {
    let env_file = std::path::Path::new("../.env.local");
    println!("cargo:rerun-if-changed=../.env.local");
    if let Ok(text) = std::fs::read_to_string(env_file) {
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else { continue };
            // Names from the Electron version (MAIN_VITE_...) work unchanged.
            let name = key.trim().trim_start_matches("MAIN_VITE_");
            let value = value.trim().trim_matches('"');
            if !value.is_empty() && name.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
                println!("cargo:rustc-env=NNF_{name}={value}");
            }
        }
    }
    tauri_build::build()
}

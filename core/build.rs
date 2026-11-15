//! Official builds can bake in our own developer app credentials, so people can just log in to
//! YouTube, Kick and the alert services. Values come from the private `.env.local` in the project
//! root (never committed), same as the Electron build did.

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
            // the Electron build's MAIN_VITE_... names still work
            let name = key.trim().trim_start_matches("MAIN_VITE_");
            let value = value.trim().trim_matches('"');
            if !value.is_empty() && name.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
                println!("cargo:rustc-env=NNF_{name}={value}");
            }
        }
    }
    tauri_build::build()
}

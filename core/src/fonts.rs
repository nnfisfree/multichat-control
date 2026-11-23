//! Installed font families for the Settings font lists. WebView2 has `queryLocalFonts` for this;
//! WebKitGTK doesn't, so on Linux we ask fontconfig.

#[tauri::command]
pub async fn system_fonts() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(fontconfig).await.unwrap_or_default()
    }
    #[cfg(not(target_os = "linux"))]
    {
        Vec::new()
    }
}

/// `fc-list : family` prints one font per line, its family names comma-separated (localized names
/// after the first). The first is the one CSS knows it by.
#[cfg(target_os = "linux")]
fn fontconfig() -> Vec<String> {
    let Ok(out) = std::process::Command::new("fc-list").args([":", "family"]).output() else { return Vec::new() };
    let mut families: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.split(',').next())
        .map(|f| f.replace("\\-", "-").trim().to_string())
        // dot-prefixed families are fontconfig internals, not fonts to pick
        .filter(|f| !f.is_empty() && !f.starts_with('.'))
        .collect();
    families.sort_by_key(|f| f.to_lowercase());
    families.dedup();
    families
}

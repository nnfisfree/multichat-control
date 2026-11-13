//! Kick's channel details, when Cloudflare refuses plain requests.
//!
//! A hidden window opens kick.com/<channel> and makes the same calls from the real page. The page
//! hands the result back by navigating to a private address the core intercepts (and blocks), so
//! the remote site never gets any way to call into the app.

use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "kick-discovery";
const RESULT_HOST: &str = "nnf-result.invalid";

#[tauri::command]
pub async fn kick_via_page(app: AppHandle, slug: String) -> Result<serde_json::Value, String> {
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Invalid Kick channel name.".into());
    }
    if let Some(old) = app.get_webview_window(LABEL) {
        let _ = old.destroy();
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = Mutex::new(Some(tx));
    // Only what the app needs is sent back, which keeps the hand-over small.
    let script = format!(
        r#"(async () => {{
  if (location.hostname !== 'kick.com' || window.__nnfKick) return;
  const get = async (p) => {{ try {{ const r = await fetch(p, {{ headers: {{ Accept: 'application/json' }} }}); return r.ok ? await r.json() : null }} catch {{ return null }} }};
  const [c, e, v] = await Promise.all([get('/api/v2/channels/{slug}'), get('/emotes/{slug}'), get('/api/v2/channels/{slug}/videos')]);
  if (!c && (window.__nnfTries = (window.__nnfTries || 0) + 1) < 2) return;
  window.__nnfKick = true;
  const pick = (x) => ({{ id: x.id, slug: x.slug, start_time: x.start_time, created_at: x.created_at, duration: x.duration, session_title: x.session_title }});
  const channel = c && {{ id: c.id, user_id: c.user_id, chatroom: {{ id: c.chatroom && c.chatroom.id }}, previous_livestreams: (c.previous_livestreams || []).slice(0, 20).map(pick) }};
  const emotes = Array.isArray(e) ? e.map((s) => ({{ name: s.name, emotes: (s.emotes || []).map((x) => ({{ id: x.id, name: x.name }})) }})) : [];
  const videos = Array.isArray(v) ? v.slice(0, 20).map(pick) : null;
  location.href = 'https://{RESULT_HOST}/#' + encodeURIComponent(JSON.stringify({{ channel, emotes, videos }}));
}})()"#
    );
    let url = url::Url::parse(&format!("https://kick.com/{slug}")).map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .visible(false)
        .skip_taskbar(true)
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .on_navigation(move |u| {
            if u.host_str() == Some(RESULT_HOST) {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(u.fragment().unwrap_or_default().to_string());
                }
                return false;
            }
            // Cloudflare's check may hop between kick.com addresses; nothing else is allowed.
            u.scheme() == "https" && u.host_str().is_some_and(|h| h == "kick.com" || h.ends_with(".kick.com") || h.ends_with("cloudflare.com"))
        })
        .on_page_load(move |w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = w.eval(&script);
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(25), rx).await;
    let _ = window.destroy();
    let encoded = result.map_err(|_| "Kick didn't answer in time.".to_string())?.map_err(|_| "Kick didn't answer.".to_string())?;
    let text = url::form_urlencoded::parse(format!("x={encoded}").as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default();
    serde_json::from_str(&text).map_err(|_| "Kick sent something unexpected.".into())
}

const JSON_LABEL: &str = "kick-json";
/// One hidden JSON window at a time; a second request waits for the first.
static JSON_TURN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The only kick.com addresses read this way: one clip, or a channel's clips from the last day.
fn allowed_json_path(path: &str) -> bool {
    let name = |s: &str| !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if let Some(id) = path.strip_prefix("/api/v2/clips/") {
        return id.starts_with("clip_") && name(id);
    }
    path.strip_prefix("/api/v2/channels/").and_then(|rest| rest.strip_suffix("/clips?sort=date&time=day")).is_some_and(name)
}

/// Clip details for link cards and new-clip checks, when Cloudflare refuses plain requests.
///
/// Lighter than kick_via_page: the hidden window opens the JSON address itself rather than the
/// channel page, so no live player loads. It reads the text once Cloudflare's check lets it in.
#[tauri::command]
pub async fn kick_json_via_page(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    if !allowed_json_path(&path) {
        return Err("That Kick address isn't allowed.".into());
    }
    let _turn = JSON_TURN.lock().await;
    if let Some(old) = app.get_webview_window(JSON_LABEL) {
        let _ = old.destroy();
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = Mutex::new(Some(tx));
    // Cloudflare's check page isn't JSON, so the script waits for the next page load after it.
    let script = format!(
        r#"(() => {{
  if (location.hostname !== 'kick.com' || window.__nnfJson) return;
  let data;
  try {{ data = JSON.parse(document.body ? document.body.innerText : '') }} catch {{ return }}
  window.__nnfJson = true;
  location.href = 'https://{RESULT_HOST}/#' + encodeURIComponent(JSON.stringify(data));
}})()"#
    );
    let url = url::Url::parse(&format!("https://kick.com{path}")).map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, JSON_LABEL, WebviewUrl::External(url))
        .visible(false)
        .skip_taskbar(true)
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .on_navigation(move |u| {
            if u.host_str() == Some(RESULT_HOST) {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(u.fragment().unwrap_or_default().to_string());
                }
                return false;
            }
            u.scheme() == "https" && u.host_str().is_some_and(|h| h == "kick.com" || h.ends_with(".kick.com") || h.ends_with("cloudflare.com"))
        })
        .on_page_load(move |w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = w.eval(&script);
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(20), rx).await;
    let _ = window.destroy();
    let encoded = result.map_err(|_| "Kick didn't answer in time.".to_string())?.map_err(|_| "Kick didn't answer.".to_string())?;
    let text = url::form_urlencoded::parse(format!("x={encoded}").as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default();
    serde_json::from_str(&text).map_err(|_| "Kick sent something unexpected.".into())
}

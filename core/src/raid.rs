//! Twitch's "Raid Now", which Twitch's API doesn't offer: only Twitch's own page can send a raid
//! before its 90-second countdown ends. While a raid counts down, the app keeps the streamer's
//! Twitch chat page open out of sight (signed in through the same WebView2 profile as the
//! Rewards & Power-ups panel); Raid Now presses Twitch's own button on it (panel/raid.js).

use crate::panel::{is_twitch, popout_url, ActionResult};
use crate::storage::log;
use std::time::{Duration, Instant};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const LABEL: &str = "twitch-raid";
const RAID_JS: &str = include_str!("panel/raid.js");
/// Twitch unlocks its button 10 seconds into the countdown; a little more covers a slow page load.
const PRESS_FOR: Duration = Duration::from_secs(20);

fn fail(message: &str) -> ActionResult {
    ActionResult::new(false, Some(message.to_string()))
}

/// Opens the hidden page for this channel, or returns the one already open.
fn open(app: &AppHandle, channel: &str) -> Result<Webview, String> {
    let url = popout_url(channel).ok_or("Log in to Twitch first, so the app knows your channel.")?;
    if let Some(w) = app.get_webview(LABEL) {
        return Ok(w);
    }
    let main = app.get_window("main").ok_or("The window is closed.")?;
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        // The same WebView2 data folder and options as the window: the panel's Twitch sign-in,
        // and no stray profile anywhere else.
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .initialization_script(RAID_JS)
        // It stays on Twitch and opens nothing.
        .on_navigation(|u| is_twitch(u))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    // Outside the window's area: present (so Twitch's page keeps running normally) but never seen.
    main.add_child(builder, LogicalPosition::new(-5000.0, -5000.0), LogicalSize::new(420.0, 700.0))
        .map_err(|e| format!("Could not open Twitch's page: {e}"))
}

fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview(LABEL) {
        let _ = w.close();
    }
}

/// Runs a line of script on the page and returns its answer (a JSON value as text).
async fn ask(w: &Webview, js: &str) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));
    w.eval_with_callback(js, move |r| {
        if let Some(t) = tx.lock().unwrap().take() {
            let _ = t.send(r);
        }
    })
    .ok()?;
    tokio::time::timeout(Duration::from_millis(1500), rx).await.ok()?.ok()
}

/// Opens the page when a raid starts, so Raid Now is quick, and closes it when the raid ends.
#[tauri::command]
pub async fn raid_page(app: AppHandle, open_page: bool, channel: Option<String>) {
    if !open_page {
        return close(&app);
    }
    if let Err(e) = open(&app, &channel.unwrap_or_default()) {
        log("raid", &e);
    }
}

/// Presses Twitch's Raid Now on the hidden page.
#[tauri::command]
pub async fn raid_now(app: AppHandle, channel: Option<String>) -> ActionResult {
    let w = match open(&app, &channel.unwrap_or_default()) {
        Ok(w) => w,
        Err(e) => return fail(&e),
    };
    // Twitch's sign-in cookie, which the page can't read itself. Read off the main thread.
    let signed_in = w
        .cookies_for_url(url::Url::parse("https://www.twitch.tv").unwrap())
        .unwrap_or_default()
        .iter()
        .any(|c| c.name() == "auth-token" && !c.value().is_empty());
    if !signed_in {
        return fail("Raid Now needs Twitch's own page: sign in to Twitch once in Rewards & Power-ups (the lightning button), then try again.");
    }
    let start = Instant::now();
    let mut last = String::new();
    while start.elapsed() < PRESS_FOR {
        last = ask(&w, "window.__nnfRaid ? window.__nnfRaid.press() : 'loading'").await.unwrap_or_else(|| "\"loading\"".into());
        if last.contains("clicked") {
            log("raid", "pressed Twitch's Raid Now");
            // Give Twitch a moment to send it before the page goes away.
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(8)).await;
                close(&app);
            });
            return ActionResult::new(true, Some("Raid sent.".into()));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let seen = ask(&w, "window.__nnfRaid ? window.__nnfRaid.seen() : 'page not ready'").await.unwrap_or_default();
    log("raid", &format!("Raid Now not found (last answer {last}); raid buttons on the page: {seen}"));
    fail(if last.contains("waiting") {
        "Twitch hasn't unlocked Raid Now yet. Try again in a few seconds."
    } else {
        "Couldn't find Twitch's Raid Now button. The raid still goes when the countdown ends."
    })
}

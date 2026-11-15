//! "Raid Now", which the API doesn't offer: only Twitch's own page can send a raid before the
//! 90s countdown ends. While a raid counts down we keep the streamer's Twitch chat page open
//! off-screen (signed in via the same WebView2 profile as the Rewards panel), and Raid Now clicks
//! Twitch's own button on it (panel/raid.js).

use crate::panel::{is_twitch, popout_url, ActionResult};
use crate::storage::log;
use std::time::{Duration, Instant};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const LABEL: &str = "twitch-raid";
const RAID_JS: &str = include_str!("panel/raid.js");
/// Twitch unlocks the button 10s into the countdown; a bit extra covers a slow page load.
const PRESS_FOR: Duration = Duration::from_secs(20);

fn fail(message: &str) -> ActionResult {
    ActionResult::new(false, Some(message.to_string()))
}

/// Opens the hidden page for this channel, or returns the one that's already open.
fn open(app: &AppHandle, channel: &str) -> Result<Webview, String> {
    let url = popout_url(channel).ok_or("Log in to Twitch first, so the app knows your channel.")?;
    if let Some(w) = app.get_webview(LABEL) {
        return Ok(w);
    }
    let main = app.get_window("main").ok_or("The window is closed.")?;
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        // Same WebView2 data folder and flags as the main window: shares the panel's Twitch sign-in,
        // and no stray profile anywhere else.
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .initialization_script(RAID_JS)
        // stays on Twitch, can't open anything
        .on_navigation(is_twitch)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    // Off-screen: it exists (so Twitch's page keeps running normally) but is never visible.
    main.add_child(builder, LogicalPosition::new(-5000.0, -5000.0), LogicalSize::new(420.0, 700.0))
        .map_err(|e| format!("Could not open Twitch's page: {e}"))
}

fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview(LABEL) {
        let _ = w.close();
    }
}

/// Evaluates a line of JS on the page and returns the result (JSON as text).
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

/// Opens the page when a raid starts so Raid Now is quick, closes it when the raid ends.
#[tauri::command]
pub async fn raid_page(app: AppHandle, open_page: bool, channel: Option<String>) {
    if !open_page {
        return close(&app);
    }
    if let Err(e) = open(&app, &channel.unwrap_or_default()) {
        log("raid", &e);
    }
}

/// Clicks Twitch's Raid Now on the hidden page.
#[tauri::command]
pub async fn raid_now(app: AppHandle, channel: Option<String>) -> ActionResult {
    let w = match open(&app, &channel.unwrap_or_default()) {
        Ok(w) => w,
        Err(e) => return fail(&e),
    };
    // Twitch's sign-in cookie, the page can't read it itself. Off the main thread.
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
            // give Twitch a moment to send it before the page goes away
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

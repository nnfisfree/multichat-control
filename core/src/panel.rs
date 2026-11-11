//! Twitch's own Rewards & Power-ups, shown inside the app.
//!
//! It is Twitch's popout chat page in a WebView2 placed over the app's flyout. A page script
//! (panel/isolate.js) hides everything but the rewards popover and makes it fill the view. The
//! page never gets any way to call the app: it can only ask for a reload, by navigating to a
//! private address that this module intercepts and blocks. The skin's colours are applied to
//! Twitch's own colour variables so the panel matches the app.

use crate::storage::log;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

const LABEL: &str = "twitch-panel";
const MESSAGE_HOST: &str = "nnf-panel.invalid";
const ISOLATE_JS: &str = include_str!("panel/isolate.js");
const ISOLATE_CSS: &str = include_str!("panel/isolate.css");

#[derive(Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Colors { window: String, base: String, alt: String, text: String, muted: String, accent: String, accent_hover: String, on_accent: String, line: String }

#[derive(Deserialize)]
pub struct Bounds { x: f64, y: f64, width: f64, height: f64, colors: Option<Colors> }

#[derive(Serialize)]
pub struct ActionResult { ok: bool, #[serde(skip_serializing_if = "Option::is_none")] message: Option<String> }

impl ActionResult {
    pub(crate) fn new(ok: bool, message: Option<String>) -> Self {
        Self { ok, message }
    }
}

#[derive(Default)]
struct Panel {
    channel: String,
    shown: bool,
    loading: bool,
    skin: String,
    signed_in: Option<bool>,
    reloads: Vec<Instant>,
    watching: bool,
}

fn panel() -> &'static Mutex<Panel> {
    static P: std::sync::OnceLock<Mutex<Panel>> = std::sync::OnceLock::new();
    P.get_or_init(|| Mutex::new(Panel::default()))
}

pub(crate) fn popout_url(channel: &str) -> Option<url::Url> {
    if channel.is_empty() || !channel.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    url::Url::parse(&format!("https://www.twitch.tv/popout/{channel}/chat?darkpopout")).ok()
}

pub(crate) fn is_twitch(u: &url::Url) -> bool {
    u.scheme() == "https" && u.host_str().is_some_and(|h| h == "twitch.tv" || h.ends_with(".twitch.tv"))
}

/// Colour values only: no quotes, semicolons or braces, so nothing else can reach the page's CSS.
fn safe(v: &str) -> bool {
    !v.is_empty() && v.len() <= 240 && v.chars().all(|c| c.is_ascii_alphanumeric() || "#(),.% -".contains(c))
}

/// Twitch's own colour variables, set to the app's skin. Names read from Twitch's dark theme.
fn skin_css(c: &Colors) -> String {
    let all = [&c.window, &c.base, &c.alt, &c.text, &c.muted, &c.accent, &c.accent_hover, &c.on_accent, &c.line];
    if !all.iter().all(|v| safe(v)) {
        return String::new();
    }
    format!(
        ":root.tw-root--theme-dark, :root {{
  --color-background-body: {base} !important; --color-background-base: {base} !important;
  --color-background-alt: {alt} !important; --color-background-alt-2: {alt} !important; --color-background-float: {alt} !important;
  --color-text-base: {text} !important; --color-text-alt: {text} !important; --color-text-alt-2: {muted} !important;
  --color-border-base: {line} !important; --color-accent: {accent} !important;
  --color-text-link: {hover} !important; --color-text-link-hover: {hover} !important;
  --color-background-button-primary-default: {accent} !important; --color-background-button-primary-hover: {hover} !important; --color-background-button-primary-active: {accent} !important;
  --color-text-button-primary: {on} !important;
  --color-background-button-brand: {accent} !important; --color-background-button-brand-hover: {hover} !important; --color-text-button-brand: {on} !important;
  --color-background-button: {accent} !important; --color-background-button-hover: {hover} !important; --color-text-button: {on} !important;
  --color-text-button-text: {hover} !important;
}}
html.nnf-rewards, html.nnf-rewards body {{ background: {base} !important; }}
html.nnf-rewards .nnf-root .reward-center__content {{ background: {window} !important; }}
#nnf-notice {{ background: {window} !important; color: {text} !important; }}
#nnf-notice button {{ background: {accent} !important; color: {on} !important; }}
#nnf-notice button:hover {{ background: {hover} !important; }}
",
        base = c.base, alt = c.alt, text = c.text, muted = c.muted, line = c.line, accent = c.accent,
        hover = c.accent_hover, on = c.on_accent, window = c.window
    )
}

fn webview(app: &AppHandle) -> Option<Webview> {
    app.get_webview(LABEL)
}

/// Sends the current state to the page: skin, sign-in, whether it's on screen.
fn sync_page(w: &Webview) {
    let (skin, signed, shown) = {
        let p = panel().lock().unwrap();
        (p.skin.clone(), p.signed_in, p.shown)
    };
    let signed = signed.map_or("null".to_string(), |b| b.to_string());
    let _ = w.eval(format!(
        "window.__nnfPanel && (window.__nnfPanel.skin({}), window.__nnfPanel.signedIn = {signed}, window.__nnfPanel.onScreen = {shown})",
        serde_json::to_string(&skin).unwrap_or_else(|_| "''".into())
    ));
}

/// Every automatic reload goes through here. At most two in 30 seconds: after that the page shows
/// its Open button instead, so whatever goes wrong, the panel can't keep reloading. Pressing Open
/// is always allowed. Each reload and its reason goes in the app's log.
fn reload(app: &AppHandle, reason: &str, user: bool) {
    let Some(w) = webview(app) else { return };
    let (url, shown, allowed) = {
        let mut p = panel().lock().unwrap();
        let now = Instant::now();
        p.reloads.retain(|t| now.duration_since(*t) < Duration::from_secs(30));
        let allowed = user || p.reloads.len() < 2;
        if allowed {
            p.reloads.push(now);
        }
        (popout_url(&p.channel), p.shown, allowed)
    };
    if !allowed {
        log("rewards", &format!("not reloading ({reason}): already reloaded twice in 30 s, showing the Open button"));
        let _ = w.eval("window.__nnfPanel && window.__nnfPanel.pause && window.__nnfPanel.pause()");
        return;
    }
    log("rewards", &format!("reloading: {reason}{}", if shown { "" } else { " (panel hidden)" }));
    if let Some(u) = url {
        let _ = w.navigate(u);
    }
}

/// A message from the page (a blocked navigation to the private address).
fn on_message(app: &AppHandle, u: &url::Url) {
    let data: serde_json::Value = u.fragment()
        .map(|f| url::form_urlencoded::parse(format!("x={f}").as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if u.path() == "/reload" {
        let reason = data["reason"].as_str().unwrap_or("the page asked").chars().take(120).collect::<String>();
        let user = data["user"].as_bool().unwrap_or(false);
        let app = app.clone();
        // Not from inside the navigation callback: the webview is busy there.
        tauri::async_runtime::spawn(async move { reload(&app, &reason, user) });
    }
}

/// Watches Twitch's sign-in cookie, which the page itself can't read, and checks that the page
/// still answers. Runs on its own task: reading cookies on Windows must not block the main thread.
fn watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut silent = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(w) = webview(&app) else { continue };
            // Sign-in.
            let cookies = w.cookies_for_url(url::Url::parse("https://www.twitch.tv").unwrap()).unwrap_or_default();
            let now = cookies.iter().any(|c| c.name() == "auth-token" && !c.value().is_empty());
            let (before, channel) = {
                let mut p = panel().lock().unwrap();
                let before = p.signed_in.replace(now);
                (before, p.channel.clone())
            };
            if before != Some(now) {
                let _ = app.emit("panel:signedIn", now);
                sync_page(&w);
                // Signing in or out on Twitch: back to the popout, fresh.
                if before.is_some() {
                    log("rewards", if now { "signed in to Twitch" } else { "signed out of Twitch" });
                    if let Some(u) = popout_url(&channel) {
                        let _ = w.navigate(u);
                    }
                }
            }
            // A page that stops answering (blank and frozen) is loaded again.
            if panel().lock().unwrap().loading {
                silent = 0;
                continue;
            }
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            let tx = Mutex::new(Some(tx));
            let _ = w.eval_with_callback("1", move |_| {
                if let Some(t) = tx.lock().unwrap().take() {
                    let _ = t.send(());
                }
            });
            if tokio::time::timeout(Duration::from_millis(1500), rx).await.is_ok() {
                silent = 0;
            } else {
                silent += 1;
                if silent >= 4 {
                    silent = 0;
                    reload(&app, "the page stopped answering", false);
                }
            }
        }
    });
}

#[tauri::command]
pub async fn panel_show(app: AppHandle, bounds: Bounds, channel: Option<String>) -> ActionResult {
    let channel = channel.unwrap_or_default();
    let Some(url) = popout_url(&channel) else {
        return ActionResult { ok: false, message: Some("Log in to Twitch first, so the app knows which channel to open.".into()) };
    };
    let rect = Rect { position: LogicalPosition::new(bounds.x, bounds.y).into(), size: LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)).into() };
    let skin = bounds.colors.as_ref().map(skin_css).unwrap_or_default();
    let (first_show, skin_changed, channel_changed) = {
        let mut p = panel().lock().unwrap();
        let first = !p.shown;
        let skin_changed = p.skin != skin;
        let channel_changed = p.channel != channel;
        p.shown = true;
        p.skin = skin;
        p.channel = channel;
        (first, skin_changed, channel_changed)
    };

    let w = match webview(&app) {
        Some(w) => w,
        None => {
            let Some(main) = app.get_window("main") else { return ActionResult { ok: false, message: Some("Window is closed.".into()) } };
            let script = ISOLATE_JS.replace("__NNF_CSS__", &serde_json::to_string(ISOLATE_CSS).unwrap_or_default());
            let nav_app = app.clone();
            let win_app = app.clone();
            let load_app = app.clone();
            let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url.clone()))
                // The same WebView2 data folder and options as the window, so it stays portable.
                .data_directory(crate::paths::webview_dir())
                .additional_browser_args(&crate::browser_args())
                .initialization_script(script)
                .on_navigation(move |u| {
                    if u.host_str() == Some(MESSAGE_HOST) {
                        on_message(&nav_app, u);
                        return false;
                    }
                    if is_twitch(u) {
                        return true;
                    }
                    // Links to other sites open in the browser, never inside the panel.
                    if u.scheme() == "https" {
                        let _ = nav_app.opener().open_url(u.as_str(), None::<&str>);
                    }
                    false
                })
                .on_new_window(move |u, _| {
                    // Twitch's own windows (such as buying Bits) open in the browser.
                    if u.scheme() == "https" {
                        let _ = win_app.opener().open_url(u.as_str(), None::<&str>);
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_page_load(move |w, payload| {
                    let finished = payload.event() == PageLoadEvent::Finished;
                    panel().lock().unwrap().loading = !finished;
                    if finished {
                        sync_page(&w);
                    }
                    let _ = &load_app;
                });
            match main.add_child(builder, rect.position, rect.size) {
                Ok(w) => {
                    let mut p = panel().lock().unwrap();
                    if !p.watching {
                        p.watching = true;
                        drop(p);
                        watch(app.clone());
                    }
                    w
                }
                Err(e) => return ActionResult { ok: false, message: Some(format!("Could not open the panel: {e}")) },
            }
        }
    };
    let _ = w.set_bounds(rect);
    if channel_changed && !first_show {
        let _ = w.navigate(url);
    }
    if first_show {
        let _ = w.show();
        // Each time the flyout opens, open the popover again in case Twitch closed it.
        let _ = w.eval("window.__nnfPanel && window.__nnfPanel.open && window.__nnfPanel.open()");
    }
    if first_show || skin_changed {
        sync_page(&w);
    }
    ActionResult { ok: true, message: None }
}

#[tauri::command]
pub async fn panel_hide(app: AppHandle) {
    panel().lock().unwrap().shown = false;
    if let Some(w) = webview(&app) {
        let _ = w.hide();
        sync_page(&w);
    }
}

/// Whether the panel is signed in to Twitch; null until first known.
#[tauri::command]
pub fn panel_signed_in() -> serde_json::Value {
    json!(panel().lock().unwrap().signed_in)
}

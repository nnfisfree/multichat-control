//! Log in to StreamElements or Streamlabs with the streamer's own account, inside the app.
//!
//! Neither service hands out app logins, so instead of OAuth the app opens their real website in a
//! window. The streamer signs in there as usual (Twitch, YouTube, Google...) and the session stays
//! in their own copy of the app's browser profile. Nothing goes through anyone else's account or
//! server: the app is just a bridge to the streamer's own data.
//!
//! - StreamElements: the dashboard keeps a personal key (the `se-token` cookie, a JWT) that its
//!   public API and live socket accept. We take it once and use the API from then on.
//! - Streamlabs: the session cookie can't be read by scripts, so history is read by a hidden window
//!   on streamlabs.com, which makes the same calls its own dashboard makes. Live alerts use the
//!   socket token that page hands out.
//!
//! As everywhere else, pages hand results back by navigating to a private address that we intercept
//! and block, so a website never gets a way to call into the app.

use crate::storage::log;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

const RESULT_HOST: &str = "nnf-site.invalid";

fn login_label(service: &str) -> String {
    format!("site-login-{service}")
}

type Waiter = oneshot::Sender<Result<String, String>>;

fn waiters() -> &'static Mutex<HashMap<String, Waiter>> {
    static W: std::sync::OnceLock<Mutex<HashMap<String, Waiter>>> = std::sync::OnceLock::new();
    W.get_or_init(|| Mutex::new(HashMap::new()))
}

fn finish(label: &str, result: Result<String, String>) {
    if let Some(tx) = waiters().lock().unwrap().remove(label) {
        let _ = tx.send(result);
    }
}

fn result_of(u: &url::Url) -> String {
    let encoded = u.fragment().unwrap_or_default();
    url::form_urlencoded::parse(format!("x={encoded}").as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default()
}

/// Runs on every page of the login window. Once the streamer is signed in it checks that history
/// AND live alerts work with this login, and only then hands the key back.
fn login_probe(service: &str) -> String {
    let check = match service {
        "streamelements" => r#"
  if (!/(^|\.)streamelements\.com$/.test(location.hostname)) return null;
  const m = document.cookie.match(/(?:^|; )se-token=([^;]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  const r = await fetch('https://api.streamelements.com/kappa/v2/channels/me', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  const me = r.ok ? await r.json() : null;
  if (!me || !me._id) return null;
  const live = await new Promise((done) => {
    const ws = new WebSocket('wss://astro.streamelements.com');
    const t = setTimeout(() => { ws.close(); done(false) }, 10000);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'welcome') ws.send(JSON.stringify({ type: 'subscribe', nonce: 'nnf', data: { topic: 'channel.activities', room: me._id, token, token_type: 'jwt' } }));
      if (msg.type === 'response' || msg.type === 'error') { clearTimeout(t); ws.close(); done(msg.type === 'response' && !msg.error) }
    };
    ws.onerror = () => { clearTimeout(t); done(false) };
  });
  return live ? token : null;"#,
        _ => r#"
  if (location.hostname !== 'streamlabs.com') return null;
  const h = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const page = await fetch('/dashboard/recent-events', { credentials: 'include' });
  if (!page.ok || !/\/dashboard/.test(new URL(page.url).pathname)) return null;
  const token = ((await page.text()).match(/id="token"[^>]*value="([0-9A-Za-z]+)"/) || [])[1];
  if (!token) return null;
  const recent = await fetch('/api/v5/recentevents/' + token, { headers: h });
  const io = await fetch('/api/v5/io/info?token=' + token, { headers: h });
  if (!recent.ok || !io.ok) return null;
  const path = new URL((await io.json()).path);
  const live = await new Promise((done) => {
    const ws = new WebSocket('wss://' + path.host + '/socket.io/?token=' + encodeURIComponent(path.searchParams.get('token') || '') + '&EIO=3&transport=websocket');
    const t = setTimeout(() => { ws.close(); done(false) }, 10000);
    ws.onmessage = (e) => { if (String(e.data).startsWith('40')) { clearTimeout(t); ws.close(); done(true) } else if (String(e.data).startsWith('44')) { clearTimeout(t); ws.close(); done(false) } };
    ws.onerror = () => { clearTimeout(t); done(false) };
  });
  return live ? token : null;"#,
    };
    format!(
        r#"(async () => {{
  if (window.__nnfProbe) return;
  window.__nnfProbe = true;
  const check = async () => {{ {check}
  }};
  // the dashboards are single-page apps, so keep checking for a while after each page load
  for (let i = 0; i < 300; i++) {{
    let key = null;
    try {{ key = await check() }} catch {{}}
    if (key) {{ location.href = 'https://{RESULT_HOST}/#' + encodeURIComponent(key); return }}
    await new Promise((r) => setTimeout(r, 2000));
  }}
}})()"#
    )
}

/// Opens the service's website in a window and waits until the streamer is logged in and
/// everything needed works. The key is saved, the window closes on its own, and we return.
/// Closing the window first cancels.
#[tauri::command]
pub async fn site_login(app: AppHandle, service: String) -> Result<(), String> {
    let start = match service.as_str() {
        "streamelements" => "https://streamelements.com/dashboard",
        "streamlabs" => "https://streamlabs.com/dashboard",
        _ => return Err("Unknown service.".into()),
    };
    let label = login_label(&service);
    if let Some(old) = app.get_webview_window(&label) {
        finish(&label, Err("Login cancelled.".into()));
        let _ = old.destroy();
    }
    let (tx, rx) = oneshot::channel();
    waiters().lock().unwrap().insert(label.clone(), tx);
    let probe = login_probe(&service);
    let (nav_label, close_label) = (label.clone(), label.clone());
    let title = if service == "streamelements" { "Log in to StreamElements" } else { "Log in to Streamlabs" };
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url::Url::parse(start).map_err(|e| e.to_string())?))
        .title(title)
        .inner_size(1000.0, 760.0)
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .on_navigation(move |u| {
            if u.host_str() == Some(RESULT_HOST) {
                finish(&nav_label, Ok(result_of(u)));
                return false;
            }
            // signing in goes through Twitch, Google, Facebook...: any secure page
            u.scheme() == "https"
        })
        .on_page_load(move |w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = w.eval(&probe);
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    window.on_window_event(move |e| {
        if matches!(e, WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }) {
            finish(&close_label, Err("Login cancelled.".into()));
        }
    });
    let result = tokio::time::timeout(Duration::from_secs(15 * 60), rx).await;
    let _ = window.destroy();
    let key = result.map_err(|_| "The login took too long. Try again.".to_string())?.map_err(|_| "Login cancelled.".to_string())??;
    crate::auth::save_site_login(&app, &service, &key)?;
    log(&service, "logged in through the website");
    Ok(())
}

/// One hidden window on streamlabs.com at a time.
static SL_TURN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Streamlabs: the last 30 days (recent events + every tip) and the live socket address, read with
/// the saved website session. `{ "error": "login" }` means the session is gone.
#[tauri::command]
pub async fn streamlabs_fetch(app: AppHandle) -> Result<serde_json::Value, String> {
    let token = crate::auth::site_key("streamlabs").ok_or("Not logged in to Streamlabs.")?;
    if !token.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Log in to Streamlabs again.".into());
    }
    let _turn = SL_TURN.lock().await;
    const LABEL: &str = "streamlabs-fetch";
    if let Some(old) = app.get_webview_window(LABEL) {
        let _ = old.destroy();
    }
    let (tx, rx) = oneshot::channel::<String>();
    let tx = Mutex::new(Some(tx));
    let script = format!(
        r#"(async () => {{
  if (location.hostname !== 'streamlabs.com' || window.__nnfFetch) return;
  window.__nnfFetch = true;
  const h = {{ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }};
  const since = Date.now() - 30 * 864e5;
  const get = async (p) => {{
    const r = await fetch(p, {{ headers: h, credentials: 'include' }});
    if (r.status === 401 || r.status === 403 || r.status === 419) throw 'login';
    const t = await r.text();
    try {{ return JSON.parse(t) }} catch {{ throw r.ok ? 'login' : 'error ' + r.status }}
  }};
  const recentEnough = (x) => Date.parse(x && x.created_at) >= since;
  let out;
  try {{
    const re = await get('/api/v5/recentevents/{token}');
    const recent = {{}};
    for (const [k, v] of Object.entries((re && re.data) || {{}})) if (Array.isArray(v)) recent[k] = v.filter(recentEnough);
    const donations = [];
    for (let page = 1; page <= 20; page++) {{
      const d = await get('/api/v5/donation/all?page=' + page);
      const list = (d && d.donations && d.donations.data) || [];
      donations.push(...list.filter(recentEnough));
      if (!list.length || !d.donations.next_page_url || !recentEnough(list[list.length - 1])) break;
    }}
    const io = await get('/api/v5/io/info?token={token}');
    // the streamer's name on their main platform, for the Connections list
    let account = null;
    try {{
      const si = await get('/api/v5/user/accounts/settings-info');
      const pages = (si && si.platform_page_urls) || {{}};
      const main = pages[si && si.primary_user_platform] || pages.twitch_account || pages.youtube_account;
      account = (main && main.page_name) || null;
    }} catch {{}}
    out = {{ recent, donations, socket: io && io.path, account }};
  }} catch (e) {{ out = {{ error: String(e) }} }}
  location.href = 'https://{RESULT_HOST}/#' + encodeURIComponent(JSON.stringify(out));
}})()"#
    );
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url::Url::parse("https://streamlabs.com/robots.txt").unwrap()))
        .visible(false)
        .skip_taskbar(true)
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .on_navigation(move |u| {
            if u.host_str() == Some(RESULT_HOST) {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(result_of(u));
                }
                return false;
            }
            u.scheme() == "https" && u.host_str().is_some_and(|h| h == "streamlabs.com" || h.ends_with(".streamlabs.com") || h.ends_with("cloudflare.com"))
        })
        .on_page_load(move |w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = w.eval(&script);
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(45), rx).await;
    let _ = window.destroy();
    let text = result.map_err(|_| "Streamlabs didn't answer in time.".to_string())?.map_err(|_| "Streamlabs didn't answer.".to_string())?;
    serde_json::from_str(&text).map_err(|_| "Streamlabs sent something unexpected.".into())
}

/// Signs the streamer out on the website too, so the next login starts fresh. Best effort.
pub async fn site_logout(app: &AppHandle, service: &str) {
    let (url, script) = match service {
        "streamelements" => (
            "https://streamelements.com/robots.txt",
            "for (const n of ['se-token', 'id_token_creator']) document.cookie = n + '=; Max-Age=0; path=/; domain=.streamelements.com';",
        ),
        "streamlabs" => ("https://streamlabs.com/logout", ""),
        _ => return,
    };
    let label = format!("site-logout-{service}");
    if let Some(old) = app.get_webview_window(&label) {
        let _ = old.destroy();
    }
    let (tx, rx) = oneshot::channel::<()>();
    let tx = Mutex::new(Some(tx));
    let script = script.to_string();
    let Ok(window) = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url::Url::parse(url).unwrap()))
        .visible(false)
        .skip_taskbar(true)
        .data_directory(crate::paths::webview_dir())
        .additional_browser_args(&crate::browser_args())
        .on_navigation(|u| u.scheme() == "https")
        .on_page_load(move |w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if !script.is_empty() {
                    let _ = w.eval(&script);
                }
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(());
                }
            }
        })
        .build()
    else {
        return;
    };
    let _ = tokio::time::timeout(Duration::from_secs(15), rx).await;
    // give the cookie change a moment to land before the window goes
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = window.destroy();
}

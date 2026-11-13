//! Logins and authorised requests for Twitch, Kick, YouTube, StreamElements and Streamlabs.
//!
//! Tokens live only here. The engine asks for a request ("GET this Helix URL as Twitch") and this
//! module adds the token, renews it shortly before it expires, retries once after a 401, and only
//! ever sends a token to that service's own servers. The page never sees a token, except the one
//! StreamElements needs inside its socket, which `socket_token` hands out on purpose.

use crate::paths::data_dir;
use crate::secrets;
use crate::storage::log;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Twitch's public client: public clients have no secret, so this is safe to ship.
const TWITCH_CLIENT_ID: &str = "4m3nuqjxsh7i77pmmhicljsoomghwd";
const TWITCH_SCOPES: &str = "user:read:chat user:write:chat user:read:emotes \
moderator:manage:announcements moderator:manage:shoutouts moderator:manage:chat_settings \
moderator:manage:banned_users moderator:manage:chat_messages moderator:manage:shield_mode \
moderator:read:followers channel:moderate channel:manage:redemptions channel:manage:polls \
channel:manage:predictions channel:manage:raids channel:manage:broadcast channel:edit:commercial \
channel:read:subscriptions channel:read:hype_train channel:read:goals channel:read:ads bits:read clips:edit \
moderator:read:chatters moderation:read channel:read:vips channel:manage:moderators channel:manage:vips \
moderator:manage:automod moderator:read:suspicious_users \
moderator:manage:warnings user:manage:chat_color user:manage:blocked_users user:manage:whispers";
const KICK_SCOPES: &str = "user:read channel:read channel:write channel:rewards:read channel:rewards:write chat:write moderation:ban moderation:chat_message:manage kicks:read";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Service { Twitch, Kick, Youtube, StreamElements, Streamlabs }

impl Service {
    fn parse(s: &str) -> Result<Self, String> {
        Ok(match s {
            "twitch" => Self::Twitch,
            "kick" => Self::Kick,
            "youtube" => Self::Youtube,
            "streamelements" => Self::StreamElements,
            "streamlabs" => Self::Streamlabs,
            _ => return Err(format!("Unknown service: {s}")),
        })
    }
    fn key(self) -> &'static str {
        match self {
            Self::Twitch => "twitch",
            Self::Kick => "kick",
            Self::Youtube => "youtube",
            Self::StreamElements => "streamelements",
            Self::Streamlabs => "streamlabs",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Twitch => "Twitch",
            Self::Kick => "Kick",
            Self::Youtube => "YouTube",
            Self::StreamElements => "StreamElements",
            Self::Streamlabs => "Streamlabs",
        }
    }
    /// The only servers this service's token is ever sent to.
    fn hosts(self) -> &'static [&'static str] {
        match self {
            Self::Twitch => &["api.twitch.tv", "id.twitch.tv"],
            Self::Kick => &["api.kick.com"],
            Self::Youtube => &["www.googleapis.com", "youtube.googleapis.com"],
            Self::StreamElements => &["api.streamelements.com"],
            Self::Streamlabs => &["streamlabs.com"],
        }
    }
    fn token_url(self) -> &'static str {
        match self {
            Self::Twitch => "https://id.twitch.tv/oauth2/token",
            Self::Kick => "https://id.kick.com/oauth/token",
            Self::Youtube => "https://oauth2.googleapis.com/token",
            Self::StreamElements => "https://api.streamelements.com/oauth2/token",
            Self::Streamlabs => "https://streamlabs.com/api/v2.0/token",
        }
    }
    fn header(self, host: &str, access: &str) -> String {
        match self {
            Self::Twitch if host == "id.twitch.tv" => format!("OAuth {access}"),
            Self::StreamElements => format!("OAuth {access}"),
            _ => format!("Bearer {access}"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    access: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refresh: Option<String>,
    /// Streamlabs tokens never expire, and the Electron version saved them without a time.
    #[serde(default = "never")]
    expires_at: f64,
}

/// Far in the future (year 2255): for tokens that don't expire.
fn never() -> f64 {
    9e15
}

fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

fn load_tokens(s: Service) -> Option<Tokens> {
    secrets::get(&format!("{}.tokens", s.key())).and_then(|t| serde_json::from_str(&t).ok())
}

fn save_tokens(s: Service, t: Option<&Tokens>) {
    let text = t.and_then(|t| serde_json::to_string(t).ok());
    let _ = secrets::set(&format!("{}.tokens", s.key()), text.as_deref());
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("Multichat-Control/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client")
    })
}

// ---- Which developer app each service logs in with ----

struct Creds { id: String, secret: Option<String> }

fn settings() -> Value {
    std::fs::read_to_string(data_dir().join("settings.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

fn setting(name: &str) -> Option<String> {
    settings().get(name).and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty()).map(String::from)
}

fn built_in(s: Service) -> Option<Creds> {
    let (id, secret) = match s {
        Service::Youtube => (option_env!("NNF_YOUTUBE_CLIENT_ID"), option_env!("NNF_YOUTUBE_CLIENT_SECRET")),
        Service::Kick => (option_env!("NNF_KICK_CLIENT_ID"), option_env!("NNF_KICK_CLIENT_SECRET")),
        Service::StreamElements => (option_env!("NNF_STREAMELEMENTS_CLIENT_ID"), option_env!("NNF_STREAMELEMENTS_CLIENT_SECRET")),
        Service::Streamlabs => (option_env!("NNF_STREAMLABS_CLIENT_ID"), option_env!("NNF_STREAMLABS_CLIENT_SECRET")),
        Service::Twitch => return None,
    };
    match (id, secret) {
        (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Some(Creds { id: id.into(), secret: Some(secret.into()) }),
        _ => None,
    }
}

/// A user's own developer app wins, so they can opt out of the shared quota.
fn creds(s: Service) -> Option<Creds> {
    match s {
        Service::Twitch => Some(Creds { id: setting("twitchClientId").unwrap_or_else(|| TWITCH_CLIENT_ID.into()), secret: None }),
        Service::Youtube | Service::Kick => {
            let id = setting(if s == Service::Youtube { "youtubeClientId" } else { "kickClientId" });
            let secret = secrets::get(&format!("{}.clientSecret", s.key()));
            match (id, secret) {
                (Some(id), Some(secret)) => Some(Creds { id, secret: Some(secret) }),
                _ => built_in(s),
            }
        }
        _ => built_in(s),
    }
}

// ---- Renewing tokens ----

static REFRESHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn changed(app: &AppHandle, s: Service, logged_in: bool) {
    let _ = app.emit("auth:changed", json!({ "service": s.key(), "loggedIn": logged_in }));
}

fn error_text(body: &Value, fallback: &str) -> String {
    for k in ["message", "error_description"] {
        if let Some(t) = body.get(k).and_then(|v| v.as_str()) {
            return t.to_string();
        }
    }
    if let Some(t) = body.get("error").and_then(|e| e.get("message").and_then(|m| m.as_str()).or_else(|| e.as_str())) {
        return t.to_string();
    }
    fallback.to_string()
}

fn tokens_from(body: &Value, old_refresh: Option<String>) -> Result<Tokens, String> {
    let access = body.get("access_token").and_then(|v| v.as_str()).ok_or("The login server sent no token.")?;
    let expires = body.get("expires_in").and_then(|v| v.as_f64()).filter(|v| *v > 0.0);
    Ok(Tokens {
        access: access.to_string(),
        refresh: body.get("refresh_token").and_then(|v| v.as_str()).map(String::from).or(old_refresh),
        expires_at: expires.map_or_else(never, |e| now_ms() + e * 1000.0),
    })
}

/// Renews the token. `stale` is the token that just failed: if another request already renewed
/// it meanwhile, that newer token is used instead of renewing twice.
async fn refresh(app: &AppHandle, s: Service, stale: Option<&str>) -> Result<Tokens, String> {
    let _guard = REFRESHING.lock().await;
    let current = load_tokens(s).ok_or_else(|| format!("Not logged in to {}.", s.label()))?;
    let fresh_enough = current.expires_at - 60_000.0 > now_ms();
    if fresh_enough && stale.is_none_or(|old| old != current.access) {
        return Ok(current);
    }
    let refresh_token = current.refresh.clone().ok_or_else(|| format!("Your {} login expired. Please log in again.", s.label()))?;
    let c = creds(s).ok_or_else(|| format!("{} login isn't set up.", s.label()))?;
    let mut form = vec![("grant_type", "refresh_token".to_string()), ("refresh_token", refresh_token), ("client_id", c.id)];
    if let Some(secret) = c.secret {
        form.push(("client_secret", secret));
    }
    let res = client().post(s.token_url()).form(&form).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if status.is_client_error() {
        // The login is gone (revoked or too old): forget it so the app asks again.
        save_tokens(s, None);
        changed(app, s, false);
        log(s.key(), &format!("login expired: {}", error_text(&body, status.as_str())));
        return Err(format!("Your {} login expired. Please log in again.", s.label()));
    }
    if !status.is_success() {
        return Err(error_text(&body, &format!("{} error {}", s.label(), status.as_u16())));
    }
    let t = tokens_from(&body, current.refresh)?;
    save_tokens(s, Some(&t));
    Ok(t)
}

async fn fresh(app: &AppHandle, s: Service) -> Result<Tokens, String> {
    let t = load_tokens(s).ok_or_else(|| format!("Not logged in to {}.", s.label()))?;
    if t.expires_at - 60_000.0 > now_ms() { Ok(t) } else { refresh(app, s, Some(&t.access)).await }
}

// ---- Requests ----

#[derive(Serialize)]
pub struct HttpReply { status: u16, body: String }

fn checked_url(url: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(url).map_err(|_| "Bad address.".to_string())?;
    if u.scheme() != "https" {
        return Err("Only secure (https) addresses are allowed.".into());
    }
    Ok(u)
}

async fn send(method: &str, url: &url::Url, headers: &HashMap<String, String>, body: Option<&String>, auth: Option<(&str, &str)>) -> Result<HttpReply, String> {
    let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes()).map_err(|_| "Bad method.".to_string())?;
    let mut req = client().request(method, url.clone());
    for (k, v) in headers {
        if !k.eq_ignore_ascii_case("authorization") {
            req = req.header(k, v);
        }
    }
    if let Some((name, value)) = auth {
        req = req.header(name, value);
    }
    if let Some(b) = body {
        req = req.body(b.clone());
    }
    let res = req.send().await.map_err(|e| if e.is_timeout() { "The request timed out.".to_string() } else { e.to_string() })?;
    let status = res.status().as_u16();
    Ok(HttpReply { status, body: res.text().await.unwrap_or_default() })
}

/// A request made as one of the user's accounts. The token is added here.
#[tauri::command]
pub async fn api_request(app: AppHandle, service: String, method: String, url: String, headers: Option<HashMap<String, String>>, body: Option<String>) -> Result<HttpReply, String> {
    let s = Service::parse(&service)?;
    let u = checked_url(&url)?;
    let host = u.host_str().unwrap_or_default().to_string();
    if !s.hosts().contains(&host.as_str()) {
        return Err(format!("{} tokens are only sent to {}.", s.label(), s.hosts().join(", ")));
    }
    let mut headers = headers.unwrap_or_default();
    if s == Service::Twitch {
        if let Some(c) = creds(s) {
            headers.insert("Client-Id".into(), c.id);
        }
    }
    let t = fresh(&app, s).await?;
    let reply = send(&method, &u, &headers, body.as_ref(), Some(("Authorization", &s.header(&host, &t.access)))).await?;
    if reply.status != 401 {
        return Ok(reply);
    }
    let t = refresh(&app, s, Some(&t.access)).await?;
    send(&method, &u, &headers, body.as_ref(), Some(("Authorization", &s.header(&host, &t.access)))).await
}

/// A plain request with no account: emote lists, Kick's channel page and the like. The page
/// can't do these itself, because most of those servers don't allow requests from web pages.
#[tauri::command]
pub async fn net_fetch(method: String, url: String, headers: Option<HashMap<String, String>>, body: Option<String>) -> Result<HttpReply, String> {
    let u = checked_url(&url)?;
    send(&method, &u, &headers.unwrap_or_default(), body.as_ref(), None).await
}

// ---- Logging in ----

fn cancel_flag(s: Service) -> &'static AtomicBool {
    static FLAGS: [AtomicBool; 5] = [AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false)];
    &FLAGS[s as usize]
}

fn random_b64(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut bytes);
    B64URL.encode(bytes)
}

async fn post_form(url: &str, form: &[(&str, String)]) -> Result<(u16, Value), String> {
    let res = client().post(url).form(form).send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    Ok((status, res.json().await.unwrap_or(Value::Null)))
}

/// Twitch's device flow: the app shows a code, the user confirms it on twitch.tv.
async fn twitch_login(app: &AppHandle) -> Result<Tokens, String> {
    let id = creds(Service::Twitch).map(|c| c.id).unwrap_or_else(|| TWITCH_CLIENT_ID.into());
    let (status, d) = post_form("https://id.twitch.tv/oauth2/device", &[("client_id", id.clone()), ("scopes", TWITCH_SCOPES.into())]).await?;
    if status >= 400 {
        return Err(error_text(&d, "Twitch refused the login."));
    }
    let code = d["user_code"].as_str().unwrap_or_default().to_string();
    let url = d["verification_uri"].as_str().unwrap_or("https://www.twitch.tv/activate").to_string();
    let device = d["device_code"].as_str().unwrap_or_default().to_string();
    let interval = d["interval"].as_u64().unwrap_or(5).max(1);
    let deadline = Instant::now() + Duration::from_secs(d["expires_in"].as_u64().unwrap_or(1800));
    let _ = app.emit("auth:device", json!({ "service": "twitch", "code": code, "url": url }));
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if cancel_flag(Service::Twitch).swap(false, Ordering::SeqCst) {
            return Err("Login cancelled.".into());
        }
        let (status, t) = post_form("https://id.twitch.tv/oauth2/token", &[
            ("client_id", id.clone()),
            ("scopes", TWITCH_SCOPES.into()),
            ("device_code", device.clone()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code".into()),
        ]).await?;
        if status < 300 {
            return tokens_from(&t, None);
        }
        if error_text(&t, "").contains("authorization_pending") {
            continue;
        }
        return Err(error_text(&t, "Twitch refused the login."));
    }
    Err("The login code expired. Please try again.".into())
}

struct Loopback { authorize: &'static str, port: u16, host: &'static str, path: &'static str, scope: &'static str, extra: &'static [(&'static str, &'static str)] }

fn loopback_of(s: Service) -> Loopback {
    match s {
        Service::Kick => Loopback { authorize: "https://id.kick.com/oauth/authorize", port: 53682, host: "localhost", path: "/callback", scope: KICK_SCOPES, extra: &[] },
        Service::Youtube => Loopback {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth", port: 0, host: "127.0.0.1", path: "/callback",
            scope: "https://www.googleapis.com/auth/youtube.force-ssl", extra: &[("access_type", "offline"), ("prompt", "consent")],
        },
        Service::StreamElements => Loopback { authorize: "https://api.streamelements.com/oauth2/authorize", port: 53683, host: "localhost", path: "/streamelements", scope: "channel:read activities:read tips:read", extra: &[] },
        _ => Loopback { authorize: "https://streamlabs.com/api/v2.0/authorize", port: 53683, host: "localhost", path: "/streamlabs", scope: "donations.read socket.token", extra: &[] },
    }
}

fn page(ok: bool) -> String {
    let text = if ok { "Login complete. You can close this tab." } else { "Login failed. Please return to the app and try again." };
    format!("<!doctype html><meta charset=\"utf-8\"><title>Multichat Control</title><body style=\"background:#150a3c;color:#fff;font:18px sans-serif;display:grid;place-items:center;height:90vh\"><div>{text}</div>")
}

/// Opens the browser and waits for the login's redirect on a local port. PKCE and the state value
/// mean a stray request to the port can't complete or hijack the login.
async fn loopback_login(app: &AppHandle, s: Service) -> Result<Tokens, String> {
    let c = creds(s).ok_or_else(|| format!("This copy of the app has no {} login built in yet.", s.label()))?;
    let cfg = loopback_of(s);
    let verifier = random_b64(48);
    let challenge = B64URL.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_b64(24);
    let listener = TcpListener::bind(("127.0.0.1", cfg.port)).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse { format!("Login port {} is in use by another program.", cfg.port) } else { e.to_string() }
    })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://{}:{}{}", cfg.host, port, cfg.path);
    let mut url = url::Url::parse(cfg.authorize).map_err(|e| e.to_string())?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", &c.id).append_pair("scope", cfg.scope);
        for (k, v) in cfg.extra {
            q.append_pair(k, v);
        }
        q.append_pair("redirect_uri", &redirect).append_pair("response_type", "code").append_pair("state", &state)
            .append_pair("code_challenge", &challenge).append_pair("code_challenge_method", "S256");
    }
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    let code = loop {
        if cancel_flag(s).swap(false, Ordering::SeqCst) {
            return Err("Login cancelled.".into());
        }
        if Instant::now() > deadline {
            return Err("Login timed out.".into());
        }
        let Ok(Ok((mut stream, _))) = tokio::time::timeout(Duration::from_millis(500), listener.accept()).await else { continue };
        let mut buf = vec![0u8; 8192];
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf)).await.ok().and_then(|r| r.ok()).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
        let parsed = url::Url::parse(&format!("http://localhost{target}")).ok();
        let Some(parsed) = parsed.filter(|p| p.path() == cfg.path) else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        };
        let q: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        let ok = q.contains_key("code") && q.get("state") == Some(&state);
        let html = page(ok);
        let head = format!("HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", if ok { "200 OK" } else { "400 Bad Request" }, html.len());
        let _ = stream.write_all(head.as_bytes()).await;
        let _ = stream.write_all(html.as_bytes()).await;
        if ok {
            break q["code"].clone();
        }
        if let Some(why) = q.get("error_description").or_else(|| q.get("error")) {
            // StreamElements only says error=true when the user declines.
            let declined = why == "true" || why == "access_denied";
            // Until Google verifies the app, its login page shows an "unverified app" warning, and
            // "Back to safety" there also comes back as a decline.
            return Err(if declined && s == Service::Youtube {
                "Login was declined in the browser. If Google said the app isn't verified, log in again and choose Advanced, then Go to MultichatControl.".into()
            } else if declined {
                "Login was declined in the browser.".into()
            } else {
                why.clone()
            });
        }
    };
    drop(listener);
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()), ("code", code), ("code_verifier", verifier),
        ("redirect_uri", redirect), ("client_id", c.id),
    ];
    if let Some(secret) = c.secret {
        form.push(("client_secret", secret));
    }
    let (status, body) = post_form(s.token_url(), &form).await?;
    if status >= 400 {
        return Err(error_text(&body, &format!("{} refused the login.", s.label())));
    }
    tokens_from(&body, None)
}

#[tauri::command]
pub async fn auth_login(app: AppHandle, service: String) -> Result<(), String> {
    let s = Service::parse(&service)?;
    cancel_flag(s).store(false, Ordering::SeqCst);
    let t = if s == Service::Twitch { twitch_login(&app).await? } else { loopback_login(&app, s).await? };
    save_tokens(s, Some(&t));
    log(s.key(), "logged in");
    changed(&app, s, true);
    Ok(())
}

#[tauri::command]
pub fn auth_cancel(service: String) -> Result<(), String> {
    cancel_flag(Service::parse(&service)?).store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn auth_logout(app: AppHandle, service: String) -> Result<(), String> {
    let s = Service::parse(&service)?;
    if let Some(t) = load_tokens(s) {
        // Revoking is a courtesy to the service: a failure doesn't stop the logout.
        let revoke = match s {
            Service::Twitch => Some(("https://id.twitch.tv/oauth2/revoke".to_string(), vec![("client_id", creds(s).map(|c| c.id).unwrap_or_default()), ("token", t.access.clone())])),
            Service::Youtube => t.refresh.clone().map(|r| ("https://oauth2.googleapis.com/revoke".to_string(), vec![("token", r)])),
            Service::Kick => Some(("https://id.kick.com/oauth/revoke".to_string(), vec![("token", t.access.clone()), ("token_hint_type", "access_token".to_string())])),
            _ => None,
        };
        if let Some((url, form)) = revoke {
            let _ = client().post(url).form(&form).send().await;
        }
    }
    save_tokens(s, None);
    log(s.key(), "logged out");
    changed(&app, s, false);
    Ok(())
}

/// Whether there's a saved login, and whether the app can log in at all (a developer app exists).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthState { logged_in: bool, configured: bool }

#[tauri::command]
pub fn auth_state(service: String) -> Result<AuthState, String> {
    let s = Service::parse(&service)?;
    Ok(AuthState { logged_in: load_tokens(s).is_some(), configured: creds(s).is_some() })
}

/// Which platforms this copy has a built-in login for (shown in Settings).
#[tauri::command]
pub fn built_in_logins() -> Value {
    json!({ "youtube": built_in(Service::Youtube).is_some(), "kick": built_in(Service::Kick).is_some() })
}

/// StreamElements wants its token inside the socket's subscribe message, so this one service
/// gets its (renewed) token handed to the engine. No other service's token ever leaves here.
#[tauri::command]
pub async fn socket_token(app: AppHandle, service: String) -> Result<String, String> {
    let s = Service::parse(&service)?;
    if s != Service::StreamElements {
        return Err("Not available for this service.".into());
    }
    Ok(fresh(&app, s).await?.access)
}

/// The answer to a WebSocket server's password challenge, computed here so the password stays
/// here. OBS and Streamer.bot use the same scheme: base64(sha256(base64(sha256(password + salt)) + challenge)).
fn challenge_answer(secret_name: &str, salt: &str, challenge: &str) -> String {
    let password = secrets::get(secret_name).unwrap_or_default();
    let b64 = base64::engine::general_purpose::STANDARD;
    let secret = b64.encode(Sha256::digest(format!("{password}{salt}").as_bytes()));
    b64.encode(Sha256::digest(format!("{secret}{challenge}").as_bytes()))
}

/// OBS's WebSocket login.
#[tauri::command]
pub fn obs_auth(salt: String, challenge: String) -> String {
    challenge_answer("obs.password", &salt, &challenge)
}

/// Streamer.bot's WebSocket login.
#[tauri::command]
pub fn sb_auth(salt: String, challenge: String) -> String {
    challenge_answer("streamerbot.password", &salt, &challenge)
}

// ---- For other parts of the core (YouTube's chat stream) ----

/// A token that is valid now, renewed first if it's about to run out. Stays inside the core.
pub(crate) async fn access_token(app: &AppHandle, service: &str) -> Result<String, String> {
    Ok(fresh(app, Service::parse(service)?).await?.access)
}

/// Renews a token the service just refused.
pub(crate) async fn renew(app: &AppHandle, service: &str, stale: &str) -> Result<(), String> {
    refresh(app, Service::parse(service)?, Some(stale)).await.map(|_| ())
}

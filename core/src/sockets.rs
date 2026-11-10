//! A WebSocket opened by the core for the engine, for servers that only accept connections that
//! say they come from their own site (Kick's live server refuses anything else). A web page can't
//! set that header, so the core opens the socket and passes messages both ways.
//! Only Kick's servers are allowed here.

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

enum Out { Text(String), Close }

static NEXT: AtomicU64 = AtomicU64::new(1);

fn sockets() -> &'static Mutex<HashMap<u64, mpsc::UnboundedSender<Out>>> {
    static S: std::sync::OnceLock<Mutex<HashMap<u64, mpsc::UnboundedSender<Out>>>> = std::sync::OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn allowed(u: &url::Url) -> bool {
    u.scheme() == "wss" && u.host_str().is_some_and(|h| h == "kick.com" || h.ends_with(".kick.com"))
}

/// Opens the socket; "ws:open", "ws:message" and "ws:close" events carry the returned id.
#[tauri::command]
pub fn ws_open(app: AppHandle, url: String) -> Result<u64, String> {
    let u = url::Url::parse(&url).map_err(|_| "Bad address.".to_string())?;
    if !allowed(&u) {
        return Err("This connection isn't allowed.".into());
    }
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    sockets().lock().unwrap().insert(id, tx);
    tauri::async_runtime::spawn(async move {
        let finish = |code: u16, reason: String| {
            sockets().lock().unwrap().remove(&id);
            let _ = app.emit("ws:close", json!({ "id": id, "code": code, "reason": reason }));
        };
        let mut req = match u.as_str().into_client_request() {
            Ok(r) => r,
            Err(e) => return finish(1006, e.to_string()),
        };
        let origin = format!("https://{}", if u.host_str().is_some_and(|h| h.ends_with("kick.com")) { "kick.com" } else { u.host_str().unwrap_or_default() });
        req.headers_mut().insert("Origin", origin.parse().unwrap());
        req.headers_mut().insert("User-Agent", BROWSER_UA.parse().unwrap());
        let ws = match tokio::time::timeout(std::time::Duration::from_secs(15), tokio_tungstenite::connect_async(req)).await {
            Ok(Ok((ws, _))) => ws,
            Ok(Err(e)) => return finish(1006, e.to_string()),
            Err(_) => return finish(1006, "Connection timed out.".into()),
        };
        let _ = app.emit("ws:open", json!({ "id": id }));
        let (mut write, mut read) = ws.split();
        loop {
            tokio::select! {
                out = rx.recv() => match out {
                    Some(Out::Text(t)) => { if write.send(Message::text(t)).await.is_err() { break finish(1006, "Send failed.".into()); } }
                    Some(Out::Close) | None => { let _ = write.send(Message::Close(None)).await; break finish(1000, String::new()); }
                },
                msg = read.next() => match msg {
                    Some(Ok(Message::Text(t))) => { let _ = app.emit("ws:message", json!({ "id": id, "data": t.to_string() })); }
                    Some(Ok(Message::Binary(b))) => { let _ = app.emit("ws:message", json!({ "id": id, "data": String::from_utf8_lossy(&b) })); }
                    Some(Ok(Message::Close(f))) => break finish(f.as_ref().map_or(1000, |f| u16::from(f.code)), f.map(|f| f.reason.to_string()).unwrap_or_default()),
                    Some(Ok(_)) => {}
                    Some(Err(e)) => break finish(1006, e.to_string()),
                    None => break finish(1006, String::new()),
                },
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn ws_send(id: u64, data: String) {
    if let Some(tx) = sockets().lock().unwrap().get(&id) {
        let _ = tx.send(Out::Text(data));
    }
}

#[tauri::command]
pub fn ws_close(id: u64) {
    if let Some(tx) = sockets().lock().unwrap().get(&id) {
        let _ = tx.send(Out::Close);
    }
}

//! TikTok LIVE chat, read-only. TikTok has no official API for this, so it uses the same
//! unofficial "Webcast" connection as TikFinity and the TikTok-Live-Connector libraries:
//!
//! 1. `tiktok_room`: TikTok's own web endpoint says whether @user is live and gives the room id.
//!    Free, and polled by the engine while the streamer is offline.
//! 2. `tiktok_connect`: Euler Stream (the user's own API key) signs the connection and hands back
//!    the first batch plus the push server address, then we hold the WebSocket ourselves, decode
//!    the protobuf frames and pass the engine plain JSON as "tiktok:items".
//!
//! The Euler key is DPAPI-encrypted with the other secrets and never reaches the webview.
//! Protocol notes: PROTOCOL.md next to this file.

mod proto;

use crate::secrets;
use crate::storage::log;
use futures_util::{SinkExt, StreamExt};
use prost::Message as _;
use proto::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const EULER: &str = "https://api.eulerstream.com";
const KEY_NAME: &str = "tiktok.eulerKey";

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent(UA).build().expect("http client"))
}

/// "@Name", "tiktok.com/@name/live" or "name" -> "name". None if it can't be a TikTok handle.
pub fn clean_handle(input: &str) -> Option<String> {
    let mut s = input.trim();
    if let Some(i) = s.find("tiktok.com/") {
        s = &s[i + "tiktok.com/".len()..];
    }
    let s = s.trim_start_matches('@');
    let s = s.split(['/', '?', '#']).next().unwrap_or_default();
    let ok = (2..=24).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    ok.then(|| s.to_ascii_lowercase())
}

// ---- 1. is @user live? ----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    handle: String,
    nickname: String,
    avatar: Option<String>,
    room_id: Option<String>,
    live: bool,
    title: Option<String>,
    followers: Option<i64>,
}

/// Reads TikTok's api-live endpoint (no signing, no Euler quota). liveRoom.status 2 = live, 4 = ended.
#[tauri::command]
pub async fn tiktok_room(username: String) -> Result<Room, String> {
    let handle = clean_handle(&username).ok_or("That doesn't look like a TikTok username.")?;
    let mut u = url::Url::parse("https://www.tiktok.com/api-live/user/room/").unwrap();
    u.query_pairs_mut()
        .append_pair("aid", "1988")
        .append_pair("app_name", "tiktok_web")
        .append_pair("device_platform", "web_pc")
        .append_pair("uniqueId", &handle)
        .append_pair("sourceType", "54");
    let r = http().get(u).header("Referer", "https://www.tiktok.com/").header("Accept", "application/json").send().await
        .map_err(|e| format!("Couldn't reach TikTok ({e})."))?;
    let status = r.status().as_u16();
    let body: Value = r.json().await.map_err(|_| format!("TikTok sent something unexpected (HTTP {status}). It may be asking for a captcha; try again in a minute."))?;
    if body["message"] == "user_not_found" {
        return Err(format!("There's no TikTok account called @{handle}."));
    }
    let user = &body["data"]["user"];
    if user.is_null() {
        return Err(format!("TikTok didn't return @{handle} (code {}). Try again in a minute.", body["statusCode"]));
    }
    let room = &body["data"]["liveRoom"];
    let room_id = user["roomId"].as_str().filter(|s| !s.is_empty() && *s != "0").map(String::from);
    Ok(Room {
        handle: user["uniqueId"].as_str().unwrap_or(&handle).to_string(),
        nickname: user["nickname"].as_str().unwrap_or(&handle).to_string(),
        avatar: user["avatarThumb"].as_str().map(String::from),
        live: room_id.is_some() && room["status"].as_i64() == Some(2),
        room_id,
        title: room["title"].as_str().filter(|s| !s.is_empty()).map(String::from),
        followers: body["data"]["stats"]["followerCount"].as_i64(),
    })
}

// ---- the user's Euler Stream key ----

/// Saves the key after one free test call (rate limits, which costs nothing). None forgets it.
/// Returns how many connections a day the key allows, for the Settings line.
#[tauri::command]
pub async fn tiktok_key(key: Option<String>) -> Result<Option<i64>, String> {
    let Some(key) = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) else {
        secrets::set(KEY_NAME, None)?;
        log("tiktok", "Euler key removed");
        return Ok(None);
    };
    if key.len() < 16 || key.chars().any(char::is_whitespace) {
        return Err("That doesn't look like an Euler Stream API key. Copy the whole key and try again.".into());
    }
    let r = http().get(format!("{EULER}/accounts/me/rate_limits")).header("x-api-key", &key).send().await
        .map_err(|e| format!("Couldn't reach Euler Stream ({e})."))?;
    let status = r.status().as_u16();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    match status {
        200 => {
            secrets::set(KEY_NAME, Some(&key))?;
            let day = body["day"]["max"].as_i64();
            log("tiktok", &format!("Euler key saved ({} connections a day)", day.map_or("?".into(), |d| d.to_string())));
            Ok(day)
        }
        401 | 403 => Err("Euler Stream says that key isn't valid. Copy it again from your Euler Stream dashboard.".into()),
        _ => Err(format!("Euler Stream couldn't check the key right now (HTTP {status}). Try again in a minute.")),
    }
}

// ---- 2. the live connection ----

static NEXT: AtomicU64 = AtomicU64::new(1);

fn running() -> &'static Mutex<HashMap<u64, tauri::async_runtime::JoinHandle<()>>> {
    static R: OnceLock<Mutex<HashMap<u64, tauri::async_runtime::JoinHandle<()>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Why a connection ended. The engine decides what to do from `code`.
struct End { code: &'static str, message: String }
fn end(code: &'static str, message: impl Into<String>) -> End { End { code, message: message.into() } }

/// Opens the room. "tiktok:open", "tiktok:items" and "tiktok:end" carry the returned id.
#[tauri::command]
pub fn tiktok_connect(app: AppHandle, room_id: String) -> u64 {
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    let task = tauri::async_runtime::spawn(async move {
        let result = session(&app, id, &room_id).await;
        let e = result.err().unwrap_or(End { code: "closed", message: String::new() });
        log("tiktok", &format!("connection {id} ended: {} {}", e.code, e.message));
        running().lock().unwrap().remove(&id);
        let _ = app.emit("tiktok:end", json!({ "id": id, "code": e.code, "message": e.message }));
    });
    running().lock().unwrap().insert(id, task);
    id
}

#[tauri::command]
pub fn tiktok_disconnect(id: u64) {
    if let Some(h) = running().lock().unwrap().remove(&id) {
        h.abort();
    }
}

/// Euler signs the connection: first batch of messages, push server, and a cookie to send along.
/// `key` None is Euler's anonymous tier, only used by the live test below.
async fn sign(room_id: &str, key: Option<&str>) -> Result<(FetchResult, String, String), End> {
    let mut u = url::Url::parse(&format!("{EULER}/webcast/rooms/{room_id}/connect")).map_err(|_| end("error", "Bad room id."))?;
    u.query_pairs_mut()
        .append_pair("client", "multichat-control")
        .append_pair("user_agent", UA)
        .append_pair("client_enter", "true")
        .append_pair("platform", "web");
    let mut req = http().get(u).header("Accept", "application/protobuf,application/json");
    if let Some(k) = key { req = req.header("x-api-key", k); }
    let r = req.send().await
        .map_err(|e| end("network", format!("Couldn't reach Euler Stream ({e}).")))?;
    let status = r.status().as_u16();
    let header = |name: &str| r.headers().get(name).and_then(|v| v.to_str().ok()).map(String::from);
    let cookie = header("x-set-tt-cookie");
    let real_room = header("x-room-id").unwrap_or_else(|| room_id.to_string());
    let bytes = r.bytes().await.map_err(|e| end("network", e.to_string()))?;
    let server_says = || serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| v["message"].as_str().map(String::from)).unwrap_or_default();
    match status {
        200 => {}
        401 | 403 => return Err(end("key", "Euler Stream refused your key. Check it in Settings → TikTok.")),
        402 => return Err(end("key", format!("Euler Stream needs a paid plan for this. {}", server_says()))),
        429 => return Err(end("limit", format!("Your Euler Stream key hit its limit for now. {}", server_says()))),
        _ => return Err(end("error", format!("Euler Stream error (HTTP {status}). {}", server_says()))),
    }
    let cookie = cookie.ok_or_else(|| end("error", "Euler Stream didn't send the TikTok cookie. Try again in a minute."))?;
    // Set-Cookie style: only the first name=value counts
    let cookie = cookie.split(';').next().unwrap_or_default().trim().to_string();
    let first = FetchResult::decode(bytes.as_ref()).map_err(|e| end("error", format!("Couldn't read Euler's reply ({e}).")))?;
    if first.push_server.is_empty() || first.cursor.is_empty() {
        return Err(end("offline", "TikTok didn't open the room. The stream may have just ended."));
    }
    Ok((first, cookie, real_room))
}

/// The push server address with the parameters tiktok.com's own player sends.
fn socket_url(first: &FetchResult, room_id: &str) -> String {
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    let mut params: Vec<(String, String)> = [
        ("version_code", "180800"), ("aid", "1988"), ("app_language", "en"), ("app_name", "tiktok_web"),
        ("browser_platform", "Win32"), ("browser_language", "en-US"), ("browser_name", "Mozilla"),
        ("browser_version", &UA["Mozilla/".len()..]), ("browser_online", "true"), ("cookie_enabled", "true"),
        ("tz_name", "Etc/UTC"), ("device_platform", "web"), ("identity", "audience"), ("live_id", "12"),
        ("webcast_language", "en"), ("ws_direct", "0"), ("sup_ws_ds_opt", "1"), ("update_version_code", "2.0.0"),
        ("did_rule", "3"), ("screen_height", "1080"), ("screen_width", "1920"), ("heartbeat_duration", "0"),
        ("resp_content_type", "protobuf"), ("history_comment_count", "6"), ("client_enter", "1"), ("last_rtt", "150"),
        ("User-Agent", UA), ("compress", "gzip"), ("room_id", room_id),
        ("internal_ext", &first.internal_ext), ("cursor", &first.cursor),
    ].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    for (k, v) in &first.route_params {
        if v.is_empty() { continue; }
        match params.iter_mut().find(|(pk, _)| pk == k) {
            Some(p) => p.1 = v.clone(),
            None => params.push((k.clone(), v.clone())),
        }
    }
    for (k, v) in &params { q.append_pair(k, v); }
    format!("{}?{}&version_code=270000", first.push_server, q.finish())
}

fn frame(payload_type: &str, payload: Vec<u8>, log_id: i64) -> Vec<u8> {
    PushFrame { seq_id: 0, log_id, payload_encoding: "pb".into(), payload_type: payload_type.into(), payload }.encode_to_vec()
}

fn gunzip(b: Vec<u8>) -> Vec<u8> {
    if b.len() > 2 && b[0] == 0x1f && b[1] == 0x8b {
        let mut out = Vec::new();
        if flate2::read::GzDecoder::new(b.as_slice()).read_to_end(&mut out).is_ok() {
            return out;
        }
    }
    b
}

async fn session(app: &AppHandle, id: u64, room_id: &str) -> Result<(), End> {
    let key = secrets::get(KEY_NAME).ok_or_else(|| end("key", "Add your Euler Stream key in Settings to read TikTok chat."))?;
    let (first, cookie, room_id) = sign(room_id, Some(&key)).await?;
    pump(first, cookie, room_id, id, |items, initial| {
        let _ = app.emit("tiktok:items", json!({ "id": id, "items": items, "initial": initial }));
    }, || { let _ = app.emit("tiktok:open", json!({ "id": id })); }).await
}

/// Holds the socket until it ends: enter the room, heartbeat, ack, decode, hand items over.
async fn pump(first: FetchResult, cookie: String, room_id: String, id: u64, mut items_out: impl FnMut(Vec<Value>, bool), opened: impl FnOnce()) -> Result<(), End> {
    let room_num: i64 = room_id.parse().map_err(|_| end("error", "Bad room id."))?;
    // the first batch has the last few comments, so chat isn't empty on connect
    let (items, ended) = decode_batch(&first);
    if !items.is_empty() { items_out(items, true); }
    if ended { return Err(end("offline", "The stream ended.")); }

    let mut req = socket_url(&first, &room_id).into_client_request().map_err(|e| end("error", e.to_string()))?;
    req.headers_mut().insert("User-Agent", UA.parse().unwrap());
    if let Ok(c) = cookie.parse() { req.headers_mut().insert("Cookie", c); }
    let ws = match tokio::time::timeout(Duration::from_secs(20), tokio_tungstenite::connect_async(req)).await {
        Ok(Ok((ws, _))) => ws,
        Ok(Err(e)) => return Err(end("network", format!("TikTok refused the chat connection ({e})."))),
        Err(_) => return Err(end("network", "TikTok's chat server didn't answer.")),
    };
    log("tiktok", &format!("connection {id}: socket open (room {room_id})"));
    opened();
    let (mut write, mut read) = ws.split();
    let enter = EnterRoom {
        room_id: room_num, live_id: 12, identity: "audience".into(),
        enter_unique_id: (rand::random::<u64>() >> 1) as i64, filter_welcome_msg: "0".into(),
    };
    write.send(Message::binary(frame("im_enter_room", enter.encode_to_vec(), 0))).await.map_err(|e| end("network", e.to_string()))?;

    let mut beat = tokio::time::interval(Duration::from_secs(10));
    let mut seq = 1i64;
    let mut last = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = beat.tick() => {
                if last.elapsed() > Duration::from_secs(60) {
                    return Err(end("network", "TikTok went quiet for a minute."));
                }
                let hb = HeartBeat { room_id: room_num, send_packet_seq_id: seq }.encode_to_vec();
                seq += 1;
                write.send(Message::binary(frame("hb", hb, 0))).await.map_err(|e| end("network", e.to_string()))?;
            }
            msg = read.next() => match msg {
                Some(Ok(Message::Binary(b))) => {
                    last = tokio::time::Instant::now();
                    let Ok(f) = PushFrame::decode(b.as_ref()) else { continue };
                    if f.payload_type != "msg" || f.payload.is_empty() { continue; }
                    let Ok(batch) = FetchResult::decode(gunzip(f.payload).as_slice()) else { continue };
                    if batch.need_ack && f.log_id != 0 && !batch.internal_ext.is_empty() {
                        let ack = frame("ack", batch.internal_ext.clone().into_bytes(), f.log_id);
                        write.send(Message::binary(ack)).await.map_err(|e| end("network", e.to_string()))?;
                    }
                    let (items, ended) = decode_batch(&batch);
                    if !items.is_empty() { items_out(items, false); }
                    if ended {
                        let _ = write.send(Message::Close(None)).await;
                        return Err(end("offline", "The stream ended."));
                    }
                }
                Some(Ok(Message::Close(f))) => return Err(end("network", f.map(|f| f.reason.to_string()).filter(|r| !r.is_empty()).unwrap_or_else(|| "TikTok closed the connection.".into()))),
                Some(Ok(_)) => { last = tokio::time::Instant::now(); }
                Some(Err(e)) => return Err(end("network", e.to_string())),
                None => return Err(end("network", "TikTok closed the connection.")),
            },
        }
    }
}

// ---- protobuf -> the JSON the engine reads (engine/platforms/tiktok/normalize.ts) ----

fn img(i: &Option<Image>) -> Option<String> {
    i.as_ref().and_then(|i| i.url_list.iter().find(|u| u.starts_with("https://")).or(i.url_list.first()).cloned())
}

fn user(u: &Option<User>) -> Value {
    match u {
        Some(u) => json!({
            "id": u.id.to_string(),
            "login": u.display_id,
            "name": if u.nickname.trim().is_empty() { &u.display_id } else { &u.nickname },
            "avatar": img(&u.avatar_thumb),
        }),
        None => Value::Null,
    }
}

fn identity(i: &Option<Identity>) -> Value {
    let i = i.clone().unwrap_or_default();
    json!({ "mod": i.moderator, "sub": i.subscriber, "anchor": i.anchor, "gifter": i.gift_giver, "follower": i.follower })
}

/// Message id and time. TikTok's times are ms, sometimes seconds.
fn head(c: &Option<Common>, fallback_id: i64) -> (String, i64) {
    let c = c.clone().unwrap_or_default();
    let id = if c.msg_id != 0 { c.msg_id } else { fallback_id };
    let ts = match c.create_time { 0 => chrono_now(), t if t < 100_000_000_000 => t * 1000, t => t };
    (id.to_string(), ts)
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Items for the engine, and whether the stream ended.
fn decode_batch(b: &FetchResult) -> (Vec<Value>, bool) {
    let mut items = Vec::new();
    let mut ended = false;
    for m in &b.messages {
        let p = m.payload.as_slice();
        let item = match m.method.as_str() {
            "WebcastChatMessage" => Chat::decode(p).ok().map(|c| {
                let (id, ts) = head(&c.common, m.msg_id);
                let emotes: Vec<Value> = c.emotes.iter().filter_map(|e| {
                    let em = e.emote.as_ref()?;
                    Some(json!({ "index": e.index, "id": em.emote_id, "url": img(&em.image) }))
                }).collect();
                json!({ "kind": "chat", "id": id, "ts": ts, "user": user(&c.user), "text": c.content, "emotes": emotes, "identity": identity(&c.identity) })
            }),
            "WebcastEmoteChatMessage" => EmoteChat::decode(p).ok().map(|c| {
                let (id, ts) = head(&c.common, m.msg_id);
                let emotes: Vec<Value> = c.emotes.iter().map(|e| json!({ "id": e.emote_id, "url": img(&e.image) })).collect();
                json!({ "kind": "emote", "id": id, "ts": ts, "user": user(&c.user), "emotes": emotes, "identity": identity(&c.identity) })
            }),
            "WebcastGiftMessage" => Gift::decode(p).ok().map(|g| {
                let (id, ts) = head(&g.common, m.msg_id);
                let info = g.gift.clone().unwrap_or_default();
                json!({
                    "kind": "gift", "id": id, "ts": ts, "user": user(&g.user), "identity": identity(&g.identity),
                    "giftId": g.gift_id.to_string(), "name": info.name, "image": img(&info.image),
                    "diamonds": info.diamond_count, "streakable": info.kind == 1,
                    "repeat": g.repeat_count.max(1), "end": g.repeat_end == 1, "group": g.group_id.to_string(),
                })
            }),
            "WebcastSocialMessage" => Social::decode(p).ok().map(|s| {
                let (id, ts) = head(&s.common, m.msg_id);
                let key = s.common.as_ref().and_then(|c| c.display_text.as_ref()).map(|t| t.key.to_ascii_lowercase()).unwrap_or_default();
                let kind = if key.contains("follow") { "follow" } else if key.contains("share") { "share" } else { "social" };
                json!({ "kind": kind, "id": id, "ts": ts, "user": user(&s.user), "followers": s.follow_count })
            }),
            "WebcastLikeMessage" => Like::decode(p).ok().map(|l| {
                let (id, ts) = head(&l.common, m.msg_id);
                json!({ "kind": "like", "id": id, "ts": ts, "user": user(&l.user), "count": l.count, "total": l.total })
            }),
            "WebcastSubNotifyMessage" => SubNotify::decode(p).ok().map(|s| {
                let (id, ts) = head(&s.common, m.msg_id);
                json!({ "kind": "sub", "id": id, "ts": ts, "user": user(&s.user), "months": s.sub_month })
            }),
            "WebcastRoomUserSeqMessage" => RoomUserSeq::decode(p).ok().map(|r| json!({ "kind": "viewers", "viewers": r.total, "totalUsers": r.total_user })),
            "WebcastControlMessage" => Control::decode(p).ok().map(|c| {
                if c.action == 3 || c.action == 4 { ended = true; }
                json!({ "kind": "control", "action": c.action })
            }),
            _ => None,
        };
        if let Some(i) = item { items.push(i); }
    }
    (items, ended)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles() {
        assert_eq!(clean_handle("@Some.User_1").as_deref(), Some("some.user_1"));
        assert_eq!(clean_handle("https://www.tiktok.com/@abc/live?lang=en").as_deref(), Some("abc"));
        assert_eq!(clean_handle("tiktok.com/@abc").as_deref(), Some("abc"));
        assert_eq!(clean_handle("no spaces"), None);
        assert_eq!(clean_handle(""), None);
    }

    fn msg(method: &str, payload: Vec<u8>) -> BaseMessage { BaseMessage { method: method.into(), payload, msg_id: 77 } }

    #[test]
    fn decodes_a_batch() {
        let u = Some(User { id: 5, nickname: "Viewer".into(), display_id: "viewer5".into(), avatar_thumb: Some(Image { url_list: vec!["https://a/b.webp".into()] }) });
        let chat = Chat { common: Some(Common { msg_id: 1, create_time: 1_700_000_000, display_text: None }), user: u.clone(), content: "hi [wave]".into(), emotes: vec![], identity: Some(Identity { moderator: true, ..Default::default() }) };
        let gift = Gift {
            common: Some(Common { msg_id: 2, create_time: 1_700_000_000_123, display_text: None }), gift_id: 5655, repeat_count: 3, user: u.clone(), repeat_end: 1, group_id: 9,
            gift: Some(GiftInfo { image: None, id: 5655, kind: 1, diamond_count: 1, name: "Rose".into() }), identity: None,
        };
        let follow = Social { common: Some(Common { msg_id: 3, create_time: 0, display_text: Some(Text { key: "pm_main_follow_message_viewer_2".into(), default_pattern: String::new() }) }), user: u.clone(), action: 1, follow_count: 10 };
        let end_msg = Control { action: 3 };
        let b = FetchResult {
            messages: vec![
                msg("WebcastChatMessage", chat.encode_to_vec()),
                msg("WebcastGiftMessage", gift.encode_to_vec()),
                msg("WebcastSocialMessage", follow.encode_to_vec()),
                msg("WebcastMemberMessage", vec![1, 2, 3]),
                msg("WebcastControlMessage", end_msg.encode_to_vec()),
            ],
            ..Default::default()
        };
        let (items, ended) = decode_batch(&b);
        assert!(ended);
        assert_eq!(items.len(), 4);
        assert_eq!(items[0]["kind"], "chat");
        assert_eq!(items[0]["ts"], 1_700_000_000_000i64);
        assert_eq!(items[0]["user"]["login"], "viewer5");
        assert_eq!(items[0]["identity"]["mod"], true);
        assert_eq!(items[1]["kind"], "gift");
        assert_eq!(items[1]["repeat"], 3);
        assert_eq!(items[1]["end"], true);
        assert_eq!(items[1]["streakable"], true);
        assert_eq!(items[1]["ts"], 1_700_000_000_123i64);
        assert_eq!(items[2]["kind"], "follow");
        assert_eq!(items[3]["kind"], "control");
    }

    #[test]
    fn gzip_frames_round_trip() {
        use std::io::Write;
        let batch = FetchResult { cursor: "c".into(), internal_ext: "ext".into(), need_ack: true, ..Default::default() }.encode_to_vec();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&batch).unwrap();
        let f = PushFrame::decode(frame("msg", gz.finish().unwrap(), 42).as_slice()).unwrap();
        assert_eq!(f.log_id, 42);
        let back = FetchResult::decode(gunzip(f.payload).as_slice()).unwrap();
        assert_eq!(back.internal_ext, "ext");
        assert!(back.need_ack);
    }

    /// Real end-to-end check against a live stream, on Euler's anonymous tier (5 a minute, so it's
    /// opt-in): TIKTOK_LIVE_USER=lofigirl cargo test live_room -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_room() {
        let user = std::env::var("TIKTOK_LIVE_USER").expect("set TIKTOK_LIVE_USER to someone who's live");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let room = tiktok_room(user).await.expect("room lookup");
            println!("@{} live={} room={:?} followers={:?} title={:?}", room.handle, room.live, room.room_id, room.followers, room.title);
            assert!(room.live, "not live right now");
            let (first, cookie, room_id) = sign(room.room_id.as_deref().unwrap(), None).await.map_err(|e| e.message).expect("sign");
            println!("signed: push server {} cookie {}…", first.push_server, cookie.chars().take(12).collect::<String>());
            let mut kinds: HashMap<String, usize> = HashMap::new();
            let mut opened = false;
            let run = pump(first, cookie, room_id, 0, |items, initial| {
                for i in &items {
                    let k = i["kind"].as_str().unwrap_or("?").to_string();
                    if k == "chat" { println!("{}chat {}: {}", if initial { "(initial) " } else { "" }, i["user"]["name"], i["text"]); }
                    if k == "gift" { println!("gift {} x{} end={} ({} diamonds)", i["name"], i["repeat"], i["end"], i["diamonds"]); }
                    *kinds.entry(k).or_default() += 1;
                }
            }, || { opened = true; println!("socket open"); });
            let secs: u64 = std::env::var("TIKTOK_LIVE_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(45);
            let r = tokio::time::timeout(std::time::Duration::from_secs(secs), run).await;
            println!("after {secs} s: {:?} / kinds {:?}", r.as_ref().err().map(|_| "still connected (good)").or(r.as_ref().ok().map(|x| match x { Ok(()) => "closed", Err(e) => e.code })), kinds);
            assert!(opened, "socket never opened");
            assert!(r.is_err(), "connection ended early");
            assert!(kinds.values().sum::<usize>() > 0, "nothing decoded");
        });
    }

    #[test]
    fn socket_url_keeps_route_params() {
        let mut first = FetchResult { push_server: "wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/".into(), cursor: "a b".into(), internal_ext: "x&y".into(), ..Default::default() };
        first.route_params.insert("wrss".into(), "zzz".into());
        first.route_params.insert("empty".into(), String::new());
        let u = socket_url(&first, "123");
        assert!(u.starts_with("wss://webcast-ws.tiktok.com/"));
        assert!(u.contains("room_id=123"));
        assert!(u.contains("wrss=zzz"));
        assert!(!u.contains("empty="));
        assert!(u.contains("internal_ext=x%26y"));
        assert!(u.ends_with("&version_code=270000"));
    }
}

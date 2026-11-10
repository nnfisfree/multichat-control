//! YouTube's live chat stream (gRPC), which a web page can't open itself.
//!
//! The message types below are written by hand from proto/stream_list.proto (same field numbers),
//! so no code generator is needed. Items are sent to the engine as JSON in the same shape the
//! Electron version's grpc-js produced (camelCase names, enum names as text), so the existing
//! normaliser reads them unchanged. The token is added here and never reaches the page.

use crate::auth;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tonic::codegen::http::uri::PathAndQuery;
use tonic::transport::{Channel, ClientTlsConfig};

#[derive(Clone, PartialEq, prost::Message)]
struct ListRequest {
    #[prost(string, optional, tag = "1")]
    live_chat_id: Option<String>,
    #[prost(string, optional, tag = "99")]
    page_token: Option<String>,
    #[prost(string, repeated, tag = "100")]
    part: Vec<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct ListResponse {
    #[prost(string, optional, tag = "2")]
    offline_at: Option<String>,
    #[prost(string, optional, tag = "100602")]
    next_page_token: Option<String>,
    #[prost(message, repeated, tag = "1007")]
    items: Vec<ChatMessage>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct ChatMessage {
    #[prost(string, optional, tag = "101")]
    id: Option<String>,
    #[prost(message, optional, tag = "2")]
    snippet: Option<Snippet>,
    #[prost(message, optional, tag = "3")]
    author_details: Option<Author>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct Author {
    #[prost(string, optional, tag = "10101")]
    channel_id: Option<String>,
    #[prost(string, optional, tag = "102")]
    channel_url: Option<String>,
    #[prost(string, optional, tag = "103")]
    display_name: Option<String>,
    #[prost(string, optional, tag = "104")]
    profile_image_url: Option<String>,
    #[prost(bool, optional, tag = "4")]
    is_verified: Option<bool>,
    #[prost(bool, optional, tag = "5")]
    is_chat_owner: Option<bool>,
    #[prost(bool, optional, tag = "6")]
    is_chat_sponsor: Option<bool>,
    #[prost(bool, optional, tag = "7")]
    is_chat_moderator: Option<bool>,
}

/// The proto's `oneof displayed_content` is wire-compatible with separate optional fields.
#[derive(Clone, PartialEq, prost::Message)]
struct Snippet {
    #[prost(int32, optional, tag = "1")]
    kind: Option<i32>,
    #[prost(string, optional, tag = "301")]
    author_channel_id: Option<String>,
    #[prost(string, optional, tag = "4")]
    published_at: Option<String>,
    #[prost(string, optional, tag = "16")]
    display_message: Option<String>,
    #[prost(message, optional, tag = "19")]
    text_message_details: Option<TextDetails>,
    #[prost(message, optional, tag = "22")]
    user_banned_details: Option<BannedDetails>,
    #[prost(message, optional, tag = "27")]
    super_chat_details: Option<SuperChatDetails>,
    #[prost(message, optional, tag = "28")]
    super_sticker_details: Option<SuperStickerDetails>,
    #[prost(message, optional, tag = "29")]
    new_sponsor_details: Option<NewSponsorDetails>,
    #[prost(message, optional, tag = "30")]
    member_milestone_chat_details: Option<MilestoneDetails>,
    #[prost(message, optional, tag = "31")]
    membership_gifting_details: Option<GiftingDetails>,
    #[prost(message, optional, tag = "32")]
    gift_membership_received_details: Option<GiftReceivedDetails>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct TextDetails {
    #[prost(string, optional, tag = "1")]
    message_text: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct BannedDetails {
    #[prost(message, optional, tag = "1")]
    banned_user_details: Option<Profile>,
    #[prost(int32, optional, tag = "2")]
    ban_type: Option<i32>,
    #[prost(uint64, optional, tag = "4")]
    ban_duration_seconds: Option<u64>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct Profile {
    #[prost(string, optional, tag = "101")]
    channel_id: Option<String>,
    #[prost(string, optional, tag = "2")]
    channel_url: Option<String>,
    #[prost(string, optional, tag = "3")]
    display_name: Option<String>,
    #[prost(string, optional, tag = "4")]
    profile_image_url: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct SuperChatDetails {
    #[prost(uint64, optional, tag = "1")]
    amount_micros: Option<u64>,
    #[prost(string, optional, tag = "2")]
    currency: Option<String>,
    #[prost(string, optional, tag = "3")]
    amount_display_string: Option<String>,
    #[prost(string, optional, tag = "4")]
    user_comment: Option<String>,
    #[prost(uint32, optional, tag = "5")]
    tier: Option<u32>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct SuperStickerDetails {
    #[prost(uint64, optional, tag = "1")]
    amount_micros: Option<u64>,
    #[prost(string, optional, tag = "2")]
    currency: Option<String>,
    #[prost(string, optional, tag = "3")]
    amount_display_string: Option<String>,
    #[prost(uint32, optional, tag = "4")]
    tier: Option<u32>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct NewSponsorDetails {
    #[prost(string, optional, tag = "1")]
    member_level_name: Option<String>,
    #[prost(bool, optional, tag = "2")]
    is_upgrade: Option<bool>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct MilestoneDetails {
    #[prost(string, optional, tag = "1")]
    member_level_name: Option<String>,
    #[prost(uint32, optional, tag = "2")]
    member_month: Option<u32>,
    #[prost(string, optional, tag = "3")]
    user_comment: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct GiftingDetails {
    #[prost(int32, optional, tag = "1")]
    gift_memberships_count: Option<i32>,
    #[prost(string, optional, tag = "2")]
    gift_memberships_level_name: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct GiftReceivedDetails {
    #[prost(string, optional, tag = "1")]
    member_level_name: Option<String>,
    #[prost(string, optional, tag = "2")]
    gifter_channel_id: Option<String>,
}

// ---- To the JSON shape the normaliser reads ----

fn type_name(n: i32) -> &'static str {
    match n {
        1 => "TEXT_MESSAGE_EVENT", 2 => "TOMBSTONE", 3 => "FAN_FUNDING_EVENT", 4 => "CHAT_ENDED_EVENT",
        5 => "SPONSOR_ONLY_MODE_STARTED_EVENT", 6 => "SPONSOR_ONLY_MODE_ENDED_EVENT", 7 => "NEW_SPONSOR_EVENT",
        10 => "USER_BANNED_EVENT", 15 => "SUPER_CHAT_EVENT", 16 => "SUPER_STICKER_EVENT", 17 => "MEMBER_MILESTONE_CHAT_EVENT",
        18 => "MEMBERSHIP_GIFTING_EVENT", 19 => "GIFT_MEMBERSHIP_RECEIVED_EVENT", 20 => "POLL_EVENT", 21 => "GIFT_EVENT",
        _ => "INVALID_TYPE",
    }
}

/// Builds a JSON object from (name, value) pairs, leaving out what's absent.
fn obj(fields: Vec<(&str, Option<Value>)>) -> Value {
    let mut m = Map::new();
    for (k, v) in fields {
        if let Some(v) = v {
            m.insert(k.to_string(), v);
        }
    }
    Value::Object(m)
}

fn s(v: &Option<String>) -> Option<Value> { v.clone().map(Value::String) }
fn b(v: &Option<bool>) -> Option<Value> { v.map(Value::Bool) }
fn n<T: Into<Value> + Copy>(v: &Option<T>) -> Option<Value> { v.map(Into::into) }
/// 64-bit numbers as text, as grpc-js gave them.
fn long(v: &Option<u64>) -> Option<Value> { v.map(|x| Value::String(x.to_string())) }

fn item_json(m: &ChatMessage) -> Value {
    let author = m.author_details.as_ref().map(|a| obj(vec![
        ("channelId", s(&a.channel_id)), ("channelUrl", s(&a.channel_url)), ("displayName", s(&a.display_name)),
        ("profileImageUrl", s(&a.profile_image_url)), ("isVerified", b(&a.is_verified)), ("isChatOwner", b(&a.is_chat_owner)),
        ("isChatSponsor", b(&a.is_chat_sponsor)), ("isChatModerator", b(&a.is_chat_moderator)),
    ]));
    let snippet = m.snippet.as_ref().map(|sn| obj(vec![
        ("type", sn.kind.map(|k| Value::String(type_name(k).into()))),
        ("authorChannelId", s(&sn.author_channel_id)),
        ("publishedAt", s(&sn.published_at)),
        ("displayMessage", s(&sn.display_message)),
        ("textMessageDetails", sn.text_message_details.as_ref().map(|d| obj(vec![("messageText", s(&d.message_text))]))),
        ("userBannedDetails", sn.user_banned_details.as_ref().map(|d| obj(vec![
            ("bannedUserDetails", d.banned_user_details.as_ref().map(|p| obj(vec![
                ("channelId", s(&p.channel_id)), ("channelUrl", s(&p.channel_url)), ("displayName", s(&p.display_name)), ("profileImageUrl", s(&p.profile_image_url)),
            ]))),
            ("banType", d.ban_type.map(|t| Value::String(if t == 2 { "TEMPORARY" } else { "PERMANENT" }.into()))),
            ("banDurationSeconds", long(&d.ban_duration_seconds)),
        ]))),
        ("superChatDetails", sn.super_chat_details.as_ref().map(|d| obj(vec![
            ("amountMicros", long(&d.amount_micros)), ("currency", s(&d.currency)), ("amountDisplayString", s(&d.amount_display_string)),
            ("userComment", s(&d.user_comment)), ("tier", n(&d.tier)),
        ]))),
        ("superStickerDetails", sn.super_sticker_details.as_ref().map(|d| obj(vec![
            ("amountMicros", long(&d.amount_micros)), ("currency", s(&d.currency)), ("amountDisplayString", s(&d.amount_display_string)), ("tier", n(&d.tier)),
        ]))),
        ("newSponsorDetails", sn.new_sponsor_details.as_ref().map(|d| obj(vec![("memberLevelName", s(&d.member_level_name)), ("isUpgrade", b(&d.is_upgrade))]))),
        ("memberMilestoneChatDetails", sn.member_milestone_chat_details.as_ref().map(|d| obj(vec![
            ("memberLevelName", s(&d.member_level_name)), ("memberMonth", n(&d.member_month)), ("userComment", s(&d.user_comment)),
        ]))),
        ("membershipGiftingDetails", sn.membership_gifting_details.as_ref().map(|d| obj(vec![
            ("giftMembershipsCount", n(&d.gift_memberships_count)), ("giftMembershipsLevelName", s(&d.gift_memberships_level_name)),
        ]))),
        ("giftMembershipReceivedDetails", sn.gift_membership_received_details.as_ref().map(|d| obj(vec![
            ("memberLevelName", s(&d.member_level_name)), ("gifterChannelId", s(&d.gifter_channel_id)),
        ]))),
    ]));
    obj(vec![("id", s(&m.id)), ("snippet", snippet), ("authorDetails", author)])
}

// ---- The stream ----

static NEXT: AtomicU64 = AtomicU64::new(1);

fn running() -> &'static Mutex<HashMap<u64, tauri::async_runtime::JoinHandle<()>>> {
    static RUNNING: std::sync::OnceLock<Mutex<HashMap<u64, tauri::async_runtime::JoinHandle<()>>>> = std::sync::OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// gRPC status codes the engine acts on: 9 = the chat ended, 16 = the login was refused.
async fn stream(app: &AppHandle, id: u64, live_chat_id: String, page_token: Option<String>) -> Result<(), (i32, String)> {
    let tls = ClientTlsConfig::new().with_native_roots();
    let channel = Channel::from_static("https://youtube.googleapis.com").tls_config(tls).map_err(|e| (14, e.to_string()))?
        .connect().await.map_err(|e| (14, e.to_string()))?;
    let mut grpc = tonic::client::Grpc::new(channel);
    let mut retried = false;
    loop {
        let token = auth::access_token(app, "youtube").await.map_err(|e| (16, e))?;
        let mut req = tonic::Request::new(ListRequest {
            live_chat_id: Some(live_chat_id.clone()),
            page_token: page_token.clone(),
            part: vec!["id".into(), "snippet".into(), "authorDetails".into()],
        });
        req.metadata_mut().insert("authorization", format!("Bearer {token}").parse().map_err(|_| (16, "Bad token.".to_string()))?);
        grpc.ready().await.map_err(|e| (14, e.to_string()))?;
        let path = PathAndQuery::from_static("/youtube.api.v3.V3DataLiveChatMessageService/StreamList");
        let codec: tonic::codec::ProstCodec<ListRequest, ListResponse> = tonic::codec::ProstCodec::default();
        let mut s = match grpc.server_streaming(req, path, codec).await {
            Ok(r) => r.into_inner(),
            // A refused login is renewed once, then reported.
            Err(st) if st.code() == tonic::Code::Unauthenticated && !retried => {
                retried = true;
                auth::renew(app, "youtube", &token).await.map_err(|e| (16, e))?;
                continue;
            }
            Err(st) => return Err((st.code() as i32, st.message().to_string())),
        };
        loop {
            match s.message().await {
                Ok(Some(r)) => {
                    let items: Vec<Value> = r.items.iter().map(item_json).collect();
                    let _ = app.emit("youtube:items", json!({ "id": id, "items": items, "next": r.next_page_token }));
                }
                Ok(None) => return Ok(()),
                Err(st) => return Err((st.code() as i32, st.message().to_string())),
            }
        }
    }
}

/// Opens the stream; items and the end arrive as events tagged with the returned id.
#[tauri::command]
pub fn youtube_stream_start(app: AppHandle, live_chat_id: String, page_token: Option<String>) -> u64 {
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    let task = tauri::async_runtime::spawn(async move {
        let result = stream(&app, id, live_chat_id, page_token).await;
        let (code, message) = match result { Ok(()) => (0, String::new()), Err(e) => e };
        running().lock().unwrap().remove(&id);
        let _ = app.emit("youtube:end", json!({ "id": id, "code": code, "message": message }));
    });
    running().lock().unwrap().insert(id, task);
    id
}

#[tauri::command]
pub fn youtube_stream_stop(id: u64) {
    if let Some(h) = running().lock().unwrap().remove(&id) {
        h.abort();
    }
}

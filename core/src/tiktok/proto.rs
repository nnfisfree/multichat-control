//! The few TikTok Webcast protobuf messages we read or send, hand-written with the same field
//! numbers as the `tiktok-live-proto` schemas (v3). prost skips every field not listed here, so
//! only what the app shows is declared. See PROTOCOL.md next to this file.

// ---- framing ----

#[derive(Clone, PartialEq, prost::Message)]
pub struct PushFrame {
    #[prost(int64, tag = "1")]
    pub seq_id: i64,
    #[prost(int64, tag = "2")]
    pub log_id: i64,
    #[prost(string, tag = "6")]
    pub payload_encoding: String,
    #[prost(string, tag = "7")]
    pub payload_type: String,
    #[prost(bytes = "vec", tag = "8")]
    pub payload: Vec<u8>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct FetchResult {
    #[prost(message, repeated, tag = "1")]
    pub messages: Vec<BaseMessage>,
    #[prost(string, tag = "2")]
    pub cursor: String,
    #[prost(string, tag = "5")]
    pub internal_ext: String,
    #[prost(map = "string, string", tag = "7")]
    pub route_params: std::collections::HashMap<String, String>,
    #[prost(bool, tag = "9")]
    pub need_ack: bool,
    #[prost(string, tag = "10")]
    pub push_server: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct BaseMessage {
    #[prost(string, tag = "1")]
    pub method: String,
    #[prost(bytes = "vec", tag = "2")]
    pub payload: Vec<u8>,
    #[prost(int64, tag = "3")]
    pub msg_id: i64,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct HeartBeat {
    #[prost(int64, tag = "1")]
    pub room_id: i64,
    #[prost(int64, tag = "2")]
    pub send_packet_seq_id: i64,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct EnterRoom {
    #[prost(int64, tag = "1")]
    pub room_id: i64,
    #[prost(int64, tag = "4")]
    pub live_id: i64,
    #[prost(string, tag = "5")]
    pub identity: String,
    #[prost(int64, tag = "8")]
    pub enter_unique_id: i64,
    #[prost(string, tag = "9")]
    pub filter_welcome_msg: String,
}

// ---- shared parts ----

#[derive(Clone, PartialEq, prost::Message)]
pub struct Common {
    #[prost(int64, tag = "2")]
    pub msg_id: i64,
    #[prost(int64, tag = "4")]
    pub create_time: i64,
    #[prost(message, optional, tag = "8")]
    pub display_text: Option<Text>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Text {
    #[prost(string, tag = "1")]
    pub key: String,
    #[prost(string, tag = "2")]
    pub default_pattern: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Image {
    #[prost(string, repeated, tag = "1")]
    pub url_list: Vec<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct User {
    #[prost(int64, tag = "1")]
    pub id: i64,
    #[prost(string, tag = "3")]
    pub nickname: String,
    #[prost(message, optional, tag = "9")]
    pub avatar_thumb: Option<Image>,
    /// The @handle.
    #[prost(string, tag = "38")]
    pub display_id: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Identity {
    #[prost(bool, tag = "1")]
    pub gift_giver: bool,
    #[prost(bool, tag = "2")]
    pub subscriber: bool,
    #[prost(bool, tag = "4")]
    pub follower: bool,
    #[prost(bool, tag = "5")]
    pub moderator: bool,
    #[prost(bool, tag = "6")]
    pub anchor: bool,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Emote {
    #[prost(string, tag = "1")]
    pub emote_id: String,
    #[prost(message, optional, tag = "2")]
    pub image: Option<Image>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct EmoteAt {
    #[prost(int32, tag = "1")]
    pub index: i32,
    #[prost(message, optional, tag = "2")]
    pub emote: Option<Emote>,
}

// ---- events ----

#[derive(Clone, PartialEq, prost::Message)]
pub struct Chat {
    #[prost(message, optional, tag = "1")]
    pub common: Option<Common>,
    #[prost(message, optional, tag = "2")]
    pub user: Option<User>,
    #[prost(string, tag = "3")]
    pub content: String,
    #[prost(message, repeated, tag = "13")]
    pub emotes: Vec<EmoteAt>,
    #[prost(message, optional, tag = "18")]
    pub identity: Option<Identity>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct EmoteChat {
    #[prost(message, optional, tag = "1")]
    pub common: Option<Common>,
    #[prost(message, optional, tag = "2")]
    pub user: Option<User>,
    #[prost(message, repeated, tag = "3")]
    pub emotes: Vec<Emote>,
    #[prost(message, optional, tag = "5")]
    pub identity: Option<Identity>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct GiftInfo {
    #[prost(message, optional, tag = "1")]
    pub image: Option<Image>,
    #[prost(int64, tag = "5")]
    pub id: i64,
    /// 1 = can be sent in a streak (combo).
    #[prost(int32, tag = "11")]
    pub kind: i32,
    #[prost(int32, tag = "12")]
    pub diamond_count: i32,
    #[prost(string, tag = "16")]
    pub name: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Gift {
    #[prost(message, optional, tag = "1")]
    pub common: Option<Common>,
    #[prost(int64, tag = "2")]
    pub gift_id: i64,
    #[prost(int32, tag = "5")]
    pub repeat_count: i32,
    #[prost(message, optional, tag = "7")]
    pub user: Option<User>,
    #[prost(int32, tag = "9")]
    pub repeat_end: i32,
    #[prost(int64, tag = "11")]
    pub group_id: i64,
    #[prost(message, optional, tag = "15")]
    pub gift: Option<GiftInfo>,
    #[prost(message, optional, tag = "32")]
    pub identity: Option<Identity>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Social {
    #[prost(message, optional, tag = "1")]
    pub common: Option<Common>,
    #[prost(message, optional, tag = "2")]
    pub user: Option<User>,
    #[prost(int64, tag = "4")]
    pub action: i64,
    #[prost(int64, tag = "6")]
    pub follow_count: i64,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Like {
    #[prost(message, optional, tag = "1")]
    pub common: Option<Common>,
    #[prost(int32, tag = "2")]
    pub count: i32,
    #[prost(int64, tag = "3")]
    pub total: i64,
    #[prost(message, optional, tag = "5")]
    pub user: Option<User>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct SubNotify {
    #[prost(message, optional, tag = "1")]
    pub common: Option<Common>,
    #[prost(message, optional, tag = "2")]
    pub user: Option<User>,
    #[prost(int64, tag = "4")]
    pub sub_month: i64,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct RoomUserSeq {
    #[prost(int64, tag = "3")]
    pub total: i64,
    #[prost(int64, tag = "7")]
    pub total_user: i64,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Control {
    /// 1 paused, 2 unpaused, 3 ended, 4 suspended.
    #[prost(int32, tag = "2")]
    pub action: i32,
}

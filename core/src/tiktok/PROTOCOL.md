# TikTok LIVE connection notes

TikTok has no official API for LIVE chat or gifts. We use the reverse-engineered "Webcast" connection that TikFinity,
TikTok-Live-Connector (npm) and TikTokLive (Python) use. When TikTok changes something, those projects usually fix it
within days. Compare against them first:

- https://github.com/zerodytrash/TikTok-Live-Connector (`src/lib/client/index.ts`, `src/lib/ws/`)
- https://github.com/isaackogan/TikTokLive
- Schemas: npm `tiktok-live-proto` (v3). It ships no `.proto` files; the field numbers are in the generated decoders.

Checked against TikTok-Live-Connector 2.5.0, tiktok-live-api-sdk 0.9.1 and tiktok-live-proto 0.3.0 (2026-11-19).

## Flow

1. **Is @user live?** `GET https://www.tiktok.com/api-live/user/room/?aid=1988&app_name=tiktok_web&device_platform=web_pc&uniqueId=<user>&sourceType=54`
   - No signing and no Euler quota. The engine polls this every minute while the streamer is offline.
   - `data.user.roomId` is the room id. `data.liveRoom.status` is 2 when live and 4 when ended. `data.stats.followerCount` is the follower count.
   - An unknown user returns `message: "user_not_found"` (statusCode 19881007).
2. **Sign.** `GET https://api.eulerstream.com/webcast/rooms/<roomId>/connect?client=…&user_agent=<UA>&client_enter=true&platform=web`
   - Send the user's key in the `x-api-key` header, with `Accept: application/protobuf,application/json`.
   - **200:** the body is a protobuf `ProtoMessageFetchResult`, holding the first messages, `cursor`, `internalExt`, `routeParams` and `pushServer`.
     - Header `x-set-tt-cookie` is in Set-Cookie form. Keep the first `name=value` (`ttwid=…`) and send it as `Cookie` on the socket.
     - Header `x-room-id` is the real room id; prefer it.
   - **401/403:** bad key.
   - **402:** paid feature.
   - **429:** rate limit; the JSON body has `message`.
3. **Socket.** Connect to `pushServer` with:
   - the web player's query parameters (see `socket_url`);
   - `compress=gzip`, `room_id`, `internal_ext` and `cursor`;
   - every non-empty `routeParams` entry;
   - a literal `&version_code=270000` appended at the end.

   Headers are `User-Agent` and `Cookie`.

   Once it's open:
   - Send a `PushFrame{payloadType:"im_enter_room", payloadEncoding:"pb", payload: WebcastImEnterRoomMessage}` with `liveId=12`, `identity="audience"`, a random `enterUniqueId` and `filterWelcomeMsg="0"`.
   - Every 10 s, send `PushFrame{payloadType:"hb", payload: HeartBeatMessage{roomId, sendPacketSeqId++}}`.
   - Incoming `PushFrame{payloadType:"msg"}` payloads are gzip-compressed if they start with `1f 8b`. Each decodes as a `ProtoMessageFetchResult`.
   - When `needAck` is set, send `PushFrame{logId: <same>, payloadType:"ack", payload: internalExt as UTF-8}`.
4. **End.** A `WebcastControlMessage` with action 3 (ended) or 4 (suspended) means the stream ended.
   - The engine goes back to polling step 1.
   - The socket also replays the last 6 comments right after opening (`history_comment_count=6`). The engine dedupes them by message id.

## Messages we read (`proto.rs`)

| method | used fields |
|---|---|
| WebcastChatMessage | common(1), user(2), content(3), emotes(13: index 1, emote 2), userIdentity(18) |
| WebcastEmoteChatMessage | common, user, emoteList(3), userIdentity(5) |
| WebcastGiftMessage | common, giftId(2), repeatCount(5), user(7), repeatEnd(9), groupId(11), gift(15: image 1, id 5, type 11, diamondCount 12, name 16), userIdentity(32) |
| WebcastSocialMessage | common (displayText.key has "follow" or "share"), user(2), followCount(6) |
| WebcastLikeMessage | common, count(2), total(3), user(5) |
| WebcastSubNotifyMessage | common, user(2), subMonth(4) |
| WebcastRoomUserSeqMessage | total(3) = viewers, totalUser(7) |
| WebcastControlMessage | action(2) |

- `User` fields: id(1), nickname(3), avatarThumb(9), displayId(38) = the @handle.
- `CommonMessageData` fields: msgId(2), createTime(4, ms), displayText(8).
- `UserIdentity` fields: giftGiver(1), subscriber(2), follower(4), moderator(5), anchor(6).

## Gifts

- **Streaks.** Gifts with `gift.type == 1` can be sent as a streak. TikTok sends one message per tap with a growing `repeatCount`, then a final one with `repeatEnd == 1`.
  - The engine (`engine/platforms/tiktok/gifts.ts`) reports each streak once, when it ends.
  - It falls back to 4 s of quiet if the end message never arrives.
- **Value.** `diamondCount` is the price in coins. The creator gets roughly $0.005 per diamond; TikTok doesn't publish this.

## Live test

The live test (Euler's anonymous tier, 5 connections a minute) connects to someone who's live:

```
cd core
TIKTOK_LIVE_USER=<someone live> TIKTOK_LIVE_SECS=60 cargo test live_room -- --ignored --nocapture
```

// Checks external contracts without an account: YouTube's gRPC method and third-party emote formats.
import * as grpc from '@grpc/grpc-js'
import * as loader from '@grpc/proto-loader'
const def = loader.loadSync('resources/proto/stream_list.proto', { longs: String, enums: String })
const pkg = grpc.loadPackageDefinition(def)
const client = new pkg.youtube.api.v3.V3DataLiveChatMessageService('youtube.googleapis.com:443', grpc.credentials.createSsl())
const meta = new grpc.Metadata()
meta.set('authorization', 'Bearer invalid')
await new Promise((done) => {
  const call = client.StreamList({ liveChatId: 'x', part: ['snippet'] }, meta)
  call.on('data', () => {})
  call.on('error', (e) => { console.log('youtube grpc:', grpc.status[e.code], '-', e.details?.slice(0, 80)); done() })
  call.on('end', done)
})
client.close()
const show = async (name, url, pick) => {
  const j = await (await fetch(url)).json()
  console.log(name, JSON.stringify(pick(j)).slice(0, 170))
}
await show('bttv', 'https://api.betterttv.net/3/cached/emotes/global', (j) => j[0])
await show('ffz', 'https://api.frankerfacez.com/v1/set/global', (j) => Object.values(j.sets)[0].emoticons[0])
await show('7tv', 'https://7tv.io/v3/emote-sets/global', (j) => ({ id: j.emotes[0].id, name: j.emotes[0].name, host: j.emotes[0].data?.host?.url, animated: j.emotes[0].data?.animated }))
const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws')
await new Promise((done) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); console.log('twitch eventsub:', d.metadata.message_type, 'keepalive', d.payload.session.keepalive_timeout_seconds); ws.close(); done() } })

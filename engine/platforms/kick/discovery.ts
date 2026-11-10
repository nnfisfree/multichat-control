import { invoke } from '@tauri-apps/api/core'
import { fetchJson } from '../../net'

const WEB = 'https://web.kick.com/api/v1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://kick.com/', Origin: 'https://kick.com', 'x-app-platform': 'web' }

export interface KickChannel {
  chatroomId: number
  channelId: number
  userId?: number
  emotes: { id: string; name: string; group: string }[]
  /** Past streams, newest first, when Kick lists them. */
  past: { id: string; start: number; seconds: number; title: string }[]
}

export interface KickRealtime { url: string; token: string }

function parsePast(videos: any): KickChannel['past'] {
  return (Array.isArray(videos) ? videos : []).slice(0, 20).map((v: any) => ({
    id: String(v.id ?? v.slug ?? ''),
    start: Date.parse(String(v.start_time ?? v.created_at ?? '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v.start_time ?? v.created_at ?? '')) ? '' : 'Z')),
    seconds: Math.round(Number(v.duration ?? 0) / 1000),
    title: String(v.session_title ?? '')
  })).filter((v) => v.id && v.start)
}

function parseChannel(channel: any, emotes: any, videos?: any): KickChannel {
  if (!channel?.chatroom?.id) throw new Error('Kick returned no chatroom for this channel.')
  return {
    chatroomId: channel.chatroom.id,
    channelId: channel.id,
    userId: channel.user_id,
    emotes: (Array.isArray(emotes) ? emotes : []).flatMap((set: any) => (set.emotes ?? []).map((e: any) => ({
      id: String(e.id), name: e.name, group: set.name === 'Global' || set.name === 'Emojis' ? `Kick ${set.name}` : 'Kick Channel'
    }))),
    past: parsePast(videos ?? channel.previous_livestreams)
  }
}

/**
 * Fallback for when Cloudflare refuses plain requests: the core opens kick.com in a hidden window
 * and makes the same calls from the real page.
 */
async function viaPage(slug: string): Promise<KickChannel> {
  const { channel, emotes, videos } = await invoke<{ channel: any; emotes: any; videos: any }>('kick_via_page', { slug })
  return parseChannel(channel, emotes, videos)
}

export async function fetchChannel(slug: string): Promise<KickChannel> {
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error('Invalid Kick channel name.')
  try {
    const [channel, emotes, videos] = await Promise.all([
      fetchJson(`https://kick.com/api/v2/channels/${slug}`, { headers: HEADERS }),
      fetchJson(`https://kick.com/emotes/${slug}`, { headers: HEADERS }).catch(() => []),
      fetchJson(`https://kick.com/api/v2/channels/${slug}/videos`, { headers: HEADERS }).catch(() => null)
    ])
    return parseChannel(channel, emotes, videos)
  } catch {
    return viaPage(slug)
  }
}

/** Asks Kick which server to use and for a guest token. Both change, so neither is hardcoded. */
export async function fetchRealtime(): Promise<KickRealtime> {
  const clientId = crypto.randomUUID()
  const post = (path: string, body: unknown): Promise<any> => fetchJson(`${WEB}${path}`, {
    method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const conn = await post('/realtime/connection', {
    client: { id: clientId, type: 'web' }, capabilities: { accepted_providers: [{ provider: 'centrifugo' }] }
  })
  const url = conn.data?.connections?.find((c: any) => c.provider === 'centrifugo')?.credentials?.url
  if (!url) throw new Error('Kick offered no supported live connection.')
  const auth = await post('/realtime/auth/connection', { client_id: clientId })
  if (!auth.data?.token) throw new Error('Kick issued no live token.')
  return { url, token: auth.data.token }
}

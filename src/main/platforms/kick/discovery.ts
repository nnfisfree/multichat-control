import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { fetchJson } from '../../net'

const WEB = 'https://web.kick.com/api/v1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://kick.com/', Origin: 'https://kick.com', 'x-app-platform': 'web' }

export interface KickChannel {
  chatroomId: number
  channelId: number
  userId?: number
  emotes: { id: string; name: string; group: string }[]
}

export interface KickRealtime { url: string; token: string }

function parseChannel(channel: any, emotes: any): KickChannel {
  if (!channel?.chatroom?.id) throw new Error('Kick returned no chatroom for this channel.')
  return {
    chatroomId: channel.chatroom.id,
    channelId: channel.id,
    userId: channel.user_id,
    emotes: (Array.isArray(emotes) ? emotes : []).flatMap((set: any) => (set.emotes ?? []).map((e: any) => ({
      id: String(e.id), name: e.name, group: set.name === 'Global' || set.name === 'Emojis' ? `Kick ${set.name}` : 'Kick Channel'
    })))
  }
}

/** Fallback for when Cloudflare refuses plain requests: the same calls from a real page. */
async function viaPage(slug: string): Promise<KickChannel> {
  const ses = session.fromPartition('persist:kick-discovery')
  ses.setUserAgent(UA)
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } })
  try {
    await win.loadURL(`https://kick.com/${slug}`)
    const { channel, emotes } = await win.webContents.executeJavaScript(`(async () => {
      const get = async (p) => { try { const r = await fetch(p); return r.ok ? await r.json() : null } catch { return null } };
      const [channel, emotes] = await Promise.all([get('/api/v2/channels/${slug}'), get('/emotes/${slug}')]);
      return { channel, emotes };
    })()`)
    return parseChannel(channel, emotes)
  } finally {
    win.destroy()
  }
}

export async function fetchChannel(slug: string): Promise<KickChannel> {
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error('Invalid Kick channel name.')
  try {
    const [channel, emotes] = await Promise.all([
      fetchJson(`https://kick.com/api/v2/channels/${slug}`, { headers: HEADERS }),
      fetchJson(`https://kick.com/emotes/${slug}`, { headers: HEADERS }).catch(() => [])
    ])
    return parseChannel(channel, emotes)
  } catch {
    return viaPage(slug)
  }
}

/** Asks Kick which server to use and for a guest token. Both change, so neither is hardcoded. */
export async function fetchRealtime(): Promise<KickRealtime> {
  const clientId = randomUUID()
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

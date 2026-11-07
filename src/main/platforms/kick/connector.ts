import { KICK_REDIRECT_PORT } from '../../../shared/app-config'
import type { EmoteLookup } from '../../../shared/parts'
import type { ActionDef, ActionResult, Emote, ModerationRequest } from '../../../shared/types'
import { loopbackLogin } from '../../auth/loopback-pkce'
import { credentials, type AppCredentials } from '../../credentials'
import { load7tv, toLookup } from '../../emotes/third-party'
import { errorText, fetchJson, HttpError, message, readBody, sleep } from '../../net'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { fetchChannel, fetchRealtime, type KickChannel } from './discovery'
import { normalize } from './normalize'
import { KickSocket } from './socket'

const API = 'https://api.kick.com/public/v1'
const SCOPES = 'user:read channel:read channel:write channel:rewards:read channel:rewards:write chat:write moderation:ban moderation:chat_message:manage kicks:read'

interface Tokens { access: string; refresh: string; expiresAt: number }

export class KickConnector implements Connector {
  readonly platform = 'kick' as const
  private tokens: Tokens | null = null
  private userId = 0
  private slug = ''
  private name = ''
  private socket: KickSocket | null = null
  private found: KickChannel | null = null
  private third: EmoteLookup = new Map()
  private emoteCache: Emote[] | null = null
  private run = 0

  constructor(private ctx: ConnectorContext) {}

  private creds(): AppCredentials | null {
    return credentials('kick')
  }

  private save(t: Tokens | null): void {
    this.tokens = t
    store.setSecret('kick.tokens', t ? JSON.stringify(t) : undefined)
  }

  private async tokenRequest(params: Record<string, string>): Promise<void> {
    const r = await fetchJson('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    })
    this.save({ access: r.access_token, refresh: r.refresh_token ?? this.tokens?.refresh, expiresAt: Date.now() + Number(r.expires_in || 3600) * 1000 })
  }

  private async refresh(): Promise<void> {
    const c = this.creds()
    if (!c || !this.tokens) throw new Error('Not logged in to Kick.')
    try {
      await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh, client_id: c.id, client_secret: c.secret })
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) {
        this.save(null)
        void this.stop()
        this.ctx.status({ status: 'needs-login', detail: 'Your Kick login expired. Please log in again.' })
      }
      throw err
    }
  }

  private async api(method: string, path: string, body?: unknown): Promise<any> {
    if (!this.tokens) throw new Error('Not logged in to Kick.')
    if (Date.now() > this.tokens.expiresAt - 60000) await this.refresh()
    const request = (): Promise<Response> => fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${this.tokens!.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    })
    let res = await request()
    if (res.status === 401) {
      await this.refresh()
      res = await request()
    }
    const data = await readBody(res)
    if (!res.ok) throw new HttpError(res.status, errorText(data, `Kick error ${res.status}`), data)
    return data
  }

  async start(): Promise<void> {
    if (!this.creds()) return this.ctx.status({ status: 'needs-setup', detail: 'Add your Kick client ID and secret.' })
    const raw = store.getSecret('kick.tokens')
    if (!raw) return this.ctx.status({ status: 'needs-login' })
    this.tokens = JSON.parse(raw)
    this.ctx.status({ status: 'connecting' })
    const user = (await this.api('GET', '/users')).data?.[0]
    const channel = (await this.api('GET', '/channels')).data?.[0]
    this.userId = user?.user_id ?? channel?.broadcaster_user_id
    this.slug = channel?.slug ?? user?.name
    this.name = user?.name ?? this.slug
    await this.connectSocket(++this.run)
  }

  private async connectSocket(run: number): Promise<void> {
    try {
      this.ctx.status({ status: 'connecting', account: this.name, detail: 'Reading Kick channel' })
      const d = await fetchChannel(this.slug)
      if (run !== this.run) return
      this.found = d
      await this.loadSeven()
      if (run !== this.run) return
      const channels = [`chatrooms.${d.chatroomId}.v2`, `chatrooms.${d.chatroomId}`, `chatroom_${d.chatroomId}`, `channel.${d.channelId}`, `channel_${d.channelId}`]
      this.socket = new KickSocket(fetchRealtime, channels, {
        onEvent: (name, data) => this.onEvent(name, data),
        onState: (s, detail) => this.ctx.status({ status: s, account: this.name, detail })
      })
      this.socket.start()
    } catch (err) {
      if (run !== this.run) return
      this.ctx.status({ status: 'reconnecting', account: this.name, detail: `Kick read failed: ${message(err)} Sending still works.` })
      await sleep(30000)
      if (run === this.run) await this.connectSocket(run)
    }
  }

  private async loadSeven(): Promise<void> {
    const on = store.settings.emoteProviders.seventv
    this.third = toLookup(on ? await load7tv('kick', String(this.found?.userId ?? this.userId), 'kick') : [])
  }

  async refreshEmotes(): Promise<void> {
    this.emoteCache = null
    if (this.found) await this.loadSeven()
  }

  private onEvent(name: string, data: any): void {
    const r = normalize(name, data, this.third)
    if (r.message) this.ctx.message(r.message)
    if (r.event) this.ctx.event(r.event)
    if (r.deleted) this.ctx.deleted(r.deleted)
    if (r.purgedUser) this.ctx.purged(r.purgedUser)
    if (r.purgedAll) this.ctx.purged()
  }

  async stop(): Promise<void> {
    this.run++
    this.socket?.stop()
    this.socket = null
  }

  async login(): Promise<void> {
    const c = this.creds()
    if (!c) throw new Error('Add your Kick client ID and secret first.')
    this.ctx.status({ status: 'authorizing', detail: 'Finish signing in in your browser' })
    try {
      const { code, verifier, redirectUri } = await loopbackLogin({
        authorizeUrl: 'https://id.kick.com/oauth/authorize',
        params: { client_id: c.id, scope: SCOPES },
        port: KICK_REDIRECT_PORT, host: 'localhost', path: '/callback'
      })
      await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret })
    } catch (err) {
      this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.stop()
    await this.start()
  }

  async logout(): Promise<void> {
    await this.stop()
    const t = this.tokens
    this.save(null)
    this.emoteCache = null
    if (t) void fetch(`https://id.kick.com/oauth/revoke?token=${encodeURIComponent(t.access)}&token_hint_type=access_token`, { method: 'POST' }).catch(() => {})
    this.ctx.status({ status: this.creds() ? 'needs-login' : 'needs-setup' })
  }

  async send(text: string, replyTo?: string): Promise<void> {
    const r = await this.api('POST', '/chat', { content: text, type: 'user', broadcaster_user_id: this.userId, reply_to_message_id: replyTo })
    if (r?.data && r.data.is_sent === false) throw new Error('Kick did not accept the message.')
  }

  async moderate(req: ModerationRequest): Promise<ActionResult> {
    switch (req.kind) {
      case 'delete':
        await this.api('DELETE', `/chat/${encodeURIComponent(req.messageId)}`)
        return { ok: true }
      case 'timeout':
        await this.api('POST', '/moderation/bans', { broadcaster_user_id: this.userId, user_id: Number(req.userId), duration: Math.min(10080, Math.max(1, Math.round(req.seconds / 60))) })
        return { ok: true }
      case 'ban':
        await this.api('POST', '/moderation/bans', { broadcaster_user_id: this.userId, user_id: Number(req.userId) })
        return { ok: true }
      case 'shoutout':
        return { ok: false, message: 'Kick has no shoutout API.' }
    }
  }

  async emotes(): Promise<Emote[]> {
    if (this.emoteCache) return this.emoteCache
    if (!this.found) return []
    const native: Emote[] = this.found.emotes.map((e) => ({
      id: e.id, name: e.name, url: `https://files.kick.com/emotes/${e.id}/fullsize`, provider: 'kick', platform: 'kick', group: e.group
    }))
    const seven = store.settings.emoteProviders.seventv ? await load7tv('kick', String(this.found.userId ?? this.userId), 'kick') : []
    this.emoteCache = [...native, ...seven]
    return this.emoteCache
  }

  async actions(): Promise<ActionDef[]> {
    if (!this.tokens) return []
    const platform = 'kick' as const
    const rewards = await this.api('GET', '/channels/rewards').catch(() => null)
    const actions: ActionDef[] = [
      { id: 'title', platform, group: 'Stream', label: 'Title', fields: [{ key: 'title', label: 'Stream title', type: 'text', required: true }] }
    ]
    for (const r of rewards?.data ?? []) {
      actions.push({ id: `reward.info.${r.id}`, platform, group: 'Rewards', label: `${r.title} (${r.cost})`, active: !!r.is_enabled, disabled: true, note: 'Shown for reference.' })
    }
    const pending = await this.api('GET', '/channels/rewards/redemptions?status=pending').catch(() => null)
    for (const group of pending?.data ?? []) {
      for (const item of group.redemptions ?? [group]) {
        if (!item.id) continue
        const who = item.redeemer?.username ?? item.user?.username ?? 'Viewer'
        const label = `${who}: ${group.reward?.title ?? item.reward?.title ?? 'reward'}`
        actions.push(
          { id: `redemption.accept.${item.id}`, platform, group: 'Pending redemptions', label: `Accept ${label}` },
          { id: `redemption.reject.${item.id}`, platform, group: 'Pending redemptions', label: `Reject ${label}` }
        )
      }
    }
    return actions
  }

  async runAction(actionId: string, a: Record<string, string>): Promise<ActionResult> {
    if (actionId === 'title') {
      await this.api('PATCH', '/channels', { stream_title: a.title })
      return { ok: true, message: 'Title updated.' }
    }
    const m = /^redemption\.(accept|reject)\.(.+)$/.exec(actionId)
    if (m) {
      await this.api('POST', `/channels/rewards/redemptions/${m[1]}`, { ids: [m[2]] })
      return { ok: true, message: m[1] === 'accept' ? 'Redemption accepted.' : 'Redemption rejected.' }
    }
    return { ok: false, message: `Unknown action: ${actionId}` }
  }
}

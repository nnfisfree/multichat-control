import type { EmoteLookup } from '../../../shared/parts'
import type { ActionDef, ActionResult, ChannelStats, Emote, ModerationRequest, UserEntry, UserProfile, UsersInfo } from '../../../shared/types'
import { core } from '../../core'
import { load7tv, toLookup } from '../../emotes/third-party'
import { api, fetchJson, message, sleep } from '../../net'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { fetchChannel, fetchFollowers, fetchRealtime, type KickChannel } from './discovery'

/** A non-negative whole number from Kick's API, or undefined. */
const count = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}
import { normalize } from './normalize'
import { KickSocket } from './socket'

const API = 'https://api.kick.com/public/v1'

export class KickConnector implements Connector {
  readonly platform = 'kick' as const
  private loggedIn = false
  private userId = 0
  private slug = ''
  private name = ''
  private mentions: string[] = []
  private socket: KickSocket | null = null
  private found: KickChannel | null = null
  private third: EmoteLookup = new Map()
  private emoteCache: Emote[] | null = null
  private run = 0

  constructor(private ctx: ConnectorContext) {}

  /** A request as the user's Kick account; the core adds and renews the token. */
  private async api(method: string, path: string, body?: unknown): Promise<any> {
    if (!this.loggedIn) throw new Error('Not logged in to Kick.')
    return api('kick', method, API + path, body)
  }

  /** The core found the login gone (revoked or expired): stop and ask for a new one. */
  async loginEnded(): Promise<void> {
    if (!this.loggedIn) return
    this.loggedIn = false
    await this.stop()
    this.ctx.status({ status: 'needs-login', detail: 'Your Kick login expired. Please log in again.' })
  }

  async start(): Promise<void> {
    const state = await core.authState('kick')
    if (!state.configured) return this.ctx.status({ status: 'needs-setup' })
    if (!state.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.loggedIn = true
    this.ctx.status({ status: 'connecting' })
    const user = (await this.api('GET', '/users')).data?.[0]
    const channel = (await this.api('GET', '/channels')).data?.[0]
    this.userId = user?.user_id ?? channel?.broadcaster_user_id
    this.slug = channel?.slug ?? user?.name
    this.name = user?.name ?? this.slug
    this.mentions = [this.slug, this.name].filter(Boolean)
    await this.connectSocket(++this.run)
  }

  private async connectSocket(run: number): Promise<void> {
    try {
      this.ctx.status({ status: 'connecting', account: this.name, mentions: this.mentions, detail: 'Reading Kick channel' })
      const d = await fetchChannel(this.slug)
      if (run !== this.run) return
      this.found = d
      if (d.followers !== undefined) this.followers = { at: Date.now(), n: d.followers }
      this.loadPast(d)
      await this.loadSeven()
      if (run !== this.run) return
      const channels = [`chatrooms.${d.chatroomId}.v2`, `chatrooms.${d.chatroomId}`, `chatroom_${d.chatroomId}`, `channel.${d.channelId}`, `channel_${d.channelId}`]
      this.socket = new KickSocket(fetchRealtime, channels, {
        onEvent: (name, data) => this.onEvent(name, data),
        onState: (s, detail) => this.ctx.status({ status: s, account: this.name, mentions: this.mentions, detail })
      })
      this.socket.start()
      void this.emotes()
    } catch (err) {
      if (run !== this.run) return
      this.ctx.status({ status: 'reconnecting', account: this.name, mentions: this.mentions, detail: `Kick read failed: ${message(err)} Sending still works.` })
      await sleep(30000)
      if (run === this.run) await this.connectSocket(run)
    }
  }

  /** Kick's official API keeps no event history, but the channel page lists past streams. */
  private loadPast(d: KickChannel): void {
    for (const v of d.past) {
      this.ctx.event({ id: `kick-stream-${v.id}-on`, platform: 'kick', ts: v.start, type: 'stream', text: 'Stream went live', subject: v.title || undefined, details: {}, history: true })
      if (v.seconds > 0) this.ctx.event({ id: `kick-stream-${v.id}-off`, platform: 'kick', ts: v.start + v.seconds * 1000, type: 'stream', text: 'Stream went offline', details: {}, history: true })
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

  private viewerCache: { at: number; info: UsersInfo } | null = null

  /**
   * Picture from Kick's official API; follow and sub details from the data Kick's own website
   * uses, when Kick lets it through. Either part can be missing.
   */
  async profile(user: UserEntry): Promise<UserProfile> {
    const official = (await this.api('GET', `/users?id=${encodeURIComponent(user.id)}`).catch(() => null))?.data?.[0]
    const slug = (user.login ?? user.name).toLowerCase()
    const web = /^[a-z0-9_-]+$/i.test(slug) && this.slug
      ? await fetchJson(`https://kick.com/api/v2/channels/${this.slug}/users/${slug}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', Accept: 'application/json', Referer: 'https://kick.com/' } }).catch(() => null)
      : null
    const months = Number(web?.subscribed_for)
    return {
      avatar: official?.profile_picture || web?.profile_pic || undefined,
      followedAt: web ? (web.following_since ? Date.parse(web.following_since) : null) : undefined,
      sub: web ? (months > 0 ? { months } : null) : undefined,
      roles: (web?.badges ?? []).map((b: any) => b.text ?? b.type).filter(Boolean),
      url: `https://kick.com/${encodeURIComponent(slug)}`
    }
  }

  /** Kick lists no viewers, only how many are watching. */
  /** Followers last read from Kick's channel page, which changes slowly and is read sparingly. */
  private followers: { at: number; n?: number } = { at: 0 }

  /**
   * Subscribers come from Kick's API. Kick's API has no follower count, so that comes from the same
   * public channel page the chat connection reads.
   */
  async stats(): Promise<ChannelStats> {
    if (!this.loggedIn) return {}
    const [ch, followers] = await Promise.all([
      this.api('GET', '/channels').then((r) => r?.data?.[0], () => null),
      this.followerCount()
    ])
    const paid = count(ch?.active_subscribers_count)
    const gifted = count(ch?.active_gifted_subscribers_count)
    return { followers, subscribers: paid === undefined && gifted === undefined ? undefined : (paid ?? 0) + (gifted ?? 0), gifted }
  }

  private async followerCount(): Promise<number | undefined> {
    if (this.slug && Date.now() - this.followers.at > 5 * 60000) {
      this.followers.at = Date.now()
      const n = await fetchFollowers(this.slug)
      if (n !== undefined) this.followers.n = n
    }
    return this.followers.n
  }

  async users(): Promise<UsersInfo> {
    if (!this.loggedIn) return { live: false }
    if (this.viewerCache && Date.now() - this.viewerCache.at < 30000) return this.viewerCache.info
    const ch = (await this.api('GET', '/channels').catch(() => null))?.data?.[0]
    const n = Number(ch?.stream?.viewer_count)
    const info: UsersInfo = { live: !!ch?.stream?.is_live, viewers: ch?.stream?.is_live && Number.isFinite(n) ? n : undefined }
    this.viewerCache = { at: Date.now(), info }
    return info
  }

  async stop(): Promise<void> {
    this.run++
    this.socket?.stop()
    this.socket = null
  }

  async login(): Promise<void> {
    this.ctx.status({ status: 'authorizing', detail: 'Finish signing in in your browser' })
    try {
      await core.login('kick')
    } catch (err) {
      this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.stop()
    await this.start()
  }

  async logout(): Promise<void> {
    await this.stop()
    this.loggedIn = false
    this.emoteCache = null
    await core.logout('kick')
    this.ctx.status({ status: 'needs-login' })
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
    if (!this.loggedIn) return []
    const platform = 'kick' as const
    const rewards = await this.api('GET', '/channels/rewards').catch(() => null)
    const actions: ActionDef[] = [
      { id: 'title', platform, group: 'Stream', label: 'Title', fields: [{ key: 'title', label: 'Stream title', type: 'text', required: true }] }
    ]
    for (const r of rewards?.data ?? []) {
      if (!r.is_enabled) continue
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

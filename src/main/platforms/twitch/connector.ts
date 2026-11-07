import { shell } from 'electron'
import { TWITCH_CLIENT_ID } from '../../../shared/app-config'
import type { EmoteLookup } from '../../../shared/parts'
import type { ActionDef, ActionResult, Badge, Emote, ModerationRequest } from '../../../shared/types'
import { deviceLogin, refreshTokens, validate, type TwitchTokens } from '../../auth/twitch-device'
import { loadEmoteCache, saveEmoteCache } from '../../emotes/cache'
import { loadTwitchExtras, toLookup } from '../../emotes/third-party'
import { errorText, HttpError, message, readBody } from '../../net'
import { Pronouns } from '../../pronouns'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { buildActions, runTwitchAction } from './actions'
import { buildEmoteList, fetchOwners, smallAvatar } from './emotes'
import { EventSub } from './eventsub'
import { chatMessage, eventFromSub, hypeTrain, notification, type CheerMap } from './normalize'

const HELIX = 'https://api.twitch.tv/helix'

export interface Helix {
  (method: string, path: string, query?: Record<string, string | undefined>, body?: unknown): Promise<any>
}

export class TwitchConnector implements Connector {
  readonly platform = 'twitch' as const
  private tokens: TwitchTokens | null = null
  private refreshing: Promise<void> | null = null
  private userId = ''
  private login_ = ''
  private displayName = ''
  private sub: EventSub | null = null
  private badges = new Map<string, Badge>()
  private third: EmoteLookup = new Map()
  private emoteCache: Emote[] | null = null
  private emoteLoad: Promise<Emote[]> | null = null
  private thirdList: Emote[] = []
  private avatar = ''
  private manageable = new Set<string>()
  private loginRun = 0
  private pronouns: Pronouns
  private cheers: CheerMap = new Map()
  private hypeLevel = 0

  constructor(private ctx: ConnectorContext) {
    this.pronouns = new Pronouns((login, label) => ctx.pronoun(login, label))
  }

  channelLogin(): string | undefined {
    return this.login_ || undefined
  }

  private clientId(): string {
    return store.settings.twitchClientId || TWITCH_CLIENT_ID
  }

  private save(tokens: TwitchTokens | null): void {
    this.tokens = tokens
    store.setSecret('twitch.tokens', tokens ? JSON.stringify(tokens) : undefined)
  }

  /** Refresh tokens are single-use, so concurrent callers must share one refresh. */
  private refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        this.save(await refreshTokens(this.clientId(), this.tokens!.refresh))
      } catch (err) {
        if (err instanceof HttpError && err.status < 500) {
          this.save(null)
          this.sub?.stop()
          this.ctx.status({ status: 'needs-login', detail: 'Your Twitch login expired. Please log in again.' })
        }
        throw err
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private helix: Helix = async (method, path, query, body) => {
    if (!this.tokens) throw new Error('Not logged in to Twitch.')
    if (Date.now() > this.tokens.expiresAt - 60000) await this.refresh()
    const url = new URL(HELIX + path)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v)
    const request = (): Promise<Response> => fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.tokens!.access}`, 'Client-Id': this.clientId(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    })
    let res = await request()
    if (res.status === 401) {
      await this.refresh()
      res = await request()
    }
    const data = await readBody(res)
    if (!res.ok) throw new HttpError(res.status, errorText(data, `Twitch error ${res.status}`), data)
    return data
  }

  async start(): Promise<void> {
    if (!this.clientId()) return this.ctx.status({ status: 'needs-setup', detail: 'Add a Twitch Client ID.' })
    const raw = store.getSecret('twitch.tokens')
    if (!raw) return this.ctx.status({ status: 'needs-login' })
    this.tokens = JSON.parse(raw)
    this.ctx.status({ status: 'connecting' })
    if (Date.now() > this.tokens!.expiresAt - 60000) await this.refresh()
    let who = await validate(this.tokens!.access).catch(() => null)
    if (!who) {
      await this.refresh()
      who = await validate(this.tokens!.access)
    }
    this.userId = who.user_id
    this.login_ = who.login
    const users = await this.helix('GET', '/users', { id: who.user_id })
    this.displayName = users.data?.[0]?.display_name ?? who.login
    this.avatar = smallAvatar(users.data?.[0]?.profile_image_url)
    this.emoteCache = loadEmoteCache(`twitch-${who.user_id}`)
    await Promise.all([this.loadBadges(), this.loadThirdParty(), this.loadManageable(), this.loadCheers()])
    this.sub = new EventSub({
      onSession: (id) => this.subscribeAll(id),
      onNotification: (type, id, e) => this.onEvent(type, id, e),
      onState: (s, detail) => this.ctx.status({ status: s, account: this.displayName, detail })
    })
    this.sub.start()
    // Ready before the picker is first opened.
    void this.refreshList()
  }

  async stop(): Promise<void> {
    this.loginRun++
    this.sub?.stop()
    this.sub = null
  }

  async login(): Promise<void> {
    const clientId = this.clientId()
    if (!clientId) throw new Error('Add a Twitch Client ID first.')
    const run = ++this.loginRun
    this.ctx.status({ status: 'authorizing' })
    try {
      const tokens = await deviceLogin(clientId, (code, url) => {
        this.ctx.status({ status: 'authorizing', device: { code, url } })
        void shell.openExternal(url)
      }, () => run !== this.loginRun)
      this.save(tokens)
    } catch (err) {
      if (run === this.loginRun) this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.stop()
    await this.start()
  }

  async logout(): Promise<void> {
    await this.stop()
    const t = this.tokens
    this.save(null)
    this.userId = this.login_ = ''
    this.emoteCache = null
    if (t) void fetch('https://id.twitch.tv/oauth2/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId(), token: t.access }) }).catch(() => {})
    this.ctx.status({ status: this.clientId() ? 'needs-login' : 'needs-setup' })
  }

  private async loadBadges(): Promise<void> {
    const load = async (path: string, q?: Record<string, string>): Promise<void> => {
      const r = await this.helix('GET', path, q).catch(() => null)
      for (const set of r?.data ?? []) for (const v of set.versions ?? []) {
        this.badges.set(`${set.set_id}/${v.id}`, { id: set.set_id, title: v.title || set.set_id, url: v.image_url_2x })
      }
    }
    await load('/chat/badges/global')
    await load('/chat/badges', { broadcaster_id: this.userId })
  }

  private thirdParty(): Promise<Emote[]> {
    return loadTwitchExtras(this.userId, store.settings.emoteProviders)
  }

  private async loadThirdParty(): Promise<void> {
    this.thirdList = await this.thirdParty()
    this.third = toLookup(this.thirdList)
  }

  private async loadCheers(): Promise<void> {
    const r = await this.helix('GET', '/bits/cheermotes', { broadcaster_id: this.userId }).catch(() => null)
    this.cheers = new Map((r?.data ?? []).map((c: any) => [
      c.prefix.toLowerCase(),
      [...c.tiers].sort((a: any, b: any) => a.min_bits - b.min_bits).map((t: any) => ({ minBits: t.min_bits, url: t.images?.dark?.animated?.['2'] ?? t.images?.dark?.static?.['2'] }))
    ]))
  }

  async refreshEmotes(): Promise<void> {
    this.emoteCache = null
    if (!this.tokens) return
    await this.loadThirdParty()
    await this.refreshList()
  }

  private async loadManageable(): Promise<void> {
    const r = await this.helix('GET', '/channel_points/custom_rewards', { broadcaster_id: this.userId, only_manageable_rewards: 'true' }).catch(() => null)
    this.manageable = new Set((r?.data ?? []).map((x: any) => x.id))
  }

  private async subscribeAll(sessionId: string): Promise<void> {
    const b = { broadcaster_user_id: this.userId }
    const chat = { ...b, user_id: this.userId }
    const mod = { ...b, moderator_user_id: this.userId }
    const subs: [string, string, Record<string, string>][] = [
      ['channel.chat.message', '1', chat], ['channel.chat.notification', '1', chat], ['channel.chat.message_delete', '1', chat],
      ['channel.chat.clear', '1', chat], ['channel.chat.clear_user_messages', '1', chat],
      ['channel.follow', '2', mod],
      ['channel.channel_points_custom_reward_redemption.add', '1', b],
      ['channel.channel_points_automatic_reward_redemption.add', '2', b],
      ['channel.custom_power_up_redemption.add', '1', b],
      ['channel.bits.use', '1', b],
      ['channel.raid', '1', { from_broadcaster_user_id: this.userId }],
      ['channel.ban', '1', b], ['channel.unban', '1', b],
      ['channel.shoutout.create', '1', mod], ['channel.shoutout.receive', '1', mod],
      ['channel.hype_train.begin', '2', b], ['channel.hype_train.progress', '2', b], ['channel.hype_train.end', '2', b],
      ['channel.poll.begin', '1', b], ['channel.poll.end', '1', b],
      ['channel.prediction.begin', '1', b], ['channel.prediction.lock', '1', b], ['channel.prediction.end', '1', b],
      ['channel.goal.begin', '1', b], ['channel.goal.end', '1', b],
      ['channel.ad_break.begin', '1', b],
      ['stream.online', '1', b], ['stream.offline', '1', b]
    ]
    const results = await Promise.allSettled(subs.map(([type, version, condition]) =>
      this.helix('POST', '/eventsub/subscriptions', undefined, { type, version, condition, transport: { method: 'websocket', session_id: sessionId } })))
    // Some types need Affiliate status; only the chat subscription is essential.
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`[twitch] ${subs[i][0]}: ${message(r.reason)}`)
    })
    if (results[0].status === 'rejected') throw results[0].reason
  }

  private onEvent(type: string, id: string, e: any): void {
    switch (type) {
      case 'channel.chat.message':
        if (store.settings.showPronouns) this.pronouns.request(e.chatter_user_login)
        return this.ctx.message(chatMessage(e, this.badges, this.third, this.cheers))
      case 'channel.chat.notification': {
        const n = notification(e, this.badges, this.third)
        if (n.message) this.ctx.message(n.message)
        if (n.event) this.ctx.event(n.event)
        return
      }
      case 'channel.chat.message_delete':
        return this.ctx.deleted(e.message_id)
      case 'channel.hype_train.begin':
      case 'channel.hype_train.progress': {
        const train = hypeTrain(e)
        this.ctx.hype(train)
        if (type.endsWith('begin') || train.level <= this.hypeLevel) {
          this.hypeLevel = train.level
          break
        }
        this.hypeLevel = train.level
        return this.ctx.event({ id, platform: 'twitch', ts: Date.now(), type: 'hypetrain', big: true, text: `Hype Train reached level ${train.level}!`, amount: `Level ${train.level}`, details: {} })
      }
      case 'channel.hype_train.end':
        this.ctx.hype(null)
        this.hypeLevel = 0
        break
      case 'channel.chat.clear':
        return this.ctx.purged()
      case 'channel.chat.clear_user_messages':
        return this.ctx.purged(e.target_user_id)
      default:
        if (type === 'channel.ban') this.ctx.purged(e.user_id)
    }
    const ev = eventFromSub(type, id, e, this.manageable)
    if (ev) this.ctx.event(ev)
  }

  async send(text: string, replyTo?: string): Promise<void> {
    const r = await this.helix('POST', '/chat/messages', undefined, {
      broadcaster_id: this.userId, sender_id: this.userId, message: text, reply_parent_message_id: replyTo
    })
    const res = r.data?.[0]
    if (res && !res.is_sent) throw new Error(res.drop_reason?.message ?? 'Twitch dropped the message.')
  }

  async moderate(req: ModerationRequest): Promise<ActionResult> {
    const ids = { broadcaster_id: this.userId, moderator_id: this.userId }
    switch (req.kind) {
      case 'delete':
        await this.helix('DELETE', '/moderation/chat', { ...ids, message_id: req.messageId })
        break
      case 'timeout':
        await this.helix('POST', '/moderation/bans', ids, { data: { user_id: req.userId, duration: req.seconds } })
        break
      case 'ban':
        await this.helix('POST', '/moderation/bans', ids, { data: { user_id: req.userId } })
        break
      case 'shoutout':
        await this.helix('POST', '/chat/shoutouts', { from_broadcaster_id: this.userId, to_broadcaster_id: req.userId, moderator_id: this.userId })
        break
    }
    return { ok: true }
  }

  async emotes(): Promise<Emote[]> {
    if (this.emoteCache) return this.emoteCache
    if (!this.tokens) return []
    return this.refreshList()
  }

  /** One shared download, however many callers ask at the same moment. */
  private refreshList(): Promise<Emote[]> {
    this.emoteLoad ??= this.fetchEmotes().then((list) => {
      this.emoteCache = list
      saveEmoteCache(`twitch-${this.userId}`, list)
      return list
    }).finally(() => { this.emoteLoad = null })
    return this.emoteLoad
  }

  private async fetchEmotes(): Promise<Emote[]> {
    const userEmotes: any[] = []
    let cursor: string | undefined
    do {
      const r = await this.helix('GET', '/chat/emotes/user', { user_id: this.userId, after: cursor }).catch(() => null)
      userEmotes.push(...(r?.data ?? []))
      cursor = r?.pagination?.cursor
    } while (cursor)
    const [channel, global, owners] = await Promise.all([
      this.helix('GET', '/chat/emotes', { broadcaster_id: this.userId }).catch(() => null),
      this.helix('GET', '/chat/emotes/global').catch(() => null),
      fetchOwners(this.helix, userEmotes.map((e) => e.owner_id))
    ])
    const native = buildEmoteList({ id: this.userId, avatar: this.avatar }, channel?.data ?? [], userEmotes, global?.data ?? [], owners)
    // A failed refresh must not replace a good saved list with nothing.
    if (!native.length && this.emoteCache) return this.emoteCache
    return [...native, ...this.thirdList]
  }

  async actions(): Promise<ActionDef[]> {
    if (!this.tokens) return []
    return buildActions(this.helix, this.userId)
  }

  async runAction(actionId: string, args: Record<string, string>): Promise<ActionResult> {
    const r = await runTwitchAction(this.helix, this.userId, actionId, args)
    if (actionId === 'reward.create') await this.loadManageable()
    return r
  }
}

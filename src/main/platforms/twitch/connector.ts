import { shell } from 'electron'
import { TWITCH_CLIENT_ID } from '../../../shared/app-config'
import type { EmoteLookup } from '../../../shared/parts'
import type { ActionDef, ActionResult, Badge, Emote, ModerationRequest, StreamEvent, UserEntry, UserGroups, UserProfile, UsersInfo } from '../../../shared/types'
import { deviceLogin, refreshTokens, validate, type TwitchTokens } from '../../auth/twitch-device'
import { loadEmoteCache, saveEmoteCache } from '../../emotes/cache'
import { loadTwitchExtras, toLookup } from '../../emotes/third-party'
import { log } from '../../log'
import { errorText, HttpError, message, readBody } from '../../net'
import { Pronouns } from '../../pronouns'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { buildActions, runTwitchAction } from './actions'
import { buildEmoteList, fetchOwners, smallAvatar } from './emotes'
import { EventSub } from './eventsub'
import { chatMessage, eventFromSub, hypeTrain, notification, type CheerMap } from './normalize'

const HELIX = 'https://api.twitch.tv/helix'
/** Twitch asks apps to check their login hourly; this also renews it well before it runs out. */
const CHECK_MS = 55 * 60 * 1000
const RENEW_BEFORE_MS = 40 * 60 * 1000
/** After a refused renewal, wait before asking Twitch again. */
const RETRY_MS = 5 * 60 * 1000

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
  private checkTimer: NodeJS.Timeout | null = null
  private renewBlockedUntil = 0

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

  /**
   * Renews the login. Refresh tokens are single-use, so concurrent callers share one renewal.
   * The login is only dropped when Twitch rejects the renewal and the current login is dead too:
   * network errors, rate limits or a briefly refused renewal never log the user out.
   */
  private refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      const used = this.tokens!.refresh
      try {
        this.save(await refreshTokens(this.clientId(), used))
        this.renewBlockedUntil = 0
        log('twitch', 'login renewed')
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 0
        log('twitch', `login renewal failed (${status || 'network'}): ${message(err)}`)
        // A newer login may already be saved, for example by an earlier renewal that raced this one.
        const raw = store.getSecret('twitch.tokens')
        const saved: TwitchTokens | null = raw ? JSON.parse(raw) : null
        if (saved && saved.refresh !== used) {
          this.tokens = saved
          log('twitch', 'using the newer saved login')
          return
        }
        this.renewBlockedUntil = Date.now() + RETRY_MS
        if (/client secret/i.test(message(err))) {
          // The Twitch app is registered as Confidential, so no renewal can ever succeed.
          log('twitch', 'the Twitch Client ID belongs to a Confidential app; it must be Public')
        }
        if (status === 400 || status === 401) {
          const still = await validate(this.tokens!.access).catch(() => null)
          if (still) {
            // The login still works for now, so keep going and try renewing again later.
            this.tokens = { ...this.tokens!, expiresAt: Date.now() + still.expires_in * 1000 }
            log('twitch', `current login still valid for ${Math.round(still.expires_in / 60)} min`)
            return
          }
          this.save(null)
          this.sub?.stop()
          this.ctx.status({ status: 'needs-login', detail: 'Twitch ended this login. Please log in again.' })
        }
        throw err
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  /** Hourly login check, as Twitch requires, renewing early so it never lapses mid-stream. */
  private async check(): Promise<void> {
    if (!this.tokens) return
    try {
      const ok = await validate(this.tokens.access).catch((err) => {
        if (err instanceof HttpError && err.status === 401) return null
        throw err
      })
      if (!ok || Date.now() > this.tokens.expiresAt - RENEW_BEFORE_MS) await this.refresh()
    } catch (err) {
      log('twitch', `login check failed: ${message(err)}`)
    }
  }

  private helix: Helix = async (method, path, query, body) => {
    if (!this.tokens) throw new Error('Not logged in to Twitch.')
    if (Date.now() > this.tokens.expiresAt - 60000 && Date.now() > this.renewBlockedUntil) await this.refresh()
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
    // A fresh login may carry the permissions the full chatter list needs.
    this.chattersBlocked = false
    this.usersCache = null
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
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = setInterval(() => void this.check(), CHECK_MS)
    // Ready before the picker is first opened.
    void this.refreshList()
    void this.loadHistory()
  }

  /**
   * Fills the Events list with everything Twitch keeps a date for: follows, past streams, polls,
   * predictions and the Hype Train record. Twitch keeps no dated history of subs, gifts, Bits,
   * raids or redemptions; those are saved as they happen and appear here on later starts.
   */
  private async loadHistory(): Promise<void> {
    const b = this.userId
    const get = (path: string, q: Record<string, string>): Promise<any[]> => this.helix('GET', path, q).then((r) => r?.data ?? [], () => [])
    const [follows, videos, polls, predictions, hype] = await Promise.all([
      get('/channels/followers', { broadcaster_id: b, first: '50' }),
      get('/videos', { user_id: b, type: 'archive', first: '20' }),
      get('/polls', { broadcaster_id: b, first: '20' }),
      get('/predictions', { broadcaster_id: b, first: '20' }),
      get('/hypetrain/status', { broadcaster_id: b })
    ])
    const add = (e: Omit<StreamEvent, 'platform' | 'history' | 'details'> & { details?: Record<string, string> }): void => {
      if (Number.isFinite(e.ts) && e.ts > 0) this.ctx.event({ details: {}, ...e, platform: 'twitch', history: true })
    }
    for (const f of follows) {
      const ts = Date.parse(f.followed_at)
      add({ id: `follow-${f.user_id}-${ts}`, ts, type: 'follow', actor: f.user_name, text: 'followed' })
    }
    for (const v of videos) {
      const start = Date.parse(v.created_at)
      add({ id: `stream-${v.stream_id ?? v.id}-on`, ts: start, type: 'stream', text: 'Stream went live', subject: v.title || undefined })
      const secs = durationSeconds(v.duration)
      // A VOD of the stream still running has no end yet.
      if (secs && start + secs * 1000 < Date.now() - 5 * 60000) {
        add({ id: `stream-${v.stream_id ?? v.id}-off`, ts: start + secs * 1000, type: 'stream', text: 'Stream went offline', details: { Length: v.duration, Views: String(v.view_count ?? '') } })
      }
    }
    for (const p of polls) {
      const done = p.status !== 'ACTIVE'
      add({
        id: `poll-${p.id}`, ts: Date.parse((done && p.ended_at) || p.started_at), type: 'poll', text: `Poll ${done ? 'ended' : 'started'}: ${p.title}`,
        details: Object.fromEntries((p.choices ?? []).map((c: any) => [c.title, `${c.votes ?? 0} votes`]))
      })
    }
    for (const p of predictions) {
      const winner = (p.outcomes ?? []).find((o: any) => o.id === p.winning_outcome_id)?.title
      const done = p.status === 'RESOLVED' || p.status === 'CANCELED'
      add({
        id: `prediction-${p.id}`, ts: Date.parse((done && p.ended_at) || p.locked_at || p.created_at), type: 'prediction',
        text: `Prediction ${p.status === 'CANCELED' ? 'canceled' : done ? 'ended' : 'started'}: ${p.title}`,
        details: { ...(winner ? { Winner: winner } : {}), ...Object.fromEntries((p.outcomes ?? []).map((o: any) => [o.title, `${o.users ?? 0} people, ${o.channel_points ?? 0} points`])) }
      })
    }
    const best = hype[0]?.all_time_high
    if (best?.achieved_at) {
      add({ id: `hype-record-${best.achieved_at}`, ts: Date.parse(best.achieved_at), type: 'hypetrain', text: 'Hype Train record reached', amount: `Level ${best.level}`, details: { Total: String(best.total ?? '') } })
    }
  }

  private chattersBlocked = false
  private usersCache: { at: number; info: UsersInfo } | null = null
  private roles: { at: number; mods: Set<string>; vips: Set<string> } | null = null

  /** Each user's chosen chat colour, kept for 30 minutes. Empty means they never picked one. */
  private colors = new Map<string, { color: string; at: number }>()

  /** Looks up the name colours people picked on Twitch, 100 users per request. */
  private async paintNames(ids: string[]): Promise<void> {
    const stale = ids.filter((id) => (Date.now() - (this.colors.get(id)?.at ?? 0)) > 30 * 60000)
    for (let i = 0; i < stale.length; i += 100) {
      const batch = stale.slice(i, i + 100)
      const url = batch.map((id) => `user_id=${encodeURIComponent(id)}`).join('&')
      const r = await this.helix('GET', `/chat/color?${url}`).catch(() => null)
      for (const c of r?.data ?? []) this.colors.set(c.user_id, { color: c.color ?? '', at: Date.now() })
    }
  }

  /** Account age, follow, sub and ban state, for the user card. */
  async profile(user: UserEntry): Promise<UserProfile> {
    const b = this.userId
    const id = user.id
    const first = (r: any): any => r?.data?.[0]
    const [u, follow, sub, ban] = await Promise.all([
      this.helix('GET', '/users', { id }).then(first, () => null),
      this.helix('GET', '/channels/followers', { broadcaster_id: b, user_id: id }).then((r) => r, () => undefined),
      this.helix('GET', '/subscriptions', { broadcaster_id: b, user_id: id }).then((r) => r, () => undefined),
      this.helix('GET', '/moderation/banned', { broadcaster_id: b, user_id: id }).then((r) => r, () => undefined)
    ])
    if (!this.roles || Date.now() - this.roles.at > 5 * 60000) await this.users().catch(() => null)
    const f = first(follow)
    const s = first(sub)
    const x = first(ban)
    const tier: Record<string, string> = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' }
    return {
      avatar: u?.profile_image_url,
      createdAt: Date.parse(u?.created_at) || undefined,
      about: u?.description || undefined,
      url: u?.login ? `https://www.twitch.tv/${u.login}` : undefined,
      // undefined means Twitch didn't say (for example a missing permission); null means "no".
      followedAt: follow === undefined ? undefined : f ? Date.parse(f.followed_at) : null,
      sub: sub === undefined ? undefined : s ? { tier: tier[s.tier] ?? s.tier, gift: !!s.is_gift } : null,
      banned: ban === undefined ? undefined : x ? { until: x.expires_at ? Date.parse(x.expires_at) : undefined } : null,
      roles: [
        ...(id === b ? ['Broadcaster'] : []),
        ...(this.roles?.mods.has(id) ? ['Moderator'] : []),
        ...(this.roles?.vips.has(id) ? ['VIP'] : [])
      ]
    }
  }

  /** Every page of a Helix list, up to a limit. */
  private async all(path: string, query: Record<string, string>, limit: number): Promise<any[]> {
    const out: any[] = []
    let after: string | undefined
    do {
      const r = await this.helix('GET', path, { ...query, ...(after ? { after } : {}) })
      out.push(...(r?.data ?? []))
      after = r?.pagination?.cursor
    } while (after && out.length < limit)
    return out
  }

  /**
   * Twitch's own list of who is in chat (signed-in users only), grouped by role. Without the
   * newer permissions, it reports that a new login is needed instead of failing.
   */
  async users(): Promise<UsersInfo> {
    if (!this.userId) return { live: false }
    if (this.usersCache && Date.now() - this.usersCache.at < 30000) return this.usersCache.info
    const b = this.userId
    const stream = (await this.helix('GET', '/streams', { user_id: b }).catch(() => null))?.data?.[0]
    const base: UsersInfo = { live: !!stream, viewers: stream?.viewer_count }
    if (this.chattersBlocked) return { ...base, needsRelogin: true }
    try {
      const chatters = await this.all('/chat/chatters', { broadcaster_id: b, moderator_id: b, first: '1000' }, 5000)
      if (!this.roles || Date.now() - this.roles.at > 5 * 60000) {
        const [mods, vips] = await Promise.all([
          this.all('/moderation/moderators', { broadcaster_id: b, first: '100' }, 1000).catch((): any[] => []),
          this.all('/channels/vips', { broadcaster_id: b, first: '100' }, 1000).catch((): any[] => [])
        ])
        this.roles = { at: Date.now(), mods: new Set(mods.map((m) => m.user_id)), vips: new Set(vips.map((v) => v.user_id)) }
      }
      const groups: UserGroups = { broadcaster: [], moderators: [], vips: [], members: [], users: [] }
      for (const c of chatters) {
        const entry: UserEntry = { id: c.user_id, name: c.user_name || c.user_login, login: c.user_login }
        const role: keyof UserGroups = c.user_id === b ? 'broadcaster' : this.roles.mods.has(c.user_id) ? 'moderators' : this.roles.vips.has(c.user_id) ? 'vips' : 'users'
        groups[role].push(entry)
      }
      await this.paintNames(chatters.map((c) => c.user_id))
      for (const g of Object.values(groups) as UserEntry[][]) for (const u of g) u.color = this.colors.get(u.id)?.color || undefined
      const info = { ...base, groups }
      this.usersCache = { at: Date.now(), info }
      return info
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        // Asking again would only renew the login for nothing until the user logs in again.
        this.chattersBlocked = true
        return { ...base, needsRelogin: true }
      }
      return base
    }
  }

  async stop(): Promise<void> {
    this.loginRun++
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = null
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
      ['stream.online', '1', b], ['stream.offline', '1', b],
      ['channel.channel_points_custom_reward.add', '1', b], ['channel.channel_points_custom_reward.update', '1', b], ['channel.channel_points_custom_reward.remove', '1', b]
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
      case 'channel.channel_points_custom_reward.add':
      case 'channel.channel_points_custom_reward.update':
      case 'channel.channel_points_custom_reward.remove':
        return this.ctx.actionsChanged()
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

/** Twitch writes VOD lengths like "3h2m10s". */
function durationSeconds(d: string | undefined): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d ?? '')
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

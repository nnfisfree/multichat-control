import type { EmoteLookup } from '../../../shared/parts'
import type { ActionDef, ActionResult, Badge, ChannelStats, RaidInfo, Emote, LinkPreview, MessageFlag, ModerationRequest, CommandOutcome, StreamEvent, UserEntry, UserGroups, UserProfile, UsersInfo } from '../../../shared/types'
import { core, onDeviceCode } from '../../core'
import { loadEmoteCache, saveEmoteCache } from '../../emotes/cache'
import { loadTwitchExtras, toLookup } from '../../emotes/third-party'
import { log } from '../../log'
import { api, HttpError, message } from '../../net'
import { ClipWatch, twitchClipPreview, type NewClip } from '../../previews'
import { Pronouns } from '../../pronouns'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { buildActions, runTwitchAction } from './actions'
import { runTwitchCommand } from './commands'
import { buildEmoteList, fetchOwners, smallAvatar } from './emotes'
import { EventSub } from './eventsub'
import { heldMessage, heldRowId, heldStatus, suspiciousFlag, suspiciousMessage } from './moderation'
import { chatMessage, eventFromSub, hypeTrain, notification, type CheerMap } from './normalize'

const HELIX = 'https://api.twitch.tv/helix'
/** The permissions for held messages (AutoMod) and suspicious-user warnings. */
const MOD_SCOPES = ['moderator:manage:automod', 'moderator:read:suspicious_users']
/** How long a suspicious-user warning waits for its chat message before showing the message itself. */
const SUSPICIOUS_WAIT_MS = 3000
/** Twitch asks apps to check their login hourly. */
const CHECK_MS = 55 * 60 * 1000

export interface Helix {
  (method: string, path: string, query?: Record<string, string | undefined>, body?: unknown): Promise<any>
}

/** Twitch's login check. The core adds the token and renews it when needed. */
const validate = (): Promise<{ login: string; user_id: string; scopes: string[]; expires_in: number }> =>
  api('twitch', 'GET', 'https://id.twitch.tv/oauth2/validate')

export class TwitchConnector implements Connector {
  readonly platform = 'twitch' as const
  private loggedIn = false
  private userId = ''
  private login_ = ''
  private displayName = ''
  private mentions: string[] = []
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
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private pinTimer: ReturnType<typeof setInterval> | null = null
  private pinState = ''
  private clips: ClipWatch
  /** Set when the login lacks the permissions for held messages and suspicious users. */
  private relogin: string | undefined
  /** Suspicious-user warnings waiting a moment for their chat message to arrive. */
  private suspicious = new Map<string, { flag: MessageFlag; timer: ReturnType<typeof setTimeout> }>()

  constructor(private ctx: ConnectorContext) {
    this.pronouns = new Pronouns((login, label) => ctx.pronoun(login, label))
    this.clips = new ClipWatch('twitch', (since) => this.newClips(since), (e) => ctx.event(e))
  }

  channelLogin(): string | undefined {
    return this.login_ || undefined
  }

  /** The card for a clip link, from any channel. Needs the Twitch login. */
  async clipPreview(slug: string): Promise<LinkPreview | null> {
    if (!this.loggedIn) return null
    const r = await this.helix('GET', '/clips', { id: slug })
    return twitchClipPreview(r?.data?.[0])
  }

  /** Clips of this channel made since a time, by anyone. */
  private async newClips(since: number): Promise<NewClip[]> {
    if (!this.userId) return []
    const r = await this.helix('GET', '/clips', { broadcaster_id: this.userId, started_at: new Date(since).toISOString(), first: '20' })
    return (r?.data ?? []).flatMap((c: any) => {
      const preview = twitchClipPreview(c)
      return preview ? [{ id: String(c.id), createdAt: Date.parse(c.created_at), preview }] : []
    })
  }

  /** The core found the login gone (revoked or expired): stop and ask for a new one. */
  async loginEnded(): Promise<void> {
    if (!this.loggedIn) return
    this.loggedIn = false
    await this.stop()
    this.ctx.status({ status: 'needs-login', detail: 'Twitch ended this login. Please log in again.' })
  }

  /** Hourly login check, as Twitch requires. A failed check renews the login in the core. */
  private async check(): Promise<void> {
    if (!this.loggedIn) return
    await validate().catch((err) => log('twitch', `login check failed: ${message(err)}`))
  }

  private helix: Helix = async (method, path, query, body) => {
    if (!this.loggedIn) throw new Error('Not logged in to Twitch.')
    const url = new URL(HELIX + path)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v)
    return api('twitch', method, url.href, body)
  }

  async start(): Promise<void> {
    const state = await core.authState('twitch')
    if (!state.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.loggedIn = true
    this.ctx.status({ status: 'connecting' })
    const who = await validate()
    this.userId = who.user_id
    // A fresh login may carry the permissions the full chatter list needs.
    this.chattersBlocked = false
    this.usersCache = null
    this.login_ = who.login
    const users = await this.helix('GET', '/users', { id: who.user_id })
    this.displayName = users.data?.[0]?.display_name ?? who.login
    this.mentions = [who.login, this.displayName]
    this.avatar = smallAvatar(users.data?.[0]?.profile_image_url)
    this.emoteCache = await loadEmoteCache(`twitch-${who.user_id}`)
    await Promise.all([this.loadBadges(), this.loadThirdParty(), this.loadManageable(), this.loadCheers()])
    // Logins from before held messages and suspicious users need to log in again for them.
    const missing = MOD_SCOPES.filter((s) => !who.scopes?.includes(s))
    this.relogin = missing.length ? 'Log in to Twitch again to see messages AutoMod holds for review and warnings about suspicious users.' : undefined
    if (this.relogin) {
      log('twitch', `login lacks ${missing.join(', ')}`)
      this.ctx.message({ id: `relogin-${Date.now()}`, platform: 'twitch', ts: Date.now(), kind: 'system', author: { id: '', name: '', badges: [] }, parts: [{ type: 'text', text: this.relogin }] })
    }
    this.sub = new EventSub({
      onSession: (id) => this.subscribeAll(id),
      onNotification: (type, id, e) => this.onEvent(type, id, e),
      onState: (s, detail) => this.ctx.status({ status: s, account: this.displayName, mentions: this.mentions, detail, relogin: this.relogin })
    })
    this.sub.start()
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = setInterval(() => void this.check(), CHECK_MS)
    // Twitch sends no notice when a message is pinned, so the pin is checked every 20 seconds.
    if (this.pinTimer) clearInterval(this.pinTimer)
    this.pinTimer = setInterval(() => void this.refreshPin(), 20000)
    void this.refreshPin()
    // Twitch sends no notice for new clips either.
    this.clips.start()
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

  /** Reads the pinned message and tells the app when it changes. */
  private async refreshPin(): Promise<void> {
    if (!this.userId) return
    const r = await this.helix('GET', '/chat/pins', { broadcaster_id: this.userId, moderator_id: this.userId }).catch(() => null)
    if (!r) return
    const p = r.data?.[0]
    const text = p ? (p.message?.text ?? p.text ?? (p.message?.fragments ?? []).map((f: any) => f.text).join('')) : ''
    const pinned = p ? { id: String(p.message_id ?? p.id), text, sender: p.sender_user_name ?? p.sender?.user_name ?? '', endsAt: p.ends_at ? Date.parse(p.ends_at) : undefined } : null
    const key = JSON.stringify(pinned)
    if (key === this.pinState) return
    this.pinState = key
    this.ctx.pinned?.(pinned)
  }

  /** Whether our own raid is counting down. */
  private raiding = false
  private raidEnd: ReturnType<typeof setTimeout> | undefined

  /**
   * Shows or ends the raid bar. While a raid counts down, Twitch's own chat page stays open out of
   * sight, so Raid Now can press Twitch's button there (Twitch's API can't send a raid early).
   */
  private setRaid(r: RaidInfo | null): void {
    this.raiding = !!r
    this.ctx.raid?.(r)
    void core.raidPage(!!r, this.channelLogin()).catch(() => {})
    // If Twitch's notice of the raid going out never arrives, it still ends after the countdown.
    clearTimeout(this.raidEnd)
    if (r) this.raidEnd = setTimeout(() => this.setRaid(null), Math.max(0, r.endsAt - Date.now()) + 30_000)
  }

  /** Twitch's typed chat commands, run through the API. */
  async command(text: string): Promise<CommandOutcome | null> {
    if (!this.userId) return { ok: false, message: 'Log in to Twitch to use Twitch commands.' }
    if (/^\/raidnow$/i.test(text.trim())) {
      if (!this.raiding) return { ok: false, message: 'No raid is counting down. Start one with /raid channel.' }
      const r = await core.raidNow(this.channelLogin())
      // The bar stays until Twitch reports the raid, and goes then.
      return { ok: r.ok, message: r.message }
    }
    const send = async (message: string): Promise<string | undefined> => {
      const r = await this.helix('POST', '/chat/messages', undefined, { broadcaster_id: this.userId, sender_id: this.userId, message })
      const res = r?.data?.[0]
      if (res && !res.is_sent) throw new Error(res.drop_reason?.message ?? 'Twitch dropped the message.')
      return res?.message_id
    }
    const result = await runTwitchCommand(this.helix, this.userId, text, send)
    if (result?.pinned) setTimeout(() => void this.refreshPin(), 800)
    if (result && result.raid !== undefined) this.setRaid(result.raid)
    return result
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
  /** Followers and subscribers. Channels that can't have subs (not Affiliate) just have no sub count. */
  async stats(): Promise<ChannelStats> {
    const b = this.userId
    if (!b) return {}
    const total = (r: any): number | undefined => (typeof r?.total === 'number' ? r.total : undefined)
    const [follows, subs] = await Promise.all([
      this.helix('GET', '/channels/followers', { broadcaster_id: b, first: '1' }).catch(() => null),
      this.helix('GET', '/subscriptions', { broadcaster_id: b, first: '1' }).catch(() => null)
    ])
    return { followers: total(follows), subscribers: total(subs) }
  }

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
    if (this.pinTimer) clearInterval(this.pinTimer)
    this.pinTimer = null
    this.clips.stop()
    for (const w of this.suspicious.values()) clearTimeout(w.timer)
    this.suspicious.clear()
    this.sub?.stop()
    this.sub = null
  }

  async login(): Promise<void> {
    const run = ++this.loginRun
    this.ctx.status({ status: 'authorizing' })
    // A login already waiting (the user asked for a new code) is cancelled first.
    await core.cancelLogin('twitch').catch(() => {})
    const unlisten = await onDeviceCode(({ service, code, url }) => {
      if (service !== 'twitch' || run !== this.loginRun) return
      this.ctx.status({ status: 'authorizing', device: { code, url } })
      void core.openUrl(url)
    })
    try {
      await core.login('twitch')
    } catch (err) {
      if (run === this.loginRun) this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    } finally {
      unlisten()
    }
    await this.stop()
    await this.start()
  }

  async logout(): Promise<void> {
    await this.stop()
    this.loggedIn = false
    this.userId = this.login_ = ''
    this.emoteCache = null
    await core.logout('twitch')
    this.ctx.status({ status: 'needs-login' })
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
    if (!this.loggedIn) return
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
      // Only shoutouts given in this channel. Shoutouts other channels give this one aren't events here.
      ['channel.shoutout.create', '1', mod],
      ['channel.hype_train.begin', '2', b], ['channel.hype_train.progress', '2', b], ['channel.hype_train.end', '2', b],
      ['channel.poll.begin', '1', b], ['channel.poll.end', '1', b],
      ['channel.prediction.begin', '1', b], ['channel.prediction.lock', '1', b], ['channel.prediction.end', '1', b],
      ['channel.goal.begin', '1', b], ['channel.goal.end', '1', b],
      ['channel.ad_break.begin', '1', b],
      ['stream.online', '1', b], ['stream.offline', '1', b],
      // Held messages and suspicious users, for the moderator (here, the streamer).
      ['automod.message.hold', '2', mod], ['automod.message.update', '2', mod],
      ['channel.suspicious_user.message', '1', mod],
      ['channel.channel_points_custom_reward.add', '1', b], ['channel.channel_points_custom_reward.update', '1', b], ['channel.channel_points_custom_reward.remove', '1', b]
    ]
    const results = await Promise.allSettled(subs.map(([type, version, condition]) =>
      this.helix('POST', '/eventsub/subscriptions', undefined, { type, version, condition, transport: { method: 'websocket', session_id: sessionId } })))
    // Some types need Affiliate status; only the chat subscription is essential.
    results.forEach((r, i) => {
      if (r.status === 'rejected') log('twitch', `${subs[i][0]}: ${message(r.reason)}`)
    })
    if (results[0].status === 'rejected') throw results[0].reason
  }

  private onEvent(type: string, id: string, e: any): void {
    switch (type) {
      case 'channel.chat.message': {
        if (store.settings.showPronouns) this.pronouns.request(e.chatter_user_login)
        const m = chatMessage(e, this.badges, this.third, this.cheers)
        // Its suspicious-user warning may have come first.
        const waiting = this.suspicious.get(m.id)
        if (waiting) {
          clearTimeout(waiting.timer)
          this.suspicious.delete(m.id)
          m.flag = waiting.flag
        }
        return this.ctx.message(m)
      }
      case 'automod.message.hold':
        return this.ctx.message(heldMessage(e, this.third, this.cheers))
      case 'automod.message.update': {
        const status = heldStatus(e.status)
        if (status) this.ctx.patch(heldRowId(String(e.message_id)), (m) => ({ held: { ...m.held!, status, by: e.moderator_user_name || undefined } }))
        return
      }
      case 'channel.suspicious_user.message':
        return this.onSuspicious(e)
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
      case 'channel.raid':
        // Our own raid went out: the countdown bar is done.
        if (e.from_broadcaster_user_id === this.userId) this.setRaid(null)
        break
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

  /**
   * Twitch's warning about a suspicious user's message. It goes on the chat message with the
   * same id; when that message doesn't come (restricted users), the warning shows it itself.
   */
  private onSuspicious(e: any): void {
    const flag = suspiciousFlag(e)
    const id = String(e.message?.message_id ?? '')
    if (!flag || !id) return
    if (this.ctx.patch(id, () => ({ flag }))) return
    const timer = setTimeout(() => {
      this.suspicious.delete(id)
      if (!this.ctx.patch(id, () => ({ flag }))) this.ctx.message(suspiciousMessage(e, flag, this.third, this.cheers))
    }, SUSPICIOUS_WAIT_MS)
    this.suspicious.set(id, { flag, timer })
  }

  /** Allow or Deny on a held message. The row updates at once; Twitch's own notice follows. */
  async automod(rowId: string, allow: boolean): Promise<ActionResult> {
    const msgId = rowId.replace(/^held:/, '')
    try {
      await this.helix('POST', '/moderation/automod/message', undefined, { user_id: this.userId, msg_id: msgId, action: allow ? 'ALLOW' : 'DENY' })
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) {
        // Already handled by someone else, or too old: Twitch says which in its message.
        return { ok: false, message: `Twitch couldn't ${allow ? 'allow' : 'deny'} it: ${message(err)}` }
      }
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        return { ok: false, message: 'Log in to Twitch again so the app can review held messages.' }
      }
      throw err
    }
    this.ctx.patch(rowId, (m) => ({ held: { ...m.held!, status: allow ? 'allowed' : 'denied', by: this.displayName } }))
    return { ok: true }
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
    if (!this.loggedIn) return []
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
    if (!this.loggedIn) return []
    return buildActions(this.helix, this.userId)
  }

  async runAction(actionId: string, args: Record<string, string>): Promise<ActionResult> {
    const r = await runTwitchAction(this.helix, this.userId, actionId, args)
    if (r.raid !== undefined) this.setRaid(r.raid)
    if (actionId === 'reward.create') await this.loadManageable()
    // Twitch needs a few seconds to finish a new clip, so look for it soon rather than in a minute.
    if (actionId === 'clip' && r.ok) for (const wait of [15000, 35000]) setTimeout(() => void this.clips.check(true), wait)
    return r
  }
}

/** Twitch writes VOD lengths like "3h2m10s". */
function durationSeconds(d: string | undefined): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d ?? '')
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

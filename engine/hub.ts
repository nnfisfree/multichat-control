import type { AlertContext } from './integrations/alerts'
import type { Connector, ConnectorContext } from './platforms/connector'
import { eventToMessage } from '../shared/events'
import { plainText, serializeFor } from '../shared/parts'
import { spamReasons } from '../shared/spam'
import type {
  ActionResult, AlertSource, ChannelStats, ChatMessage, CommandOutcome, PinnedMessage, PlatformUsers, RaidInfo, UserCard, UserEntry, UserGroups, UserProfile, UsersInfo, ConnectionState, Emote, HubBatch, HypeTrain, IntegrationState, ModerationRequest, Platform, SendResult, StreamEvent
} from '../shared/types'
import { PLATFORMS } from '../shared/types'
import { isReloginNotice, reloginDone } from '../shared/relogin'
import { log } from './log'
import { message } from './net'
import { store } from './store'

const MAX_MESSAGES = 3000
const MAX_EVENTS = 1500
const FLUSH_MS = 60
/** The same sub or raid reported by Twitch and by an alert service lands within this window. */
const TWIN_MS = 120000

const sameKind = (t: string): string => (t === 'bits' ? 'cheer' : t)

/** Saves chat for past streams, and finds one user's saved messages for the user card. */
interface Recorder {
  add(m: ChatMessage): void
  deleted(id: string): void
  purged(platform: Platform, userId?: string): void
  messagesBy?(platform: Platform, userId: string): { messages: ChatMessage[]; streams: Set<string>; total: number }
  sessions?(): { id: string }[]
}

/** Merges connectors into one stream and batches updates so busy chats don't flood the UI. */
export class Hub {
  private connectors = new Map<Platform, Connector>()
  private statuses = new Map<Platform, ConnectionState>()
  private integrations = new Map<AlertSource, IntegrationState>()
  private messages: ChatMessage[] = []
  private events: StreamEvent[] = []
  private pronouns: Record<string, string> = {}
  private hype: HypeTrain | null = null
  private pinned: PinnedMessage | null = null
  private raid: RaidInfo | null = null
  private pending: HubBatch = emptyBatch()
  private timer: ReturnType<typeof setTimeout> | null = null
  private sendBatch: ((batch: HubBatch) => void) | null = null
  private eventIds = new Set<string>()
  /** Everyone who chatted this stream, per platform, with their role. */
  private seen = new Map<Platform, Map<string, { entry: UserEntry; role: keyof UserGroups }>>()
  private recorder: Recorder | null = null
  private removed = new Set<string>()
  private persistRemoved: ((ids: string[]) => void) | null = null
  private persist: ((events: StreamEvent[]) => void) | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  register(connector: Connector): void {
    this.connectors.set(connector.platform, connector)
  }

  /** Where batches go: the interface. */
  attach(send: (batch: HubBatch) => void): void {
    this.sendBatch = send
  }

  /** Events from earlier sessions. They load before the window, so the first snapshot has them. */
  restoreEvents(events: StreamEvent[], persist: (events: StreamEvent[]) => void): void {
    this.persist = persist
    this.events = [...events].sort((a, b) => a.ts - b.ts).slice(-MAX_EVENTS)
    this.eventIds = new Set(this.events.map((e) => e.id))
  }

  /** Events the user removed earlier. They stay out even when history reloads them. */
  restoreRemoved(ids: string[], persist: (ids: string[]) => void): void {
    this.removed = new Set(ids)
    this.persistRemoved = persist
    this.events = this.events.filter((e) => !this.removed.has(e.id))
    this.eventIds = new Set(this.events.map((e) => e.id))
  }

  /** Removes events from the list for good, such as test redemptions. */
  removeEvents(ids: string[]): void {
    const gone = new Set(ids.filter((id) => typeof id === 'string'))
    if (!gone.size) return
    for (const id of gone) {
      this.removed.add(id)
      this.eventIds.delete(id)
    }
    this.events = this.events.filter((e) => !gone.has(e.id))
    this.persistRemoved?.([...this.removed])
    this.persistSoon()
  }

  private persistSoon(): void {
    if (!this.persist) return
    this.persistTimer ??= setTimeout(() => {
      this.persistTimer = null
      this.persist?.(this.events)
    }, 3000)
  }

  /** Saves chat for the history of past streams. */
  record(recorder: Recorder): void {
    this.recorder = recorder
  }

  /** Empties the chat kept in memory, as part of clearing the history. */
  clearMessages(): void {
    this.messages = []
  }

  private noteChatter(m: ChatMessage): void {
    if (m.kind === 'event' || m.kind === 'system' || !m.author.id) return
    let list = this.seen.get(m.platform)
    if (!list) this.seen.set(m.platform, (list = new Map()))
    const a = m.author
    const role: keyof UserGroups = a.isBroadcaster ? 'broadcaster' : a.isMod ? 'moderators' : a.isVip ? 'vips' : a.isMember ? 'members' : 'users'
    list.delete(a.id)
    list.set(a.id, { entry: { id: a.id, name: a.name, login: a.login, color: a.color }, role })
    // The oldest chatters drop off first, so a huge stream can't grow this without limit.
    if (list.size > 5000) list.delete(list.keys().next().value!)
  }

  /** Everything known about one user: their profile and their history in this channel. */
  async userCard(platform: Platform, user: UserEntry): Promise<UserCard> {
    const c = this.connectors.get(platform)
    const profile: UserProfile = c?.profile ? await c.profile(user).catch((): UserProfile => ({})) : {}
    const live = this.messages.filter((m) => m.platform === platform && m.author.id === user.id && m.kind !== 'event' && m.kind !== 'system' && !m.divider && !m.held)
    const saved = this.recorder?.messagesBy?.(platform, user.id)
    // Messages from this stream are also in the saved file, so each message counts once.
    const seen = new Set<string>()
    const all = [...(saved?.messages ?? []), ...live].filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => b.ts - a.ts)
    const ofStreams = Math.max(1, this.recorder?.sessions?.().length ?? 0)
    const name = user.name.toLowerCase()
    const mod = this.events.filter((e) => e.platform === platform && e.type === 'moderation' && e.text.toLowerCase().endsWith(` ${name}`))
    const latest = all[0]?.author
    return {
      platform, id: user.id, name: latest?.name ?? user.name, login: user.login ?? latest?.login, color: user.color ?? latest?.color,
      ...profile,
      messages: all.slice(0, 1000),
      total: all.length,
      firstSeen: all.at(-1)?.ts,
      streams: Math.max(saved?.streams.size ?? 0, live.length ? 1 : 0),
      ofStreams,
      deleted: all.filter((m) => m.deleted).length,
      timeouts: mod.filter((e) => /timed out/i.test(e.text)).length,
      bans: mod.filter((e) => /\bbanned\b/i.test(e.text)).length
    }
  }

  /** The channel's followers and subscribers on one platform. */
  async stats(platform: Platform): Promise<ChannelStats | null> {
    const c = this.connectors.get(platform)
    return c?.stats ? c.stats().catch(() => null) : null
  }

  /** Who is in chat on one platform: the platform's own list where it has one, else who chatted. */
  async users(platform: Platform): Promise<PlatformUsers> {
    const seen = this.seen.get(platform) ?? new Map<string, { entry: UserEntry; role: keyof UserGroups }>()
    const groups: UserGroups = { broadcaster: [], moderators: [], vips: [], members: [], users: [] }
    for (const { entry, role } of seen.values()) groups[role].push(entry)
    const c = this.connectors.get(platform)
    const offline: UsersInfo = { live: false }
    const info: UsersInfo = c?.users ? await c.users().catch(() => offline) : offline
    if (info.groups) {
      // Names from the platform's list get the colours they use in chat.
      for (const g of Object.values(info.groups) as UserEntry[][]) for (const u of g) u.color ??= seen.get(u.id)?.entry.color
    }
    const sort = (g: UserGroups): UserGroups => {
      const out = { ...g }
      for (const k of Object.keys(out) as (keyof UserGroups)[]) out[k] = [...out[k]].sort((a, b) => a.name.localeCompare(b.name))
      return out
    }
    return { platform, ...info, source: info.groups ? 'chatters' : 'chat', groups: sort(info.groups ?? groups), updatedAt: Date.now() }
  }

  private addMessage(m: ChatMessage): void {
    this.markSpam(m)
    // A held message isn't in chat yet, and notices aren't chat: neither goes into the history.
    if (!m.held && m.kind !== 'system') {
      this.noteChatter(m)
      this.recorder?.add(m)
    }
    this.messages.push(m)
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES)
    this.pending.messages.push(m)
    this.schedule()
  }

  /**
   * Marks "buy followers" spam for moderators. The streamer, moderators and VIPs are never
   * marked, and a message Twitch already flagged keeps Twitch's warning.
   */
  private markSpam(m: ChatMessage): void {
    if (!store.settings.spamWarnings || m.flag || m.history || (m.kind !== 'chat' && m.kind !== 'action')) return
    const a = m.author
    if (a.isBroadcaster || a.isMod || a.isVip) return
    const notes = spamReasons(plainText(m.parts))
    if (notes) m.flag = { kind: 'spam', label: 'Looks like spam', notes }
  }

  /** Replaces a message in chat with a changed copy, so the interface redraws it. */
  private patchMessage(id: string, change: (m: ChatMessage) => Partial<ChatMessage>): boolean {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].id !== id) continue
      const next = { ...this.messages[i], ...change(this.messages[i]) }
      this.messages[i] = next
      ;(this.pending.updated ??= []).push(next)
      this.schedule()
      return true
    }
    return false
  }

  /**
   * True when another source already reported this event: Twitch and StreamElements both see
   * the same sub, for example. Only events from different sources can be twins.
   */
  private twin(e: StreamEvent): boolean {
    const actor = e.actor?.toLowerCase()
    if (!actor) return false
    for (let i = this.events.length - 1, n = 0; i >= 0 && n < 800; i--, n++) {
      const o = this.events[i]
      if ((o.source ?? '') === (e.source ?? '') || o.platform !== e.platform || sameKind(o.type) !== sameKind(e.type)) continue
      if (o.actor?.toLowerCase() === actor && Math.abs(o.ts - e.ts) < TWIN_MS) return true
    }
    return false
  }

  private addEvent(e: StreamEvent): void {
    // History can overlap saved and live events, so each event is shown once.
    if (this.eventIds.has(e.id) || this.removed.has(e.id) || this.twin(e)) return
    this.eventIds.add(e.id)
    // A new stream starts a fresh list of who chatted.
    if (e.type === 'stream' && !e.history && /went live/i.test(e.text)) this.seen.delete(e.platform)
    this.events.push(e)
    if (this.events.length > MAX_EVENTS) for (const old of this.events.splice(0, this.events.length - MAX_EVENTS)) this.eventIds.delete(old.id)
    this.persistSoon()
    this.pending.events.push(e)
    this.schedule()
    const card = eventToMessage(e)
    if (card) this.addMessage(card)
  }

  /** How StreamElements and Streamlabs report in. */
  alertContext(source: AlertSource): AlertContext {
    return {
      event: (e) => this.addEvent(e),
      status: (s) => {
        const state = { source, ...s }
        const before = this.integrations.get(source)
        if (before?.status !== state.status || before?.detail !== state.detail) log(source, `${state.status}${state.detail ? `: ${state.detail}` : ''}`)
        this.integrations.set(source, state)
        this.pending.integrations = [...(this.pending.integrations ?? []).filter((x) => x.source !== source), state]
        this.schedule()
      },
      home: () => {
        const live = (p: Platform): boolean => ['connected', 'waiting', 'reconnecting'].includes(this.statuses.get(p)?.status ?? '')
        return PLATFORMS.find(live) ?? 'twitch'
      }
    }
  }

  context(platform: Platform): ConnectorContext {
    return {
      message: (m) => this.addMessage(m),
      patch: (id, change) => this.patchMessage(id, change),
      event: (e) => this.addEvent(e),
      deleted: (id) => {
        this.recorder?.deleted(id)
        const m = this.messages.find((x) => x.id === id)
        if (m) m.deleted = true
        this.pending.deleted.push(id)
        this.schedule()
      },
      purged: (userId) => {
        this.recorder?.purged(platform, userId)
        for (const m of this.messages) if (m.platform === platform && (!userId || m.author.id === userId)) m.deleted = true
        this.pending.purged.push({ platform, userId })
        this.schedule()
      },
      hype: (train) => {
        this.hype = train
        this.pending.hype = train
        this.schedule()
      },
      pinned: (p) => {
        this.pinned = p
        this.pending.pinned = p
        this.schedule()
      },
      raid: (r) => {
        this.raid = r
        this.pending.raid = r
        this.schedule()
      },
      actionsChanged: () => {
        this.pending.actionsChanged = [...new Set([...(this.pending.actionsChanged ?? []), platform])]
        this.schedule()
      },
      pronoun: (login, label) => {
        this.pronouns[login] = label
        this.pending.pronouns[login] = label
        this.schedule()
      },
      status: (s) => {
        const state = { platform, ...s }
        const before = this.statuses.get(platform)
        if (before?.status !== state.status || before?.detail !== state.detail) log(platform, `${state.status}${state.detail ? `: ${state.detail}` : ''}`)
        this.statuses.set(platform, state)
        // A login with the missing permissions retires the "log in again" notices; the interface fades its copies.
        if (reloginDone(state)) this.messages = this.messages.filter((m) => !(m.platform === platform && isReloginNotice(m)))
        this.pending.statuses.push(state)
        this.schedule()
      }
    }
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null
      const batch = this.pending
      this.pending = emptyBatch()
      this.sendBatch?.(batch)
    }, FLUSH_MS)
  }

  /**
   * Everything so far, for the interface's start. The engine runs in the same page, so these are
   * copies: handing over the hub's own lists would let later messages land in the interface twice,
   * once through the shared list and once through the next batch.
   */
  snapshot() {
    return {
      statuses: PLATFORMS.map((p) => this.statuses.get(p) ?? ({ platform: p, status: 'disabled' } as ConnectionState)),
      messages: [...this.messages],
      events: [...this.events],
      pronouns: { ...this.pronouns },
      hype: this.hype,
      integrations: [...this.integrations.values()],
      pinned: this.pinned,
      raid: this.raid
    }
  }

  get(platform: Platform): Connector {
    const c = this.connectors.get(platform)
    if (!c) throw new Error(`${platform} is not available.`)
    return c
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.connectors.values()].map((c) => c.start().catch((err) => {
      // A login that ended during start already says so; that clearer message is kept.
      if (this.statuses.get(c.platform)?.status === 'needs-login') return
      this.context(c.platform).status({ status: 'error', detail: message(err) })
    })))
  }

  async refreshEmotes(): Promise<void> {
    await Promise.allSettled([...this.connectors.values()].map((c) => c.refreshEmotes()))
  }

  async stopAll(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persist?.(this.events)
    await Promise.allSettled([...this.connectors.values()].map((c) => c.stop()))
  }

  /** Sends to each target independently, so one failing platform never blocks the others. */
  async send(targets: Platform[], text: string, replyTo?: { platform: Platform; messageId: string }): Promise<SendResult[]> {
    return Promise.all(targets.map(async (platform): Promise<SendResult> => {
      try {
        const c = this.get(platform)
        const emotes = platform === 'kick' ? await c.emotes().catch((): Emote[] => []) : []
        await c.send(serializeFor(platform, text, emotes), replyTo?.platform === platform ? replyTo.messageId : undefined)
        return { platform, ok: true }
      } catch (err) {
        return { platform, ok: false, error: message(err) }
      }
    }))
  }

  /** Runs a Twitch chat command. */
  async twitchCommand(text: string): Promise<CommandOutcome> {
    const c = this.connectors.get('twitch')
    if (!c?.command) return { ok: false, message: 'Log in to Twitch to use Twitch commands.' }
    try {
      return (await c.command(text)) ?? { ok: false, message: `Unknown command: ${text.split(/\s+/)[0]}. Click the / button to see the list.` }
    } catch (err) {
      const m = message(err)
      return { ok: false, message: /scope|permission|unauthorized/i.test(m) ? `${m} Log in to Twitch again so the app gets the newer permissions.` : m }
    }
  }

  async moderate(platform: Platform, req: ModerationRequest): Promise<ActionResult> {
    try {
      // Kick only times out in whole minutes, so a short timeout (used to clear someone's
      // messages) deletes their recent messages one by one instead.
      if (platform === 'kick' && req.kind === 'timeout' && req.seconds < 60) {
        const theirs = this.messages.filter((m) => m.platform === 'kick' && m.author.id === req.userId && m.kind !== 'event' && !m.deleted).slice(-50)
        const c = this.get(platform)
        let done = 0
        for (const m of theirs) if ((await c.moderate({ kind: 'delete', messageId: m.id }).catch(() => ({ ok: false }))).ok) done++
        return { ok: done > 0 || theirs.length === 0, message: theirs.length ? `Deleted ${done} message${done === 1 ? '' : 's'} from ${req.userName} on Kick.` : `${req.userName} has no messages to clear.` }
      }
      return await this.get(platform).moderate(req)
    } catch (err) {
      return { ok: false, message: message(err) }
    }
  }

  /** Allow or Deny on a message Twitch's AutoMod held. */
  async automod(messageId: string, allow: boolean): Promise<ActionResult> {
    const c = this.connectors.get('twitch')
    if (!c?.automod) return { ok: false, message: 'Log in to Twitch to review held messages.' }
    try {
      return await c.automod(messageId, allow)
    } catch (err) {
      return { ok: false, message: message(err) }
    }
  }

  async runAction(platform: Platform, actionId: string, args: Record<string, string>): Promise<ActionResult> {
    try {
      return await this.get(platform).runAction(actionId, args)
    } catch (err) {
      return { ok: false, message: message(err) }
    }
  }
}

function emptyBatch(): HubBatch {
  return { messages: [], events: [], deleted: [], purged: [], statuses: [], pronouns: {} }
}

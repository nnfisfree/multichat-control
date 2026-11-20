import type { ActionDef, ActionResult, ChannelStats, Emote, ModerationRequest, UserEntry, UserProfile, UsersInfo } from '../../../shared/types'
import { core, onTikTok, type TikTokEndCode, type TikTokRoom } from '../../core'
import { log } from '../../log'
import { message } from '../../net'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { GiftStreaks, LikeTally } from './gifts'
import { tiktokEvent, toEvent, toMessage, type TikTokItem } from './normalize'

/** How often we look whether the streamer went live. Uses TikTok's own page, not the Euler key. */
const OFFLINE_POLL_MS = 60_000
/** Euler's per-key limit was hit: don't spend more attempts for a while. */
const LIMIT_WAIT_MS = 15 * 60_000
const LIKE_FLUSH_MS = 30_000

export const READ_ONLY_TEXT = 'TikTok is read-only for now: its chat and gifts show here, but messages can only be sent to the other platforms.'

/**
 * TikTok LIVE, read-only. There's no login: the streamer types their @username and pastes a free
 * Euler Stream key (it signs the connection, see core/src/tiktok). While they're offline we check
 * every minute whether they went live, and join on our own when they do.
 */
export class TikTokConnector implements Connector {
  readonly platform = 'tiktok' as const
  private run = 0
  private conn: number | null = null
  private room: TikTokRoom | null = null
  private roomAt = 0
  private viewers?: number
  private seen = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private likeTimer: ReturnType<typeof setInterval> | null = null
  private failures = 0
  // items that arrive before Rust has told us the id of the connection they belong to
  private early: { id: number; items: TikTokItem[] }[] = []
  private connecting = false
  private stops: (() => void)[] = []
  private gifts: GiftStreaks
  private likes: LikeTally

  constructor(private ctx: ConnectorContext) {
    this.gifts = new GiftStreaks((e) => ctx.event(e))
    this.likes = new LikeTally((e) => ctx.event(e))
  }

  private get handle(): string { return store.settings.tiktokUsername.trim().replace(/^@/, '') }

  private status(status: Parameters<ConnectorContext['status']>[0]['status'], detail?: string): void {
    const h = this.handle
    this.ctx.status({ status, detail, account: h ? `@${h}` : undefined, mentions: [h, this.room?.nickname].filter((x): x is string => !!x) })
  }

  private async listen(): Promise<void> {
    if (this.stops.length) return
    this.stops.push(
      await onTikTok.open(({ id }) => { if (id === this.conn) this.opened() }),
      await onTikTok.items(({ id, items }) => {
        if (id === this.conn) this.onItems(items)
        else if (this.connecting) this.early.push({ id, items })
      }),
      await onTikTok.end(({ id, code, message: text }) => { if (id === this.conn) void this.ended(code, text) })
    )
  }

  async start(): Promise<void> {
    const run = ++this.run
    if (!this.handle) return this.status('needs-setup', 'Add your TikTok @username in Settings → TikTok.')
    const secrets = await core.secretState()
    if (run !== this.run) return
    if (!secrets.tiktokKey) return this.status('needs-setup', 'Add your free Euler Stream key in Settings → TikTok.')
    await this.listen()
    this.likeTimer ??= setInterval(() => this.likes.flush(), LIKE_FLUSH_MS)
    await this.check(run)
  }

  /** Is the streamer live? If so join, if not look again in a minute. */
  private async check(run: number): Promise<void> {
    if (run !== this.run) return
    this.status('connecting', `Looking for @${this.handle}`)
    let room: TikTokRoom
    try {
      room = await core.tiktokRoom(this.handle)
    } catch (err) {
      if (run !== this.run) return
      // a wrong username won't fix itself, everything else is worth retrying
      if (/no TikTok account/i.test(message(err))) return this.status('needs-setup', message(err))
      this.status('reconnecting', `${message(err)} Trying again in a minute.`)
      return this.later(run, OFFLINE_POLL_MS)
    }
    if (run !== this.run) return
    this.room = room
    this.roomAt = Date.now()
    if (!room.live || !room.roomId) {
      this.viewers = undefined
      this.status('waiting', `Waiting for @${room.handle} to go live. Checking every minute.`)
      return this.later(run, OFFLINE_POLL_MS)
    }
    await this.join(run, room.roomId)
  }

  private later(run: number, ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.check(run) }, ms)
  }

  private async join(run: number, roomId: string): Promise<void> {
    this.status('connecting', 'Joining the LIVE')
    this.connecting = true
    this.early = []
    try {
      const id = await core.tiktokConnect(roomId)
      if (run !== this.run) return void core.tiktokDisconnect(id)
      this.conn = id
      for (const e of this.early) if (e.id === id) this.onItems(e.items)
    } finally {
      this.connecting = false
      this.early = []
    }
  }

  private opened(): void {
    this.failures = 0
    const room = this.room
    if (room?.roomId) this.ctx.event(tiktokEvent({ id: `tiktok-stream-${room.roomId}-on`, type: 'stream', text: 'Stream went live', subject: room.title }))
    this.status('connected', room?.title)
  }

  private async ended(code: TikTokEndCode, text: string): Promise<void> {
    const run = this.run
    this.conn = null
    this.gifts.flush()
    this.likes.flush()
    log('tiktok', `connection ended (${code}): ${text}`)
    switch (code) {
      case 'offline':
        if (this.room?.roomId) this.ctx.event(tiktokEvent({ id: `tiktok-stream-${this.room.roomId}-off`, type: 'stream', text: 'Stream went offline' }))
        this.viewers = undefined
        this.likes.reset()
        this.status('waiting', `Stream ended. Waiting for @${this.handle} to go live again.`)
        return this.later(run, OFFLINE_POLL_MS)
      case 'key':
        return this.status('needs-setup', text)
      case 'limit':
        this.status('error', `${text} Trying again in 15 minutes.`)
        return this.later(run, LIMIT_WAIT_MS)
      default: {
        // each attempt costs one Euler request, so back off: 10 s, 20 s, 40 s, then every minute
        const wait = Math.min(OFFLINE_POLL_MS, 10_000 * 2 ** this.failures++)
        this.status('reconnecting', `${text || 'Connection lost.'} Reconnecting in ${Math.round(wait / 1000)} s.`)
        return this.later(run, wait)
      }
    }
  }

  private onItems(items: TikTokItem[]): void {
    for (const it of items) {
      // replays after a reconnect: same message ids again
      if (it.id && it.kind !== 'gift' && it.kind !== 'like') {
        if (this.seen.has(it.id)) continue
        this.seen.add(it.id)
        if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500))
      }
      try {
        switch (it.kind) {
          case 'chat':
          case 'emote': {
            const m = toMessage(it)
            if (m) this.ctx.message(m)
            break
          }
          case 'gift': this.gifts.push(it); break
          case 'like': this.likes.push(it); break
          case 'viewers': if (typeof it.viewers === 'number') this.viewers = it.viewers; break
          default: {
            const e = toEvent(it)
            if (e) this.ctx.event(e)
          }
        }
      } catch (err) {
        log('tiktok', `couldn't read a ${it.kind} item: ${message(err)}`)
      }
    }
  }

  async stop(): Promise<void> {
    this.run++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.likeTimer) clearInterval(this.likeTimer)
    this.likeTimer = null
    this.gifts.flush()
    this.likes.flush()
    if (this.conn !== null) await core.tiktokDisconnect(this.conn).catch(() => {})
    this.conn = null
  }

  /** There's no TikTok login; Settings → TikTok saves the username and key, then this reconnects. */
  async login(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async logout(): Promise<void> {
    await this.stop()
    this.room = null
    this.viewers = undefined
    this.likes.reset()
    this.status('needs-setup', 'Add your TikTok @username in Settings → TikTok.')
  }

  async send(): Promise<void> {
    throw new Error(READ_ONLY_TEXT)
  }

  async moderate(_req: ModerationRequest): Promise<ActionResult> {
    return { ok: false, message: 'TikTok moderation isn\'t supported yet.' }
  }

  async emotes(): Promise<Emote[]> { return [] }
  async actions(): Promise<ActionDef[]> { return [] }
  async runAction(): Promise<ActionResult> { return { ok: false, message: 'TikTok has no quick actions yet.' } }
  async refreshEmotes(): Promise<void> {}

  async users(): Promise<UsersInfo> {
    return { live: this.conn !== null, viewers: this.conn !== null ? this.viewers : undefined }
  }

  /** Followers come with the live check; re-read every few minutes while connected. */
  async stats(): Promise<ChannelStats> {
    if (this.handle && Date.now() - this.roomAt > 5 * 60_000) {
      this.roomAt = Date.now()
      const r = await core.tiktokRoom(this.handle).catch(() => null)
      if (r && this.room) this.room = { ...this.room, followers: r.followers }
    }
    return { followers: this.room?.followers }
  }

  async profile(user: UserEntry): Promise<UserProfile> {
    const login = user.login ?? ''
    return /^[\w.]+$/.test(login) ? { url: `https://www.tiktok.com/@${login}` } : {}
  }
}

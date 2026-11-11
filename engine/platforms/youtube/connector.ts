import type { ActionDef, ActionResult, ChannelStats, Emote, ModerationRequest, UserEntry, UserProfile, UsersInfo } from '../../../shared/types'
import { core } from '../../core'
import { emojiSet } from '../../emotes/emoji'
import { api, HttpError, message, sleep } from '../../net'
import type { Connector, ConnectorContext } from '../connector'
import { normalize } from './normalize'
import { GRPC_ENDED, GRPC_UNAUTHENTICATED, openStream } from './stream'

const API = 'https://www.googleapis.com/youtube/v3'
/** Checking for a broadcast costs quota, so offline checks stay slow. */
const OFFLINE_CHECK_MS = 90000
/** Older items are history replayed on connect, not new chat. */
const REPLAY_GRACE_MS = 30000

export class YouTubeConnector implements Connector {
  readonly platform = 'youtube' as const
  private loggedIn = false
  private channelName = ''
  private mentions: string[] = []
  private liveChatId = ''
  private run = 0
  private cancelStream: (() => void) | null = null

  constructor(private ctx: ConnectorContext) {}

  /** A request as the user's YouTube account; the core adds and renews the token. */
  private async api(method: string, path: string, query: Record<string, string>, body?: unknown): Promise<any> {
    if (!this.loggedIn) throw new Error('Not logged in to YouTube.')
    return api('youtube', method, `${API}${path}?${new URLSearchParams(query)}`, body)
  }

  /** The core found the login gone (revoked or expired): stop and ask for a new one. */
  async loginEnded(): Promise<void> {
    if (!this.loggedIn) return
    this.loggedIn = false
    await this.stop()
    this.ctx.status({ status: 'needs-login', detail: 'Your YouTube login expired. If this repeats weekly, publish your Google app (see setup guide).' })
  }

  async start(): Promise<void> {
    const state = await core.authState('youtube')
    if (!state.configured) return this.ctx.status({ status: 'needs-setup' })
    if (!state.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.loggedIn = true
    this.ctx.status({ status: 'connecting' })
    const me = await this.api('GET', '/channels', { part: 'snippet', mine: 'true' })
    const mine = me.items?.[0]?.snippet
    this.channelName = mine?.title ?? 'YouTube'
    // Viewers tag a channel by its @handle (customUrl), or sometimes by its name.
    this.mentions = [String(mine?.customUrl ?? '').replace(/^@/, ''), mine?.title ?? ''].filter(Boolean)
    void this.loop(++this.run)
    void this.loadPastBroadcasts()
  }

  /** YouTube keeps no event history outside a live chat, but it does list past broadcasts. */
  private async loadPastBroadcasts(): Promise<void> {
    const r = await this.api('GET', '/liveBroadcasts', { part: 'snippet', broadcastStatus: 'completed', broadcastType: 'all', maxResults: '20' }).catch(() => null)
    for (const b of r?.items ?? []) {
      const s = b.snippet ?? {}
      const start = Date.parse(s.actualStartTime)
      const end = Date.parse(s.actualEndTime)
      if (start) this.ctx.event({ id: `yt-stream-${b.id}-on`, platform: 'youtube', ts: start, type: 'stream', text: 'Stream went live', subject: s.title || undefined, details: {}, history: true })
      if (end) this.ctx.event({ id: `yt-stream-${b.id}-off`, platform: 'youtube', ts: end, type: 'stream', text: 'Stream went offline', details: {}, history: true })
    }
  }

  /** Channel picture and age for the user card (1 quota unit). YouTube shares nothing about follows. */
  async profile(user: UserEntry): Promise<UserProfile> {
    const r = await this.api('GET', '/channels', { part: 'snippet', id: user.id }).catch(() => null)
    const s = r?.items?.[0]?.snippet
    return {
      avatar: s?.thumbnails?.default?.url,
      createdAt: Date.parse(s?.publishedAt) || undefined,
      about: s?.description || undefined,
      url: `https://www.youtube.com/channel/${encodeURIComponent(user.id)}`
    }
  }

  private broadcastId = ''
  private viewerCache: { at: number; info: UsersInfo } | null = null

  /** YouTube lists no viewers, only how many are watching. Checked at most once a minute (1 quota unit). */
  /**
   * Subscribers. YouTube rounds the count to three significant figures. Members can't be counted:
   * Google only opens that list to creators it approves.
   */
  async stats(): Promise<ChannelStats> {
    const s = (await this.api('GET', '/channels', { part: 'statistics', mine: 'true' })).items?.[0]?.statistics
    const n = Number(s?.subscriberCount)
    return Number.isFinite(n) && s?.subscriberCount !== undefined ? { subscribers: n, rounded: true } : {}
  }

  async users(): Promise<UsersInfo> {
    if (!this.liveChatId || !this.broadcastId) return { live: false }
    if (this.viewerCache && Date.now() - this.viewerCache.at < 60000) return this.viewerCache.info
    const r = await this.api('GET', '/videos', { part: 'liveStreamingDetails', id: this.broadcastId }).catch(() => null)
    const n = Number(r?.items?.[0]?.liveStreamingDetails?.concurrentViewers)
    const info: UsersInfo = { live: true, viewers: Number.isFinite(n) ? n : undefined }
    this.viewerCache = { at: Date.now(), info }
    return info
  }

  async stop(): Promise<void> {
    this.run++
    this.cancelStream?.()
    this.cancelStream = null
    this.liveChatId = ''
  }

  /** Waits for a broadcast, follows its chat until it ends, then waits again. */
  private async loop(run: number): Promise<void> {
    while (run === this.run) {
      try {
        const r = await this.api('GET', '/liveBroadcasts', { part: 'snippet', broadcastStatus: 'active', broadcastType: 'all' })
        const id = r.items?.[0]?.snippet?.liveChatId
        this.broadcastId = r.items?.[0]?.id ?? ''
        if (!id) {
          this.liveChatId = ''
          this.ctx.status({ status: 'waiting', account: this.channelName, mentions: this.mentions, detail: 'Waiting for a live broadcast' })
          await sleep(OFFLINE_CHECK_MS)
          continue
        }
        this.liveChatId = id
        this.ctx.status({ status: 'connected', account: this.channelName, mentions: this.mentions })
        await this.follow(id, run)
      } catch (err) {
        if (run !== this.run) return
        const quota = err instanceof HttpError && /quota/i.test(err.message)
        this.ctx.status({ status: 'reconnecting', account: this.channelName, mentions: this.mentions, detail: quota ? 'YouTube daily quota used up. It resets at midnight Pacific Time.' : message(err) })
        await sleep(quota ? 600000 : 30000)
      }
    }
  }

  private handle(items: any[], since: number): boolean {
    let ended = false
    for (const item of items) {
      const r = normalize(item)
      const fresh = Date.parse(item.snippet?.publishedAt) >= since
      if (r.message && fresh) this.ctx.message(r.message)
      if (r.event) this.ctx.event(fresh ? r.event : { ...r.event, history: true })
      if (r.deleted) this.ctx.deleted(r.deleted)
      if (r.purgedUser) this.ctx.purged(r.purgedUser)
      ended ||= !!r.ended
    }
    return ended
  }

  private async follow(liveChatId: string, run: number): Promise<void> {
    const since = Date.now() - REPLAY_GRACE_MS
    let pageToken: string | undefined
    let failures = 0
    while (run === this.run) {
      const outcome = await new Promise<'ended' | 'retry' | 'unsupported'>((resolve) => {
        this.cancelStream = openStream(liveChatId, pageToken, {
          onItems: (items, next) => {
            failures = 0
            pageToken = next ?? pageToken
            if (this.handle(items, since)) {
              this.cancelStream?.()
              resolve('ended')
            }
          },
          onEnd: (err) => {
            if (err?.code === GRPC_ENDED) resolve('ended')
            // The core already tried renewing the login; if it's gone, the app is told separately.
            else if (err?.code === GRPC_UNAUTHENTICATED) resolve(this.loggedIn ? 'retry' : 'ended')
            else {
              if (err) failures++
              resolve(failures >= 3 ? 'unsupported' : 'retry')
            }
          }
        })
      })
      this.cancelStream = null
      if (outcome === 'ended') return
      if (outcome === 'unsupported') return this.poll(liveChatId, run, pageToken, since)
      if (run === this.run) await sleep(1000 * (failures + 1))
    }
  }

  /** REST fallback for networks that block gRPC. Costs more quota, so it uses YouTube's own interval. */
  private async poll(liveChatId: string, run: number, pageToken: string | undefined, since: number): Promise<void> {
    while (run === this.run) {
      const r = await this.api('GET', '/liveChat/messages', { liveChatId, part: 'id,snippet,authorDetails', ...(pageToken ? { pageToken } : {}) })
      pageToken = r.nextPageToken
      if (this.handle(r.items ?? [], since) || r.offlineAt) return
      await sleep(Math.max(r.pollingIntervalMillis ?? 5000, 5000))
    }
  }

  async login(): Promise<void> {
    this.ctx.status({ status: 'authorizing', detail: 'Finish signing in in your browser' })
    try {
      await core.login('youtube')
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
    await core.logout('youtube')
    this.ctx.status({ status: 'needs-login' })
  }

  private chatId(): string {
    if (!this.liveChatId) throw new Error('YouTube has no live chat right now. Start a broadcast first.')
    return this.liveChatId
  }

  async send(text: string): Promise<void> {
    // YouTube's limit is 200 characters, and failing clearly beats silently cutting a message.
    if ([...text].length > 200) throw new Error('YouTube messages are limited to 200 characters.')
    await this.api('POST', '/liveChat/messages', { part: 'snippet' }, {
      snippet: { liveChatId: this.chatId(), type: 'textMessageEvent', textMessageDetails: { messageText: text } }
    })
  }

  async moderate(req: ModerationRequest): Promise<ActionResult> {
    if (req.kind === 'delete') {
      await this.api('DELETE', '/liveChat/messages', { id: req.messageId })
      return { ok: true }
    }
    if (req.kind === 'shoutout') return { ok: false, message: 'YouTube has no shoutout feature.' }
    const temporary = req.kind === 'timeout'
    await this.api('POST', '/liveChat/bans', { part: 'snippet' }, {
      snippet: {
        liveChatId: this.chatId(), type: temporary ? 'temporary' : 'permanent',
        ...(temporary ? { banDurationSeconds: req.seconds } : {}),
        bannedUserDetails: { channelId: req.userId }
      }
    })
    return { ok: true }
  }

  async refreshEmotes(): Promise<void> {}

  async emotes(): Promise<Emote[]> {
    return emojiSet('youtube')
  }

  async actions(): Promise<ActionDef[]> {
    return []
  }

  async runAction(): Promise<ActionResult> {
    return { ok: false, message: 'YouTube has no quick actions yet.' }
  }
}

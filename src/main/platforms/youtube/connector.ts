import type { ActionDef, ActionResult, Emote, ModerationRequest } from '../../../shared/types'
import { loopbackLogin } from '../../auth/loopback-pkce'
import { credentials, type AppCredentials } from '../../credentials'
import { emojiSet } from '../../emotes/emoji'
import { errorText, fetchJson, HttpError, message, readBody, sleep } from '../../net'
import { store } from '../../store'
import type { Connector, ConnectorContext } from '../connector'
import { normalize } from './normalize'
import { GRPC_ENDED, GRPC_UNAUTHENTICATED, openStream } from './stream'

const API = 'https://www.googleapis.com/youtube/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl'
/** Checking for a broadcast costs quota, so offline checks stay slow. */
const OFFLINE_CHECK_MS = 90000
/** Older items are history replayed on connect, not new chat. */
const REPLAY_GRACE_MS = 30000

interface Tokens { access: string; refresh: string; expiresAt: number }

export class YouTubeConnector implements Connector {
  readonly platform = 'youtube' as const
  private tokens: Tokens | null = null
  private channelName = ''
  private liveChatId = ''
  private run = 0
  private cancelStream: (() => void) | null = null

  constructor(private ctx: ConnectorContext) {}

  private creds(): AppCredentials | null {
    return credentials('youtube')
  }

  private save(t: Tokens | null): void {
    this.tokens = t
    store.setSecret('youtube.tokens', t ? JSON.stringify(t) : undefined)
  }

  private async refresh(): Promise<void> {
    const c = this.creds()
    if (!c || !this.tokens) throw new Error('Not logged in to YouTube.')
    try {
      const r = await fetchJson(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: this.tokens.refresh, grant_type: 'refresh_token' }).toString()
      })
      this.save({ access: r.access_token, refresh: r.refresh_token ?? this.tokens.refresh, expiresAt: Date.now() + r.expires_in * 1000 })
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) {
        this.save(null)
        this.run++
        this.ctx.status({ status: 'needs-login', detail: 'Your YouTube login expired. If this repeats weekly, publish your Google app (see setup guide).' })
      }
      throw err
    }
  }

  private async api(method: string, path: string, query: Record<string, string>, body?: unknown): Promise<any> {
    if (!this.tokens) throw new Error('Not logged in to YouTube.')
    if (Date.now() > this.tokens.expiresAt - 60000) await this.refresh()
    const url = `${API}${path}?${new URLSearchParams(query)}`
    const request = (): Promise<Response> => fetch(url, {
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
    if (!res.ok) throw new HttpError(res.status, errorText(data, `YouTube error ${res.status}`), data)
    return data
  }

  async start(): Promise<void> {
    if (!this.creds()) return this.ctx.status({ status: 'needs-setup', detail: 'Add your Google client ID and secret.' })
    const raw = store.getSecret('youtube.tokens')
    if (!raw) return this.ctx.status({ status: 'needs-login' })
    this.tokens = JSON.parse(raw)
    this.ctx.status({ status: 'connecting' })
    const me = await this.api('GET', '/channels', { part: 'snippet', mine: 'true' })
    this.channelName = me.items?.[0]?.snippet?.title ?? 'YouTube'
    void this.loop(++this.run)
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
        if (!id) {
          this.liveChatId = ''
          this.ctx.status({ status: 'waiting', account: this.channelName, detail: 'Waiting for a live broadcast' })
          await sleep(OFFLINE_CHECK_MS)
          continue
        }
        this.liveChatId = id
        this.ctx.status({ status: 'connected', account: this.channelName })
        await this.follow(id, run)
      } catch (err) {
        if (run !== this.run) return
        const quota = err instanceof HttpError && /quota/i.test(err.message)
        this.ctx.status({ status: 'reconnecting', account: this.channelName, detail: quota ? 'YouTube daily quota used up. It resets at midnight Pacific Time.' : message(err) })
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
      if (r.event && fresh) this.ctx.event(r.event)
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
        if (Date.now() > this.tokens!.expiresAt - 60000) {
          this.refresh().then(() => resolve('retry'), () => resolve('retry'))
          return
        }
        this.cancelStream = openStream(liveChatId, pageToken, this.tokens!.access, {
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
            else if (err?.code === GRPC_UNAUTHENTICATED) this.refresh().then(() => resolve('retry'), () => resolve('retry'))
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
    const c = this.creds()
    if (!c) throw new Error('Add your Google client ID and secret first.')
    this.ctx.status({ status: 'authorizing', detail: 'Finish signing in in your browser' })
    try {
      const { code, verifier, redirectUri } = await loopbackLogin({
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        params: { client_id: c.id, scope: SCOPE, access_type: 'offline', prompt: 'consent' },
        port: 0, host: '127.0.0.1', path: '/callback'
      })
      const r = await fetchJson(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString()
      })
      this.save({ access: r.access_token, refresh: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 })
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
    if (t) void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh)}`, { method: 'POST' }).catch(() => {})
    this.ctx.status({ status: this.creds() ? 'needs-login' : 'needs-setup' })
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

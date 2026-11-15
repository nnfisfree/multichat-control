import { Socket as WebSocket } from '../socket'
import type { Platform, StreamEvent } from '../../shared/types'
import { core } from '../core'
import { api, backoff, HttpError, message } from '../net'
import { money, text, tier, toPlatform, type AlertContext, type AlertService } from './alerts'

const API = 'https://api.streamelements.com/kappa/v2'
const OAUTH = 'https://api.streamelements.com/oauth2'
const ASTRO = 'wss://astro.streamelements.com'
const HISTORY_DAYS = 30
// Gifted subs trickle in one by one next to their gift bomb. Wait a moment so they can be folded in.
const GROUP_MS = 3000
const TYPES = [
  'follow', 'tip', 'subscriber', 'communityGiftPurchase', 'cheer', 'raid', 'host', 'superchat', 'sponsor',
  'charityCampaignDonation', 'merch', 'purchase', 'redemption', 'channelPointsRedemption', 'hypetrainStart', 'hypetrainEnd'
]

const lower = (v: unknown): string => String(v ?? '').toLowerCase()

// Emulated (test) alerts. SE doesn't document the flag, so check every spelling we've seen.
const isTest = (a: any): boolean =>
  [a?.isMock, a?.isTest, a?.mock, a?.data?.isMock, a?.data?.isTest, a?.data?.mock].some((v) => v === true || v === 'true') ||
  a?.activityGroup === 'test' || a?.origin === 'test'

/** One SE activity -> StreamEvent. Unknown types are skipped. */
function toEvent(a: any, fallback: Platform): StreamEvent | null {
  const d = a?.data ?? {}
  const platform = toPlatform(a?.provider) ?? fallback
  const ts = Date.parse(a?.createdAt) || Date.now()
  const who = text(d.displayName) ?? text(d.username) ?? text(d.name) ?? 'Someone'
  const amount = Number(d.amount)
  const id = `se-${a?._id ?? a?.activityId ?? `${a?.type}-${ts}-${who}`}`
  const base = { id, platform, ts, source: 'streamelements' as const, details: {} as Record<string, string>, message: text(d.message) }
  switch (a?.type) {
    case 'follow':
      return { ...base, type: 'follow', actor: who, text: platform === 'youtube' ? 'subscribed' : 'followed' }
    case 'tip':
      return { ...base, type: 'donation', actor: who, text: 'donated', amount: money(d.amount, d.currency), big: amount >= 50 }
    case 'charityCampaignDonation':
      return { ...base, type: 'donation', actor: who, text: 'donated to charity', amount: money(d.amount, d.currency) }
    case 'merch':
    case 'purchase':
      return { ...base, type: 'donation', actor: who, text: 'bought', subject: text(d.items?.[0]?.name) ?? text(d.itemName) ?? 'merch', amount: money(d.amount, d.currency) }
    case 'subscriber':
      if (d.gifted) return { ...base, type: 'gift', actor: text(d.sender) ?? 'Someone', text: `gifted a sub to ${who}`, amount: tier(d.tier) }
      return { ...base, type: 'sub', actor: who, text: amount > 1 ? `resubscribed (${amount} months)` : 'subscribed', amount: tier(d.tier), months: amount || undefined }
    case 'communityGiftPurchase':
      return { ...base, type: 'gift', big: amount >= 5, actor: text(d.sender) ?? who, text: `gifted ${amount || 'some'} subs to the community`, amount: tier(d.tier) }
    case 'cheer':
      return { ...base, type: 'cheer', actor: who, text: 'cheered', amount: `${amount} bits` }
    case 'raid':
      return { ...base, type: 'raid', big: true, actor: who, text: 'raided the channel', amount: `${amount} viewers` }
    case 'host':
      return { ...base, type: 'raid', actor: who, text: 'hosted the channel', amount: `${amount} viewers` }
    case 'superchat':
      return { ...base, type: 'paid', actor: who, text: 'sent a Super Chat', amount: money(d.amount, d.currency) }
    case 'sponsor':
      return { ...base, type: 'sub', actor: who, text: amount > 1 ? `is a member (${amount} months)` : 'became a member', months: amount || undefined }
    case 'redemption':
    case 'channelPointsRedemption':
      return { ...base, type: 'redemption', actor: who, text: 'redeemed', subject: text(d.redemption) ?? text(d.itemName) ?? text(d.title) }
    case 'hypetrainStart':
      return { ...base, type: 'hypetrain', big: true, actor: undefined, text: 'Hype Train started!' }
    case 'hypetrainEnd':
      return { ...base, type: 'hypetrain', actor: undefined, text: 'Hype Train ended', amount: d.level ? `Level ${d.level}` : undefined }
    default:
      return null
  }
}


/**
 * SE keeps a dated activity feed (subs, gifts, Bits, raids, tips...), which fills the gaps the
 * platform APIs leave. New stuff arrives over its socket.
 */
export class StreamElements implements AlertService {
  readonly source = 'streamelements' as const
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private channelId = ''
  // SE wants its own token inside the socket; fetched from Rust before each connect
  private socketToken = ''
  private platform: Platform = 'twitch'
  private account = ''
  private queue: any[] = []
  private flush: ReturnType<typeof setTimeout> | null = null
  private bombs = new Map<string, number>()

  constructor(private ctx: AlertContext) {}

  /** Authenticated call. Rust adds and refreshes the token. */
  private async get(url: string): Promise<any> {
    const data = await api('streamelements', 'GET', url, undefined, { Accept: 'application/json' })
    // a rejected token can come back as an HTML page instead of an error
    if (!data || typeof data !== 'object') throw new HttpError(401, "StreamElements didn't accept the login.", data)
    return data
  }

  async login(): Promise<void> {
    this.stop()
    this.ctx.status({ status: 'authorizing' })
    try {
      await core.login('streamelements')
    } catch (err) {
      this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.start()
  }

  logout(): void {
    this.stop()
    void core.logout('streamelements')
    this.ctx.status({ status: 'needs-login' })
  }

  async start(): Promise<void> {
    this.stop()
    const run = ++this.run
    const state = await core.authState('streamelements')
    if (run !== this.run) return
    if (!state.configured) return this.ctx.status({ status: 'needs-setup' })
    if (!state.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.ctx.status({ status: 'connecting' })
    try {
      const v = await this.get(`${OAUTH}/validate`)
      const me = await this.get(`${API}/channels/${v?.channel_id ?? 'me'}`)
      if (run !== this.run) return
      this.channelId = String(me?._id ?? v?.channel_id ?? '')
      if (!this.channelId) throw new Error('StreamElements returned no channel for this login.')
      this.platform = toPlatform(me?.provider) ?? 'twitch'
      this.account = text(me?.displayName) ?? text(me?.username) ?? 'StreamElements'
      void this.loadHistory(run)
      this.socketToken = await core.socketToken('streamelements')
      if (run !== this.run) return
      this.open(run, ASTRO)
    } catch (err) {
      if (run !== this.run) return
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        void core.logout('streamelements')
        return this.ctx.status({ status: 'needs-login', detail: 'Your StreamElements login expired. Please log in again.' })
      }
      this.ctx.status({ status: 'reconnecting', detail: message(err) })
      this.retry = setTimeout(() => void this.start(), 60000)
    }
  }

  stop(): void {
    this.run++
    if (this.retry) clearTimeout(this.retry)
    if (this.flush) clearTimeout(this.flush)
    this.retry = this.flush = null
    this.queue = []
    this.ws?.close()
    this.ws = null
  }

  /** Last 30 days of the activity feed. */
  private async loadHistory(run: number): Promise<void> {
    const q = new URLSearchParams({
      after: new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString(), before: new Date().toISOString(),
      limit: '100', mincheer: '0', minhost: '0', minsub: '0', mintip: '0', origin: 'feed'
    })
    for (const t of TYPES) q.append('types', t)
    try {
      const r = await this.get(`${API}/activities/${this.channelId}?${q}`)
      if (run !== this.run) return
      const list: any[] = Array.isArray(r) ? r : (r?.docs ?? r?.data ?? [])
      this.handle(list, true)
    } catch (err) {
      if (run === this.run) this.ctx.status({ status: 'connected', account: this.account, detail: `Past events couldn't load: ${message(err)}` })
    }
  }

  private handle(list: any[], history: boolean): void {
    const now = Date.now()
    for (const a of list) {
      if (a?.type !== 'communityGiftPurchase') continue
      const who = lower(a.data?.sender ?? a.data?.username)
      this.bombs.set(who, Math.max(this.bombs.get(who) ?? 0, Date.parse(a.createdAt) || now))
    }
    for (const [k, t] of this.bombs) if (t < now - HISTORY_DAYS * 86400000) this.bombs.delete(k)
    for (const a of list) {
      // every sub in a gift bomb is also listed on its own; the bomb row already covers them
      if (a?.type === 'subscriber' && a.data?.gifted) {
        const bomb = this.bombs.get(lower(a.data.sender))
        if (bomb && Math.abs((Date.parse(a.createdAt) || now) - bomb) < 120000) continue
      }
      const e = toEvent(a, this.platform)
      if (!e) continue
      if (history) this.ctx.event({ ...e, history: true })
      // emulated alert from the dashboard: shown until restart, never saved
      else this.ctx.event(isTest(a) ? { ...e, id: `${e.id}-test-${Date.now()}`, ts: Date.now(), test: true } : e)
    }
  }

  private open(run: number, url: string): void {
    const ws = new WebSocket(url)
    this.ws = ws
    ws.on('message', (raw) => {
      if (run !== this.run || ws !== this.ws) return
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'welcome') {
        ws.send(JSON.stringify({ type: 'subscribe', nonce: 'activities', data: { topic: 'channel.activities', room: this.channelId, token: this.socketToken, token_type: 'oauth2' } }))
      } else if (msg.type === 'response' && msg.nonce === 'activities') {
        if (msg.error) {
          // usually an expired token, the reconnect after close refreshes it
          this.ctx.status({ status: 'reconnecting', account: this.account, detail: msg.data?.message ?? msg.error })
          ws.close()
        } else {
          this.attempt = 0
          this.ctx.status({ status: 'connected', account: this.account })
        }
      } else if (msg.type === 'message' && msg.topic === 'channel.activities' && msg.data) {
        this.queue.push(msg.data)
        this.flush ??= setTimeout(() => {
          this.flush = null
          const batch = this.queue
          this.queue = []
          this.handle(batch, false)
        }, GROUP_MS)
      } else if (msg.type === 'reconnect' && msg.data?.reconnect_token) {
        // planned restart, the new connection keeps the subscription
        ws.removeAllListeners('close')
        ws.close()
        this.open(run, `${ASTRO}/?reconnect_token=${encodeURIComponent(msg.data.reconnect_token)}`)
      }
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      if (run !== this.run || ws !== this.ws) return
      this.ctx.status({ status: 'reconnecting', account: this.account })
      this.retry = setTimeout(() => void this.start(), backoff(this.attempt++))
    })
  }
}

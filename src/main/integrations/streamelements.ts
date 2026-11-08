import WebSocket from 'ws'
import type { Platform, StreamEvent } from '../../shared/types'
import { ALERTS_REDIRECT_PORT } from '../../shared/app-config'
import { loopbackLogin } from '../auth/loopback-pkce'
import { alertCredentials } from '../credentials'
import { backoff, errorText, fetchJson, HttpError, message, readBody } from '../net'
import { store } from '../store'
import { money, text, tier, toPlatform, type AlertContext, type AlertService } from './alerts'

const API = 'https://api.streamelements.com/kappa/v2'
const OAUTH = 'https://api.streamelements.com/oauth2'
const ASTRO = 'wss://astro.streamelements.com'
const SCOPES = 'channel:read activities:read tips:read'
const HISTORY_DAYS = 30
/** Gifted subs arrive one by one next to their gift bomb; a short wait lets them be folded in. */
const GROUP_MS = 3000
const TYPES = [
  'follow', 'tip', 'subscriber', 'communityGiftPurchase', 'cheer', 'raid', 'host', 'superchat', 'sponsor',
  'charityCampaignDonation', 'merch', 'purchase', 'redemption', 'channelPointsRedemption', 'hypetrainStart', 'hypetrainEnd'
]

const lower = (v: unknown): string => String(v ?? '').toLowerCase()

/** Turns one StreamElements activity into an event. Unknown kinds are skipped. */
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
      return { ...base, type: 'sub', actor: who, text: amount > 1 ? `resubscribed (${amount} months)` : 'subscribed', amount: tier(d.tier) }
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
      return { ...base, type: 'sub', actor: who, text: amount > 1 ? `is a member (${amount} months)` : 'became a member' }
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

interface Tokens { access: string; refresh?: string; expiresAt: number }

/**
 * StreamElements keeps a dated activity feed (subs, gifts, Bits, raids, tips...), so it fills
 * the gaps platform APIs leave, and its live socket adds new ones as they happen.
 */
export class StreamElements implements AlertService {
  readonly source = 'streamelements' as const
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private retry: NodeJS.Timeout | null = null
  private tokens: Tokens | null = null
  private channelId = ''
  private platform: Platform = 'twitch'
  private account = ''
  private queue: any[] = []
  private flush: NodeJS.Timeout | null = null
  private bombs = new Map<string, number>()

  constructor(private ctx: AlertContext) {}

  private save(t: Tokens | null): void {
    this.tokens = t
    store.setSecret('streamelements.tokens', t ? JSON.stringify(t) : undefined)
  }

  private async tokenRequest(params: Record<string, string>): Promise<void> {
    const r = await fetchJson(`${OAUTH}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString()
    })
    this.save({ access: r.access_token, refresh: r.refresh_token ?? this.tokens?.refresh, expiresAt: Date.now() + Number(r.expires_in || 3600) * 1000 })
  }

  private async refresh(): Promise<void> {
    const c = alertCredentials('streamelements')
    if (!c || !this.tokens?.refresh) throw new HttpError(401, 'Your StreamElements login expired. Please log in again.', null)
    await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh, client_id: c.id, client_secret: c.secret })
  }

  private async get(url: string): Promise<any> {
    if (this.tokens && Date.now() > this.tokens.expiresAt - 60000) await this.refresh()
    const request = (): Promise<Response> => fetch(url, { headers: { Authorization: `OAuth ${this.tokens!.access}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
    let res = await request()
    if (res.status === 401 && this.tokens?.refresh) {
      await this.refresh()
      res = await request()
    }
    const data = await readBody(res)
    if (!res.ok) throw new HttpError(res.status, errorText(data, `StreamElements error ${res.status}`), data)
    return data
  }

  async login(): Promise<void> {
    const c = alertCredentials('streamelements')
    if (!c) throw new Error('This copy of the app has no StreamElements login built in yet.')
    this.stop()
    this.ctx.status({ status: 'authorizing' })
    try {
      const { code, verifier, redirectUri } = await loopbackLogin({
        authorizeUrl: `${OAUTH}/authorize`, params: { client_id: c.id, scope: SCOPES },
        port: ALERTS_REDIRECT_PORT, host: 'localhost', path: '/streamelements'
      })
      await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret })
    } catch (err) {
      this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.start()
  }

  logout(): void {
    this.stop()
    this.save(null)
    this.ctx.status({ status: 'needs-login' })
  }

  async start(): Promise<void> {
    this.stop()
    const run = ++this.run
    if (!alertCredentials('streamelements')) return this.ctx.status({ status: 'needs-setup' })
    const raw = store.getSecret('streamelements.tokens')
    if (!raw) return this.ctx.status({ status: 'needs-login' })
    this.tokens = JSON.parse(raw)
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
      this.open(run, ASTRO)
    } catch (err) {
      if (run !== this.run) return
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        this.save(null)
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

  /** The last 30 days of the activity feed. */
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
      // Each sub of a gift bomb is also listed alone; the bomb row already says it.
      if (a?.type === 'subscriber' && a.data?.gifted) {
        const bomb = this.bombs.get(lower(a.data.sender))
        if (bomb && Math.abs((Date.parse(a.createdAt) || now) - bomb) < 120000) continue
      }
      const e = toEvent(a, this.platform)
      if (e) this.ctx.event(history ? { ...e, history: true } : e)
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
        ws.send(JSON.stringify({ type: 'subscribe', nonce: 'activities', data: { topic: 'channel.activities', room: this.channelId, token: this.tokens?.access, token_type: 'oauth2' } }))
      } else if (msg.type === 'response' && msg.nonce === 'activities') {
        if (msg.error) {
          // Usually an expired token: the restart after closing renews it.
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
        // A planned restart: the new connection keeps the subscription.
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

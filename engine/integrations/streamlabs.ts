import { Socket as WebSocket } from '../socket'
import type { Platform, StreamEvent } from '../../shared/types'
import { core } from '../core'
import { api, backoff, HttpError, message } from '../net'
import { money, text, tier, toPlatform, type AlertContext, type AlertService } from './alerts'

const API = 'https://streamlabs.com/api/v2.0'
const SOCKET = 'wss://sockets.streamlabs.com/socket.io/'

/** Turns one item of a Streamlabs socket event into an event. Unknown kinds are skipped. */
function toEvent(type: string, m: any, platform: Platform, eventId: string): StreamEvent | null {
  const who = text(m?.from) ?? text(m?.display_name) ?? text(m?.name) ?? 'Someone'
  const months = Number(m?.months)
  const base = {
    id: `sl-${m?._id ?? eventId ?? `${type}-${Date.now()}`}`, platform, ts: Date.now(), source: 'streamlabs' as const,
    details: {} as Record<string, string>, message: text(m?.message) ?? text(m?.comment)
  }
  switch (type) {
    case 'donation':
      return {
        ...base, id: m?.id != null ? `sl-don-${m.id}` : base.id, type: 'donation', actor: who, text: 'donated',
        amount: money(m?.amount, m?.currency) ?? text(m?.formatted_amount) ?? text(m?.formattedAmount), big: Number(m?.amount) >= 50
      }
    case 'follow':
      return { ...base, type: 'follow', actor: who, text: platform === 'youtube' ? 'subscribed' : 'followed' }
    case 'subscription':
    case 'resub': {
      const gifter = text(m?.gifter_display_name) ?? text(m?.gifter)
      if (gifter) return { ...base, type: 'gift', actor: gifter, text: `gifted a sub to ${who}`, amount: tier(m?.sub_plan) }
      if (platform === 'youtube') return { ...base, type: 'sub', actor: who, text: months > 1 ? `is a member (${months} months)` : 'became a member' }
      return { ...base, type: 'sub', actor: who, text: months > 1 ? `resubscribed (${months} months)` : 'subscribed', amount: tier(m?.sub_plan) }
    }
    case 'bits':
      return { ...base, type: 'cheer', actor: who, text: 'cheered', amount: `${Number(m?.amount) || 0} bits` }
    case 'raid':
    case 'raids':
      return { ...base, type: 'raid', big: true, actor: who, text: 'raided the channel', amount: `${Number(m?.raiders ?? m?.viewers) || 0} viewers` }
    case 'host':
      return { ...base, type: 'raid', actor: who, text: 'hosted the channel', amount: `${Number(m?.viewers) || 0} viewers` }
    case 'superchat':
      return { ...base, type: 'paid', actor: who, text: 'sent a Super Chat', amount: text(m?.displayString) ?? money(Number(m?.amount) / 1e6, m?.currency) }
    case 'merch':
      return { ...base, type: 'donation', actor: who, text: 'bought', subject: text(m?.product) ?? 'merch', amount: money(m?.amount, m?.currency) }
    default:
      return null
  }
}


/**
 * Streamlabs sends alerts live over its socket (socket.io, spoken here directly), and its API
 * lists past donations.
 */
export class Streamlabs implements AlertService {
  readonly source = 'streamlabs' as const
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null

  constructor(private ctx: AlertContext) {}

  /** A request as the user's Streamlabs account; the core adds and renews the token. */
  private async api(url: string): Promise<any> {
    const data = await api('streamlabs', 'GET', url, undefined, { Accept: 'application/json' })
    // A rejected login can get a web page back rather than an error.
    if (!data || typeof data !== 'object') throw new HttpError(401, "Streamlabs didn't accept the login.", data)
    return data
  }

  async login(): Promise<void> {
    this.stop()
    this.ctx.status({ status: 'authorizing' })
    try {
      await core.login('streamlabs')
    } catch (err) {
      this.ctx.status({ status: 'needs-login', detail: message(err) })
      throw err
    }
    await this.start()
  }

  logout(): void {
    this.stop()
    void core.logout('streamlabs')
    this.ctx.status({ status: 'needs-login' })
  }

  async start(): Promise<void> {
    this.stop()
    const run = ++this.run
    const state = await core.authState('streamlabs')
    if (run !== this.run) return
    if (!state.configured) return this.ctx.status({ status: 'needs-setup' })
    if (!state.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.ctx.status({ status: 'connecting' })
    try {
      const socket = text((await this.api(API + '/socket/token'))?.socket_token)
      if (run !== this.run) return
      if (!socket) throw new Error('Streamlabs gave no live connection.')
      void this.loadDonations(run)
      this.open(run, socket)
    } catch (err) {
      if (run !== this.run) return
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        void core.logout('streamlabs')
        return this.ctx.status({ status: 'needs-login', detail: 'Your Streamlabs login expired. Please log in again.' })
      }
      this.ctx.status({ status: 'reconnecting', detail: message(err) })
      this.retry = setTimeout(() => void this.start(), 60000)
    }
  }

  stop(): void {
    this.run++
    for (const t of [this.retry, this.watchdog]) if (t) clearTimeout(t)
    if (this.ping) clearInterval(this.ping)
    this.retry = this.ping = this.watchdog = null
    this.ws?.close()
    this.ws = null
  }

  private async loadDonations(run: number): Promise<void> {
    try {
      const r = await this.api(API + '/donations?limit=100')
      if (run !== this.run) return
      for (const d of Array.isArray(r?.data) ? r.data : []) {
        const ts = Number(d.created_at) * 1000
        if (!ts) continue
        this.ctx.event({
          id: `sl-don-${d.donation_id}`, platform: this.ctx.home(), ts, source: 'streamlabs', history: true, type: 'donation',
          actor: text(d.name) ?? 'Someone', text: 'donated', amount: money(d.amount, d.currency), message: text(d.message), details: {}
        })
      }
    } catch (err) {
      if (run === this.run) this.ctx.status({ status: 'connected', account: 'Streamlabs', detail: `Past donations couldn't load: ${message(err)}` })
    }
  }

  private handle(evt: any): void {
    const type = String(evt?.type ?? '')
    const platform = toPlatform(evt?.for) ?? this.ctx.home()
    for (const m of ([] as any[]).concat(evt?.message ?? [])) {
      const e = toEvent(type, m, platform, String(evt?.event_id ?? ''))
      if (!e) continue
      // A test alert from the dashboard: shown until the app restarts, never saved.
      const test = m?.isTest === true || m?.isTest === 'true' || evt?.isTest === true
      this.ctx.event(test ? { ...e, id: `${e.id}-test-${Date.now()}`, test: true } : e)
    }
  }

  private open(run: number, token: string): void {
    const ws = new WebSocket(`${SOCKET}?token=${encodeURIComponent(token)}&EIO=3&transport=websocket`)
    this.ws = ws
    const arm = (ms: number): void => {
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = setTimeout(() => ws.terminate(), ms)
    }
    ws.on('message', (raw) => {
      if (run !== this.run || ws !== this.ws) return
      const s = raw.toString()
      if (s.startsWith('0')) {
        // Engine.io handshake: the client must ping on this interval.
        let o: any = {}
        try { o = JSON.parse(s.slice(1)) } catch { /* defaults below */ }
        const every = Number(o.pingInterval) || 25000
        const grace = Number(o.pingTimeout) || 60000
        if (this.ping) clearInterval(this.ping)
        this.ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.send('2') }, every)
        arm(every + grace)
      } else if (s === '3') {
        arm(85000)
      } else if (s === '2') {
        ws.send('3')
        arm(85000)
      } else if (s.startsWith('40')) {
        this.attempt = 0
        this.ctx.status({ status: 'connected', account: 'Streamlabs' })
      } else if (s.startsWith('44')) {
        // The live token was refused: a fresh start fetches a new one.
        ws.close()
      } else if (s.startsWith('42')) {
        try {
          const [name, data] = JSON.parse(s.slice(2))
          if (name === 'event') this.handle(data)
        } catch { /* not an event */ }
      }
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      if (run !== this.run || ws !== this.ws) return
      if (this.ping) clearInterval(this.ping)
      this.ctx.status({ status: 'reconnecting', account: 'Streamlabs' })
      this.retry = setTimeout(() => void this.start(), backoff(this.attempt++))
    })
  }
}

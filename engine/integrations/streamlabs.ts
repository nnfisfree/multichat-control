import { Socket as WebSocket } from '../socket'
import type { Platform, StreamEvent } from '../../shared/types'
import { core } from '../core'
import { backoff, message } from '../net'
import { money, text, tier, toPlatform, type AlertContext, type AlertService } from './alerts'

// Recent Events categories -> the event type the socket uses for the same thing. Power-ups, watch
// streaks and redemptions come from Twitch itself, and tips come from the full donations list.
const RECENT: Record<string, string> = {
  subscriptions: 'subscription', follows: 'follow', bits: 'bits', raids: 'raid', hosts: 'host', merch: 'merch',
  superChats: 'superchat', sponsors: 'subscription', subscribers: 'follow'
}

/** One item of a Streamlabs socket event -> StreamEvent. Unknown types are skipped. */
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
      if (platform === 'youtube') return { ...base, type: 'sub', actor: who, text: months > 1 ? `is a member (${months} months)` : 'became a member', months: months || undefined }
      return { ...base, type: 'sub', actor: who, text: months > 1 ? `resubscribed (${months} months)` : 'subscribed', amount: tier(m?.sub_plan), months: months || undefined }
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
 * Logged in through the Streamlabs website (core/src/sitelogin.rs), with the streamer's own
 * account. A hidden page on streamlabs.com reads the last 30 days the way its dashboard does, and
 * hands out the live socket's address. Live alerts come over that socket (socket.io, but we speak
 * the protocol directly instead of pulling in the client).
 */
export class Streamlabs implements AlertService {
  readonly source = 'streamlabs' as const
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  // the streamer's linked Twitch/YouTube name, as Streamlabs knows it
  private account = 'Streamlabs'

  constructor(private ctx: AlertContext) {}

  async login(): Promise<void> {
    this.stop()
    this.ctx.status({ status: 'authorizing' })
    try {
      // their website in a window: the streamer signs in to their own account there
      await core.siteLogin('streamlabs')
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
    if (!state.loggedIn) return this.ctx.status({ status: 'needs-login' })
    this.ctx.status({ status: 'connecting' })
    try {
      const data = await core.streamlabsFetch()
      if (run !== this.run) return
      if (data?.error === 'login') {
        void core.logout('streamlabs')
        return this.ctx.status({ status: 'needs-login', detail: 'Your Streamlabs login expired. Please log in again.' })
      }
      if (data?.error) throw new Error(`Streamlabs: ${data.error}`)
      let socket: URL | null = null
      try { socket = new URL(String(data?.socket)) } catch { /* checked below */ }
      if (!socket?.searchParams.get('token')) throw new Error('Streamlabs gave no live connection.')
      this.account = text(data?.account) ?? 'Streamlabs'
      this.history(data)
      this.open(run, socket.host, socket.searchParams.get('token')!)
    } catch (err) {
      if (run !== this.run) return
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

  /** The last 30 days: every tip, plus subs, Bits, follows, raids... from Recent Events. */
  private history(data: any): void {
    const at = (v: unknown): number => Date.parse(String(v ?? '')) || 0
    for (const d of Array.isArray(data?.donations) ? data.donations : []) {
      const ts = at(d?.created_at)
      if (!ts || d?.refunded || d?.deleted_at) continue
      this.ctx.event({
        id: `sl-don-${d.id}`, platform: this.ctx.home(), ts, source: 'streamlabs', history: true, type: 'donation',
        actor: text(d.donor_name) ?? text(d.name) ?? 'Someone', text: 'donated',
        amount: money(d.amount, d.currency) ?? text(d.amount_string), message: text(d.message), big: Number(d.amount) >= 50, details: {}
      })
    }
    // Streamlabs lists a gift bomb as its single gifted subs: one person's gifts within a couple of
    // minutes on one platform become one "gifted N subs" entry, like the platforms show it
    const bombs = new Map<string, { first: any; ts: number; count: number; platform: StreamEvent['platform'] }[]>()
    for (const [category, type] of Object.entries(RECENT)) {
      const list = data?.recent?.[category]
      if (!Array.isArray(list)) continue
      for (const m of [...list].sort((a, b) => at(a?.created_at) - at(b?.created_at))) {
        const ts = at(m?.created_at)
        // YouTube members and subscribers are listed under their own names
        const platform = category === 'sponsors' || category === 'subscribers' ? 'youtube' : toPlatform(m?.platform) ?? this.ctx.home()
        const gifter = category === 'subscriptions' ? (text(m?.gifter_display_name) ?? text(m?.gifter)) : undefined
        if (gifter && ts) {
          const key = `${platform}|${gifter.toLowerCase()}`
          const runs = bombs.get(key) ?? []
          const last = runs[runs.length - 1]
          if (last && ts - last.ts < 2 * 60_000) { last.count++; last.ts = ts } else runs.push({ first: m, ts, count: 1, platform })
          bombs.set(key, runs)
          continue
        }
        const e = toEvent(type, m, platform, '')
        if (!e || !ts) continue
        this.ctx.event({ ...e, id: `sl-${category}-${m?.id ?? m?._id ?? ts}`, ts, history: true })
      }
    }
    for (const runs of bombs.values()) {
      for (const r of runs) {
        const e = toEvent('subscription', r.first, r.platform, '')
        if (!e) continue
        const id = `sl-subscriptions-${r.first?.id ?? r.first?._id ?? r.ts}`
        const when = at(r.first?.created_at)
        if (r.count === 1) { this.ctx.event({ ...e, id, ts: when, history: true }); continue }
        this.ctx.event({
          ...e, id: `${id}-x${r.count}`, ts: when, history: true, big: r.count >= 5, message: undefined,
          text: `gifted ${r.count} subs to the community`, amount: tier(r.first?.sub_plan)
        })
      }
    }
  }

  private handle(evt: any): void {
    const type = String(evt?.type ?? '')
    const platform = toPlatform(evt?.for) ?? this.ctx.home()
    for (const m of ([] as any[]).concat(evt?.message ?? [])) {
      const e = toEvent(type, m, platform, String(evt?.event_id ?? ''))
      if (!e) continue
      // test alert from the dashboard: shown until restart, never saved
      const test = m?.isTest === true || m?.isTest === 'true' || evt?.isTest === true
      this.ctx.event(test ? { ...e, id: `${e.id}-test-${Date.now()}`, test: true } : e)
    }
  }

  private open(run: number, host: string, token: string): void {
    // only Streamlabs' own socket hosts
    if (!/(^|\.)streamlabs\.com$/.test(host)) host = 'aws-io.streamlabs.com'
    const ws = new WebSocket(`wss://${host}/socket.io/?token=${encodeURIComponent(token)}&EIO=3&transport=websocket`)
    this.ws = ws
    const arm = (ms: number): void => {
      if (this.watchdog) clearTimeout(this.watchdog)
      this.watchdog = setTimeout(() => ws.terminate(), ms)
    }
    ws.on('message', (raw) => {
      if (run !== this.run || ws !== this.ws) return
      const s = raw.toString()
      if (s.startsWith('0')) {
        // engine.io handshake, tells us the ping interval
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
        this.ctx.status({ status: 'connected', account: this.account })
      } else if (s.startsWith('44')) {
        // socket token refused; reconnecting fetches a fresh one
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
      this.ctx.status({ status: 'reconnecting', account: this.account })
      this.retry = setTimeout(() => void this.start(), backoff(this.attempt++))
    })
  }
}

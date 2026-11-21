import { Socket as WebSocket } from '../../socket'
import { backoff, message } from '../../net'
import { log } from '../../log'
import type { KickRealtime } from './discovery'

const SILENCE_LIMIT_MS = 90000
// rejoin this long before the guest token expires so the swap isn't noticeable
const TOKEN_MARGIN_S = 90
// the new connection must be subscribed within this, or the old one just carries on
const HANDOVER_TIMEOUT_MS = 20000
const DEDUPE_MS = 30000

export interface KickSocketHandlers {
  onEvent(name: string, data: any): void
  onState(state: 'connected' | 'reconnecting', detail?: string): void
}

/**
 * Client for the Centrifugo socket behind kick.com. Undocumented, so this is based on what the site
 * actually sends: newline-separated JSON commands, an empty `{}` frame for ping/pong, events in `push`.
 */
export class KickSocket {
  private ws: WebSocket | null = null
  /** Next connection while the token is renewed. Takes over once it's subscribed. */
  private standby: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private renew: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private stopped = true
  // pushes seen in the last few seconds, both sockets deliver them while they overlap
  private recent = new Map<string, number>()

  constructor(private auth: () => Promise<KickRealtime>, private channels: string[], private h: KickSocketHandlers) {}

  start(): void {
    this.stopped = false
    void this.open()
  }

  stop(): void {
    this.stopped = true
    this.clear()
    this.ws?.close()
    this.standby?.close()
    this.ws = this.standby = null
  }

  private clear(): void {
    if (this.retry) clearTimeout(this.retry)
    if (this.watchdog) clearTimeout(this.watchdog)
    if (this.renew) clearTimeout(this.renew)
  }

  private arm(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.ws?.terminate(), SILENCE_LIMIT_MS)
  }

  private later(detail?: string): void {
    if (this.stopped) return
    const wait = backoff(this.attempt++)
    this.h.onState('reconnecting', detail ?? `Reconnecting in ${Math.round(wait / 1000)}s`)
    this.retry = setTimeout(() => void this.open(), wait)
  }

  /**
   * The guest token runs out every ~45 minutes. Instead of closing and reconnecting (a few seconds
   * with no chat, and a "reconnecting" blip), a second connection joins first and the old one is
   * closed once the new one is subscribed. If the new one fails, the old one keeps going until Kick
   * closes it, and the normal reconnect takes over.
   */
  private async swap(): Promise<void> {
    if (this.stopped || this.standby) return
    let creds: KickRealtime
    try {
      creds = await this.auth()
    } catch {
      return
    }
    if (this.stopped) return
    this.connect(creds, true)
  }

  private async open(): Promise<void> {
    let creds: KickRealtime
    try {
      creds = await this.auth()
    } catch (err) {
      return this.later(`Kick live connection failed: ${message(err)}`)
    }
    if (this.stopped) return
    this.connect(creds, false)
  }

  private connect(creds: KickRealtime, standby: boolean): void {
    const ws = new WebSocket(creds.url, { headers: { Origin: 'https://kick.com' } })
    if (standby) this.standby = ws
    else this.ws = ws
    // replies we still wait for: connect (id 1) and one per channel
    let pending = this.channels.length + 1
    const giveUp = standby ? setTimeout(() => {
      if (this.standby !== ws) return
      this.standby = null
      ws.terminate()
      log('kick', 'token renewal: the new connection never got ready, keeping the old one')
    }, HANDOVER_TIMEOUT_MS) : null

    const takeOver = (): void => {
      if (giveUp) clearTimeout(giveUp)
      const old = this.ws
      this.standby = null
      this.ws = ws
      if (old && old !== ws) old.close()
      this.arm()
      log('kick', 'token renewed, switched connections without a gap')
    }

    ws.on('open', () => {
      const commands = [
        { connect: { token: creds.token, name: 'js' }, id: 1 },
        ...this.channels.map((channel, i) => ({ subscribe: { channel, flag: 1 }, id: i + 2 }))
      ]
      ws.send(commands.map((c) => JSON.stringify(c)).join('\n'))
      if (!standby) this.arm()
    })

    ws.on('message', (raw) => {
      if (ws === this.ws) this.arm()
      for (const line of raw.toString().split('\n')) {
        if (!line) continue
        let m: any
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (!Object.keys(m).length) ws.send('{}')
        else if (m.id && m.id <= this.channels.length + 1 && !m.error) {
          if (m.connect) {
            if (this.renew) clearTimeout(this.renew)
            if (m.connect.expires && m.connect.ttl) {
              this.renew = setTimeout(() => void this.swap(), Math.max(30, m.connect.ttl - TOKEN_MARGIN_S) * 1000)
            }
            if (!standby) {
              this.attempt = 0
              this.h.onState('connected')
            }
          }
          if (--pending === 0 && standby && this.standby === ws) takeOver()
        } else if (m.push?.pub?.data) {
          if (ws === this.ws || ws === this.standby) this.onPush(m.push)
        }
      }
    })

    ws.on('close', () => {
      if (ws === this.standby) {
        if (giveUp) clearTimeout(giveUp)
        this.standby = null
        return
      }
      if (ws !== this.ws || this.stopped) return
      this.clear()
      this.later()
    })
    ws.on('error', () => ws.terminate())
  }

  /** False for a push the other connection already delivered. */
  private firstTime(push: any): boolean {
    const pub = push.pub
    const key = pub.offset !== undefined ? `${push.channel}#${pub.offset}` : `${push.channel}|${typeof pub.data === 'string' ? pub.data : JSON.stringify(pub.data)}`
    const now = Date.now()
    if (this.recent.has(key)) return false
    this.recent.set(key, now)
    if (this.recent.size > 300) for (const [k, t] of this.recent) { if (now - t > DEDUPE_MS) this.recent.delete(k); else break }
    return true
  }

  private onPush(push: any): void {
    if (!this.firstTime(push)) return
    const payload = push.pub.data
    let data = payload.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch { /* keep the raw string */ }
    }
    if (payload.event) this.h.onEvent(payload.event, data)
  }
}

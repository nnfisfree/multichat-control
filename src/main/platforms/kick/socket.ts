import WebSocket from 'ws'
import { backoff, message } from '../../net'
import type { KickRealtime } from './discovery'

const SILENCE_LIMIT_MS = 90000
/** Rejoin this long before the guest token expires, so the swap is invisible. */
const TOKEN_MARGIN_S = 90

export interface KickSocketHandlers {
  onEvent(name: string, data: any): void
  onState(state: 'connected' | 'reconnecting', detail?: string): void
}

/**
 * Client for the Centrifugo socket behind Kick's website, written against its observed traffic:
 * newline-separated JSON commands, an empty `{}` frame as ping and pong, and events in `push`.
 */
export class KickSocket {
  private ws: WebSocket | null = null
  private retry: NodeJS.Timeout | null = null
  private watchdog: NodeJS.Timeout | null = null
  private renew: NodeJS.Timeout | null = null
  private attempt = 0
  private stopped = true

  constructor(private auth: () => Promise<KickRealtime>, private channels: string[], private h: KickSocketHandlers) {}

  start(): void {
    this.stopped = false
    void this.open()
  }

  stop(): void {
    this.stopped = true
    this.clear()
    this.ws?.close()
    this.ws = null
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

  private async open(): Promise<void> {
    let creds: KickRealtime
    try {
      creds = await this.auth()
    } catch (err) {
      return this.later(`Kick live connection failed: ${message(err)}`)
    }
    if (this.stopped) return
    const ws = new WebSocket(creds.url, { headers: { Origin: 'https://kick.com' } })
    this.ws = ws

    ws.on('open', () => {
      const commands = [
        { connect: { token: creds.token, name: 'js' }, id: 1 },
        ...this.channels.map((channel, i) => ({ subscribe: { channel, flag: 1 }, id: i + 2 }))
      ]
      ws.send(commands.map((c) => JSON.stringify(c)).join('\n'))
      this.arm()
    })

    ws.on('message', (raw) => {
      this.arm()
      for (const line of raw.toString().split('\n')) {
        if (!line) continue
        let m: any
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (!Object.keys(m).length) ws.send('{}')
        else if (m.connect) {
          this.attempt = 0
          this.h.onState('connected')
          if (m.connect.expires && m.connect.ttl) {
            this.renew = setTimeout(() => ws.close(), Math.max(30, m.connect.ttl - TOKEN_MARGIN_S) * 1000)
          }
        } else if (m.push?.pub?.data) this.onPush(m.push.pub.data)
      }
    })

    ws.on('close', () => {
      if (ws !== this.ws || this.stopped) return
      this.clear()
      this.later()
    })
    ws.on('error', () => ws.terminate())
  }

  private onPush(payload: any): void {
    let data = payload.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch { /* keep the raw string */ }
    }
    if (payload.event) this.h.onEvent(payload.event, data)
  }
}

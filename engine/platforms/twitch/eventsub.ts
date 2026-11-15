import { Socket as WebSocket } from '../../socket'
import { backoff, message } from '../../net'

const URL_DEFAULT = 'wss://eventsub.wss.twitch.tv/ws'

export interface EventSubHandlers {
  /** New session, subscriptions need creating. */
  onSession(sessionId: string): Promise<void>
  onNotification(type: string, messageId: string, event: any): void
  onState(state: 'connected' | 'reconnecting', detail?: string): void
}

/**
 * EventSub over WebSocket. A planned `session_reconnect` keeps the subscriptions (we just swap
 * sockets). Any other drop means a new session and resubscribing, and Twitch doesn't replay
 * anything we missed.
 */
export class EventSub {
  private socket: WebSocket | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private stopped = true
  private seen = new Set<string>()

  constructor(private h: EventSubHandlers) {}

  start(): void {
    this.stopped = false
    this.open(URL_DEFAULT, false)
  }

  stop(): void {
    this.stopped = true
    if (this.watchdog) clearTimeout(this.watchdog)
    if (this.retry) clearTimeout(this.retry)
    this.socket?.close()
    this.socket = null
  }

  private arm(seconds: number): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.socket?.terminate(), (seconds + 5) * 1000)
  }

  private open(url: string, swapping: boolean): void {
    const ws = new WebSocket(url)
    let keepalive = 30
    if (!swapping) this.socket = ws

    ws.on('message', (raw) => {
      if (ws !== this.socket && !swapping) return
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const type = msg.metadata?.message_type
      const id = msg.metadata?.message_id
      if (id) {
        // Twitch can redeliver, drop dupes
        if (this.seen.has(id)) return
        this.seen.add(id)
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!)
      }
      if (type === 'session_welcome') {
        keepalive = msg.payload.session.keepalive_timeout_seconds ?? keepalive
        this.attempt = 0
        if (swapping) {
          const old = this.socket
          this.socket = ws
          swapping = false
          old?.close()
          this.h.onState('connected')
        } else {
          this.h.onSession(msg.payload.session.id).then(() => this.h.onState('connected'), (err) => this.h.onState('reconnecting', message(err)))
        }
        this.arm(keepalive)
      } else if (type === 'session_keepalive') {
        this.arm(keepalive)
      } else if (type === 'notification') {
        this.arm(keepalive)
        this.h.onNotification(msg.metadata.subscription_type, id, msg.payload.event)
      } else if (type === 'session_reconnect') {
        this.open(msg.payload.session.reconnect_url, true)
      }
    })

    ws.on('close', () => {
      if (ws !== this.socket || this.stopped) return
      this.socket = null
      const wait = backoff(this.attempt++)
      this.h.onState('reconnecting', `Reconnecting in ${Math.round(wait / 1000)}s`)
      this.retry = setTimeout(() => this.open(URL_DEFAULT, false), wait)
    })
    ws.on('error', () => ws.terminate())
  }
}

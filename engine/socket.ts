import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * A WebSocket with the small part of the Node `ws` package's style the connectors were written
 * for (on/send/close/terminate), so their logic carries over unchanged.
 *
 * Most connections use the browser's own WebSocket. Kick's live server only accepts connections
 * that come from kick.com, which a page can't claim, so those are opened by the core instead.
 */
type Handler = (...args: any[]) => void

interface Backend {
  readonly readyState: number
  send(data: string): void
  close(code?: number): void
}

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

/** A socket the core opens and relays (see core/src/sockets.rs). */
class CoreBackend implements Backend {
  readyState = CONNECTING
  private id = 0
  private stops: UnlistenFn[] = []
  private pending: string[] = []
  private closing = false

  constructor(url: string, private emit: (event: string, ...args: unknown[]) => void) {
    void this.open(url)
  }

  private async open(url: string): Promise<void> {
    // Events for this socket are told apart by id; the listeners are ready before it opens.
    const early: { kind: string; p: any }[] = []
    const route = (kind: string, p: any): void => {
      if (!this.id) return void early.push({ kind, p })
      if (p.id !== this.id) return
      if (kind === 'open') {
        this.readyState = OPEN
        for (const d of this.pending.splice(0)) void invoke('ws_send', { id: this.id, data: d })
        this.emit('open')
      } else if (kind === 'message') this.emit('message', p.data)
      else this.finish(p.code ?? 1006, p.reason ?? '')
    }
    try {
      this.stops.push(await listen<any>('ws:open', (e) => route('open', e.payload)))
      this.stops.push(await listen<any>('ws:message', (e) => route('message', e.payload)))
      this.stops.push(await listen<any>('ws:close', (e) => route('close', e.payload)))
      this.id = await invoke<number>('ws_open', { url })
      for (const e of early) route(e.kind, e.p)
      if (this.closing) void invoke('ws_close', { id: this.id })
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      this.finish(1006, String(err))
    }
  }

  private finish(code: number, reason: string): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    for (const s of this.stops) s()
    this.emit('close', code, reason)
  }

  send(data: string): void {
    if (this.readyState === OPEN) void invoke('ws_send', { id: this.id, data })
    else if (this.readyState === CONNECTING) this.pending.push(data)
  }

  close(): void {
    this.closing = true
    if (this.id) void invoke('ws_close', { id: this.id })
  }
}

/** The browser's own WebSocket. */
class PageBackend implements Backend {
  private ws: WebSocket

  constructor(url: string, emit: (event: string, ...args: unknown[]) => void) {
    this.ws = new WebSocket(url)
    this.ws.addEventListener('open', () => emit('open'))
    // Text arrives as a string; `toString()` on it gives the same text as `ws` did.
    this.ws.addEventListener('message', (e) => emit('message', e.data))
    this.ws.addEventListener('error', () => emit('error', new Error('Connection error.')))
    this.ws.addEventListener('close', (e) => emit('close', e.code, e.reason))
  }

  get readyState(): number {
    return this.ws.readyState
  }

  send(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data)
  }

  close(code?: number): void {
    try { this.ws.close(code) } catch { /* already closed */ }
  }
}

const viaCore = (url: string): boolean => {
  try {
    const host = new URL(url).hostname
    return host === 'kick.com' || host.endsWith('.kick.com')
  } catch {
    return false
  }
}

export class Socket {
  static readonly OPEN = 1
  readonly OPEN = 1
  private backend: Backend
  private handlers: Record<string, Handler[]> = {}
  private timer: ReturnType<typeof setTimeout> | null = null

  /** `handshakeTimeout` closes the socket if it hasn't opened in time. Other options are ignored. */
  constructor(url: string, options?: { handshakeTimeout?: number; headers?: Record<string, string> }) {
    const emit = (event: string, ...args: unknown[]): void => {
      if (event === 'open' || event === 'close') this.clear()
      for (const h of this.handlers[event] ?? []) h(...args)
    }
    this.backend = viaCore(url) ? new CoreBackend(url, emit) : new PageBackend(url, emit)
    if (options?.handshakeTimeout) this.timer = setTimeout(() => { if (this.backend.readyState !== OPEN) this.terminate() }, options.handshakeTimeout)
  }

  get readyState(): number {
    return this.backend.readyState
  }

  on(event: 'open' | 'message' | 'close' | 'error', handler: Handler): this {
    ;(this.handlers[event] ??= []).push(handler)
    return this
  }

  /** Forgets the handlers for one event (or all), so a socket being replaced can't report anything more. */
  removeAllListeners(event?: string): this {
    if (event) delete this.handlers[event]
    else this.handlers = {}
    return this
  }

  send(data: string): void {
    this.backend.send(data)
  }

  close(code?: number): void {
    this.backend.close(code)
  }

  /** Drops the connection at once. */
  terminate(): void {
    this.close()
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

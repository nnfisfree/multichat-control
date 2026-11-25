import { Socket as WebSocket } from './socket'
import type { ObsState, ObsStats } from '../shared/types'
import { core } from './core'
import { backoff } from './net'
import { store } from './store'

// Qt WebChannel message types
const PROPERTY_UPDATE = 2
const INIT = 3
const IDLE = 4
const RESPONSE = 10
const TICK_MS = 1000

/**
 * Meld Studio's WebChannel API (the one its Stream Deck plugin uses). It isn't obs-websocket and
 * only shares whether Meld is live or recording; no FPS, CPU, bitrate or dropped frames. We time
 * the stream ourselves from the moment it went live. Read-only.
 */
export class MeldLink {
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private tick: ReturnType<typeof setInterval> | null = null
  private state: ObsState = { status: 'off' }
  // its API doesn't say, so this comes from the running .exe
  private version: string | undefined
  // property indexes from the init reply; updates refer to properties by index
  private idx = { streaming: -1, recording: -1 }
  private live: { on: boolean; since: number; known: boolean } = { on: false, since: 0, known: false }
  private rec: { on: boolean; since: number } = { on: false, since: 0 }

  constructor(private send: (s: ObsState) => void) {}

  get(): ObsState {
    return this.state
  }

  private set(next: ObsState): void {
    if (next.status === 'connected' && !store.settings.obsSetUp) store.saveSettings({ obsSetUp: true })
    this.state = next
    this.send(next)
  }

  start(): void {
    this.stop()
    const run = ++this.run
    if (!store.settings.obsEnabled) return this.set({ status: 'off' })
    this.set({ status: 'connecting' })
    this.open(run)
  }

  stop(): void {
    this.run++
    if (this.timer) clearTimeout(this.timer)
    if (this.tick) clearInterval(this.tick)
    this.timer = this.tick = null
    this.ws?.close()
    this.ws = null
  }

  private apply(streaming: boolean, recording: boolean, first: boolean): void {
    const now = Date.now()
    // already live when we connected: we can't know since when, so the clock stays hidden
    if (streaming && !this.live.on) this.live = { on: true, since: now, known: !first }
    else if (!streaming) this.live = { on: false, since: 0, known: false }
    if (recording && !this.rec.on) this.rec = { on: true, since: now }
    else if (!recording) this.rec = { on: false, since: 0 }
  }

  private emit(): void {
    const now = Date.now()
    const out: ObsStats = {
      app: 'meld',
      version: this.version,
      at: now,
      cpu: 0, memoryMb: 0, diskMb: 0, fps: 0, renderMs: 0,
      renderMissed: 0, renderTotal: 0, encodeSkipped: 0, encodeTotal: 0,
      stream: { active: this.live.on, reconnecting: false, durationMs: this.live.on ? now - this.live.since : 0, durationKnown: this.live.known, dropped: 0, total: 0, bytes: 0 },
      record: { active: this.rec.on, paused: false, durationMs: this.rec.on ? now - this.rec.since : 0, bytes: 0 }
    }
    this.set({ status: 'connected', stats: out })
  }

  private open(run: number): void {
    const port = Number(store.settings.meldPort) || 13376
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 5000 })
    this.ws = ws
    let refused = false
    ws.on('open', () => ws.send(JSON.stringify({ type: INIT, id: 0 })))
    ws.on('message', (raw) => {
      if (run !== this.run) return
      let msg: any
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (msg.type === RESPONSE && msg.id === 0) {
        const meld = msg.data?.meld
        if (!meld?.properties) {
          refused = true
          this.set({ status: 'error', detail: `Something other than Meld Studio answered on port ${port}.` })
          return ws.close()
        }
        // each property is [index, name, notify signal, value]
        const find = (name: string): [number, unknown] => {
          const p = (meld.properties as any[]).find((x) => x?.[1] === name)
          return p ? [Number(p[0]), p[3]] : [-1, false]
        }
        const [si, sv] = find('isStreaming')
        const [ri, rv] = find('isRecording')
        this.idx = { streaming: si, recording: ri }
        this.live = { on: false, since: 0, known: false }
        this.rec = { on: false, since: 0 }
        this.apply(!!sv, !!rv, true)
        this.attempt = 0
        this.version = undefined
        void core.streamAppVersion('meld').then((v) => { if (run === this.run && v) { this.version = v; this.emit() } }, () => {})
        ws.send(JSON.stringify({ type: IDLE }))
        this.emit()
        // re-send every second so the uptime keeps going
        if (this.tick) clearInterval(this.tick)
        this.tick = setInterval(() => this.emit(), TICK_MS)
      } else if (msg.type === PROPERTY_UPDATE && Array.isArray(msg.data)) {
        let streaming = this.live.on
        let recording = this.rec.on
        for (const u of msg.data) {
          if (u?.object !== 'meld' || !u.properties) continue
          if (this.idx.streaming in u.properties) streaming = !!u.properties[this.idx.streaming]
          if (this.idx.recording in u.properties) recording = !!u.properties[this.idx.recording]
        }
        // Meld waits for this before sending the next batch
        ws.send(JSON.stringify({ type: IDLE }))
        if (streaming !== this.live.on || recording !== this.rec.on) {
          this.apply(streaming, recording, false)
          this.emit()
        }
      }
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      if (run !== this.run || ws !== this.ws) return
      if (this.tick) clearInterval(this.tick)
      this.tick = null
      if (refused) return
      this.set({ status: 'connecting', detail: `Waiting for Meld Studio on port ${port}. Is Meld open?` })
      this.timer = setTimeout(() => this.open(run), Math.min(15000, backoff(this.attempt++)))
    })
  }
}

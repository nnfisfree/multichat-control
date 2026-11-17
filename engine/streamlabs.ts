import { Socket as WebSocket } from './socket'
import type { ObsState, ObsStats } from '../shared/types'
import { core } from './core'
import { backoff } from './net'
import { store } from './store'

const POLL_MS = 1000
const AUTH_ID = 1

/**
 * Stream health from Streamlabs Desktop's Remote Control API: JSON-RPC over SockJS, which also
 * answers plain WebSockets on <prefix>/websocket. It isn't obs-websocket, and it shares less than
 * OBS does: CPU, FPS, bitrate and dropped frames, plus whether it's live or recording. Read-only.
 */
export class StreamlabsLink {
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private pending = new Map<number, (data: any) => void>()
  private seq = AUTH_ID
  private busy = false
  private state: ObsState = { status: 'off' }

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
    void core.secretState().then((s) => {
      if (run !== this.run) return
      if (!s.slToken) return this.set({ status: 'error', detail: 'Paste your Streamlabs API token in Settings → Connections → Streaming app.' })
      this.open(run)
    })
  }

  stop(): void {
    this.run++
    if (this.timer) clearTimeout(this.timer)
    if (this.poll) clearInterval(this.poll)
    this.timer = this.poll = null
    this.pending.clear()
    this.busy = false
    this.ws?.close()
    this.ws = null
  }

  private open(run: number): void {
    const port = Number(store.settings.slPort) || 59650
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/websocket`, { handshakeTimeout: 5000 })
    this.ws = ws
    let refused = false
    ws.on('open', () => {
      void core.slobsAuth(AUTH_ID).then((frame) => {
        if (run !== this.run) return
        if (!frame) {
          refused = true
          this.set({ status: 'error', detail: 'Paste your Streamlabs API token in Settings → Connections → Streaming app.' })
          return ws.close()
        }
        ws.send(`${frame}\n`)
      })
    })
    ws.on('message', (raw) => {
      if (run !== this.run) return
      // replies end in a newline, and one frame can hold more than one
      for (const line of String(raw).split('\n')) {
        if (!line.trim()) continue
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === AUTH_ID) {
          if (msg.error || msg.result !== true) {
            refused = true
            this.set({ status: 'error', detail: 'Streamlabs refused the token. In Streamlabs Desktop, open Settings → Remote Control, click the QR code, then Show details, and copy the API Token again.' })
            return ws.close()
          }
          this.attempt = 0
          this.set({ status: 'connected', stats: this.state.stats })
          void this.refresh(run)
          this.poll = setInterval(() => void this.refresh(run), POLL_MS)
        } else if (typeof msg.id === 'number') {
          const done = this.pending.get(msg.id)
          if (done) {
            this.pending.delete(msg.id)
            done(msg.error ? null : msg.result ?? null)
          }
        }
      }
    })
    ws.on('error', () => {})
    ws.on('close', () => {
      if (run !== this.run || ws !== this.ws) return
      if (this.poll) clearInterval(this.poll)
      this.poll = null
      if (refused) return
      this.set({ status: 'connecting', detail: `Waiting for Streamlabs Desktop on port ${port}. Is it open, with Remote Control turned on?` })
      this.timer = setTimeout(() => this.open(run), Math.min(15000, backoff(this.attempt++)))
    })
  }

  private request(resource: string, method: string): Promise<any> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== 1) return resolve(null)
      const id = ++this.seq
      this.pending.set(id, resolve)
      this.ws.send(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: { resource, args: [] } })}\n`)
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null)
      }, 4000)
    })
  }

  private async refresh(run: number): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const [perf, st] = await Promise.all([this.request('PerformanceService', 'getModel'), this.request('StreamingService', 'getModel')])
      if (run !== this.run || !perf || !st) return
      const now = Date.now()
      const since = (iso: unknown): number => {
        const t = typeof iso === 'string' ? Date.parse(iso) : NaN
        return Number.isFinite(t) ? Math.max(0, now - t) : 0
      }
      const live = st.streamingStatus === 'live' || st.streamingStatus === 'reconnecting'
      const recording = st.recordingStatus === 'recording'
      const out: ObsStats = {
        app: 'streamlabs',
        at: now,
        cpu: Number(perf.CPU) || 0,
        memoryMb: 0,
        diskMb: 0,
        fps: Number(perf.frameRate) || 0,
        renderMs: 0,
        renderMissed: 0,
        renderTotal: 0,
        encodeSkipped: 0,
        encodeTotal: 0,
        stream: {
          active: live,
          reconnecting: st.streamingStatus === 'reconnecting',
          durationMs: live ? since(st.streamingStatusTime) : 0,
          dropped: Number(perf.numberDroppedFrames) || 0,
          total: 0,
          droppedPct: Number(perf.percentageDroppedFrames) || 0,
          bytes: 0,
          kbps: live ? Math.round(Number(perf.bandwidth) || 0) : undefined
        },
        record: { active: recording, paused: false, durationMs: recording ? since(st.recordingStatusTime) : 0, bytes: 0 }
      }
      this.set({ status: 'connected', stats: out })
    } finally {
      this.busy = false
    }
  }
}

import { Socket as WebSocket } from './socket'
import type { ObsState, ObsStats } from '../shared/types'
import { core } from './core'
import { backoff } from './net'
import { store } from './store'

const POLL_MS = 2000
/** Encoder and video settings rarely change, so they are read less often. */
const SETUP_MS = 30000

/** OBS's encoder IDs differ between versions and output modes; this names them in plain words. */
export function encoderName(id: string): string {
  const e = id.toLowerCase()
  const codec = /hevc|h265|265/.test(e) ? 'HEVC' : /av1/.test(e) ? 'AV1' : 'H.264'
  if (e.includes('nvenc')) return `NVIDIA NVENC ${codec}`
  if (e.includes('amf') || /^amd/.test(e)) return `AMD AMF ${codec}`
  if (e.includes('qsv')) return `Intel Quick Sync ${codec}`
  if (e.includes('videotoolbox') || e.includes('apple')) return `Apple VideoToolbox ${codec}`
  if (e.includes('x264')) return 'x264 (software)'
  if (e.includes('svt_av1') || e.includes('aom')) return 'AV1 (software)'
  return id
}
/**
 * Reads stream health from OBS through its built-in WebSocket server (OBS 28 and newer,
 * protocol v5). Only reads: it never changes scenes, starts or stops anything.
 */
export class ObsLink {
  private ws: WebSocket | null = null
  private run = 0
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<string, (data: any) => void>()
  private seq = 0
  private state: ObsState = { status: 'off' }
  private setup: { at: number; encoder?: string; output?: ObsStats['output'] } | null = null

  /** Reads the stream encoder from the current profile, and the output size and frame rate. */
  private async readSetup(): Promise<void> {
    if (this.setup && Date.now() - this.setup.at < SETUP_MS) return
    const param = async (category: string, name: string): Promise<string> =>
      String((await this.request('GetProfileParameter', { parameterCategory: category, parameterName: name }))?.parameterValue ?? '')
    const mode = await param('Output', 'Mode')
    // Advanced output mode keeps its encoder elsewhere than Simple mode.
    const id = mode === 'Advanced' ? await param('AdvOut', 'Encoder') : await param('SimpleOutput', 'StreamEncoder')
    const video = await this.request('GetVideoSettings')
    const fps = video?.fpsDenominator ? Number(video.fpsNumerator) / Number(video.fpsDenominator) : 0
    // In Advanced mode the stream encoder can rescale again, after the output scaling.
    let stream: { width: number; height: number } | undefined
    if (mode === 'Advanced' && /^true$/i.test(await param('AdvOut', 'Rescale'))) {
      const m = /^(\d+)x(\d+)$/i.exec(await param('AdvOut', 'RescaleRes'))
      if (m) stream = { width: Number(m[1]), height: Number(m[2]) }
    }
    this.setup = {
      at: Date.now(),
      encoder: id ? encoderName(id) : undefined,
      output: video?.outputWidth ? {
        width: Number(video.outputWidth), height: Number(video.outputHeight), fps: Math.round(fps * 100) / 100,
        canvas: video.baseWidth ? { width: Number(video.baseWidth), height: Number(video.baseHeight) } : undefined,
        stream
      } : undefined
    }
  }

  /** The previous byte count, to work out the bitrate. */
  private last: { bytes: number; at: number; recBytes: number } | null = null

  constructor(private send: (s: ObsState) => void) {}

  get(): ObsState {
    return this.state
  }

  private set(next: ObsState): void {
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
    for (const t of [this.timer, this.poll]) if (t) clearTimeout(t)
    if (this.poll) clearInterval(this.poll)
    this.timer = this.poll = null
    this.pending.clear()
    this.last = null
    this.setup = null
    this.ws?.close()
    this.ws = null
  }

  private open(run: number): void {
    const port = Number(store.settings.obsPort) || 4455
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 5000 })
    this.ws = ws
    let refused = false
    ws.on('message', (raw) => {
      if (run !== this.run) return
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.op === 0) {
        // Hello: answer with the password proof if OBS asks for one.
        // The password stays in the core, which computes the proof OBS asks for.
        const auth = msg.d?.authentication
        void (async () => {
          if (auth && !(await core.secretState()).obsPassword) {
            refused = true
            this.set({ status: 'error', detail: 'OBS asks for a password. Add it in Settings → OBS Studio.' })
            return ws.close()
          }
          const authentication = auth ? await core.obsAuth(auth.salt, auth.challenge) : undefined
          if (run === this.run) ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: 0 } }))
        })()
      } else if (msg.op === 2) {
        this.attempt = 0
        this.set({ status: 'connected', stats: this.state.stats })
        void this.refresh(run)
        this.poll = setInterval(() => void this.refresh(run), POLL_MS)
      } else if (msg.op === 7) {
        const done = this.pending.get(msg.d?.requestId)
        if (done) {
          this.pending.delete(msg.d.requestId)
          done(msg.d?.requestStatus?.result ? msg.d.responseData ?? {} : null)
        }
      }
    })
    ws.on('error', () => {})
    ws.on('close', (code) => {
      if (run !== this.run || ws !== this.ws) return
      if (this.poll) clearInterval(this.poll)
      this.poll = null
      this.last = null
      // 4009 is OBS's "wrong password": retrying can't fix it.
      if (code === 4009) return this.set({ status: 'error', detail: 'OBS refused the password. In OBS, open Tools → WebSocket Server Settings → Show Connect Info and copy the Server Password again.' })
      if (refused) return
      this.set({ status: 'connecting', detail: `Waiting for OBS on port ${port}. Is OBS open, with its WebSocket server on?` })
      this.timer = setTimeout(() => this.open(run), Math.min(15000, backoff(this.attempt++)))
    })
  }

  private request(type: string, data?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return resolve(null)
      const id = `r${++this.seq}`
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, ...(data ? { requestData: data } : {}) } }))
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(null)
      }, 4000)
    })
  }

  private async refresh(run: number): Promise<void> {
    await this.readSetup().catch(() => {})
    const [stats, stream, record] = await Promise.all([this.request('GetStats'), this.request('GetStreamStatus'), this.request('GetRecordStatus')])
    if (run !== this.run || !stats) return
    const now = Date.now()
    const bytes = Number(stream?.outputBytes) || 0
    const recBytes = Number(record?.outputBytes) || 0
    const since = this.last ? (now - this.last.at) / 1000 : 0
    // Bits sent since the last check, per second. A restart of the output resets the count.
    const kbps = (b: number, prev: number | undefined): number | undefined =>
      since > 0 && prev !== undefined && b >= prev ? Math.round(((b - prev) * 8) / since / 1000) : undefined
    const out: ObsStats = {
      at: now,
      cpu: Number(stats.cpuUsage) || 0,
      memoryMb: Number(stats.memoryUsage) || 0,
      diskMb: Number(stats.availableDiskSpace) || 0,
      fps: Number(stats.activeFps) || 0,
      renderMs: Number(stats.averageFrameRenderTime) || 0,
      encoder: this.setup?.encoder,
      output: this.setup?.output,
      renderMissed: Number(stats.renderSkippedFrames) || 0,
      renderTotal: Number(stats.renderTotalFrames) || 0,
      encodeSkipped: Number(stats.outputSkippedFrames) || 0,
      encodeTotal: Number(stats.outputTotalFrames) || 0,
      stream: {
        active: !!stream?.outputActive,
        reconnecting: !!stream?.outputReconnecting,
        durationMs: Number(stream?.outputDuration) || 0,
        dropped: Number(stream?.outputSkippedFrames) || 0,
        total: Number(stream?.outputTotalFrames) || 0,
        bytes,
        kbps: stream?.outputActive ? kbps(bytes, this.last?.bytes) : undefined
      },
      record: {
        active: !!record?.outputActive,
        paused: !!record?.outputPaused,
        durationMs: Number(record?.outputDuration) || 0,
        bytes: recBytes,
        kbps: record?.outputActive ? kbps(recBytes, this.last?.recBytes) : undefined
      }
    }
    this.last = { bytes, at: now, recBytes }
    this.set({ status: 'connected', stats: out })
  }
}

import { useEffect, useRef, useState, type JSX } from 'react'

/** A clock that ticks every second while something is live or recording. */
function useSecondTick(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    // Ticks on the second boundary of the uptime, so it never skips or stalls.
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** OBS reports the uptime every 2 seconds; between reports it keeps counting here. */
/**
 * A fresh report can be a fraction behind the local count, so the shown uptime never steps
 * back; a big drop means a new stream started, and then it resets.
 */
let lastUptime = 0
const running = (durationMs: number, at: number, now: number): number => {
  const t = durationMs + Math.max(0, Math.min(now - at, 10000))
  if (t < lastUptime && lastUptime - t < 3000) return lastUptime
  lastUptime = t
  return t
}
import type { ObsStats } from '../../shared/types'
import { useStore } from '../lib/store'
import { ObsLogo } from './Icons'

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const pct = (part: number, total: number): string => (total ? `${((part / total) * 100).toFixed(1)}%` : '0.0%')
const mib = (bytes: number): string => `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
const kbps = (n?: number): string => (n === undefined ? '…' : `${n.toLocaleString()} kb/s`)

/** Dropped frames above 1% are worth a look, above 5% the stream is struggling. */
const dropTone = (s: ObsStats): string => {
  const r = s.stream.total ? s.stream.dropped / s.stream.total : 0
  return s.stream.reconnecting || r > 0.05 ? 'bad' : r > 0.01 ? 'warn' : ''
}

const size = (r: { width: number; height: number }): string => `${r.width}×${r.height}`

/** Canvas, scaled output and, if the encoder rescales again, what actually reaches the stream. */
function resolutionRows(s: ObsStats): [string, string][] {
  const o = s.output
  if (!o) return []
  const same = (a?: { width: number; height: number }, b?: { width: number; height: number }): boolean => !!a && !!b && a.width === b.width && a.height === b.height
  const rows: [string, string][] = []
  if (o.canvas) rows.push(['Canvas (base)', size(o.canvas)])
  rows.push(['Output (scaled)', `${size(o)} at ${o.fps} fps${same(o.canvas, o) ? ' (no scaling)' : ''}`])
  if (o.stream && !same(o.stream, o)) rows.push(['Sent to stream', `${size(o.stream)} (rescaled by the encoder)`])
  return rows
}

function Details({ s, now }: { s: ObsStats; now: number }): JSX.Element {
  const rows: [string, string][] = [
    ...(s.encoder ? [['Encoder', s.encoder] as [string, string]] : []),
    ...resolutionRows(s),
    ['CPU usage', `${s.cpu.toFixed(1)}%`],
    ['Memory usage', `${s.memoryMb.toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`],
    ['Disk space available', `${(s.diskMb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`],
    ['FPS', s.fps.toFixed(2)],
    ['Average time to render a frame', `${s.renderMs.toFixed(1)} ms`],
    ['Frames missed (rendering lag)', `${s.renderMissed.toLocaleString()} / ${s.renderTotal.toLocaleString()} (${pct(s.renderMissed, s.renderTotal)})`],
    ['Frames skipped (encoding lag)', `${s.encodeSkipped.toLocaleString()} / ${s.encodeTotal.toLocaleString()} (${pct(s.encodeSkipped, s.encodeTotal)})`]
  ]
  return (
    <div className="popover obs-details" role="dialog" aria-label="OBS stats">
      <dl>{rows.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}</dl>
      <table>
        <thead><tr><th>Output</th><th>Status</th><th>Dropped frames</th><th>Total data</th><th>Bitrate</th></tr></thead>
        <tbody>
          <tr>
            <td>Stream</td>
            <td>{s.stream.reconnecting ? 'Reconnecting' : s.stream.active ? `Live ${clock(running(s.stream.durationMs, s.at, now))}` : 'Inactive'}</td>
            <td>{s.stream.dropped.toLocaleString()} / {s.stream.total.toLocaleString()} ({pct(s.stream.dropped, s.stream.total)})</td>
            <td>{mib(s.stream.bytes)}</td>
            <td>{s.stream.active ? kbps(s.stream.kbps) : '0 kb/s'}</td>
          </tr>
          <tr>
            <td>Recording</td>
            <td>{s.record.paused ? 'Paused' : s.record.active ? `Recording ${clock(s.record.paused ? s.record.durationMs : s.record.durationMs + Math.max(0, Math.min(now - s.at, 10000)))}` : 'Inactive'}</td>
            <td>–</td>
            <td>{mib(s.record.bytes)}</td>
            <td>{s.record.active ? kbps(s.record.kbps) : '0 kb/s'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** A one-line summary of OBS's stats, shown where the connection bar was. Click for everything. */
export function ObsStrip({ onFix }: { onFix?(): void }): JSX.Element | null {
  const obs = useStore((s) => s.obs)
  const enabled = useStore((s) => s.settings?.obsEnabled ?? false)
  const demo = useStore((s) => !!s.boot?.demo)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const now = useSecondTick(!!obs.stats && (obs.stats.stream.active || obs.stats.record.active))
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if ((!enabled && !demo) || obs.status === 'off') return null
  const s = obs.stats
  if (obs.status !== 'connected' || !s) {
    // Not connected yet: one click opens the OBS settings to fix it.
    return (
      <button className={obs.status === 'error' ? 'obs-strip muted bad' : 'obs-strip muted'} title={`${obs.detail ?? 'Waiting for OBS'}. Click to open the OBS settings.`} onClick={onFix}>
        <ObsLogo size={13} /><span className="obs-dot" /> {obs.status === 'error' ? 'OBS: check password' : 'Waiting for OBS…'}
      </button>
    )
  }
  const live = s.stream.active
  const recording = s.record.active
  return (
    <div className="obs" ref={box}>
      <button className={`obs-strip ${live ? 'live' : ''}`} aria-expanded={open} title="OBS stats: click for details" onClick={() => setOpen(!open)}>
        <ObsLogo size={13} />
        {live
          ? <span className={s.stream.reconnecting ? 'obs-state bad' : 'obs-state live'}><span className="obs-dot" /> {s.stream.reconnecting ? 'RECONNECTING' : 'LIVE'} {clock(running(s.stream.durationMs, s.at, now))}</span>
          : <span className="obs-state"><span className="obs-dot ready" /> OBS ready</span>}
        {recording && <span className="obs-state rec"><span className="obs-dot" /> REC</span>}
        {live && <span className="obs-item obs-rate">⇡ {kbps(s.stream.kbps)}</span>}
        {live && <span className={`obs-item obs-drop ${dropTone(s)}`}>{pct(s.stream.dropped, s.stream.total)} dropped</span>}
        <span className="obs-item obs-fps">{Math.round(s.fps)} FPS</span>
        <span className="obs-item obs-cpu">CPU {s.cpu.toFixed(1)}%</span>
      </button>
      {open && <Details s={s} now={now} />}
    </div>
  )
}

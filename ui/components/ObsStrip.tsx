import { useEffect, useRef, useState, type JSX } from 'react'
import { STREAM_APPS, type ObsStats } from '../../shared/types'
import { useStore } from '../lib/store'
import { StreamAppLogo } from './Icons'
import { ObsGraph, recordObsSample } from './ObsGraph'

/** Ticks every second while we're live or recording. */
function useSecondTick(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    // poll at 250ms so the display flips right on the second boundary, never skips or stalls
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [on])
  return now
}

// OBS reports uptime every 2s and we keep counting locally in between. A fresh report can be a hair
// behind our local count, so never step backwards; a big drop means a new stream, so reset then.
let lastUptime = 0
const running = (durationMs: number, at: number, now: number): number => {
  const t = durationMs + Math.max(0, Math.min(now - at, 10000))
  if (t < lastUptime && lastUptime - t < 3000) return lastUptime
  lastUptime = t
  return t
}

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const pct = (part: number, total: number): string => (total ? `${((part / total) * 100).toFixed(1)}%` : '0.0%')
const mib = (bytes: number): string => `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
const kbps = (n?: number): string => (n === undefined ? '…' : `${n.toLocaleString()} kb/s`)

// Streamlabs gives the percentage itself, OBS gives the counts
const dropRatio = (s: ObsStats): number => (s.stream.droppedPct !== undefined ? s.stream.droppedPct / 100 : s.stream.total ? s.stream.dropped / s.stream.total : 0)
const dropText = (s: ObsStats): string => `${(dropRatio(s) * 100).toFixed(1)}%`
// >1% dropped is worth a look, >5% means the stream is struggling
const dropTone = (s: ObsStats): string => {
  const r = dropRatio(s)
  return s.stream.reconnecting || r > 0.05 ? 'bad' : r > 0.01 ? 'warn' : ''
}

const size = (r: { width: number; height: number }): string => `${r.width}×${r.height}`

/** Canvas, scaled output, and what actually goes to the stream if the encoder rescales again. */
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

const liveText = (s: ObsStats, now: number): string =>
  s.stream.reconnecting ? 'Reconnecting' : !s.stream.active ? 'Inactive' : s.stream.durationKnown === false ? 'Live' : `Live ${clock(running(s.stream.durationMs, s.at, now))}`
const recText = (s: ObsStats, now: number): string =>
  s.record.paused ? 'Paused' : s.record.active ? `Recording ${clock(s.record.durationMs + Math.max(0, Math.min(now - s.at, 10000)))}` : 'Inactive'

/** Streamlabs and Meld share less than OBS, so their panels only show what they really send. */
function LimitedDetails({ s, now }: { s: ObsStats; now: number }): JSX.Element {
  const meld = s.app === 'meld'
  return (
    <div className={`popover obs-details ${meld ? 'meld' : ''}`} role="dialog" aria-label={`${STREAM_APPS[s.app]} stats`}>
      {!meld && (
        <div className="obs-top">
          <dl>
            <dt>Streaming app</dt><dd>{STREAM_APPS[s.app]}</dd>
            <dt>CPU usage</dt><dd>{s.cpu.toFixed(1)}%</dd>
            <dt>FPS</dt><dd>{s.fps.toFixed(2)}</dd>
            <dt>Dropped frames</dt><dd>{s.stream.dropped.toLocaleString()} ({dropText(s)})</dd>
            <dt>Bitrate</dt><dd>{s.stream.active ? kbps(s.stream.kbps) : '0 kb/s'}</dd>
          </dl>
          <ObsGraph s={s} />
        </div>
      )}
      <table>
        <thead><tr><th>Output</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Stream</td><td>{liveText(s, now)}</td></tr>
          <tr><td>Recording</td><td>{recText(s, now)}</td></tr>
        </tbody>
      </table>
      <p className="obs-note">{meld
        ? "Meld Studio only shares whether you're live or recording, so there's no graph, bitrate, FPS or CPU here."
        : "Streamlabs Desktop doesn't share memory, disk, render times or the encoder."}</p>
    </div>
  )
}

function Details({ s, now }: { s: ObsStats; now: number }): JSX.Element {
  if (s.app && s.app !== 'obs') return <LimitedDetails s={s} now={now} />
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
      <div className="obs-top">
        <dl>{rows.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}</dl>
        <ObsGraph s={s} />
      </div>
      <table>
        <thead><tr><th>Output</th><th>Status</th><th>Dropped frames</th><th>Total data</th><th>Bitrate</th></tr></thead>
        <tbody>
          <tr>
            <td>Stream</td>
            <td>{liveText(s, now)}</td>
            <td>{s.stream.dropped.toLocaleString()} / {s.stream.total.toLocaleString()} ({pct(s.stream.dropped, s.stream.total)})</td>
            <td>{mib(s.stream.bytes)}</td>
            <td>{s.stream.active ? kbps(s.stream.kbps) : '0 kb/s'}</td>
          </tr>
          <tr>
            <td>Recording</td>
            <td>{recText(s, now)}</td>
            <td>–</td>
            <td>{mib(s.record.bytes)}</td>
            <td>{s.record.active ? kbps(s.record.kbps) : '0 kb/s'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// how long the go-live animation of the app icon plays
const LAUNCH_MS = 2600

/** One-line summary from the streaming app, under the message box. Hover for the graph, click for the full stats. */
export function ObsStrip({ onFix }: { onFix?(): void }): JSX.Element | null {
  const obs = useStore((s) => s.obs)
  const enabled = useStore((s) => s.settings?.obsEnabled ?? false)
  const demo = useStore((s) => !!s.boot?.demo)
  const app = useStore((s) => s.settings?.streamApp ?? 'obs')
  const [open, setOpen] = useState(false)
  // the app icon plays its animation when the stream goes live (not when we join one already live)
  const [launch, setLaunch] = useState(false)
  // last reading's app and live state; null while there are no stats (connecting, reconnecting)
  const was = useRef<{ app: string; live: boolean } | null>(null)
  const statsApp = obs.stats?.app ?? null
  const isLive = !!obs.stats?.stream.active
  useEffect(() => {
    const prev = was.current
    was.current = statsApp ? { app: statsApp, live: isLive } : null
    // only a real "not live → live" on the same app counts, not connecting to a stream already running
    if (prev && statsApp && prev.app === statsApp && !prev.live && isLive) setLaunch(true)
  }, [statsApp, isLive])
  useEffect(() => {
    if (!launch) return
    const t = setTimeout(() => setLaunch(false), LAUNCH_MS)
    return () => clearTimeout(t)
  }, [launch])
  // hovering the pill shows just the graph; it stays while the mouse is on the pill or the graph
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // after a click closes the full stats, don't pop the graph straight back until the mouse leaves
  const hush = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const now = useSecondTick(!!obs.stats && (obs.stats.stream.active || obs.stats.record.active))
  // keep the graph's history filling even while the popover is closed
  useEffect(() => { if (obs.stats) recordObsSample(obs.stats) }, [obs.stats])
  useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current) }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if ((!enabled && !demo) || obs.status === 'off') return null
  const s = obs.stats
  if (obs.status !== 'connected' || !s) {
    // not connected yet; clicking opens the OBS settings
    return (
      <button className={obs.status === 'error' ? 'obs-strip muted bad' : 'obs-strip muted'} title={`${obs.detail ?? 'Waiting for OBS'}. Click to open the OBS settings.`} onClick={onFix}>
        <StreamAppLogo app={app} size={13} /><span className="obs-dot" /> {obs.status === 'error' ? (app === 'streamlabs' ? 'SLOBS: check token' : app === 'meld' ? 'Meld: needs attention' : 'OBS: check password') : `Waiting for ${app === 'obs' ? 'OBS' : app === 'streamlabs' ? 'SLOBS' : 'Meld'}…`}
      </button>
    )
  }
  const live = s.stream.active
  const recording = s.record.active
  const full = s.app !== 'meld'
  const short = s.app === 'streamlabs' ? 'SLOBS' : s.app === 'meld' ? 'Meld' : 'OBS'
  const hover = (on: boolean): void => {
    if (peekTimer.current) clearTimeout(peekTimer.current)
    if (!on) hush.current = false
    // short delays: no flash when the mouse just passes by, and time to cross the gap up to the graph
    // Meld has no numbers to graph
    peekTimer.current = setTimeout(() => setPeek(on && !hush.current && full), on ? 120 : 220)
  }
  const click = (): void => {
    if (open) hush.current = true
    setPeek(false)
    setOpen(!open)
  }
  return (
    <div className="obs" ref={box} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button className={`obs-strip ${live ? 'live' : ''}`} aria-expanded={open} title={open || peek ? undefined : `${short} stats: click for details`} onClick={click}>
        <span className={`app-logo app-${s.app}${live ? ' on-air' : ''}${launch ? ' launch' : ''}`} aria-hidden="true"><StreamAppLogo app={s.app} size={16} /></span>
        {live
          ? <span className={s.stream.reconnecting ? 'obs-state bad' : 'obs-state live'}><span className="obs-dot" /> {s.stream.reconnecting ? 'RECONNECTING' : 'LIVE'}{s.stream.durationKnown === false ? '' : ` ${clock(running(s.stream.durationMs, s.at, now))}`}</span>
          : <span className="obs-state"><span className="obs-dot ready" /> {short} ready</span>}
        {recording && <span className="obs-state rec"><span className="obs-dot" /> REC</span>}
        {full && live && <span className="obs-item obs-rate">⇡ {kbps(s.stream.kbps)}</span>}
        {full && live && <span className={`obs-item obs-drop ${dropTone(s)}`}>{dropText(s)} dropped</span>}
        {full && <span className="obs-item obs-fps">{Math.round(s.fps)} FPS</span>}
        {full && <span className="obs-item obs-cpu">CPU {s.cpu.toFixed(1)}%</span>}
      </button>
      {open ? <Details s={s} now={now} /> : peek && <div className="popover obs-peek" role="dialog" aria-label="OBS graph"><ObsGraph s={s} /></div>}
    </div>
  )
}

import { useMemo, useState, type JSX } from 'react'
import type { ObsStats } from '../../shared/types'

/** One reading per OBS poll (every second). Values are null when they don't apply (not live, first sample). */
interface Sample { at: number; kbps: number | null; fps: number; cpu: number; drops: number | null }

const WINDOW_MS = 60000
// a gap longer than this between two readings breaks the line instead of drawing across it
const GAP_MS = 2600
const history: Sample[] = []
let prev: ObsStats | null = null

/** Remember a reading. Called once per stats update, whether or not the graph is open, so it has history when opened. */
export function recordObsSample(s: ObsStats): void {
  if (prev?.at === s.at) return
  const out = s.stream.active ? s.stream : s.record.active ? s.record : null
  const dropped = prev && s.stream.active && prev.stream.active && s.stream.dropped >= prev.stream.dropped ? s.stream.dropped - prev.stream.dropped : null
  history.push({ at: s.at, kbps: out?.kbps ?? null, fps: s.fps, cpu: s.cpu, drops: dropped })
  while (history.length && s.at - history[0].at > WINDOW_MS + 2000) history.shift()
  prev = s
}

type Tab = 'kbps' | 'fps' | 'cpu' | 'drops'
const TABS: { id: Tab; label: string }[] = [
  { id: 'kbps', label: 'Bitrate' },
  { id: 'fps', label: 'FPS' },
  { id: 'cpu', label: 'CPU' },
  { id: 'drops', label: 'Drops' }
]
// the choice outlives the popover while the app is open
let lastTab: Tab | null = null

const niceCeil = (v: number): number => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  return (n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * p
}
const rate = (kb: number): string => (kb >= 1000 ? `${(kb / 1000).toFixed(kb >= 10000 ? 1 : 2)} Mb/s` : `${Math.round(kb)} kb/s`)

const H = 100 // viewBox height; width is 60 (one unit per second)

export function ObsGraph({ s }: { s: ObsStats }): JSX.Element {
  const [tab, setTab] = useState<Tab>(lastTab ?? (s.stream.active || s.record.active ? 'kbps' : 'fps'))
  const pick = (t: Tab): void => { lastTab = t; setTab(t) }

  // recomputed only when a new reading arrives or the tab changes, not on every clock tick
  const g = useMemo(() => {
    const end = s.at
    const pts = history.filter((h) => end - h.at <= WINDOW_MS)
    const val = (h: Sample): number | null => h[tab]
    const vals = pts.map(val).filter((v): v is number => v !== null)
    const peak = vals.length ? Math.max(...vals) : 0
    const target = s.output?.fps ?? 60
    const max = tab === 'fps' ? Math.max(target * 1.1, peak) : tab === 'cpu' ? niceCeil(Math.max(5, peak * 1.15)) : tab === 'drops' ? niceCeil(Math.max(5, peak * 1.15)) : niceCeil(Math.max(1000, peak * 1.15))
    const x = (at: number): number => 60 - (end - at) / 1000
    const y = (v: number): number => H - (Math.min(v, max) / max) * H

    // split into runs of consecutive readings, so gaps and "not live" stretches stay empty
    const runs: [number, number][][] = []
    let run: [number, number][] = []
    let last = 0
    for (const h of pts) {
      const v = val(h)
      if (v === null || (run.length && h.at - last > GAP_MS)) { if (run.length) runs.push(run); run = [] }
      if (v !== null) run.push([x(h.at), y(v)])
      last = h.at
    }
    if (run.length) runs.push(run)
    const line = runs.map((r) => (r.length === 1 ? `M${r[0][0] - 0.5},${r[0][1]}h1` : `M${r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(1)}`).join('L')}`)).join('')
    const area = runs.filter((r) => r.length > 1).map((r) => `M${r[0][0].toFixed(2)},${H}L${r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(1)}`).join('L')}L${r[r.length - 1][0].toFixed(2)},${H}Z`).join('')

    const cur = pts.length ? val(pts[pts.length - 1]) : null
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    // dashed guide: the target FPS, or the average for the others (like Task Manager's peak line)
    const guide = tab === 'fps' ? target : tab === 'kbps' && avg !== null ? avg : null
    return { line, area, cur, avg, peak, max, guide: guide === null ? null : y(guide), target }
  }, [s.at, tab, s.output?.fps])

  const fmt = (v: number | null): string => {
    if (v === null) return tab === 'kbps' ? 'Not live' : '–'
    if (tab === 'kbps') return rate(v)
    if (tab === 'fps') return v.toFixed(v % 1 ? 1 : 0)
    if (tab === 'cpu') return `${v.toFixed(1)}%`
    return `${v}/s`
  }
  const maxLabel = tab === 'kbps' ? rate(g.max) : tab === 'cpu' ? `${g.max}%` : tab === 'drops' ? `${g.max}/s` : `${Math.round(g.max)}`
  const sub = tab === 'fps' ? `target ${g.target}` : tab === 'kbps' && g.avg !== null ? `avg ${rate(g.avg)}` : tab === 'drops' && g.avg !== null ? `peak ${g.peak}/s` : tab === 'cpu' && g.avg !== null ? `avg ${g.avg.toFixed(1)}%` : ''
  const tone = tab === 'drops' && (g.cur ?? 0) > 0 ? 'bad' : tab === 'fps' && g.cur !== null && g.cur < g.target * 0.9 ? 'warn' : ''

  return (
    <div className={`obs-graph g-${tab}`}>
      <div className="obs-graph-tabs" role="tablist" aria-label="Graph">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)}>{t.label}</button>)}
      </div>
      <div className="obs-graph-now">
        <span className={`v ${tone}`}>{fmt(g.cur)}</span>
        <span className="sub">{sub}</span>
      </div>
      <div className="obs-graph-plot">
        <svg viewBox={`0 0 60 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {[10, 20, 30, 40, 50].map((gx) => <line key={gx} className="grid" x1={gx} x2={gx} y1={0} y2={H} />)}
          {[25, 50, 75].map((gy) => <line key={gy} className="grid" x1={0} x2={60} y1={gy} y2={gy} />)}
          {g.guide !== null && <line className="guide" x1={0} x2={60} y1={g.guide} y2={g.guide} />}
          <path className="area" d={g.area} />
          <path className="line" d={g.line} />
        </svg>
        <span className="lbl top">{maxLabel}</span>
        <span className="lbl bl">60 s</span>
        <span className="lbl br">0</span>
      </div>
    </div>
  )
}

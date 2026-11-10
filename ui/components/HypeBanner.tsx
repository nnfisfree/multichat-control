import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icons'
import { useStore } from '../lib/store'
import type { Tab } from './Tabs'

const TITLE = { regular: 'Hype Train', golden_kappa: 'Golden Kappa Train', treasure: 'Treasure Train' }

const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Pinned above chat while a train runs, and gone when its timer ends. */
export function HypeBanner({ tab }: { tab: Tab }): JSX.Element | null {
  const train = useStore((s) => s.hype)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!train) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [train])

  if (!train || now > train.expiresAt || (tab !== 'all' && tab !== train.platform)) return null
  const percent = train.goal ? Math.min(100, Math.round((train.progress / train.goal) * 100)) : 0

  return (
    <aside className={`hype hype-${train.type}`} aria-label="Hype Train">
      <span className="hype-level"><small>LEVEL</small>{train.level}</span>
      <div className="hype-main">
        <div className="hype-head">
          <span className="hype-title"><Icon.train /> {TITLE[train.type]}</span>
          <span className="hype-percent">{percent}%</span>
          <time>{clock(train.expiresAt - now)}</time>
        </div>
        <div className="hype-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div>
        {train.top.length > 0 && (
          <div className="hype-top">{train.top.map((c) => <span key={`${c.name}-${c.kind}`}><b>{c.name}</b> {c.kind === 'bits' ? `${c.total} bits` : c.kind === 'subscription' ? 'subs' : c.total}</span>)}</div>
        )}
      </div>
    </aside>
  )
}

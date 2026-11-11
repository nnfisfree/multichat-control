import { useEffect, useState, type JSX } from 'react'
import { Icon, PlatformIcon } from './Icons'
import { useStore } from '../lib/store'

const left = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

/**
 * The message pinned in Twitch chat, at the top of chat. It steps aside while a Hype Train
 * banner shows, and comes back when the train ends. During a raid it always shows, under the raid bar.
 */
export function PinnedBar(): JSX.Element | null {
  const pinned = useStore((s) => s.pinned)
  const hype = useStore((s) => s.hype)
  const raid = useStore((s) => s.raid)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!pinned?.endsAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pinned?.endsAt])
  if (!pinned || (hype && !raid) || (pinned.endsAt && pinned.endsAt <= now)) return null
  return (
    <div className="pinned-bar" role="status">
      <span className="pinned-icon" aria-hidden="true"><Icon.pin /></span>
      <div className="pinned-body">
        <div className="pinned-head"><PlatformIcon platform="twitch" size={13} /> Pinned{pinned.sender ? ` · ${pinned.sender}` : ''}{pinned.endsAt ? <span className="pinned-left"> · {left(pinned.endsAt - now)} left</span> : null}</div>
        <div className="pinned-text">{pinned.text}</div>
      </div>
      <button className="btn ghost sm" disabled={busy} onClick={() => { setBusy(true); void window.nnf.twitchCommand('/unpin').finally(() => setBusy(false)) }}>Unpin</button>
    </div>
  )
}

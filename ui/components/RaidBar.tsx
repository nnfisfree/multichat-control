import { useEffect, useState, type JSX } from 'react'
import { PlatformIcon } from './Icons'
import { useStore } from '../lib/store'

/** After the countdown, the bar waits this long for Twitch to say the raid went before leaving. */
const GRACE_MS = 20_000
/** Twitch unlocks its Raid Now button this long after a raid starts. */
const RAID_NOW_AFTER_MS = 10_000

const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const GameIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 6h10a5 5 0 0 1 4.9 6l-1 5a3 3 0 0 1-5.3 1.3L13.8 16h-3.6l-1.8 2.3A3 3 0 0 1 3.1 17l-1-5A5 5 0 0 1 7 6zm1 3v2H6v2h2v2h2v-2h2v-2h-2V9H8zm8.5 1a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm-2 2.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" /></svg>
)
const EyeIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>
)

/**
 * An outgoing Twitch raid during Twitch's 90-second countdown, above the pinned message: who is
 * being raided, what they play and for how many viewers, with the time left, Raid Now (unlocked
 * after Twitch's first 10 seconds) and Cancel.
 */
export function RaidBar(): JSX.Element | null {
  const raid = useStore((s) => s.raid)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<'now' | 'cancel' | null>(null)
  const [sent, setSent] = useState(false)
  const [note, setNote] = useState('')
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    if (!raid) return
    setNow(Date.now())
    setBroken(false)
    setSent(false)
    setNote('')
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [raid])

  if (!raid || now > raid.endsAt + GRACE_MS) return null
  const total = raid.endsAt - raid.startedAt
  const left = raid.endsAt - now
  const going = left <= 0 || sent
  const unlockIn = raid.startedAt + RAID_NOW_AFTER_MS - now
  const percent = sent ? 100 : Math.min(100, Math.max(0, ((now - raid.startedAt) / total) * 100))

  return (
    <aside className={`raid-bar${going ? ' going' : ''}`} aria-label={`Raiding ${raid.name}`}>
      <div className="raid-main">
        <span className="raid-avatar">
          {raid.avatar && !broken
            ? <img src={raid.avatar} alt="" draggable={false} onError={() => setBroken(true)} />
            : <span className="raid-initial">{raid.name.slice(0, 1).toUpperCase()}</span>}
          {raid.live && <span className="raid-live">LIVE</span>}
        </span>
        <div className="raid-body">
          <div className="raid-head">
            <PlatformIcon platform="twitch" size={13} />
            {going ? 'Raiding now…' : 'Raiding'}
          </div>
          <div className="raid-name">{raid.name}</div>
          <div className="raid-facts">
            {raid.game && <span title={raid.live ? 'Playing now' : 'Last category'}><GameIcon /> {raid.game}</span>}
            {raid.viewers !== undefined
              ? <span><EyeIcon /> {raid.viewers.toLocaleString()} {raid.viewers === 1 ? 'viewer' : 'viewers'}</span>
              : !raid.live && <span className="raid-offline">Offline</span>}
          </div>
          {raid.title && <div className="raid-title" title={raid.title}>{raid.title}</div>}
          {note && <div className="raid-note" role="alert">{note}</div>}
        </div>
        <div className="raid-side">
          <time aria-label="Time left">{going ? '0:00' : clock(left)}</time>
          <div className="raid-buttons">
            <button
              className="btn sm raid-now" disabled={!!busy || going || unlockIn > 0}
              title={unlockIn > 0 ? 'Twitch allows Raid Now 10 seconds after the raid starts' : 'Send the raid now, without waiting'}
              onClick={() => {
                setBusy('now')
                setNote('')
                void window.nnf.twitchCommand('/raidnow')
                  .then((r) => { if (r.ok) setSent(true); else setNote(r.message ?? 'Raid Now did not work.') })
                  .finally(() => setBusy(null))
              }}
            >{busy === 'now' ? 'Sending…' : unlockIn > 0 ? `Raid Now ${Math.ceil(unlockIn / 1000)}s` : 'Raid Now'}</button>
            <button className="btn sm raid-cancel" disabled={!!busy || going} onClick={() => { setBusy('cancel'); void window.nnf.twitchCommand('/unraid').finally(() => setBusy(null)) }}>Cancel</button>
          </div>
        </div>
      </div>
      <div className="raid-progress" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${percent}%` }} />
      </div>
    </aside>
  )
}

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ChannelStats, type Platform } from '../../shared/types'
import { PlatformIcon } from './Icons'
import { connected, useStore } from '../lib/store'

/** How often each platform is asked. YouTube's daily quota is small, so it's asked less often. */
const EVERY: Record<Platform, number> = { twitch: 60000, youtube: 5 * 60000, kick: 60000 }

/** 4,343 up to a million, then 1.2M. */
const show = (n: number): string => (n < 1_000_000 ? n.toLocaleString('en-US') : `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}M`)

const Heart = (): JSX.Element => (
  <svg className="stat-icon heart" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.4 10.6 20C5.400 15.400 2 12.300 2 8.500 2 5.400 4.400 3 7.500 3c1.700 0 3.400.8 4.500 2.100C13.100 3.800 14.800 3 16.500 3 19.600 3 22 5.400 22 8.500c0 3.800-3.400 6.900-8.600 11.500L12 21.400z" /></svg>
)
const Star = (): JSX.Element => (
  <svg className="stat-icon star" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 3.100 6.300 6.900 1-5 4.900 1.200 6.900L12 17.800l-6.200 3.300L7 14.200 2 9.300l6.900-1L12 2z" /></svg>
)

/** One platform's pill: its logo, then the follower-like count (heart) and the subscriber-like one (star). */
function Pill({ p, s }: { p: Platform; s: ChannelStats }): JSX.Element | null {
  // YouTube has no followers: its subscribers are the people who follow the channel.
  const follow = p === 'youtube' ? s.subscribers : s.followers
  const sub = p === 'youtube' ? undefined : s.subscribers
  if (follow === undefined && sub === undefined) return null
  const followWord = p === 'youtube' ? 'Subscribers' : 'Followers'
  const lines = [
    follow !== undefined && `${followWord}: ${follow.toLocaleString('en-US')}${s.rounded ? ' (YouTube rounds this number)' : ''}`,
    sub !== undefined && `Subscribers: ${sub.toLocaleString('en-US')}${s.gifted ? ` (${s.gifted.toLocaleString('en-US')} gifted)` : ''}`
  ].filter(Boolean)
  return (
    <span className={`stat-pill ${p}`} title={`${PLATFORM_LABEL[p]}\n${lines.join('\n')}`} aria-label={`${PLATFORM_LABEL[p]}: ${lines.join(', ')}`}>
      <span className="stat-logo"><PlatformIcon platform={p} size={12} /></span>
      {follow !== undefined && <span className="stat"><Heart /><b>{show(follow)}</b></span>}
      {sub !== undefined && <span className="stat"><Star /><b>{show(sub)}</b></span>}
    </span>
  )
}

/**
 * Followers and subscribers of every connected platform, in the middle of the row under the
 * message box. Refreshed on a timer, and soon after a follow or sub arrives.
 */
export function ChannelStatsBar(): JSX.Element | null {
  const statuses = useStore((s) => s.statuses)
  const events = useStore((s) => s.events)
  const live = PLATFORMS.filter((p) => connected(statuses, p))
  const liveKey = live.join(',')
  const [stats, setStats] = useState<Partial<Record<Platform, ChannelStats>>>({})
  const asked = useRef<Partial<Record<Platform, number>>>({})

  const load = (p: Platform): void => {
    asked.current[p] = Date.now()
    void window.nnf.stats(p).then((r) => setStats((prev) => ({ ...prev, [p]: r ?? undefined })), () => {})
  }

  // Ask each connected platform now, then whenever its interval has passed.
  useEffect(() => {
    const ps = liveKey ? (liveKey.split(',') as Platform[]) : []
    setStats((prev) => Object.fromEntries(Object.entries(prev).filter(([p]) => ps.includes(p as Platform))))
    for (const p of ps) if (Date.now() - (asked.current[p] ?? 0) > 5000) load(p)
    const t = setInterval(() => {
      for (const p of ps) if (Date.now() - (asked.current[p] ?? 0) >= EVERY[p]) load(p)
    }, 15000)
    return () => clearInterval(t)
  }, [liveKey])

  // A new follow or sub: read that platform again a few seconds later (YouTube waits for its timer).
  const latest = useMemo(() => {
    const out: Partial<Record<Platform, string>> = {}
    for (const e of events) if (!e.history && (e.type === 'follow' || e.type === 'sub' || e.type === 'gift')) out[e.platform] = e.id
    return out
  }, [events])
  const latestKey = `${latest.twitch ?? ''}|${latest.kick ?? ''}`
  useEffect(() => {
    if (latestKey === '|') return
    const t = setTimeout(() => { for (const p of ['twitch', 'kick'] as Platform[]) if (latest[p] && connected(statuses, p)) load(p) }, 4000)
    return () => clearTimeout(t)
  }, [latestKey])

  const pills = live.map((p) => (stats[p] ? <Pill key={p} p={p} s={stats[p]!} /> : null)).filter(Boolean)
  if (!pills.length) return null
  return <div className="stats-bar" role="group" aria-label="Channel stats">{pills}</div>
}

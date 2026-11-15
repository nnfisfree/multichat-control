import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { chatEventGroup, standaloneSource, subMonths } from '../../shared/events'
import type { EventFilter, StreamEvent } from '../../shared/types'
import { useStore } from '../lib/store'
import { EventCard } from './EventCard'

// One at a time. The next waits until the current one has fully left.
const MAX_SHOWN = 1
// cap the queue on busy streams, oldest waiting ones get dropped
const MAX_WAITING = 20
// skip anything this old on arrival (late history, reconnects)
const FRESH_MS = 60000
// fallback in case animationend never fires
const EXIT_MS = 1400
// big moments stay up this much longer than the Settings time
const BIG_STAY = 1.5
// cheers of at least this many bits count as big
const BIG_CHEER_BITS = 1000

/** One pop-up: a single event, or a run of similar ones (follow wave) merged together. */
interface Group {
  /** First event's id, so a growing group stays the same pop-up. */
  id: string
  /** Set when similar events are allowed to join. */
  key: string | null
  /** Newest event in the run. */
  e: StreamEvent
  /** Everyone in the run, oldest first. */
  names: string[]
  count: number
}
interface Shown extends Group { leaving: boolean }

/**
 * Only kinds that get a card in chat, filtered the same way as the Events drop-down (tips and BMC
 * follow the platform filter there too).
 */
const popsUp = (e: StreamEvent, f: EventFilter): boolean =>
  !e.history && !!chatEventGroup(e.type) && Date.now() - e.ts < FRESH_MS &&
  (!!standaloneSource(e) || f.platforms[e.platform]) && !f.hiddenTypes.includes(e.type)

/** Gift bombs, raids, Hype Trains, large donations and large cheers. */
const isBig = (e: StreamEvent): boolean =>
  !!e.big || (e.type === 'cheer' && Number(e.amount?.replace(/\D/g, '') || 0) >= BIG_CHEER_BITS)

/**
 * Only plain, identical events merge: same platform, type and wording, and nothing personal on them
 * (no message, amount, clip or resub months). A merged pop-up should never hide what someone said or gave.
 */
const groupKey = (e: StreamEvent): string | null =>
  e.message || e.amount || e.preview || isBig(e) || e.type === 'donation' || subMonths(e) || !e.actor
    ? null
    : `${e.platform}|${e.type}|${e.text}|${e.subject ?? ''}|${e.test ? 'test' : ''}`

const join = <T extends Group>(g: T, e: StreamEvent): T =>
  ({ ...g, e, count: g.count + 1, names: g.names.includes(e.actor!) ? g.names : [...g.names, e.actor!] })

/**
 * Event pop-ups at the top of chat, one at a time. Each stays for the time set in Settings, then
 * leaves, and the next one comes in. A wave of similar events (follows, plain subs) shares one
 * pop-up that counts up instead of queueing. Hover holds it, click dismisses it. While a panel is
 * open over chat (Events, Users, emotes, actions, Settings) they hide with their timers paused and
 * new ones wait.
 */
export function EventPopups({ covered }: { covered: boolean }): JSX.Element | null {
  const events = useStore((s) => s.events)
  const on = useStore((s) => s.settings?.eventPopups ?? true)
  const seconds = useStore((s) => s.settings?.eventPopupSeconds ?? 6)
  const filter = useStore((s) => s.settings!.eventFilter)
  const [shown, setShown] = useState<Shown[]>([])
  const waiting = useRef<Group[]>([])
  // everything already seen; whatever is there at startup never pops up
  const seen = useRef<Set<string> | null>(null)

  // mirror of `shown`, so the queue never gets mutated inside a state updater
  const current = useRef<Shown[]>([])
  const update = useCallback((next: Shown[]) => {
    current.current = next
    setShown(next)
  }, [])
  const coveredRef = useRef(covered)
  coveredRef.current = covered
  const pump = useCallback(() => {
    if (coveredRef.current) return
    const list = current.current
    // one that's still leaving counts too, so they never overlap
    const free = MAX_SHOWN - list.length
    if (free <= 0 || !waiting.current.length) return
    update([...list, ...waiting.current.splice(0, free).map((g) => ({ ...g, leaving: false }))])
  }, [update])

  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(events.map((e) => e.id))
      return
    }
    for (const e of events) {
      if (seen.current.has(e.id)) continue
      seen.current.add(e.id)
      if (!on || !popsUp(e, filter)) continue
      const key = groupKey(e)
      // join a pop-up that's already up (its timer restarts) or one still waiting
      const up = key ? current.current.findIndex((s) => s.key === key && !s.leaving) : -1
      if (up >= 0) {
        update(current.current.map((s, i) => (i === up ? join(s, e) : s)))
        continue
      }
      const queued = key ? waiting.current.findIndex((g) => g.key === key) : -1
      if (queued >= 0) waiting.current[queued] = join(waiting.current[queued], e)
      else waiting.current.push({ id: e.id, key, e, names: e.actor ? [e.actor] : [], count: 1 })
    }
    if (waiting.current.length > MAX_WAITING) waiting.current.splice(0, waiting.current.length - MAX_WAITING)
    pump()
  }, [events, on, filter, pump, update])

  // panel closed, let the waiting ones in
  useEffect(() => {
    if (!covered) pump()
  }, [covered, pump])

  // turning pop-ups off dismisses whatever is on screen
  useEffect(() => {
    if (on) return
    waiting.current = []
    update(current.current.map((s) => ({ ...s, leaving: true })))
  }, [on, update])

  const leave = useCallback((id: string) => {
    update(current.current.map((s) => (s.e.id === id ? { ...s, leaving: true } : s)))
  }, [update])
  const gone = useCallback((id: string) => {
    update(current.current.filter((s) => s.e.id !== id))
    pump()
  }, [pump, update])

  if (!shown.length) return null
  const base = Math.max(1, seconds) * 1000
  return (
    <div className={covered ? 'ev-pops covered' : 'ev-pops'} aria-live="polite" aria-hidden={covered || undefined}>
      {shown.map((s) => <Popup key={s.id} g={s} ms={isBig(s.e) ? base * BIG_STAY : base} paused={covered} leaving={s.leaving} onLeave={leave} onGone={gone} />)}
    </div>
  )
}

function Popup({ g, ms, paused, leaving, onLeave, onGone }: { g: Group; ms: number; paused: boolean; leaving: boolean; onLeave(id: string): void; onGone(id: string): void }): JSX.Element {
  const { e, count, names } = g
  const left = useRef(ms)
  const started = useRef(0)
  const counted = useRef(count)
  const [hovered, setHeld] = useState(false)
  const held = hovered || paused

  // count down while the mouse isn't over it; someone joining the group restarts the timer
  useEffect(() => {
    if (leaving || held) return
    if (counted.current !== count) {
      counted.current = count
      left.current = ms
    }
    started.current = Date.now()
    const t = setTimeout(() => onLeave(e.id), left.current)
    return () => {
      clearTimeout(t)
      left.current = Math.max(0, left.current - (Date.now() - started.current))
    }
  }, [leaving, held, count, ms, e.id, onLeave])

  // removed when the exit animation ends, or after EXIT_MS if animations are off
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => onGone(e.id), EXIT_MS)
    return () => clearTimeout(t)
  }, [leaving, e.id, onGone])

  // "Newest and 5 others followed", full list in the tooltip
  const others = count - 1
  const shownEvent = others > 0 ? { ...e, actor: `${e.actor} and ${others} other${others === 1 ? '' : 's'}` } : e
  const title = others > 0 ? `${names.join(', ')}\n\nClick to close. Hover to keep it open.` : 'Click to close. Hover to keep it open.'

  return (
    <div
      className={`ev-pop-slot ev-pop-${e.type} ${standaloneSource(e) ? `from-${standaloneSource(e)}` : `on-${e.platform}`}${isBig(e) ? ' big' : ''}${leaving ? ' leaving' : ''}`}
      onAnimationEnd={(ev) => { if (leaving && ev.animationName === 'evpop-shrink') onGone(e.id) }}
    >
      <div className="ev-pop-inner">
        <div
          className="ev-pop"
          style={{ '--pop-ms': `${ms}ms` } as React.CSSProperties}
          role="status"
          title={title}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onClick={() => onLeave(e.id)}
        >
          {/* re-keyed on every join so the card bumps and the time bar refills */}
          <div key={count} className={count > 1 ? 'ev-pop-card bump' : 'ev-pop-card'}><EventCard e={shownEvent} popup /></div>
          <span key={`t${count}`} className={held ? 'ev-pop-time held' : 'ev-pop-time'} aria-hidden="true" />
        </div>
        {/* outside the capsule so it can sit on the edge like a notification badge */}
        {/* not on follows, every follow is a different person so a count is just confusing */}
        {count > 1 && e.type !== 'follow' && <span key={count} className="ev-pop-count" aria-hidden="true">×{count}</span>}
      </div>
    </div>
  )
}

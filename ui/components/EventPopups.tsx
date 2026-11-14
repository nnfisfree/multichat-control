import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { chatEventGroup } from '../../shared/events'
import type { EventFilter, StreamEvent } from '../../shared/types'
import { useStore } from '../lib/store'
import { EventCard } from './EventCard'

/** At most this many pop-ups at once; the rest wait their turn. */
const MAX_SHOWN = 3
/** A busy stream can't build an endless line: the oldest waiting ones are dropped. */
const MAX_WAITING = 20
/** Events older than this when they arrive (late history, reconnects) don't pop up. */
const FRESH_MS = 60000
/** Longest the slide-out can take before the pop-up is removed anyway. */
const EXIT_MS = 900

interface Shown { e: StreamEvent; leaving: boolean }

/**
 * Live events worth a pop-up: the kinds that get a card in chat, under the same platform and type
 * filters as the Events drop-down (donations, like there, show whatever the platform filter says).
 */
const popsUp = (e: StreamEvent, f: EventFilter): boolean =>
  !e.history && !!chatEventGroup(e.type) && Date.now() - e.ts < FRESH_MS &&
  (e.type === 'donation' || f.platforms[e.platform]) && !f.hiddenTypes.includes(e.type)

/**
 * New events rise from the message box, stay for the time chosen in Settings, then sink back.
 * Hovering one holds it in place; clicking it sends it away.
 */
export function EventPopups(): JSX.Element | null {
  const events = useStore((s) => s.events)
  const on = useStore((s) => s.settings?.eventPopups ?? true)
  const seconds = useStore((s) => s.settings?.eventPopupSeconds ?? 6)
  const filter = useStore((s) => s.settings!.eventFilter)
  const [shown, setShown] = useState<Shown[]>([])
  const waiting = useRef<StreamEvent[]>([])
  /** Everything already looked at. Events present at start never pop up. */
  const seen = useRef<Set<string> | null>(null)

  /** The list on screen, kept beside the state so the queue is never changed inside a state update. */
  const current = useRef<Shown[]>([])
  const update = useCallback((next: Shown[]) => {
    current.current = next
    setShown(next)
  }, [])
  const pump = useCallback(() => {
    const list = current.current
    const free = MAX_SHOWN - list.filter((s) => !s.leaving).length
    if (free <= 0 || !waiting.current.length) return
    update([...list, ...waiting.current.splice(0, free).map((e) => ({ e, leaving: false }))])
  }, [update])

  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(events.map((e) => e.id))
      return
    }
    for (const e of events) {
      if (seen.current.has(e.id)) continue
      seen.current.add(e.id)
      if (on && popsUp(e, filter)) waiting.current.push(e)
    }
    if (waiting.current.length > MAX_WAITING) waiting.current.splice(0, waiting.current.length - MAX_WAITING)
    pump()
  }, [events, on, filter, pump])

  // Turning pop-ups off sends away the ones on screen.
  useEffect(() => {
    if (on) return
    waiting.current = []
    update(current.current.map((s) => ({ ...s, leaving: true })))
  }, [on, update])

  const leave = useCallback((id: string) => {
    update(current.current.map((s) => (s.e.id === id ? { ...s, leaving: true } : s)))
    pump()
  }, [pump, update])
  const gone = useCallback((id: string) => {
    update(current.current.filter((s) => s.e.id !== id))
    pump()
  }, [pump, update])

  if (!shown.length) return null
  return (
    <div className="ev-pops" aria-live="polite">
      {shown.map((s) => <Popup key={s.e.id} e={s.e} ms={Math.max(1, seconds) * 1000} leaving={s.leaving} onLeave={leave} onGone={gone} />)}
    </div>
  )
}

function Popup({ e, ms, leaving, onLeave, onGone }: { e: StreamEvent; ms: number; leaving: boolean; onLeave(id: string): void; onGone(id: string): void }): JSX.Element {
  const left = useRef(ms)
  const started = useRef(0)
  const [held, setHeld] = useState(false)

  // Counts down while the mouse isn't on it.
  useEffect(() => {
    if (leaving || held) return
    started.current = Date.now()
    const t = setTimeout(() => onLeave(e.id), left.current)
    return () => {
      clearTimeout(t)
      left.current = Math.max(0, left.current - (Date.now() - started.current))
    }
  }, [leaving, held, e.id, onLeave])

  // Removed when the slide-out ends, or after a moment if animations are off.
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => onGone(e.id), EXIT_MS)
    return () => clearTimeout(t)
  }, [leaving, e.id, onGone])

  return (
    <div
      className={`ev-pop-slot ev-pop-${e.type} on-${e.platform}${e.big ? ' big' : ''}${leaving ? ' leaving' : ''}`}
      onAnimationEnd={(ev) => { if (leaving && ev.animationName === 'evpop-shrink') onGone(e.id) }}
    >
      <div className="ev-pop-inner">
        <div
          className="ev-pop"
          style={{ '--pop-ms': `${ms}ms` } as React.CSSProperties}
          role="status"
          title="Click to close. Hover to keep it open."
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onClick={() => onLeave(e.id)}
        >
          <EventCard e={e} />
          <span className={held ? 'ev-pop-time held' : 'ev-pop-time'} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

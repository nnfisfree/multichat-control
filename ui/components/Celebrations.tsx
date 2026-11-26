import { useEffect, useRef, useState, type JSX } from 'react'
import { animationPref, type AnimationKind, type Settings, type StreamEvent } from '../../shared/types'
import { inEventsTab } from '../../shared/event-prefs'
import { clearConfettiSides, confettiSides } from '../lib/confetti'
import { playDrop } from '../lib/drops'
import { getState, useStore } from '../lib/store'

// skip anything this old on arrival (late history, reconnects), same as the pop-ups
const FRESH_MS = 60000
// after the follow cannons stop, let the burst open up and start floating down before the next one starts
const CONFETTI_SETTLE_MS = 3500
// a long queue on a busy stream: new ones past this are skipped rather than playing for minutes
const MAX_WAITING = 12
// the same cheer, gift bomb or tip reported twice (Twitch itself plus an alert service) only plays once
const SAME_EVENT_MS = 15000

interface Item { kind: AnimationKind; seconds: number; strength: number; symbol?: string }

const TWITCH_KINDS: AnimationKind[] = ['follow', 'bits', 'gifts']

const bitsOf = (e: StreamEvent): number => Number(/^([\d,.\s]+)/.exec(e.amount ?? '')?.[1]?.replace(/\D/g, '') || 0)
const giftsOf = (e: StreamEvent): number => Number(/^gifted (\d+) subs?\b/i.exec(e.text)?.[1] ?? 0)

/**
 * "$10.00", "25,00 €", "1.234,56 €", "US$5.00" → the number. The last "." or "," is the decimal
 * point when one or two digits follow it, otherwise every separator is a thousands one.
 */
export function moneyOf(amount: string | undefined): number {
  const raw = /\d[\d.,\s  ]*/.exec(amount ?? '')?.[0].replace(/[\s  ]/g, '').replace(/[.,]$/, '')
  if (!raw) return 0
  const sep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','))
  const decimals = sep >= 0 && raw.length - sep - 1 <= 2
  const whole = (decimals ? raw.slice(0, sep) : raw).replace(/\D/g, '')
  return Number(`${whole || '0'}${decimals ? `.${raw.slice(sep + 1)}` : ''}`) || 0
}

/** The currency sign printed on the banknotes: "$" for any dollar, else the sign or code as shown. */
const symbolOf = (amount: string | undefined): string => {
  const sign = (amount ?? '').replace(/[\d.,\s  -]/g, '')
  return !sign || sign.includes('$') ? '$' : sign.slice(0, 3)
}

const isTip = (e: StreamEvent): boolean =>
  e.type === 'donation' && (e.source === 'streamelements' || e.source === 'streamlabs') && /^donated/i.test(e.text)

/** What a new event gets, if anything, from the user's Animations settings. */
function itemFor(e: StreamEvent, s: Settings): Item | null {
  const make = (kind: AnimationKind, amount: number, strength: number, symbol?: string): Item | null => {
    const p = animationPref(s, kind)
    if (!p.on || (kind !== 'follow' && (amount <= 0 || amount < p.min))) return null
    return { kind, seconds: p.seconds, strength: Math.max(0, Math.min(1, strength)), symbol }
  }
  if (isTip(e)) {
    const money = moneyOf(e.amount)
    // 1 → light, 100+ → full
    return make('tips', money, Math.log10(Math.max(1, money)) / 2, symbolOf(e.amount))
  }
  // Twitch's own events, and Twitch events an alert service relays; nothing from BMC
  if (e.platform !== 'twitch' || e.type === 'donation' || e.source === 'buymeacoffee') return null
  if (e.type === 'follow') return make('follow', 1, 1)
  if (e.type === 'cheer' || e.type === 'bits') {
    const bits = bitsOf(e)
    // 1 bit → light, 10,000+ → full
    return make('bits', bits, Math.log10(Math.max(1, bits)) / 4)
  }
  if (e.type === 'gift') {
    // only gift bombs ("gifted 5 subs to the community") carry a count; single gifts never drop
    const subs = giftsOf(e)
    // 5 → light, 100+ → full
    return make('gifts', subs, Math.log10(Math.max(1, subs / 5)) / Math.log10(20))
  }
  return null
}

/** Same person, same kind, same amount: one event seen twice. */
const sameKey = (e: StreamEvent, kind: AnimationKind): string | null =>
  kind === 'follow' ? null : `${kind}|${(e.actor ?? '').toLowerCase()}|${kind === 'tips' ? moneyOf(e.amount) : kind === 'bits' ? bitsOf(e) : giftsOf(e)}`

/**
 * Celebration animations, one at a time in the order the events came in:
 * - Twitch follow: confetti from both bottom corners of the window, meeting at the top
 * - Twitch cheer: Bits raining down over chat
 * - Twitch gift bomb: gift boxes raining down over chat
 * - StreamElements / Streamlabs tip: banknotes raining down over chat
 * Each one is set in Settings > Chat > Animations (on/off, how long, smallest amount). Only new, live
 * events, never history or what's already there at startup, and only kinds the Events tab shows.
 *
 * The drop layer covers the whole chat stage from its very top, but is clipped to start where the
 * chat list starts. So while the raid bar, Hype Train or pinned message is up, the pieces fall
 * behind it and only come into view below it, and once it's gone they show from the top again.
 *
 * Twitch ones only show on the All and Twitch tabs; tips belong to no platform and show on every tab.
 * While Settings is open (`covered`) nothing shows: the follow confetti is cleared, and a drop keeps
 * falling out of sight. A follow whose turn comes up while it can't be seen is skipped.
 */
export function Celebrations({ twitchVisible, covered }: { twitchVisible: boolean; covered: boolean }): JSX.Element {
  const events = useStore((s) => s.events)
  const animations = useStore((s) => s.settings?.animations)
  const layer = useRef<HTMLDivElement>(null)
  const seen = useRef<Set<string> | null>(null)
  const queue = useRef<Item[]>([])
  const recent = useRef(new Map<string, number>())
  // what's playing now and how to stop it
  const current = useRef<{ kind: AnimationKind; stop(): void } | null>(null)
  const [playing, setPlaying] = useState<AnimationKind | null>(null)
  const view = useRef({ twitchVisible, covered })
  view.current = { twitchVisible, covered }

  const next = useRef<() => void>(() => {})
  next.current = (): void => {
    if (current.current || !layer.current) return
    const item = queue.current.shift()
    if (!item) return
    const done = (): void => {
      current.current = null
      setPlaying(null)
      next.current()
    }
    if (item.kind === 'follow') {
      // window-wide, so it only fires while the Twitch side of the app is on screen
      if (!view.current.twitchVisible || view.current.covered) return next.current()
      const stopVolleys = confettiSides(item.seconds)
      const t = setTimeout(done, Math.max(1, item.seconds) * 1000 + CONFETTI_SETTLE_MS)
      current.current = { kind: 'follow', stop: () => { clearTimeout(t); stopVolleys(); clearConfettiSides() } }
    } else {
      const stop = playDrop(layer.current, item.kind === 'tips' ? 'money' : item.kind, item, done)
      current.current = { kind: item.kind, stop }
    }
    setPlaying(item.kind)
  }

  useEffect(() => {
    if (!seen.current) {
      // whatever is there at startup never animates
      seen.current = new Set(events.map((e) => e.id))
      return
    }
    const now = Date.now()
    const settings = getState().settings!
    for (const e of events) {
      if (seen.current.has(e.id)) continue
      seen.current.add(e.id)
      if (e.history || now - e.ts > FRESH_MS || !inEventsTab(settings, e)) continue
      const item = itemFor(e, settings)
      if (!item) continue
      // a wave of follows shares one burst with the follow already waiting
      if (item.kind === 'follow' && queue.current.at(-1)?.kind === 'follow') continue
      const key = sameKey(e, item.kind)
      if (key) {
        const before = recent.current.get(key)
        recent.current.set(key, now)
        if (before && now - before < SAME_EVENT_MS) continue
      }
      if (queue.current.length >= MAX_WAITING) continue
      queue.current.push(item)
    }
    for (const [k, t] of recent.current) if (now - t > SAME_EVENT_MS) recent.current.delete(k)
    next.current()
  }, [events])

  // a kind switched off: stop it if it's playing and forget the waiting ones
  useEffect(() => {
    const s = { animations } as Pick<Settings, 'animations'>
    queue.current = queue.current.filter((i) => animationPref(s, i.kind).on)
    const c = current.current
    if (c && !animationPref(s, c.kind).on) {
      c.stop()
      current.current = null
      setPlaying(null)
      next.current()
    }
  }, [animations])

  // Settings opened: the follow confetti that's still in the air goes too
  useEffect(() => {
    if (covered) clearConfettiSides()
  }, [covered])

  // start the layer where the chat list starts, below the raid / Hype Train / pinned bars
  useEffect(() => {
    const el = layer.current
    const area = el?.parentElement?.querySelector<HTMLElement>('.chat-area')
    if (!el || !area) return
    const clip = (): void => { el.style.clipPath = `inset(${area.offsetTop}px 0 0 0)` }
    clip()
    const ro = new ResizeObserver(clip)
    ro.observe(area)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => current.current?.stop(), [])

  const hidden = covered || (playing !== null && TWITCH_KINDS.includes(playing) && !twitchVisible)
  return <div ref={layer} className={hidden ? 'drop-layer off' : 'drop-layer'} aria-hidden="true" />
}

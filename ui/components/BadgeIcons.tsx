import type { JSX, ReactNode } from 'react'
import type { EventType } from '../../shared/types'

/* Small animated pictures inside event badges. Each part that moves has a class styled in theme.css (.bi-*). */

const Svg = ({ children, cls }: { children: ReactNode; cls: string }): JSX.Element => (
  <svg className={`bi ${cls}`} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">{children}</svg>
)

/** A steam locomotive with puffs of smoke. */
const Train = (): JSX.Element => (
  <Svg cls="bi-train">
    <g className="bi-smoke" fill="#fff">
      <circle cx="6" cy="5" r="1.6" />
      <circle cx="4" cy="2.6" r="1.2" />
      <circle cx="2.4" cy="1" r="0.8" />
    </g>
    <g className="bi-loco" fill="currentColor">
      <rect x="5" y="6.5" width="3" height="4" rx="0.6" />
      <path d="M3 10.5h11V18H3a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1z" />
      <path d="M14 7h7a1 1 0 0 1 1 1v10h-8z" />
      <rect x="15.6" y="8.6" width="4.6" height="3.4" rx="0.6" fill="#ffd166" />
      <rect x="13" y="5.6" width="10" height="1.6" rx="0.8" />
      <path d="M2 17.2 0.4 19.6h3z" />
      <rect x="3.5" y="13" width="9" height="1.1" rx="0.5" fill="#ffd166" />
    </g>
    <g className="bi-wheels" fill="#ffd166" stroke="currentColor" strokeWidth="1.1">
      <circle cx="6" cy="19.5" r="2.2" />
      <circle cx="11.5" cy="19.5" r="2.2" />
      <circle cx="18.5" cy="19.2" r="2.6" />
    </g>
  </Svg>
)

/** A present whose lid hops. */
const Gift = (): JSX.Element => (
  <Svg cls="bi-gift">
    <g fill="currentColor">
      <rect x="3.5" y="11" width="17" height="11" rx="1.4" />
    </g>
    <rect x="10.6" y="11" width="2.8" height="11" fill="#ffd166" />
    <g className="bi-lid">
      <rect x="2" y="7" width="20" height="4.4" rx="1.2" fill="currentColor" />
      <rect x="10.6" y="7" width="2.8" height="4.4" fill="#ffd166" />
      <path d="M12 7C10.5 3.6 6.6 2.6 6.2 4.8 5.9 6.6 9.4 7 12 7zm0 0c1.5-3.4 5.4-4.4 5.8-2.2.3 1.8-3.2 2.2-5.8 2.2z" fill="none" stroke="#ffd166" strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  </Svg>
)

/** A die that rolls over now and then. */
const Dice = (): JSX.Element => (
  <Svg cls="bi-dice">
    <rect x="3" y="3" width="18" height="18" rx="4.5" fill="#fff" />
    <g fill="#0b6f62">
      <circle cx="8" cy="8" r="1.7" />
      <circle cx="16" cy="8" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="8" cy="16" r="1.7" />
      <circle cx="16" cy="16" r="1.7" />
    </g>
  </Svg>
)

/** A faceted Bits gem with a glint passing over it. */
const Bits = (): JSX.Element => (
  <Svg cls="bi-bits">
    <path d="M12 1.5 21 13l-9 9.5L3 13z" fill="#c9a7ff" />
    <path d="M12 1.5 21 13l-9 3.2z" fill="#9146ff" />
    <path d="M12 1.5 3 13l9 3.2z" fill="#e4d4ff" />
    <path d="M3 13l9 3.2v6.3z" fill="#7a2fe6" />
    <path d="M21 13l-9 3.2v6.3z" fill="#5c16c5" />
    <path className="bi-glint" d="M8.4 6.6 9.6 5l1.2 1.6-1.2 1.6z" fill="#fff" />
  </Svg>
)

/** A flickering flame. */
const Flame = (): JSX.Element => (
  <Svg cls="bi-flame">
    <path className="bi-flame-out" d="M12 1.5c.6 3.4 5.9 6.2 5.9 12.3A5.9 5.9 0 0 1 12 22.5a5.9 5.9 0 0 1-5.9-6.2c0-2.6 1.3-4.4 2.6-5.6.1 1.7.9 2.9 2 3.3C10 10.1 10.8 5.1 12 1.5z" fill="#ffb02e" />
    <path className="bi-flame-in" d="M12 11.5c.3 1.8 3.1 3.1 3.1 6.1a3.1 3.1 0 0 1-6.2 0c0-1.3.6-2.3 1.4-3 .1.8.5 1.4 1 1.6-.1-1.6.2-3.2.7-4.7z" fill="#fff3b0" />
  </Svg>
)

/** A beating heart. */
const Heart = (): JSX.Element => (
  <Svg cls="bi-heart">
    <path d="M12 21.2 10.6 20C5.4 15.3 2 12.2 2 8.4 2 5.3 4.4 3 7.4 3c1.8 0 3.5.8 4.6 2.1C13.1 3.8 14.8 3 16.6 3 19.6 3 22 5.3 22 8.4c0 3.8-3.4 6.9-8.6 11.6z" fill="currentColor" />
    <path d="M6.2 6.4c-1 .4-1.6 1.3-1.7 2.4" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" strokeLinecap="round" />
  </Svg>
)

const ICONS: Partial<Record<EventType, () => JSX.Element>> = {
  hypetrain: Train, gift: Gift, redemption: Dice, cheer: Bits, bits: Bits, powerup: Flame, follow: Heart
}

/** The animated picture for this event type, or null when it has none. */
export function BadgeIcon({ type }: { type: EventType }): JSX.Element | null {
  const I = ICONS[type]
  return I ? <I /> : null
}

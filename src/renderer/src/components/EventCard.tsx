import type { JSX } from 'react'
import { EVENT_BADGE } from '../../../shared/events'
import type { EventType, StreamEvent } from '../../../shared/types'
import { PlatformIcon } from '../Icons'

/** Short label marking an event's type. Channel points use a round coin. */
export function EventBadge({ type }: { type: EventType }): JSX.Element {
  return <span className={`ev-badge badge-${type}`}>{EVENT_BADGE[type]}</span>
}

/** One event inside the chat stream, so subs, gifts and raids can't be missed. */
export function EventCard({ e }: { e: StreamEvent }): JSX.Element {
  return (
    <div className={`ev ev-${e.type}${e.big ? ' ev-big' : ''}`}>
      <div className="ev-top">
        <span className={`pf ${e.platform}`}><PlatformIcon platform={e.platform} size={18} /></span>
        <span className="ev-title">{e.actor && <b>{e.actor} </b>}{e.text}{e.subject && <b> {e.subject}</b>}</span>
        {e.amount && <span className="ev-amount">{e.amount}</span>}
        <EventBadge type={e.type} />
      </div>
      {e.message && <div className="ev-msg">{e.message}</div>}
    </div>
  )
}

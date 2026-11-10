import type { JSX } from 'react'
import { eventBadge } from '../../shared/events'
import { ALERT_SOURCE_LABEL, type StreamEvent } from '../../shared/types'
import { DollarIcon, PlatformIcon } from './Icons'

/** Short label marking an event's type. Channel points use a round coin. */
export function EventBadge({ e }: { e: Pick<StreamEvent, 'type' | 'text'> }): JSX.Element {
  const label = eventBadge(e)
  // Donations (Streamlabs, StreamElements) get a gold coin with a dollar sign.
  if (e.type === 'donation') return <span className="ev-badge badge-donation" title="Donation" aria-label="Donation"><DollarIcon /></span>
  return <span className={`ev-badge badge-${e.type}${label === 'OFF' ? ' badge-off' : ''}`}>{label}</span>
}

/** A small SE or SL tag on events that came from an alert service. */
export function SourceTag({ e }: { e: Pick<StreamEvent, 'source'> }): JSX.Element | null {
  if (!e.source) return null
  return <span className={`src-tag ${e.source}`} title={`From ${ALERT_SOURCE_LABEL[e.source]}`}>{e.source === 'streamelements' ? 'SE' : 'SL'}</span>
}

/** One event inside the chat stream, so subs, gifts and raids can't be missed. */
export function EventCard({ e }: { e: StreamEvent }): JSX.Element {
  return (
    <div className={`ev ev-${e.type}${e.big ? ' ev-big' : ''}`}>
      <div className="ev-top">
        <span className={`pf ${e.platform}`}><PlatformIcon platform={e.platform} size={18} /></span>
        <span className="ev-title">{e.actor && <b>{e.actor} </b>}{e.text}{e.subject && <b> {e.subject}</b>}</span>
        <SourceTag e={e} />
        {e.amount && <span className="ev-amount">{e.amount}</span>}
        <EventBadge e={e} />
      </div>
      {e.message && <div className="ev-msg">{e.message}</div>}
    </div>
  )
}

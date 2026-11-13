import type { JSX } from 'react'
import { eventBadge } from '../../shared/events'
import { ALERT_SOURCE_LABEL, type StreamEvent } from '../../shared/types'
import { BadgeIcon } from './BadgeIcons'
import { DollarIcon, PlatformIcon } from './Icons'
import { PreviewCard } from './LinkPreview'

/** Short label marking an event's type. Channel points use a round coin. */
export function EventBadge({ e }: { e: Pick<StreamEvent, 'type' | 'text'> & Partial<Pick<StreamEvent, 'platform'>> }): JSX.Element {
  const label = eventBadge(e)
  // Donations (Streamlabs, StreamElements) get a gold coin with a dollar sign.
  if (e.type === 'donation') return <span className="ev-badge badge-donation" title="Donation" aria-label="Donation"><DollarIcon /></span>
  const cls = `ev-badge badge-${e.type}${e.platform ? ` on-${e.platform}` : ''}${label === 'OFF' ? ' badge-off' : ''}`
  // The channel points coin holds just a die.
  if (e.type === 'redemption') return <span className={cls} title="Channel points" aria-label="Channel points"><BadgeIcon type="redemption" /></span>
  const icon = BadgeIcon({ type: e.type })
  return <span className={icon ? `${cls} has-icon` : cls}>{icon}{label}</span>
}

/** A small SE or SL tag on events that came from an alert service. */
export function SourceTag({ e }: { e: Pick<StreamEvent, 'source'> }): JSX.Element | null {
  if (!e.source) return null
  return <span className={`src-tag ${e.source}`} title={`From ${ALERT_SOURCE_LABEL[e.source]}`}>{e.source === 'streamelements' ? 'SE' : 'SL'}</span>
}

/** One event inside the chat stream, so subs, gifts and raids can't be missed. */
export function EventCard({ e }: { e: StreamEvent }): JSX.Element {
  return (
    <div className={`ev ev-${e.type} on-${e.platform}${e.big ? ' ev-big' : ''}`}>
      <div className="ev-top">
        <span className={`pf ${e.platform}`}><PlatformIcon platform={e.platform} size={18} /></span>
        <span className="ev-title">{e.actor && <b>{e.actor} </b>}{e.text}{e.subject && <b> {e.subject}</b>}</span>
        <SourceTag e={e} />
        {e.amount && <span className="ev-amount">{e.amount}</span>}
        <EventBadge e={e} />
      </div>
      {e.message && <div className="ev-msg">{e.message}</div>}
      {e.preview && <PreviewCard p={e.preview} />}
    </div>
  )
}

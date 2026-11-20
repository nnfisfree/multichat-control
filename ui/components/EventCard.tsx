import type { JSX } from 'react'
import { eventBadge, shownAmount, standaloneSource, subMonths } from '../../shared/events'
import { ALERT_SOURCE_LABEL, PLATFORM_LABEL, type StreamEvent } from '../../shared/types'
import { BadgeIcon } from './BadgeIcons'
import { BmcLogo, DollarIcon, PlatformIcon, StreamElementsLogo, StreamlabsLogo } from './Icons'
import { PreviewCard } from './LinkPreview'

/** Short type label. Channel points get a round coin. With `months`, a resub reads "SUB ×14". */
export function EventBadge({ e, months }: { e: Pick<StreamEvent, 'type' | 'text'> & Partial<Pick<StreamEvent, 'platform' | 'source'>>; months?: number }): JSX.Element {
  const label = eventBadge(e)
  // Tips say TIP next to the logo of whatever the money came through: SE, SL, BMC, or the platform
  // itself (YouTube Super Chat).
  if (e.type === 'donation' || e.type === 'paid') {
    const from = e.source ? ALERT_SOURCE_LABEL[e.source] : e.type === 'paid' && e.platform ? PLATFORM_LABEL[e.platform] : undefined
    const logo = e.source === 'streamelements' ? <StreamElementsLogo size={14} />
      : e.source === 'streamlabs' ? <StreamlabsLogo size={14} />
      : e.source === 'buymeacoffee' ? <BmcLogo size={14} />
      : e.type === 'paid' && e.platform ? <PlatformIcon platform={e.platform} size={13} />
      : <DollarIcon size={13} />
    return <span className={`ev-badge badge-tip has-icon${e.source ? ` from-${e.source}` : e.platform ? ` from-${e.platform}` : ''}`} title={from ? `Tip via ${from}` : 'Tip'}>{logo}TIP</span>
  }
  const cls = `ev-badge badge-${e.type}${e.platform ? ` on-${e.platform}` : ''}${e.source ? ` from-${e.source}` : ''}${label === 'OFF' ? ' badge-off' : ''}`
  // the channel points coin just holds Twitch's glyph
  if (e.type === 'redemption') return <span className={cls} title="Channel points" aria-label="Channel points"><BadgeIcon type="redemption" /></span>
  const icon = BadgeIcon({ type: e.type })
  if (months) return <span className={`${cls} has-icon has-months`} title={`${label === 'MEM' ? 'Member' : 'Subscribed'} for ${months} months`}>{icon}{label}<span className="badge-months">×{months}</span></span>
  return <span className={icon ? `${cls} has-icon` : cls}>{icon}{label}</span>
}

/** SE / SL tag, or the BMC logo, on events that came through an alert service. */
export function SourceTag({ e }: { e: Pick<StreamEvent, 'source' | 'type'> }): JSX.Element | null {
  // tips already show the service logo in their TIP badge
  if (!e.source || e.type === 'donation') return null
  if (e.source === 'buymeacoffee') return <span className="src-tag buymeacoffee" title={`From ${ALERT_SOURCE_LABEL[e.source]}`}><BmcLogo size={16} /></span>
  return <span className={`src-tag ${e.source}`} title={`From ${ALERT_SOURCE_LABEL[e.source]}`}>{e.source === 'streamelements' ? 'SE' : 'SL'}</span>
}

/** Test alerts disappear on restart. */
export function TestTag({ e }: { e: Pick<StreamEvent, 'test'> }): JSX.Element | null {
  return e.test ? <span className="test-tag" title="A test alert. It goes away when the app restarts">TEST</span> : null
}

/** Platform icon, or for tips and BMC, the service's own logo. */
export function EventIcon({ e, size }: { e: StreamEvent; size: number }): JSX.Element {
  const from = standaloneSource(e)
  if (!from) return <span className={`pf ${e.platform}`}><PlatformIcon platform={e.platform} size={size} /></span>
  const logo = from === 'streamelements' ? <StreamElementsLogo size={size} /> : from === 'streamlabs' ? <StreamlabsLogo size={size} /> : <BmcLogo size={size} />
  return <span className={`pf src-${from}`} title={ALERT_SOURCE_LABEL[from]}>{logo}</span>
}

/** An event inline in chat, so subs, gifts and raids can't be missed. In a pop-up the badge also shows resub months. */
export function EventCard({ e, popup }: { e: StreamEvent; popup?: boolean }): JSX.Element {
  return (
    <div className={`ev ev-${e.type} on-${e.platform}${standaloneSource(e) ? ` from-${standaloneSource(e)}` : ''}${e.big ? ' ev-big' : ''}${e.type === 'powerup' && /celebration/i.test(e.subject ?? '') ? ' ev-celebration' : ''}`}>
      <div className="ev-top">
        <EventIcon e={e} size={18} />
        <span className="ev-title">{e.actor && <b>{e.actor} </b>}{e.text}{e.image && <img className="ev-img" src={e.image} alt="" loading="lazy" draggable={false} />}{e.subject && <b> {e.subject}</b>}</span>
        <SourceTag e={e} />
        <TestTag e={e} />
        {e.amount && <span className="ev-amount">{shownAmount(e)}</span>}
        <EventBadge e={e} months={popup ? subMonths(e) : undefined} />
      </div>
      {e.message && <div className="ev-msg">{e.message}</div>}
      {e.preview && <PreviewCard p={e.preview} />}
    </div>
  )
}

import { useMemo, useState, type JSX } from 'react'
import { EVENT_TYPE_LABEL, PLATFORMS, PLATFORM_LABEL, type EventType, type Platform, type StreamEvent } from '../../../shared/types'
import { Icon, PlatformIcon } from '../Icons'
import { useStore } from '../store'
import { EventBadge } from './EventCard'

function EventRow({ e, open, onToggle }: { e: StreamEvent; open: boolean; onToggle(): void }): JSX.Element {
  const [note, setNote] = useState('')
  const details = Object.entries(e.details).filter(([, v]) => v)
  const run = async (actionId: string, args: Record<string, string>): Promise<void> => {
    const r = await window.nnf.runAction(e.platform, actionId, args)
    setNote(r.message ?? (r.ok ? 'Done.' : 'Failed.'))
  }
  return (
    <li className={`event ${e.type}${open ? ' open' : ''}`}>
      <button className="event-head" aria-expanded={open} onClick={onToggle}>
        <span className={`pf ${e.platform}`}><PlatformIcon platform={e.platform} size={16} /></span>
        <span className="event-text">{e.actor && <b>{e.actor} </b>}{e.text}{e.subject && <b> {e.subject}</b>}</span>
        {e.amount && <span className="amount">{e.amount}</span>}
        <EventBadge type={e.type} />
        <span className={open ? 'chev open' : 'chev'}><Icon.chevron /></span>
      </button>
      {open && (
        <div className="event-body">
          {e.message && <p className="event-msg">{e.message}</p>}
          <dl>
            <dt>Time</dt><dd>{new Date(e.ts).toLocaleTimeString()}</dd>
            <dt>Platform</dt><dd>{PLATFORM_LABEL[e.platform]}</dd>
            <dt>Type</dt><dd>{EVENT_TYPE_LABEL[e.type]}</dd>
            {details.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}
          </dl>
          {e.actions && (
            <div className="event-actions">
              {e.actions.map((a) => <button key={a.actionId} className={`btn ${a.tone ?? ''}`} onClick={() => void run(a.actionId, a.args)}>{a.label}</button>)}
              {note && <span className="note">{note}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function EventsDrawer({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element {
  const events = useStore((s) => s.events)
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({ twitch: true, youtube: true, kick: true })
  const [type, setType] = useState<EventType | 'all'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const types = useMemo(() => [...new Set(events.map((e) => e.type))], [events])
  const shown = useMemo(() => events.filter((e) => platforms[e.platform] && (type === 'all' || e.type === type)).slice(-300).reverse(), [events, platforms, type])

  const toggle = (id: string): void => setExpanded((s) => {
    const n = new Set(s)
    if (!n.delete(id)) n.add(id)
    return n
  })

  return (
    <section className={open ? 'drawer open' : 'drawer'} aria-hidden={!open} aria-label="Events" inert={!open}>
      <div className="drawer-panel">
        <div className="drawer-head">
          <h2>Events</h2>
          <div className="filters">
            {PLATFORMS.map((p) => (
              <button key={p} className={platforms[p] ? `pf-toggle on ${p}` : `pf-toggle ${p}`} aria-pressed={platforms[p]} title={PLATFORM_LABEL[p]}
                onClick={() => setPlatforms((s) => ({ ...s, [p]: !s[p] }))}><PlatformIcon platform={p} size={16} /></button>
            ))}
            <select aria-label="Event type" value={type} onChange={(e) => setType(e.target.value as EventType | 'all')}>
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <button className="icon-btn" aria-label="Back to chat" title="Back to chat (Esc)" onClick={onClose}><Icon.close /></button>
        </div>
        <ul className="event-list">
          {shown.length === 0 && <li className="empty">No events yet.</li>}
          {shown.map((e) => <EventRow key={e.id} e={e} open={expanded.has(e.id)} onToggle={() => toggle(e.id)} />)}
        </ul>
      </div>
    </section>
  )
}

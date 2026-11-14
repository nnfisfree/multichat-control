import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ALERT_SOURCE_LABEL, EVENT_TYPE_LABEL, PLATFORMS, PLATFORM_LABEL, type EventType, type StreamEvent } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { removeEvents, updateSettings, useStore } from '../lib/store'
import { EventBadge, SourceTag, TestTag } from './EventCard'
import { PreviewCard } from './LinkPreview'

const ALL_TYPES = Object.keys(EVENT_TYPE_LABEL) as EventType[]

/** Today's events show the time; older ones add the date. */
function when(ts: number): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

function EventRow({ e, open, onToggle }: { e: StreamEvent; open: boolean; onToggle(): void }): JSX.Element {
  const [note, setNote] = useState('')
  const details = Object.entries(e.details).filter(([, v]) => v)
  const run = async (actionId: string, args: Record<string, string>): Promise<void> => {
    const r = await window.nnf.runAction(e.platform, actionId, args)
    setNote(r.message ?? (r.ok ? 'Done.' : 'Failed.'))
  }
  return (
    <li className={`event ${e.type}${open ? ' open' : ''}${e.history ? ' history' : ''}`}>
      <button className="event-head" aria-expanded={open} onClick={onToggle}>
        <span className={`pf ${e.platform}`}><PlatformIcon platform={e.platform} size={16} /></span>
        <span className="event-text">{e.actor && <b>{e.actor} </b>}{e.text}{e.subject && <b> {e.subject}</b>}</span>
        <SourceTag e={e} />
        <TestTag e={e} />
        {e.amount && <span className="amount">{e.amount}</span>}
        <EventBadge e={e} />
        <time className="event-time">{when(e.ts)}</time>
        <span className={open ? 'chev open' : 'chev'}><Icon.chevron /></span>
      </button>
      {/* The supporter's own words always show, without opening the event. */}
      {e.message && <p className="event-msg event-quote">{e.message}</p>}
      {open && (
        <div className="event-body">
          {e.preview && <PreviewCard p={e.preview} />}
          <dl>
            <dt>Time</dt><dd>{new Date(e.ts).toLocaleString()}</dd>
            {e.type !== 'donation' && <><dt>Platform</dt><dd>{PLATFORM_LABEL[e.platform]}</dd></>}
            {e.source && <><dt>From</dt><dd>{ALERT_SOURCE_LABEL[e.source]}</dd></>}
            <dt>Type</dt><dd>{EVENT_TYPE_LABEL[e.type]}</dd>
            {details.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}
          </dl>
          <div className="event-actions">
            <button className="btn ghost sm" onClick={() => void removeEvents([e.id])}><Icon.trash /> Remove</button>
          </div>
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

/** Clears test alerts, or everything after a second click. Removed events never come back. */
function ClearMenu({ testIds, allIds }: { testIds: string[]; allIds: string[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return setConfirmAll(false)
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const clear = (ids: string[]): void => {
    setOpen(false)
    void removeEvents(ids)
  }
  return (
    <div className="types" ref={box}>
      <button className="types-btn" aria-expanded={open} aria-haspopup="true" title="Clear events" onClick={() => setOpen(!open)}>
        <Icon.trash /> Clear <Icon.chevron />
      </button>
      {open && (
        <div className="popover types-menu clear-menu" role="menu" aria-label="Clear events">
          <button role="menuitem" disabled={!testIds.length} onClick={() => clear(testIds)}>
            Clear tests{testIds.length ? ` (${testIds.length})` : ''}
            <small>Test alerts from Streamer.bot, StreamElements or Streamlabs. They also go away when the app restarts</small>
          </button>
          <button role="menuitem" className={confirmAll ? 'danger' : ''} disabled={!allIds.length} onClick={() => (confirmAll ? clear(allIds) : setConfirmAll(true))}>
            {confirmAll ? 'Click again to clear everything' : 'Clear all events…'}
            <small>{confirmAll ? "This can't be undone" : 'Empties the whole list. New events keep arriving'}</small>
          </button>
        </div>
      )}
    </div>
  )
}

/** A checklist of event types. Choices are saved, so they survive a restart. */
function TypesMenu({ hidden, onChange }: { hidden: EventType[]; onChange(hidden: EventType[]): void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const shown = ALL_TYPES.filter((t) => !hidden.includes(t)).length
  const label = shown === ALL_TYPES.length ? 'All types' : shown === 0 ? 'No types' : `${shown} of ${ALL_TYPES.length} types`
  const flip = (t: EventType): void => onChange(hidden.includes(t) ? hidden.filter((x) => x !== t) : [...hidden, t])
  return (
    <div className="types" ref={box}>
      <button className={shown < ALL_TYPES.length ? 'types-btn filtered' : 'types-btn'} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        {label} <Icon.chevron />
      </button>
      {open && (
        <div className="popover types-menu" role="menu" aria-label="Event types">
          <div className="types-quick">
            <button onClick={() => onChange([])}>Select all</button>
            <button onClick={() => onChange([...ALL_TYPES])}>Clear all</button>
          </div>
          {ALL_TYPES.map((t) => (
            <label key={t} className="types-item">
              <input type="checkbox" checked={!hidden.includes(t)} onChange={() => flip(t)} /> {EVENT_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function EventsDrawer({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element {
  const events = useStore((s) => s.events)
  const filter = useStore((s) => s.settings!.eventFilter)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const testIds = useMemo(() => events.filter((e) => e.test).map((e) => e.id), [events])

  const oldest = !!filter.oldestFirst
  const shown = useMemo(() => events
    .filter((e) => (e.type === 'donation' || filter.platforms[e.platform]) && !filter.hiddenTypes.includes(e.type))
    .sort((a, b) => (oldest ? a.ts - b.ts : b.ts - a.ts))
    .slice(0, 500), [events, filter, oldest])

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
              <button key={p} className={filter.platforms[p] ? `pf-toggle on ${p}` : `pf-toggle ${p}`} aria-pressed={filter.platforms[p]}
                title={`${filter.platforms[p] ? 'Showing' : 'Hiding'} ${PLATFORM_LABEL[p]} events`}
                onClick={() => void updateSettings({ eventFilter: { ...filter, platforms: { ...filter.platforms, [p]: !filter.platforms[p] } } })}>
                <PlatformIcon platform={p} size={16} />
              </button>
            ))}
            <TypesMenu hidden={filter.hiddenTypes} onChange={(hiddenTypes) => void updateSettings({ eventFilter: { ...filter, hiddenTypes } })} />
            <button className="types-btn sort-btn" aria-label={oldest ? 'Oldest first. Click for newest first' : 'Newest first. Click for oldest first'}
              title={oldest ? 'Showing oldest first' : 'Showing newest first'}
              onClick={() => void updateSettings({ eventFilter: { ...filter, oldestFirst: !oldest } })}>
              <span className={oldest ? 'sort-arrow up' : 'sort-arrow'}><Icon.chevron /></span> {oldest ? 'Oldest' : 'Newest'}
            </button>
            <ClearMenu testIds={testIds} allIds={events.map((e) => e.id)} />
          </div>
          <button className="icon-btn" aria-label="Back to chat" title="Back to chat (Esc)" onClick={onClose}><Icon.close /></button>
        </div>
        <ul className="event-list">
          {shown.length === 0 && <li className="empty">{events.length ? 'No events match these filters.' : 'No events yet.'}</li>}
          {shown.map((e) => <EventRow key={e.id} e={e} open={expanded.has(e.id)} onToggle={() => toggle(e.id)} />)}
        </ul>
      </div>
    </section>
  )
}

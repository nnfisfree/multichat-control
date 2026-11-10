import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { plainText } from '../../shared/parts'
import { PLATFORM_LABEL, type ActionResult, type ChatMessage, type ModerationRequest, type Platform, type UserCard, type UserEntry } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { Pieces } from './ChatRow'

const DAY = 86400000
const date = (ts: number): string => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
const stamp = (ts: number): string => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** "3 years", "5 months", "12 days" or "today". */
function age(ts: number): string {
  const days = Math.floor((Date.now() - ts) / DAY)
  if (days >= 365) { const y = Math.floor(days / 365); return `${y} year${y === 1 ? '' : 's'}` }
  if (days >= 60) return `${Math.floor(days / 30)} months`
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`
  return 'today'
}

interface Props {
  platform: Platform
  user: UserEntry
  /** Where the click was; the card opens beside it, kept inside the window. */
  x: number
  y: number
  onClose(): void
  onReply(m: ChatMessage): void
  onResult(r: ActionResult): void
}

/** A viewer card: who someone is, and everything they said in this channel. */
const WIDTH = 420
const MIN_HEIGHT = 380
const GAP = 12

export function UserCardPanel({ platform, user, x, y, onClose, onReply, onResult }: Props): JSX.Element {
  const box = useRef<HTMLElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number }>({ left: x + GAP, top: y, maxHeight: 600 })
  // Beside the pointer, flipping left or up when there isn't room, and never outside the window.
  useLayoutEffect(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(WIDTH, vw - 2 * GAP)
    const left = x + GAP + width <= vw - GAP ? x + GAP : Math.max(GAP, x - GAP - width)
    const height = Math.min(box.current?.scrollHeight ?? MIN_HEIGHT, vh - 2 * GAP)
    const top = Math.max(GAP, Math.min(y - 24, vh - GAP - Math.max(height, Math.min(MIN_HEIGHT, vh - 2 * GAP))))
    setPlace({ left, top, maxHeight: vh - top - GAP })
  }, [x, y])
  const [card, setCard] = useState<UserCard | null>(null)
  const [failed, setFailed] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    setCard(null)
    setFailed('')
    window.nnf.userCard(platform, user).then(setCard, (e) => setFailed(String(e?.message ?? e)))
  }, [platform, user.id])

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (card?.messages ?? []).filter((m) => !t || plainText(m.parts).toLowerCase().includes(t)).slice(0, 300)
  }, [card, q])

  const mod = (req: ModerationRequest) => (): void => {
    window.nnf.moderate(platform, req).then(onResult, (e) => onResult({ ok: false, message: String(e) }))
  }
  const who = { userId: user.id, userName: card?.name ?? user.name }
  const self = card?.roles?.includes('Broadcaster')
  const latestLive = card?.messages.find((m) => !m.history && !m.deleted)
  const fresh = card?.createdAt !== undefined && Date.now() - card.createdAt < 30 * DAY

  return (
    <aside ref={box} className="popover user-card" role="dialog" aria-label={`User card: ${user.name}`} style={{ left: place.left, top: place.top, maxHeight: place.maxHeight }}>
      <header className="uc-head">
        {card?.avatar ? <img className="uc-avatar" src={card.avatar} alt="" /> : <span className="uc-avatar uc-initial">{user.name.slice(0, 1).toUpperCase()}</span>}
        <div className="uc-who">
          <h2 style={{ color: card?.color ?? user.color }}>{card?.name ?? user.name}</h2>
          <span className="uc-platform"><PlatformIcon platform={platform} size={14} /> {PLATFORM_LABEL[platform]}{card?.login && card.login.toLowerCase() !== (card.name ?? '').toLowerCase() ? ` · ${card.login}` : ''}</span>
          {card?.roles && card.roles.length > 0 && <div className="uc-roles">{card.roles.map((r) => <span key={r} className="uc-chip">{r}</span>)}</div>}
        </div>
        <button className="icon-btn" aria-label="Close user card" onClick={onClose}><Icon.close /></button>
      </header>

      {!card && !failed && <p className="uc-loading">Loading…</p>}
      {failed && <div className="notice bad">{failed}</div>}

      {card && (
        <>
          <dl className="uc-facts">
            {card.createdAt !== undefined && <><dt>Account created</dt><dd className={fresh ? 'warn' : ''}>{date(card.createdAt)} · {age(card.createdAt)} old{fresh ? ' · new account' : ''}</dd></>}
            {card.followedAt !== undefined && <><dt>Following</dt><dd>{card.followedAt ? `Since ${date(card.followedAt)} (${age(card.followedAt)})` : 'Not following'}</dd></>}
            {card.sub !== undefined && <><dt>Subscription</dt><dd>{card.sub ? [card.sub.tier, card.sub.months ? `${card.sub.months} months` : '', card.sub.gift ? 'gifted' : ''].filter(Boolean).join(' · ') || 'Subscribed' : 'Not subscribed'}</dd></>}
            {card.member !== undefined && <><dt>Member</dt><dd>{card.member ? 'Yes' : 'No'}</dd></>}
            {card.banned !== undefined && card.banned !== null && <><dt>Status</dt><dd className="bad">{card.banned.until ? `Timed out until ${stamp(card.banned.until)}` : 'Banned'}</dd></>}
          </dl>

          <div className="uc-summary">
            <b>{card.total.toLocaleString()} message{card.total === 1 ? '' : 's'}</b>
            {card.firstSeen && <> · first seen {date(card.firstSeen)}</>}
            {card.total > 0 && (card.ofStreams > 1 ? <> · in {card.streams} of your last {card.ofStreams} streams</> : <> · in this stream</>)}
          </div>
          {(card.timeouts > 0 || card.bans > 0 || card.deleted > 0) && (
            <div className="uc-flags">
              {card.timeouts > 0 && <span className="uc-chip warn">Timed out {card.timeouts}×</span>}
              {card.bans > 0 && <span className="uc-chip bad">Banned {card.bans}×</span>}
              {card.deleted > 0 && <span className="uc-chip">{card.deleted} deleted</span>}
            </div>
          )}

          <div className="uc-actions">
            {latestLive && <button className="btn sm" onClick={() => { onReply(latestLive); onClose() }}>Reply</button>}
            {!self && <>
              <button className="btn ghost sm" title="Clears their messages from chat" onClick={mod({ kind: 'timeout', seconds: 1, ...who })}>Timeout 1s</button>
              <button className="btn ghost sm" onClick={mod({ kind: 'timeout', seconds: 60, ...who })}>1 min</button>
              <button className="btn ghost sm" onClick={mod({ kind: 'timeout', seconds: 600, ...who })}>10 min</button>
              <button className="btn ghost sm danger" onClick={mod({ kind: 'ban', ...who })}>Ban</button>
              {platform === 'twitch' && <button className="btn ghost sm" onClick={mod({ kind: 'shoutout', ...who })}>Shoutout</button>}
            </>}
            {card.url && <button className="btn ghost sm" onClick={() => void window.nnf.openExternal(card.url!)}>Open channel</button>}
          </div>

          <div className="uc-history">
            <label className="users-filter uc-search">
              <Icon.search />
              <input placeholder="Search their messages" aria-label="Search their messages" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <ul>
              {shown.length === 0 && <li className="uc-empty">{card.total ? 'No messages match.' : 'No messages in your channel yet.'}</li>}
              {shown.map((m) => (
                <li key={m.id}>
                  <time>{stamp(m.ts)}</time>
                  {m.deleted ? <span className="deleted">[message deleted]</span> : <span className="uc-text"><Pieces parts={m.parts} /></span>}
                </li>
              ))}
            </ul>
            {card.messages.length > shown.length && !q && <p className="uc-more">Showing the latest {shown.length} of {card.total.toLocaleString()}. Search to find older ones.</p>}
          </div>
        </>
      )}
    </aside>
  )
}

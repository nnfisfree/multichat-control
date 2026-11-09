import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type Platform, type PlatformUsers, type UserEntry, type UserGroups } from '../../../shared/types'
import { Icon, PlatformIcon } from '../Icons'
import { connected, refreshUsers, useStore } from '../store'

const GROUPS: { key: keyof UserGroups; label: string }[] = [
  { key: 'broadcaster', label: 'Broadcaster' },
  { key: 'moderators', label: 'Moderators' },
  { key: 'vips', label: 'VIPs' },
  { key: 'members', label: 'Members' },
  { key: 'users', label: 'Users' }
]

const ago = (ts: number, now: number): string => {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

interface Props {
  open: boolean
  onClose(): void
  onUser(e: MouseEvent, platform: Platform, user: UserEntry, broadcaster: boolean): void
  onCard(platform: Platform, user: UserEntry, x: number, y: number): void
}

function Section({ data, filter, onUser, onCard }: { data: PlatformUsers; filter: string; onUser: Props['onUser']; onCard: Props['onCard'] }): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const p = data.platform
  const match = (u: UserEntry): boolean => !filter || u.name.toLowerCase().includes(filter) || !!u.login?.toLowerCase().includes(filter)
  const groups = GROUPS.map((g) => ({ ...g, list: data.groups[g.key].filter(match) })).filter((g) => g.list.length)
  const total = GROUPS.reduce((n, g) => n + data.groups[g.key].length, 0)
  const flip = (k: string): void => setCollapsed((s) => {
    const n = new Set(s)
    if (!n.delete(k)) n.add(k)
    return n
  })
  return (
    <section className="users-section">
      <header>
        <span className={`pf ${p}`}><PlatformIcon platform={p} size={16} /></span>
        <h3>{PLATFORM_LABEL[p]}</h3>
        <span className="users-live">
          {data.live ? (data.viewers !== undefined ? `${data.viewers.toLocaleString()} watching` : 'Live') : 'Offline'}
        </span>
        <span className="users-source">{data.source === 'chatters' ? `${total.toLocaleString()} in chat` : 'Active in chat this stream'}</span>
      </header>
      {data.needsRelogin && (
        <div className="notice users-relogin">
          Log in to Twitch again to see everyone in chat. The app needs a new permission for it.
          <button className="btn sm" onClick={() => void window.nnf.login('twitch')}>Log in again</button>
        </div>
      )}
      {groups.length === 0 && (
        <p className="users-empty">
          {filter ? 'No names match.' : data.source === 'chatters' ? 'Nobody signed in is in chat right now.' : 'Nobody has chatted yet this stream.'}
        </p>
      )}
      {groups.map((g) => {
        const key = `${p}:${g.key}`
        const open = !collapsed.has(key)
        return (
          <div key={g.key} className="users-group">
            <button className="users-group-head" aria-expanded={open} onClick={() => flip(key)}>
              <span className={open ? 'chev open' : 'chev'}><Icon.chevron /></span> {g.label} <span className="users-count">{g.list.length}</span>
            </button>
            {open && (
              <ul>
                {g.list.map((u) => (
                  <li key={u.id}>
                    <button style={u.color ? { color: u.color } : undefined} title="Click for user card, right-click for moderation" onClick={(e) => onCard(p, u, e.clientX, e.clientY)} onContextMenu={(e) => onUser(e, p, u, g.key === 'broadcaster')}>{u.name}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

/** Who is in chat on each platform, grouped by role, like OBS's "Users in Chat". */
export function UsersDrawer({ open, onClose, onUser, onCard }: Props): JSX.Element {
  const users = useStore((s) => s.users)
  const statuses = useStore((s) => s.statuses)
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState<Set<Platform>>(new Set())
  const [now, setNow] = useState(Date.now())
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    void refreshUsers()
    input.current?.focus()
    const list = setInterval(() => void refreshUsers(), 20000)
    const clock = setInterval(() => setNow(Date.now()), 5000)
    return () => { clearInterval(list); clearInterval(clock) }
  }, [open])

  const platforms = PLATFORMS.filter((p) => connected(statuses, p))
  const shown = platforms.filter((p) => !hidden.has(p) && users[p])
  const updated = Math.min(...shown.map((p) => users[p]!.updatedAt))
  const q = filter.trim().toLowerCase()

  return (
    <section className={open ? 'drawer open' : 'drawer'} aria-hidden={!open} aria-label="Users in chat" inert={!open}>
      <div className="drawer-panel">
        <div className="drawer-head">
          <h2>Users in Chat</h2>
          <div className="filters">
            {platforms.map((p) => (
              <button key={p} className={hidden.has(p) ? `pf-toggle ${p}` : `pf-toggle on ${p}`} aria-pressed={!hidden.has(p)}
                title={`${hidden.has(p) ? 'Show' : 'Hide'} ${PLATFORM_LABEL[p]}`}
                onClick={() => setHidden((s) => { const n = new Set(s); if (!n.delete(p)) n.add(p); return n })}>
                <PlatformIcon platform={p} size={16} />
              </button>
            ))}
            <label className="users-filter">
              <Icon.search />
              <input ref={input} placeholder="Filter" aria-label="Filter users" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>
          <button className="icon-btn" aria-label="Back to chat" title="Back to chat (Esc)" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="users-list">
          {platforms.length === 0 && <p className="users-empty">Log in to a platform to see who's in chat.</p>}
          {platforms.length > 0 && shown.length === 0 && <p className="users-empty">Loading…</p>}
          {shown.map((p) => <Section key={p} data={users[p]!} filter={q} onUser={onUser} onCard={onCard} />)}
        </div>
        <p className="users-foot">
          Viewers who aren't logged in don't appear in any list. YouTube and Kick don't share who's watching, so they show who has chatted this stream.
          {shown.length > 0 && Number.isFinite(updated) && <> Updated {ago(updated, now)}.</>}
        </p>
      </div>
    </section>
  )
}

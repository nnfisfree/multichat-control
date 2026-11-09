import type { JSX } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ConnectionState, type Platform } from '../../../shared/types'
import { Icon, PlatformIcon } from '../Icons'
import { connected, useStore } from '../store'
import { ConnectBar, ConnectionsMenu } from './Connections'

export type Tab = Platform | 'all'

const STATUS_TEXT: Record<ConnectionState['status'], string> = {
  'needs-setup': 'Not logged in', 'needs-login': 'Not logged in', authorizing: 'Logging in', connecting: 'Connecting',
  connected: 'Connected', reconnecting: 'Reconnecting', waiting: 'Waiting for broadcast', error: 'Error', disabled: 'Off'
}

export const statusText = (s?: ConnectionState): string => (s ? `${STATUS_TEXT[s.status]}${s.detail && s.status !== 'needs-setup' ? `: ${s.detail}` : ''}` : 'Off')

function dotClass(s?: ConnectionState): string {
  if (!s) return 'off'
  if (s.status === 'connected') return 'good'
  if (s.status === 'error') return 'bad'
  if (s.status === 'reconnecting' || s.status === 'connecting' || s.status === 'waiting' || s.status === 'authorizing') return 'warn'
  return 'off'
}

interface Props {
  tab: Tab
  eventsOpen: boolean
  usersOpen: boolean
  onUsers(): void
  onTab(t: Tab): void
  onEvents(): void
  onSettings(): void
}

export function Tabs({ tab, eventsOpen, usersOpen, onUsers, onTab, onEvents, onSettings }: Props): JSX.Element {
  const statuses = useStore((s) => s.statuses)
  const watching = useStore((s) => PLATFORMS.reduce((n, p) => n + (connected(s.statuses, p) ? s.users[p]?.viewers ?? 0 : 0), 0))
  const unread = useStore((s) => s.unreadEvents)
  return (
    <nav className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'all' && !eventsOpen} className={tab === 'all' ? 'tab active' : 'tab'} aria-label="All" onClick={() => onTab('all')}>
        <Icon.all /> <span className="tab-label">All</span>
      </button>
      {PLATFORMS.map((p) => (
        <button key={p} role="tab" aria-selected={tab === p && !eventsOpen} className={tab === p ? 'tab active' : 'tab'} title={`${PLATFORM_LABEL[p]}: ${statusText(statuses[p])}`} aria-label={PLATFORM_LABEL[p]} onClick={() => onTab(p)}>
          <PlatformIcon platform={p} /> <span className="tab-label">{PLATFORM_LABEL[p]}</span>
          <i className={`dot ${dotClass(statuses[p])}`} aria-label={statusText(statuses[p])} />
        </button>
      ))}
      <button className={eventsOpen ? 'tab events active' : 'tab events'} aria-expanded={eventsOpen} aria-label="Events" onClick={onEvents}>
        <Icon.events /> <span className="tab-label">Events</span>
        {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
        <span className={eventsOpen ? 'chev open' : 'chev'}><Icon.chevron /></span>
      </button>
      <div className="grow connect-slot"><ConnectBar /></div>
      <ConnectionsMenu />
      <button className={usersOpen ? 'icon-btn users-btn on' : 'icon-btn users-btn'} aria-label="Users in chat" aria-expanded={usersOpen}
        title={watching ? `Users in chat · ${watching.toLocaleString()} watching` : 'Users in chat'} onClick={onUsers}>
        <Icon.users />
        {watching > 0 && <span className="users-badge">{watching > 9999 ? `${Math.round(watching / 1000)}k` : watching.toLocaleString()}</span>}
      </button>
      <button className="icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}><Icon.gear /></button>
    </nav>
  )
}

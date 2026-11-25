import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ConnectionState, type Platform } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { connected, useStore } from '../lib/store'
import { ConnectBar, ConnectionsMenu } from './Connections'

export type Tab = Platform | 'all'

const STATUS_TEXT: Record<ConnectionState['status'], string> = {
  'needs-setup': 'Not logged in', 'needs-login': 'Not logged in', authorizing: 'Logging in', connecting: 'Connecting',
  connected: 'Connected', reconnecting: 'Reconnecting', waiting: 'Waiting for broadcast', error: 'Error', disabled: 'Off'
}

export const statusText = (s?: ConnectionState): string => (s ? `${STATUS_TEXT[s.status]}${s.detail && s.status !== 'needs-setup' ? `: ${s.detail}` : ''}` : 'Off')

function dotClass(s?: ConnectionState): string {
  if (!s) return 'off'
  // waiting for a stream to go live still means logged in and ready, so count it as connected
  if (s.status === 'connected' || s.status === 'waiting') return 'good'
  if (s.status === 'error') return 'bad'
  if (s.status === 'reconnecting' || s.status === 'connecting' || s.status === 'authorizing') return 'warn'
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

/** Colours running round the selected tab's frame: the platform's own, or every connected one on All. */
const FRAME_COLOR: Record<Platform, string> = { twitch: 'var(--twitch)', youtube: 'var(--youtube)', kick: 'var(--kick)', tiktok: 'var(--tiktok)' }

/**
 * Hyprland-style frame round the selected tab: a rounded border whose gradient keeps circling,
 * gliding over (with a little overshoot) when another tab is picked.
 */
function TabFrame({ tab, shown, nav }: { tab: Tab; shown: Platform[]; nav: React.RefObject<HTMLElement | null> }): JSX.Element | null {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const first = useRef(true)
  useLayoutEffect(() => {
    const el = nav.current
    if (!el) return
    const measure = (): void => {
      const b = el.querySelector<HTMLElement>(`[data-tab="${tab}"]`)
      setBox(b ? { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight } : null)
    }
    measure()
    // labels hide on narrow windows and fonts load late: follow the tab's size (on the next frame,
    // so the observer never re-enters its own loop)
    let raf = 0
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) })
    ro.observe(el)
    el.querySelectorAll('.tab').forEach((t) => ro.observe(t))
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [tab, shown.join()])
  useEffect(() => { if (box) first.current = false }, [box])
  if (!box) return null
  const colors = tab === 'all' ? (shown.length ? shown.map((p) => FRAME_COLOR[p]) : ['var(--blue)']) : [FRAME_COLOR[tab]]
  // the colours go round twice with a white glint between, so the loop has no seam
  const ring = [...colors, '#fff', ...colors, '#fff']
  const stops = [...ring, ring[0]].map((c, i, all) => `${c} ${(i / (all.length - 1)) * 100}%`).join(', ')
  const style = {
    transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h,
    '--frame-stops': stops, '--frame-tint': colors[0]
  } as CSSProperties
  return <span className={first.current ? 'tab-frame' : 'tab-frame moves'} style={style} aria-hidden="true"><span key={tab} className="tab-frame-pop" /></span>
}

/**
 * How much the tab bar has to squeeze to fit, whatever is connected: 0 everything in full, 1 the
 * status button down to its count, 2 platform tabs down to their logos. Each step remembers how
 * wide the bar needed to be, so it only grows back once that fits again (no flicker).
 */
function useFit(nav: React.RefObject<HTMLElement | null>, deps: unknown[]): number {
  const [fit, setFit] = useState(0)
  const needed = useRef<number[]>([])
  useLayoutEffect(() => {
    const el = nav.current
    if (!el) return
    let raf = 0
    const check = (): void => {
      setFit((level) => {
        if (el.scrollWidth > el.clientWidth + 1 && level < 2) {
          needed.current[level] = el.scrollWidth
          return level + 1
        }
        if (level > 0 && el.clientWidth >= (needed.current[level - 1] ?? Infinity)) return level - 1
        return level
      })
    }
    const soon = (): void => { cancelAnimationFrame(raf); raf = requestAnimationFrame(check) }
    const ro = new ResizeObserver(soon)
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    soon()
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, deps)
  // a change of level changes the widths: check again right after
  useLayoutEffect(() => {
    const el = nav.current
    if (el && el.scrollWidth > el.clientWidth + 1 && fit < 2) {
      needed.current[fit] = el.scrollWidth
      setFit(fit + 1)
    }
  }, [fit])
  return fit
}

export function Tabs({ tab, eventsOpen, usersOpen, onUsers, onTab, onEvents, onSettings }: Props): JSX.Element {
  const nav = useRef<HTMLElement>(null)
  const statuses = useStore((s) => s.statuses)
  const watching = useStore((s) => PLATFORMS.reduce((n, p) => n + (connected(s.statuses, p) ? s.users[p]?.viewers ?? 0 : 0), 0))
  const unread = useStore((s) => s.unreadEvents)
  // a platform's tab only shows while it's connected. The open tab stays through a reconnect, so
  // pressing Reconnect doesn't throw you back to All.
  const shown = PLATFORMS.filter((p) => connected(statuses, p) || (p === tab && statuses[p]?.status === 'connecting'))
  const tabGone = tab !== 'all' && !shown.includes(tab)
  useEffect(() => { if (tabGone) onTab('all') }, [tabGone])
  const fit = useFit(nav, [shown.join(), unread > 0])
  return (
    <nav className={`tabs fit-${fit}`} role="tablist" ref={nav}>
      <TabFrame tab={tab} shown={shown} nav={nav} />
      <button data-tab="all" role="tab" aria-selected={tab === 'all' && !eventsOpen} className={tab === 'all' ? 'tab active' : 'tab'} aria-label="All" onClick={() => onTab('all')}>
        <Icon.all /> <span className="tab-label">All</span>
      </button>
      {shown.map((p) => (
        <button key={p} data-tab={p} role="tab" aria-selected={tab === p && !eventsOpen} className={tab === p ? `tab pf-tab ${p} active` : `tab pf-tab ${p}`} title={`${PLATFORM_LABEL[p]}: ${statusText(statuses[p])}`} aria-label={PLATFORM_LABEL[p]} onClick={() => onTab(p)}>
          <PlatformIcon platform={p} /> <span className="tab-label">{PLATFORM_LABEL[p]}</span>
          <i className={`dot ${dotClass(statuses[p])}`} aria-label={statusText(statuses[p])} />
        </button>
      ))}
      <button className={eventsOpen ? 'tab events active' : 'tab events'} aria-expanded={eventsOpen} aria-label="Events" onClick={onEvents}>
        <Icon.events /> <span className="tab-label">Events</span>
        {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
        <span className={eventsOpen ? 'chev open' : 'chev'}><Icon.chevron /></span>
      </button>
      <div className="grow" />
      <ConnectionsMenu />
      <button className={usersOpen ? 'icon-btn users-btn on' : 'icon-btn users-btn'} aria-label="Users in chat" aria-expanded={usersOpen}
        title={watching ? `Users in chat · ${watching.toLocaleString()} watching` : 'Users in chat'} onClick={onUsers}>
        <Icon.users />
        {watching > 0 && <span className="users-badge">{watching > 9999 ? `${Math.round(watching / 1000)}k` : watching.toLocaleString()}</span>}
      </button>
      <button className="icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}><Icon.gear /></button>
      <ConnectBar />
    </nav>
  )
}

import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { ALERT_SOURCE_LABEL, PLATFORMS, PLATFORM_LABEL, type ConnectionState, type IntegrationState } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { useStore } from '../lib/store'

type Tone = 'good' | 'wait' | 'warn' | 'bad' | 'off'

interface Service {
  key: string
  label: string
  icon: ReactNode
  tone: Tone
  text: string
  account?: string
  /** In use, so it counts toward "x of y connected". */
  tracked: boolean
  pending: boolean
  actions: { label: string; run(): Promise<unknown> }[]
  hint?: string
}

const live = (s?: string): boolean => s === 'connected' || s === 'waiting' || s === 'reconnecting'

function platformService(p: (typeof PLATFORMS)[number], st?: ConnectionState): Service {
  const base = { key: p, label: PLATFORM_LABEL[p], icon: <PlatformIcon platform={p} size={16} />, account: st?.account }
  const login = { label: 'Log in', run: () => window.nnf.login(p) }
  const actions = live(st?.status)
    ? [{ label: 'Reconnect', run: () => window.nnf.reconnect(p) }, { label: 'Log out', run: () => window.nnf.logout(p) }]
    : [login]
  switch (st?.status) {
    case 'connected': return { ...base, tone: 'good', text: 'Connected', tracked: true, pending: false, actions }
    case 'waiting': return { ...base, tone: 'good', text: p === 'youtube' ? 'Waiting for a live stream' : (st.detail ?? 'Waiting'), tracked: true, pending: false, actions }
    case 'connecting': return { ...base, tone: 'warn', text: 'Connecting…', tracked: true, pending: true, actions: [] }
    case 'authorizing': return { ...base, tone: 'warn', text: 'Finish logging in in your browser', tracked: true, pending: true, actions: [login], hint: st.device ? `Code: ${st.device.code}` : undefined }
    case 'reconnecting': return { ...base, tone: 'warn', text: 'Reconnecting…', tracked: true, pending: true, actions }
    case 'error': return { ...base, tone: 'bad', text: st.detail ? `Error: ${st.detail}` : 'Error', tracked: true, pending: false, actions: [{ label: 'Reconnect', run: () => window.nnf.reconnect(p) }] }
    case 'needs-login':
      // A login that expired is still in use, so it counts as a problem rather than "off".
      return st.detail
        ? { ...base, tone: 'bad', text: 'Login expired', tracked: true, pending: false, actions: [login] }
        : { ...base, tone: 'off', text: 'Not logged in', tracked: false, pending: false, actions: [login] }
    default: return { ...base, tone: 'off', text: 'Not logged in', tracked: false, pending: false, actions: [login] }
  }
}

function alertService(source: 'streamelements' | 'streamlabs', st?: IntegrationState): Service {
  const base = { key: source, label: ALERT_SOURCE_LABEL[source], icon: <span className={`src-tag ${source}`}>{source === 'streamelements' ? 'SE' : 'SL'}</span>, account: st?.status === 'connected' ? st.account : undefined }
  const login = { label: 'Log in', run: () => window.nnf.alerts.login(source) }
  const on = [{ label: 'Reconnect', run: () => window.nnf.alerts.reconnect(source) }, { label: 'Log out', run: () => window.nnf.alerts.logout(source) }]
  switch (st?.status) {
    case 'connected': return { ...base, tone: 'good', text: 'Connected', tracked: true, pending: false, actions: on }
    case 'connecting': return { ...base, tone: 'warn', text: 'Connecting…', tracked: true, pending: true, actions: [] }
    case 'authorizing': return { ...base, tone: 'warn', text: 'Finish logging in in your browser', tracked: true, pending: true, actions: [] }
    case 'reconnecting': return { ...base, tone: 'warn', text: 'Reconnecting…', tracked: true, pending: true, actions: on }
    case 'error': return { ...base, tone: 'bad', text: st.detail ?? 'Error', tracked: true, pending: false, actions: on }
    case 'needs-setup': return { ...base, tone: 'off', text: 'Coming soon', tracked: false, pending: false, actions: [] }
    case 'needs-login':
      return st.detail
        ? { ...base, tone: 'bad', text: 'Login expired', tracked: true, pending: false, actions: [login] }
        : { ...base, tone: 'off', text: 'Not logged in', tracked: false, pending: false, actions: [login] }
    default: return { ...base, tone: 'off', text: 'Starting…', tracked: false, pending: false, actions: [] }
  }
}

/** Everything the app connects to, in menu order. */
function useServices(): Service[] {
  const statuses = useStore((s) => s.statuses)
  const integrations = useStore((s) => s.integrations)
  const choice = useStore((s) => s.settings?.alertService ?? 'none')
  const panelSignedIn = useStore((s) => s.panelSignedIn)
  const demo = useStore((s) => !!s.boot?.demo)
  const obs = useStore((s) => s.obs)
  const obsEnabled = useStore((s) => s.settings?.obsEnabled ?? false)
  const list = PLATFORMS.map((p) => platformService(p, statuses[p]))
  // The rewards panel only matters once Twitch itself is logged in. Not everyone uses it, so
  // it only counts toward the total once it's signed in.
  if (!demo && live(statuses.twitch?.status) && panelSignedIn !== null) {
    list.splice(1, 0, {
      key: 'panel', label: 'Twitch Rewards panel', icon: <Icon.gem />, pending: false, actions: [],
      ...(panelSignedIn
        ? { tone: 'good' as const, text: 'Signed in', tracked: true }
        : { tone: 'off' as const, text: 'Not signed in', tracked: false, hint: 'Open the gem panel and click Sign in to Twitch.' })
    })
  }
  if (choice !== 'none') list.push(alertService(choice, integrations[choice]))
  // OBS only appears once the streamer turned it on in Settings.
  if (obsEnabled && !demo) {
    const tone: Tone = obs.status === 'connected' ? 'good' : obs.status === 'error' ? 'bad' : 'warn'
    const text = obs.status === 'connected' ? (obs.stats?.stream.active ? 'Connected · live' : 'Connected') : obs.status === 'error' ? (obs.detail ?? 'Error') : 'Waiting for OBS…'
    list.push({
      key: 'obs', label: 'OBS Studio', icon: <span className="src-tag obs">OBS</span>, tone, text, tracked: true, pending: false,
      hint: obs.status === 'connected' ? undefined : obs.detail,
      actions: [{ label: 'Reconnect', run: () => window.nnf.obs.reconnect() }]
    })
  }
  return list
}

const counts = (list: Service[]): { tracked: number; up: number; pending: number } => {
  const tracked = list.filter((s) => s.tracked)
  return { tracked: tracked.length, up: tracked.filter((s) => s.tone === 'good' || s.tone === 'wait').length, pending: tracked.filter((s) => s.pending).length }
}

/** A thin bar that fills as services connect, then says how it went and fades away. */
export function ConnectBar({ fallback }: { fallback?: ReactNode }): JSX.Element | null {
  const { tracked, up, pending } = counts(useServices())
  const [phase, setPhase] = useState<'hidden' | 'progress' | 'done'>(pending ? 'progress' : 'hidden')
  useEffect(() => {
    if (pending > 0) return setPhase('progress')
    if (phase !== 'progress') return
    setPhase('done')
    const t = setTimeout(() => setPhase('hidden'), 2500)
    return () => clearTimeout(t)
  }, [pending])
  if (phase === 'hidden' || tracked === 0) return <>{fallback}</>
  const settled = tracked - pending
  const allUp = phase === 'done' && up === tracked
  const label = phase === 'progress' ? `Connecting… ${settled} of ${tracked}` : allUp ? 'All connected' : `${up} of ${tracked} connected`
  const pct = Math.round((phase === 'done' ? 1 : settled / tracked) * 100)
  const text = <>{allUp && <span className="connect-check" aria-hidden="true">✓</span>}{label}</>
  // The text is drawn twice: once over the empty track, once in a contrasting colour over the fill,
  // clipped to the fill, so it stays readable as the bar passes under it.
  return (
    <div className={`connect-bar ${phase}${phase === 'done' ? (allUp ? ' good' : ' warn') : ''}`} role="status" aria-live="polite" style={{ '--pct': `${pct}%` } as CSSProperties}>
      <span className="connect-fill" />
      <span className="connect-label">{text}</span>
      <span className="connect-label over" aria-hidden="true">{text}</span>
      {phase === 'progress' && <span className="connect-ticks" aria-hidden="true">{Array.from({ length: tracked - 1 }, (_, i) => <i key={i} style={{ left: `${((i + 1) / tracked) * 100}%` }} />)}</span>}
    </div>
  )
}

function Row({ s }: { s: Service }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const run = (fn: () => Promise<unknown>) => (): void => {
    setErr('')
    fn().catch((e) => {
      const text = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/cancelled/i.test(text)) setErr(text)
    })
  }
  const expandable = s.actions.length > 0 || !!s.hint
  return (
    <li className={`conn-row${open ? ' open' : ''}`}>
      <button className="conn-head" disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => setOpen(!open)}>
        <i className={`conn-dot ${s.tone}`} aria-hidden="true" />
        <span className="conn-icon">{s.icon}</span>
        <span className="conn-name">{s.label}</span>
        <span className="conn-state" title={s.text}>{s.account && (s.tone === 'good' || s.tone === 'wait') ? `${s.account} · ` : ''}{s.text}</span>
        {expandable && <span className={open ? 'chev open' : 'chev'}><Icon.chevron /></span>}
      </button>
      {open && (
        <div className="conn-body">
          {s.hint && <p className="conn-hint">{s.hint}</p>}
          {s.actions.length > 0 && <div className="row-btns">{s.actions.map((a) => <button key={a.label} className="btn sm" onClick={run(a.run)}>{a.label}</button>)}</div>}
          {err && <p className="conn-err" role="alert">{err}</p>}
        </div>
      )}
    </li>
  )
}

/** A status pill that opens the list of connections, each with its own actions. */
export function ConnectionsMenu(): JSX.Element {
  const list = useServices()
  const { tracked, up, pending } = counts(list)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  const tone: Tone = tracked === 0 ? 'off' : pending ? 'warn' : up === tracked ? 'good' : up === 0 ? 'bad' : 'warn'
  const word = tracked === 0 ? 'Not connected' : pending ? 'Connecting' : up === tracked ? 'Connected' : up === 0 ? 'Disconnected' : 'Partially connected'
  return (
    <div className="conn" ref={box}>
      <button className={`conn-pill ${tone}`} aria-haspopup="true" aria-expanded={open} title={`${word} (${up}/${tracked})`} onClick={() => setOpen(!open)}>
        <span className="conn-word">{word}</span>
        {tracked > 0 && <span className="conn-count">({up}/{tracked})</span>}
        <i className={`conn-dot ${tone}`} aria-hidden="true" />
        <span className={open ? 'chev open' : 'chev'}><Icon.chevron /></span>
      </button>
      {open && (
        <div className="popover conn-menu" role="menu" aria-label="Connections">
          <ul>{list.map((s) => <Row key={s.key} s={s} />)}</ul>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { ALERT_SOURCE_LABEL, PLATFORMS, type AlertSource, PLATFORM_LABEL, type ConnectionState, type IntegrationState, STREAM_APPS } from '../../shared/types'
import { BmcLogo, Icon, PlatformIcon, StreamAppLogo, StreamerbotLogo } from './Icons'
import { useStore } from '../lib/store'
import { login as startLogin } from '../lib/login'
import { ALERTS_READY } from '../../shared/app-config'

type Tone = 'good' | 'wait' | 'warn' | 'bad' | 'off'

interface Service {
  key: string
  label: string
  icon: ReactNode
  tone: Tone
  text: string
  account?: string
  /** Counts toward "x of y connected". */
  tracked: boolean
  pending: boolean
  actions: { label: string; run(): Promise<unknown> }[]
  hint?: string
}

const live = (s?: string): boolean => s === 'connected' || s === 'waiting' || s === 'reconnecting'

function platformService(p: (typeof PLATFORMS)[number], st?: ConnectionState): Service {
  const base = { key: p, label: PLATFORM_LABEL[p], icon: <PlatformIcon platform={p} size={16} />, account: st?.account }
  // TikTok has no login: "Set up" opens its card in Settings
  const tiktok = p === 'tiktok'
  const login = { label: tiktok ? 'Set up' : 'Log in', run: () => startLogin(p) }
  const actions = live(st?.status)
    ? [{ label: 'Reconnect', run: () => window.nnf.reconnect(p) }, tiktok ? { label: 'Disconnect', run: () => window.nnf.tiktok.disconnect() } : { label: 'Log out', run: () => window.nnf.logout(p) }]
    : [login]
  if (tiktok && (st?.status === 'needs-setup' || st?.status === 'needs-login' || !st)) {
    // set up before, but the key or username stopped working: that's a problem, not "off"
    const broken = !!st?.detail && !/^Add your TikTok @username/.test(st.detail)
    return broken
      ? { ...base, tone: 'bad', text: 'Needs attention', tracked: true, pending: false, actions: [login], hint: st?.detail }
      : { ...base, tone: 'off', text: 'Not set up', tracked: false, pending: false, actions: [login] }
  }
  switch (st?.status) {
    case 'connected':
      // connected, but a newer feature needs a fresh login: say which and offer it
      return st.relogin
        ? { ...base, tone: 'wait', text: 'Connected · log in again', tracked: true, pending: false, actions: [{ label: 'Log in again', run: () => startLogin(p) }, ...actions], hint: st.relogin }
        : { ...base, tone: 'good', text: 'Connected', tracked: true, pending: false, actions }
    case 'waiting': return { ...base, tone: 'good', text: p === 'youtube' ? 'Waiting for a live stream' : (st.detail ?? 'Waiting'), tracked: true, pending: false, actions }
    case 'connecting': return { ...base, tone: 'warn', text: 'Connecting…', tracked: true, pending: true, actions: [] }
    case 'authorizing': return { ...base, tone: 'warn', text: 'Finish logging in in your browser', tracked: true, pending: true, actions: [login], hint: st.device ? `Code: ${st.device.code}` : undefined }
    case 'reconnecting': return { ...base, tone: 'warn', text: 'Reconnecting…', tracked: true, pending: true, actions }
    case 'error': return { ...base, tone: 'bad', text: st.detail ? `Error: ${st.detail}` : 'Error', tracked: true, pending: false, actions: [{ label: 'Reconnect', run: () => window.nnf.reconnect(p) }] }
    case 'needs-login':
      // an expired login is still in use, so it's a problem, not "off"
      return st.detail
        ? { ...base, tone: 'bad', text: 'Login expired', tracked: true, pending: false, actions: [login] }
        : { ...base, tone: 'off', text: 'Not logged in', tracked: false, pending: false, actions: [login] }
    default: return { ...base, tone: 'off', text: 'Not logged in', tracked: false, pending: false, actions: [login] }
  }
}

function alertService(source: AlertSource, st?: IntegrationState): Service {
  const icon = source === 'buymeacoffee' ? <BmcLogo size={16} /> : <span className={`src-tag ${source}`}>{source === 'streamelements' ? 'SE' : 'SL'}</span>
  const base = { key: source, label: ALERT_SOURCE_LABEL[source], icon, account: st?.status === 'connected' && source !== 'buymeacoffee' ? st.account : undefined }
  // BMC connects with a pasted token, and that UI lives in Settings
  const login = source === 'buymeacoffee'
    ? { label: 'Connect', run: async () => { window.dispatchEvent(new CustomEvent('nnf:open-settings', { detail: { cat: 'connections', target: 'bmc-settings' } })) } }
    : { label: 'Log in', run: () => window.nnf.alerts.login(source) }
  const on = [{ label: 'Reconnect', run: () => window.nnf.alerts.reconnect(source) }, { label: source === 'buymeacoffee' ? 'Disconnect' : 'Log out', run: () => window.nnf.alerts.logout(source) }]
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

/** Everything we connect to, in menu order. */
function useServices(): Service[] {
  const statuses = useStore((s) => s.statuses)
  const integrations = useStore((s) => s.integrations)
  const choice = useStore((s) => s.settings?.alertService ?? 'none')
  const panelSignedIn = useStore((s) => s.panelSignedIn)
  const demo = useStore((s) => !!s.boot?.demo)
  const obs = useStore((s) => s.obs)
  const obsEnabled = useStore((s) => s.settings?.obsEnabled ?? false)
  const streamApp = useStore((s) => s.settings?.streamApp ?? 'obs')
  const sb = useStore((s) => s.streamerbot)
  const sbEnabled = useStore((s) => s.settings?.sbEnabled ?? false)
  const list = PLATFORMS.map((p) => platformService(p, statuses[p]))
  // The rewards panel only matters once Twitch is logged in. Not everyone uses it, so it only
  // counts toward the total once it's signed in.
  if (!demo && live(statuses.twitch?.status) && panelSignedIn !== null) {
    list.splice(1, 0, {
      key: 'panel', label: 'Twitch Rewards panel', icon: <Icon.gem />, pending: false, actions: [],
      ...(panelSignedIn
        ? { tone: 'good' as const, text: 'Signed in', tracked: true }
        : { tone: 'off' as const, text: 'Not signed in', tracked: false, hint: 'Open the gem panel and click Sign in to Twitch.' })
    })
  }
  if (ALERTS_READY && choice !== 'none') list.push(alertService(choice, integrations[choice]))
  // BMC only shows up once it's been connected (it runs next to the picked alert service)
  const bmc = integrations.buymeacoffee
  if (bmc && bmc.status !== 'off' && (bmc.status !== 'needs-login' || bmc.detail)) list.push(alertService('buymeacoffee', bmc))
  // the streaming app only shows once stats are turned on in Settings
  if (obsEnabled && !demo) {
    const tone: Tone = obs.status === 'connected' ? 'good' : obs.status === 'error' ? 'bad' : 'warn'
    const text = obs.status === 'connected' ? (obs.stats?.stream.active ? 'Connected · live' : 'Connected') : obs.status === 'error' ? (obs.detail ?? 'Error') : `Waiting for ${STREAM_APPS[streamApp]}…`
    list.push({
      key: 'obs', label: STREAM_APPS[streamApp], icon: <StreamAppLogo app={streamApp} />, tone, text, tracked: true, pending: false,
      hint: obs.status === 'connected' ? undefined : obs.detail,
      actions: [{ label: 'Reconnect', run: () => window.nnf.obs.reconnect() }]
    })
  }
  // same for Streamer.bot
  if (sbEnabled) {
    const count = sb.actions.filter((a) => a.enabled).length
    const tone: Tone = sb.status === 'connected' ? 'good' : sb.status === 'error' ? 'bad' : 'warn'
    const text = sb.status === 'connected' ? `Connected · ${count} action${count === 1 ? '' : 's'}` : sb.status === 'error' ? 'Needs attention' : 'Waiting…'
    list.push({
      key: 'streamerbot', label: 'Streamer.bot', icon: <StreamerbotLogo />, tone, text, tracked: true, pending: false,
      hint: sb.status === 'connected' ? (sb.version ? `Streamer.bot ${sb.version}. Its actions are in the / commands list.` : 'Its actions are in the / commands list.') : sb.detail,
      actions: [{ label: 'Reconnect', run: () => window.nnf.streamerbot.reconnect() }]
    })
  }
  return list
}

const counts = (list: Service[]): { tracked: number; up: number; pending: number } => {
  const tracked = list.filter((s) => s.tracked)
  return { tracked: tracked.length, up: tracked.filter((s) => s.tone === 'good' || s.tone === 'wait').length, pending: tracked.filter((s) => s.pending).length }
}

/** Thin progress bar while services connect, then a summary that fades out. */
/** Colour of each service's segment in the glow line: the platform's or service's own colour. */
const LINE_COLOR: Record<string, string> = {
  twitch: 'var(--twitch)', panel: 'var(--twitch)', youtube: 'var(--youtube)', kick: 'var(--kick)', tiktok: 'var(--tiktok)',
  buymeacoffee: '#ffdd00', streamlabs: '#80f5d2', streamelements: '#3b82f6', obs: 'var(--blue)', streamerbot: 'var(--purple)'
}

/**
 * Comet line along the bottom of the tab bar: one gradient blending the colours of the services in
 * use, each lit once it's up.
 * - connecting: a comet sweeps back and forth, and a burst of light goes off where a service connects
 * - all up: one flash, then a calm glow with a slow comet every ~10 s (or it fades away, if the
 *   user turned the animated line off)
 * - a service fails: its stretch of the line pulses red until it's back (shown either way)
 * The Connections button next to it has the details in words.
 */
export function ConnectBar(): JSX.Element | null {
  const services = useServices()
  const animated = useStore((s) => s.settings?.connectionLine ?? true)
  const { tracked, up, pending } = counts(services)
  const [phase, setPhase] = useState<'progress' | 'done' | 'calm'>(pending ? 'progress' : 'calm')
  useEffect(() => {
    if (pending > 0) return setPhase('progress')
    if (phase !== 'progress') return
    setPhase('done')
    const t = setTimeout(() => setPhase('calm'), 2600)
    return () => clearTimeout(t)
  }, [pending])
  const list = services.filter((s) => s.tracked).map((s, i, all) => ({
    key: s.key,
    from: (i / all.length) * 100,
    at: ((i + 0.5) / all.length) * 100,
    width: 100 / all.length,
    color: LINE_COLOR[s.key] ?? 'var(--blue)',
    // 'warn' without pending is e.g. "waiting for OBS to open": not a problem, just not lit yet
    state: s.pending ? 'wait' : s.tone === 'good' || s.tone === 'wait' ? 'up' : s.tone === 'bad' ? 'bad' : 'idle'
  }))
  const failing = list.filter((s) => s.state === 'bad')
  if (tracked === 0) return null
  // with the animated line off, it only stays while connecting or while something is wrong
  if (!animated && phase === 'calm' && !failing.length) return null
  const allUp = up === tracked
  const label = phase === 'progress' ? `Connecting… ${tracked - pending} of ${tracked}`
    : failing.length ? `${failing.length} not connected: open Connections to fix` : allUp ? 'All connected' : `${up} of ${tracked} connected`
  const stops = list.map((s) => `${s.state === 'up' ? s.color : s.state === 'bad' ? 'var(--bad)' : `color-mix(in srgb, ${s.color} 22%, transparent)`} ${s.at}%`)
  const gradient = `linear-gradient(90deg, ${stops.length === 1 ? `${stops[0]}, ${stops[0]}` : stops.join(', ')})`
  const comet = phase === 'progress' ? 'cl-comet' : animated && phase === 'calm' ? 'cl-comet idle' : null
  return (
    <div className={`connect-line ${phase}${allUp ? ' good' : ''}${animated ? '' : ' still'}`} role="status" aria-live="polite" aria-label={label} title={label}>
      <span className="cl-base" style={{ background: gradient }} />
      <span className="cl-glow" style={{ background: gradient }} />
      {failing.map((s) => <span key={`alarm-${s.key}`} className="cl-alarm" style={{ left: `${s.from}%`, width: `${s.width}%` }} />)}
      {comet && <span className={comet} />}
      {list.filter((s) => s.state === 'up').map((s) => (
        <span key={s.key} className="cl-burst" style={{ left: `${s.at}%`, '--seg': s.color } as CSSProperties} />
      ))}
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

/** Status pill that opens the connections list, each with its own actions. */
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

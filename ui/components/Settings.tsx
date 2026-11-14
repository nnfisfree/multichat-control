import { useEffect, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import { ALERTS_READY, KICK_REDIRECT_URI } from '../../shared/app-config'
import { ALERT_SOURCE_LABEL, BMC_TOKEN_URL, PLATFORM_LABEL, type ChatEventGroup, type CloseAction, type IntegrationState, type Platform } from '../../shared/types'
import { BmcLogo, Icon, ObsLogo, PlatformIcon, StreamerbotLogo } from './Icons'
import { setSecrets, updateSettings, useStore } from '../lib/store'
import { About } from './About'
import { statusText } from './Tabs'
import { SKINS, skinById } from '../styles/skins'

const GUIDE: Record<Platform, { title: string; url: string; steps: string[] }> = {
  twitch: {
    title: 'dev.twitch.tv/console',
    url: 'https://dev.twitch.tv/console/apps/create',
    steps: ['Register an application.', 'Set the OAuth redirect URL to https://localhost and click Add. The app never uses it, but Twitch requires one.', 'Set Client Type to Public.', 'Copy the Client ID below.']
  },
  youtube: {
    title: 'console.cloud.google.com',
    url: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'Create a project and enable "YouTube Data API v3".',
      'Set up the OAuth consent screen, add yourself as a user, then Publish it. Apps left in Testing lose their login every 7 days.',
      'Create an OAuth client ID of type Desktop app.',
      'Copy the Client ID and Client secret below.'
    ]
  },
  kick: {
    title: 'kick.com/settings/developer',
    url: 'https://kick.com/settings/developer',
    steps: ['Enable developer mode and create an app.', `Set the redirect URL to ${KICK_REDIRECT_URI}`, 'Tick every scope.', 'Copy the Client ID and Client Secret below.']
  }
}

function Account({ platform }: { platform: Platform }): JSX.Element {
  const boot = useStore((s) => s.boot!)
  const settings = useStore((s) => s.settings!)
  const secrets = useStore((s) => s.secrets)
  const st = useStore((s) => s.statuses[platform])
  const [secret, setSecret] = useState('')
  const [err, setErr] = useState('')
  const g = GUIDE[platform]
  const idKey = `${platform}ClientId` as const
  const secretKey = platform === 'youtube' ? 'youtubeSecret' : platform === 'kick' ? 'kickSecret' : null
  const builtIn = platform === 'twitch' ? boot.builtInTwitchId : platform === 'youtube' ? boot.builtInYoutube : boot.builtInKick
  const showFields = !(platform === 'twitch' && builtIn)
  const live = st?.status === 'connected' || st?.status === 'waiting' || st?.status === 'reconnecting'

  const act = (fn: () => Promise<unknown>) => () => {
    setErr('')
    fn().catch((e) => {
      const text = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/cancelled/i.test(text)) setErr(text)
    })
  }
  const login = (): void => {
    if (st?.status === 'needs-setup') setErr(`This copy of the app has no ${PLATFORM_LABEL[platform]} login built in yet.`)
    else act(() => window.nnf.login(platform))()
  }

  return (
    <article className="account">
      <header>
        <span className={`pf ${platform}`}><PlatformIcon platform={platform} size={18} /></span>
        <h3>{PLATFORM_LABEL[platform]}</h3>
        <span className="state" title={statusText(st)}>{st?.account ? `${st.account} · ` : ''}{statusText(st)}</span>
        <div className="row-btns">
          {live && <button className="btn ghost sm" onClick={act(() => window.nnf.reconnect(platform))}>Reconnect</button>}
          {live
            ? <button className="btn ghost sm" onClick={act(() => window.nnf.logout(platform))}>Log out</button>
            : <button className="btn sm" disabled={st?.status === 'connecting' || (st?.status === 'authorizing' && platform !== 'twitch')} onClick={login}>{st?.status === 'authorizing' && platform === 'twitch' ? 'New code' : 'Log in'}</button>}
        </div>
      </header>
      {st?.device && (
        <div className="notice good">
          Enter code <b className="code">{st.device.code}</b> at{' '}
          <a href={st.device.url} onClick={(e) => { e.preventDefault(); void window.nnf.openExternal(st.device!.url) }}>{st.device.url}</a>
        </div>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {showFields && !live && (
        <details className="advanced">
          <summary>Advanced: use my own developer app</summary>
          <ol>{g.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p><button className="linkish" onClick={() => void window.nnf.openExternal(g.url)}>Open {g.title}</button></p>
          <label>Client ID
            <input defaultValue={settings[idKey]} onBlur={(e) => { if (e.target.value.trim() !== settings[idKey]) void updateSettings({ [idKey]: e.target.value.trim() }) }} />
          </label>
          {secretKey && (
            <label>Client secret {secrets[secretKey] && <em>(saved)</em>}
              <div className="row-btns">
                <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={secrets[secretKey] ? 'Enter a new one to replace it' : ''} />
                <button className="btn" disabled={!secret} onClick={act(async () => { setSecrets(await window.nnf.saveSecret(secretKey, secret.trim())); setSecret('') })}>Save</button>
              </div>
            </label>
          )}
        </details>
      )}
    </article>
  )
}

const ALERT_STATUS: Record<IntegrationState['status'], string> = {
  off: 'Off', 'needs-setup': 'Coming soon', 'needs-login': 'Not logged in', authorizing: 'Finish logging in in your browser…',
  connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', error: 'Needs attention'
}

/** Streamers use one alert service, so they pick it and log in. That's all. */
function AlertsPicker(): JSX.Element {
  // Until both services approve the app, both are shown as coming soon and nothing is picked.
  const choice = useStore((s) => (ALERTS_READY ? s.settings!.alertService : 'none'))
  const st = useStore((s) => (choice === 'none' ? undefined : s.integrations[choice]))
  const [err, setErr] = useState('')
  const act = (fn: () => Promise<unknown>) => () => {
    setErr('')
    fn().catch((e) => {
      const text = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/cancelled/i.test(text)) setErr(text)
    })
  }
  const live = st?.status === 'connected' || st?.status === 'reconnecting' || st?.status === 'connecting'
  return (
    <article className="account alerts">
      <header>
        <div className="seg" role="radiogroup" aria-label="Alert service">
          {(['none', 'streamelements', 'streamlabs'] as const).map((v) => (
            v !== 'none' && !ALERTS_READY
              ? <button key={v} role="radio" aria-checked={false} disabled className="soon" title={`${ALERT_SOURCE_LABEL[v]} is coming soon: waiting for ${ALERT_SOURCE_LABEL[v]} to approve the app`}>
                  {ALERT_SOURCE_LABEL[v]} <small>Soon..</small>
                </button>
              : <button key={v} role="radio" aria-checked={choice === v} className={choice === v ? 'on' : ''} onClick={() => { setErr(''); void updateSettings({ alertService: v }) }}>
                  {v === 'none' ? 'None' : ALERT_SOURCE_LABEL[v]}
                </button>
          ))}
        </div>
        {choice !== 'none' && (
          <>
            <span className="state">{st?.account && st.status === 'connected' ? `${st.account} · ` : ''}{st ? ALERT_STATUS[st.status] : 'Starting…'}</span>
            <div className="row-btns">
              {live && <button className="btn ghost sm" onClick={act(() => window.nnf.alerts.reconnect(choice))}>Reconnect</button>}
              {live
                ? <button className="btn ghost sm" onClick={act(() => window.nnf.alerts.logout(choice))}>Log out</button>
                : st?.status !== 'needs-setup' && <button className="btn sm" disabled={st?.status === 'authorizing'} onClick={act(() => window.nnf.alerts.login(choice))}>Log in</button>}
            </div>
          </>
        )}
      </header>
      {st?.detail && st.status !== 'needs-setup' && <div className={st.status === 'error' || st.status === 'needs-login' ? 'notice bad' : 'notice'} role="status">{st.detail}</div>}
      {err && err !== st?.detail && <div className="notice bad" role="alert">{err}</div>}
    </article>
  )
}

const BMC_STATUS: Partial<Record<IntegrationState['status'], string>> = {
  'needs-login': 'Not connected', authorizing: 'Checking the token…', connecting: 'Connecting…', connected: 'Connected',
  reconnecting: 'Retrying soon…', off: 'Not connected'
}

/**
 * Buy Me a Coffee has no "Log in" button for apps, so this is the next best thing: one click
 * opens the token page, the streamer pastes the token once, and the app checks it.
 */
function BmcRow(): JSX.Element {
  const st = useStore((s) => s.integrations.buymeacoffee)
  const demo = useStore((s) => !!s.boot?.demo)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const live = st?.status === 'connected' || st?.status === 'reconnecting' || st?.status === 'connecting'
  const clean = (e: any): string => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const connect = (): void => {
    setErr('')
    setOpen(true)
    void window.nnf.openExternal(BMC_TOKEN_URL)
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      await window.nnf.alerts.connect('buymeacoffee', token)
      setToken('')
      setOpen(false)
    } catch (e) {
      setErr(clean(e))
    } finally {
      setBusy(false)
    }
  }
  const act = (fn: () => Promise<unknown>) => () => { setErr(''); fn().catch((e) => setErr(clean(e))) }
  return (
    <article className="account bmc" id="bmc-settings">
      <header>
        <span className="pf"><BmcLogo size={18} /></span>
        <h3>Buy Me a Coffee</h3>
        <span className="state">{st ? BMC_STATUS[st.status] ?? ALERT_STATUS[st.status] : 'Not connected'}</span>
        <div className="row-btns">
          {live && <button className="btn ghost sm" onClick={act(() => window.nnf.alerts.reconnect('buymeacoffee'))}>Reconnect</button>}
          {live
            ? <button className="btn ghost sm" onClick={act(() => window.nnf.alerts.logout('buymeacoffee'))}>Disconnect</button>
            : !open && <button className="btn sm" disabled={demo} title={demo ? 'Not available in demo mode' : undefined} onClick={connect}>Connect</button>}
        </div>
      </header>
      {open && !live && (
        <div className="bmc-connect">
          <ol>
            <li>Log in on the page that just opened with your Buy Me a Coffee account.</li>
            <li>Click <b>Create new token</b>, name it "Multichat Control" and leave it <b>read only</b>.</li>
            <li>Copy the token and paste it here.</li>
          </ol>
          <div className="row-btns">
            <input type="password" autoComplete="off" spellCheck={false} placeholder="Paste your token" value={token} aria-label="Buy Me a Coffee token"
              onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && token.trim() && !busy) void save() }} />
            <button className="btn sm" disabled={!token.trim() || busy} onClick={() => void save()}>{busy ? 'Checking…' : 'Save'}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => { setOpen(false); setToken(''); setErr('') }}>Cancel</button>
          </div>
          <p className="hint"><button className="linkish" onClick={() => void window.nnf.openExternal(BMC_TOKEN_URL)}>Open the token page again</button> · The token stays encrypted on this PC and is only sent to Buy Me a Coffee.</p>
        </div>
      )}
      {st?.detail && st.status !== 'connected' && <div className={st.status === 'needs-login' ? 'notice bad' : 'notice'} role="status">{st.detail}</div>}
      {err && err !== st?.detail && <div className="notice bad" role="alert">{err}</div>}
    </article>
  )
}

/** Connects to OBS's WebSocket server to show stream health under the message box. */
function ObsSettings(): JSX.Element {
  const s = useStore((x) => x.settings!)
  const saved = useStore((x) => x.secrets.obsPassword)
  const obs = useStore((x) => x.obs)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  /** Set right after saving, so the result of that attempt shows under the field. */
  const [checking, setChecking] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (checking === null) return
    if (obs.status === 'connected') { setResult({ ok: true, text: 'Connected to OBS. Your stats are under the message box.' }); setChecking(null) }
    else if (obs.status === 'error') { setResult({ ok: false, text: obs.detail ?? 'OBS refused the connection.' }); setChecking(null) }
  }, [obs.status, obs.detail, checking])
  // OBS that never answers is most often closed, or its WebSocket server is off.
  useEffect(() => {
    if (checking === null) return
    const t = setTimeout(() => {
      setResult({ ok: false, text: `OBS didn't answer on port ${s.obsPort}. Is OBS open, with Enable WebSocket server ticked?` })
      setChecking(null)
    }, 8000)
    return () => clearTimeout(t)
  }, [checking, s.obsPort])

  const save = async (value: string): Promise<void> => {
    setResult(null)
    setSecrets(await window.nnf.obs.setPassword(value))
    setPassword('')
    setShow(false)
    setChecking(Date.now())
  }
  const state = !s.obsEnabled ? 'Off' : obs.status === 'connected' ? 'Connected' : obs.status === 'error' ? 'Needs attention' : 'Waiting for OBS…'
  return (
    <div id="obs-settings">
      <Row title="Show OBS Stats" desc="Bitrate, dropped frames, FPS, CPU and your encoder from OBS, in the row under the message box. Only reads: the app never changes anything in OBS.">
        <Toggle label="Show OBS stats" on={s.obsEnabled} onChange={(v) => { void updateSettings({ obsEnabled: v }); if (v) setChecking(Date.now()) }} />
      </Row>
      {s.obsEnabled && (
        <article className="account obs-setup">
          <header>
            <ObsLogo size={20} />
            <h3>OBS Studio</h3>
            <span className="state">{state}</span>
            {obs.status !== 'off' && <div className="row-btns"><button className="btn ghost sm" onClick={() => { setResult(null); setChecking(Date.now()); void window.nnf.obs.reconnect() }}>Test connection</button></div>}
          </header>
          {result
            ? <div className={result.ok ? 'notice good' : 'notice bad'} role="status">{result.ok ? '✓ ' : '✗ '}{result.text}</div>
            : checking !== null
              ? <div className="notice" role="status">Connecting to OBS…</div>
              : obs.detail && obs.status !== 'connected' && <div className={obs.status === 'error' ? 'notice bad' : 'notice'}>{obs.detail}</div>}
          <details className="advanced" open={obs.status !== 'connected'}>
            <summary>How to connect</summary>
            <ol>
              <li>In OBS (version 28 or newer), open <b>Tools → WebSocket Server Settings</b>.</li>
              <li>Tick <b>Enable WebSocket server</b>. Leave the port at 4455 unless you changed it.</li>
              <li>If <b>Enable Authentication</b> is ticked, click <b>Show Connect Info</b>, copy the <b>Server Password</b> and paste it below. If it isn't ticked, no password is needed.</li>
            </ol>
            <div className="obs-fields">
              <label>Port
                <input type="number" min={1} max={65535} defaultValue={s.obsPort} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== s.obsPort) { void updateSettings({ obsPort: v }); setResult(null); setChecking(Date.now()) } }} />
              </label>
              <label>Server password {saved ? <em>(saved, encrypted on this PC)</em> : <em>(none saved)</em>}
                <div className="row-btns">
                  <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && password.trim()) void save(password.trim()) }}
                    placeholder={saved ? 'Paste a new one to replace it' : 'Paste the Server Password from OBS'} />
                  <button className="btn ghost sm" type="button" aria-pressed={show} title={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
                  <button className="btn" disabled={!password.trim()} onClick={() => void save(password.trim())}>Save</button>
                  {saved && <button className="btn ghost" title="For OBS without a password" onClick={() => void save('')}>Remove</button>}
                </div>
              </label>
            </div>
          </details>
        </article>
      )}
    </div>
  )
}

/** Connects to Streamer.bot's WebSocket server to list and run its actions. */
function StreamerbotSettings(): JSX.Element {
  const s = useStore((x) => x.settings!)
  const saved = useStore((x) => x.secrets.sbPassword)
  const sb = useStore((x) => x.streamerbot)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  /** Set right after a change, so the result of that attempt shows under the field. */
  const [checking, setChecking] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const count = sb.actions.filter((a) => a.enabled).length

  useEffect(() => {
    if (checking === null) return
    if (sb.status === 'connected') { setResult({ ok: true, text: `Connected to Streamer.bot. ${count} action${count === 1 ? '' : 's'} in the / commands list.` }); setChecking(null) }
    else if (sb.status === 'error') { setResult({ ok: false, text: sb.detail ?? 'Streamer.bot refused the connection.' }); setChecking(null) }
  }, [sb.status, sb.detail, checking, count])
  // Streamer.bot that never answers is most often closed, or its WebSocket server is stopped.
  useEffect(() => {
    if (checking === null) return
    const t = setTimeout(() => {
      setResult({ ok: false, text: `Streamer.bot didn't answer on port ${s.sbPort}. Is it open, with its WebSocket Server started?` })
      setChecking(null)
    }, 8000)
    return () => clearTimeout(t)
  }, [checking, s.sbPort])

  const save = async (value: string): Promise<void> => {
    setResult(null)
    setSecrets(await window.nnf.streamerbot.setPassword(value))
    setPassword('')
    setShow(false)
    setChecking(Date.now())
  }
  const state = !s.sbEnabled ? 'Off' : sb.status === 'connected' ? `Connected · ${count} action${count === 1 ? '' : 's'}` : sb.status === 'error' ? 'Needs attention' : 'Waiting for Streamer.bot…'
  return (
    <div id="streamerbot-settings">
      <Row title="Use Streamer.bot" desc="Run your Streamer.bot actions from the / commands list, or by typing /sb and the action's name. The list follows what you set up in Streamer.bot.">
        <Toggle label="Use Streamer.bot" on={s.sbEnabled} onChange={(v) => { void updateSettings({ sbEnabled: v }); if (v) setChecking(Date.now()) }} />
      </Row>
      {s.sbEnabled && (
        <article className="account obs-setup">
          <header>
            <StreamerbotLogo size={20} />
            <h3>Streamer.bot</h3>
            <span className="state">{state}</span>
            {sb.status !== 'off' && <div className="row-btns"><button className="btn ghost sm" onClick={() => { setResult(null); setChecking(Date.now()); void window.nnf.streamerbot.reconnect() }}>Test connection</button></div>}
          </header>
          {result
            ? <div className={result.ok ? 'notice good' : 'notice bad'} role="status">{result.ok ? '✓ ' : '✗ '}{result.text}</div>
            : checking !== null
              ? <div className="notice" role="status">Connecting to Streamer.bot…</div>
              : sb.detail && sb.status !== 'connected' && <div className={sb.status === 'error' ? 'notice bad' : 'notice'}>{sb.detail}</div>}
          <details className="advanced" open={sb.status !== 'connected'}>
            <summary>How to connect</summary>
            <ol>
              <li>In Streamer.bot, open <b>Servers/Clients → WebSocket Server</b>.</li>
              <li>Tick <b>Auto Start</b> and click <b>Start Server</b>. Leave the address at 127.0.0.1, the port at 8080 and the endpoint at <b>/</b> unless you changed them.</li>
              <li>If <b>Authentication</b> is turned on there, copy its password and paste it below. If it isn't, no password is needed.</li>
            </ol>
            <div className="obs-fields">
              <label>Port
                <input type="number" min={1} max={65535} defaultValue={s.sbPort} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== s.sbPort) { void updateSettings({ sbPort: v }); setResult(null); setChecking(Date.now()) } }} />
              </label>
              <label>Password {saved ? <em>(saved, encrypted on this PC)</em> : <em>(none saved)</em>}
                <div className="row-btns">
                  <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && password.trim()) void save(password.trim()) }}
                    placeholder={saved ? 'Paste a new one to replace it' : 'Only if Authentication is on in Streamer.bot'} />
                  <button className="btn ghost sm" type="button" aria-pressed={show} title={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
                  <button className="btn" disabled={!password.trim()} onClick={() => void save(password.trim())}>Save</button>
                  {saved && <button className="btn ghost" title="For Streamer.bot without a password" onClick={() => void save('')}>Remove</button>}
                </div>
              </label>
            </div>
          </details>
        </article>
      )}
    </div>
  )
}

const CHAT_EVENT_ROWS: [ChatEventGroup, string, string][] = [
  ['subs', 'Subs', 'New subs, resubs and memberships'],
  ['gifts', 'Gifted Subs', 'Single gifts and gift bombs'],
  ['hype', 'Hype Train', 'Start, level-ups and end. The top banner always shows.'],
  ['raids', 'Raids', 'Incoming and outgoing raids and hosts'],
  ['redemptions', 'Redemptions', 'Channel point rewards'],
  ['powerups', 'Power-ups', 'On-Screen Celebrations and custom Power-ups'],
  ['paid', 'Super Stickers and KICKs', 'Paid messages already appear in chat'],
  ['donations', 'Donations', 'Tips from StreamElements, Streamlabs and Buy Me a Coffee'],
  ['cheers', 'Kick Cheers', 'Twitch cheers always show as messages'],
  ['follows', 'Follows', 'New followers. Turn this off if follow bots flood your chat.']
]

function UpdatesRow(): JSX.Element {
  const u = useStore((s) => s.update)
  const boot = useStore((s) => s.boot!)
  const busy = u?.status === 'checking' || u?.status === 'downloading'
  const text = boot.demo ? 'Updates are off in demo mode.'
    : u?.status === 'checking' ? 'Checking…'
    : u?.status === 'none' ? 'You have the latest version.'
    : u?.status === 'available' ? `Version ${u.info?.version} is available. See the banner at the top.`
    : u?.status === 'downloading' ? `Downloading… ${u.progress ?? 0}%`
    : u?.status === 'ready' ? 'Ready to install. See the banner at the top.'
    : u?.status === 'error' ? `Couldn't check: ${u.error}`
    : 'Not checked yet.'
  return (
    <Row title={`Version ${boot.version}`} desc={text}>
      <button className="btn" disabled={busy || boot.demo} onClick={() => void window.nnf.updates.check()}>Check for updates</button>
    </Row>
  )
}

const BUNDLED_FONTS = ['Segoe UI', 'Inter', 'Rajdhani', 'Orbitron']

/** Lists installed fonts where the system allows it; the bundled fonts always work. */
function useFonts(): string[] {
  const [fonts, setFonts] = useState(BUNDLED_FONTS)
  useEffect(() => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    query?.().then((list) => {
      setFonts([...BUNDLED_FONTS, ...[...new Set(list.map((f) => f.family))].filter((f) => !BUNDLED_FONTS.includes(f)).sort()])
    }).catch(() => {})
  }, [])
  return fonts
}

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }): JSX.Element {
  return (
    <div className="set-row">
      <div className="set-text"><b>{title}</b><span>{desc}</span></div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }): JSX.Element {
  return <button className={on ? 'toggle on' : 'toggle'} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}><i /></button>
}

function Section({ title, desc, children, id }: { title: string; desc?: string; children: ReactNode; id?: string }): JSX.Element {
  return (
    <section className="set-section" id={id}>
      <header className="sec-head">
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </header>
      <div className="sec-body">{children}</div>
    </section>
  )
}

/** Skins: a small picture of each, and one click to switch. The window edge never changes. */
function SkinPicker(): JSX.Element {
  const current = skinById(useStore((s) => s.settings!.theme)).id
  return (
    <div className="skins" role="radiogroup" aria-label="Skin">
      {SKINS.map((k) => {
        const [bg, panel, a, b] = k.swatch
        const on = k.id === current
        return (
          <button key={k.id} role="radio" aria-checked={on} className={on ? 'skin on' : 'skin'} onClick={() => void updateSettings({ theme: k.id })}>
            <span className="skin-shot" style={{ background: bg }} aria-hidden="true">
              <span className="skin-bar" style={{ background: panel }}><i style={{ background: a }} /><i style={{ background: b }} /></span>
              <span className="skin-line" style={{ background: panel, width: '72%' }} />
              <span className="skin-line" style={{ background: panel, width: '54%' }} />
              <span className="skin-line accent" style={{ background: `linear-gradient(90deg, ${a}, ${b})`, width: '40%' }} />
              <span className="skin-box" style={{ background: panel }}><i style={{ background: b }} /></span>
            </span>
            <span className="skin-name">{k.name}{on && <span className="skin-check"><Icon.check /></span>}</span>
            <span className="skin-by">{k.by}</span>
          </button>
        )
      })}
    </div>
  )
}

export type Category = 'connections' | 'appearance' | 'chat' | 'app' | 'about'
/** Where Settings opens: a page, and optionally the id of a section to scroll to. */
export interface SettingsFocus { cat: Category; target?: string }
const CATEGORIES: { id: Category; label: string; desc: string; icon: () => JSX.Element }[] = [
  { id: 'connections', label: 'Connections', desc: 'Your platforms, alerts, OBS and Streamer.bot', icon: Icon.plug },
  { id: 'appearance', label: 'Appearance', desc: 'Skins, fonts and how the window looks', icon: Icon.palette },
  { id: 'chat', label: 'Chat', desc: 'What chat shows: details, events and emotes', icon: Icon.all },
  { id: 'app', label: 'App', desc: 'Closing, safety, clock and updates', icon: Icon.gear },
  { id: 'about', label: 'About', desc: 'The story behind the app', icon: Icon.info }
]

export function Settings({ onClose, focus }: { onClose(): void; focus?: SettingsFocus }): JSX.Element {
  const boot = useStore((s) => s.boot!)
  const s = useStore((x) => x.settings!)
  const fonts = useFonts()
  const providers = s.emoteProviders
  const setProvider = (key: keyof typeof providers, on: boolean): void => void updateSettings({ emoteProviders: { ...providers, [key]: on } })
  const percent = Math.round(s.windowOpacity * 100)
  const [cat, setCat] = useState<Category>('connections')
  const scroll = useRef<HTMLDivElement>(null)
  const modal = useRef<HTMLDivElement>(null)
  const followLight = (e: MouseEvent): void => {
    const box = modal.current!
    const r = box.getBoundingClientRect()
    box.style.setProperty('--light-x', `${e.clientX - r.left}px`)
    box.style.setProperty('--light-y', `${e.clientY - r.top}px`)
  }
  // Opened for one thing (the OBS capsule, "What's new"): go straight to its page and section.
  useEffect(() => {
    if (!focus) return
    setCat(focus.cat)
    if (focus.target) requestAnimationFrame(() => document.getElementById(focus.target!)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [focus?.cat, focus?.target])
  const pick = (c: Category): void => {
    setCat(c)
    scroll.current?.scrollTo({ top: 0 })
  }
  const info = CATEGORIES.find((c) => c.id === cat)!

  return (
    <div className="modal-back">
      <div className="modal settings" role="dialog" aria-label="Settings" ref={modal} onMouseMove={followLight}>
        <aside className="set-side">
          <div className="set-side-title">Settings</div>
          <nav role="tablist" aria-label="Settings categories" aria-orientation="vertical">
            {CATEGORIES.map((c) => (
              <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => pick(c.id)}>
                <span className="set-nav-icon"><c.icon /></span>{c.label}
              </button>
            ))}
          </nav>
          <div className="set-side-foot">Version {boot.version}</div>
        </aside>

        <div className="set-main">
          <button className="icon-btn set-close" aria-label="Close settings" onClick={() => { void updateSettings({ setupDismissed: true }); onClose() }}><Icon.close /></button>
          {cat === 'about' ? <About /> : (
            <div className="modal-scroll" ref={scroll}>
              <header className="cat-head">
                <h2>{info.label}</h2>
                <p>{info.desc}</p>
              </header>

              {cat === 'connections' && <>
                {!s.setupDismissed && <p className="lead">Welcome! Log in to each platform you stream on. You can do this later from the gear icon.</p>}
                <Section title="Accounts" desc="Connect the platforms you stream on">
                  {(['twitch', 'youtube', 'kick'] as Platform[]).map((p) => <Account key={p} platform={p} />)}
                </Section>
                <Section title="Alerts & Donations" desc="Pick only the one you use. It adds donations, plus past subs, gifts and Bits the platforms don't share.">
                  <AlertsPicker />
                </Section>
                <Section title="Buy Me a Coffee" desc="Tips, memberships (with every month they've supported you) and shop sales, live in chat and in Recent events. Works next to the service above.">
                  <BmcRow />
                </Section>
                <Section title="OBS Studio" desc="See your stream's health at a glance, like OBS's Stats dock">
                  <ObsSettings />
                </Section>
                <Section title="Streamer.bot" desc="Run your Streamer.bot actions from the message box">
                  <StreamerbotSettings />
                </Section>
              </>}

              {cat === 'appearance' && <>
                <Section id="skins-settings" title="Skins" desc="Change the colours of the whole app. The glowing window edge stays the same in every skin.">
                  <SkinPicker />
                </Section>
                <Section id="window-settings" title="Window" desc="How the window looks on your screen">
                  <Row title="Window Opacity" desc="See through the whole window. Ctrl+Shift+O returns to 100%.">
                    <div className="slider">
                      <output>{percent}%</output>
                      <input type="range" aria-label="Window opacity" min="0" max="100" step="1" value={percent} onChange={(e) => void updateSettings({ windowOpacity: Number(e.target.value) / 100 })} />
                    </div>
                  </Row>
                  <Row title="Wobbly Window" desc="The window bends like jelly while you drag it by the title bar, and settles when you let go. Inspired by the Wobbly Windows effect built into KDE Plasma, the Linux desktop.">
                    <Toggle label="Wobbly window" on={s.windowWobble} onChange={(v) => void updateSettings({ windowWobble: v })} />
                  </Row>
                  {s.windowWobble && (
                    <Row title="Wobble Intensity" desc="Low is a light sway, high is soft jelly">
                      <div className="slider">
                        <output>{s.wobbleIntensity}%</output>
                        <input type="range" aria-label="Wobble intensity" min="0" max="100" step="1" value={s.wobbleIntensity} onChange={(e) => void updateSettings({ wobbleIntensity: Number(e.target.value) })} />
                      </div>
                    </Row>
                  )}
                </Section>
                <Section title="Text" desc="Fonts and sizes">
                  <Row title="Interface Font" desc="Used for menus, tabs and settings">
                    <select aria-label="Interface font" value={s.uiFont} onChange={(e) => void updateSettings({ uiFont: e.target.value })}>
                      {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </Row>
                  <Row title="Chat Font" desc="Used for chat messages and events">
                    <select aria-label="Chat font" value={s.chatFont} onChange={(e) => void updateSettings({ chatFont: e.target.value })}>
                      {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </Row>
                  <Row title="Chat Text Size" desc="Scale chat messages up or down">
                    <div className="slider">
                      <output>{Math.round(s.fontScale * 100)}%</output>
                      <input type="range" aria-label="Chat text size" min="0.8" max="1.6" step="0.05" value={s.fontScale} onChange={(e) => void updateSettings({ fontScale: Number(e.target.value) })} />
                    </div>
                  </Row>
                </Section>
              </>}

              {cat === 'chat' && <>
                <Section id="messages-settings" title="Messages" desc="Choose what each message shows">
                  <Row title="Show Timestamps" desc="Show the time beside each message">
                    <Toggle label="Show timestamps" on={s.showTimestamps} onChange={(v) => void updateSettings({ showTimestamps: v })} />
                  </Row>
                  <Row title="Keep Chat History" desc="Saves chat from your last 5 streams on this PC, so you can read what you missed. Turning it off deletes it. /clearhistory deletes it too.">
                    <Toggle label="Keep chat history" on={s.keepChatHistory ?? true} onChange={(v) => void updateSettings({ keepChatHistory: v })} />
                  </Row>
                  <Row title="Show Pronouns" desc="Twitch only, for chatters who set them at pronouns.alejo.io. Sends chatter names to that service.">
                    <Toggle label="Show pronouns" on={s.showPronouns} onChange={(v) => void updateSettings({ showPronouns: v })} />
                  </Row>
                  <Row title="Link Previews" desc="A card with the picture and title under YouTube links and Twitch, Kick or YouTube clip links. The details come from those sites.">
                    <Toggle label="Link previews" on={s.linkPreviews ?? true} onChange={(v) => void updateSettings({ linkPreviews: v })} />
                  </Row>
                  <Row title="Spam Warnings" desc="Marks messages that offer to sell followers or viewers and point to a site, on every platform, with Delete and Ban buttons. Twitch's own held messages and suspicious-user warnings always show.">
                    <Toggle label="Spam warnings" on={s.spamWarnings ?? true} onChange={(v) => void updateSettings({ spamWarnings: v })} />
                  </Row>
                </Section>
                <Section id="popup-settings" title="Event Pop-ups" desc="New subs, gifts, cheers, raids, follows and more rise above the message box, then slide away">
                  <Row title="Show Pop-ups" desc="Hover a pop-up to keep it open, click it to close it now. Every event still goes to the Events drop-down.">
                    <Toggle label="Event pop-ups" on={s.eventPopups ?? true} onChange={(v) => void updateSettings({ eventPopups: v })} />
                  </Row>
                  {(s.eventPopups ?? true) && (
                    <Row title="Pop-up Duration" desc="How long each pop-up stays before it slides away">
                      <div className="slider">
                        <output>{s.eventPopupSeconds ?? 6} s</output>
                        <input type="range" aria-label="Pop-up duration in seconds" min="2" max="30" step="1" value={s.eventPopupSeconds ?? 6} onChange={(e) => void updateSettings({ eventPopupSeconds: Number(e.target.value) })} />
                      </div>
                    </Row>
                  )}
                </Section>
                <Section id="chat-events-settings" title="Events in Chat" desc="Show these as cards in chat. They always appear in the Events drop-down.">
                  {CHAT_EVENT_ROWS.map(([key, title, desc]) => (
                    <Row key={key} title={title} desc={desc}>
                      <Toggle label={`${title} in chat`} on={s.chatEvents[key] ?? true} onChange={(v) => void updateSettings({ chatEvents: { ...s.chatEvents, [key]: v } })} />
                    </Row>
                  ))}
                </Section>
                <Section title="Emotes" desc="Extra emote sets, shown in chat and in the picker">
                  <Row title="BetterTTV" desc="Twitch channel and global emotes">
                    <Toggle label="BetterTTV" on={providers.bttv} onChange={(v) => setProvider('bttv', v)} />
                  </Row>
                  <Row title="7TV" desc="Twitch and Kick channel and global emotes">
                    <Toggle label="7TV" on={providers.seventv} onChange={(v) => setProvider('seventv', v)} />
                  </Row>
                  <Row title="FrankerFaceZ" desc="Twitch channel and global emotes">
                    <Toggle label="FrankerFaceZ" on={providers.ffz} onChange={(v) => setProvider('ffz', v)} />
                  </Row>
                </Section>
              </>}

              {cat === 'app' && <>
                <Section title="Closing" desc="Choose what happens when you close the app">
                  <Row title="When Closing the Window" desc="In the tray, chat stays connected in the background. Open it from the tray icon.">
                    <select aria-label="When closing the window" value={s.closeAction} onChange={(e) => void updateSettings({ closeAction: e.target.value as CloseAction })}>
                      <option value="exit">Exit completely</option>
                      <option value="ask">Ask every time</option>
                      <option value="tray">Minimize to tray</option>
                    </select>
                  </Row>
                </Section>
                <Section title="Safety" desc="Protect against accidental clicks">
                  <Row title="Confirm Big Actions" desc="Ask before running an ad, raid or chat clear">
                    <Toggle label="Confirm big actions" on={s.confirmActions} onChange={(v) => void updateSettings({ confirmActions: v })} />
                  </Row>
                </Section>
                <Section id="stats-settings" title="Clock & Stats" desc="The clock under the message box, the stats in the title bar">
                  <Row title="Show the Clock" desc="hh:mm:ss AM/PM, in the skin's colours. Point at it to see the date.">
                    <Toggle label="Show the clock" on={s.showClock} onChange={(v) => void updateSettings({ showClock: v })} />
                  </Row>
                  <Row title="Show Channel Stats" desc="Followers and subscribers of each connected platform, in the middle of the title bar. On YouTube, its subscribers; YouTube doesn't share member counts.">
                    <Toggle label="Show channel stats" on={s.showStats ?? true} onChange={(v) => void updateSettings({ showStats: v })} />
                  </Row>
                </Section>
                <Section title="Updates" desc="New versions come from the project's GitHub page">
                  <UpdatesRow />
                  <Row title="Check Automatically" desc="Look for a new version at start and every few hours. Only GitHub is contacted.">
                    <Toggle label="Check for updates automatically" on={s.autoUpdate} onChange={(v) => void updateSettings({ autoUpdate: v })} />
                  </Row>
                  <Row title="Include Test Versions" desc="Also offer pre-releases, which may be less stable">
                    <Toggle label="Include test versions" on={s.updatePrereleases} onChange={(v) => void updateSettings({ updatePrereleases: v })} />
                  </Row>
                </Section>
                <p className="fine">Data is stored in {boot.dataDir}. Keep that folder private: it holds your logins.</p>
              </>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

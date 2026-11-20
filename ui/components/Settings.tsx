import { useEffect, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import { ALERTS_READY } from '../../shared/app-config'
import { ALERT_SOURCE_LABEL, BMC_TOKEN_URL, EULER_KEY_URL, PLATFORM_LABEL, type ChatEventGroup, type CloseAction, type IntegrationState, type Platform, STREAM_APPS, type StreamApp } from '../../shared/types'
import { BmcLogo, Icon, PlatformIcon, StreamAppLogo, StreamerbotLogo } from './Icons'
import { setSecrets, updateSettings, useStore } from '../lib/store'
import { login as startLogin } from '../lib/login'
import { About } from './About'
import { statusText } from './Tabs'
import { SKINS, skinById } from '../styles/skins'

/** Platforms with a real login. TikTok is read by username instead, see TikTokAccount. */
type LoginPlatform = Exclude<Platform, 'tiktok'>

/**
 * YouTube only: the built-in Google app is unverified, so Google caps it at 100 users in total.
 * Past that, a streamer's own Google app is the way in. Twitch and Kick logins are built in for
 * everyone, so they have no such option (developers building the app use .env instead).
 */
const YOUTUBE_GUIDE = {
  title: 'console.cloud.google.com',
  url: 'https://console.cloud.google.com/apis/credentials',
  steps: [
    'Create a project and enable "YouTube Data API v3".',
    'Set up the OAuth consent screen, add yourself as a user, then Publish it. Apps left in Testing lose their login every 7 days.',
    'Create an OAuth client ID of type Desktop app.',
    'Copy the Client ID and Client secret below.'
  ]
}

/** Arrow at the end of an account row that opens or closes its extra settings. */
function MoreButton({ open, onClick }: { open: boolean; onClick(): void }): JSX.Element {
  return (
    <button className="icon-btn acc-more" aria-expanded={open} aria-label={open ? 'Show less' : 'Show more'} title={open ? 'Show less' : 'Show more'} onClick={onClick}>
      <span className={open ? 'chev open' : 'chev'}><Icon.chevron /></span>
    </button>
  )
}

/** Clicking an empty part of an account row toggles it, like its arrow. Buttons and fields keep their own clicks. */
const rowToggle = (toggle: () => void) => (e: MouseEvent): void => {
  if (!(e.target as HTMLElement).closest('button, a, input, label')) toggle()
}

function Account({ platform }: { platform: LoginPlatform }): JSX.Element {
  const settings = useStore((s) => s.settings!)
  const secrets = useStore((s) => s.secrets)
  const st = useStore((s) => s.statuses[platform])
  const [secret, setSecret] = useState('')
  const [err, setErr] = useState('')
  const g = YOUTUBE_GUIDE
  const idKey = `${platform}ClientId` as const
  const secretKey = platform === 'youtube' ? 'youtubeSecret' : null
  const live = st?.status === 'connected' || st?.status === 'waiting' || st?.status === 'reconnecting'
  // rows start as one line; the arrow opens the "own developer app" settings
  const [open, setOpen] = useState(false)
  const hasMore = platform === 'youtube' && !live

  const act = (fn: () => Promise<unknown>) => () => {
    setErr('')
    fn().catch((e) => {
      const text = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/cancelled/i.test(text)) setErr(text)
    })
  }
  const login = (): void => {
    if (st?.status === 'needs-setup') setErr(`This copy of the app has no ${PLATFORM_LABEL[platform]} login built in yet.`)
    else act(() => startLogin(platform))()
  }

  return (
    <article className={hasMore ? 'account has-more' : 'account'}>
      <header onClick={hasMore ? rowToggle(() => setOpen(!open)) : undefined}>
        <span className={`pf ${platform}`}><PlatformIcon platform={platform} size={18} /></span>
        <h3>{PLATFORM_LABEL[platform]}</h3>
        <span className="state" title={statusText(st)}>{st?.account ? `${st.account} · ` : ''}{statusText(st)}</span>
        <div className="row-btns">
          {live && <button className="btn ghost sm" onClick={act(() => window.nnf.reconnect(platform))}>Reconnect</button>}
          {live
            ? <button className="btn ghost sm" onClick={act(() => window.nnf.logout(platform))}>Log out</button>
            : <button className="btn sm" disabled={st?.status === 'connecting' || (st?.status === 'authorizing' && platform !== 'twitch')} onClick={login}>{st?.status === 'authorizing' && platform === 'twitch' ? 'New code' : 'Log in'}</button>}
          {hasMore && <MoreButton open={open} onClick={() => setOpen(!open)} />}
        </div>
      </header>
      {st?.device && (
        <div className="notice good">
          Enter code <b className="code">{st.device.code}</b> at{' '}
          <a href={st.device.url} onClick={(e) => { e.preventDefault(); void window.nnf.openExternal(st.device!.url) }}>{st.device.url}</a>
        </div>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {hasMore && open && (
        <div className="advanced">
          <h4>Advanced: use my own developer app</h4>
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
        </div>
      )}
    </article>
  )
}

/**
 * TikTok has no login we could use for chat: it's read by @username, and an Euler Stream key (free,
 * the user's own) signs the connection. Read-only for now.
 */
function TikTokAccount({ startOpen }: { startOpen?: boolean }): JSX.Element {
  const settings = useStore((s) => s.settings!)
  const secrets = useStore((s) => s.secrets)
  const demo = useStore((s) => !!s.boot?.demo)
  const st = useStore((s) => s.statuses.tiktok)
  const configured = !!settings.tiktokUsername && secrets.tiktokKey
  // one line until opened, unless the user came here from a "Set up" button
  const [open, setOpen] = useState(!!startOpen)
  const [name, setName] = useState(settings.tiktokUsername ? `@${settings.tiktokUsername}` : '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const clean = (e: any): string => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setErr('')
    try { await fn() } catch (e) { setErr(clean(e)) } finally { setBusy(false) }
  }
  const save = (): Promise<void> => run(async () => {
    setSecrets(await window.nnf.tiktok.connect(name, key.trim() || undefined))
    setKey('')
    setOpen(false)
  })
  const showForm = open
  const canSave = !!name.trim() && (!!key.trim() || secrets.tiktokKey) && !busy
  return (
    <article className="account tiktok has-more" id="tiktok-settings">
      <header onClick={rowToggle(() => { setErr(''); setOpen(!open) })}>
        <span className="pf tiktok"><PlatformIcon platform="tiktok" size={18} /></span>
        <h3>TikTok <span className="pill-soft" title="TikTok chat and gifts show here; messages can't be sent to TikTok yet">Read-only</span></h3>
        <span className="state" title={statusText(st)}>{configured || demo ? `${st?.account ? `${st.account} · ` : ''}${statusText(st)}` : 'Not set up'}</span>
        <div className="row-btns">
          {configured && <button className="btn ghost sm" disabled={busy} onClick={() => void run(() => window.nnf.reconnect('tiktok'))}>Reconnect</button>}
          {configured && <button className="btn ghost sm" disabled={busy} onClick={() => void run(async () => { setSecrets(await window.nnf.tiktok.disconnect()); setName(''); setOpen(false) })}>Disconnect</button>}
          {!configured && !demo && !open && <button className="btn sm" onClick={() => { setErr(''); setOpen(true) }}>Set up</button>}
          <MoreButton open={open} onClick={() => { setErr(''); setOpen(!open) }} />
        </div>
      </header>
      {showForm && (
        <div className="bmc-connect">
          <ol>
            <li>Type your TikTok username.</li>
            <li>Click <b>Get a free key</b>, sign up at Euler Stream (free) and copy your <b>API key</b>.</li>
            <li>Paste it here and click <b>Connect</b>. The app joins your LIVE by itself whenever you go live.</li>
          </ol>
          <label>TikTok username
            <input spellCheck={false} placeholder="@yourname" value={name} aria-label="TikTok username" disabled={demo}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save() }} />
          </label>
          <label>Euler Stream key {secrets.tiktokKey && <em>(saved)</em>}
            <div className="row-btns">
              <input type="password" autoComplete="off" spellCheck={false} value={key} aria-label="Euler Stream API key" disabled={demo}
                placeholder={secrets.tiktokKey ? 'Saved. Paste a new one to replace it' : 'Paste your API key'}
                onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save() }} />
              <button className="btn ghost sm" onClick={() => void window.nnf.openExternal(EULER_KEY_URL)}>Get a free key</button>
            </div>
          </label>
          <div className="row-btns">
            <button className="btn sm" disabled={!canSave || demo} title={demo ? 'Not available in demo mode' : undefined} onClick={() => void save()}>{busy ? 'Checking…' : 'Connect'}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => { setOpen(false); setKey(''); setErr('') }}>Cancel</button>
          </div>
          <p className="hint">
            Read-only for now: TikTok chat, gifts, follows and subs show here, and your messages go to the other platforms.
            TikTok has no official chat API, so this uses the same unofficial connection as tools like TikFinity.
            The key stays encrypted on this PC and is only sent to Euler Stream.
          </p>
        </div>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {!err && st?.detail && st.status !== 'connected' && configured && <div className={st.status === 'needs-setup' || st.status === 'error' ? 'notice bad' : 'notice'} role="status">{st.detail}</div>}
    </article>
  )
}

const ALERT_STATUS: Record<IntegrationState['status'], string> = {
  off: 'Off', 'needs-setup': 'Coming soon', 'needs-login': 'Not logged in', authorizing: 'Finish logging in in your browser…',
  connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', error: 'Needs attention'
}

/** Streamers only use one alert service, so: pick one, log in, done. */
function AlertsPicker(): JSX.Element {
  // until both services approve us, both show as "soon" and nothing can be picked
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
 * BMC has no login button for apps, so this is the next best thing: one click opens the token page,
 * the streamer pastes the token once, and we test it.
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

const APP_SETUP: Record<StreamApp, { steps: ReactNode[]; note?: string }> = {
  obs: {
    steps: [
      <>In OBS (version 28 or newer), open <b>Tools → WebSocket Server Settings</b>.</>,
      <>Tick <b>Enable WebSocket server</b>. Leave the port at 4455 unless you changed it.</>,
      <>If <b>Enable Authentication</b> is ticked, click <b>Show Connect Info</b>, copy the <b>Server Password</b> and paste it below. If it isn't ticked, no password is needed.</>
    ]
  },
  streamlabs: {
    steps: [
      <>In Streamlabs Desktop, open <b>Settings → Remote Control</b>.</>,
      <>Click the <b>QR code</b> to turn Remote Control on, then click <b>Show details</b>.</>,
      <>Copy the <b>API Token</b> and paste it below. Leave the port at 59650 unless you changed it.</>
    ],
    note: 'Streamlabs shares CPU, FPS, bitrate and dropped frames, but not memory, disk, render times or the encoder. Keep the token private: Remote Control also lets devices on your network connect with it.'
  },
  meld: {
    steps: [
      <>Open Meld Studio. It answers on port 13376 by itself, there's nothing to turn on.</>,
      <>If it doesn't connect, check <b>Settings → Advanced → WebChannel Server</b> in Meld, and that no firewall blocks Meld.</>
    ],
    note: "Meld Studio only shares whether you're live or recording, so you'll see the live timer but no graph, bitrate, FPS or CPU."
  }
}

/** Connection to the streaming app (OBS Studio, Streamlabs Desktop or Meld Studio), for the stream stats under the message box. */
function ObsSettings(): JSX.Element {
  const s = useStore((x) => x.settings!)
  const secrets = useStore((x) => x.secrets)
  const obs = useStore((x) => x.obs)
  const app = s.streamApp ?? 'obs'
  const name = STREAM_APPS[app]
  const saved = app === 'streamlabs' ? secrets.slToken : secrets.obsPassword
  const port = app === 'streamlabs' ? s.slPort : app === 'meld' ? s.meldPort : s.obsPort
  const portKey = app === 'streamlabs' ? 'slPort' : app === 'meld' ? 'meldPort' : 'obsPort'
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  // set right after saving, so the result of that attempt shows under the field
  const [checking, setChecking] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (checking === null) return
    if (obs.status === 'connected') { setResult({ ok: true, text: `Connected to ${name}. Your stats are under the message box.` }); setChecking(null) }
    else if (obs.status === 'error') { setResult({ ok: false, text: obs.detail ?? `${name} refused the connection.` }); setChecking(null) }
  }, [obs.status, obs.detail, checking, name])
  // if the app never answers it's usually closed, or its server is off
  useEffect(() => {
    if (checking === null) return
    const t = setTimeout(() => {
      const why = app === 'obs' ? 'Is OBS open, with Enable WebSocket server ticked?' : app === 'streamlabs' ? 'Is Streamlabs Desktop open, with Remote Control turned on?' : 'Is Meld Studio open?'
      setResult({ ok: false, text: `${name} didn't answer on port ${port}. ${why}` })
      setChecking(null)
    }, 8000)
    return () => clearTimeout(t)
  }, [checking, port, app, name])

  const save = async (value: string): Promise<void> => {
    setResult(null)
    setSecrets(await (app === 'streamlabs' ? window.nnf.obs.setStreamlabsToken(value) : window.nnf.obs.setPassword(value)))
    setPassword('')
    setShow(false)
    setChecking(Date.now())
  }
  const pick = (next: StreamApp): void => {
    if (next === app) return
    setResult(null)
    setPassword('')
    void updateSettings({ streamApp: next })
    if (s.obsEnabled) setChecking(Date.now())
  }
  const state = !s.obsEnabled ? 'Off' : obs.status === 'connected' ? 'Connected' : obs.status === 'error' ? 'Needs attention' : `Waiting for ${name}…`
  const setup = APP_SETUP[app]
  const secretLabel = app === 'streamlabs' ? 'API token' : 'Server password'
  return (
    <div id="obs-settings">
      <Row title="Show Stream Stats" desc="Bitrate, dropped frames, FPS and CPU from your streaming app, in the row under the message box. Only reads: the app never changes anything there.">
        <Toggle label="Show stream stats" on={s.obsEnabled} onChange={(v) => { void updateSettings({ obsEnabled: v }); if (v) setChecking(Date.now()) }} />
      </Row>
      {s.obsEnabled && <>
        <Row title="Streaming app" desc="The one you go live with.">
          <div className="seg stream-apps" role="radiogroup" aria-label="Streaming app">
            {(Object.keys(STREAM_APPS) as StreamApp[]).map((a) => (
              <button key={a} role="radio" aria-checked={a === app} className={a === app ? 'on' : ''} title={STREAM_APPS[a]} onClick={() => pick(a)}>
                <StreamAppLogo app={a} size={16} /> {a === 'obs' ? 'OBS' : a === 'streamlabs' ? 'SLOBS' : 'Meld'}
              </button>
            ))}
          </div>
        </Row>
        <article className="account obs-setup">
          <header>
            <StreamAppLogo app={app} size={20} />
            <h3>{name}</h3>
            <span className="state">{state}</span>
            {obs.status !== 'off' && <div className="row-btns"><button className="btn ghost sm" onClick={() => { setResult(null); setChecking(Date.now()); void window.nnf.obs.reconnect() }}>Test connection</button></div>}
          </header>
          {result
            ? <div className={result.ok ? 'notice good' : 'notice bad'} role="status">{result.ok ? '✓ ' : '✗ '}{result.text}</div>
            : checking !== null
              ? <div className="notice" role="status">Connecting to {name}…</div>
              : obs.detail && obs.status !== 'connected' && <div className={obs.status === 'error' ? 'notice bad' : 'notice'}>{obs.detail}</div>}
          <details className="advanced" open={obs.status !== 'connected'}>
            <summary>How to connect</summary>
            <ol>{setup.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
            {setup.note && <p className="obs-note">{setup.note}</p>}
            <div className="obs-fields">
              <label>Port
                <input key={app} type="number" min={1} max={65535} defaultValue={port} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== port) { void updateSettings({ [portKey]: v }); setResult(null); setChecking(Date.now()) } }} />
              </label>
              {app !== 'meld' && (
                <label>{secretLabel} {saved ? <em>(saved, encrypted on this PC)</em> : <em>(none saved)</em>}
                  <div className="row-btns">
                    <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && password.trim()) void save(password.trim()) }}
                      placeholder={saved ? 'Paste a new one to replace it' : app === 'streamlabs' ? 'Paste the API Token from Streamlabs' : 'Paste the Server Password from OBS'} />
                    <button className="btn ghost sm" type="button" aria-pressed={show} title={show ? `Hide ${secretLabel.toLowerCase()}` : `Show ${secretLabel.toLowerCase()}`} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
                    <button className="btn" disabled={!password.trim()} onClick={() => void save(password.trim())}>Save</button>
                    {saved && <button className="btn ghost" title={app === 'obs' ? 'For OBS without a password' : 'Forget the saved token'} onClick={() => void save('')}>Remove</button>}
                  </div>
                </label>
              )}
            </div>
          </details>
        </article>
      </>}
    </div>
  )
}

/** Streamer.bot WebSocket connection, to list and run its actions. */
function StreamerbotSettings(): JSX.Element {
  const s = useStore((x) => x.settings!)
  const saved = useStore((x) => x.secrets.sbPassword)
  const sb = useStore((x) => x.streamerbot)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  // set right after a change, so the result of that attempt shows under the field
  const [checking, setChecking] = useState<number | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const count = sb.actions.filter((a) => a.enabled).length

  useEffect(() => {
    if (checking === null) return
    if (sb.status === 'connected') { setResult({ ok: true, text: `Connected to Streamer.bot. ${count} action${count === 1 ? '' : 's'} in the / commands list.` }); setChecking(null) }
    else if (sb.status === 'error') { setResult({ ok: false, text: sb.detail ?? 'Streamer.bot refused the connection.' }); setChecking(null) }
  }, [sb.status, sb.detail, checking, count])
  // same thing for SB: usually closed, or its WebSocket server is stopped
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
  ['gifts', 'Gifts', 'Gifted subs, gift bombs and TikTok gifts'],
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

/** Installed fonts where the OS lets us list them. The bundled fonts always work. */
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

/** A small preview of each skin, one click to switch. The window border never changes. */
/** Mini version of the app in a skin's colours, framed by the edge every skin shares. */
function SkinShot({ skin }: { skin: (typeof SKINS)[number] }): JSX.Element {
  const [bg, panel, a, b] = skin.swatch
  return (
    <span className="skin-shot" style={{ background: bg }} aria-hidden="true">
      <span className="skin-bar" style={{ background: panel }}><i style={{ background: a }} /><i style={{ background: b }} /></span>
      <span className="skin-line" style={{ background: panel, width: '72%' }} />
      <span className="skin-line" style={{ background: panel, width: '54%' }} />
      <span className="skin-line accent" style={{ background: `linear-gradient(90deg, ${a}, ${b})`, width: '40%' }} />
      <span className="skin-box" style={{ background: panel }}><i style={{ background: b }} /></span>
    </span>
  )
}

/**
 * One big preview on top, and every skin as a small swatch chip below, split into dark and light.
 * Hovering (or tabbing to) a chip previews it up top; clicking applies it.
 */
function SkinPicker(): JSX.Element {
  const current = skinById(useStore((s) => s.settings!.theme))
  const [hover, setHover] = useState<string | null>(null)
  const shown = hover ? skinById(hover) : current
  const groups: [string, typeof SKINS][] = [['Dark', SKINS.filter((k) => !k.light)], ['Light', SKINS.filter((k) => k.light)]]
  return (
    <div className="skin-picker">
      <div className="skin-hero" aria-live="polite">
        <SkinShot skin={shown} />
        <div className="skin-hero-info">
          <span className="skin-hero-tag">{shown.id === current.id ? 'Current skin' : 'Preview'}</span>
          <strong className="skin-hero-name">{shown.name}</strong>
          <span className="skin-by">{shown.by}</span>
          <span className="skin-hero-dots" aria-hidden="true">{shown.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        </div>
      </div>
      <div className="skin-groups" role="radiogroup" aria-label="Skin" onMouseLeave={() => setHover(null)}>
        {groups.filter(([, list]) => list.length).map(([label, list]) => (
          <div key={label} className="skin-group">
            <span className="skin-group-label">{label}</span>
            <div className="skin-chips">
              {list.map((k) => {
                const [bg, panel, a, b] = k.swatch
                const on = k.id === current.id
                return (
                  <button key={k.id} role="radio" aria-checked={on} className={on ? 'skin-chip on' : 'skin-chip'} title={k.by}
                    onMouseEnter={() => setHover(k.id)} onFocus={() => setHover(k.id)} onBlur={() => setHover(null)}
                    onClick={() => void updateSettings({ theme: k.id })}>
                    <span className="skin-dot" style={{ background: bg, boxShadow: `inset 0 0 0 2px ${panel}` }} aria-hidden="true">
                      <i style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} />
                    </span>
                    <span className="skin-chip-name">{k.name}</span>
                    {on && <span className="skin-check" aria-hidden="true"><Icon.check /></span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export type Category = 'connections' | 'appearance' | 'chat' | 'app' | 'about'
/** Which page to open Settings on, and optionally a section id to scroll to. */
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
  // opened for something specific (the OBS pill, What's New): jump straight to that page/section
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
          {cat === 'about' ? <About chapter={focus?.cat === 'about' ? focus.target : undefined} /> : (
            <div className="modal-scroll" ref={scroll}>
              <header className="cat-head">
                <h2>{info.label}</h2>
                <p>{info.desc}</p>
              </header>

              {cat === 'connections' && <>
                {!s.setupDismissed && <p className="lead">Welcome! Log in to each platform you stream on. You can do this later from the gear icon.</p>}
                <Section title="Accounts" desc="Connect the platforms you stream on">
                  {(['twitch', 'youtube', 'kick'] as LoginPlatform[]).map((p) => <Account key={p} platform={p} />)}
                  <TikTokAccount startOpen={focus?.target === 'tiktok-settings'} />
                </Section>
                <Section title="Alerts & Donations" desc="Pick only the one you use. It adds donations, plus past subs, gifts and Bits the platforms don't share.">
                  <AlertsPicker />
                </Section>
                <Section title="Buy Me a Coffee" desc="Tips, memberships (with every month they've supported you) and shop sales, live in chat and in Recent events. Works next to the service above.">
                  <BmcRow />
                </Section>
                <Section title="Streaming app" desc="See your stream's health at a glance, from OBS Studio, Streamlabs Desktop or Meld Studio">
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
                  <Row title="Animated Connection Line" desc="Once everything is connected, the line under the tabs keeps a soft glow in your platforms' colours, with a slow comet now and then. Off: it fades away after connecting. A platform that drops always turns its part of the line red.">
                    <Toggle label="Animated connection line" on={s.connectionLine} onChange={(v) => void updateSettings({ connectionLine: v })} />
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

import { useEffect, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import { KICK_REDIRECT_URI } from '../../../shared/app-config'
import { ALERT_SOURCE_LABEL, PLATFORM_LABEL, type ChatEventGroup, type CloseAction, type IntegrationState, type Platform } from '../../../shared/types'
import { Icon, PlatformIcon } from '../Icons'
import { setSecrets, updateSettings, useStore } from '../store'
import { About } from './About'
import { statusText } from './Tabs'

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
  const choice = useStore((s) => s.settings!.alertService)
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
            <button key={v} role="radio" aria-checked={choice === v} className={choice === v ? 'on' : ''} onClick={() => { setErr(''); void updateSettings({ alertService: v }) }}>
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

/** Connects to OBS's WebSocket server to show stream health in the title bar. */
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
    if (obs.status === 'connected') { setResult({ ok: true, text: 'Connected to OBS. Your stats are in the title bar.' }); setChecking(null) }
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
      <Row title="Show OBS Stats" desc="Bitrate, dropped frames, FPS, CPU and your encoder from OBS, in the title bar. Only reads: the app never changes anything in OBS.">
        <Toggle label="Show OBS stats" on={s.obsEnabled} onChange={(v) => { void updateSettings({ obsEnabled: v }); if (v) setChecking(Date.now()) }} />
      </Row>
      {s.obsEnabled && (
        <article className="account obs-setup">
          <header>
            <span className="src-tag obs">OBS</span>
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

const CHAT_EVENT_ROWS: [ChatEventGroup, string, string][] = [
  ['subs', 'Subs', 'New subs, resubs and memberships'],
  ['gifts', 'Gifted Subs', 'Single gifts and gift bombs'],
  ['hype', 'Hype Train', 'Start, level-ups and end. The top banner always shows.'],
  ['raids', 'Raids', 'Incoming and outgoing raids and hosts'],
  ['redemptions', 'Redemptions', 'Channel point rewards'],
  ['powerups', 'Power-ups', 'On-Screen Celebrations and custom Power-ups'],
  ['paid', 'Super Stickers and KICKs', 'Paid messages already appear in chat'],
  ['donations', 'Donations', 'Tips from StreamElements and Streamlabs'],
  ['cheers', 'Kick Cheers', 'Twitch cheers always show as messages'],
  ['follows', 'Follows', 'Off by default, because follow bots can flood chat']
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

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }): JSX.Element {
  return (
    <section className="set-section">
      <h3>{title}</h3>
      <p>{desc}</p>
      {children}
    </section>
  )
}

export function Settings({ onClose, focus }: { onClose(): void; focus?: 'obs' }): JSX.Element {
  // Opened from the OBS capsule: go straight to the OBS section.
  useEffect(() => {
    if (focus !== 'obs') return
    requestAnimationFrame(() => document.getElementById('obs-settings')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [focus])
  const boot = useStore((s) => s.boot!)
  const s = useStore((x) => x.settings!)
  const fonts = useFonts()
  const providers = s.emoteProviders
  const setProvider = (key: keyof typeof providers, on: boolean): void => void updateSettings({ emoteProviders: { ...providers, [key]: on } })
  const percent = Math.round(s.windowOpacity * 100)
  const [view, setView] = useState<'settings' | 'about'>('settings')
  const modal = useRef<HTMLDivElement>(null)
  const followLight = (e: MouseEvent): void => {
    const box = modal.current!
    const r = box.getBoundingClientRect()
    box.style.setProperty('--light-x', `${e.clientX - r.left}px`)
    box.style.setProperty('--light-y', `${e.clientY - r.top}px`)
  }

  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-label="Settings" ref={modal} onMouseMove={followLight}>
        <div className="drawer-head">
          <nav className="settings-nav" role="tablist" aria-label="Settings pages">
            <button role="tab" aria-selected={view === 'settings'} className={view === 'settings' ? 'on' : ''} onClick={() => setView('settings')}>Settings</button>
            <button role="tab" aria-selected={view === 'about'} className={view === 'about' ? 'on' : ''} onClick={() => setView('about')}>About</button>
          </nav>
          <div className="grow" />
          <button className="icon-btn" aria-label="Close settings" onClick={() => { void updateSettings({ setupDismissed: true }); onClose() }}><Icon.close /></button>
        </div>
        {view === 'about' ? <About /> : <div className="modal-scroll">
          {!s.setupDismissed && <p className="lead">Welcome! Log in to each platform you stream on. You can do this later from the gear icon.</p>}
          <Section title="Accounts" desc="Connect the platforms you stream on">
            {(['twitch', 'youtube', 'kick'] as Platform[]).map((p) => <Account key={p} platform={p} />)}
          </Section>

          <Section title="Alerts & Donations" desc="Pick only the one you use. It adds donations, plus past subs, gifts and Bits the platforms don't share.">
            <AlertsPicker />
          </Section>

          <Section title="OBS Studio" desc="See your stream's health at a glance, like OBS's Stats dock">
            <ObsSettings />
          </Section>

          <Section title="Window" desc="Choose what happens when you close the app">
            <Row title="When Closing the Window" desc="In the tray, chat stays connected in the background. Open it from the tray icon.">
              <select aria-label="When closing the window" value={s.closeAction} onChange={(e) => void updateSettings({ closeAction: e.target.value as CloseAction })}>
                <option value="exit">Exit completely</option>
                <option value="ask">Ask every time</option>
                <option value="tray">Minimize to tray</option>
              </select>
            </Row>
          </Section>

          <Section title="Appearance" desc="Change how the app looks">
            <Row title="Window Opacity" desc="See through the whole window. Ctrl+Shift+O returns to 100%.">
              <div className="slider">
                <output>{percent}%</output>
                <input type="range" aria-label="Window opacity" min="0" max="100" step="1" value={percent} onChange={(e) => void updateSettings({ windowOpacity: Number(e.target.value) / 100 })} />
              </div>
            </Row>
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

          <Section title="Chat" desc="Choose what each message shows">
            <Row title="Show Timestamps" desc="Show the time beside each message">
              <Toggle label="Show timestamps" on={s.showTimestamps} onChange={(v) => void updateSettings({ showTimestamps: v })} />
            </Row>
            <Row title="Keep Chat History" desc="Saves chat from your last 5 streams on this PC, so you can read what you missed. Turning it off deletes it. /clearhistory deletes it too.">
              <Toggle label="Keep chat history" on={s.keepChatHistory ?? true} onChange={(v) => void updateSettings({ keepChatHistory: v })} />
            </Row>
            <Row title="Show Pronouns" desc="Twitch only, for chatters who set them at pronouns.alejo.io. Sends chatter names to that service.">
              <Toggle label="Show pronouns" on={s.showPronouns} onChange={(v) => void updateSettings({ showPronouns: v })} />
            </Row>
          </Section>

          <Section title="Events in Chat" desc="Show these as cards in chat. They always appear in the Events drop-down.">
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

          <Section title="Updates" desc="New versions come from the project's GitHub page">
            <UpdatesRow />
            <Row title="Check Automatically" desc="Look for a new version at start and every few hours. Only GitHub is contacted.">
              <Toggle label="Check for updates automatically" on={s.autoUpdate} onChange={(v) => void updateSettings({ autoUpdate: v })} />
            </Row>
            <Row title="Include Test Versions" desc="Also offer pre-releases, which may be less stable">
              <Toggle label="Include test versions" on={s.updatePrereleases} onChange={(v) => void updateSettings({ updatePrereleases: v })} />
            </Row>
          </Section>

          <Section title="Safety" desc="Protect against accidental clicks">
            <Row title="Confirm Big Actions" desc="Ask before running an ad, raid or chat clear">
              <Toggle label="Confirm big actions" on={s.confirmActions} onChange={(v) => void updateSettings({ confirmActions: v })} />
            </Row>
          </Section>

          <p className="fine">Version {boot.version}. Data is stored in {boot.dataDir}. Keep that folder private: it holds your logins.</p>
        </div>}
      </div>
    </div>
  )
}

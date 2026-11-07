import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { KICK_REDIRECT_URI } from '../../../shared/app-config'
import { PLATFORM_LABEL, type ChatEventGroup, type Platform } from '../../../shared/types'
import { Icon, PlatformIcon } from '../Icons'
import { setSecrets, updateSettings, useStore } from '../store'
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
  const showFields = !(platform === 'twitch' && boot.builtInTwitchId)
  const live = st?.status === 'connected' || st?.status === 'waiting' || st?.status === 'reconnecting'

  const act = (fn: () => Promise<unknown>) => () => {
    setErr('')
    fn().catch((e) => {
      const text = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/cancelled/i.test(text)) setErr(text)
    })
  }

  return (
    <article className="account">
      <header>
        <span className={`pf ${platform}`}><PlatformIcon platform={platform} size={22} /></span>
        <h3>{PLATFORM_LABEL[platform]}</h3>
        <span className="state">{st?.account ? `${st.account} · ` : ''}{statusText(st)}</span>
      </header>
      {st?.device && (
        <div className="notice good">
          Enter code <b className="code">{st.device.code}</b> at{' '}
          <a href={st.device.url} onClick={(e) => { e.preventDefault(); void window.nnf.openExternal(st.device!.url) }}>{st.device.url}</a>
        </div>
      )}
      {showFields && !live && (
        <details open={!settings[idKey]}>
          <summary>One-time setup</summary>
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
      {err && <div className="notice bad" role="alert">{err}</div>}
      <div className="row-btns">
        {live
          ? <button className="btn ghost" onClick={act(() => window.nnf.logout(platform))}>Log out</button>
          : <button className="btn" disabled={st?.status === 'needs-setup' || st?.status === 'connecting' || (st?.status === 'authorizing' && platform !== 'twitch')} onClick={act(() => window.nnf.login(platform))}>{st?.status === 'authorizing' && platform === 'twitch' ? 'Get a new code' : 'Log in'}</button>}
        {live && <button className="btn ghost" onClick={act(() => window.nnf.reconnect(platform))}>Reconnect</button>}
      </div>
    </article>
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
  ['cheers', 'Kick Cheers', 'Twitch cheers always show as messages'],
  ['follows', 'Follows', 'Off by default, because follow bots can flood chat']
]

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

export function Settings({ onClose }: { onClose(): void }): JSX.Element {
  const boot = useStore((s) => s.boot!)
  const s = useStore((x) => x.settings!)
  const fonts = useFonts()
  const providers = s.emoteProviders
  const setProvider = (key: keyof typeof providers, on: boolean): void => void updateSettings({ emoteProviders: { ...providers, [key]: on } })
  const percent = Math.round(s.windowOpacity * 100)

  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-label="Settings">
        <div className="drawer-head">
          <h2>Settings</h2>
          <div className="grow" />
          <button className="icon-btn" aria-label="Close settings" onClick={() => { void updateSettings({ setupDismissed: true }); onClose() }}><Icon.close /></button>
        </div>
        <div className="modal-scroll">
          {!s.setupDismissed && <p className="lead">Welcome! Log in to each platform you stream on. You can do this later from the gear icon.</p>}
          <Section title="Accounts" desc="Connect the platforms you stream on">
            {(['twitch', 'youtube', 'kick'] as Platform[]).map((p) => <Account key={p} platform={p} />)}
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
            <Row title="Show Pronouns" desc="Twitch only, for chatters who set them at pronouns.alejo.io. Sends chatter names to that service.">
              <Toggle label="Show pronouns" on={s.showPronouns} onChange={(v) => void updateSettings({ showPronouns: v })} />
            </Row>
          </Section>

          <Section title="Events in Chat" desc="Show these as cards in chat. They always appear in the Events drop-down.">
            {CHAT_EVENT_ROWS.map(([key, title, desc]) => (
              <Row key={key} title={title} desc={desc}>
                <Toggle label={`${title} in chat`} on={s.chatEvents[key]} onChange={(v) => void updateSettings({ chatEvents: { ...s.chatEvents, [key]: v } })} />
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

          <Section title="Safety" desc="Protect against accidental clicks">
            <Row title="Confirm Big Actions" desc="Ask before running an ad, raid or chat clear">
              <Toggle label="Confirm big actions" on={s.confirmActions} onChange={(v) => void updateSettings({ confirmActions: v })} />
            </Row>
          </Section>

          <p className="fine">Version {boot.version}. Data is stored in {boot.dataDir}. Keep that folder private: it holds your logins.</p>
        </div>
      </div>
    </div>
  )
}

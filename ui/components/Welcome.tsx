import type { JSX } from 'react'
import { Icon, PlatformIcon } from './Icons'
import { Account } from './Settings'
import { connected, updateSettings, useStore } from '../lib/store'
import { login } from '../lib/login'

/**
 * First run: instead of opening Settings over everything (people didn't see their chat behind it),
 * the app opens on the chat with this card at the top of it. It has the same Log in rows as
 * Settings > Connections, so logging in works exactly the same, plus a way into the full Settings.
 * Done or ✕ puts it away for good (it can be brought back in Settings > App). Settings files from
 * before this card already have setupDismissed set, so existing users never see it.
 */
export function Welcome({ onSettings }: { onSettings(): void }): JSX.Element | null {
  const dismissed = useStore((s) => s.settings?.setupDismissed ?? true)
  const statuses = useStore((s) => s.statuses)
  if (dismissed) return null
  const any = (['twitch', 'youtube', 'kick', 'tiktok'] as const).some((p) => connected(statuses, p))
  const done = (): void => void updateSettings({ setupDismissed: true })

  return (
    <section className="welcome" aria-label="Welcome">
      <button className="icon-btn welcome-close" aria-label="Close the welcome card" title="Close" onClick={done}><Icon.close /></button>
      <h2>Welcome! This is your chat</h2>
      <p className="welcome-lead">Messages from every platform you connect show up right here. Log in to the ones you stream on:</p>
      <div className="welcome-accounts">
        <Account platform="twitch" />
        <Account platform="youtube" />
        <Account platform="kick" />
        <article className="account tiktok">
          <header>
            <span className="pf tiktok"><PlatformIcon platform="tiktok" size={18} /></span>
            <h3>TikTok</h3>
            <span className="state">{connected(statuses, 'tiktok') ? 'Connected' : 'Username and key, in Settings'}</span>
            <div className="row-btns"><button className="btn ghost sm" onClick={() => void login('tiktok')}>Set up</button></div>
          </header>
        </article>
      </div>
      <div className="welcome-foot">
        <button className="linkish" onClick={onSettings}>More settings: alerts, OBS, Streamer.bot, looks…</button>
        <button className="btn sm" onClick={done}>{any ? 'Done' : 'Later'}</button>
      </div>
    </section>
  )
}

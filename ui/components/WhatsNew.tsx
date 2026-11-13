import { useState, type JSX, type ReactNode } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { Icon } from './Icons'
import type { SettingsFocus } from './Settings'

/**
 * What this version adds. Update this list for every release: it shows once, on the first start
 * of a new version (or of a new install), until the user clicks "Cool!".
 */
interface NewThing {
  icon: ReactNode
  title: string
  text: string
  /** Where "Show me" goes: a place in Settings, or the commands list. */
  show?: SettingsFocus | 'commands'
}

const NEW_THINGS: NewThing[] = [
  {
    icon: <Icon.shield />,
    title: 'Held messages and suspicious users',
    text: 'Messages Twitch\'s AutoMod holds show in chat with Allow and Deny. Suspicious users get a warning with Delete and Ban. Log in to Twitch again to turn this on.',
    show: { cat: 'connections' }
  },
  {
    icon: <Icon.warn />,
    title: 'Spam warnings everywhere',
    text: '"Buy followers" bots are marked on Twitch, Kick and YouTube, with Delete and Ban right on the message.',
    show: { cat: 'chat', target: 'messages-settings' }
  },
  {
    icon: <Icon.all />,
    title: 'Video and clip previews',
    text: 'YouTube links and Twitch, Kick or YouTube clips get a card with the picture, title and length.',
    show: { cat: 'chat', target: 'messages-settings' }
  },
  {
    icon: <Icon.events />,
    title: 'New clips in chat',
    text: 'When anyone clips your stream on Twitch or Kick, the clip shows up in chat and in Events.',
    show: { cat: 'chat', target: 'chat-events-settings' }
  },
  {
    icon: <Icon.check />,
    title: 'Fixes',
    text: 'The "Log in again" notice now goes away once you have logged in again. The first messages after start-up no longer show twice. The version now shows in the title bar.'
  }
]

/** "What's new", shown once per version. Only "Cool!" or "Show me" put it away for good. */
export function WhatsNew({ onSettings, onCommands }: { onSettings(f: SettingsFocus): void; onCommands(): void }): JSX.Element | null {
  const version = useStore((s) => s.boot?.version ?? '')
  const seen = useStore((s) => s.settings?.seenVersion ?? '')
  const [closed, setClosed] = useState(false)
  if (closed || !version || seen === version || !NEW_THINGS.length) return null

  const done = (): void => {
    setClosed(true)
    void updateSettings({ seenVersion: version })
  }
  const show = (t: NewThing): void => {
    done()
    if (t.show === 'commands') onCommands()
    else if (t.show) onSettings(t.show)
  }
  return (
    <div className="close-back" role="presentation">
      <div className="popover whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <header>
          <span className="wn-badge">New</span>
          <h2 id="whats-new-title">What's new in {version}</h2>
        </header>
        <ul>
          {NEW_THINGS.map((t) => (
            <li key={t.title}>
              <span className="wn-icon" aria-hidden="true">{t.icon}</span>
              <div className="wn-text">
                <b>{t.title}</b>
                <p>{t.text}</p>
              </div>
              {t.show && <button className="btn ghost sm" onClick={() => show(t)}>Show me</button>}
            </li>
          ))}
        </ul>
        <div className="wn-foot">
          <button className="btn" autoFocus onClick={done}>Cool!</button>
        </div>
      </div>
    </div>
  )
}

import { useState, type JSX, type ReactNode } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { Icon, StreamerbotLogo } from './Icons'
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
    icon: <StreamerbotLogo size={22} />,
    title: 'Streamer.bot',
    text: 'Run your Streamer.bot actions straight from the message box with /sb. The list follows what you set up in Streamer.bot, live.',
    show: { cat: 'connections', target: 'streamerbot-settings' }
  },
  {
    icon: <Icon.slash />,
    title: 'Commands, sorted and searchable',
    text: 'The / button moved to the left. Its list is split into Twitch, app and Streamer.bot commands, with a search box on top.',
    show: 'commands'
  },
  {
    icon: <Icon.users />,
    title: 'Channel stats',
    text: 'Your followers and subscribers on each platform, under the message box next to the clock.',
    show: { cat: 'app', target: 'stats-settings' }
  },
  {
    icon: <Icon.palette />,
    title: 'New skin: Myst Bourne',
    text: 'A purple and white skin, for Alex.',
    show: { cat: 'appearance', target: 'skins-settings' }
  },
  {
    icon: <Icon.check />,
    title: 'Popups close by themselves',
    text: 'Click anywhere outside a popup and it closes.'
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

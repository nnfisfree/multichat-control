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
    icon: <Icon.bolt />,
    title: 'Wobbly window',
    text: 'Inspired by KDE Plasma on Linux: turn it on and the window bends like jelly while you drag it, then settles when you let go. A slider sets how much it wobbles.',
    show: { cat: 'appearance', target: 'window-settings' }
  },
  {
    icon: <Icon.palette />,
    title: 'Two new skins: Kanagawa and Sweet',
    text: 'Two favourites from the Linux community take the place of Nord and Gruvbox.',
    show: { cat: 'appearance', target: 'skins-settings' }
  },
  {
    icon: <Icon.gem />,
    title: 'Gift bombs, Power-ups and badges',
    text: 'A gift bomb lists every sub and who got it, custom Power-ups show their name, Twitch gifts, Power-ups and Hype Trains are Twitch purple, and event badges have small animated icons.'
  },
  {
    icon: <Icon.pin />,
    title: 'The window stays where you put it',
    text: 'Its size, position, monitor and maximized state are kept for the next start. If that monitor is not connected, the window opens on your main monitor instead.'
  },
  {
    icon: <Icon.users />,
    title: 'Channel stats in the title bar',
    text: 'Followers and subscribers now sit in the middle of the title bar, and OBS stats moved under the message box, next to the clock.',
    show: { cat: 'app', target: 'stats-settings' }
  },
  {
    icon: <Icon.palette />,
    title: 'A cleaner look',
    text: 'The window edge is as thin as a normal window, and the clock and OBS stats under the message box now look just like the channel stats in the title bar, in every skin.'
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

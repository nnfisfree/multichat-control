import { useState, type JSX, type ReactNode } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { Icon } from './Icons'
import type { SettingsFocus } from './Settings'

/**
 * What changed in THIS version only. Replace the whole list every release (don't append to the
 * last one) so the window stays short. Shows once, on the first start of a new version or a fresh
 * install, until the user clicks "Cool!".
 */
interface NewThing {
  icon: ReactNode
  title: string
  text: string
  /** A fix rather than a feature, gets a small "Fixed" label. */
  fixed?: boolean
  /** Where "Show me" goes: a Settings page or the command list. */
  show?: SettingsFocus | 'commands'
}

const NEW_THINGS: NewThing[] = [
  {
    icon: <Icon.star />,
    title: 'Frosty Christmas skin',
    text: 'A new light skin for the season: snowflakes falling behind your chat, a string of twinkling Christmas lights along the top, a Santa hat on the app icon, frost in the corners and snow piling up above the message box. Now and then Santa\'s sleigh flies across the top. Turn the animation off any time with Animate Skin.',
    show: { cat: 'appearance', target: 'skins-settings' }
  },
  {
    icon: <Icon.gear />,
    title: 'A new Settings',
    text: 'The pages are tabs along the top, with a search box that finds any setting and takes you straight to it. Sections sit side by side when the window is wide, so there is far less scrolling. Pop-ups and celebrations now have their own Events & Alerts page, and each tab shows how many of its settings you changed.',
    show: { cat: 'events' }
  },
  {
    icon: <Icon.timer />,
    title: 'Live time with Enhanced Broadcasting',
    text: 'With Twitch Enhanced Broadcasting (several qualities sent at once) the LIVE time under the message box ran several times too fast. It now counts the real time you have been live.',
    fixed: true
  }
]

/** Shown once per version. Only "Cool!" or "Show me" dismiss it for good. */
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
                <b>{t.title}{t.fixed && <span className="wn-kind">Fixed</span>}</b>
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

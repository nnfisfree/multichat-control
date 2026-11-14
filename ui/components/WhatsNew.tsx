import { useState, type JSX, type ReactNode } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { BmcLogo, Icon } from './Icons'
import type { SettingsFocus } from './Settings'

/**
 * What changed in THIS version only. Replace the whole list for every release (never append to the
 * previous one), so the window stays short. It shows once, on the first start of a new version (or
 * of a new install), until the user clicks "Cool!".
 */
interface NewThing {
  icon: ReactNode
  title: string
  text: string
  /** A fix rather than something new; it gets a small "Fixed" label. */
  fixed?: boolean
  /** Where "Show me" goes: a place in Settings, or the commands list. */
  show?: SettingsFocus | 'commands'
}

const NEW_THINGS: NewThing[] = [
  {
    icon: <BmcLogo size={20} />,
    title: 'Buy Me a Coffee',
    text: 'Tips, memberships and shop sales from your Buy Me a Coffee page now pop up in chat and in Recent events. When a member renews, you see how many months they have supported you. Connect it in Settings with one token.',
    show: { cat: 'connections', target: 'bmc-settings' }
  },
  {
    icon: <Icon.events />,
    title: 'Event pop-ups',
    text: 'New subs, gifts, cheers, raids and follows rise out of the message box, stay for as long as you like, then slide back down. Hover one to keep it, click it to close it.',
    show: { cat: 'chat', target: 'popup-settings' }
  },
  {
    icon: <Icon.bolt />,
    title: 'Test alerts while offline',
    text: 'Test triggers from Streamer.bot and test alerts from StreamElements or Streamlabs now show up in Recent events and chat with a TEST tag. They are never saved, so they are gone after a restart, or right away with Clear → Clear tests.'
  },
  {
    icon: <Icon.check />,
    title: 'Your own gifts and redemptions are real again',
    text: 'Things you do on your own channel, like gifting a sub, were wrongly tagged TEST. Only real test alerts get the tag now.',
    fixed: true
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

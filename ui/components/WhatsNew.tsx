import { useState, type JSX, type ReactNode } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { BmcLogo, Icon } from './Icons'
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
    icon: <Icon.palette />,
    title: 'Three light skins',
    text: 'Butterfly, Catppuccin Latte and Everforest Light: dark text on a pale window, for bright rooms and daytime streams. New installs now start on Sweet; your current skin stays as it is.',
    show: { cat: 'appearance', target: 'skins-settings' }
  },
  {
    icon: <Icon.events />,
    title: 'Calmer event pop-ups',
    text: 'One pop-up at a time, at the top of chat. A wave of follows becomes one card ("Sam and 5 others" ×6), big cheers stay a little longer, and pop-ups wait while a panel is open over chat.',
    show: { cat: 'chat', target: 'popup-settings' }
  },
  {
    icon: <Icon.gem />,
    title: 'Resub months and tips at a glance',
    text: 'Resubs and memberships show their months (SUB ×14) and streak. Tips get a TIP badge with the logo of the service they came through: StreamElements, Streamlabs, Buy Me a Coffee or the platform itself.'
  },
  {
    icon: <BmcLogo size={20} />,
    title: 'Support the project',
    text: 'A small Buy Me a Coffee button now sits under the message box. It is entirely optional, and it keeps the app free.'
  },
  {
    icon: <Icon.bolt />,
    title: "Twitch's Power-ups, as on Twitch",
    text: 'Message Effects get their animated RGB outline, Gigantify an Emote pops the emote in big, and On-Screen Celebrations sparkle. Highlight My Message shows once, without an extra card.'
  },
  {
    icon: <Icon.check />,
    title: 'Fixes',
    text: 'Tips from StreamElements, Streamlabs and Buy Me a Coffee now show on every tab, Buy Me a Coffee messages no longer end in "<br>" and a name, and pop-ups stay clear of the raid bar and Hype Train.',
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

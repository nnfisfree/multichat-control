import { useState, type JSX, type ReactNode } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { Icon, PlatformIcon } from './Icons'
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
    icon: <Icon.reply />,
    title: 'Reply, copy and quick actions',
    text: "Point at a message for Reply, Copy and a menu with Pin, the user card, Twitch's viewer card, a 60 second timeout, Ban and Delete. Works on Twitch, YouTube and Kick."
  },
  {
    icon: <Icon.star />,
    title: 'Ignore or highlight people',
    text: "Hide someone's messages from chat, or make them stand out in gold. Both lists live in Settings, where one click takes a name off again.",
    show: { cat: 'chat', target: 'people-settings' }
  },
  {
    icon: <Icon.all />,
    title: 'Chat settings per platform',
    text: 'Pick username colours for Twitch, YouTube and Kick, with colours per role, and choose for every kind of event whether it shows in chat, in the Events tab, or both. The Events badge only counts what you picked.',
    show: { cat: 'chat', target: 'platform-settings' }
  },
  {
    icon: <Icon.palette />,
    title: 'Solarized Dark and Tokyo Night Day',
    text: 'Two new skins: the classic deep teal Solarized, and the light, cool blue sibling of Tokyo Night.',
    show: { cat: 'appearance', target: 'skins-settings' }
  },
  {
    icon: <PlatformIcon platform="kick" size={18} />,
    title: 'Kick stays connected',
    text: 'Kick chat no longer drops for a few seconds every 45 minutes while its login renews.',
    fixed: true
  },
  {
    icon: <Icon.plug />,
    title: 'Buy Me a Coffee keeps its token',
    text: "A hiccup on Buy Me a Coffee's side no longer shows as a disconnect, and no longer logs you out.",
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

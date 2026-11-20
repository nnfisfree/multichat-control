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
    icon: <PlatformIcon platform="tiktok" size={18} />,
    title: 'TikTok LIVE (beta)',
    text: 'TikTok chat, gifts, subs, follows and shares now show next to Twitch, YouTube and Kick. Type your @username, paste a free Euler Stream key, and the app joins your LIVE on its own. Still under development and read-only for now, so please report anything odd.',
    show: { cat: 'connections', target: 'tiktok-settings' }
  },
  {
    icon: <Icon.bolt />,
    title: 'A comet under the tabs',
    text: "A thin line in your platforms' colours shows connections coming up, keeps a calm glow once everything is connected, and turns red if a platform drops. Tabs now only show for connected platforms, with coloured icons.",
    show: { cat: 'appearance', target: 'window-settings' }
  },
  {
    icon: <Icon.plug />,
    title: 'Tidier Connections',
    text: 'Each account is one line until you click it, and the developer-app fields are gone for Twitch and Kick.',
    show: { cat: 'connections' }
  },
  {
    icon: <Icon.gem />,
    title: 'Sponsor on GitHub',
    text: 'The Support page has a Collaborators section, and GitHub sponsors appear on the Wall of Supporters by themselves. Two small icons under the message box lead to GitHub Sponsors and Buy Me a Coffee.',
    show: { cat: 'about', target: 'support' }
  },
  {
    icon: <Icon.events />,
    title: 'Cleaner Bits cards',
    text: 'Cheers show just the amount next to the BITS badge, in chat, pop-ups and Recent events.',
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

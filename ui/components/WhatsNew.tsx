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
    icon: <Icon.plug />,
    title: 'StreamElements and Streamlabs are here',
    text: 'Log in to your own StreamElements or Streamlabs account right inside the app: one click, and the window closes by itself. Your last 30 days of tips, subs, gifts, cheers and raids show up in Events, and new alerts arrive live.',
    show: { cat: 'connections' }
  },
  {
    icon: <Icon.gem />,
    title: 'Gift bombs in one line',
    text: 'A gift bomb is one entry with how many and which tier, like "5x Tier 1", on every platform. The single gifts inside it no longer fill the list.'
  },
  {
    icon: <Icon.send />,
    title: 'Send it again with the Up arrow',
    text: 'In the message box, press Up to bring back what you sent earlier and Down to go forward again. It works on every platform you can type in, for messages and commands, and starts fresh each time the app opens.'
  },
  {
    icon: <Icon.all />,
    title: 'A glowing frame and a colourful comet',
    text: 'The open tab sits in a rounded frame whose colours keep circling round it and glides over when you switch tabs. The comet on the connection line now carries your connected platforms’ colours.'
  },
  {
    icon: <Icon.timer />,
    title: 'Your streaming app, by name',
    text: 'Until OBS, Streamlabs Desktop or Meld Studio connects, the bar under the message box takes turns showing their logos. Once one connects, it shows the app and its version with a green check, like "OBS Studio 33.0.3 ✓".'
  },
  {
    icon: <Icon.users />,
    title: 'A smaller Connections menu',
    text: 'The Connections list is compact, with each service’s official logo and its status under its name, and it squeezes itself to fit however many platforms you connect.'
  },
  {
    icon: <Icon.palette />,
    title: 'New skin: Carbonfox',
    text: 'A graphite-black dark skin from the Nightfox family, with soft purple and blue accents.',
    show: { cat: 'appearance' }
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

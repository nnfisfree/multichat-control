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
    icon: <Icon.bolt />,
    title: 'Live stream graph',
    text: 'Hover the OBS stats under the message box for a 60-second graph of bitrate, FPS, CPU and dropped frames, updated every second. Click for the full stats, graph included.'
  },
  {
    icon: <Icon.plug />,
    title: 'Streamlabs Desktop and Meld Studio',
    text: 'Stream stats now also work with Streamlabs Desktop (SLOBS) and Meld Studio. Pick yours in Settings; the icon spins, hops or wobbles while you are live.',
    show: { cat: 'connections', target: 'obs-settings' }
  },
  {
    icon: <Icon.palette />,
    title: 'A smaller skin picker',
    text: 'Skins are now compact chips split into dark and light, with a big preview of the one you hover.',
    show: { cat: 'appearance', target: 'skins-settings' }
  },
  {
    icon: <Icon.gem />,
    title: 'Wall of Supporters',
    text: 'The Support page thanks everyone who supported the project, updated on its own. Hover the support button for a surprise.',
    show: { cat: 'about', target: 'support' }
  },
  {
    icon: <Icon.events />,
    title: 'Event colours',
    text: 'Subs, gifts, Bits, Super Chats, raids and follows in chat now use the colour of their platform, and tips the colour of their service.',
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

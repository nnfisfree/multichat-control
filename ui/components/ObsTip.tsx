import { useEffect, useState, type JSX } from 'react'
import { updateSettings, useStore } from '../lib/store'
import { ObsLogo } from './Icons'

/** How long OBS gets to connect on its own before the tip is shown. */
const WAIT_MS = 8000

/**
 * A one-time tip about OBS stats, for a new install or anyone who never set OBS up. It waits for
 * "What's new" to be put away and for OBS to have had a chance to connect, and never shows again
 * once closed.
 */
export function ObsTip({ onSetup }: { onSetup(): void }): JSX.Element | null {
  const version = useStore((s) => s.boot?.version ?? '')
  const seenVersion = useStore((s) => s.settings?.seenVersion ?? '')
  // Already set up (OBS connected before, or a password is saved): no reminder, even when OBS
  // happens to be closed right now.
  const seen = useStore((s) => (s.settings?.obsTipSeen ?? true) || (s.settings?.obsSetUp ?? true) || s.secrets.obsPassword)
  const connected = useStore((s) => s.obs.status === 'connected')
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)
  const waiting = !seen && !closed && !!version && seenVersion === version

  useEffect(() => {
    if (!waiting || ready) return
    const t = setTimeout(() => setReady(true), WAIT_MS)
    return () => clearTimeout(t)
  }, [waiting, ready])
  // OBS already works: nothing to explain.
  useEffect(() => {
    if (waiting && connected) void updateSettings({ obsTipSeen: true })
  }, [waiting, connected])

  if (!waiting || !ready || connected) return null
  const done = (): void => {
    setClosed(true)
    void updateSettings({ obsTipSeen: true })
  }
  return (
    <div className="close-back" role="presentation">
      <div className="popover whats-new obs-tip" role="dialog" aria-modal="true" aria-labelledby="obs-tip-title">
        <header>
          <span className="obs-tip-logo" aria-hidden="true"><ObsLogo size={26} /></span>
          <h2 id="obs-tip-title">See your OBS stats here</h2>
        </header>
        <p>Your stream's health (bitrate, dropped frames, FPS and CPU) can show under the message box, live from OBS Studio. The app only reads it and never changes anything in OBS.</p>
        <ol>
          <li>Make sure <b>Show OBS Stats</b> is on in Settings → Connections → OBS Studio.</li>
          <li>In OBS, open <b>Tools → WebSocket Server Settings</b> and tick <b>Enable WebSocket server</b>.</li>
          <li>Follow the steps under <b>How to connect</b> in those settings. A password is only needed if OBS asks for one.</li>
        </ol>
        <div className="wn-foot">
          <button className="btn ghost" onClick={done}>Not now</button>
          <button className="btn" autoFocus onClick={() => { done(); onSetup() }}>Set it up</button>
        </div>
      </div>
    </div>
  )
}

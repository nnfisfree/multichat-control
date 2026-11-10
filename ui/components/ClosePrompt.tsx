import { useEffect, useState, type JSX } from 'react'
import { CLOSE_ASK_EVENT } from '../../engine'

interface CloseActions { tray(remember: boolean): void; exit(remember: boolean): void }
const actions = (): CloseActions => (window as unknown as { nnfClose: CloseActions }).nnfClose

/** "Close the app or keep it running in the tray?", asked when closing is set to Ask every time. */
export function ClosePrompt(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)
  useEffect(() => {
    const show = (): void => { setRemember(false); setOpen(true) }
    window.addEventListener(CLOSE_ASK_EVENT, show)
    return () => window.removeEventListener(CLOSE_ASK_EVENT, show)
  }, [])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  const pick = (choice: 'tray' | 'exit'): void => {
    setOpen(false)
    actions()[choice](remember)
  }
  return (
    <div className="close-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="popover close-prompt" role="dialog" aria-modal="true" aria-labelledby="close-title">
        <h2 id="close-title">Close the app or keep it running in the tray?</h2>
        <p>In the tray, chat stays connected in the background.</p>
        <label className="close-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my choice
        </label>
        <div className="close-buttons">
          <button className="btn" autoFocus onClick={() => pick('tray')}>Minimize to tray</button>
          <button className="btn ghost" onClick={() => pick('exit')}>Exit</button>
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type JSX } from 'react'
import { Icon } from '../Icons'

/** Reserves the flyout's space. The real Twitch page is a native view placed over the host box. */
export function RewardsPanel({ onClose }: { onClose(): void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [full, setFull] = useState(false)

  useEffect(() => {
    const el = host.current!
    const place = (): void => {
      const r = el.getBoundingClientRect()
      window.nnf.showPanel({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
        .then((res) => setError(res.ok ? '' : res.message ?? 'Could not open the panel.'), () => setError('Could not open the panel.'))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      void window.nnf.hidePanel()
    }
  }, [])

  const toggle = (): void => {
    void window.nnf.panelRewardsOnly(full)
    setFull(!full)
  }

  return (
    <div className="popover rewards" role="dialog" aria-label="Twitch Rewards and Power-ups">
      <div className="pop-head">
        <h2>Rewards &amp; Power-ups</h2>
        <div className="grow" />
        <button className="linkish" onClick={toggle}>{full ? 'Rewards only' : 'Full chat'}</button>
        <button className="linkish" onClick={() => void window.nnf.popOutPanel()}>Pop out</button>
        <button className="icon-btn" aria-label="Close rewards" onClick={onClose}><Icon.close /></button>
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className={error ? 'rewards-host hidden' : 'rewards-host'} ref={host} />
      <div className="pop-foot"><span>Power-ups spend real Bits. If a reward needs a message, use Full chat.</span></div>
    </div>
  )
}

import { useEffect, useRef, useState, type JSX } from 'react'
import type { PanelColors } from '../../shared/types'
import { Icon } from './Icons'
import { useStore } from '../lib/store'
import { skinById } from '../styles/skins'

/** Skin colours handed to Twitch's panel. */
function skinColors(id: string | undefined): PanelColors {
  const vars = skinById(id).vars
  const v = (name: string): string => vars[name] ?? ''
  return {
    window: v('--window'), base: v('--solid'), alt: v('--solid-2'), text: v('--text'), muted: v('--muted'),
    accent: v('--purple'), accentHover: v('--purple-2'), onAccent: v('--on-accent'), line: v('--line')
  }
}

/** Just reserves the space. The actual Twitch page is a native webview positioned over this box. */
export function RewardsPanel({ onClose }: { onClose(): void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const skin = useStore((s) => s.settings?.theme)

  useEffect(() => {
    const el = host.current!
    const place = (): void => {
      const r = el.getBoundingClientRect()
      window.nnf.showPanel({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), colors: skinColors(skin) })
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
    // re-send colours on skin change
  }, [skin])

  return (
    <div className="popover rewards" role="dialog" aria-label="Twitch Rewards and Power-ups">
      <div className="pop-head">
        <h2>Rewards &amp; Power-ups</h2>
        <div className="grow" />
        <button className="icon-btn" aria-label="Close rewards" onClick={onClose}><Icon.close /></button>
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className={error ? 'rewards-host hidden' : 'rewards-host'} ref={host} />
      <div className="pop-foot"><span>Power-ups spend real Bits.</span></div>
    </div>
  )
}

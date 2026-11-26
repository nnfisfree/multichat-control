import { useEffect, useState, type JSX, type PointerEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

// not exported by @tauri-apps/api, same values as its own type
type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0]

/**
 * Wider grab zones for resizing the window. The window has no Windows frame, and Windows only gives
 * it a few pixels to grab at each edge, so resizing meant hunting for one exact pixel. These zones
 * sit just inside the edges (wider at the corners) and hand the drag to Windows itself
 * (startResizeDragging), so the resize is the normal native one, snapping included.
 *
 * Sizes: the top stays thin so the title bar buttons (✕ in the corner) keep working, and the right
 * one is a little narrower so chat's scrollbar can still be grabbed. Off while maximized.
 */
const ZONES: { dir: ResizeDirection; cls: string }[] = [
  { dir: 'North', cls: 'n' }, { dir: 'South', cls: 's' }, { dir: 'West', cls: 'w' }, { dir: 'East', cls: 'e' },
  { dir: 'NorthWest', cls: 'nw' }, { dir: 'NorthEast', cls: 'ne' }, { dir: 'SouthWest', cls: 'sw' }, { dir: 'SouthEast', cls: 'se' }
]

export function ResizeEdges(): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let off: (() => void) | undefined
    let alive = true
    const win = getCurrentWindow()
    const check = (): void => { win.isMaximized().then((m) => { if (alive) setMaximized(m) }, () => {}) }
    check()
    win.onResized(check).then((un) => { if (alive) off = un; else un() }, () => {})
    return () => { alive = false; off?.() }
  }, [])

  if (maximized) return null
  const start = (dir: ResizeDirection) => (e: PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    void getCurrentWindow().startResizeDragging(dir).catch(() => {})
  }
  return (
    <div className="resize-edges" aria-hidden="true">
      {ZONES.map((z) => <div key={z.cls} className={`resize-edge ${z.cls}`} onPointerDown={start(z.dir)} />)}
    </div>
  )
}

import { useEffect, useState, type JSX } from 'react'

const two = (n: number): string => String(n).padStart(2, '0')

/** hh:mm:ss AM/PM, from the PC's own clock. */
const time = (d: Date): string => {
  const h = d.getHours() % 12 || 12
  return `${two(h)}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
const half = (d: Date): string => (d.getHours() < 12 ? 'AM' : 'PM')
const date = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

/** Ticks right after each second turns, so the clock never lags or skips a second. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = (): void => {
      const d = new Date()
      setNow(d)
      t = setTimeout(tick, 1000 - d.getMilliseconds() + 5)
    }
    t = setTimeout(tick, 1000 - new Date().getMilliseconds() + 5)
    return () => clearTimeout(t)
  }, [])
  return now
}

/** The PC's local time under the chat box. Hovering shows the date. Colours follow the skin. */
export function Clock(): JSX.Element {
  const now = useNow()
  return (
    <div className="clock-row">
      <div className="clock" tabIndex={0} aria-label={`${time(now)} ${half(now)}, ${date(now)}`}>
        <span className="clock-dot" aria-hidden="true" />
        <span className="clock-time">{time(now)}</span>
        <span className="clock-half">{half(now)}</span>
        <span className="clock-date" role="tooltip">{date(now)}</span>
      </div>
    </div>
  )
}

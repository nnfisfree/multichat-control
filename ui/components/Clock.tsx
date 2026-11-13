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
    <div className="clock" tabIndex={0} aria-label={`${time(now)} ${half(now)}, ${date(now)}`}>
      <svg className="clock-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M12 7v5.2l3.4 2.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="clock-time">{time(now)}</span>
      <span className="clock-half">{half(now)}</span>
      <span className="clock-date" role="tooltip">{date(now)}</span>
    </div>
  )
}

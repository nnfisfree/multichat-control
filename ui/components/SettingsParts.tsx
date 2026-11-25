import type { JSX, ReactNode } from 'react'
import type { Platform } from '../../shared/types'
import { PlatformIcon } from './Icons'

/** A setting: title (with an optional logo in front), description, and its control on the right. */
export function Row({ title, desc, icon, children }: { title: string; desc: string; icon?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="set-row">
      <div className="set-text"><b className={icon ? 'with-logo' : undefined}>{icon}{title}</b><span>{desc}</span></div>
      <div className="set-control">{children}</div>
    </div>
  )
}

export function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }): JSX.Element {
  return <button className={on ? 'toggle on' : 'toggle'} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}><i /></button>
}

/** People on the ignore or highlight list, each with a button to take them off. */
export function MarkedUsers({ list, empty, remove }: { list: Record<string, string>; empty: string; remove(key: string): void }): JSX.Element {
  const keys = Object.keys(list).sort((a, b) => list[a].localeCompare(list[b]))
  if (!keys.length) return <p className="hint marked-empty">{empty}</p>
  return (
    <ul className="marked-users">
      {keys.map((k) => (
        <li key={k}>
          <PlatformIcon platform={k.split(':')[0] as Platform} size={14} />
          <span>{list[k]}</span>
          <button className="btn ghost sm" onClick={() => remove(k)}>Remove</button>
        </li>
      ))}
    </ul>
  )
}


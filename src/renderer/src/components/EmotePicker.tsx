import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { sortEmotes } from '../../../shared/parts'
import { PLATFORMS, type Emote, type Platform } from '../../../shared/types'
import { Icon } from '../Icons'

const RECENT_KEY = 'nnf.recentEmotes'
const RECENT_MAX = 24
const RENDER_MAX = 400

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

function remember(name: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...loadRecent().filter((n) => n !== name)].slice(0, RECENT_MAX)))
  } catch { /* the list is a convenience; ignore storage failures */ }
}

interface Props {
  scope: Platform | 'all'
  onPick(name: string): void
  onClose(): void
}

export function EmotePicker({ scope, onPick, onClose }: Props): JSX.Element {
  const [all, setAll] = useState<Emote[] | null>(null)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<Emote | null>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    const list = scope === 'all' ? PLATFORMS : [scope]
    void Promise.all(list.map((p) => window.nnf.emotes(p).catch((): Emote[] => []))).then((r) => {
      if (live) setAll(sortEmotes(r.flat(), scope))
    })
    search.current?.focus()
    return () => { live = false }
  }, [scope])

  const groups = useMemo(() => {
    const out = new Map<string, Emote[]>()
    if (!all) return out
    const term = q.trim().toLowerCase()
    if (!term) {
      const recent = loadRecent().flatMap((n) => all.find((e) => e.name === n) ?? [])
      if (recent.length) out.set('Frequently used', recent)
    }
    let budget = RENDER_MAX
    for (const e of all) {
      if (term && !e.name.toLowerCase().includes(term)) continue
      if (budget-- <= 0) break
      const label = scope === 'all' && e.platform !== 'twitch' ? `${e.platform === 'kick' ? '' : 'YouTube '}${e.group}` : e.group
      if (!out.has(label)) out.set(label, [])
      out.get(label)!.push(e)
    }
    return out
  }, [all, q, scope])

  const pick = (e: Emote): void => {
    remember(e.name)
    onPick(e.name)
  }

  return (
    <div className="popover picker" role="dialog" aria-label="Emotes">
      <div className="pop-head">
        <input ref={search} placeholder="Search emotes" aria-label="Search emotes" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} />
        <button className="icon-btn" aria-label="Close emotes" onClick={onClose}><Icon.close /></button>
      </div>
      <div className="emote-scroll">
        {!all && <div className="empty">Loading emotes…</div>}
        {all && groups.size === 0 && <div className="empty">{q ? 'No emotes match.' : 'No emotes available yet. Connect a platform first.'}</div>}
        {[...groups].map(([label, list]) => (
          <section key={label}>
            <h3>{label}</h3>
            <div className="emote-grid">
              {list.map((e) => (
                <button key={`${e.provider}-${e.id}`} className="emote-btn" aria-label={e.name} onMouseEnter={() => setHover(e)} onClick={(ev) => { pick(e); if (!ev.shiftKey) onClose() }}>
                  {e.url ? <img src={e.url} alt="" loading="lazy" /> : <span className="glyph">{e.name}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="pop-foot">{hover ? <><b>{hover.name}</b> <span>{hover.group}</span></> : <span>Hold Shift to pick several</span>}</div>
    </div>
  )
}

import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { sortEmotes } from '../../../shared/parts'
import { PLATFORMS, type Emote, type Platform } from '../../../shared/types'
import { Icon } from '../Icons'

const RECENT_KEY = 'nnf.recentEmotes'
const RECENT_MAX = 24
const CELL = 42
const HEADER = 34
const SCROLL_PADDING = 20

type Row =
  | { kind: 'head'; label: string; icon?: string }
  | { kind: 'emotes'; emotes: Emote[] }

/** Kept between openings, so the picker appears at once and refreshes quietly behind it. */
const lists = new Map<string, Emote[]>()

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

function groupLabel(e: Emote, scope: Platform | 'all'): string {
  if (scope === 'all' && e.platform === 'youtube') return `YouTube ${e.group}`
  return e.group
}

interface Props {
  scope: Platform | 'all'
  onPick(name: string): void
  onClose(): void
}

export function EmotePicker({ scope, onPick, onClose }: Props): JSX.Element {
  const [all, setAll] = useState<Emote[] | null>(lists.get(scope) ?? null)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState<Emote | null>(null)
  const [columns, setColumns] = useState(9)
  const search = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    const list = scope === 'all' ? PLATFORMS : [scope]
    void Promise.all(list.map((p) => window.nnf.emotes(p).catch((): Emote[] => []))).then((r) => {
      if (!live) return
      const sorted = sortEmotes(r.flat(), scope)
      lists.set(scope, sorted)
      setAll(sorted)
    })
    search.current?.focus()
    return () => { live = false }
  }, [scope])

  useEffect(() => {
    const el = scroller.current!
    const measure = (): void => setColumns(Math.max(1, Math.floor((el.clientWidth - SCROLL_PADDING) / CELL)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = useMemo(() => {
    if (!all) return []
    const term = q.trim().toLowerCase()
    const groups = new Map<string, { icon?: string; emotes: Emote[] }>()
    for (const e of all) {
      if (term && !e.name.toLowerCase().includes(term)) continue
      const label = groupLabel(e, scope)
      if (!groups.has(label)) groups.set(label, { icon: e.groupIcon, emotes: [] })
      groups.get(label)!.emotes.push(e)
    }
    const ordered = [...groups]
    // The first category is always the channel's own; recent picks follow it.
    if (!term) {
      const recent = loadRecent().flatMap((n) => all.find((e) => e.name === n) ?? [])
      if (recent.length) ordered.splice(1, 0, ['Frequently used', { emotes: recent }])
    }
    const out: Row[] = []
    for (const [label, { icon, emotes }] of ordered) {
      out.push({ kind: 'head', label, icon })
      for (let i = 0; i < emotes.length; i += columns) out.push({ kind: 'emotes', emotes: emotes.slice(i, i + columns) })
    }
    return out
  }, [all, q, scope, columns])

  // Only rows on screen exist, so even thousands of emotes stay fast.
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i].kind === 'head' ? HEADER : CELL),
    overscan: 12
  })

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
      <div className="emote-scroll" ref={scroller}>
        {!all && <div className="empty">Loading emotes…</div>}
        {all && rows.length === 0 && <div className="empty">{q ? 'No emotes match.' : 'No emotes available yet. Connect a platform first.'}</div>}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const row = rows[it.index]
            return (
              <div key={it.key} className="emote-row" style={{ transform: `translateY(${it.start}px)`, height: it.size }}>
                {row.kind === 'head'
                  ? <h3 className="emote-group">{row.icon && <img src={row.icon} alt="" decoding="async" />}{row.label}</h3>
                  : row.emotes.map((e) => (
                    <button key={`${e.provider}-${e.id}`} className="emote-btn" aria-label={e.name} onMouseEnter={() => setHover(e)} onClick={(ev) => { pick(e); if (!ev.shiftKey) onClose() }}>
                      {e.url ? <img src={e.url} alt="" decoding="async" /> : <span className="glyph">{e.name}</span>}
                    </button>
                  ))}
              </div>
            )
          })}
        </div>
      </div>
      <div className="pop-foot">{hover ? <><b>{hover.name}</b> <span>{hover.group}</span></> : <span>Hold Shift to pick several</span>}</div>
    </div>
  )
}

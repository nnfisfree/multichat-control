import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { ActionResult, ChatMessage, ModerationRequest } from '../../shared/types'
import { useStore } from '../lib/store'
import { toggleUserMark, twitchViewerCardUrl, userKey } from '../lib/userMarks'
import { Icon } from './Icons'

const GAP = 6

interface Props {
  m: ChatMessage
  /** The ⋮ button it opened from, the menu lines up with its right edge. */
  anchor: DOMRect
  onClose(): void
  onResult(r: ActionResult): void
  onCard(m: ChatMessage, x: number, y: number): void
}

function Item({ icon, children, onClick, danger, disabled, title }: { icon: ReactNode; children: ReactNode; onClick(): void; danger?: boolean; disabled?: boolean; title?: string }): JSX.Element {
  return (
    <button role="menuitem" className={danger ? 'danger' : undefined} disabled={disabled} title={title} onClick={onClick}>
      <span className="qm-icon">{icon}</span>{children}
    </button>
  )
}

/** Quick actions behind the ⋮ button that shows when hovering a chat message. */
export function QuickMenu({ m, anchor, onClose, onResult, onCard }: Props): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 })
  const confirm = useStore((s) => s.settings?.confirmActions ?? true)
  const channel = useStore((s) => s.statuses.twitch?.channel)
  const ignored = useStore((s) => userKey(m.platform, m.author.id) in (s.settings?.ignoredUsers ?? {}))
  const highlighted = useStore((s) => userKey(m.platform, m.author.id) in (s.settings?.highlightedUsers ?? {}))
  // with "Confirm big actions" on, Ban needs a second click
  const [sure, setSure] = useState(false)

  // below the button when it fits, otherwise above it
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(GAP, Math.min(anchor.right - w, window.innerWidth - w - GAP))
    const below = anchor.bottom + GAP
    const top = below + h <= window.innerHeight - GAP ? below : Math.max(GAP, anchor.top - GAP - h)
    setPlace({ left, top })
  }, [anchor])

  useEffect(() => {
    const outside = (e: MouseEvent): void => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return
      if (e.target instanceof Element && e.target.closest('[data-quick-toggle]')) return
      onClose()
    }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    // the message moves when chat scrolls, so the menu would point at the wrong one
    const scroll = (e: Event): void => { if (!(e.target instanceof Node && box.current?.contains(e.target))) onClose() }
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('wheel', scroll, { passive: true })
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('wheel', scroll)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const report = (p: Promise<ActionResult>): void => { p.then(onResult, (e) => onResult({ ok: false, message: String(e) })) }
  const run = (fn: () => void) => (): void => { fn(); onClose() }
  const mod = (req: ModerationRequest) => run(() => report(window.nnf.moderate(m.platform, req)))
  const user = { userId: m.author.id, userName: m.author.name }
  const self = !!m.author.isBroadcaster
  const live = !m.history && !m.deleted && !m.held
  const canPin = m.platform === 'twitch' && live
  const viewerCard = m.platform === 'twitch' && channel && m.author.login ? twitchViewerCardUrl(channel, m.author.login) : null
  const mark = (list: 'ignoredUsers' | 'highlightedUsers', on: string, off: string) => run(() => {
    const now = toggleUserMark(list, m)
    onResult({ ok: true, message: now ? on : off })
  })

  return (
    <div ref={box} className="popover ctx quick-menu" role="menu" aria-label={`Actions for ${m.author.name}`} style={place}>
      {canPin && <>
        <Item icon={<Icon.pin />} onClick={run(() => report(window.nnf.twitchCommand(`/pinmessage ${m.id}`).then((r) => ({ ok: r.ok, message: r.message }))))}>Pin message</Item>
        <hr />
      </>}
      <Item icon={<Icon.person />} onClick={run(() => onCard(m, anchor.left, anchor.top))}>View user card</Item>
      {viewerCard && <Item icon={<Icon.external />} title="Opens Twitch's own viewer card in your browser" onClick={run(() => void window.nnf.openExternal(viewerCard))}>Twitch viewer card</Item>}
      {!self && <>
        <Item icon={<Icon.timer />} onClick={mod({ kind: 'timeout', seconds: 60, ...user })}>Timeout user (60s)</Item>
        <Item icon={<Icon.ban />} danger onClick={confirm && !sure ? () => setSure(true) : mod({ kind: 'ban', ...user })}>{confirm && sure ? 'Click again to ban' : 'Ban user'}</Item>
        <hr />
        <Item icon={<Icon.eyeOff />} title={ignored ? undefined : 'Hides their messages from chat on this PC. Their subs, gifts and other events still show.'} onClick={mark('ignoredUsers', `Ignoring ${m.author.name}. Settings > Chat lists everyone you ignore.`, `${m.author.name} is no longer ignored.`)}>{ignored ? 'Stop ignoring user' : 'Ignore user'}</Item>
      </>}
      <Item icon={<Icon.star />} onClick={mark('highlightedUsers', `${m.author.name}'s messages will stand out.`, `${m.author.name} is no longer highlighted.`)}>{highlighted ? 'Remove highlight' : 'Highlight user'}</Item>
      {!m.held && !m.history && <>
        <hr />
        <Item icon={<Icon.trash />} danger disabled={m.deleted} onClick={mod({ kind: 'delete', messageId: m.id })}>Delete message</Item>
      </>}
    </div>
  )
}

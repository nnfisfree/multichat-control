import { memo, useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react'
import { firstPreviewLink, plainText } from '../../shared/parts'
import { isReloginNotice, reloginDone } from '../../shared/relogin'
import { READ_ONLY, type ChatMessage, type MessagePart } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { useStore } from '../lib/store'
import { login as startLogin } from '../lib/login'
import { mentionsStreamer } from '../lib/mentions'
import { nameColor } from '../lib/nameColor'
import { EventCard } from './EventCard'
import { LinkPreviewFor } from './LinkPreview'
import { ModBar } from './ModBar'

function Part({ p }: { p: MessagePart }): JSX.Element {
  if (p.type === 'gif') return <img className="gif" src={p.url} alt={p.alt} title={p.alt} />
  if (p.type === 'emote') return <img className={p.giant ? 'emote giant' : 'emote'} src={p.url} alt={p.name} title={p.name} decoding="async" />
  if (p.type === 'link') return <a href={p.url} onClick={(e) => { e.preventDefault(); void window.nnf.openExternal(p.url) }}>{p.text}</a>
  return <>{p.text}</>
}

type Piece = { kind: 'part'; p: MessagePart } | { kind: 'stack'; layers: Extract<MessagePart, { type: 'emote' }>[] }

/** Zero-width emotes (7TV's RainTime etc.) stack on top of the emote before them. */
function stackParts(parts: MessagePart[]): Piece[] {
  const out: Piece[] = []
  for (const p of parts) {
    if (p.type === 'emote' && p.overlay) {
      let i = out.length - 1
      const gap = out[i]
      if (gap?.kind === 'part' && gap.p.type === 'text' && !gap.p.text.trim()) i--
      const base = out[i]
      if (base && (base.kind === 'stack' || base.p.type === 'emote')) {
        out.splice(i + 1)
        out[i] = base.kind === 'stack' ? { kind: 'stack', layers: [...base.layers, p] } : { kind: 'stack', layers: [base.p as Extract<MessagePart, { type: 'emote' }>, p] }
        continue
      }
    }
    out.push({ kind: 'part', p })
  }
  return out
}

export function Pieces({ parts }: { parts: MessagePart[] }): JSX.Element {
  return (
    <>
      {stackParts(parts).map((x, i) => x.kind === 'part'
        ? <Part key={i} p={x.p} />
        : (
          <span key={i} className="emote-stack" title={x.layers.map((l) => l.name).join(' ')}>
            {x.layers.map((l, j) => <img key={j} className={j ? 'emote layer' : l.giant ? 'emote giant' : 'emote'} src={l.url} alt={l.name} decoding="async" />)}
          </span>
        ))}
    </>
  )
}

interface Props {
  m: ChatMessage
  showPlatform: boolean
  showTime: boolean
  onMenu(e: MouseEvent, m: ChatMessage): void
  onReply(m: ChatMessage): void
  /** The ⋮ quick-actions button, with that button's place on screen. */
  onQuick(m: ChatMessage, anchor: DOMRect): void
  /** This row's quick menu is open, so its buttons stay visible. */
  quickOpen: boolean
}

/**
 * Reply / Copy / ⋮ buttons that show while hovering a message. TikTok is read-only, so it gets none,
 * and held messages aren't in chat yet (Allow/Deny lives on their mod strip).
 */
function HoverActions({ m, onReply, onQuick, open }: { m: ChatMessage; onReply(m: ChatMessage): void; onQuick(m: ChatMessage, anchor: DOMRect): void; open: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  const canReply = !m.held && !m.history && !m.deleted
  return (
    <div className={`hover-actions${open ? ' open' : ''}`} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      {canReply && <button className="ha-btn" title="Reply" aria-label={`Reply to ${m.author.name}`} onClick={() => onReply(m)}><Icon.reply /></button>}
      <button className={`ha-btn${copied ? ' done' : ''}`} title={copied ? 'Copied' : 'Copy message'} aria-label="Copy message" onClick={() => void navigator.clipboard.writeText(plainText(m.parts)).then(() => setCopied(true))}>{copied ? <Icon.check /> : <Icon.copy />}</button>
      <button className="ha-btn" data-quick-toggle title="More actions" aria-label={`More actions for ${m.author.name}`} aria-haspopup="menu" aria-expanded={open} onClick={(e) => onQuick(m, e.currentTarget.getBoundingClientRect())}><Icon.more /></button>
    </div>
  )
}

/** Chat text only ever goes through React text nodes, so messages can't inject markup. */
export const ChatRow = memo(function ChatRow({ m, showPlatform, showTime, onMenu, onReply, onQuick, quickOpen }: Props): JSX.Element {
  const pronoun = useStore((s) => (s.settings?.showPronouns && m.platform === 'twitch' && m.author.login ? s.pronouns[m.author.login] : undefined))
  // mentions of the streamer get highlighted in the colour of the platform they came from
  const tagged = useStore((s) => mentionsStreamer(m, s.statuses[m.platform]?.mentions))
  // preview card under YouTube videos and clips, like Twitch's own chat does
  const previews = useStore((s) => s.settings?.linkPreviews ?? true)
  // Held/flagged messages never get a card, those are exactly the links we don't want to advertise.
  // A "log in again" notice fades out once the new login has the scopes it asked for.
  const reloginFixed = useStore((s) => isReloginNotice(m) && reloginDone(s.statuses[m.platform]))
  const prefs = useStore((s) => s.settings?.platformPrefs?.[m.platform])
  // Settings > Chat > Twitch > Show GIFs off: just the GIF's name in brackets
  const parts = useMemo(() => (prefs?.showGifs === false && m.parts.some((p) => p.type === 'gif')
    ? m.parts.map((p): MessagePart => (p.type === 'gif' ? { type: 'text', text: `[GIF: ${p.alt}]` } : p))
    : m.parts), [prefs?.showGifs, m.parts])
  const starred = useStore((s) => !!m.author.id && `${m.platform}:${m.author.id}` in (s.settings?.highlightedUsers ?? {}))
  const previewUrl = useMemo(() => (previews && !m.deleted && !m.held && !m.flag ? firstPreviewLink(m.parts) : null), [previews, m.deleted, m.held, m.flag, m.parts])
  if (m.divider) return <div className="history-divider" role="separator"><span>{m.divider}</span></div>
  if (m.event) return <div className="row kind-event"><EventCard e={m.event} /></div>
  if (m.kind === 'system') {
    return (
      <div className={`row kind-system sys-${m.platform}${reloginFixed ? ' relogin-done' : ''}`}>
        <PlatformIcon platform={m.platform} size={16} />
        <span>{plainText(m.parts)}</span>
        {isReloginNotice(m) && !reloginFixed && <button className="btn sm" onClick={() => void startLogin(m.platform)}>Log in again</button>}
      </div>
    )
  }
  const mod = m.held ? ` held held-${m.held.status}` : m.flag ? ` flagged flagged-${m.flag.kind}` : ''
  return (
    <div className={`row kind-${m.kind}${m.firstTime ? ' first' : ''}${m.effect ? ` effect-${m.effect}` : ''}${m.effectId ? ` fx-${m.effectId.replace(/[^w-]/g, '')}` : ''}${tagged && !mod ? ` mention mention-${m.platform}` : ''}${starred && !mod && !tagged ? ` user-hl` : ''}${quickOpen ? ' quick-open' : ''}${mod}`} onContextMenu={(e) => onMenu(e, m)}>
      {(m.held || m.flag) && <ModBar m={m} />}
      {m.reply && (
        <div className="reply"><Icon.reply /> Replying to <b>{m.reply.author}</b>: {m.reply.text}</div>
      )}
      {(m.label || m.firstTime) && <div className="tag">{m.label ?? 'FIRST WORDS'}</div>}
      <div className="line">
        {showTime && <time>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
        {showPlatform && <span className={`pf ${m.platform}`}><PlatformIcon platform={m.platform} size={16} /></span>}
        {(m.author.badges ?? []).map((b, i) => (b.url
          ? <img key={i} className="badge" src={b.url} alt={b.title} title={b.title} />
          : <span key={i} className="badge-text" title={b.title}>{b.title.slice(0, 1)}</span>))}
        {pronoun && <span className="pronoun" title="Pronouns">{pronoun}</span>}
        <button className="name" style={{ color: nameColor(m, prefs) }} title="Click for user card, right-click for moderation" onClick={(e) => onMenu(e, m)}>{m.author.name}</button>
        <span className="colon">: </span>
        {m.deleted
          ? <span className="deleted" title={plainText(m.parts)}>[message deleted]</span>
          : <span className={m.kind === 'action' ? 'body action' : 'body'}><Pieces parts={parts} /></span>}
      </div>
      {previewUrl && <LinkPreviewFor url={previewUrl} />}
      {!READ_ONLY.includes(m.platform) && !m.held && <HoverActions m={m} onReply={onReply} onQuick={onQuick} open={quickOpen} />}
    </div>
  )
})

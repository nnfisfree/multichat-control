import { memo, useMemo, type JSX, type MouseEvent } from 'react'
import { firstPreviewLink, plainText } from '../../shared/parts'
import { isReloginNotice, reloginDone } from '../../shared/relogin'
import type { ChatMessage, MessagePart } from '../../shared/types'
import { Icon, PlatformIcon } from './Icons'
import { useStore } from '../lib/store'
import { mentionsStreamer } from '../lib/mentions'
import { EventCard } from './EventCard'
import { LinkPreviewFor } from './LinkPreview'
import { ModBar } from './ModBar'

function Part({ p }: { p: MessagePart }): JSX.Element {
  if (p.type === 'gif') return <img className="gif" src={p.url} alt={p.alt} title={p.alt} />
  if (p.type === 'emote') return <img className="emote" src={p.url} alt={p.name} title={p.name} decoding="async" />
  if (p.type === 'link') return <a href={p.url} onClick={(e) => { e.preventDefault(); void window.nnf.openExternal(p.url) }}>{p.text}</a>
  return <>{p.text}</>
}

type Piece = { kind: 'part'; p: MessagePart } | { kind: 'stack'; layers: Extract<MessagePart, { type: 'emote' }>[] }

/** Overlay emotes (like 7TV's RainTime) sit on top of the emote before them, as in other chat apps. */
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
            {x.layers.map((l, j) => <img key={j} className={j ? 'emote layer' : 'emote'} src={l.url} alt={l.name} decoding="async" />)}
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
}

/** Chat text is rendered only through React text nodes, so messages cannot inject markup. */
export const ChatRow = memo(function ChatRow({ m, showPlatform, showTime, onMenu }: Props): JSX.Element {
  const pronoun = useStore((s) => (s.settings?.showPronouns && m.platform === 'twitch' && m.author.login ? s.pronouns[m.author.login] : undefined))
  // Messages that tag the streamer stand out, in the colour of the platform they came from.
  const tagged = useStore((s) => mentionsStreamer(m, s.statuses[m.platform]?.mentions))
  // A YouTube video or a clip gets a card under the message, as in Twitch's own chat.
  const previews = useStore((s) => s.settings?.linkPreviews ?? true)
  // Held or flagged messages never get a card: their links are exactly the ones not to advertise.
  // A "log in again" notice fades out once the new login has the permissions it asked for.
  const reloginFixed = useStore((s) => isReloginNotice(m) && reloginDone(s.statuses[m.platform]))
  const previewUrl = useMemo(() => (previews && !m.deleted && !m.held && !m.flag ? firstPreviewLink(m.parts) : null), [previews, m.deleted, m.held, m.flag, m.parts])
  if (m.divider) return <div className="history-divider" role="separator"><span>{m.divider}</span></div>
  if (m.event) return <div className="row kind-event"><EventCard e={m.event} /></div>
  if (m.kind === 'system') {
    return (
      <div className={`row kind-system sys-${m.platform}${reloginFixed ? ' relogin-done' : ''}`}>
        <PlatformIcon platform={m.platform} size={16} />
        <span>{plainText(m.parts)}</span>
        {isReloginNotice(m) && !reloginFixed && <button className="btn sm" onClick={() => void window.nnf.login(m.platform)}>Log in again</button>}
      </div>
    )
  }
  const mod = m.held ? ` held held-${m.held.status}` : m.flag ? ` flagged flagged-${m.flag.kind}` : ''
  return (
    <div className={`row kind-${m.kind}${m.firstTime ? ' first' : ''}${m.effect ? ` effect-${m.effect}` : ''}${tagged && !mod ? ` mention mention-${m.platform}` : ''}${mod}`} onContextMenu={(e) => onMenu(e, m)}>
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
        <button className="name" style={{ color: m.author.color }} title="Click for user card, right-click for moderation" onClick={(e) => onMenu(e, m)}>{m.author.name}</button>
        <span className="colon">: </span>
        {m.deleted
          ? <span className="deleted" title={plainText(m.parts)}>[message deleted]</span>
          : <span className={m.kind === 'action' ? 'body action' : 'body'}><Pieces parts={m.parts} /></span>}
      </div>
      {previewUrl && <LinkPreviewFor url={previewUrl} />}
    </div>
  )
})

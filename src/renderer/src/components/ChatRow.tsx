import { memo, type JSX, type MouseEvent } from 'react'
import { plainText } from '../../../shared/parts'
import type { ChatMessage, MessagePart } from '../../../shared/types'
import { Icon, PlatformIcon } from '../Icons'
import { useStore } from '../store'
import { EventCard } from './EventCard'

function Part({ p }: { p: MessagePart }): JSX.Element {
  if (p.type === 'gif') return <img className="gif" src={p.url} alt={p.alt} title={p.alt} />
  if (p.type === 'emote') return <img className="emote" src={p.url} alt={p.name} title={p.name} loading="lazy" />
  if (p.type === 'link') return <a href={p.url} onClick={(e) => { e.preventDefault(); void window.nnf.openExternal(p.url) }}>{p.text}</a>
  return <>{p.text}</>
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
  if (m.event) return <div className="row kind-event"><EventCard e={m.event} /></div>
  return (
    <div className={`row kind-${m.kind}${m.firstTime ? ' first' : ''}${m.effect ? ` effect-${m.effect}` : ''}`} onContextMenu={(e) => onMenu(e, m)}>
      {m.reply && (
        <div className="reply"><Icon.reply /> Replying to <b>{m.reply.author}</b>: {m.reply.text}</div>
      )}
      {(m.label || m.firstTime) && <div className="tag">{m.label ?? 'FIRST WORDS'}</div>}
      <div className="line">
        {showTime && <time>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
        {showPlatform && <span className={`pf ${m.platform}`}><PlatformIcon platform={m.platform} size={16} /></span>}
        {m.author.badges.map((b, i) => (b.url
          ? <img key={i} className="badge" src={b.url} alt={b.title} title={b.title} />
          : <span key={i} className="badge-text" title={b.title}>{b.title.slice(0, 1)}</span>))}
        {pronoun && <span className="pronoun" title="Pronouns">{pronoun}</span>}
        <button className="name" style={{ color: m.author.color }} onClick={(e) => onMenu(e, m)}>{m.author.name}</button>
        <span className="colon">: </span>
        {m.deleted
          ? <span className="deleted" title={plainText(m.parts)}>[message deleted]</span>
          : <span className={m.kind === 'action' ? 'body action' : 'body'}>{m.parts.map((p, i) => <Part key={i} p={p} />)}</span>}
      </div>
    </div>
  )
})

import { useEffect, type JSX } from 'react'
import type { ActionResult, ChatMessage, ModerationRequest } from '../../shared/types'
import { plainText } from '../../shared/parts'

interface Props {
  x: number
  y: number
  m: ChatMessage
  onClose(): void
  onReply(m: ChatMessage): void
  onResult(r: ActionResult): void
  /** Opened from the users list: there is no message to reply to, copy or delete. */
  userOnly?: boolean
  onCard?(m: ChatMessage): void
}

export function ContextMenu({ x, y, m, onClose, onReply, onResult, userOnly, onCard }: Props): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose()
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const mod = (req: ModerationRequest) => () => {
    window.nnf.moderate(m.platform, req).then(onResult, (e) => onResult({ ok: false, message: String(e) }))
  }
  const user = { userId: m.author.id, userName: m.author.name }
  const self = m.author.isBroadcaster

  return (
    <div className="popover ctx" role="menu" style={{ left: Math.min(x, window.innerWidth - 210), top: Math.max(8, Math.min(y, window.innerHeight - 380)) }}>
      <div className="ctx-name">{m.author.name}</div>
      {onCard && <button role="menuitem" onClick={() => onCard(m)}>View user card</button>}
      {/* A held message isn't in chat, so it can't be replied to, deleted or pinned: Allow or Deny it instead. */}
      {!userOnly && !m.held && <>
        <button role="menuitem" onClick={() => onReply(m)}>Reply</button>
        <button role="menuitem" onClick={() => void navigator.clipboard.writeText(plainText(m.parts))}>Copy text</button>
        <button role="menuitem" disabled={m.deleted} onClick={mod({ kind: 'delete', messageId: m.id })}>Delete message</button>
        {m.platform === 'twitch' && !m.history && !m.deleted && (
          <button role="menuitem" onClick={() => void window.nnf.twitchCommand(`/pinmessage ${m.id}`).then((r) => onResult({ ok: r.ok, message: r.message }), (e) => onResult({ ok: false, message: String(e) }))}>Pin message</button>
        )}
      </>}
      {!userOnly && m.held && <button role="menuitem" onClick={() => void navigator.clipboard.writeText(plainText(m.parts))}>Copy text</button>}
      {userOnly && self && <div className="ctx-note">That is you.</div>}
      {!self && <>
        <button role="menuitem" title="Clears their messages from chat, without really timing them out" onClick={mod({ kind: 'timeout', seconds: 1, ...user })}>Timeout 1 second</button>
        <button role="menuitem" onClick={mod({ kind: 'timeout', seconds: 60, ...user })}>Timeout 1 minute</button>
        <button role="menuitem" onClick={mod({ kind: 'timeout', seconds: 600, ...user })}>Timeout 10 minutes</button>
        <button role="menuitem" className="danger" onClick={mod({ kind: 'ban', ...user })}>Ban</button>
        {m.platform === 'twitch' && <button role="menuitem" onClick={mod({ kind: 'shoutout', ...user })}>Shoutout</button>}
      </>}
    </div>
  )
}

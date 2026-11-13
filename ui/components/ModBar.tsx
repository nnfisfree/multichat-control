import { useState, type JSX } from 'react'
import type { ActionResult, ChatMessage, HeldInfo } from '../../shared/types'
import { Icon } from './Icons'
import { useStore } from '../lib/store'

const HELD_DONE: Record<Exclude<HeldInfo['status'], 'pending'>, string> = {
  allowed: 'Allowed',
  denied: 'Denied',
  expired: 'Expired, never shown in chat'
}

/**
 * The moderator's strip above a held or flagged message: why it stands out, and the buttons to
 * deal with it. Held messages get Allow and Deny; flagged ones get Delete and Ban.
 */
export function ModBar({ m }: { m: ChatMessage }): JSX.Element | null {
  const confirm = useStore((s) => s.settings?.confirmActions ?? true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [sure, setSure] = useState(false)

  const run = async (action: Promise<ActionResult>, done: string): Promise<void> => {
    setBusy(true)
    const r = await action.catch((e): ActionResult => ({ ok: false, message: String(e) }))
    setBusy(false)
    setSure(false)
    setNote(r.ok ? r.message ?? done : r.message ?? 'That didn\'t work.')
  }

  if (m.held) {
    const h = m.held
    const done = h.status !== 'pending'
    return (
      <div className={`modbar held${done ? ' done' : ''}`}>
        <span className="modbar-icon"><Icon.shield /></span>
        <span className="modbar-text">
          <b>{done ? HELD_DONE[h.status as keyof typeof HELD_DONE] : 'Held for review'}</b>
          {done && h.by && h.status !== 'expired' && <> by {h.by}</>}
          <span className="modbar-why"> · {h.reason}</span>
        </span>
        {!done && <>
          <button className="btn sm good" disabled={busy} title="Show it in chat for everyone" onClick={() => void run(window.nnf.automod(m.id, true), '')}>Allow</button>
          <button className="btn sm bad" disabled={busy} title="Keep it out of chat" onClick={() => void run(window.nnf.automod(m.id, false), '')}>Deny</button>
        </>}
        {note && <span className="modbar-note">{note}</span>}
      </div>
    )
  }

  if (m.flag) {
    const f = m.flag
    const self = m.author.isBroadcaster
    const ban = (): void => {
      if (confirm && !sure) return setSure(true)
      void run(window.nnf.moderate(m.platform, { kind: 'ban', userId: m.author.id, userName: m.author.name }), `${m.author.name} is banned.`)
    }
    return (
      <div className={`modbar flag-${f.kind}`}>
        <span className="modbar-icon"><Icon.warn /></span>
        <span className="modbar-text">
          <b>{f.label}</b>
          {f.notes.length > 0 && <span className="modbar-why"> · {f.notes.join(' · ')}</span>}
          {f.kind === 'spam' && <span className="modbar-why" title="This app's own check, not the platform's"> · App check</span>}
        </span>
        {!self && <>
          <button className="btn sm ghost" disabled={busy || m.deleted || m.history} onClick={() => void run(window.nnf.moderate(m.platform, { kind: 'delete', messageId: m.id }), 'Deleted.')}>Delete</button>
          <button className="btn sm bad" disabled={busy || !m.author.id} onClick={ban} onBlur={() => setSure(false)}>{sure ? `Ban ${m.author.name}?` : 'Ban'}</button>
        </>}
        {note && <span className="modbar-note">{note}</span>}
      </div>
    )
  }
  return null
}

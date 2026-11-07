import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ChatMessage, type Platform, type SendResult } from '../../../shared/types'
import { composerPlaceholder, plainText } from '../../../shared/parts'
import { Icon, PlatformIcon } from '../Icons'
import { connected, updateSettings, useStore } from '../store'
import type { Tab } from './Tabs'

export type Pop = 'emotes' | 'actions' | 'rewards' | 'menu' | null

interface Props {
  tab: Tab
  pop: Pop
  setPop(p: Pop): void
  replyTo: ChatMessage | null
  clearReply(): void
  /** Set by the picker; consumed once. */
  insert: { text: string; n: number } | null
  onSettings(): void
}

export function Composer({ tab, pop, setPop, replyTo, clearReply, insert, onSettings }: Props): JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [results, setResults] = useState<SendResult[]>([])
  const [busy, setBusy] = useState(false)
  const statuses = useStore((s) => s.statuses)
  const targets = useStore((s) => s.settings!.sendTargets)

  const destinations: Platform[] = replyTo ? [replyTo.platform]
    : tab === 'all' ? PLATFORMS.filter((p) => targets[p] && connected(statuses, p))
    : [tab]

  useEffect(() => {
    if (!insert) return
    const el = input.current
    const at = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const pre = text.slice(0, at)
    const piece = `${pre && !pre.endsWith(' ') ? ' ' : ''}${insert.text} `
    setText(pre + piece + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + piece.length, at + piece.length)
    })
    // Only a new pick should insert; the text it reads is the value at that moment.
  }, [insert?.n])

  useEffect(() => {
    if (replyTo) input.current?.focus()
  }, [replyTo])

  useEffect(() => {
    if (!results.length) return
    const t = setTimeout(() => setResults([]), results.some((r) => !r.ok) ? 9000 : 2500)
    return () => clearTimeout(t)
  }, [results])

  const send = async (): Promise<void> => {
    const body = text.trim()
    if (!body || busy || !destinations.length) return
    setBusy(true)
    const r = await window.nnf.send(destinations, body, replyTo ? { platform: replyTo.platform, messageId: replyTo.id } : undefined)
    setBusy(false)
    setResults(r)
    // Keep the text if nothing went out, so a failed send doesn't lose it.
    if (r.some((x) => x.ok)) {
      setText('')
      clearReply()
    }
    input.current?.focus()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape' && replyTo) clearReply()
  }

  const placeholder = replyTo ? `Reply to ${replyTo.author.name}…`
    : composerPlaceholder(tab, destinations, PLATFORMS.some((p) => connected(statuses, p)))

  return (
    <footer className="composer-wrap">
      {replyTo && (
        <div className="replying">
          <Icon.reply /> Replying to <b>{replyTo.author.name}</b>: <span>{plainText(replyTo.parts)}</span>
          <button className="icon-btn" aria-label="Cancel reply" onClick={clearReply}><Icon.close /></button>
        </div>
      )}
      {results.length > 0 && (
        <div className="send-results" role="status">
          {results.map((r) => (
            <span key={r.platform} className={r.ok ? 'chip good' : 'chip bad'} title={r.error}>
              <PlatformIcon platform={r.platform} size={14} /> {r.ok ? 'Sent' : r.error}
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <button className={pop === 'menu' ? 'icon-btn on' : 'icon-btn'} aria-label="Menu" onClick={() => setPop(pop === 'menu' ? null : 'menu')}><Icon.menu /></button>
        <button className={pop === 'rewards' ? 'icon-btn on' : 'icon-btn'} aria-label="Twitch rewards and Power-ups" title="Twitch Rewards & Power-ups" onClick={() => setPop(pop === 'rewards' ? null : 'rewards')}><Icon.gem /></button>
        <textarea ref={input} rows={1} aria-label="Message" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        {tab === 'all' && !replyTo && (
          <div className="targets">
            {PLATFORMS.map((p) => (
              <button key={p} className={targets[p] ? `pf-toggle on ${p}` : `pf-toggle ${p}`} aria-pressed={targets[p]} disabled={!connected(statuses, p)}
                title={connected(statuses, p) ? `${targets[p] ? 'Sending to' : 'Not sending to'} ${PLATFORM_LABEL[p]}` : `${PLATFORM_LABEL[p]} is not connected`}
                onClick={() => void updateSettings({ sendTargets: { ...targets, [p]: !targets[p] } })}><PlatformIcon platform={p} size={16} /></button>
            ))}
          </div>
        )}
        <button className={pop === 'emotes' ? 'icon-btn on' : 'icon-btn'} aria-label="Emotes" title="Emotes" onClick={() => setPop(pop === 'emotes' ? null : 'emotes')}><Icon.smile /></button>
        <button className={pop === 'actions' ? 'icon-btn on' : 'icon-btn'} aria-label="Actions" title="Quick actions" onClick={() => setPop(pop === 'actions' ? null : 'actions')}><Icon.bolt /></button>
        <button className="send" aria-label="Send" disabled={!text.trim() || busy || !destinations.length} onClick={() => void send()}><Icon.send /></button>
      </div>
      {pop === 'menu' && (
        <div className="popover menu" role="menu">
          <button role="menuitem" onClick={() => { setPop(null); onSettings() }}>Settings &amp; accounts</button>
          <button role="menuitem" onClick={() => setPop('rewards')}>Twitch Rewards &amp; Power-ups</button>
          <button role="menuitem" onClick={() => setPop('actions')}>Quick actions</button>
        </div>
      )}
    </footer>
  )
}
